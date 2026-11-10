// T-153 live check: the public demo ("Try it as a customer").
// Run with the local stack up, migration 36 applied, the demo seeded
// (npx tsx scripts/seed-demo-tenant.mts), and the web app started with:
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 pnpm dev:web
// then: npx tsx scripts/hardcore-test/verify-t153.mts
//
// It starts from an empty demo (clean-up check), prices all three demo
// services the way a visitor would, then hits the per-IP limit and the daily
// cap, and finally clears everything again through the daily cron.
import path from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { DEMO_TENANT_ID, DEMO_CONTACT, DEMO_SLUG } from '../../packages/shared/src/demo'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const CRON = process.env.CRON_SECRET || 'local-cron-t153'
const CAP = Number(process.env.DEMO_DAILY_CAP || 8)
const IP_LIMIT = Number(process.env.DEMO_IP_LIMIT_PER_HOUR || 3)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t153-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, body: Record<string, unknown>, headers: Record<string, string> = admin) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...headers, Prefer: 'return=representation' }, body })
const count = async (table: string, query: string) => (await sb.select(table, `${query}&select=id`)).length
const page = async (url: string) => {
  const res = await fetch(url, { redirect: 'manual' })
  return { status: res.status, html: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&') : '' }
}
const cron = () => http('GET', `${cfg.appUrl}/api/cron/lifecycle`, { headers: { Authorization: `Bearer ${CRON}` } })
const tokenOf = (json: { quoteViewUrl: string }) => new URL(json.quoteViewUrl).searchParams.get('token')!
/** Push every demo row back past the 24-hour retention period */
async function backdateDemo(hours = 25) {
  const past = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  for (const table of ['quotes', 'quote_requests', 'assets']) await patch(table, `tenant_id=eq.${DEMO_TENANT_ID}`, { created_at: past })
}

// ---------- 0. the demo business as seeded ----------
const demoTenant = (await sb.select('tenants', `id=eq.${DEMO_TENANT_ID}&select=is_demo,slug,notification_email,benchmarks_opt_in,name`))[0]
check('the demo business exists, flagged, with no notification email and no benchmarks', demoTenant?.is_demo === true && demoTenant.slug === DEMO_SLUG && demoTenant.notification_email === null && demoTenant.benchmarks_opt_in === false, demoTenant)
check('nobody can sign into it (no user)', (await count('user_profiles', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0)
const services = (await sb.select('services', `tenant_id=eq.${DEMO_TENANT_ID}&active=eq.true&select=id,name,auto_send,media_config`)) as Array<{ id: string; name: string; auto_send: boolean; media_config: { minPhotos: number; maxPhotos: number } }>
check('three services, all sending automatically, one photo at most', services.length === 3 && services.every((s) => s.auto_send && s.media_config.maxPhotos <= 1), services.map((s) => [s.name, s.media_config.minPhotos, s.media_config.maxPhotos]))
check('two of them need no photo', services.filter((s) => s.media_config.minPhotos === 0).length === 2)
const svc = (name: string) => services.find((s) => s.name === name)!.id
const key = (await sb.select('tenant_sites', `tenant_id=eq.${DEMO_TENANT_ID}&is_active=eq.true&select=tenant_key`))[0].tenant_key as string

// ---------- 1. a clean start (the clean-up itself) ----------
await backdateDemo()
const clean = await cron()
check('the daily cron clears old demo requests', clean.ok && (await count('quotes', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0 && (await count('quote_requests', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0, clean.json?.demoDeleted)

// ---------- 2. the page ----------
const demoPage = await page(`${cfg.appUrl}/demo`)
check('/demo: "Try it as a customer" with the example-business note', demoPage.status === 200 && demoPage.html.includes('Try it as a customer') && demoPage.html.includes('example business with example prices'))
check('…and the demo business’s widget (no tenant-key form)', demoPage.html.includes(key) && !demoPage.html.includes('Tenant Key'))
const dev = await page(`${cfg.appUrl}/demo?tenantKey=${key}`)
check('/demo?tenantKey= still opens the developer view', dev.status === 200 && dev.html.includes('Widget Demo'))
for (const p of ['/', '/painting', '/trades/garage-doors']) {
  const r = await page(`${cfg.appUrl}${p}`)
  if (r.status !== 200) continue
  check(`${p}: demo links go to /demo and say "Try it as a customer"`, /href="\/demo"[^>]*>(?:<[^>]+>)*\s*Try it as a customer/.test(r.html) && !/live demo|Widget demo/i.test(r.html))
}
const config = expectOk('config', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${key}`))
check('the widget config never carries the flag', !/"is_?demo"/i.test(JSON.stringify(config)) && config.branding.logoUrl === '/demo/example-home-services-logo.svg')

// ---------- 3. a visitor's requests ----------
const ipA = `198.51.100.${10 + (Date.now() % 200)}`
const submit = (serviceId: string, answers: unknown[], ip: string, extra: Record<string, unknown> = {}) =>
  http('POST', `${cfg.appUrl}/api/public/quotes`, {
    headers: { 'X-Forwarded-For': ip },
    body: { tenantKey: key, serviceId, customer: DEMO_CONTACT, job: { postcodeOrZip: '63021', answers }, source: { type: 'widget' }, ...extra },
  })

const lead = await http('POST', `${cfg.appUrl}/api/public/leads`, { headers: { 'X-Forwarded-For': ipA }, body: { tenantKey: key, serviceId: svc('Garage Door Spring Replacement'), customer: DEMO_CONTACT } })
check('the contact step saves no unfinished lead', lead.ok && lead.json?.skipped === true && (await count('request_leads', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0, lead.json)

const started = Date.now()
const spring = expectOk('spring', await submit(svc('Garage Door Spring Replacement'), [{ fieldId: 'spring_count', value: 'two' }], ipA))
const springQuote = await pollQuote(cfg, spring.quoteId, tokenOf(spring))
const seconds = Math.round((Date.now() - started) / 100) / 10
check('no-photo service: priced from the demo’s own rates ($375 for the pair)', springQuote.pricing?.total === 375, springQuote.status)
check(`…in under 30 seconds (${seconds}s)`, seconds < 30)
check('…sent automatically, shown as an estimate', ['sent', 'viewed'].includes(springQuote.status) && springQuote.review?.state === 'estimate', springQuote.status)

const painting = expectOk('painting', await submit(svc('Interior Painting'), [{ fieldId: 'room_count', value: 2 }], ipA))
const paintingQuote = await pollQuote(cfg, painting.quoteId, tokenOf(painting))
check('interior painting with no photo: 2 rooms priced ($75 + 2 × $375 = $825)', paintingQuote.pricing?.total === 825, paintingQuote.pricing?.total)

// the sample photo goes through the same upload as a real one
const png = readFileSync(path.join(ROOT, 'apps/web/public/demo/sample-water-heater-label.png'))
const init = expectOk('upload init', await http('POST', `${cfg.appUrl}/api/public/uploads/init`, { headers: { 'X-Forwarded-For': ipA }, body: { tenantKey: key, files: [{ fileName: 'sample-water-heater-label.png', contentType: 'image/png', sizeBytes: png.length }] } }))
const upload = init.uploads[0] as { assetId: string; uploadUrl: string }
const put = await fetch(upload.uploadUrl, { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } })
check('the sample photo uploads like any photo', put.ok, put.status)
const tooMany = await submit(svc('Water Heater Replacement'), [], ipA, { assetIds: [upload.assetId, upload.assetId] })
check('one photo at most on a demo service', !tooMany.ok, tooMany.status)
const heater = expectOk('heater', await submit(svc('Water Heater Replacement'), [], ipA, { assetIds: [upload.assetId] }))
const heaterQuote = await pollQuote(cfg, heater.quoteId, tokenOf(heater))
// Priced outright, or (when a reading is unsure) an honest range with a question
// for the customer: the normal T-109 path, which /demo shows as a range
const heaterRange = heaterQuote.provisional as { rangeLow: number; rangeHigh: number } | undefined
check(
  'photo service: the sample label is read and priced (50 gal, natural gas: $2,150), or a range around it with a question',
  heaterQuote.pricing?.total === 2150 ||
    (heaterQuote.status === 'awaiting_clarification' && Boolean(heaterRange) && heaterRange!.rangeLow <= 2150 && heaterRange!.rangeHigh >= 2150),
  { status: heaterQuote.status, total: heaterQuote.pricing?.total, range: heaterRange }
)

// nothing counted, nothing emailed, flagged as demo (not test)
const rows = (await sb.select('quotes', `tenant_id=eq.${DEMO_TENANT_ID}&select=is_demo,is_test`)) as Array<{ is_demo: boolean; is_test: boolean }>
check('every demo request is flagged demo (not test)', rows.length === 3 && rows.every((r) => r.is_demo && !r.is_test), rows)
check('nothing counts as usage', (await count('usage_counters', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0)
check('nothing is learned for calibration', (await count('measurement_examples', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0)
const reqs = (await sb.select('quote_requests', `tenant_id=eq.${DEMO_TENANT_ID}&select=source_json`)) as Array<{ source_json: Record<string, unknown> }>
check('the IP is kept only as a hash', reqs.every((r) => typeof r.source_json.demoIp === 'string' && !String(r.source_json.demoIp).includes(ipA)))

// ---------- 4. the per-IP limit and the daily cap ----------
const fourth = await submit(svc('Garage Door Spring Replacement'), [{ fieldId: 'spring_count', value: 'one' }], ipA)
check(`a visitor's ${IP_LIMIT + 1}th request in the hour is turned away (DEMO_BUSY)`, fourth.status === 429 && fourth.json?.error?.code === 'DEMO_BUSY' && fourth.json?.error?.reason === 'ip_limit', fourth.json?.error)
check('…and creates nothing', (await count('quotes', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 3)
let n = 3
let ip = 1
while (n < CAP) {
  const r = await submit(svc('Garage Door Spring Replacement'), [{ fieldId: 'spring_count', value: 'one' }], `203.0.113.${ip++}`)
  if (!r.ok) break
  n++
}
check(`other visitors fill the daily cap (${CAP})`, n === CAP && (await count('quotes', `tenant_id=eq.${DEMO_TENANT_ID}`)) === CAP)
const over = await submit(svc('Garage Door Spring Replacement'), [{ fieldId: 'spring_count', value: 'one' }], '203.0.113.250')
check('over the daily cap, a new visitor is turned away too (DEMO_BUSY)', over.status === 429 && over.json?.error?.code === 'DEMO_BUSY' && over.json?.error?.reason === 'daily_cap', over.json?.error)

// ---------- 5. the flag can't be set or read by a tenant ----------
const id = shortId()
const email = `owner+t153-${id}@hardcore.test`
const password = `Hardcore-${id}-Aa1!`
const user = await sb.createUser(email, password, `T153 Biz ${id}`)
const session = await sb.signIn(email, password)
const cookie = { Cookie: sessionCookieHeader(cfg, session) }
const tenantId = (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id as string
await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { isDemo: true, is_demo: true, name: `T153 Biz ${id}` } })
check('PUT /api/tenant ignores a demo flag', (await sb.select('tenants', `id=eq.${tenantId}&select=is_demo`))[0].is_demo === false)
const userJwt = { apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` }
const direct = await patch('tenants', `id=eq.${tenantId}`, { is_demo: true }, userJwt)
check('setting it straight through the database with a user token is refused', !direct.ok && (await sb.select('tenants', `id=eq.${tenantId}&select=is_demo`))[0].is_demo === false, direct.status)
const tenantApi = expectOk('tenant', await http('GET', `${cfg.appUrl}/api/tenant`, { headers: cookie }))
check('GET /api/tenant never returns it', !/is_?demo/i.test(JSON.stringify(tenantApi)))
const otherDemo = await http('GET', `${cfg.appUrl}/api/quotes/${spring.quoteId}`, { headers: cookie })
check('another business can’t read a demo quote', otherDemo.status === 404, otherDemo.status)

// ---------- 6. clean-up after 24 hours, demo rows only ----------
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
const step = { id: 'visit', name: 'Call-out visit', description: 'Visit', costType: 'fixed', defaultCost: 95, optional: false }
const ownSvc = expectOk('svc', await http('POST', `${cfg.appUrl}/api/services`, { headers: cookie, body: { name: 'Handyman', documentTypeDefault: 'instant_estimate', scopeIncludes: ['Repairs'], scopeExcludes: [], defaultAssumptions: [], mediaConfig: { minPhotos: 0, maxPhotos: 2, photoGuidance: null, requiredAngles: [] }, workSteps: [step], expectedSignals: [], pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [step] }, autoSend: true } })).service.id
const own = expectOk('own quote', await http('POST', `${cfg.appUrl}/api/public/quotes`, { body: { tenantKey: site.tenant_key, serviceId: ownSvc, customer: { name: 'Real Customer', email: 'real.customer@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'Fix a shelf' }] }, source: { type: 'widget' } } }))
await patch('quotes', `id=eq.${own.quoteId}`, { created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString() })
await backdateDemo(23)
await cron()
check('a demo request under 24 hours old is kept', (await count('quotes', `tenant_id=eq.${DEMO_TENANT_ID}`)) === CAP)
await backdateDemo(25)
const assetsBefore = await count('assets', `tenant_id=eq.${DEMO_TENANT_ID}`)
const swept = await cron()
check('after 24 hours the daily cron deletes demo quotes, requests and uploads', (await count('quotes', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0 && (await count('quote_requests', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0 && (await count('assets', `tenant_id=eq.${DEMO_TENANT_ID}`)) === 0, { demoDeleted: swept.json?.demoDeleted, assetsBefore })
check('…and leaves a real business’s old quote alone', (await count('quotes', `id=eq.${own.quoteId}`)) === 1)
const after = await submit(svc('Garage Door Spring Replacement'), [{ fieldId: 'spring_count', value: 'two' }], '203.0.113.251')
check('with the old requests gone, the demo takes requests again', after.ok, after.status)

saveJson(outDir, 'checks.json', checks)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
