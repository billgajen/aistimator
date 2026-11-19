/**
 * T-180: Stripe live billing (AD-062 Managed Payments, AD-063 the atomic counter).
 * No test here calls Stripe: the sandbox journey is scripts/hardcore-test/verify-t180.mts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FREE_ALLOWANCE,
  LIVE_SUBSCRIPTION_STATUSES,
  PAYMENT_FAILED_LINE,
  PLANS,
  PRODUCT_NAME,
  freeQuotesLeftLine,
  isFreeTestAccount,
  offeredPlans,
  storedSubscriptionStatus,
  subscriptionLive,
} from '@qolumns/shared'
import { checkoutSessionParams } from '@/lib/stripe'
import { decideSync, invoiceSubscriptionId, subscriptionFacts, type StoredSubscription } from '@/lib/billing-sync'
import { claimPlanQuote, maybeWarnFreeQuotesLeft, releasePlanQuote, type PlanLimitStatus } from '@/lib/plan-limits'
import { billingNotice } from '@/lib/billing-notice'
import { freeQuotesLeftEmail, paymentFailedEmail } from '@/lib/billing-emails'
import { whatsappAccessFor } from '@/lib/whatsapp-access'
import { STRIPE_WEBHOOK_EVENTS, isHandledStripeEvent } from '@/lib/stripe-events'
import { PLUS_TAX } from '@/lib/marketing/plan-claims'
import { pendingChangeLine, pendingPlanChange } from '@/lib/billing-pending'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const PRICE_ENV = {
  STRIPE_PRICE_US_STARTER_MONTHLY_USD: 'price_starter_m',
  STRIPE_PRICE_US_STARTER_ANNUAL_USD: 'price_starter_y',
  STRIPE_PRICE_US_PRO_MONTHLY_USD: 'price_pro_m',
  STRIPE_PRICE_US_PRO_ANNUAL_USD: 'price_pro_y',
}

/** A Stripe subscription as the current API sends it: the period is on the item */
function stripeSubscription(over: Partial<{ id: string; status: string; price: string; start: number; end: number; cancel_at: number | null; cancel_at_period_end: boolean; tenant: string | null; customer: string }> = {}): Stripe.Subscription {
  const o = { id: 'sub_1', status: 'active', price: 'price_pro_m', start: 1_800_000_000, end: 1_802_592_000, cancel_at: null, cancel_at_period_end: false, tenant: 'tnt_a', customer: 'cus_1', ...over }
  return {
    id: o.id,
    status: o.status,
    customer: o.customer,
    cancel_at: o.cancel_at,
    cancel_at_period_end: o.cancel_at_period_end,
    metadata: o.tenant ? { tenant_id: o.tenant } : {},
    items: { data: [{ id: 'si_1', price: { id: o.price }, current_period_start: o.start, current_period_end: o.end }] },
  } as unknown as Stripe.Subscription
}

describe('T-180: one rule for who has a plan', () => {
  it('only active, trialing and a payment being retried keep a plan', () => {
    expect([...LIVE_SUBSCRIPTION_STATUSES]).toEqual(['active', 'trialing', 'past_due'])
    expect(storedSubscriptionStatus('active')).toBe('active')
    expect(storedSubscriptionStatus('trialing')).toBe('trialing')
    expect(storedSubscriptionStatus('past_due')).toBe('past_due')
  })

  it('everything else is "no plan": Stripe gave up, the period ended, or the first payment never went through', () => {
    for (const status of ['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'something_new', '', null, undefined]) {
      expect(storedSubscriptionStatus(status), String(status)).toBe('canceled')
      expect(subscriptionLive(storedSubscriptionStatus(status)), String(status)).toBe(false)
    }
  })

  it('the WhatsApp assistant follows the same grace as the quote limit, and suspension silences it first', () => {
    const pro = { plan_id: 'plan_us_pro' }
    expect(whatsappAccessFor({ ...pro, status: 'active' })).toEqual({ allowed: true })
    expect(whatsappAccessFor({ ...pro, status: 'past_due' })).toEqual({ allowed: true }) // being retried: still on
    expect(whatsappAccessFor({ ...pro, status: storedSubscriptionStatus('unpaid') })).toEqual({ allowed: false, why: 'subscription' })
    expect(whatsappAccessFor({ ...pro, status: 'canceled' })).toEqual({ allowed: false, why: 'subscription' })
    expect(whatsappAccessFor({ ...pro, status: 'active' }, true)).toEqual({ allowed: false, why: 'suspended' })
  })

  it('a free test account is a live row Stripe has never heard of', () => {
    expect(isFreeTestAccount({ status: 'active', stripe_customer_id: null, stripe_subscription_id: null })).toBe(true)
    expect(isFreeTestAccount({ status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' })).toBe(false)
    // a business whose paid plan ended keeps its Stripe customer, so it is never taken for a test account
    expect(isFreeTestAccount({ status: 'canceled', stripe_customer_id: 'cus_1', stripe_subscription_id: null })).toBe(false)
    expect(isFreeTestAccount({ status: 'canceled', stripe_customer_id: null, stripe_subscription_id: null })).toBe(false)
    expect(isFreeTestAccount(null)).toBe(false)
  })
})

describe('T-180: plans and prices', () => {
  it('Starter is $49 a month or $490 a year, Pro $99 or $990, and no plan has a trial (AD-047)', () => {
    const byName = Object.fromEntries(offeredPlans().map((p) => [p.name, p]))
    expect([byName.Starter!.monthlyPrice.USD, byName.Starter!.annualPrice!.USD]).toEqual([4900, 49000])
    expect([byName.Pro!.monthlyPrice.USD, byName.Pro!.annualPrice!.USD]).toEqual([9900, 99000])
    expect(PLANS.filter((p) => p.trialDays)).toEqual([])
  })

  it('no offered plan bills per quote: over the monthly limit a request is held, never charged', () => {
    expect(offeredPlans().filter((p) => p.overageEnabled || p.overagePriceCents).map((p) => p.id)).toEqual([])
  })

  it('the setup script names products from the product name, sets the tax code, and never prints a secret', () => {
    const script = read('apps/web/scripts/stripe-setup-plans.mts')
    expect(script).toContain('const name = `${PRODUCT_NAME} ${plan.name}`')
    expect(script).toContain("const TAX_CODE = 'txcd_10103001'")
    // it never SETS a trial (it does refuse an existing price that has one)
    expect(script).not.toMatch(/trial_period_days\s*:|trial_settings/)
    expect(script).toMatch(/mode: 'at_period_end'/)
    // an upgrade is charged at once; a cheaper plan or a shorter interval waits for the end of the paid period
    expect(script).toContain("proration_behavior: 'always_invoice',")
    expect(script).toContain("schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },")
    expect(script).toContain('enabled_events: events')
    // a live run needs the typed account name, and the signing secret is never written out
    expect(script).toContain("if (typed !== accountName) throw new Error('The name did not match. Nothing was done.')")
    expect(script).not.toMatch(/say\([^)]*\.secret\b/)
    expect(script).not.toMatch(/console\.log\([^)]*key\b/)
  })

  it('nothing about billing or Stripe carries the old product name', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`
        if (/node_modules|\.next|__tests__/.test(rel)) continue
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel)
        else if (/\.(ts|tsx|mts)$/.test(entry) && /stripe|billing|plans|plan-limits/i.test(rel)) files.push(rel)
      }
    }
    walk('apps/web/src')
    walk('apps/web/scripts')
    walk('packages/shared/src')
    expect(files.length).toBeGreaterThan(8)
    // (spelled in two halves so this file is not itself a place the old name lives: T-162's test counts them)
    const oldName = new RegExp('aisti' + 'mator', 'i')
    expect(files.filter((f) => oldName.test(read(f)))).toEqual([])
    expect(PRODUCT_NAME).toBe('Qolumns')
  })
})

describe('T-180: prices are shown before tax, and say so', () => {
  it('"plus tax" sits beside every plan price: the Pricing page, Home\'s plan cards and the billing page\'s', () => {
    expect(PLUS_TAX).toBe('plus tax')
    // T-187: the Pricing page and Home draw the same plan cards (components/marketing/PlanCards), so the
    // words sit there once; the billing page has its own cards
    for (const file of ['apps/web/src/components/marketing/PlanCards.tsx', 'apps/web/src/app/(dashboard)/app/settings/billing/page.tsx']) {
      const src = read(file)
      expect(src, file).toContain('{PLUS_TAX}')
      expect(src, file).not.toMatch(/['"`>]\s*plus tax/) // from the constant, never typed
    }
    for (const file of ['apps/web/src/app/pricing/page.tsx', 'apps/web/src/app/page.tsx']) {
      expect(read(file), file).toContain('<PlanCards')
      expect(read(file), file).not.toMatch(/['"`>]\s*plus tax/)
    }
    // the monthly and the yearly price both say it
    const cards = read('apps/web/src/components/marketing/PlanCards.tsx')
    expect(cards).toContain('a month, {PLUS_TAX}')
    expect(cards).toContain('a year, {PLUS_TAX} (two months free)')
  })

  it('the Terms no longer speak of metered overage (no plan has it), and say plans are billed in advance, monthly or yearly', () => {
    const terms = read('apps/web/src/app/terms/page.tsx')
    expect(terms).not.toMatch(/metered overage \(where applicable\)|per-estimate rate/)
    expect(terms).toContain("body: 'Paid plans are billed in advance, monthly or yearly. You can cancel at any time; access continues to the end of the paid period. Fees are non-refundable except where required by law.',")
  })

  it('the Terms say who takes the payment and that tax is added, and carry the new date', () => {
    const terms = read('apps/web/src/app/terms/page.tsx')
    expect(terms).toContain('Payments are processed by Stripe, which acts as the seller of record through Link. Applicable sales tax or VAT is added at checkout.')
    expect(terms).toContain('Last updated: 18 November 2026')
  })

  it('the confirmed plan numbers: Starter 50 quotes, Pro 200, 10 free in total; only Business is still to confirm', () => {
    const byName = Object.fromEntries(offeredPlans().map((p) => [p.name, p]))
    expect([byName.Starter!.quoteLimit, byName.Pro!.quoteLimit]).toEqual([50, 200])
    expect(FREE_ALLOWANCE.US).toEqual({ quotes: 10, per: 'total' })
    const marks = read('packages/shared/src/plans.ts').split('\n').filter((line) => line.includes('TODO-OWNER'))
    expect(marks).toHaveLength(3)
    expect(marks.every((line) => /Business|19900|quoteLimit: 600/.test(line))).toBe(true)
  })
})

describe('T-180: Checkout is a Managed Payments session (AD-062)', () => {
  const base = { priceId: 'price_pro_m', tenantId: 'tnt_a', successUrl: 'https://x.test/ok', cancelUrl: 'https://x.test/no' }

  it('turns Managed Payments on and ties the session to the business three ways', () => {
    const params = checkoutSessionParams({ ...base, customerEmail: 'owner@example.com' })
    expect(params.mode).toBe('subscription')
    expect(params.managed_payments).toEqual({ enabled: true })
    expect(params.line_items).toEqual([{ price: 'price_pro_m', quantity: 1 }])
    expect(params.client_reference_id).toBe('tnt_a')
    expect(params.metadata).toEqual({ tenant_id: 'tnt_a' })
    expect(params.subscription_data).toEqual({ metadata: { tenant_id: 'tnt_a' } }) // and no trial
    expect(params.customer_email).toBe('owner@example.com')
    expect(params.customer).toBeUndefined()
  })

  it('a business that bought before keeps its Stripe customer', () => {
    const params = checkoutSessionParams({ ...base, customerId: 'cus_9', customerEmail: 'owner@example.com' })
    expect(params.customer).toBe('cus_9')
    expect(params.customer_email).toBeUndefined()
  })

  it('sends none of the settings Managed Payments owns (Stripe refuses a session that has them)', () => {
    const params = checkoutSessionParams({ ...base, customerId: 'cus_9' }) as Record<string, unknown>
    // Stripe's list, "Remove unsupported parameters", for subscriptions (docs read 2026-11-18)
    for (const forbidden of ['adaptive_pricing', 'automatic_tax', 'tax_id_collection', 'payment_method_configuration', 'payment_method_types', 'customer_update', 'shipping_address_collection', 'shipping_options', 'invoice_creation']) {
      expect(params[forbidden], forbidden).toBeUndefined()
    }
    const subscriptionData = params.subscription_data as Record<string, unknown>
    for (const forbidden of ['default_tax_rates', 'application_fee_percent', 'on_behalf_of', 'transfer_data', 'invoice_settings']) {
      expect(subscriptionData[forbidden], forbidden).toBeUndefined()
    }
  })

  it('no code creates a subscription or sets its card through the API (Managed Payments allows neither)', () => {
    for (const file of ['apps/web/src/lib/stripe.ts', 'apps/web/src/lib/billing-sync.ts', 'apps/web/src/app/api/billing/checkout/route.ts', 'apps/web/src/app/api/webhooks/stripe/route.ts']) {
      const src = read(file)
      expect(src, file).not.toMatch(/subscriptions\.create\(/)
      expect(src, file).not.toMatch(/default_payment_method\s*:/)
      expect(src, file).not.toMatch(/invoiceItems\.create\(|invoices\.create\(/)
    }
  })
})

describe('T-180: what a Stripe subscription becomes in our row', () => {
  it('reads the plan and the interval from the price, and the period from the item', () => {
    const facts = subscriptionFacts(stripeSubscription({ price: 'price_pro_y' }), PRICE_ENV)
    expect(facts).toMatchObject({ planId: 'plan_us_pro', interval: 'annual', status: 'active', tenantId: 'tnt_a', stripeCustomerId: 'cus_1', cancelAt: null })
    expect(facts.currentPeriodStart).toBe(new Date(1_800_000_000 * 1000).toISOString())
    expect(facts.currentPeriodEnd).toBe(new Date(1_802_592_000 * 1000).toISOString())
  })

  it('a cancel "at the end of the period" is a date, whichever way Stripe says it', () => {
    const end = new Date(1_802_592_000 * 1000).toISOString()
    expect(subscriptionFacts(stripeSubscription({ cancel_at: 1_802_592_000 }), PRICE_ENV).cancelAt).toBe(end) // the portal sets a date
    expect(subscriptionFacts(stripeSubscription({ cancel_at_period_end: true }), PRICE_ENV).cancelAt).toBe(end) // the older flag
    expect(subscriptionFacts(stripeSubscription({ status: 'canceled', cancel_at: 1_802_592_000 }), PRICE_ENV).cancelAt).toBeNull() // already ended
  })

  it('an invoice names its subscription under `parent`', () => {
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_7' } } } as unknown as Stripe.Invoice)).toBe('sub_7')
    expect(invoiceSubscriptionId({ parent: null } as unknown as Stripe.Invoice)).toBeNull()
  })

  const now = new Date('2026-11-18T12:00:00Z')
  const row = (over: Partial<StoredSubscription> = {}): StoredSubscription => ({ tenant_id: 'tnt_a', plan_id: 'plan_us_starter', status: 'active', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', payment_failed_at: null, ...over })

  it('a first purchase writes the plan; an upgrade changes it', () => {
    const first = decideSync(subscriptionFacts(stripeSubscription({ price: 'price_starter_m' }), PRICE_ENV), null, now)
    expect(first.write && first.row).toMatchObject({ plan_id: 'plan_us_starter', status: 'active', billing_interval: 'monthly', stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', payment_failed_at: null })
    const upgraded = decideSync(subscriptionFacts(stripeSubscription({ price: 'price_pro_y' }), PRICE_ENV), row(), now)
    expect(upgraded.write && upgraded.row).toMatchObject({ plan_id: 'plan_us_pro', billing_interval: 'annual' })
  })

  it('the same subscription synced twice writes the same row (an event repeated changes nothing)', () => {
    const facts = subscriptionFacts(stripeSubscription({ status: 'past_due' }), PRICE_ENV)
    const once = decideSync(facts, row(), now)
    if (!once.write) throw new Error('expected a write')
    const again = decideSync(facts, { ...row(), ...(once.row as unknown as StoredSubscription) }, new Date('2026-11-19T12:00:00Z'))
    expect(again.write && again.row).toEqual(once.row) // the failure keeps the time it started
  })

  it('a failed payment keeps the plan and is stamped once; a payment that works clears it', () => {
    const failed = decideSync(subscriptionFacts(stripeSubscription({ status: 'past_due' }), PRICE_ENV), row(), now)
    expect(failed).toMatchObject({ write: true, paymentFailed: true })
    expect(failed.write && failed.row).toMatchObject({ status: 'past_due', payment_failed_at: now.toISOString(), stripe_subscription_id: 'sub_1' })
    expect(failed.write && 'payment_failed_notified_at' in failed.row).toBe(false) // the email's stamp is left alone while it is failing

    const recovered = decideSync(subscriptionFacts(stripeSubscription({ status: 'active' }), PRICE_ENV), row({ status: 'past_due', payment_failed_at: now.toISOString() }), now)
    expect(recovered.write && recovered.row).toMatchObject({ status: 'active', payment_failed_at: null, payment_failed_notified_at: null })
  })

  it('when Stripe gives up, or the cancelled period ends, the row is "no plan" and keeps the customer', () => {
    for (const status of ['unpaid', 'canceled']) {
      const ended = decideSync(subscriptionFacts(stripeSubscription({ status }), PRICE_ENV), row({ plan_id: 'plan_us_pro', status: 'past_due' }), now)
      expect(ended.write && ended.row, status).toMatchObject({ status: 'canceled', stripe_subscription_id: null, stripe_customer_id: 'cus_1', cancel_at: null, payment_failed_at: null })
    }
  })

  it("an old subscription's last event never ends a newer plan", () => {
    const old = subscriptionFacts(stripeSubscription({ id: 'sub_old', status: 'canceled' }), PRICE_ENV)
    expect(decideSync(old, row({ stripe_subscription_id: 'sub_new', status: 'active' }), now)).toEqual({ write: false, why: 'older_subscription' })
  })

  it('a first payment that never went through leaves no row behind', () => {
    expect(decideSync(subscriptionFacts(stripeSubscription({ status: 'incomplete_expired' }), PRICE_ENV), null, now)).toEqual({ write: false, why: 'never_had_a_plan' })
  })

  it('a price that is not one of ours keeps the plan the business had, and is refused with no row to keep', () => {
    const unknown = subscriptionFacts(stripeSubscription({ price: 'price_someone_elses' }), PRICE_ENV)
    expect(unknown.planId).toBeNull()
    const kept = decideSync(unknown, row({ plan_id: 'plan_us_pro' }), now)
    expect(kept.write && kept.row.plan_id).toBe('plan_us_pro')
    expect(decideSync(unknown, null, now)).toEqual({ write: false, why: 'unknown_plan' })
  })
})

describe('T-180: a downgrade that is waiting for the end of the paid period', () => {
  const END = 1_802_592_000
  const withSchedule = (phases: Array<{ start_date: number; price: string }> | null, status = 'active') =>
    ({
      ...stripeSubscription({ price: 'price_pro_m', end: END }),
      schedule: phases ? { id: 'sub_sched_1', status, phases: phases.map((p) => ({ start_date: p.start_date, items: [{ price: p.price }] })) } : null,
    }) as unknown as Stripe.Subscription

  it('reads the next plan and the day it starts from Stripe’s schedule', () => {
    const pending = pendingPlanChange(withSchedule([{ start_date: 1_800_000_000, price: 'price_pro_m' }, { start_date: END, price: 'price_starter_m' }]), PRICE_ENV)
    expect(pending).toEqual({ planId: 'plan_us_starter', planName: 'Starter', interval: 'monthly', at: new Date(END * 1000).toISOString() })
  })

  it('nothing is waiting without a schedule, with one that only repeats the current price, or with one that is over', () => {
    expect(pendingPlanChange(withSchedule(null), PRICE_ENV)).toBeNull()
    expect(pendingPlanChange(withSchedule([{ start_date: 1_800_000_000, price: 'price_pro_m' }, { start_date: END, price: 'price_pro_m' }]), PRICE_ENV)).toBeNull()
    expect(pendingPlanChange(withSchedule([{ start_date: END, price: 'price_starter_m' }], 'released'), PRICE_ENV)).toBeNull()
    // a schedule that was not expanded (only its id) says nothing; so does a price that is not one of ours
    expect(pendingPlanChange({ ...stripeSubscription(), schedule: 'sub_sched_1' } as unknown as Stripe.Subscription, PRICE_ENV)).toBeNull()
    expect(pendingPlanChange(withSchedule([{ start_date: END, price: 'price_someone_elses' }]), PRICE_ENV)).toBeNull()
  })

  it('the line is the owner’s: "Changes to <plan> on <date>", with the interval only when the plan’s name would not show the change', () => {
    const starter = { planId: 'plan_us_starter', planName: 'Starter', interval: 'monthly' as const, at: '2026-12-18T00:00:00.000Z' }
    expect(pendingChangeLine(starter, 'Pro', 'December 18, 2026')).toBe('Changes to Starter on December 18, 2026.')
    expect(pendingChangeLine({ ...starter, planName: 'Pro' }, 'Pro', 'December 18, 2027')).toBe('Changes to Pro, billed monthly, on December 18, 2027.')
  })

  it('it is read from Stripe when the billing page asks, and never stored or shown once the plan is set to end', () => {
    const route = read('apps/web/src/app/api/billing/pending/route.ts')
    expect(route).toContain("stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ['schedule'] })")
    expect(route).not.toMatch(/\.(update|upsert|insert)\(/)
    const page = read('apps/web/src/app/(dashboard)/app/settings/billing/page.tsx')
    expect(page).toContain('{pending && currentPlan && !subscription?.cancelAt && (')
    expect(page).toContain('data-testid="pending-change"')
    // the billing page's main data still never calls Stripe
    expect(read('apps/web/src/app/api/billing/route.ts')).not.toMatch(/getStripeClient|stripe\./)
  })
})

describe('T-180: a quote is claimed and counted in one step (AD-063)', () => {
  /** A fake database: the subscription, the counters, the tenant, and the claim function with its own limit check */
  function fakeDb(opts: { subscription?: Record<string, unknown> | null; used?: number; region?: string; suspended?: boolean; rpcError?: boolean; overagePrice?: string | null }) {
    const state = { used: opts.used ?? 0, calls: [] as Array<{ fn: string; args: Record<string, unknown> }> }
    const period = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const table = (name: string) => {
      const result =
        name === 'subscriptions'
          ? { data: opts.subscription ? { ...opts.subscription, plans: { stripe_metered_price_id: opts.overagePrice ?? null } } : null }
          : name === 'usage_counters'
            ? { data: [{ period_yyyymm: period, estimates_created: state.used }] }
            : { data: { region: opts.region ?? 'US', suspended_at: opts.suspended ? '2026-11-18T00:00:00Z' : null } }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.single = async () => result
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
      return chain
    }
    const db = {
      from: table,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.calls.push({ fn, args })
        if (opts.rpcError) return { data: null, error: { code: 'XX000', message: 'down' } }
        if (fn === 'release_plan_quote') {
          state.used = Math.max(0, state.used - 1)
          return { data: null, error: null }
        }
        if (opts.suspended) return { data: [{ claimed: false, used: state.used, reason: 'suspended' }], error: null }
        const limit = args.p_limit as number
        if (limit > 0 && state.used >= limit) return { data: [{ claimed: false, used: state.used, reason: 'limit' }], error: null }
        state.used += 1
        return { data: [{ claimed: true, used: state.used, reason: 'ok' }], error: null }
      },
    }
    return { db: db as unknown as SupabaseClient, state }
  }

  it('the free allowance: the 10th quote is claimed, the 11th request is held', async () => {
    const { db, state } = fakeDb({ subscription: null, used: 9 })
    const tenth = await claimPlanQuote(db, 'tnt_a')
    expect(tenth).toMatchObject({ claimed: true, reason: 'ok', counted: true, overage: false })
    expect(tenth.status).toMatchObject({ used: 10, limit: FREE_ALLOWANCE.US!.quotes, per: 'total' })
    expect(state.calls[0]).toMatchObject({ fn: 'claim_plan_quote', args: { p_tenant_id: 'tnt_a', p_limit: 10, p_per: 'total' } })

    const eleventh = await claimPlanQuote(db, 'tnt_a')
    expect(eleventh).toMatchObject({ claimed: false, reason: 'limit', counted: false })
    expect(state.used).toBe(10)
  })

  it('a plan counts this month against its own number, read from the plan definitions', async () => {
    const { db, state } = fakeDb({ subscription: { status: 'active', plan_id: 'plan_us_starter', stripe_customer_id: 'cus_1' }, used: 49 })
    expect((await claimPlanQuote(db, 'tnt_a')).claimed).toBe(true)
    expect(state.calls[0]!.args).toMatchObject({ p_limit: 50, p_per: 'month' })
    // over the monthly limit: held (no offered plan has overage)
    expect(await claimPlanQuote(db, 'tnt_a')).toMatchObject({ claimed: false, reason: 'limit' })
    expect(state.used).toBe(50)
  })

  it('a payment being retried still has its plan; once Stripe gives up the business is back on the free allowance', async () => {
    const pastDue = fakeDb({ subscription: { status: 'past_due', plan_id: 'plan_us_pro', stripe_customer_id: 'cus_1' }, used: 30 })
    expect((await claimPlanQuote(pastDue.db, 'tnt_a')).claimed).toBe(true)
    expect(pastDue.state.calls[0]!.args).toMatchObject({ p_limit: 200, p_per: 'month' })

    const lapsed = fakeDb({ subscription: { status: 'canceled', plan_id: 'plan_us_pro', stripe_customer_id: 'cus_1' }, used: 30 })
    expect(await claimPlanQuote(lapsed.db, 'tnt_a')).toMatchObject({ claimed: false, reason: 'limit' })
    expect(lapsed.state.calls[0]!.args).toMatchObject({ p_limit: 10, p_per: 'total' })
  })

  it('a suspended business claims nothing, whatever its plan', async () => {
    const { db, state } = fakeDb({ subscription: { status: 'active', plan_id: 'plan_us_pro', stripe_customer_id: 'cus_1' }, used: 3, suspended: true })
    const claim = await claimPlanQuote(db, 'tnt_a')
    expect(claim).toMatchObject({ claimed: false, reason: 'suspended', counted: false })
    expect(claim.status.suspended).toBe(true)
    expect(state.used).toBe(3)
  })

  it('a legacy plan with metered overage is counted beyond its limit, as overage', async () => {
    const { db, state } = fakeDb({ subscription: { status: 'active', plan_id: 'plan_starter', stripe_customer_id: 'cus_1' }, used: 200, overagePrice: 'price_metered' })
    const claim = await claimPlanQuote(db, 'tnt_a')
    expect(claim).toMatchObject({ claimed: true, overage: true, counted: true })
    expect(state.calls.map((c) => c.args.p_limit)).toEqual([200, 0])
    expect(state.used).toBe(201)
  })

  it('fails open: if the database cannot answer, the request is priced and the miss is not counted', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { db } = fakeDb({ subscription: null, used: 2, rpcError: true })
    expect(await claimPlanQuote(db, 'tnt_a')).toMatchObject({ claimed: true, counted: false, reason: 'ok' })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('a claim is given back when the quote could not be saved, and only a counted one', async () => {
    const { db, state } = fakeDb({ subscription: null, used: 4 })
    const claim = await claimPlanQuote(db, 'tnt_a')
    expect(state.used).toBe(5)
    await releasePlanQuote(db, 'tnt_a', claim)
    expect(state.used).toBe(4)
    await releasePlanQuote(db, 'tnt_a', { ...claim, counted: false })
    expect(state.used).toBe(4)
  })

  it('the three places a quote is made all claim, and none of them adds one on its own', () => {
    for (const file of ['apps/web/src/lib/quote-intake.ts', 'apps/web/src/lib/messaging/intake-engine.ts', 'apps/web/src/app/api/quotes/[quoteId]/process/route.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/await claimPlanQuote\(/)
      expect(src, file).toMatch(/await releasePlanQuote\(/)
      expect(src, file).not.toMatch(/incrementUsageCounter/)
    }
  })

  it('the counters are single statements in the database, for the server only', () => {
    const migration = read('supabase/migrations/00000000000044_stripe_billing.sql')
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtextextended\('plan_usage:' \|\| p_tenant_id, 0\)\)/)
    expect(migration).toMatch(/DO UPDATE SET estimates_created = usage_counters\.estimates_created \+ 1/)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.claim_plan_quote\(TEXT, TEXT, INTEGER, TEXT\) FROM PUBLIC, anon, authenticated/)
    // neither the web app nor the worker reads a count and writes it back any more
    for (const file of ['apps/web/src/lib/usage.ts', 'apps/worker/src/usage.ts']) {
      const src = read(file)
      expect(src, file).toContain("supabase.rpc('increment_usage_counter'")
      expect(src, file).not.toMatch(/\.from\('usage_counters'\)/)
    }
  })
})

describe('T-180: the script that puts migration 44 on production', () => {
  it('its Before check names nothing the migration creates, except as a name to look up (it must work at migration 43)', () => {
    // The first version counted suspended businesses "WHERE suspended_at IS NOT NULL": a column this
    // migration creates. On production, at migration 43, the Before check failed (nothing was applied).
    const script = read('scripts/deploy-migration-44.sh')
    const check = script.slice(script.indexOf('CHECK="SELECT'), script.indexOf('suspended_businesses;"'))
    expect(check.length).toBeGreaterThan(400)
    const outsideQuotes = check.replace(/'[^']*'/g, "''")
    for (const created of ['claim_plan_quote', 'release_plan_quote', 'increment_usage_counter', 'billing_interval', 'cancel_at', 'payment_failed_at', 'payment_failed_notified_at', 'suspended_at', 'suspended_reason', 'free_warning_sent_at', 'stripe_events', 'admin_activity_logs', 'tenants_billing_guard']) {
      expect(outsideQuotes, created).not.toContain(created)
    }
    // every one of those names is in the migration, so the list above is the migration's own
    const migration = read('supabase/migrations/00000000000044_stripe_billing.sql')
    for (const created of ['suspended_at', 'stripe_events', 'claim_plan_quote', 'tenants_billing_guard']) expect(migration).toContain(created)
  })

  it('its test mode only ever talks to this machine', () => {
    const script = read('scripts/deploy-migration-44.sh')
    expect(script).toContain('http://127.0.0.1:*|http://localhost:*) ;;')
    expect(script).toContain('*) echo "ERROR: MIGRATION_TEST_API must be an address on this machine" >&2; exit 1 ;;')
  })
})

describe('T-180: two free quotes left', () => {
  it('says so at 8 of 10 and at 9 of 10, and at no other count', () => {
    expect(freeQuotesLeftLine(8, 10)).toBe('2 free quotes left. Pick a plan to keep pricing every request.')
    expect(freeQuotesLeftLine(9, 10)).toBe('1 free quote left. Pick a plan to keep pricing every request.')
    for (const used of [0, 5, 7, 10, 11]) expect(freeQuotesLeftLine(used, 10), String(used)).toBeNull()
    expect(freeQuotesLeftLine(8, 0)).toBeNull() // no limit, nothing to warn about
  })

  it('the email carries the same line and one button to the billing page', () => {
    const email = freeQuotesLeftEmail({ businessName: 'Kent & Sons <Doors>', used: 8, limit: 10, billingUrl: 'https://x.test/app/settings/billing' })!
    expect(email.subject).toBe('2 free quotes left')
    expect(email.html).toContain('2 free quotes left.')
    expect(email.html).toContain('Pick a plan to keep pricing every request.')
    expect(email.html).toContain('Kent &amp; Sons &lt;Doors&gt;') // a name is never raw HTML
    expect(email.html.match(/<a /g)).toHaveLength(1)
    expect(email.html).toContain('href="https://x.test/app/settings/billing"')
    expect(freeQuotesLeftEmail({ businessName: 'x', used: 3, limit: 10, billingUrl: 'u' })).toBeNull()
  })

  const status = (used: number, per: 'total' | 'month' = 'total'): PlanLimitStatus => ({ allowed: true, used, limit: 10, unlimited: false, per, overageAvailable: false, overagePriceCents: null, stripeCustomerId: null })

  it('is sent once: the stamp on the business is claimed first, and a second claim finds it taken', async () => {
    let stamped = false
    const updates: Array<Record<string, unknown>> = []
    const db = {
      from: () => ({
        update: (values: Record<string, unknown>) => {
          updates.push(values)
          const claimed = stamped ? [] : [{ id: 'tnt_a' }]
          stamped = true
          const chain: Record<string, unknown> = {}
          chain.eq = () => chain
          chain.is = () => chain
          chain.select = async () => ({ data: claimed })
          return chain
        },
      }),
    } as unknown as SupabaseClient
    await maybeWarnFreeQuotesLeft(db, 'tnt_a', 'Kent Doors', status(8))
    await maybeWarnFreeQuotesLeft(db, 'tnt_a', 'Kent Doors', status(9))
    expect(updates).toHaveLength(2) // both tried
    expect(Object.keys(updates[0]!)).toEqual(['free_warning_sent_at'])
  })

  it('never for a plan, and never away from 8 or 9', async () => {
    const from = vi.fn()
    const db = { from } as unknown as SupabaseClient
    await maybeWarnFreeQuotesLeft(db, 'tnt_a', 'Kent Doors', status(8, 'month'))
    await maybeWarnFreeQuotesLeft(db, 'tnt_a', 'Kent Doors', status(7))
    await maybeWarnFreeQuotesLeft(db, 'tnt_a', 'Kent Doors', status(10))
    expect(from).not.toHaveBeenCalled()
  })
})

describe('T-180: the notice on every dashboard page', () => {
  it('a failed payment: the owner’s line, and the action opens the portal', () => {
    expect(PAYMENT_FAILED_LINE).toBe("Your payment didn't go through. Update your card to keep your quotes running.")
    expect(billingNotice({ status: 'past_due', hasStripeCustomer: true, suspended: false })).toEqual({ kind: 'payment_failed', line: PAYMENT_FAILED_LINE, action: 'portal', actionLabel: 'Update your card' })
  })

  it('nothing when all is well, when the plan has ended, or for a test account', () => {
    for (const status of ['active', 'trialing', 'canceled', null]) expect(billingNotice({ status, hasStripeCustomer: true, suspended: false }), String(status)).toBeNull()
    expect(billingNotice({ status: 'past_due', hasStripeCustomer: false, suspended: false })).toBeNull() // no card to update
  })

  it('a paused account wins, and never shows the admin’s reason', () => {
    const notice = billingNotice({ status: 'past_due', hasStripeCustomer: true, suspended: true })
    expect(notice).toMatchObject({ kind: 'suspended', action: 'email' })
    expect(notice!.line).toMatch(/paused/)
  })

  it('the layout shows it on every page, and the failed-payment email says the same line once', () => {
    expect(read('apps/web/src/app/(dashboard)/layout.tsx')).toContain('<AccountNotice pathname={pathname} />')
    const email = paymentFailedEmail({ businessName: 'Kent Doors', billingUrl: 'https://x.test/app/settings/billing' })
    expect(email.subject).toBe("Your payment didn't go through")
    expect(email.html).toContain('Your payment didn&#39;t go through. Update your card to keep your quotes running.')
    expect(email.html.match(/<a /g)).toHaveLength(1)
    // one email per failure: the stamp is claimed where it is still empty and the status is still past due
    const sync = read('apps/web/src/lib/billing-sync.ts')
    expect(sync).toMatch(/\.eq\('status', 'past_due'\)\s*\n\s*\.is\('payment_failed_notified_at', null\)/)
  })
})

describe('T-180: the webhook handles five events, each once', () => {
  it('the list the endpoint is registered for is the list the route handles', () => {
    expect([...STRIPE_WEBHOOK_EVENTS]).toEqual(['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed', 'invoice.paid'])
    const route = read('apps/web/src/app/api/webhooks/stripe/route.ts')
    for (const type of STRIPE_WEBHOOK_EVENTS) expect(route, type).toContain(`case '${type}'`)
    expect((route.match(/case '/g) ?? []).length).toBe(STRIPE_WEBHOOK_EVENTS.length)
    expect(isHandledStripeEvent('charge.succeeded')).toBe(false)
  })
})

// ---------- the webhook route, with Stripe and the database stood in for ----------
const syncSubscriptionFromStripe = vi.fn(async (..._args: unknown[]) => ({ ok: true, tenantId: 'tnt_a', status: 'active', planId: 'plan_us_pro' }))
const ledger = new Map<string, { processed_at: string | null }>()
let currentEvent: { id: string; type: string; data: { object: Record<string, unknown> } } | null = null
vi.mock('@/lib/billing-sync', async (original) => ({
  ...((await original()) as object),
  syncSubscriptionFromStripe: (...args: unknown[]) => syncSubscriptionFromStripe(...args),
}))
vi.mock('@/lib/stripe', async (original) => ({
  ...((await original()) as object),
  getStripeClient: () => ({
    webhooks: {
      constructEvent: (_body: string, signature: string) => {
        if (signature !== 'good') throw new Error('bad signature')
        return currentEvent
      },
    },
  }),
}))
vi.mock('@/lib/meta-capi', () => ({ sendMetaEvent: vi.fn(async () => ({ sent: false })) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'stripe_events') throw new Error(`unexpected table ${table}`)
      return {
        insert: async (row: { id: string }) => {
          if (ledger.has(row.id)) return { error: { code: '23505' } }
          ledger.set(row.id, { processed_at: null })
          return { error: null }
        },
        select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: ledger.get(id) ?? null }) }) }),
        update: (values: { processed_at: string }) => ({
          eq: async (_c: string, id: string) => {
            ledger.set(id, { processed_at: values.processed_at })
            return { error: null }
          },
        }),
      }
    },
  }),
}))

describe('T-180: the same Stripe event twice changes nothing', () => {
  const post = async (signature: string | null = 'good') => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const headers: Record<string, string> = signature ? { 'stripe-signature': signature } : {}
    return POST(new Request('https://x.test/api/webhooks/stripe', { method: 'POST', headers, body: '{}' }))
  }

  beforeEach(() => {
    ledger.clear()
    syncSubscriptionFromStripe.mockClear()
    syncSubscriptionFromStripe.mockResolvedValue({ ok: true, tenantId: 'tnt_a', status: 'active', planId: 'plan_us_pro' })
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_unit_test'
  })

  it('handles an event once, and answers the repeat without touching anything', async () => {
    currentEvent = { id: 'evt_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } }
    const first = await post()
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ received: true })
    expect(syncSubscriptionFromStripe).toHaveBeenCalledTimes(1)
    expect(ledger.get('evt_1')?.processed_at).toBeTruthy()

    const second = await post()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ received: true, duplicate: true })
    expect(syncSubscriptionFromStripe).toHaveBeenCalledTimes(1) // not again
  })

  it('an event whose handling failed is not marked done, so Stripe’s retry is handled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    currentEvent = { id: 'evt_2', type: 'invoice.payment_failed', data: { object: { parent: { subscription_details: { subscription: 'sub_1' } } } } }
    syncSubscriptionFromStripe.mockResolvedValueOnce({ ok: false, why: 'write_failed' } as never)
    expect((await post()).status).toBe(500)
    expect(ledger.get('evt_2')?.processed_at).toBeNull()
    expect((await post()).status).toBe(200) // the retry
    expect(syncSubscriptionFromStripe).toHaveBeenCalledTimes(2)
    expect(ledger.get('evt_2')?.processed_at).toBeTruthy()
    error.mockRestore()
  })

  it('checkout ties the subscription to the business the session names', async () => {
    currentEvent = { id: 'evt_3', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_9', client_reference_id: 'tnt_b', metadata: {}, amount_total: 4900, currency: 'usd' } } }
    expect((await post()).status).toBe(200)
    expect(syncSubscriptionFromStripe.mock.calls[0]!.slice(2)).toEqual(['sub_9', { tenantId: 'tnt_b' }])
  })

  it('an event it does not handle is acknowledged and nothing is read or written', async () => {
    currentEvent = { id: 'evt_4', type: 'charge.succeeded', data: { object: {} } }
    const res = await post()
    expect(await res.json()).toEqual({ received: true, handled: false })
    expect(ledger.size).toBe(0)
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('no signature, or a wrong one, is refused before anything else', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    currentEvent = { id: 'evt_5', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } }
    expect((await post(null)).status).toBe(400)
    expect((await post('forged')).status).toBe(400)
    expect(ledger.size).toBe(0)
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('T-180: who is offered Checkout', () => {
  it('Checkout is refused for a test account and for a business that already has a plan, before Stripe is called', () => {
    const checkout = read('apps/web/src/app/api/billing/checkout/route.ts')
    const refusedAt = checkout.indexOf("'TEST_ACCOUNT'")
    const subscribedAt = checkout.indexOf("'ALREADY_SUBSCRIBED'")
    const stripeCalledAt = checkout.indexOf('await createCheckoutSession(')
    expect(refusedAt).toBeGreaterThan(0)
    expect(subscribedAt).toBeGreaterThan(refusedAt)
    expect(stripeCalledAt).toBeGreaterThan(subscribedAt)
    expect(checkout).toContain('if (isFreeTestAccount(row)) {')
  })

  it('the billing page says a test account is one, and gives it nothing to buy or manage', () => {
    const page = read('apps/web/src/app/(dashboard)/app/settings/billing/page.tsx')
    expect(page).toContain("const canCheckout = data?.canCheckout !== false && !testAccount")
    expect(page).toContain("const canManage = data?.canManage === true && !testAccount")
    expect(page).toContain('data-testid="test-account-note"')
    const api = read('apps/web/src/app/api/billing/route.ts')
    expect(api).toContain('canCheckout: !live && !testAccount,')
    expect(api).not.toMatch(/getStripeClient|stripe\./) // the page's data is what the webhook stored
  })

  it('coming back from Checkout confirms only the business’s own session', () => {
    const confirm = read('apps/web/src/app/api/billing/confirm/route.ts')
    expect(confirm).toContain('if (owner !== auth.tenantId) return refuse(404')
  })
})

describe('T-180: the suspend switch', () => {
  it('is for platform admins, needs a reason, is logged, and leaves Stripe alone', () => {
    const route = read('apps/web/src/app/api/admin/tenants/[tenantId]/suspend/route.ts')
    expect(route.indexOf('const admin = await verifyAdmin()')).toBeLessThan(route.indexOf('request.json()'))
    expect(route).toContain("if (body.suspended && !reason) return refuse(400")
    expect(route).toMatch(/await logAdminActivity\(supabase, \{[\s\S]*action: body\.suspended \? 'suspend' : 'restore'/)
    expect(route).not.toMatch(/getStripeClient|from '@\/lib\/stripe'/)
  })

  it('a business cannot suspend or restore itself: the columns change only through the service role', () => {
    const migration = read('supabase/migrations/00000000000044_stripe_billing.sql')
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OF suspended_at, suspended_reason, free_warning_sent_at ON tenants/)
    expect(migration).toMatch(/SELECT t\.suspended_at IS NOT NULL INTO v_suspended FROM tenants t WHERE t\.id = p_tenant_id/)
  })

  it('quotes already sent stay open: the public quote page never reads the switch', () => {
    for (const file of ['apps/web/src/app/api/public/quotes/[quoteId]/route.ts']) expect(read(file), file).not.toMatch(/suspended_at/)
  })
})
