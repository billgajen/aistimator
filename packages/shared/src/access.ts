/**
 * T-199: what a business can use. THE one rule, read by the web app, the
 * worker and (through the server) the phone app. Nothing else decides this:
 * no route, page or job checks a plan by itself.
 *
 * Three cases:
 *   - on a plan (its subscription is live): that plan's features and
 *     channels, as the plan definitions say (plans.ts). Starter gets
 *     Starter's, Pro gets Pro's.
 *   - on the free start (the owner's decision, 21 Nov 2026): a business that
 *     has never had a subscription and still has free quotes left works like
 *     the free start's plan (`FREE_START_PLAN_ID`): every feature and channel
 *     of it. The allowance itself is unchanged (plans.ts, `FREE_ALLOWANCE`).
 *   - neither: nothing that needs a plan. Free quotes used up, a subscription
 *     that ended, or anything that could not be read.
 *
 * The free start is only for the allowance that never resets ('total'). The
 * older allowance that starts again each month would otherwise be the free
 * start's plan for ever.
 *
 * Losing a capability never deletes anything. It is read again on every use,
 * so what was made stays and works again the moment the business has it back.
 *
 * Pure. The rows are read by each app's own small loader (the web's is
 * lib/access.ts), which answers `NO_ACCESS` when a read fails.
 */
import { freeAllowance, freeStartPlan, getPlan, offeredPlans, subscriptionLive, type PlanChannel, type PlanDefinition, type PlanFeatureSet } from './plans'
import { PRODUCT_NAME } from './brand'

/** What a plan can switch on. Each is one channel or one feature of the plan definitions. */
export const CAPABILITIES = {
  /** Quotes inside the business's own WhatsApp chat */
  whatsapp: { channel: 'whatsapp' },
  /** Starting a quote on site, in the phone app (the app itself is open to every business) */
  onsite_quotes: { channel: 'mobile_app' },
  /** Measuring a room by scanning it */
  room_scan: { feature: 'lidar_scanning' },
  /** The estimate without the "Prepared with" badge */
  no_badge: { feature: 'custom_branding' },
  calibration_insights: { feature: 'calibration_insights' },
  /** Choosing its own address for its quote page */
  own_address: { feature: 'own_address' },
} as const satisfies Record<string, { channel: PlanChannel } | { feature: keyof PlanFeatureSet }>

export type Capability = keyof typeof CAPABILITIES

export type AccessBasis = 'plan' | 'free_start' | 'none'

export interface AccessFacts {
  /** The business's subscriptions row, or null when it has never had one */
  subscription: { plan_id?: string | null; status?: string | null } | null | undefined
  region: string | null | undefined
  /** Priced quotes counted so far, every month together; null when that could not be read */
  quotesUsed: number | null
}

export interface BusinessAccess {
  basis: AccessBasis
  /** The plan whose features apply: the plan held, the free start's plan, or none */
  plan: PlanDefinition | null
  /** Free quotes left on the free start; null otherwise */
  freeLeft: number | null
  /** A plan the business holds a row for but that is not live (it ended, or a payment was never made good) */
  lapsedPlan: PlanDefinition | null
}

/** Nothing that needs a plan: also the answer when the facts could not be read */
export const NO_ACCESS: BusinessAccess = { basis: 'none', plan: null, freeLeft: null, lapsedPlan: null }

export function businessAccess(facts: AccessFacts): BusinessAccess {
  const row = facts.subscription ?? null
  if (row) {
    const plan = getPlan(row.plan_id)
    if (subscriptionLive(row.status)) return plan ? { basis: 'plan', plan, freeLeft: null, lapsedPlan: null } : NO_ACCESS
    return { ...NO_ACCESS, lapsedPlan: plan }
  }
  const allowance = freeAllowance(facts.region)
  const plan = freeStartPlan()
  if (!plan || allowance.per !== 'total' || facts.quotesUsed === null || !Number.isFinite(facts.quotesUsed)) return NO_ACCESS
  const left = allowance.quotes - Math.max(0, Math.floor(facts.quotesUsed))
  return left > 0 ? { basis: 'free_start', plan, freeLeft: left, lapsedPlan: null } : NO_ACCESS
}

function planIncludes(plan: PlanDefinition | null, capability: Capability): boolean {
  if (!plan) return false
  const what: { channel?: PlanChannel; feature?: keyof PlanFeatureSet } = CAPABILITIES[capability]
  if (what.channel) return plan.channels.includes(what.channel)
  return what.feature ? plan.features[what.feature] === true : false
}

/** Can this business use it now? */
export function canUse(access: BusinessAccess, capability: Capability): boolean {
  return planIncludes(access.plan, capability)
}

/**
 * Why not, for a business that cannot: 'subscription' when a plan it holds
 * includes it but is not live (it comes back when the plan is active again),
 * 'plan' when no plan of its own includes it.
 */
export function whyNot(access: BusinessAccess, capability: Capability): 'plan' | 'subscription' {
  return planIncludes(access.lapsedPlan, capability) ? 'subscription' : 'plan'
}

/** The plans a new business can choose that include it, in the order they are offered */
export function plansWith(capability: Capability, plans: PlanDefinition[] = offeredPlans()): PlanDefinition[] {
  return plans.filter((plan) => planIncludes(plan, capability))
}

/** Does a plan include it? (For the pages that describe plans; never for deciding what a business may do.) */
export function planIncludesCapability(plan: PlanDefinition, capability: Capability): boolean {
  return planIncludes(plan, capability)
}

/** "Pro": the first plan on offer that includes it. Empty when none does. */
export function planNameFor(capability: Capability): string {
  return plansWith(capability)[0]?.name ?? ''
}

/** The plans on offer that include it, as words: "Pro" (with two, "Pro and Business") */
export function planNamesFor(capability: Capability, plans?: PlanDefinition[]): string {
  const names = plansWith(capability, plans).map((p) => p.name)
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** Home, on the free start: "You're trying everything in Pro. 7 free quotes left." */
export function freeStartLine(access: BusinessAccess): string | null {
  if (access.basis !== 'free_start' || !access.plan || access.freeLeft === null) return null
  return `You're trying everything in ${access.plan.name}. ${access.freeLeft} free ${access.freeLeft === 1 ? 'quote' : 'quotes'} left.`
}

/** The small tag beside a feature the free start lends: the name of the plan that keeps it. Null off the free start. */
export function freeStartTag(access: BusinessAccess, capability: Capability): string | null {
  return access.basis === 'free_start' && canUse(access, capability) ? planNameFor(capability) || null : null
}

/** What the app is told, and shows, when a business without on-site quotes starts one. No price, no link. */
export const ONSITE_NOT_IN_PLAN_CODE = 'ONSITE_QUOTES_NOT_IN_PLAN'

export function onsiteNotInPlan(): { code: string; heading: string; text: string; button: string } {
  return {
    code: ONSITE_NOT_IN_PLAN_CODE,
    heading: `On-site quotes are part of ${planNameFor('onsite_quotes')}`,
    text: `Your plan includes everything else in the app. To add on-site quotes, change your plan in your ${PRODUCT_NAME} account.`,
    button: 'OK',
  }
}

/** The site's two lines about the app: who gets the app, and who can start a quote in it */
export function appPlanLines(plans?: PlanDefinition[]): { everyPlan: string; onsite: string } {
  return { everyPlan: 'Mobile app: every plan', onsite: `On-site quotes in the app: ${planNamesFor('onsite_quotes', plans)}` }
}
