// T-150 live check: setup that shows the business its prices and ends with a real test quote.
// Run: npx tsx scripts/hardcore-test/verify-t150.mts   (local stack up, migration 33 applied)
//
// API and page level, on the same code setup uses (lib/price-list,
// lib/onboarding-service). The setup screens themselves are driven by a
// Playwright pass using the browser-input.json this writes.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { toPriceList, applyPriceList } from '../../apps/web/src/lib/price-list'
import { servicePayload, type DraftService } from '../../apps/web/src/lib/onboarding-service'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t150-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const period = () => { const d = new Date(); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const usage = async (tenantId: string) => {
  const row = (await sb.select('usage_counters', `tenant_id=eq.${tenantId}&period_yyyymm=eq.${period()}&select=estimates_created,estimates_sent`))[0]
  return { created: row?.estimates_created ?? 0, sent: row?.estimates_sent ?? 0 }
}
const tenantRow = async (id: string) => (await sb.select('tenants', `id=eq.${id}&select=slug,trade,trade_other,selected_plan,onboarding_skipped_at`))[0]
const quoteRow = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=is_test,status,pricing_json`))[0]

/** A new signup, as the pricing page sends it: ?plan= rides in the user's metadata */
async function signup(name: string, plan?: string) {
  const id = shortId()
  const email = `owner+t150-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const res = await http('POST', `${cfg.supabaseUrl}/auth/v1/admin/users`, {
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` },
    body: { email, password, email_confirm: true, user_metadata: { business_name: name, ...(plan && { selected_plan: plan }) } },
  })
  const user = expectOk('createUser', res)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const tenantId = (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  return { cookie, tenantId, email, password }
}
type Biz = Awaited<ReturnType<typeof signup>>
const page = async (biz: Biz | null, pathname: string) => {
  const res = await fetch(`${cfg.appUrl}${pathname}`, { headers: biz?.cookie ?? {}, redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location') ?? '', html: res.status === 200 ? await res.text() : '' }
}

// ---------- 1. a new signup lands in setup, plan kept ----------
const a = await signup(`T150 Doors ${shortId()}`, 'plan_us_pro')
const home = await page(a, '/app')
check('a new signup with no services is sent to setup', [307, 308].includes(home.status) && home.location.endsWith('/app/onboarding'), { status: home.status, location: home.location })
const setup = await page(a, '/app/onboarding')
check('setup opens on "What kind of work do you do?"', setup.status === 200 && setup.html.includes('What kind of work do you do?'))
check('the plan from the pricing page is kept on the tenant', (await tenantRow(a.tenantId)).selected_plan === 'plan_us_pro')
const billing = expectOk('billing', await http('GET', `${cfg.appUrl}/api/billing`, { headers: a.cookie }))
check('the billing page gets it to pre-select', billing.selectedPlanId === 'plan_us_pro')
const madeUp = await signup(`T150 Other ${shortId()}`, 'plan_made_up')
await page(madeUp, '/app')
check('a plan id we don’t offer is not kept', (await tenantRow(madeUp.tenantId)).selected_plan === null)

// ---------- 2. the trade answer ----------
const tradeRes = await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { trade: garageDoorsPackUS.id } })
check('a pack choice is stored on the tenant', tradeRes.ok && (await tenantRow(a.tenantId)).trade === garageDoorsPackUS.id)
const otherRes = await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: madeUp.cookie, body: { trade: 'other', tradeOther: 'Pressure washing and gutter cleaning' } })
const otherRow = await tenantRow(madeUp.tenantId)
check('"Something else" is stored with its text', otherRes.ok && otherRow.trade === 'other' && otherRow.trade_other === 'Pressure washing and gutter cleaning', otherRow)
check('an unknown trade is refused', (await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { trade: 'rocket-repair' } })).status === 400)

// ---------- 3. "Check your prices" → the next quote charges it, penny-exact ----------
const packSvc = garageDoorsPackUS.services[0]!
const draft: DraftService = { name: packSvc.name, description: packSvc.description, draft: packSvc.draft, addons: packSvc.addons || [], multipliers: packSvc.multipliers || [], selected: true }
const list = toPriceList(draft)
const single = list.items.find((i) => /single/i.test(i.name))!
const removal = list.items.find((i) => /removal/i.test(i.name))!
const edited = { ...draft, ...applyPriceList(draft, { ...list, items: list.items.map((i) => (i.key === single.key ? { ...i, amount: 1333.33 } : i.key === removal.key ? { ...i, amount: 175.5 } : i)) }) }
const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, { headers: a.cookie, body: servicePayload(edited) }))
const serviceId = created.service.id as string
const stored = (await sb.select('service_pricing_rules', `service_id=eq.${serviceId}&select=rules_json`))[0].rules_json
check('the edited prices are what the service stores', stored.workSteps.find((w: { id: string }) => w.id === single.key.slice(5)).defaultCost === 1333.33)

// ---------- 4. the guided test ----------
const before = await usage(a.tenantId)
const link = expectOk('test-link', await http('POST', `${cfg.appUrl}/api/onboarding/test-link`, { headers: a.cookie }))
const testToken = new URL(link.url).searchParams.get('test')!
check('the test link is the business’s own quote page in test mode', new URL(link.url).pathname === `/quote/${(await tenantRow(a.tenantId)).slug}` && Boolean(testToken))
const testPage = await page(null, new URL(link.url).pathname + new URL(link.url).search)
check('the quote page shows it is a test', testPage.status === 200 && testPage.html.includes('Test mode'))
const site = (await sb.select('tenant_sites', `tenant_id=eq.${a.tenantId}&select=tenant_key`))[0]
const answers = [{ fieldId: '_project_description', value: 'New garage door please, single steel one' }, { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }]
async function submit(extra: Record<string, unknown>) {
  return http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: site.tenant_key, serviceId, customer: { name: 'Owner Test', email: 'owner-test@example.com' }, job: { postcodeOrZip: '63021', answers }, ...extra },
  })
}
const testSubmit = expectOk('test submit', await submit({ testToken, source: { type: 'widget' } }))
const testQuote = await pollQuote(cfg, testSubmit.quoteId, new URL(testSubmit.quoteViewUrl).searchParams.get('token')!)
const testRow = await quoteRow(testSubmit.quoteId)
check('the test request is flagged as a test', testRow.is_test === true)
check('it charges the edited prices, penny-exact ($175.50 + $1,333.33 = $1,508.83)', testRow.pricing_json.total === 1508.83, testRow.pricing_json.total)
check('it is shown to the "customer" as an estimate', testQuote.status === 'pending_review' && testQuote.pricing?.total === 1508.83, testQuote.status)
const after = await usage(a.tenantId)
check('it does not count toward the plan (created and sent unchanged)', after.created === before.created && after.sent === before.sent, { before, after })
const inline = expectOk('test-quote', await http('GET', `${cfg.appUrl}/api/onboarding/test-quote?since=${encodeURIComponent(link.issuedAt)}`, { headers: a.cookie }))
check('setup gets the estimate to show inline', inline.quote?.id === testSubmit.quoteId && inline.quote?.total === 1508.83 && inline.quote?.lines?.length >= 2, inline.quote?.lines)
const approve = await http('POST', `${cfg.appUrl}/api/quotes/${testSubmit.quoteId}/approve`, { headers: a.cookie })
check('Approve & send works on the test estimate', approve.ok && approve.json.status === 'sent', approve.json)
const list2 = expectOk('quotes list', await http('GET', `${cfg.appUrl}/api/quotes`, { headers: a.cookie }))
check('the quotes list marks it as a test', list2.items.find((q: { quoteId: string }) => q.quoteId === testSubmit.quoteId)?.isTest === true)
check('the other business can’t read it', expectOk('rival test-quote', await http('GET', `${cfg.appUrl}/api/onboarding/test-quote?since=${encodeURIComponent(link.issuedAt)}`, { headers: madeUp.cookie })).quote === null)

// ---------- 5. the flag can't be forged ----------
const forgedSource = expectOk('forged source', await submit({ source: { type: 'widget', test: true, is_test: true } }))
await pollQuote(cfg, forgedSource.quoteId, new URL(forgedSource.quoteViewUrl).searchParams.get('token')!)
check('a public visitor sending test: true in source gets a normal (counted) quote', (await quoteRow(forgedSource.quoteId)).is_test === false && (await usage(a.tenantId)).created === after.created + 1)
const tampered = `${testToken.split('.')[0]}.AAAA${testToken.split('.')[1]!.slice(4)}`
check('a tampered test token is refused (403)', (await submit({ testToken: tampered })).status === 403)
check('a made-up test token is refused (403)', (await submit({ testToken: 'true' })).status === 403)
const rivalLink = expectOk('rival link', await http('POST', `${cfg.appUrl}/api/onboarding/test-link`, { headers: madeUp.cookie }))
check('another business’s test token is refused here (403)', (await submit({ testToken: new URL(rivalLink.url).searchParams.get('test') })).status === 403)
check('a test link needs a login', (await http('POST', `${cfg.appUrl}/api/onboarding/test-link`)).status === 401)
const forgedPage = await page(null, `/quote/${(await tenantRow(a.tenantId)).slug}?test=true`)
check('the quote page ignores a bad test token (no test banner)', forgedPage.status === 200 && !forgedPage.html.includes('Test mode'))

// ---------- 6. skipping, and a business with services ----------
const homeWithService = await page(a, '/app')
check('a business with services sees the dashboard', homeWithService.status === 200)
const skipper = await signup(`T150 Skip ${shortId()}`)
expectOk('skip', await http('POST', `${cfg.appUrl}/api/onboarding/skip`, { headers: skipper.cookie }))
check('after "Skip", the dashboard no longer sends them to setup', (await page(skipper, '/app')).status === 200)

// For the Playwright pass over the setup screens
const fresh = await signup(`T150 Browser ${shortId()}`)
const fresh2 = await signup(`T150 Describe ${shortId()}`)
writeFileSync(path.join(outDir, 'browser-input.json'), JSON.stringify({ appUrl: cfg.appUrl, pack: { cookie: fresh.cookie.Cookie, tenantId: fresh.tenantId }, describe: { cookie: fresh2.cookie.Cookie, tenantId: fresh2.tenantId } }))
console.log(`\nbrowser input: ${path.join(outDir, 'browser-input.json')}`)

saveJson(outDir, 't150.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
if (passed !== checks.length) process.exitCode = 1
