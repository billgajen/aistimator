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
 * TODO-OWNER: the US prices and limits below are the indicative tiers from
 * tickets/T-134 ("owner to confirm final numbers before go-live").
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
}

/** Annual billing = 10 × monthly ("2 months free"). */
function annualFromMonthly(monthly: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(monthly).map(([cur, cents]) => [cur, cents * 10]))
}

const US_STARTER_MONTHLY = { USD: 4900 } // TODO-OWNER: confirm $49
const US_PRO_MONTHLY = { USD: 9900 } // TODO-OWNER: confirm $99
const US_BUSINESS_MONTHLY = { USD: 19900 } // TODO-OWNER: confirm $199

export const PLANS: PlanDefinition[] = [
  // ── Subscription-only US tiers (AD-026) ──
  {
    id: 'plan_us_starter',
    name: 'Starter',
    tagline: 'Instant estimates on your website',
    monthlyPrice: US_STARTER_MONTHLY,
    annualPrice: annualFromMonthly(US_STARTER_MONTHLY),
    quoteLimit: 50, // TODO-OWNER: confirm
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
    quoteLimit: 200, // TODO-OWNER: confirm
    channels: ['widget', 'sms', 'whatsapp', 'mobile_app'],
    features: { ...BASE_FEATURES, custom_branding: true, calibration_insights: true },
    overageEnabled: false,
    trialDays: 14,
    offered: true,
    recommended: true,
  },
  {
    id: 'plan_us_business',
    name: 'Business',
    tagline: 'Exact on-site measurement with LiDAR scanning',
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
  US: { quotes: 10, per: 'total' }, // TODO-OWNER: confirm the free allowance
}

export function freeAllowance(region: string | null | undefined): FreeAllowance {
  return FREE_ALLOWANCE[region ?? 'GB'] ?? FREE_ALLOWANCE.GB!
}

/** Kept for callers: the free allowance's number of quotes. */
export const NO_SUBSCRIPTION_LIMIT: Record<string, number> = Object.fromEntries(
  Object.entries(FREE_ALLOWANCE).map(([region, a]) => [region, a.quotes])
)

/** The free offer for new businesses (the launch market), in the words the site uses. */
export function freeOfferLabel(): string {
  return `Try it free: ${FREE_ALLOWANCE.US!.quotes} quotes, no card`
}

export function getPlan(id: string | null | undefined): PlanDefinition | null {
  return PLANS.find((p) => p.id === id) ?? null
}

export function offeredPlans(): PlanDefinition[] {
  return PLANS.filter((p) => p.offered)
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
