// T-180: set up Stripe for the plans, from packages/shared/src/plans.ts.
// One script for the SANDBOX (now) and for LIVE (later, run by the owner).
//
//   Sandbox:  cd apps/web && npx tsx scripts/stripe-setup-plans.mts
//             (reads STRIPE_SECRET_KEY from the environment, else from apps/web/.env.local)
//             add --write-env to put the printed STRIPE_PRICE_* lines into apps/web/.env.local
//   Live:     cd apps/web && npx tsx scripts/stripe-setup-plans.mts --live
//             (asks for the live secret key without showing it, shows the account it
//              belongs to, and asks you to type the account's name before it creates anything)
//   Either:   add --dry-run to see what it would do and change nothing.
//
// What it makes sure exists (it can be run again and again; it creates only what is missing):
//   1. A product for each plan on offer: "Qolumns Starter", "Qolumns Pro", "Qolumns Business",
//      each with the tax code Managed Payments needs for software sold to businesses.
//   2. A monthly and a yearly USD price for each, at the amounts in plans.ts. No trial (AD-047).
//      Business gets its prices too, but is not offered in the portal (it is off the site).
//   3. The customer portal: switch between the plans the site shows, monthly or yearly. An
//      upgrade takes effect at once and the difference is charged then. A downgrade (a cheaper
//      plan, or yearly to monthly) takes effect at the end of the period already paid for.
//      Cancel at the end of the paid period; change the card; see past invoices.
//   4. One webhook endpoint, for exactly the events the code handles (lib/stripe-events.ts).
//      In the sandbox it is created switched OFF: it points at the live site, which would
//      refuse sandbox events (they are signed with a different secret).
// Then it prints the STRIPE_PRICE_* lines for Vercel. Price ids are not secret.
//
// It never prints a key or a signing secret. The webhook's signing secret is read from the
// Stripe dashboard (Developers, Webhooks, the endpoint, "Signing secret") and goes into
// Vercel as STRIPE_WEBHOOK_SECRET.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'
import { offeredPlans, stripePriceEnvKey, type PlanDefinition, type PlanInterval } from '../../../packages/shared/src/plans'
import { PRODUCT_NAME } from '../../../packages/shared/src/brand'
import { sitePlans } from '../src/lib/marketing/plan-claims'
import { STRIPE_WEBHOOK_EVENTS, STRIPE_WEBHOOK_PATH } from '../src/lib/stripe-events'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENV_FILE = path.join(HERE, '..', '.env.local')
const SITE = 'https://qolumns.com'
/** Software as a service, business use: on Managed Payments' list of eligible tax codes */
const TAX_CODE = 'txcd_10103001'
const CURRENCY = 'USD'
/** The retired sandbox: never set anything up in it */
const RETIRED_ACCOUNT = /new business/i

// A refusal is one plain line, not a stack trace
process.on('uncaughtException', (error) => {
  console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

const args = new Set(process.argv.slice(2))
const LIVE = args.has('--live')
const DRY = args.has('--dry-run')
const WRITE_ENV = args.has('--write-env')
const say = (line = '') => console.log(line)
const did = (made: boolean, what: string) => say(`  ${DRY && made ? 'would create' : made ? 'created' : 'exists '}  ${what}`)

function fromEnvFile(name: string): string | undefined {
  if (!existsSync(ENV_FILE)) return undefined
  const match = readFileSync(ENV_FILE, 'utf8').match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'))
  return match?.[1]?.trim()
}

/** Ask a question; with `hidden`, what is typed is not shown */
function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const out = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WritableStream }
    if (hidden) {
      out._writeToOutput = (text: string) => {
        if (text.includes(question)) out.output.write(text)
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

// ---------- which account ----------
let key: string | undefined
if (LIVE) {
  key = process.env.STRIPE_LIVE_SECRET_KEY?.trim() || (await ask('Live secret key (not shown as you type): ', true))
  if (!/^(sk|rk)_live_/.test(key)) throw new Error('That is not a live key. Nothing was done.')
} else {
  key = process.env.STRIPE_SECRET_KEY?.trim() || fromEnvFile('STRIPE_SECRET_KEY')
  if (!key) throw new Error('No sandbox key: set STRIPE_SECRET_KEY or put it in apps/web/.env.local')
  if (!key.startsWith('sk_test_')) throw new Error('The key is not a sandbox key. For the live account run with --live. Nothing was done.')
}
const stripe = new Stripe(key)
const account = await stripe.accounts.retrieve()
const accountName = account.settings?.dashboard?.display_name || account.business_profile?.name || account.id
say(`Stripe account: "${accountName}" (${LIVE ? 'LIVE' : 'sandbox'}, ${account.country}), statement descriptor "${account.settings?.payments?.statement_descriptor ?? 'not set'}"`)
if (RETIRED_ACCOUNT.test(accountName)) throw new Error(`This is the retired sandbox. Use the ${PRODUCT_NAME} sandbox key. Nothing was done.`)
if (!new RegExp(PRODUCT_NAME, 'i').test(accountName)) throw new Error(`This account is not named ${PRODUCT_NAME}. Nothing was done.`)
if (LIVE && !DRY) {
  say('\nThis creates REAL products, prices, portal settings and a webhook in the live account.')
  say('It charges nobody: a charge only happens when a business buys a plan.')
  const typed = await ask(`Type the account's name (${accountName}) to go ahead: `)
  if (typed !== accountName) throw new Error('The name did not match. Nothing was done.')
}

// ---------- 1 and 2. products and prices ----------
say('\nProducts and prices')
const existingProducts = new Map<string, Stripe.Product>()
for await (const product of stripe.products.list({ limit: 100, active: true })) {
  const planId = product.metadata?.plan_id
  if (planId && !existingProducts.has(planId)) existingProducts.set(planId, product)
}

const envLines: string[] = []
const priceIds = new Map<string, Partial<Record<PlanInterval, string>>>()
const productIds = new Map<string, string>()

for (const plan of offeredPlans()) {
  const name = `${PRODUCT_NAME} ${plan.name}`
  let product = existingProducts.get(plan.id)
  if (!product) {
    did(true, `product ${name}`)
    if (!DRY) product = await stripe.products.create({ name, tax_code: TAX_CODE, metadata: { plan_id: plan.id } })
  } else {
    did(false, `product ${name}`)
    const taxCode = typeof product.tax_code === 'string' ? product.tax_code : product.tax_code?.id
    if (product.name !== name || taxCode !== TAX_CODE) {
      say(`           its name or tax code differs; ${DRY ? 'would correct' : 'correcting'} it`)
      if (!DRY) product = await stripe.products.update(product.id, { name, tax_code: TAX_CODE })
    }
  }
  if (product) productIds.set(plan.id, product.id)

  const variants: Array<[PlanInterval, number | undefined]> = [
    ['monthly', plan.monthlyPrice[CURRENCY]],
    ['annual', plan.annualPrice?.[CURRENCY]],
  ]
  for (const [interval, amount] of variants) {
    if (!amount) continue
    const lookupKey = `${plan.id}_${interval}_${CURRENCY.toLowerCase()}`
    const stripeInterval = interval === 'annual' ? 'year' : 'month'
    const label = `${name} ${interval} $${(amount / 100).toFixed(0)}`
    const found = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]
    let price = found
    if (found) {
      // A price cannot be edited. One that no longer matches plans.ts is a decision, not a repair.
      if (found.unit_amount !== amount || found.recurring?.interval !== stripeInterval || found.currency !== CURRENCY.toLowerCase() || found.recurring?.trial_period_days) {
        throw new Error(`The price ${lookupKey} in Stripe (${found.unit_amount} ${found.currency} per ${found.recurring?.interval}) does not match plans.ts (${amount} ${CURRENCY} per ${stripeInterval}). Stopped: decide which is right.`)
      }
      did(false, `price   ${label}  ${found.id}`)
    } else if (DRY || !product) {
      did(true, `price   ${label}`)
    } else {
      price = await stripe.prices.create({
        product: product.id,
        currency: CURRENCY.toLowerCase(),
        unit_amount: amount,
        // no trial on any price (AD-047): a plan is paid from the day it is chosen
        recurring: { interval: stripeInterval },
        lookup_key: lookupKey,
        nickname: `${plan.name} ${interval}`,
        metadata: { plan_id: plan.id, interval },
      })
      did(true, `price   ${label}  ${price.id}`)
    }
    if (price) {
      priceIds.set(plan.id, { ...priceIds.get(plan.id), [interval]: price.id })
      envLines.push(`${stripePriceEnvKey(plan.id, interval, CURRENCY)}=${price.id}`)
    }
  }
}

// ---------- 3. the customer portal ----------
say('\nCustomer portal')
const portalPlans: PlanDefinition[] = sitePlans()
say(`  plans a customer can switch between: ${portalPlans.map((p) => p.name).join(', ')}`)
const portalProducts = portalPlans
  .map((plan) => ({ product: productIds.get(plan.id), prices: Object.values(priceIds.get(plan.id) ?? {}).filter((id): id is string => Boolean(id)) }))
  .filter((entry): entry is { product: string; prices: string[] } => Boolean(entry.product) && entry.prices.length > 0)

const portalFeatures: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  // the business's own details are changed in our Settings, and its tax details with Stripe at checkout
  customer_update: { enabled: false },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  // the plan works to the end of the period that was paid for
  subscription_cancel: { enabled: true, mode: 'at_period_end' },
  subscription_update: {
    enabled: true,
    default_allowed_updates: ['price'],
    // An UPGRADE takes effect at once, with proration: the difference is charged when the plan changes
    proration_behavior: 'always_invoice',
    // A DOWNGRADE waits for the end of the period already paid for (owner, T-180): a cheaper price, or
    // a shorter interval (yearly to monthly). Stripe keeps the current plan until then and renews at
    // the new one. Tried in the sandbox between Starter and Pro on a Managed Payments subscription.
    schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },
    products: portalProducts,
  },
}
const portalProfile = {
  headline: `Manage your ${PRODUCT_NAME} plan`,
  privacy_policy_url: `${SITE}/privacy`,
  terms_of_service_url: `${SITE}/terms`,
}
if (DRY || portalProducts.length === 0) {
  say(`  ${DRY ? 'would set' : 'NOT set (no prices yet)'}: switch plan and interval (upgrade at once with proration, downgrade at period end), cancel at period end, update card, invoice history`)
} else {
  let defaultConfiguration: Stripe.BillingPortal.Configuration | undefined
  for await (const configuration of stripe.billingPortal.configurations.list({ limit: 100 })) {
    if (configuration.is_default) defaultConfiguration = configuration
  }
  if (defaultConfiguration) {
    await stripe.billingPortal.configurations.update(defaultConfiguration.id, {
      features: portalFeatures,
      business_profile: portalProfile,
      default_return_url: `${SITE}/app/settings/billing`,
    })
    say(`  updated the default portal settings (${defaultConfiguration.id})`)
  } else {
    const created = await stripe.billingPortal.configurations.create({
      features: portalFeatures,
      business_profile: portalProfile,
      default_return_url: `${SITE}/app/settings/billing`,
    })
    say(`  created the portal settings (${created.id}); the first one made is the default`)
  }
  say('  upgrade: at once, the difference charged then. downgrade: at the end of the paid period.')
  say('  cancel at period end, update card, invoice history')
}

// ---------- 4. the webhook ----------
say('\nWebhook')
const webhookUrl = `${SITE}${STRIPE_WEBHOOK_PATH}`
const events = [...STRIPE_WEBHOOK_EVENTS] as Stripe.WebhookEndpointCreateParams.EnabledEvent[]
let endpoint: Stripe.WebhookEndpoint | undefined
for await (const candidate of stripe.webhookEndpoints.list({ limit: 100 })) {
  if (candidate.url === webhookUrl) endpoint = candidate
}
if (DRY) {
  say(`  would ${endpoint ? 'update' : 'create'} ${webhookUrl} for: ${events.join(', ')}`)
} else if (endpoint) {
  // An endpoint keeps the API version it was made with; one made by this script has the SDK's
  await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: events, disabled: !LIVE })
  say(`  updated ${webhookUrl} (${endpoint.id}), ${LIVE ? 'on' : 'switched off'}`)
} else {
  endpoint = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: events,
    api_version: Stripe.API_VERSION as Stripe.WebhookEndpointCreateParams.ApiVersion,
    description: `${PRODUCT_NAME} billing (T-180)`,
  })
  if (!LIVE) await stripe.webhookEndpoints.update(endpoint.id, { disabled: true })
  say(`  created ${webhookUrl} (${endpoint.id}), ${LIVE ? 'on' : 'switched off'}`)
}
say(`  events: ${events.join(', ')}`)
if (endpoint && endpoint.api_version && endpoint.api_version !== Stripe.API_VERSION) {
  say(`  NOTE: this endpoint sends API version ${endpoint.api_version}; the code expects ${Stripe.API_VERSION}. Delete it in the dashboard and run this again.`)
}
if (LIVE) {
  say('  Its signing secret is NOT printed here. In the Stripe dashboard open Developers, Webhooks, this endpoint,')
  say('  "Signing secret", and put that value in Vercel (Production) as STRIPE_WEBHOOK_SECRET.')
} else {
  say('  Switched off in the sandbox on purpose: it points at the live site, which refuses sandbox events.')
}

// ---------- the lines for Vercel ----------
say(`\n# ${LIVE ? 'Vercel, Production' : 'Sandbox (apps/web/.env.local)'}: the price ids (not secret)`)
say(envLines.join('\n'))

if (WRITE_ENV && !LIVE && !DRY && envLines.length > 0) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
  for (const line of envLines) {
    const name = line.slice(0, line.indexOf('='))
    const pattern = new RegExp(`^${name}=.*$`, 'm')
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n*$/, '\n')}${line}\n`
  }
  writeFileSync(ENV_FILE, text)
  say('\nWrote those lines to apps/web/.env.local. Restart the web app to pick them up.')
}
if (LIVE) say('\nNothing was charged. Next: OWNER-TODO.md, "T-180", the steps after this one.')
