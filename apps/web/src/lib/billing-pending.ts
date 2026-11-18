/**
 * T-180: a plan change that is waiting for the end of the paid period.
 *
 * A downgrade asked for in Stripe's portal does not happen at once: Stripe
 * keeps the current plan and attaches a schedule whose next phase is the new
 * price, starting when the paid period ends. Our `subscriptions` row holds the
 * plan the business has NOW (AD-062), which is right; this reads what Stripe
 * is holding for later, so the billing page can say "Changes to <plan> on
 * <date>".
 *
 * It is read from Stripe when the billing page opens and never stored: it is
 * Stripe's own schedule, not a fact about the plan the business has, and it
 * goes away by itself when the business cancels or changes its mind. Pure.
 */
import type Stripe from 'stripe'
import { planForStripePrice } from '@qolumns/shared'
import type { PlanInterval } from '@qolumns/shared'

export interface PendingPlanChange {
  planId: string
  planName: string
  interval: PlanInterval
  /** when it takes effect (the end of the period already paid for) */
  at: string
}

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === 'string' ? value : value?.id ?? null)

/** The change Stripe is holding for this subscription, or null. `subscription.schedule` must be expanded. */
export function pendingPlanChange(subscription: Stripe.Subscription, env: Record<string, string | undefined>): PendingPlanChange | null {
  const schedule = subscription.schedule
  if (!schedule || typeof schedule === 'string' || schedule.status !== 'active') return null
  const item = subscription.items?.data?.[0]
  const currentPrice = item?.price?.id ?? null
  const periodEnd = item?.current_period_end ?? 0
  // the first phase that starts when (or after) the paid period ends, on a different price
  for (const phase of schedule.phases ?? []) {
    if (phase.start_date < periodEnd) continue
    const price = idOf(phase.items?.[0]?.price as string | { id: string } | undefined)
    if (!price || price === currentPrice) continue
    const match = planForStripePrice(price, env)
    if (!match) return null
    return { planId: match.plan.id, planName: match.plan.name, interval: match.interval, at: new Date(phase.start_date * 1000).toISOString() }
  }
  return null
}

/** "Changes to Starter on December 18, 2026." The interval is said only when the plan's name alone would not show the change. */
export function pendingChangeLine(pending: PendingPlanChange, currentPlanName: string | null | undefined, date: string): string {
  const what = pending.planName === currentPlanName ? `${pending.planName}, billed ${pending.interval === 'annual' ? 'yearly' : 'monthly'},` : pending.planName
  return `Changes to ${what} on ${date}.`
}
