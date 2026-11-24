// T-180 check: Stripe live billing, end to end, in the Stripe SANDBOX (AD-062, AD-063).
//
// No real charge is made: the key must be a sandbox key and the account must be the product's
// own sandbox, or the script stops before doing anything. Cards are Stripe's test cards. No
// email leaves this machine (the web app is pointed at a stand-in for Postmark that runs inside
// this script) and no WhatsApp message is sent. Nothing touches production.
//
// The worker is NOT needed and should not be given the requests: with no worker address the web
// app only logs a job, so no AI call is made for the 100 or so requests this script sends.
//
// Web app:
//   CLOUDFLARE_WORKER_URL= POSTMARK_API_TOKEN=local-postmark-t180 POSTMARK_FROM_EMAIL=quotes@example.test \
//   POSTMARK_API_BASE_URL=http://127.0.0.1:8794/postmark pnpm dev:web
// Before the first run, once:  cd apps/web && npx tsx scripts/stripe-setup-plans.mts --write-env
//
// Run:  PLAYWRIGHT_DIR=<folder> npx tsx scripts/hardcore-test/verify-t180.mts
// Without PLAYWRIGHT_DIR everything that needs Stripe's own pages (Checkout and the customer
// portal are Stripe-hosted, so paying, switching plan, cancelling and changing a card can only be
// done in a browser) is skipped, and the script says so. Those parts take about ten minutes: they
// move Stripe test clocks forward by weeks to make renewals happen.
//
// Stripe cannot reach this machine, so the script is the delivery: it reads the sandbox's events
// from Stripe and posts each to the local webhook route, signed with the local webhook secret,
// exactly as Stripe would.
import nodeHttp from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import type StripeNs from 'stripe'
import type { Page } from 'playwright'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { FREE_ALLOWANCE, PAYMENT_FAILED_LINE, getPlan, stripePriceIdFor } from '../../packages/shared/src/plans'
import { PRODUCT_NAME } from '../../packages/shared/src/brand'
import { STRIPE_WEBHOOK_EVENTS, STRIPE_WEBHOOK_PATH } from '../../apps/web/src/lib/stripe-events'

type Row = Record<string, unknown>
const MOCK_PORT = 8794
const POSTMARK_TOKEN = 'local-postmark-t180'
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t180-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const notChecked: string[] = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined && !pass ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const rest = (method: string, pathAndQuery: string, body?: unknown, headers: Record<string, string> = admin) =>
  call(method, `${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`, { headers: { Prefer: 'return=representation', ...headers }, body })

// ---------- settings read from apps/web/.env.local; no value is ever printed ----------
const envText = readFileSync(path.join(ROOT, 'apps/web/.env.local'), 'utf8')
const fromEnv = (name: string) => envText.match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'))?.[1]?.trim()
const priceEnv: Record<string, string | undefined> = Object.fromEntries([...envText.matchAll(/^(STRIPE_PRICE_[A-Z_]+)=(.+)$/gm)].map((m) => [m[1]!, m[2]!.trim()]))
const stripeKey = fromEnv('STRIPE_SECRET_KEY')
const webhookSecret = fromEnv('STRIPE_WEBHOOK_SECRET')
if (!stripeKey || !stripeKey.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY in apps/web/.env.local is missing or is not a sandbox key. Stopped: this script only ever runs against the sandbox.')
  process.exit(2)
}
if (!webhookSecret) {
  console.error('STRIPE_WEBHOOK_SECRET is missing from apps/web/.env.local (any value works locally: the script signs with the same one).')
  process.exit(2)
}
const Stripe = createRequire(path.join(ROOT, 'apps/web/package.json'))('stripe') as typeof StripeNs
const stripe = new Stripe(stripeKey)
const startedAt = Math.floor(Date.now() / 1000) - 5

// =====================================================================================
// Stand-in for Postmark: every email the web app sends lands here and nowhere else
// =====================================================================================
interface Mail { To: string; Subject: string; Tag?: string; HtmlBody?: string }
const mails: Mail[] = []
const mock = nodeHttp.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if ((req.url ?? '').startsWith('/postmark/email')) {
      if (req.headers['x-postmark-server-token'] !== POSTMARK_TOKEN) return send(401, { ErrorCode: 10, Message: 'Bad or missing Server API token.' })
      try {
        mails.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Mail)
      } catch {
        return send(422, { ErrorCode: 402, Message: 'Invalid JSON' })
      }
      return send(200, { ErrorCode: 0, Message: 'OK', MessageID: crypto.randomUUID() })
    }
    send(404, { error: 'not found' })
  })
})
await new Promise<void>((resolve, reject) => mock.once('error', reject).listen(MOCK_PORT, '127.0.0.1', resolve))
const mailTo = (to: string, tag: string) => mails.filter((m) => m.To.toLowerCase() === to.toLowerCase() && m.Tag === tag)
async function waitForMail(to: string, tag: string, count = 1): Promise<Mail[]> {
  for (let i = 0; i < 40 && mailTo(to, tag).length < count; i++) await sleep(250)
  return mailTo(to, tag)
}

// everything this run creates on Stripe, removed at the end
const clocks: string[] = []
const stripeCustomers = new Set<string>()
async function cleanupStripe() {
  for (const clock of clocks) await stripe.testHelpers.testClocks.del(clock).catch(() => undefined) // deletes its customers and subscriptions
  for (const customer of stripeCustomers) await stripe.customers.del(customer).catch(() => undefined) // cancels its subscriptions
}
async function finish(): Promise<never> {
  mock.close()
  await cleanupStripe()
  const failed = checks.filter((c) => !c.pass)
  if (notChecked.length) console.log(`\nNot checked:\n${notChecked.map((n) => `  - ${n}`).join('\n')}`)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}

// =====================================================================================
// Businesses, requests, and what the server recorded
// =====================================================================================
interface Business { name: string; email: string; tenantId: string; userId: string; cookie: { Cookie: string }; cookieHeader: string; accessToken: string; tenantKey: string; serviceId: string }
const period = (() => {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
})()

async function business(label: string): Promise<Business> {
  const id = shortId()
  const name = `${label} ${id}`
  const email = `owner+t180-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const steps = [{ id: 'visit', name: 'Standard visit', description: 'One standard visit', costType: 'fixed', defaultCost: 120, optional: false }]
  const created = expectOk('service', await call('POST', `${app}/api/services`, {
    headers: cookie,
    body: {
      name: 'Standard Visit', description: 'A standard visit', documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['One standard visit'], scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
      workSteps: steps, expectedSignals: [],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: steps },
    },
  }))
  return { name, email, tenantId, userId: user.id as string, cookie, cookieHeader, accessToken: session.access_token as string, tenantKey: site.tenant_key as string, serviceId: created.service.id as string }
}

let customerNumber = 0
const submit = (b: Business) => {
  const n = ++customerNumber
  return call('POST', `${app}/api/public/quotes`, {
    body: {
      tenantKey: b.tenantKey, serviceId: b.serviceId,
      customer: { name: `Megan Grant ${n}`, email: `megan.grant+${n}@hardcore.test`, phone: '3145550100' },
      job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: `A standard visit please, request ${n}.` }] },
      assetIds: [], source: { type: 'widget' },
    },
    timeoutMs: 180_000,
  })
}
const held = (res: { json: Row | null }) => res.json?.status === 'held'
const usedTotal = async (tenantId: string) => ((await sb.select('usage_counters', `tenant_id=eq.${tenantId}&select=estimates_created`)) as Row[]).reduce((sum, r) => sum + Number(r.estimates_created), 0)
const setUsage = (tenantId: string, periodKey: string, count: number) => sb.insert('usage_counters', { tenant_id: tenantId, period_yyyymm: periodKey, estimates_created: count, estimates_sent: 0 })
const subscriptionRow = async (tenantId: string) => ((await sb.select('subscriptions', `tenant_id=eq.${tenantId}&select=*`)) as Row[])[0] ?? null
const billing = async (b: Business) => expectOk('billing', await call('GET', `${app}/api/billing`, { headers: b.cookie })) as { subscription: Row; usage: Row; canCheckout: boolean; canManage: boolean; freeQuotesLeftLine: string | null; suspended: boolean }
const notice = async (b: Business) => (expectOk('notice', await call('GET', `${app}/api/billing/notice`, { headers: b.cookie })) as { notice: Row | null }).notice
const waitingChange = async (b: Business) => (expectOk('pending', await call('GET', `${app}/api/billing/pending`, { headers: b.cookie })) as { pending: Row | null }).pending
const whatsappAccess = async (b: Business) => (expectOk('whatsapp config', await call('GET', `${app}/api/whatsapp/config`, { headers: b.cookie })) as { access: { allowed: boolean; why: string | null } }).access
const heldQuotes = async (tenantId: string) => (await sb.select('quotes', `tenant_id=eq.${tenantId}&status=eq.pending_review&content_json->>limitHold=eq.true&select=id,quote_request_id`)) as Row[]
/** A free test account (T-177): a live row Stripe has never heard of, as scripts/set-test-plan.sh makes */
const testPlan = (tenantId: string, planId: string) => sb.insert('subscriptions', { tenant_id: tenantId, plan_id: planId, status: 'active', current_period_start: new Date().toISOString() })

// =====================================================================================
// Stripe events → the local webhook, signed as Stripe signs them
// =====================================================================================
const webhookUrl = `${app}${STRIPE_WEBHOOK_PATH}`
const delivered = new Map<string, string>() // event id → the exact body that was posted
const ourTenants = new Set<string>()
function postEvent(payload: string, signature?: string) {
  const header = signature ?? stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret! })
  return fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload }).then(async (res) => ({ status: res.status, json: (await res.json().catch(() => null)) as Row | null }))
}
function isOurs(event: StripeNs.Event): boolean {
  const object = event.data.object as unknown as Row
  const customer = typeof object.customer === 'string' ? object.customer : (object.customer as Row | null)?.id
  if (typeof customer === 'string' && stripeCustomers.has(customer)) return true
  return typeof object.client_reference_id === 'string' && ourTenants.has(object.client_reference_id)
}
/** Post every event of this run that has not been posted yet, oldest first. Returns what was posted. */
async function deliver(): Promise<Array<{ id: string; type: string; status: number }>> {
  const fresh: StripeNs.Event[] = []
  for await (const event of stripe.events.list({ limit: 100, created: { gte: startedAt }, types: [...STRIPE_WEBHOOK_EVENTS] })) {
    // a checkout names its customer for the first time: remember it, so its later events are ours too
    const object = event.data.object as unknown as Row
    if (event.type === 'checkout.session.completed' && typeof object.client_reference_id === 'string' && ourTenants.has(object.client_reference_id) && typeof object.customer === 'string') stripeCustomers.add(object.customer)
    if (!delivered.has(event.id)) fresh.push(event)
  }
  const out: Array<{ id: string; type: string; status: number }> = []
  for (const event of fresh.reverse()) {
    if (!isOurs(event)) continue
    const payload = JSON.stringify(event)
    const res = await postEvent(payload)
    delivered.set(event.id, payload)
    out.push({ id: event.id, type: event.type, status: res.status })
  }
  return out
}
/** Keep delivering until the business's row says what is expected, or time runs out */
async function deliverUntil(tenantId: string, ok: (row: Row | null) => boolean, timeoutMs = 90_000): Promise<{ row: Row | null; events: string[]; refused: number }> {
  const until = Date.now() + timeoutMs
  const events: string[] = []
  let refused = 0
  let row = await subscriptionRow(tenantId)
  for (;;) {
    for (const e of await deliver()) {
      events.push(e.type)
      if (e.status !== 200) refused++
    }
    row = await subscriptionRow(tenantId)
    if (ok(row) || Date.now() > until) return { row, events, refused }
    await sleep(3000)
  }
}

// =====================================================================================
section('A. Before anything: the right Stripe account, the plans, the database')
// =====================================================================================
const account = await stripe.accounts.retrieve()
const accountName = account.settings?.dashboard?.display_name ?? ''
check(`the key is for the ${PRODUCT_NAME} sandbox, not a live account and not the retired sandbox`, new RegExp(PRODUCT_NAME, 'i').test(accountName) && !/new business/i.test(accountName), accountName)
if (!new RegExp(PRODUCT_NAME, 'i').test(accountName)) await finish()

const wanted: Array<[string, 'monthly' | 'annual', number]> = [
  ['plan_us_starter', 'monthly', 4900], ['plan_us_starter', 'annual', 49000],
  ['plan_us_pro', 'monthly', 9900], ['plan_us_pro', 'annual', 99000],
  ['plan_us_business', 'monthly', 19900], ['plan_us_business', 'annual', 199000],
]
const priceOf = (planId: string, interval: 'monthly' | 'annual') => stripePriceIdFor(planId, interval, 'USD', priceEnv)
const stripePrices = await Promise.all(wanted.map(async ([planId, interval]) => {
  const id = priceOf(planId, interval)
  return id ? stripe.prices.retrieve(id, { expand: ['product'] }).catch(() => null) : null
}))
check('every plan has a monthly and a yearly USD price in the sandbox, at the amounts in plans.ts, with no trial', stripePrices.every((p, i) => p?.active === true && p.unit_amount === wanted[i]![2] && p.currency === 'usd' && p.recurring?.interval === (wanted[i]![1] === 'annual' ? 'year' : 'month') && !p.recurring?.trial_period_days), stripePrices.map((p) => p?.unit_amount ?? null))
const products = stripePrices.map((p) => p?.product as StripeNs.Product | undefined)
check(`the products are named "${PRODUCT_NAME} Starter", "${PRODUCT_NAME} Pro" and "${PRODUCT_NAME} Business"`, JSON.stringify([...new Set(products.map((p) => p?.name))]) === JSON.stringify([`${PRODUCT_NAME} Starter`, `${PRODUCT_NAME} Pro`, `${PRODUCT_NAME} Business`]), products.map((p) => p?.name))
check('each product carries the tax code Managed Payments needs (software as a service, business use)', products.every((p) => (typeof p?.tax_code === 'string' ? p.tax_code : p?.tax_code?.id) === 'txcd_10103001'))
const oldName = new RegExp('aisti' + 'mator', 'i')
const everyProduct = await stripe.products.list({ limit: 100 })
check('nothing in the sandbox carries the old product name', everyProduct.data.every((p) => !oldName.test(`${p.name} ${p.description ?? ''}`)) && !oldName.test(accountName))

let portalConfiguration: StripeNs.BillingPortal.Configuration | undefined
for await (const c of stripe.billingPortal.configurations.list({ limit: 100 })) if (c.is_default) portalConfiguration = c
// the list of plans a customer can switch between is only sent when asked for
if (portalConfiguration) portalConfiguration = await stripe.billingPortal.configurations.retrieve(portalConfiguration.id, { expand: ['features.subscription_update.products'] })
const portalUpdate = portalConfiguration?.features.subscription_update
const portalPrices = new Set((portalUpdate?.products ?? []).flatMap((p) => p.prices))
check('the portal lets a customer switch between Starter and Pro, monthly and yearly, and not to Business',
  portalUpdate?.enabled === true && ['plan_us_starter', 'plan_us_pro'].every((id) => portalPrices.has(priceOf(id, 'monthly')!) && portalPrices.has(priceOf(id, 'annual')!)) && !portalPrices.has(priceOf('plan_us_business', 'monthly')!) && portalPrices.size === 4, [...portalPrices])
const downgradeRules = (portalUpdate?.schedule_at_period_end?.conditions ?? []).map((c) => c.type).sort()
check('the portal: an upgrade is charged at once (proration on); a cheaper plan or a shorter interval waits for the end of the paid period',
  portalUpdate?.proration_behavior === 'always_invoice' && JSON.stringify(downgradeRules) === JSON.stringify(['decreasing_item_amount', 'shortening_interval']), { proration: portalUpdate?.proration_behavior, downgradeRules })
check('the portal: cancel at the end of the period, change the card, see invoices',
  portalConfiguration?.features.subscription_cancel.enabled === true && portalConfiguration.features.subscription_cancel.mode === 'at_period_end' && portalConfiguration.features.payment_method_update.enabled === true && portalConfiguration.features.invoice_history.enabled === true,
  { proration: portalUpdate?.proration_behavior, cancel: portalConfiguration?.features.subscription_cancel.mode })

const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter((e) => e.url.endsWith(STRIPE_WEBHOOK_PATH))
check('one webhook endpoint, at the live address, for exactly the events the code handles', endpoints.length === 1 && endpoints[0]!.url === `https://qolumns.com${STRIPE_WEBHOOK_PATH}` && JSON.stringify([...endpoints[0]!.enabled_events].sort()) === JSON.stringify([...STRIPE_WEBHOOK_EVENTS].sort()), endpoints.map((e) => e.enabled_events))
check('in the sandbox that endpoint is switched off (the live site would refuse sandbox events)', endpoints[0]?.status === 'disabled', endpoints[0]?.status)

const ping = await call('GET', `${app}/api/billing`).catch(() => null)
if (!ping || ping.status !== 401) {
  console.error(`\nThe web app is not answering at ${app}. Start it as the top of this file says, then run again.`)
  await finish()
}
check('the billing API is closed to a visitor who is not signed in', ping.status === 401)

// =====================================================================================
section('B. The counter: requests arriving at the same moment are all counted, and limits hold exactly')
// =====================================================================================
const warm = await business('Warmup Co')
expectOk('warm-up request', await submit(warm)) // the first request compiles the route; keep that out of the race

// B1. 20 at once on a plan with room for them: exactly 20
const roomy = await business('Roomy Services')
await testPlan(roomy.tenantId, 'plan_us_pro')
const twenty = await Promise.all(Array.from({ length: 20 }, () => submit(roomy)))
check('20 requests sent at the same moment are all accepted', twenty.every((r) => r.ok), twenty.filter((r) => !r.ok).map((r) => r.status))
check('…and are counted as exactly 20 (before T-180: six counted as two)', (await usedTotal(roomy.tenantId)) === 20, await usedTotal(roomy.tenantId))
check('…none was held: the plan has room', twenty.filter(held).length === 0)

// B2. the free allowance: 20 at once from zero → exactly 10 priced, 10 held
const freeRace = await business('Free Race Co')
const freeTwenty = await Promise.all(Array.from({ length: 20 }, () => submit(freeRace)))
const freeLimit = FREE_ALLOWANCE.US!.quotes
check(`the free allowance holds exactly under a rush: 20 at once → ${freeLimit} priced and ${20 - freeLimit} held`, freeTwenty.every((r) => r.ok) && freeTwenty.filter(held).length === 20 - freeLimit, { held: freeTwenty.filter(held).length })
check(`…the count is exactly ${freeLimit}, and every held request was saved (none lost)`, (await usedTotal(freeRace.tenantId)) === freeLimit && (await heldQuotes(freeRace.tenantId)).length === 20 - freeLimit, { used: await usedTotal(freeRace.tenantId), held: (await heldQuotes(freeRace.tenantId)).length })
check('…and the rush sent one "free quotes left" email and one "free quotes used" email, not one per request', (await waitForMail(freeRace.email, 'free-quotes-left')).length === 1 && (await waitForMail(freeRace.email, 'plan-limit-reached')).length === 1, { left: mailTo(freeRace.email, 'free-quotes-left').length, used: mailTo(freeRace.email, 'plan-limit-reached').length })

// B3. a plan's monthly limit: Starter with 45 of 50 used, 20 at once → exactly 5 priced, 15 held
const monthRace = await business('Month Race Co')
await testPlan(monthRace.tenantId, 'plan_us_starter')
const starterLimit = getPlan('plan_us_starter')!.quoteLimit
await setUsage(monthRace.tenantId, period, starterLimit - 5)
const monthTwenty = await Promise.all(Array.from({ length: 20 }, () => submit(monthRace)))
check(`a plan's monthly limit holds exactly under a rush: ${starterLimit - 5} of ${starterLimit} used, 20 at once → 5 priced and 15 held`, monthTwenty.every((r) => r.ok) && monthTwenty.filter(held).length === 15 && (await usedTotal(monthRace.tenantId)) === starterLimit, { held: monthTwenty.filter(held).length, used: await usedTotal(monthRace.tenantId) })
console.log(`   Over the monthly limit: plans.ts has no overage on any offered plan, so a request is HELD (saved, not priced, not charged).`)

// B4. only the server can count
const rpcAsBusiness = await call('POST', `${cfg.supabaseUrl}/rest/v1/rpc/claim_plan_quote`, { headers: { apikey: cfg.anonKey!, Authorization: `Bearer ${roomy.accessToken}` }, body: { p_tenant_id: roomy.tenantId, p_period: period, p_limit: 0, p_per: 'month' } })
const rpcRelease = await call('POST', `${cfg.supabaseUrl}/rest/v1/rpc/release_plan_quote`, { headers: { apikey: cfg.anonKey!, Authorization: `Bearer ${roomy.accessToken}` }, body: { p_tenant_id: roomy.tenantId, p_period: period } })
check('a signed-in business cannot count or uncount for itself (the database refuses)', !rpcAsBusiness.ok && !rpcRelease.ok && (await usedTotal(roomy.tenantId)) === 20, { claim: rpcAsBusiness.status, release: rpcRelease.status })

// =====================================================================================
section('C. The free journey: 10 priced quotes, a warning at 8, a hold at 10')
// =====================================================================================
const free = await business('Free Journey Co')
for (let i = 0; i < 7; i++) expectOk(`free request ${i + 1}`, await submit(free))
const at7 = await billing(free)
check('7 of 10: no warning yet, anywhere', at7.freeQuotesLeftLine === null && at7.usage.estimatesCreated === 7 && mailTo(free.email, 'free-quotes-left').length === 0, at7.usage)
expectOk('free request 8', await submit(free))
const warning = (await waitForMail(free.email, 'free-quotes-left'))[0]
const LINE = '2 free quotes left. Pick a plan to keep pricing every request.'
check('8 of 10: one email, "2 free quotes left", with the line and a button to the billing page', mailTo(free.email, 'free-quotes-left').length === 1 && warning?.Subject === '2 free quotes left' && /2 free quotes left\./.test(warning.HtmlBody ?? '') && (warning.HtmlBody ?? '').includes('Pick a plan to keep pricing every request.') && (warning.HtmlBody ?? '').includes('/app/settings/billing'), warning?.Subject)
const at8 = await billing(free)
check(`8 of 10: the billing page's data carries the line "${LINE}"`, at8.freeQuotesLeftLine === LINE, at8.freeQuotesLeftLine)
const homeHtml = (await call('GET', `${app}/app`, { headers: free.cookie })).text
check('8 of 10: Home shows the same line', homeHtml.includes(LINE))
expectOk('free request 9', await submit(free))
await sleep(1500)
check('9 of 10: no second warning email (once only); the line now says 1 free quote left', mailTo(free.email, 'free-quotes-left').length === 1 && (await billing(free)).freeQuotesLeftLine === '1 free quote left. Pick a plan to keep pricing every request.')
const tenth = await submit(free)
const usedUp = (await waitForMail(free.email, 'plan-limit-reached'))[0]
check('10 of 10: the tenth is still priced, and the "free quotes used" email goes out once', tenth.ok && !held(tenth) && mailTo(free.email, 'plan-limit-reached').length === 1 && /free quotes/i.test(usedUp?.Subject ?? ''), usedUp?.Subject)
const eleventh = await submit(free)
const freeHeld = await heldQuotes(free.tenantId)
check('the 11th request is held, not lost: saved for the business, the customer told the estimate is coming', eleventh.ok && held(eleventh) && freeHeld.length === 1 && /will send your estimate/i.test(String(eleventh.json?.message)) && !/plan|limit|billing|upgrade/i.test(String(eleventh.json?.message)), eleventh.json?.message)
const at10 = await billing(free)
check('…it is not counted (10 of 10 still), the business is emailed about the lead, and no plan is charged', (await usedTotal(free.tenantId)) === 10 && at10.usage.heldLeads === 1 && (await waitForMail(free.email, 'lead-held')).length === 1 && at10.subscription.plan === null && at10.canCheckout === true, at10.usage)
const cannotPrice = await call('POST', `${app}/api/quotes/${freeHeld[0]!.id}/process`, { headers: free.cookie })
check('the held lead cannot be priced until a plan is picked (402), and trying does not count', cannotPrice.status === 402 && (await usedTotal(free.tenantId)) === 10, cannotPrice.json)

// =====================================================================================
section('D. A free test account (T-177): shown as one, never offered Checkout, never billed')
// =====================================================================================
const testAccountBilling = await billing(roomy)
check('the billing data says it is a test account on Pro, with nothing to buy and nothing to manage', testAccountBilling.subscription.testAccount === true && (testAccountBilling.subscription.plan as Row | null)?.id === 'plan_us_pro' && testAccountBilling.canCheckout === false && testAccountBilling.canManage === false, testAccountBilling.subscription)
const testCheckout = await call('POST', `${app}/api/billing/checkout`, { headers: roomy.cookie, body: { planId: 'plan_us_starter', interval: 'monthly' } })
const testPortal = await call('POST', `${app}/api/billing/portal`, { headers: roomy.cookie })
check('Checkout is refused for it (409 TEST_ACCOUNT) and the portal has nothing to open (400)', testCheckout.status === 409 && testCheckout.json?.error?.code === 'TEST_ACCOUNT' && testPortal.status === 400, { checkout: testCheckout.status, portal: testPortal.status })
const stripeKnows = await stripe.customers.search({ query: `email:'${roomy.email}'` }).catch(() => ({ data: [] as StripeNs.Customer[] }))
check('Stripe has never heard of it: no customer, so it can never be billed or counted as revenue', stripeKnows.data.length === 0 && (await subscriptionRow(roomy.tenantId))?.stripe_customer_id === null)
check('it has no payment notice', (await notice(roomy)) === null)
check('its plan includes WhatsApp, so the assistant is allowed', (await whatsappAccess(roomy)).allowed === true)

// =====================================================================================
section('E. The suspend switch (platform admin only)')
// =====================================================================================
const adminBiz = await business('Platform Admin')
await rest('PATCH', `user_profiles?id=eq.${adminBiz.userId}`, { role: 'admin' })
const suspendUrl = `${app}/api/admin/tenants/${roomy.tenantId}/suspend`
const sentBefore = twenty[0]!.json as Row
const byOwner = await call('POST', suspendUrl, { headers: roomy.cookie, body: { suspended: true, reason: 'self' } })
const noReason = await call('POST', suspendUrl, { headers: adminBiz.cookie, body: { suspended: true } })
check('a business cannot suspend anyone (403), and an admin must give a reason (400)', byOwner.status === 403 && noReason.status === 400, { owner: byOwner.status, noReason: noReason.status })
const suspended = await call('POST', suspendUrl, { headers: adminBiz.cookie, body: { suspended: true, reason: 'verify-t180 check' } })
check('a platform admin suspends the business', suspended.ok && suspended.json?.suspended === true && suspended.json?.changed === true, suspended.json)
const leadMailsBefore = mailTo(roomy.email, 'lead-held').length
const whileSuspended = await submit(roomy)
const suspendedHeld = await heldQuotes(roomy.tenantId)
check('while suspended, a new request is held (saved, not priced, not counted) although the plan has room', whileSuspended.ok && held(whileSuspended) && suspendedHeld.length === 1 && (await usedTotal(roomy.tenantId)) === 20, whileSuspended.json?.status)
check('…the customer is told the estimate is coming, and the business is not told to "pick a plan"', /will send your estimate/i.test(String(whileSuspended.json?.message)) && mailTo(roomy.email, 'lead-held').length === leadMailsBefore)
const pausedNotice = await notice(roomy)
check('…every dashboard page says the account is paused, and never why', pausedNotice?.kind === 'suspended' && /paused/.test(String(pausedNotice.line)) && !JSON.stringify(pausedNotice).includes('verify-t180 check') && (await billing(roomy)).suspended === true, pausedNotice)
const pricePaused = await call('POST', `${app}/api/quotes/${suspendedHeld[0]!.id}/process`, { headers: roomy.cookie })
check('…a held lead cannot be priced by hand (403 ACCOUNT_PAUSED)', pricePaused.status === 403 && pricePaused.json?.error?.code === 'ACCOUNT_PAUSED', pricePaused.json)
check('…its WhatsApp assistant is silent', JSON.stringify(await whatsappAccess(roomy)).includes('"allowed":false') && (await whatsappAccess(roomy)).why === 'suspended')
const stillOpen = await call('GET', `${app}/api/public/quotes/${sentBefore.quoteId}?token=${new URL(String(sentBefore.quoteViewUrl)).searchParams.get('token')}`)
check('…a quote sent before the suspension still opens for its customer', stillOpen.status === 200, stillOpen.status)
const selfRestore = await call('PATCH', `${cfg.supabaseUrl}/rest/v1/tenants?id=eq.${roomy.tenantId}`, { headers: { apikey: cfg.anonKey!, Authorization: `Bearer ${roomy.accessToken}`, Prefer: 'return=representation' }, body: { suspended_at: null } })
const stillSuspended = ((await sb.select('tenants', `id=eq.${roomy.tenantId}&select=suspended_at,suspended_reason`)) as Row[])[0]!
check('…the business cannot restore itself through the database', !selfRestore.ok && stillSuspended.suspended_at !== null, { status: selfRestore.status })
const again = await call('POST', suspendUrl, { headers: adminBiz.cookie, body: { suspended: true, reason: 'second press' } })
check('suspending twice changes nothing the second time', again.ok && again.json?.changed === false)
const restored = await call('POST', suspendUrl, { headers: adminBiz.cookie, body: { suspended: false } })
const afterRestore = await submit(roomy)
check('restored: a new request is priced and counted again', restored.ok && restored.json?.suspended === false && afterRestore.ok && !held(afterRestore) && (await usedTotal(roomy.tenantId)) === 21, { status: afterRestore.json?.status, used: await usedTotal(roomy.tenantId) })
const priceNow = await call('POST', `${app}/api/quotes/${suspendedHeld[0]!.id}/process`, { headers: roomy.cookie })
check('…the lead held meanwhile can now be priced, and that is counted (before T-180 a lead priced this way was never counted)', priceNow.ok && (await usedTotal(roomy.tenantId)) === 22, { status: priceNow.status, used: await usedTotal(roomy.tenantId) })
const log = (await sb.select('admin_activity_logs', `resource_id=eq.${roomy.tenantId}&resource_type=eq.tenant&action=in.(suspend,restore)&order=created_at.asc&select=action,admin_user_id,details_json`)) as Row[]
check('both changes are in the admin log, with who did it and the reason', log.length === 2 && log[0]!.action === 'suspend' && log[1]!.action === 'restore' && log.every((l) => l.admin_user_id === adminBiz.userId) && (log[0]!.details_json as Row).reason === 'verify-t180 check', log)
check('…and the notice is gone', (await notice(roomy)) === null)

// =====================================================================================
section('F. The webhook refuses what Stripe did not sign')
// =====================================================================================
const forged = JSON.stringify({ id: `evt_forged_${shortId()}`, object: 'event', type: 'customer.subscription.updated', data: { object: { id: 'sub_forged', customer: 'cus_forged' } } })
const unsigned = await fetch(webhookUrl, { method: 'POST', body: forged }).then((r) => r.status)
const wrongSecret = await postEvent(forged, stripe.webhooks.generateTestHeaderString({ payload: forged, secret: 'whsec_not_the_secret' }))
check('no signature: 400. Signed with another secret: 400. Nothing is recorded', unsigned === 400 && wrongSecret.status === 400 && ((await sb.select('stripe_events', `id=eq.${JSON.parse(forged).id}&select=id`)) as Row[]).length === 0, { unsigned, wrong: wrongSecret.status })
const unhandled = JSON.stringify({ id: `evt_other_${shortId()}`, object: 'event', type: 'charge.succeeded', data: { object: { id: 'ch_x' } } })
const ignored = await postEvent(unhandled)
check('an event the code does not handle is acknowledged and ignored', ignored.status === 200 && ignored.json?.handled === false && ((await sb.select('stripe_events', `id=eq.${JSON.parse(unhandled).id}&select=id`)) as Row[]).length === 0, ignored.json)

// =====================================================================================
// From here on: Stripe's own pages, in a browser
// =====================================================================================
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Everything on Stripe\'s hosted pages: pay Starter, upgrade to Pro, switch to yearly, downgrade, cancel, card declined at checkout, a renewal that fails then succeeds, a renewal that fails until Stripe gives up, the same webhook event twice (set PLAYWRIGHT_DIR)')
  await finish()
}
const { browserDeps } = await import('./browser.mjs')
const { chromium } = browserDeps()
const browser = await chromium.launch()
const origin = new URL(app).origin
const TEST_CARD = { good: '4242424242424242', declined: '4000000000000002', failsLater: '4000000000000341' }

async function signedInPage(b: Business): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 }, reducedMotion: 'reduce' })
  await ctx.addCookies(b.cookieHeader.split('; ').map((pair) => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: origin } }))
  return ctx.newPage()
}
const lines = async (page: Page) => (await page.locator('body').innerText()).split('\n').map((l) => l.trim()).filter(Boolean)

/** Start Checkout the way the billing page does, and pay on Stripe's page with a test card */
async function checkout(b: Business, planId: string, interval: 'monthly' | 'annual', card: string): Promise<{ outcome: 'paid' | 'declined' | 'timeout'; message: string; page: Page; tax: string | null; soldThrough: boolean }> {
  const started = await call('POST', `${app}/api/billing/checkout`, { headers: b.cookie, body: { planId, interval } })
  const url = expectOk('checkout', started).checkoutUrl as string
  const page = await signedInPage(b)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const soldThrough = /Sold through/i.test(await page.locator('body').innerText())
  await page.locator('[data-testid="card-accordion-item-button"]').dispatchEvent('click')
  await page.locator('#cardNumber').waitFor({ timeout: 20_000 })
  await page.fill('#cardNumber', card)
  await page.fill('#cardExpiry', '12 / 34')
  await page.fill('#cardCvc', '123')
  await page.fill('#billingName', 'Megan Grant')
  await page.selectOption('#billingCountry', 'US')
  await page.waitForTimeout(600)
  for (const [selector, value] of [['#billingAddressLine1', '1 Main Street'], ['#billingLocality', 'New York'], ['#billingPostalCode', '10001']] as const) {
    if (await page.locator(selector).count()) await page.fill(selector, value)
  }
  if (await page.locator('#billingAdministrativeArea').count()) await page.selectOption('#billingAdministrativeArea', 'NY').catch(() => undefined)
  await page.waitForTimeout(2500) // Stripe works the tax out from the address
  const tax = (await page.locator('body').innerText()).match(/Tax[\s\S]{0,40}?(\$[\d.,]+)/)?.[1] ?? null
  await page.locator('button[type="submit"]').click()
  const declinedText = page.getByText(/declined|was not accepted|could not be|try a different/i).first()
  const outcome = await Promise.race([
    page.waitForURL(/\/app\/settings\/billing/, { timeout: 90_000 }).then(() => 'paid' as const),
    declinedText.waitFor({ timeout: 90_000 }).then(() => 'declined' as const),
  ]).catch(() => 'timeout' as const)
  const message = outcome === 'declined' ? (await declinedText.innerText().catch(() => '')) : ''
  if (outcome !== 'paid') await page.screenshot({ path: path.join(outDir, `checkout-${outcome}-${shortId()}.png`), fullPage: true })
  return { outcome, message, page, tax, soldThrough }
}

const portalUrl = async (b: Business) => expectOk('portal', await call('POST', `${app}/api/billing/portal`, { headers: b.cookie })).portalUrl as string
async function inPortal<T>(b: Business, fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } })
  const page = await ctx.newPage()
  try {
    await page.goto(await portalUrl(b), { waitUntil: 'networkidle' })
    return await fn(page)
  } catch (error) {
    await page.screenshot({ path: path.join(outDir, `portal-error-${shortId()}.png`), fullPage: true }).catch(() => undefined)
    throw error
  } finally {
    await ctx.close()
  }
}
/** In the portal: switch to the plan with this product name, billed per month or per year */
const switchPlan = (b: Business, productName: string, interval: 'month' | 'year') =>
  inPortal(b, async (page) => {
    await page.getByText('Update subscription').click()
    await page.locator('[data-testid="continue-button"]').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(800)
    const tab = page.locator(`[data-testid^="pricing-table-interval-${interval}"]`)
    if (await tab.count()) {
      await tab.first().check({ force: true })
      await page.waitForTimeout(800)
    }
    // the page lists each plan as: name, price, "per month", then "Select" (or "Selected" for the current one)
    const text = await lines(page)
    // (when only the interval changes, the portal has already picked the same plan on the other tab: "Selected")
    let index = -1, seen = 0, current = '', alreadyPicked = false
    for (let i = 0; i < text.length; i++) {
      if (/^per\s+(month|year)$/.test(text[i]!)) current = text[i - 2] ?? ''
      if (text[i] === 'Selected' && current === productName) { alreadyPicked = true; break }
      if (text[i] === 'Select') {
        if (current === productName) { index = seen; break }
        seen++
      }
    }
    if (index < 0 && !alreadyPicked) throw new Error(`the portal does not offer ${productName} per ${interval}: ${text.join(' | ').slice(0, 300)}`)
    if (index >= 0) await page.locator('a, button').filter({ hasText: /^Select$/ }).nth(index).click()
    await page.waitForTimeout(600)
    await page.locator('[data-testid="continue-button"]').click()
    await page.waitForTimeout(5000)
    // Stripe's review page can still say "Loading" in place of its amounts after those five seconds
    // (seen 24 Nov 2026); wait for it, up to half a minute more
    let reviewLines = await lines(page)
    for (let i = 0; i < 30 && reviewLines.includes('Loading'); i++) {
      await page.waitForTimeout(1000)
      reviewLines = await lines(page)
    }
    const review = reviewLines.join(' | ')
    await page.locator('[data-testid="confirm"]').click()
    await page.waitForTimeout(9000)
    return { offered: text.filter((l, i) => /^per\s+(month|year)$/.test(text[i + 2] ?? '')), review }
  })
const cancelInPortal = (b: Business) =>
  inPortal(b, async (page) => {
    await page.getByText('Cancel subscription').click()
    await page.locator('[data-testid="confirm"]').waitFor({ timeout: 30_000 })
    const review = (await lines(page)).join(' | ')
    await page.locator('[data-testid="confirm"]').click()
    await page.waitForTimeout(6000)
    return review
  })
// The portal's way to the subscription's card: a small pencil link normally, and a full "Update payment
// method" button (which also pays the unpaid invoice) once a payment has failed
const updateLink = (page: Page) =>
  page.locator('a[aria-label="Update payment method"]').or(page.locator('a, button').filter({ hasText: /^Update payment method$/ })).first()
/** In the portal: add a card, then make the subscription use it (two steps, as a customer does them) */
const changeCard = (b: Business, card: string) =>
  inPortal(b, async (page) => {
    const last4 = card.slice(-4)
    if (!(await lines(page)).some((l) => l.includes(`•••• ${last4}`))) {
      await page.getByText('Add payment method').click()
      const frame = page.frameLocator('iframe[src*="elements-inner-payment"]')
      await frame.locator('#payment-numberInput').waitFor({ timeout: 30_000 })
      await frame.locator('#payment-numberInput').fill(card)
      await frame.locator('#payment-expiryInput').fill('12 / 34')
      await frame.locator('#payment-cvcInput').fill('123')
      await frame.locator('#payment-countryInput').selectOption('US')
      await page.waitForTimeout(500)
      await frame.locator('#payment-postalCodeInput').fill('10001')
      await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^Add/ }).click()
      await updateLink(page).waitFor({ timeout: 45_000 })
      await page.waitForTimeout(1500)
    }
    await updateLink(page).click()
    await page.locator('[data-testid="confirm"]').waitFor({ timeout: 30_000 })
    await page.getByText(new RegExp(`•••• ${last4}`)).last().click()
    await page.waitForTimeout(800)
    await page.locator('[data-testid="confirm"]').click()
    await page.waitForTimeout(7000)
  })
const subscriptionCard = async (customerId: string) => {
  const subscription = (await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 })).data[0]
  const pm = typeof subscription?.default_payment_method === 'string' ? subscription.default_payment_method : subscription?.default_payment_method?.id
  return pm ? (await stripe.paymentMethods.retrieve(pm)).card?.last4 ?? null : null
}

/** What Stripe is holding for the end of the paid period on a subscription: the price it will move to, and when */
async function pendingChange(subscriptionId: string): Promise<{ price: string | null; startsAt: number | null; periodEnd: number | null }> {
  let subscription = await stripe.subscriptions.retrieve(subscriptionId)
  for (let i = 0; i < 15 && !subscription.schedule; i++) {
    await sleep(2000)
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  }
  const periodEnd = subscription.items.data[0]?.current_period_end ?? null
  const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id
  if (!scheduleId) return { price: null, startsAt: null, periodEnd }
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  const next = schedule.phases[schedule.phases.length - 1]
  const price = next?.items[0]?.price
  return { price: typeof price === 'string' ? price : price?.id ?? null, startsAt: next?.start_date ?? null, periodEnd }
}

/** A business whose Stripe customer lives on a test clock, so its renewals can be made to happen */
async function clockBusiness(label: string): Promise<{ b: Business; clock: string; customer: string }> {
  const b = await business(label)
  ourTenants.add(b.tenantId)
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `verify-t180 ${label}` })
  clocks.push(clock.id)
  const customer = await stripe.customers.create({ email: b.email, name: b.name, test_clock: clock.id, metadata: { tenant_id: b.tenantId } })
  stripeCustomers.add(customer.id)
  // A business that has bought before keeps its Stripe customer: the row a returning business has
  await sb.insert('subscriptions', { tenant_id: b.tenantId, plan_id: 'plan_us_starter', status: 'canceled', stripe_customer_id: customer.id })
  // it has priced more than the free allowance in its time, so "no plan" means its requests are held
  await setUsage(b.tenantId, '202601', FREE_ALLOWANCE.US!.quotes + 5)
  return { b, clock: clock.id, customer: customer.id }
}
async function advance(clock: string, days: number): Promise<void> {
  const now = (await stripe.testHelpers.testClocks.retrieve(clock)).frozen_time
  await stripe.testHelpers.testClocks.advance(clock, { frozen_time: now + days * 86_400 })
  for (let i = 0; i < 120; i++) {
    await sleep(2500)
    if ((await stripe.testHelpers.testClocks.retrieve(clock)).status === 'ready') return
  }
  throw new Error('the Stripe test clock did not finish advancing')
}

try {
  // ===================================================================================
  section('G. The paying journey: Starter, Pro, yearly, a downgrade asked for, cancel')
  // ===================================================================================
  ourTenants.add(free.tenantId)
  const paid = await checkout(free, 'plan_us_starter', 'monthly', TEST_CARD.good)
  check('Checkout is Stripe\'s Managed Payments page ("Sold through …"), and adds the tax on top of $49', paid.soldThrough && paid.tax !== null && paid.tax !== '$0.00', { soldThrough: paid.soldThrough, tax: paid.tax })
  check('the test card is accepted and Stripe sends the business back to the billing page', paid.outcome === 'paid' && new URL(paid.page.url()).pathname === '/app/settings/billing', { outcome: paid.outcome, message: paid.message })
  if (paid.outcome !== 'paid') await finish()
  // No webhook has been delivered yet: the page shows the plan from the return alone
  await paid.page.getByTestId('current-plan').waitFor({ timeout: 60_000 })
  await paid.page.getByText('Your Starter plan is active.').waitFor({ timeout: 30_000 }).catch(() => undefined)
  const landed = (await paid.page.locator('main').innerText()).replace(/\s+/g, ' ')
  check('the billing page shows the plan at once, before any webhook: "Starter plan, billed monthly", active, $49/mo', (await paid.page.getByTestId('current-plan').innerText()).trim() === 'Starter plan, billed monthly' && landed.includes('Your Starter plan is active.') && landed.includes('$49') && landed.includes('Manage billing'), landed.slice(0, 300))
  check('…with one "Change plan" button and no "Select Plan": a business with a plan changes it in the portal', (await paid.page.getByTestId('change-plan').count()) === 1 && !landed.includes('Select Plan'))
  await paid.page.screenshot({ path: path.join(outDir, 'billing-after-checkout.png'), fullPage: true })
  await paid.page.context().close()

  const afterPay = await billing(free)
  check('usage moves to the plan\'s monthly limit: 10 of 50 this month (it was 10 of 10 free)', afterPay.usage.per === 'month' && afterPay.usage.planLimit === 50 && afterPay.usage.estimatesCreated === 10 && (afterPay.subscription.plan as Row).id === 'plan_us_starter' && afterPay.subscription.interval === 'monthly' && afterPay.canCheckout === false && afterPay.canManage === true, afterPay.usage)
  const starterRow = await subscriptionRow(free.tenantId)
  const customerId = String(starterRow?.stripe_customer_id)
  stripeCustomers.add(customerId)
  const stripeSubscription = await stripe.subscriptions.retrieve(String(starterRow?.stripe_subscription_id))
  check('Stripe\'s subscription is a Managed Payments one, with no trial, tied to this business', (stripeSubscription as unknown as { managed_payments?: { enabled?: boolean } }).managed_payments?.enabled === true && stripeSubscription.trial_end === null && stripeSubscription.metadata.tenant_id === free.tenantId)
  // T-201: the return from Checkout stores the plan and prices nothing by itself (the business is not kept waiting)
  check('the lead held at 10 of 10 is still held after the return from Checkout: it is the purchase event that prices it', (await heldQuotes(free.tenantId)).length === 1 && (await usedTotal(free.tenantId)) === 10, { held: (await heldQuotes(free.tenantId)).length, used: await usedTotal(free.tenantId) })
  const second = await call('POST', `${app}/api/billing/checkout`, { headers: free.cookie, body: { planId: 'plan_us_pro', interval: 'monthly' } })
  check('a second Checkout is refused (409 ALREADY_SUBSCRIBED): one business, one subscription', second.status === 409 && second.json?.error?.code === 'ALREADY_SUBSCRIBED', second.json)

  // The webhook now arrives (late). It stores the same thing.
  const firstDelivery = await deliverUntil(free.tenantId, (row) => row?.status === 'active' && delivered.size > 0)
  check('the webhook events for the purchase are accepted (200 each)', firstDelivery.events.includes('checkout.session.completed') && firstDelivery.refused === 0, firstDelivery.events)
  // T-201: the free-quotes email says a saved request "is priced when you pick a plan". The purchase event does it.
  const heldAfterPurchase = (await sb.select('quotes', `id=eq.${freeHeld[0]!.id}&select=status,content_json`)) as Row[]
  check('T-201: the purchase prices the lead held at 10 of 10 by itself: sent for pricing, and counted as the 11th of 50', heldAfterPurchase[0]?.status === 'queued' && (heldAfterPurchase[0]?.content_json as Row | null)?.limitHold !== true && (await heldQuotes(free.tenantId)).length === 0 && (await usedTotal(free.tenantId)) === 11, { status: heldAfterPurchase[0]?.status, used: await usedTotal(free.tenantId) })
  const onPlanShare = ((await sb.select('usage_counters', `tenant_id=eq.${free.tenantId}&select=estimates_created,plan_estimates_created`)) as Row[]).reduce((sum, r) => sum + Number(r.plan_estimates_created), 0)
  check('T-201: …counted against the plan, not as an 11th free quote', onPlanShare === 1, onPlanShare)
  const priceHeld = await call('POST', `${app}/api/quotes/${freeHeld[0]!.id}/process`, { headers: free.cookie })
  check('T-201: …and "Price this request" cannot price it a second time (400 NOT_HELD), nor count it twice', priceHeld.status === 400 && priceHeld.json?.error?.code === 'NOT_HELD' && (await usedTotal(free.tenantId)) === 11, { status: priceHeld.status, used: await usedTotal(free.tenantId) })
  const rowAfterWebhook = await subscriptionRow(free.tenantId)
  check('…and store the same plan the return had already stored', rowAfterWebhook?.plan_id === 'plan_us_starter' && rowAfterWebhook.status === 'active' && rowAfterWebhook.billing_interval === 'monthly' && rowAfterWebhook.stripe_subscription_id === starterRow?.stripe_subscription_id)

  // The same event twice
  const [repeatId, repeatBody] = [...delivered.entries()].find(([, body]) => (JSON.parse(body) as Row).type === 'checkout.session.completed')!
  const before = JSON.stringify(await subscriptionRow(free.tenantId))
  const repeated = await postEvent(repeatBody)
  const ledgerRows = (await sb.select('stripe_events', `id=eq.${repeatId}&select=id,processed_at`)) as Row[]
  check('the same webhook event sent twice changes nothing: answered 200 "duplicate", the row identical to the last write', repeated.status === 200 && repeated.json?.duplicate === true && JSON.stringify(await subscriptionRow(free.tenantId)) === before && ledgerRows.length === 1 && ledgerRows[0]!.processed_at !== null, repeated.json)

  // Upgrade
  const up = await switchPlan(free, `${PRODUCT_NAME} Pro`, 'month')
  const upgraded = await deliverUntil(free.tenantId, (row) => row?.plan_id === 'plan_us_pro')
  check('upgrade to Pro in the portal: the webhook updates the plan', upgraded.row?.plan_id === 'plan_us_pro' && upgraded.row.billing_interval === 'monthly' && upgraded.row.status === 'active' && upgraded.events.includes('customer.subscription.updated'), { plan: upgraded.row?.plan_id, events: upgraded.events })
  check('…the portal offered Starter and Pro only (Business is off the site), and charged the difference at once', up.offered.join(',') === `${PRODUCT_NAME} Starter,${PRODUCT_NAME} Pro` && /Amount due today/i.test(up.review), { offered: up.offered, review: up.review.slice(0, 200) })
  const proBilling = await billing(free)
  check('…the limit is Pro\'s 200 a month, and WhatsApp is now part of the plan', proBilling.usage.planLimit === 200 && (await whatsappAccess(free)).allowed === true, proBilling.usage)

  // Yearly
  await switchPlan(free, `${PRODUCT_NAME} Pro`, 'year')
  const yearly = await deliverUntil(free.tenantId, (row) => row?.billing_interval === 'annual')
  const yearEnd = new Date(String(yearly.row?.current_period_end)).getTime()
  check('switch to yearly in the portal: the webhook stores "annual", and the period now ends a year out', yearly.row?.plan_id === 'plan_us_pro' && yearly.row.billing_interval === 'annual' && yearEnd - Date.now() > 300 * 86_400_000, { interval: yearly.row?.billing_interval, end: yearly.row?.current_period_end })
  const yearlyBilling = await billing(free)
  check('…the billing data says Pro, yearly, $990 a year, still 200 quotes a month', yearlyBilling.subscription.interval === 'annual' && (yearlyBilling.subscription.plan as Row).annualPriceCents === 99000 && yearlyBilling.usage.planLimit === 200)

  // Downgrade: asked for now, takes effect when the paid period ends (the owner's rule)
  const downAsk = await switchPlan(free, `${PRODUCT_NAME} Starter`, 'month')
  const held1 = await pendingChange(String(starterRow?.stripe_subscription_id))
  const down = await deliverUntil(free.tenantId, () => false, 8_000)
  const afterAsk = await subscriptionRow(free.tenantId)
  check('downgrade to Starter monthly in the portal: Stripe says it happens at the end of the billing period, and charges nothing now', /updated at the end of your current billing period/i.test(downAsk.review) && !/Amount due today/i.test(downAsk.review), downAsk.review.slice(0, 260))
  check('…nothing changes now: still Pro, yearly, 200 quotes a month, WhatsApp still on', afterAsk?.plan_id === 'plan_us_pro' && afterAsk.billing_interval === 'annual' && afterAsk.status === 'active' && (await billing(free)).usage.planLimit === 200 && (await whatsappAccess(free)).allowed === true, { plan: afterAsk?.plan_id, interval: afterAsk?.billing_interval })
  check('…Stripe holds the change: Starter monthly, starting the moment the paid year ends', held1.price === priceOf('plan_us_starter', 'monthly') && held1.startsAt !== null && held1.startsAt === held1.periodEnd, held1)
  const waitingG = await waitingChange(free)
  check('…the billing page is told what is waiting: Starter, monthly, on the day the paid year ends', waitingG?.planName === 'Starter' && waitingG.interval === 'monthly' && new Date(String(waitingG.at)).getTime() === (held1.periodEnd ?? 0) * 1000, waitingG)
  const waitPage = await signedInPage(free)
  await waitPage.goto(`${app}/app/settings/billing`, { waitUntil: 'networkidle' })
  await waitPage.getByTestId('pending-change').waitFor({ timeout: 30_000 }).catch(() => undefined)
  const waitLine = (await waitPage.getByTestId('pending-change').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('…and says "Changes to Starter on <date>", with Pro still shown as the plan', /^Changes to Starter on [A-Z][a-z]+ \d{1,2}, \d{4}\. Until then your Pro plan works as normal\.$/.test(waitLine) && (await waitPage.getByTestId('current-plan').innerText()).trim() === 'Pro plan, billed yearly', waitLine)
  await waitPage.screenshot({ path: path.join(outDir, 'billing-downgrade-waiting.png'), fullPage: true })
  await waitPage.context().close()

  // Cancel
  const cancelReview = await cancelInPortal(free)
  const cancelled = await deliverUntil(free.tenantId, (row) => Boolean(row?.cancel_at))
  check('cancel in the portal: Stripe says it stays available to the end of the billing period', /still be available until the end of your billing period/i.test(cancelReview), cancelReview.slice(0, 200))
  check('…the webhook stores the end date, and the plan is still live until then', cancelled.row?.status === 'active' && cancelled.row.plan_id === 'plan_us_pro' && new Date(String(cancelled.row.cancel_at)).getTime() > Date.now() + 300 * 86_400_000, { status: cancelled.row?.status, cancel_at: cancelled.row?.cancel_at })
  const afterCancel = await stripe.subscriptions.retrieve(String(starterRow?.stripe_subscription_id))
  check('…cancelling drops the downgrade that was waiting (the plan simply ends), and the page is told nothing is waiting', afterCancel.schedule === null && afterCancel.cancel_at !== null && (await waitingChange(free)) === null)
  const cancelledBilling = await billing(free)
  const stillPriced = await submit(free)
  check('…the billing data carries the end date, and a request is still priced meanwhile', cancelledBilling.subscription.cancelAt === cancelled.row?.cancel_at && cancelledBilling.subscription.cancelAtPeriodEnd === true && (cancelledBilling.subscription.plan as Row).id === 'plan_us_pro' && stillPriced.ok && !held(stillPriced))
  const cancelPage = await signedInPage(free)
  await cancelPage.goto(`${app}/app/settings/billing`, { waitUntil: 'networkidle' })
  await cancelPage.getByTestId('cancel-note').waitFor({ timeout: 30_000 }).catch(() => undefined)
  const cancelNote = (await cancelPage.getByTestId('cancel-note').innerText().catch(() => '')).replace(/\s+/g, ' ')
  check('…the billing page says when it ends and that it works until then', /Your Pro plan ends on [A-Z][a-z]+ \d{1,2}, \d{4}\. It works as normal until then\./.test(cancelNote), cancelNote)
  // T-200: two plans are on offer (Starter and Pro), so two cards
  check('…and each plan card says "plus tax" beside its price', (await cancelPage.getByTestId('plus-tax').count()) === 2 &&(await cancelPage.getByTestId('plus-tax').allInnerTexts()).every((text) => text.trim() === 'plus tax'))
  await cancelPage.screenshot({ path: path.join(outDir, 'billing-cancelled.png'), fullPage: true })
  await cancelPage.context().close()
  check('every webhook event of the journey was accepted', [firstDelivery, upgraded, yearly, down, cancelled].every((d) => d.refused === 0))

  // ===================================================================================
  section('H. A card declined at Checkout')
  // ===================================================================================
  const decliner = await business('Declined Card Co')
  ourTenants.add(decliner.tenantId)
  const declined = await checkout(decliner, 'plan_us_pro', 'monthly', TEST_CARD.declined)
  check('Stripe\'s page says the card was declined and stays on Checkout', declined.outcome === 'declined' && /declin/i.test(declined.message), { outcome: declined.outcome, message: declined.message })
  await declined.page.context().close()
  await sleep(4000)
  await deliver()
  // Checkout makes the Stripe customer when the card is tried, even though nothing was bought: remove it at the end
  for (const c of (await stripe.customers.list({ email: decliner.email, limit: 10 })).data) stripeCustomers.add(c.id)
  const declinedBilling = await billing(decliner)
  check('nothing was bought: no subscription row, no plan, still on the free allowance, Checkout still offered', (await subscriptionRow(decliner.tenantId)) === null && declinedBilling.subscription.plan === null && declinedBilling.subscription.status === 'none' && declinedBilling.usage.per === 'total' && declinedBilling.canCheckout === true && (await notice(decliner)) === null, declinedBilling.subscription)

  // ===================================================================================
  section('I. A renewal that fails, then succeeds; a downgrade that lands at the period end; then cancel, and the paid period ends')
  // ===================================================================================
  const retry = await clockBusiness('Renewal Retry Co')
  const retryPaid = await checkout(retry.b, 'plan_us_pro', 'monthly', TEST_CARD.good)
  check('a returning business pays for Pro with its existing Stripe customer', retryPaid.outcome === 'paid', retryPaid.message)
  await retryPaid.page.getByTestId('current-plan').waitFor({ timeout: 60_000 }).catch(() => undefined)
  await retryPaid.page.context().close()
  const retryStart = await deliverUntil(retry.b.tenantId, (row) => row?.status === 'active' && row.plan_id === 'plan_us_pro')
  check('…and is on Pro, with the same customer (not a second one)', retryStart.row?.plan_id === 'plan_us_pro' && retryStart.row.stripe_customer_id === retry.customer, retryStart.row?.stripe_customer_id === retry.customer)
  await changeCard(retry.b, TEST_CARD.failsLater)
  check('its card is changed in the portal to one that will be refused at renewal', (await subscriptionCard(retry.customer)) === '0341', await subscriptionCard(retry.customer))

  await advance(retry.clock, 31)
  const failedRenewal = await deliverUntil(retry.b.tenantId, (row) => row?.status === 'past_due')
  check('the renewal fails: Stripe marks the subscription past due and the webhook stores it', failedRenewal.row?.status === 'past_due' && failedRenewal.row.payment_failed_at !== null && failedRenewal.events.includes('invoice.payment_failed'), { status: failedRenewal.row?.status, events: failedRenewal.events })
  const failNotice = await notice(retry.b)
  check(`every dashboard page gets the notice "${PAYMENT_FAILED_LINE}" with a way to the portal`, failNotice?.kind === 'payment_failed' && failNotice.line === PAYMENT_FAILED_LINE && failNotice.action === 'portal', failNotice)
  const dash = await signedInPage(retry.b)
  const shown: string[] = []
  for (const route of ['/app', '/app/quotes', '/app/services', '/app/settings', '/app/settings/billing']) {
    await dash.goto(`${app}${route}`, { waitUntil: 'networkidle' })
    const banner = dash.getByTestId('account-notice')
    await banner.waitFor({ timeout: 20_000 }).catch(() => undefined)
    if ((await banner.count()) && (await banner.innerText()).includes(PAYMENT_FAILED_LINE)) shown.push(route)
  }
  check('…shown on Home, Quotes, Prices, Settings and Billing', shown.length === 5, shown)
  await dash.screenshot({ path: path.join(outDir, 'payment-failed-banner.png'), fullPage: true })
  await dash.getByTestId('account-notice-action').click()
  await dash.waitForURL(/billing\.stripe\.com/, { timeout: 30_000 }).catch(() => undefined)
  check('…its button opens Stripe\'s portal', /billing\.stripe\.com/.test(dash.url()), dash.url().slice(0, 40))
  await dash.context().close()
  const failMail = (await waitForMail(retry.b.email, 'payment-failed'))[0]
  check('one email: "Your payment didn\'t go through", with the line and a button to the billing page', mailTo(retry.b.email, 'payment-failed').length === 1 && failMail?.Subject === "Your payment didn't go through" && (failMail.HtmlBody ?? '').includes('Update your card to keep your quotes running.') && (failMail.HtmlBody ?? '').includes('/app/settings/billing'), failMail?.Subject)
  const duringRetry = await submit(retry.b)
  const retryBilling = await billing(retry.b)
  check('everything keeps working while Stripe retries: the plan is still Pro, a request is priced, WhatsApp stays on', (retryBilling.subscription.plan as Row | null)?.id === 'plan_us_pro' && retryBilling.subscription.paymentFailed === true && duringRetry.ok && !held(duringRetry) && (await whatsappAccess(retry.b)).allowed === true, { plan: (retryBilling.subscription.plan as Row | null)?.id, held: held(duringRetry) })

  await advance(retry.clock, 2)
  await deliverUntil(retry.b.tenantId, () => false, 12_000)
  const secondAttempt = (await stripe.invoices.list({ customer: retry.customer, limit: 1 })).data[0]
  check('Stripe retries (a second attempt fails); still one email, still past due, still working', (secondAttempt?.attempt_count ?? 0) >= 2 && mailTo(retry.b.email, 'payment-failed').length === 1 && (await subscriptionRow(retry.b.tenantId))?.status === 'past_due', { attempts: secondAttempt?.attempt_count, mails: mailTo(retry.b.email, 'payment-failed').length })

  await changeCard(retry.b, TEST_CARD.good)
  let recovered = await deliverUntil(retry.b.tenantId, (row) => row?.status === 'active', 20_000)
  if (recovered.row?.status !== 'active') {
    // the new card is charged at Stripe's next retry
    await advance(retry.clock, 7)
    recovered = await deliverUntil(retry.b.tenantId, (row) => row?.status === 'active')
  }
  check('the card is fixed and the payment goes through: active again, the failure cleared', recovered.row?.status === 'active' && recovered.row.payment_failed_at === null && recovered.row.payment_failed_notified_at === null && recovered.row.plan_id === 'plan_us_pro', { status: recovered.row?.status, events: recovered.events })
  check('…the notice is gone and no further email was sent', (await notice(retry.b)) === null && mailTo(retry.b.email, 'payment-failed').length === 1)

  // A downgrade lands at the end of the paid period (the owner's rule), seen through to the day
  const retrySubscription = String(recovered.row?.stripe_subscription_id)
  const askDown = await switchPlan(retry.b, `${PRODUCT_NAME} Starter`, 'month')
  const waiting = await pendingChange(retrySubscription)
  await deliverUntil(retry.b.tenantId, () => false, 8_000)
  const meanwhile = await submit(retry.b)
  const proMeanwhile = await subscriptionRow(retry.b.tenantId)
  check('a downgrade to Starter is asked for: Stripe holds it for the end of the paid period, and until then the business is on Pro', /updated at the end of your current billing period/i.test(askDown.review) && waiting.price === priceOf('plan_us_starter', 'monthly') && proMeanwhile?.plan_id === 'plan_us_pro' && (await billing(retry.b)).usage.planLimit === 200 && meanwhile.ok && !held(meanwhile), { review: askDown.review.slice(0, 160), waiting, plan: proMeanwhile?.plan_id })
  const waitingI = await waitingChange(retry.b)
  check('…the billing page is told: changes to Starter on the day the paid period ends', waitingI?.planName === 'Starter' && new Date(String(waitingI.at)).getTime() === (waiting.periodEnd ?? 0) * 1000, waitingI)
  const toPeriodEnd = Math.ceil(((waiting.periodEnd ?? 0) - (await stripe.testHelpers.testClocks.retrieve(retry.clock)).frozen_time) / 86_400) + 1
  await advance(retry.clock, toPeriodEnd)
  const landedDown = await deliverUntil(retry.b.tenantId, (row) => row?.plan_id === 'plan_us_starter')
  const starterRenewal = (await stripe.invoices.list({ customer: retry.customer, limit: 1 })).data[0]
  check('the paid period ends: the plan becomes Starter by webhook, and the renewal is charged at Starter\'s price', landedDown.row?.plan_id === 'plan_us_starter' && landedDown.row.billing_interval === 'monthly' && landedDown.row.status === 'active' && starterRenewal?.subtotal === 4900 && starterRenewal.status === 'paid' && (await billing(retry.b)).usage.planLimit === 50, { plan: landedDown.row?.plan_id, renewal: starterRenewal?.subtotal, events: landedDown.events })
  check('…Starter has no WhatsApp, so the assistant is off from then (the plan definitions decide), and nothing is waiting any more', (await whatsappAccess(retry.b)).why === 'plan' && (await waitingChange(retry.b)) === null)

  await cancelInPortal(retry.b)
  const retryCancelled = await deliverUntil(retry.b.tenantId, (row) => Boolean(row?.cancel_at))
  const untilEnd = Math.ceil((new Date(String(retryCancelled.row?.cancel_at)).getTime() / 1000 - (await stripe.testHelpers.testClocks.retrieve(retry.clock)).frozen_time) / 86_400) + 1
  const beforeEnd = await submit(retry.b)
  check('it cancels: the plan works until the end of the paid period', retryCancelled.row?.status === 'active' && beforeEnd.ok && !held(beforeEnd), { cancel_at: retryCancelled.row?.cancel_at })
  await advance(retry.clock, untilEnd)
  const ended = await deliverUntil(retry.b.tenantId, (row) => row?.status === 'canceled')
  check('the paid period ends: Stripe ends the subscription and the webhook stores "no plan", keeping the customer', ended.row?.status === 'canceled' && ended.row.stripe_subscription_id === null && ended.row.stripe_customer_id === retry.customer && ended.row.cancel_at === null && ended.events.includes('customer.subscription.deleted'), { status: ended.row?.status, events: ended.events })
  const endedBilling = await billing(retry.b)
  check('…the billing data is back to "no plan" (it names the plan that ended) and offers Checkout again', endedBilling.subscription.plan === null && endedBilling.subscription.endedPlanName === 'Starter' && endedBilling.canCheckout === true && endedBilling.usage.per === 'total', endedBilling.subscription)
  const afterEnd = await submit(retry.b)
  check('…a new request is held, not lost', afterEnd.ok && held(afterEnd) && (await heldQuotes(retry.b.tenantId)).length === 1, afterEnd.json?.status)
  check('…and the WhatsApp assistant is silent', (await whatsappAccess(retry.b)).allowed === false)

  // ===================================================================================
  section('J. A renewal that fails until Stripe gives up')
  // ===================================================================================
  const lapse = await clockBusiness('Renewal Lapse Co')
  const lapsePaid = await checkout(lapse.b, 'plan_us_pro', 'monthly', TEST_CARD.good)
  await lapsePaid.page.getByTestId('current-plan').waitFor({ timeout: 60_000 }).catch(() => undefined)
  await lapsePaid.page.context().close()
  await deliverUntil(lapse.b.tenantId, (row) => row?.status === 'active' && row.plan_id === 'plan_us_pro')
  await changeCard(lapse.b, TEST_CARD.failsLater)
  check('a business on Pro, its card one that will be refused', lapsePaid.outcome === 'paid' && (await subscriptionCard(lapse.customer)) === '0341')
  await advance(lapse.clock, 31)
  const lapseFailed = await deliverUntil(lapse.b.tenantId, (row) => row?.status === 'past_due')
  const lapseDuring = await submit(lapse.b)
  check('the renewal fails: past due, the plan still working (a request is priced)', lapseFailed.row?.status === 'past_due' && lapseDuring.ok && !held(lapseDuring))
  let gaveUp = lapseFailed
  for (const days of [2, 7, 7, 7]) {
    if (gaveUp.row?.status === 'canceled') break
    await advance(lapse.clock, days)
    gaveUp = await deliverUntil(lapse.b.tenantId, (row) => row?.status === 'canceled', 15_000)
  }
  const finalStripe = (await stripe.subscriptions.list({ customer: lapse.customer, status: 'all', limit: 1 })).data[0]
  const attempts = (await stripe.invoices.list({ customer: lapse.customer, limit: 1 })).data[0]?.attempt_count
  console.log(`   Stripe tried the card ${attempts} times and then set the subscription to "${finalStripe?.status}".`)
  check('Stripe gives up (unpaid or cancelled): the webhook stores "no plan"', ['canceled', 'unpaid'].includes(String(finalStripe?.status)) && gaveUp.row?.status === 'canceled' && gaveUp.row.payment_failed_at === null, { stripe: finalStripe?.status, ours: gaveUp.row?.status })
  const lapsedRequest = await submit(lapse.b)
  check('from then a request is held, never lost', lapsedRequest.ok && held(lapsedRequest) && (await heldQuotes(lapse.b.tenantId)).length === 1, lapsedRequest.json?.status)
  check('…the WhatsApp assistant is silent, and the payment notice is gone (there is no payment to fix: the plan has ended)', (await whatsappAccess(lapse.b)).allowed === false && (await notice(lapse.b)) === null)
  check('…and through every failed attempt the business got one email, not one per attempt', mailTo(lapse.b.email, 'payment-failed').length === 1, mailTo(lapse.b.email, 'payment-failed').length)
  const lapsedBilling = await billing(lapse.b)
  check('…the billing data says no plan and offers Checkout, so the business can start again', lapsedBilling.subscription.plan === null && lapsedBilling.canCheckout === true && lapsedBilling.subscription.endedPlanName === 'Pro')
} catch (error) {
  check('the browser journey ran to the end', false, error instanceof Error ? error.message.slice(0, 400) : String(error))
} finally {
  await browser.close()
}

check('no email went anywhere but this script\'s stand-in, and none carries a card number or a key', mails.every((m) => !/4242|sk_test_|whsec_/.test(`${m.Subject} ${m.HtmlBody ?? ''}`)))
await finish()
