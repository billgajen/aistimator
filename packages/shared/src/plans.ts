/**
 * Plan definitions (T-134, AD-026) — the ONE source for plan names, prices,
 * quote limits, channels, features, overage and trials. Limit enforcement,
 * the pricing page, the billing page and the Stripe webhook all read this.
 *
 * The `plans` DB table keeps one row per id only so `subscriptions.plan_id`
 * can reference it; its numbers are not read for decisions.
 *
 * Stripe price IDs differ per Stripe account and mode, so they are NOT here:
 * they come from env vars named by `stripePriceEnvKey()`.
 *
 * Confirmed by the owner for the Stripe launch (T-180, 2026-11-18): Starter is
 * 50 quotes a month for $49 ($490 a year); Pro is 200 quotes a month for $99
 * ($990 a year); the free allowance is 10 priced quotes in total. Stripe is the
 * merchant of record (Managed Payments), so sales tax and VAT are added on top
 * by Stripe at checkout; the numbers here are before tax.
 * TODO-OWNER: Business (off the site) still has the indicative numbers from
 * tickets/T-134.
 */

export type PlanInterval = 'monthly' | 'annual'

export type PlanChannel = 'widget' | 'whatsapp' | 'sms' | 'mobile_app'

export interface PlanFeatureSet {
  pdf_generation: boolean
  email_notifications: boolean
  custom_branding: boolean
  priority_support: boolean
  api_access: boolean
  calibration_insights: boolean
  lidar_scanning: boolean
  multiple_users: boolean
  /** T-199: the business chooses its own address (yourname.<our domain>) for its quote page */
  own_address: boolean
}

export interface PlanDefinition {
  id: string
  name: string
  tagline: string
  /** Monthly price in minor units per ISO currency */
  monthlyPrice: Record<string, number>
  /** Annual price in minor units; absent = no annual option */
  annualPrice?: Record<string, number>
  /** Quotes per calendar month; 0 = unlimited */
  quoteLimit: number
  channels: PlanChannel[]
  features: PlanFeatureSet
  /** AD-026: per-quote overage is OFF unless a plan opts in */
  overageEnabled: boolean
  overagePriceCents?: number
  /** Free-trial days at checkout (card required) */
  trialDays?: number
  /** Offered to new signups (pricing page, billing page upgrade list) */
  offered: boolean
  /** Highlighted on the pricing page */
  recommended?: boolean
}

const BASE_FEATURES: PlanFeatureSet = {
  pdf_generation: true,
  email_notifications: true,
  custom_branding: false,
  priority_support: false,
  api_access: false,
  calibration_insights: false,
  lidar_scanning: false,
  multiple_users: false,
  own_address: false,
}

/** Annual billing = 10 × monthly ("2 months free"). */
function annualFromMonthly(monthly: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(monthly).map(([cur, cents]) => [cur, cents * 10]))
}

const US_STARTER_MONTHLY = { USD: 4900 } // confirmed (T-180)
const US_PRO_MONTHLY = { USD: 9900 } // confirmed (T-180)
const US_BUSINESS_MONTHLY = { USD: 19900 } // TODO-OWNER: confirm $199

export const PLANS: PlanDefinition[] = [
  // ── Subscription-only US tiers (AD-026) ──
  {
    id: 'plan_us_starter',
    name: 'Starter',
    tagline: 'Instant estimates on your website',
    monthlyPrice: US_STARTER_MONTHLY,
    annualPrice: annualFromMonthly(US_STARTER_MONTHLY),
    quoteLimit: 50, // confirmed (T-180)
    channels: ['widget'],
    features: { ...BASE_FEATURES },
    overageEnabled: false,
    offered: true,
  },
  {
    id: 'plan_us_pro',
    name: 'Pro',
    tagline: 'Website, text and WhatsApp — plus the on-site app',
    monthlyPrice: US_PRO_MONTHLY,
    annualPrice: annualFromMonthly(US_PRO_MONTHLY),
    quoteLimit: 200, // confirmed (T-180)
    channels: ['widget', 'sms', 'whatsapp', 'mobile_app'],
    // T-193 (owner's decision): room scan is a Pro feature (Business keeps it)
    // T-199 (owner's decision): choosing its own address is a Pro feature (Business keeps it)
    features: { ...BASE_FEATURES, custom_branding: true, calibration_insights: true, lidar_scanning: true, own_address: true },
    overageEnabled: false,
    // T-165 (owner's decision): no trial. The one free offer is the free
    // allowance (FREE_ALLOWANCE): 10 priced quotes, no card. A plan is paid
    // from the day it is chosen.
    offered: true,
    recommended: true,
  },
  {
    id: 'plan_us_business',
    name: 'Business',
    tagline: 'On-site measurement with LiDAR scanning',
    monthlyPrice: US_BUSINESS_MONTHLY,
    annualPrice: annualFromMonthly(US_BUSINESS_MONTHLY),
    quoteLimit: 600, // TODO-OWNER: confirm
    channels: ['widget', 'sms', 'whatsapp', 'mobile_app'],
    features: {
      ...BASE_FEATURES,
      custom_branding: true,
      calibration_insights: true,
      lidar_scanning: true,
      multiple_users: true,
      priority_support: true,
      own_address: true,
    },
    overageEnabled: false,
    offered: true,
  },

  // ── Legacy plans: existing (GB-era) subscribers keep their exact limits and overage ──
  {
    id: 'plan_starter',
    name: 'Starter (legacy)',
    tagline: 'Legacy plan',
    monthlyPrice: { USD: 2900 },
    quoteLimit: 200,
    channels: ['widget', 'whatsapp'],
    features: { ...BASE_FEATURES },
    overageEnabled: true,
    overagePriceCents: 50,
    offered: false,
  },
  {
    id: 'plan_growth',
    name: 'Growth (legacy)',
    tagline: 'Legacy plan',
    monthlyPrice: { USD: 7900 },
    quoteLimit: 1000,
    channels: ['widget', 'whatsapp'],
    features: { ...BASE_FEATURES, custom_branding: true },
    overageEnabled: true,
    overagePriceCents: 40,
    offered: false,
  },
  {
    id: 'plan_pro',
    name: 'Pro (legacy)',
    tagline: 'Legacy plan',
    monthlyPrice: { USD: 19900 },
    quoteLimit: 3000,
    channels: ['widget', 'whatsapp'],
    features: { ...BASE_FEATURES, custom_branding: true, priority_support: true, api_access: true },
    overageEnabled: true,
    overagePriceCents: 30,
    offered: false,
  },
]

/**
 * T-152: the free allowance for a tenant WITHOUT a subscription.
 * - US (and every new business): 10 priced quotes in total — it never resets,
 *   so a small business can try it properly without a card.
 * - GB (legacy, pre-US tenants): keeps its 50 a month.
 * Test quotes (T-150) and unfinished requests (T-151) never count.
 */
export interface FreeAllowance {
  quotes: number
  /** 'total' = counted across all months; 'month' = resets each calendar month */
  per: 'month' | 'total'
}

export const FREE_ALLOWANCE: Record<string, FreeAllowance> = {
  GB: { quotes: 50, per: 'month' },
  US: { quotes: 10, per: 'total' }, // confirmed (T-180)
}

export function freeAllowance(region: string | null | undefined): FreeAllowance {
  return FREE_ALLOWANCE[region ?? 'GB'] ?? FREE_ALLOWANCE.GB!
}

/** Kept for callers: the free allowance's number of quotes. */
export const NO_SUBSCRIPTION_LIMIT: Record<string, number> = Object.fromEntries(
  Object.entries(FREE_ALLOWANCE).map(([region, a]) => [region, a.quotes])
)

/**
 * T-199 (owner's decision, 21 Nov 2026): while a new business still has free
 * quotes left, it works like this plan: every feature and channel of it. The
 * rule itself is `businessAccess` (access.ts); this only names the plan.
 */
export const FREE_START_PLAN_ID = 'plan_us_pro'

export function freeStartPlan(): PlanDefinition | null {
  return PLANS.find((p) => p.id === FREE_START_PLAN_ID) ?? null
}

/** The free offer for new businesses (the launch market), in the words the site uses. */
export function freeOfferLabel(): string {
  const plan = freeStartPlan()
  const quotes = FREE_ALLOWANCE.US!.quotes
  return plan ? `Try every ${plan.name} feature free: ${quotes} quotes, no card` : `Try it free: ${quotes} quotes, no card`
}

export function getPlan(id: string | null | undefined): PlanDefinition | null {
  return PLANS.find((p) => p.id === id) ?? null
}

export function offeredPlans(): PlanDefinition[] {
  return PLANS.filter((p) => p.offered)
}

/**
 * The subscription statuses under which a business has its plan. `past_due`
 * is a payment that failed and is being retried: the plan holds meanwhile,
 * and ends when the subscription is cancelled. (The database knows four
 * statuses: active, trialing, past_due, canceled.)
 *
 * One rule, read by the quote limit and by the WhatsApp assistant (T-177:
 * the owner chose the same grace for both).
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ['active', 'trialing', 'past_due']

export function subscriptionLive(status: string | null | undefined): boolean {
  return typeof status === 'string' && LIVE_SUBSCRIPTION_STATUSES.includes(status)
}

/**
 * T-180: Stripe's subscription status as one of the four the database knows.
 * Only `active`, `trialing` and `past_due` keep a plan (LIVE_SUBSCRIPTION_STATUSES).
 * Everything else means the plan is not held: `unpaid` and `canceled` (Stripe
 * gave up, or the paid period ended), `incomplete` and `incomplete_expired`
 * (the first payment never went through), `paused`. Nothing here grants a plan
 * that was not paid for; an unknown status is treated as not paid.
 */
export type StoredSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled'

export function storedSubscriptionStatus(stripeStatus: string | null | undefined): StoredSubscriptionStatus {
  if (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due') return stripeStatus
  return 'canceled'
}

/**
 * T-177, T-180: a free test account is a live subscription row that Stripe has
 * never heard of (no customer, no subscription), put there by
 * scripts/set-test-plan.sh. It is never billed, never offered Checkout or the
 * portal, and is not revenue: revenue is what Stripe holds.
 */
export function isFreeTestAccount(
  subscription: { status?: string | null; stripe_customer_id?: string | null; stripe_subscription_id?: string | null } | null | undefined
): boolean {
  return Boolean(subscription && subscriptionLive(subscription.status) && !subscription.stripe_customer_id && !subscription.stripe_subscription_id)
}

/** T-180: the free allowance warns once, when this many free quotes are left */
export const FREE_QUOTES_LEFT_WARNING = 2

/** T-180: the line for the dashboard and the email when the free allowance is nearly used. Null when there is nothing to say. */
export function freeQuotesLeftLine(used: number, limit: number): string | null {
  const left = limit - used
  if (limit <= 0 || left <= 0 || left > FREE_QUOTES_LEFT_WARNING) return null
  return `${left} free ${left === 1 ? 'quote' : 'quotes'} left. Pick a plan to keep pricing every request.`
}

/** T-180: a card payment failed and Stripe is retrying. Shown on every dashboard page, and the email's first line. */
export const PAYMENT_FAILED_LINE = "Your payment didn't go through. Update your card to keep your quotes running."

/** Does this plan include a channel? (T-177: the plan definitions decide, never a plan's name) */
export function planHasChannel(planId: string | null | undefined, channel: PlanChannel): boolean {
  return Boolean(getPlan(planId)?.channels.includes(channel))
}

/** The plans a new business can choose that include a channel, in the order they are offered */
export function offeredPlansWithChannel(channel: PlanChannel): PlanDefinition[] {
  return offeredPlans().filter((p) => p.channels.includes(channel))
}

export function noSubscriptionLimit(region: string | null | undefined): number {
  return freeAllowance(region).quotes
}

/** Env var holding the Stripe price id for a plan + interval + currency. */
export function stripePriceEnvKey(planId: string, interval: PlanInterval, currency: string): string {
  return `STRIPE_PRICE_${planId.replace(/^plan_/, '').toUpperCase()}_${interval.toUpperCase()}_${currency.toUpperCase()}`
}

/** Stripe price id for a plan from env, or null when not configured. */
export function stripePriceIdFor(
  planId: string,
  interval: PlanInterval,
  currency: string,
  env: Record<string, string | undefined>
): string | null {
  return env[stripePriceEnvKey(planId, interval, currency)]?.trim() || null
}

/** Reverse lookup for the Stripe webhook: which plan + interval a price id belongs to. */
export function planForStripePrice(
  priceId: string,
  env: Record<string, string | undefined>
): { plan: PlanDefinition; interval: PlanInterval } | null {
  for (const plan of PLANS) {
    for (const interval of ['monthly', 'annual'] as const) {
      const prices = interval === 'monthly' ? plan.monthlyPrice : plan.annualPrice
      for (const currency of Object.keys(prices ?? {})) {
        if (stripePriceIdFor(plan.id, interval, currency, env) === priceId) return { plan, interval }
      }
    }
  }
  return null
}

/** Usage state for banners: <80% ok, ≥80% warning, ≥100% limit (unlimited never warns). */
export function usageLevel(used: number, limit: number): 'ok' | 'warning' | 'limit' {
  if (limit <= 0) return 'ok'
  if (used >= limit) return 'limit'
  if (used >= limit * 0.8) return 'warning'
  return 'ok'
}
