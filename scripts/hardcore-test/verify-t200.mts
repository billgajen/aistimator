// T-200 check, Part B (the small fixes), against the real server (local stack). No model is asked,
// no email is sent, no browser is used, and nothing here touches production.
//
// What it proves:
//   A. Business is not offered: the Pricing page has two plan cards (Starter and Pro), the billing
//      page's plans are those two for a business with no plan, Checkout refuses Business, and a
//      business that already holds Business still sees it, as its current plan
//   B. saving "Quote Template" (Settings → Business) keeps customer acceptance as the business set
//      it on the Branding tab, off or on, and still saves its own four fields
//   C. Ask Qolumns asks a one-word question back: our one line, two or three choices that are
//      questions, no row written, so the day's count does not move
//   D. the log-in page is the form alone; the sign-up page is as it was
//
// Part A of T-200 (the Android app) has no server side to check here: it is unit tests
// (apps/mobile/src/__tests__/android-t200.test.ts) and the owner's phone.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t200.mts   (web app on 3000; no worker needed)
import { loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, shortId } from './lib.mjs'
import { ASK_CLARIFY, ASK_CLARIFY_MAX, ASK_CLARIFY_MIN, ASK_COPY } from '../../packages/shared/src/help-ask'
import { offeredPlans } from '../../packages/shared/src/plans'

type Row = Record<string, unknown>
const cfg = loadEnv()
if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(cfg.supabaseUrl)) {
  console.error('This check runs on the local stack only.')
  process.exit(2)
}
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const checks: Array<{ name: string; pass: boolean }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${!pass && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const rows = async (table: string, query: string) => (await sb.select(table, query)) as Row[]

/** A business that has finished sign-up, with its session cookie */
async function business(label: string) {
  const id = shortId()
  const email = `owner+t200-${label}-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const name = `Harlow ${label} ${id}`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok && setup.json?.tenantId ? setup.json.tenantId : (await rows('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0]?.tenant_id) as string
  expectOk(`${label} region`, await http('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  return { cookie, tenantId }
}

// ---------------------------------------------------------------------------
section('A. Business is not offered')
const names = offeredPlans().map((p) => p.name)
check('the plans on offer are Starter and Pro', JSON.stringify(names) === JSON.stringify(['Starter', 'Pro']), names)

const pricing = await http('GET', `${app}/pricing`)
const cards = pricing.text.match(/data-testid="plan-card"/g) ?? []
check('Pricing shows two plan cards', pricing.ok && cards.length === 2, { status: pricing.status, cards: cards.length })
check('Pricing does not offer Business ($199 is nowhere on it)', !/\$\s?199\b/.test(pricing.text) && !/>Business<\/h\d>/.test(pricing.text))

const plain = await business('plain')
const billing = expectOk('billing', await http('GET', `${app}/api/billing`, { headers: plain.cookie })) as { availablePlans: Array<{ id: string; name: string }> }
check('the billing page offers a business with no plan Starter and Pro only', JSON.stringify(billing.availablePlans.map((p) => p.name)) === JSON.stringify(['Starter', 'Pro']), billing.availablePlans.map((p) => p.name))
const checkout = await http('POST', `${app}/api/billing/checkout`, { headers: plain.cookie, body: { planId: 'plan_us_business', interval: 'month' } })
check('Checkout refuses Business', checkout.status === 404 && checkout.json?.error?.code === 'PLAN_NOT_FOUND', [checkout.status, checkout.json?.error?.code])

// a business that already holds Business (a free test row: no Stripe customer, so nothing is billed)
const holder = await business('holder')
await sb.insert('subscriptions', { tenant_id: holder.tenantId, plan_id: 'plan_us_business', status: 'active', stripe_customer_id: null, stripe_subscription_id: null })
const held = expectOk('holder billing', await http('GET', `${app}/api/billing`, { headers: holder.cookie })) as { subscription: { plan?: { id?: string; name?: string } } | null; availablePlans: Array<{ id: string; name: string }> }
check('a business on Business keeps it: its billing page names it as its plan', held.subscription?.plan?.name === 'Business', held.subscription?.plan)
check('…and shows it after the two on offer', JSON.stringify(held.availablePlans.map((p) => p.name)) === JSON.stringify(['Starter', 'Pro', 'Business']), held.availablePlans.map((p) => p.name))

// ---------------------------------------------------------------------------
section('B. Saving "Quote Template" keeps customer acceptance as it was set')
const stored = async () => ((await rows('tenants', `id=eq.${plain.tenantId}&select=template_json`))[0]?.template_json ?? {}) as Row
const saveTemplate = (templateJson: Row) => http('PUT', `${app}/api/tenant`, { headers: plain.cookie, body: { templateJson } })

expectOk('acceptance off (Branding)', await http('PUT', `${app}/api/tenant/branding`, { headers: plain.cookie, body: { template: { acceptQuoteEnabled: false } } }))
check('the Branding tab switches acceptance off', (await stored()).acceptQuoteEnabled === false, await stored())
expectOk('save Quote Template', await saveTemplate({ showLineItems: false, includeAssumptions: true, includeExclusions: false, validityDays: 21 }))
const afterOff = await stored()
check('after saving Quote Template, acceptance is still off', afterOff.acceptQuoteEnabled === false, afterOff)
check('…and the Quote Template save took its own four fields', afterOff.showLineItems === false && afterOff.includeAssumptions === true && afterOff.includeExclusions === false && afterOff.validityDays === 21, afterOff)

expectOk('acceptance on (Branding)', await http('PUT', `${app}/api/tenant/branding`, { headers: plain.cookie, body: { template: { acceptQuoteEnabled: true } } }))
expectOk('save Quote Template again', await saveTemplate({ validityDays: 30 }))
const afterOn = await stored()
check('switched on, it stays on after a save too', afterOn.acceptQuoteEnabled === true && afterOn.validityDays === 30, afterOn)
check('…and a save of one field leaves the other three as they were', afterOn.showLineItems === false && afterOn.includeExclusions === false, afterOn)

// ---------------------------------------------------------------------------
section('C. Ask Qolumns asks a one-word question back')
const asked = async () => (await rows('help_questions', `tenant_id=eq.${plain.tenantId}&select=id`)).length
const before = await asked()
const reply = await http('POST', `${app}/api/support/ask`, { headers: plain.cookie, body: { question: 'WhatsApp', page: '/app' } })
const done = reply.text
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try {
      return JSON.parse(line) as { t: string; id?: string | null; outcome?: string; text?: string; rate?: boolean; actions?: Array<{ kind: string; label: string }> }
    } catch {
      return null
    }
  })
  .find((event) => event?.t === 'done')
check('one word is asked back, not answered', reply.ok && done?.outcome === ASK_CLARIFY, { status: reply.status, done })
check('in our one line', done?.text === ASK_COPY.clarify, done?.text)
const choices = (done?.actions ?? []).filter((a) => a.kind === 'ask')
check('with two or three choices, each a question', choices.length >= ASK_CLARIFY_MIN && choices.length <= ASK_CLARIFY_MAX && choices.every((c) => c.label.trim().length > 8), choices)
check('nothing else is offered with it: no page to open, no rating', (done?.actions ?? []).length === choices.length && done?.rate === false && done?.id === null, done)
check('it is not kept, so the day’s count has not moved', (await asked()) === before, { before, after: await asked() })

// ---------------------------------------------------------------------------
section('D. The log-in page is the form alone')
const login = await http('GET', `${app}/login`)
check('log-in has its form', login.ok && /<form/.test(login.text) && /type="password"/.test(login.text), login.status)
check('…and no sample estimate beside it', !/data-testid="estimate-total"/.test(login.text) && !/EST-2026-0142/.test(login.text))
const signup = await http('GET', `${app}/signup`)
check('sign-up is as it was: its form, and no sample estimate (it never had one)', signup.ok && /<form/.test(signup.text) && !/data-testid="estimate-total"/.test(signup.text), signup.status)

const failed = checks.filter((c) => !c.pass)
// the runner reads this line ("20/20 pass")
console.log(`\n${checks.length - failed.length}/${checks.length} pass`)
if (failed.length) {
  console.log('Failed:')
  for (const f of failed) console.log(`  - ${f.name}`)
}
process.exit(failed.length ? 1 : 0)
