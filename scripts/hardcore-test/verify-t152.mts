// T-152 live check: the five-item menu and old URLs, Home (waiting first,
// checklist, numbers), WhatsApp on Share, Settings tabs, and the free
// allowance of 10 priced quotes in total.
// Run: npx tsx scripts/hardcore-test/verify-t152.mts   (local stack up, migration 35 applied)
//
// API and server-rendered pages. The screens (menu on a phone, approving from
// Home, the setup logo) are driven by a Playwright pass using browser-input.json.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t152-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
// the web app counts by the server's local month (lib/usage.ts)
const periodOf = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
const thisMonth = periodOf(new Date())
const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return periodOf(d) })()
const adminHeaders = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, body: Record<string, unknown>) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: adminHeaders, body })
const counters = async (tenantId: string) =>
  (await sb.select('usage_counters', `tenant_id=eq.${tenantId}&select=period_yyyymm,estimates_created`)) as Array<{ period_yyyymm: string; estimates_created: number }>
const totalUsed = async (tenantId: string) => (await counters(tenantId)).reduce((s, r) => s + r.estimates_created, 0)
/** A page as the browser gets it, without following redirects */
const page = async (url: string, cookie?: Record<string, string>) => {
  const res = await fetch(url, { headers: cookie ?? {}, redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' }
}
const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')

async function business(name: string, region: 'US' | 'GB' = 'US') {
  const id = shortId()
  const email = `owner+t152-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const tenantId = (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region, currency: region === 'US' ? 'USD' : 'GBP', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, tenantId, tenantKey: site.tenant_key as string, email, password, name }
}
type Biz = Awaited<ReturnType<typeof business>>

const door = garageDoorsPackUS.services[0]!
async function doorService(biz: Biz, mode: { autoSend?: boolean; holdUntilApproved?: boolean } = { autoSend: true }) {
  const created = expectOk('door service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: mode.holdUntilApproved ? `${door.name} (approve first)` : door.name, description: door.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
      draftConfig: door.draft, ...mode,
    },
  }))
  return created.service.id as string
}
const doorAnswers = [{ fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }]
const submit = (biz: Biz, serviceId: string, customer: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  http('POST', `${cfg.appUrl}/api/public/quotes`, { body: { tenantKey: biz.tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers: doorAnswers }, source: { type: 'widget' }, ...extra } })
const tokenOf = (json: { quoteViewUrl: string }) => new URL(json.quoteViewUrl).searchParams.get('token')!
const home = async (biz: Biz) => text((await page(`${cfg.appUrl}/app`, biz.cookie)).html)
const done = (html: string, step: string) => new RegExp(`data-testid="checklist-${step}"[^>]*data-done="true"`).test(html)

const a = await business(`T152 Doors ${shortId()}`)
const rival = await business(`T152 Rival ${shortId()}`)
const doorId = await doorService(a)
const holdId = await doorService(a, { holdUntilApproved: true })

// ---------- 1. the menu and old URLs ----------
const homeHtml = await home(a)
const nav = /<nav[^>]*aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(homeHtml)?.[1] ?? ''
const navLinks = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
// T-160 replaced the five-item menu with three sections (AD-044); "Prices" is
// "Services" and "Share" is "Quote link". What this still proves: one menu,
// in a known order, with Branding, Billing and SMS out of it.
check('the menu: Home, Quotes, Unfinished requests, Analytics, Services, Quote link, WhatsApp, Settings (T-160)', JSON.stringify(navLinks) === JSON.stringify(['/app', '/app/quotes', '/app/quotes?filter=unfinished', '/app/analytics', '/app/services', '/app/quote-link', '/app/whatsapp', '/app/settings']), navLinks)
check('…with no SMS, Branding or Billing item', !/>(SMS|Branding|Billing|Prices|Share)</.test(nav))
for (const [from, to] of [['/app/prices', '/app/services'], ['/app/branding', '/app/settings/branding'], ['/app/billing?success=true', '/app/settings/billing?success=true']] as const) {
  const r = await page(`${cfg.appUrl}${from}`, a.cookie)
  check(`${from} redirects to ${to}`, r.status === 307 && r.location?.endsWith(to) === true, { status: r.status, location: r.location })
}
const widget = await page(`${cfg.appUrl}/app/widget`, a.cookie)
check('/app/widget still redirects to the quote link page (T-149; /app/quote-link since T-160)', [307, 308].includes(widget.status) && /\/app\/quote-link$/.test(widget.location ?? ''), widget.status)
for (const p of ['/app/services', '/app/settings', '/app/settings/branding', '/app/settings/billing', '/app/settings/notifications', '/app/analytics', '/app/whatsapp', '/app/sms', '/app/quote-link', '/app/quotes']) {
  const r = await page(`${cfg.appUrl}${p}`, a.cookie)
  check(`${p} loads`, r.status === 200, r.status)
}
const settingsHtml = text((await page(`${cfg.appUrl}/app/settings`, a.cookie)).html)
const tabs = [...(/<nav[^>]*aria-label="Settings"[^>]*>([\s\S]*?)<\/nav>/.exec(settingsHtml)?.[1] ?? '').matchAll(/href="([^"]+)"/g)].map((m) => m[1])
check('Settings has four tabs', JSON.stringify(tabs) === JSON.stringify(['/app/settings', '/app/settings/branding', '/app/settings/billing', '/app/settings/notifications']), tabs)
const whatsappPage = text((await page(`${cfg.appUrl}/app/whatsapp`, a.cookie)).html)
check('the WhatsApp page is the same page as before', /WhatsApp/.test(whatsappPage) && !/coming soon/i.test(whatsappPage))

// ---------- 2. Share → Use it on WhatsApp ----------
const slug = (await sb.select('tenants', `id=eq.${a.tenantId}&select=slug`))[0].slug as string
const shareHtml = text((await page(`${cfg.appUrl}/app/quote-link`, a.cookie)).html) // T-160: was /app/share
const waHref = /data-testid="send-on-whatsapp"[^>]*|href="(https:\/\/wa\.me\/\?text=[^"]+)"/.exec(shareHtml)
const waUrl = /href="(https:\/\/wa\.me\/\?text=[^"]+)"/.exec(shareHtml)?.[1] ?? ''
check('Share has "Use it on WhatsApp"', shareHtml.includes('Use it on WhatsApp') && Boolean(waHref))
check('"Send on WhatsApp" opens wa.me with the quote link', decodeURIComponent(waUrl.split('text=')[1] ?? '').includes(`/quote/${slug}`), waUrl.slice(0, 80))
for (const id of ['greeting', 'away', 'quick_reply']) {
  const t = new RegExp(`data-testid="whatsapp-text-${id}"[^>]*>([^<]+)<`).exec(shareHtml)?.[1] ?? ''
  check(`the ${id.replace('_', ' ')} text carries the quote link`, t.includes(`/quote/${slug}`), t.slice(0, 60))
}
check('…with where to paste it in WhatsApp Business', (shareHtml.match(/In WhatsApp Business: Settings → Business tools/g) ?? []).length === 3)
check('the advanced link goes to the existing WhatsApp page', /href="\/app\/whatsapp"[^>]*>Connect your WhatsApp number for full in-chat quoting \(advanced\)/.test(shareHtml))
check('no "coming soon" wording on Share', !/coming soon/i.test(shareHtml))

// ---------- 3. the checklist ticks on real actions ----------
let h = await home(a)
check('a service ticks "Add a service"', done(h, 'service'))
check('a service alone does not tick "Check your prices"', !done(h, 'prices'))
check('no branding step on the checklist', !/checklist-branding|Customize branding/.test(h))
check('nothing shared, no request yet: those two are open', !done(h, 'share') && !done(h, 'first_request'))
check('no Quick Actions block', !/Quick Actions/.test(h))
expectOk('prices checked', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { pricesChecked: true } }))
expectOk('share event', await http('POST', `${cfg.appUrl}/api/tenant/share-event`, { headers: a.cookie, body: { event: 'copied' } }))
h = await home(a)
check('confirming prices and copying the link tick their steps', done(h, 'prices') && done(h, 'share'))

// a setup test is not a real request
const link = expectOk('test-link', await http('POST', `${cfg.appUrl}/api/onboarding/test-link`, { headers: a.cookie }))
const testToken = new URL(link.url).searchParams.get('test')!
const testQuote = expectOk('test submit', await submit(a, doorId, { name: 'Owner Test', email: 'owner.test@example.com' }, { testToken }))
await pollQuote(cfg, testQuote.quoteId, tokenOf(testQuote))
check('a setup test does not tick "First real request received"', !done(await home(a), 'first_request'))

// ---------- 4. the free allowance: 10 in total, never resets ----------
// eight priced quotes last month (seeded), then real requests this month
await sb.insert('usage_counters', { tenant_id: a.tenantId, period_yyyymm: lastMonth, estimates_created: 8, estimates_sent: 8 })
check('test requests did not count', (await totalUsed(a.tenantId)) === 8, await counters(a.tenantId))
const lead = await http('POST', `${cfg.appUrl}/api/public/leads`, { body: { tenantKey: a.tenantKey, serviceId: doorId, customer: { name: 'Una Finished', email: 'una@example.com' } } })
check('an unfinished request is saved and does not count', lead.ok && (await totalUsed(a.tenantId)) === 8)

const ninth = expectOk('9th', await submit(a, holdId, { name: 'Wendy Waiting', email: 'wendy@example.com' }))
await pollQuote(cfg, ninth.quoteId, tokenOf(ninth))
// held for approval, so the customer page hides the price: read it from the row
const ninthRow = (await sb.select('quotes', `id=eq.${ninth.quoteId}&select=status,pricing_json`))[0]
check('quote 9 (8 last month + 1) is priced and waits for approval', ninthRow.pricing_json?.total === 1400 && ninthRow.status === 'pending_review', ninthRow.status)
const tenth = expectOk('10th', await submit(a, doorId, { name: 'Ten Ten', email: 'ten@example.com' }))
const tenthQuote = await pollQuote(cfg, tenth.quoteId, tokenOf(tenth))
check('quote 10 is priced', tenthQuote.pricing?.total === 1400, tenthQuote.status)
check('10 used in total: 8 last month + 2 this month', (await totalUsed(a.tenantId)) === 10, await counters(a.tenantId))
const eleventh = await submit(a, doorId, { name: 'Eleven Held', email: 'eleven@example.com' })
const heldRow = (await sb.select('quotes', `tenant_id=eq.${a.tenantId}&customer_json->>email=eq.eleven@example.com&select=id,status,content_json,pricing_json`))[0]
check('the 11th is held as a lead (unpriced), even though it is a new month', eleventh.ok && heldRow?.status === 'pending_review' && heldRow?.content_json?.limitHold === true, { status: heldRow?.status, limitHold: heldRow?.content_json?.limitHold })
check('…and does not count', (await totalUsed(a.tenantId)) === 10)
const atLimitTest = expectOk('test at limit', await submit(a, doorId, { name: 'Owner Test 2', email: 'owner.test2@example.com' }, { testToken }))
const atLimitTestQuote = await pollQuote(cfg, atLimitTest.quoteId, tokenOf(atLimitTest))
check('a setup test is still priced at the limit and not counted', atLimitTestQuote.pricing?.total === 1400 && (await totalUsed(a.tenantId)) === 10)
const billing = expectOk('billing', await http('GET', `${cfg.appUrl}/api/billing`, { headers: a.cookie }))
check('billing: 10 of 10 free quotes, counted in total, 1 lead waiting', billing.usage.per === 'total' && billing.usage.estimatesCreated === 10 && billing.usage.planLimit === 10 && billing.usage.level === 'limit' && billing.usage.heldLeads === 1, billing.usage)
const analytics = expectOk('analytics', await http('GET', `${cfg.appUrl}/api/analytics`, { headers: a.cookie }))
check('analytics shows the same: 10 of 10 free quotes, in total', analytics.usage.per === 'total' && analytics.usage.estimatesCreated === 10 && analytics.usage.planLimit === 10, analytics.usage)
const priceLead = await http('POST', `${cfg.appUrl}/api/quotes/${heldRow?.id}/process`, { headers: a.cookie })
check('"Price this lead" is still refused at the limit', !priceLead.ok, priceLead.status)

// legacy GB: 50 a month, last month does not count
const gb = await business(`T152 GB ${shortId()}`, 'GB')
await doorService(gb)
await sb.insert('usage_counters', { tenant_id: gb.tenantId, period_yyyymm: lastMonth, estimates_created: 50, estimates_sent: 50 })
const gbBilling = expectOk('gb billing', await http('GET', `${cfg.appUrl}/api/billing`, { headers: gb.cookie }))
check('legacy GB keeps 50 a month (last month does not count)', gbBilling.usage.per === 'month' && gbBilling.usage.planLimit === 50 && gbBilling.usage.estimatesCreated === 0, gbBilling.usage)

// subscribed: the plan limit, this month only
const sub = await business(`T152 Sub ${shortId()}`)
const subDoor = await doorService(sub)
await sb.insert('subscriptions', { tenant_id: sub.tenantId, plan_id: 'plan_us_starter', status: 'active' })
await sb.insert('usage_counters', { tenant_id: sub.tenantId, period_yyyymm: lastMonth, estimates_created: 50, estimates_sent: 50 })
const subQuote = expectOk('sub quote', await submit(sub, subDoor, { name: 'Sub Scriber', email: 'sub@example.com' }))
const subPriced = await pollQuote(cfg, subQuote.quoteId, tokenOf(subQuote))
const subBilling = expectOk('sub billing', await http('GET', `${cfg.appUrl}/api/billing`, { headers: sub.cookie }))
check('a subscribed Starter tenant is priced as before (50 last month does not count)', subPriced.pricing?.total === 1400 && subBilling.usage.per === 'month' && subBilling.usage.planLimit === 50 && subBilling.usage.estimatesCreated === 1, subBilling.usage)

// ---------- 5. Home: waiting for you first ----------
h = await home(a)
check('Home shows "Waiting for you" with the customer, service and price', /Waiting for you/.test(h) && h.includes('Wendy Waiting') && h.includes(`${door.name} (approve first)`) && h.includes('$1,400.00'))
check('…with an Approve & send button', /data-testid="waiting-quote"[\s\S]*?Approve &amp; send|data-testid="waiting-quote"[\s\S]*?Approve & send/.test(h))
check('…before the checklist and the numbers', h.indexOf('Waiting for you') < h.indexOf('data-testid="home-numbers"'))
check('…and the held lead and the tests are not in it', !h.includes('Eleven Held') && !h.includes('Owner Test'))
check('"First real request received" ticks; all four done hides the checklist', !/data-testid="setup-checklist"/.test(h))
check('the unfinished count shows', /data-testid="unfinished-count"/.test(h))
check('the usage banner says the free quotes are used', h.includes("You've used your 10 free quotes"))
const nums = /data-testid="home-numbers"([\s\S]*?)<\/section>/.exec(h)?.[1] ?? ''
const figures = [...nums.matchAll(/class="figure[^"]*">([^<]+)</g)].map((m) => m[1])
// requests: 9th, 10th, 11th (held) — tests excluded; sent: the 10th; accepted: none
check('four numbers for the last 30 days: requests 3, sent 1, accepted 0, value $0', JSON.stringify(figures) === JSON.stringify(['3', '1', '0', '$0']), figures)
check('"See all numbers" opens Analytics', /href="\/app\/analytics"[^>]*>See all numbers/.test(h))
check('a rival business sees none of it', !(await home(rival)).includes('Wendy Waiting'))
const rivalApprove = await http('POST', `${cfg.appUrl}/api/quotes/${ninth.quoteId}/approve`, { headers: rival.cookie })
check('…and cannot approve it', rivalApprove.status === 404, rivalApprove.status)
const approved = await http('POST', `${cfg.appUrl}/api/quotes/${ninth.quoteId}/approve`, { headers: a.cookie })
check('approving (the Home button’s request) sends it', approved.ok && approved.json?.status === 'sent', approved.json)
h = await home(a)
check('…and it leaves "Waiting for you" (hidden when empty)', !/Waiting for you/.test(h))

// ---------- 6. Branding tick, Branding placeholders, product name ----------
check('the Branding tab has no tick for the default colour', !/data-testid="branding-done"/.test(settingsHtml))
expectOk('branding', await http('PUT', `${cfg.appUrl}/api/tenant/branding`, { headers: a.cookie, body: { branding: { primaryColor: '#1E3A5F' } } }))
check('…and ticks once a real colour is set', /data-testid="branding-done"/.test(text((await page(`${cfg.appUrl}/app/settings`, a.cookie)).html)))
const brandingApi = expectOk('branding get', await http('GET', `${cfg.appUrl}/api/tenant/branding`, { headers: a.cookie }))
check('the Branding page gets the region for its placeholders', brandingApi.region === 'US', brandingApi.region)

// ---------- 7. public wording ----------
const pricing = text((await page(`${cfg.appUrl}/pricing`)).html)
check('pricing page: "Try it free: 10 quotes, no card"', pricing.includes('Try it free: 10 quotes, no card'))
check('pricing FAQ: 10 in total, not reset monthly', pricing.includes('Can I try it for free?') && pricing.includes('don’t reset each month'))
const landing = text((await page(`${cfg.appUrl}/`)).html)
check('home page: no "Start free"; the offer instead', !/Start free/.test(landing) && landing.includes('Try it free: 10 quotes, no card'))
const login = text((await page(`${cfg.appUrl}/login`)).html)
check('the login page shows the product name', login.includes('Aistimator') && !/>Estimator</.test(login))

writeFileSync(path.join(outDir, 'browser-input.json'), JSON.stringify({ appUrl: cfg.appUrl, owner: { email: a.email, password: a.password }, slug }, null, 2))
saveJson(outDir, 'checks.json', checks)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
