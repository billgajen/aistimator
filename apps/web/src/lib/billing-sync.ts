/**
 * T-180 (AD-062): the one place a Stripe subscription becomes our
 * `subscriptions` row.
 *
 * Every webhook event, and the return from Checkout, calls
 * `syncSubscriptionFromStripe` with a subscription id. It READS THE
 * SUBSCRIPTION FROM STRIPE AGAIN and stores what Stripe says now; it never
 * trusts the event's own copy. So:
 *   - the same event twice writes the same row (and the event ledger in the
 *     webhook route skips it before it gets here);
 *   - events arriving out of order cannot leave an old state behind;
 *   - a change made anywhere (our portal link, Stripe's own customer site,
 *     the Stripe dashboard) lands the same way.
 *
 * The four statuses and what they mean are `storedSubscriptionStatus` and
 * `subscriptionLive` in @qolumns/shared: a failed payment being retried keeps
 * the plan; unpaid, cancelled or never paid does not.
 */
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { businessAccess, canUse, planForStripePrice, storedSubscriptionStatus, subscriptionLive } from '@qolumns/shared'
import type { PlanInterval, StoredSubscriptionStatus } from '@qolumns/shared'
import { sendEmail, isPostmarkConfigured } from './postmark'
import { paymentFailedEmail } from './billing-emails'
import { readAllowanceAfterPlan } from './plan-limits'
import { businessEmailFor } from './business-email'
import { offerAddressAgain } from './own-address'

const iso = (seconds: number | null | undefined): string | null => (typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null)
const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === 'string' ? value : value?.id ?? null)

/** What we store from a Stripe subscription. Pure. */
export interface SubscriptionFacts {
  stripeSubscriptionId: string
  stripeCustomerId: string | null
  status: StoredSubscriptionStatus
  /** null when no price on the subscription is one of our plans' prices (a setting is missing) */
  planId: string | null
  interval: PlanInterval | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  /** when a cancelled subscription ends; null when it is not ending */
  cancelAt: string | null
  /** the business the subscription says it belongs to (set by Checkout) */
  tenantId: string | null
}

export function subscriptionFacts(subscription: Stripe.Subscription, env: Record<string, string | undefined>): SubscriptionFacts {
  const items = subscription.items?.data ?? []
  let match: ReturnType<typeof planForStripePrice> = null
  let planItem = items[0]
  for (const item of items) {
    const found = planForStripePrice(item.price.id, env)
    if (found) {
      match = found
      planItem = item
      break
    }
  }
  const status = storedSubscriptionStatus(subscription.status)
  const periodEnd = iso(planItem?.current_period_end)
  // Cancelling "at the end of the period" arrives either as a date or as a flag
  const cancelAt = subscriptionLive(status) ? iso(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? periodEnd : null) : null
  return {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: idOf(subscription.customer),
    status,
    planId: match?.plan.id ?? null,
    interval: match?.interval ?? null,
    currentPeriodStart: iso(planItem?.current_period_start),
    currentPeriodEnd: periodEnd,
    cancelAt,
    tenantId: subscription.metadata?.tenant_id?.trim() || null,
  }
}

/**
 * T-201: has a plan just begun? True when the row is live now and, before this write, there was
 * no row, a row that was not live, or a different plan. The same facts stored twice say no the
 * second time. Pure.
 */
export function planJustStarted(
  before: { plan_id?: string | null; status?: string | null } | null | undefined,
  after: { plan_id?: string | null; status?: string | null }
): boolean {
  if (!subscriptionLive(after.status)) return false
  return !before || !subscriptionLive(before.status) || before.plan_id !== after.plan_id
}

/** The row as it is before the sync (only what the decision needs) */
export interface StoredSubscription {
  tenant_id: string
  plan_id: string
  status: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  payment_failed_at: string | null
}

export type SyncDecision =
  | { write: false; why: 'older_subscription' | 'unknown_plan' | 'never_had_a_plan' }
  | { write: true; row: Record<string, string | null>; paymentFailed: boolean }

/**
 * What to write for a business, given Stripe's facts and the row we have. Pure.
 *   - A subscription that has ENDED never replaces a different one that is
 *     live (an old subscription's last event must not end a new plan).
 *   - A price we cannot map keeps the plan we had; with no row at all there
 *     is nothing to keep, so nothing is written (and it is logged).
 *   - An ended subscription leaves the row as "no plan": status canceled, the
 *     Stripe subscription forgotten, the customer kept (its invoices, and the
 *     next purchase, stay with the same Stripe customer).
 */
export function decideSync(facts: SubscriptionFacts, existing: StoredSubscription | null, now: Date): SyncDecision {
  const live = subscriptionLive(facts.status)
  if (!live && existing?.stripe_subscription_id && existing.stripe_subscription_id !== facts.stripeSubscriptionId && subscriptionLive(existing.status)) {
    return { write: false, why: 'older_subscription' }
  }
  // a first payment that never went through leaves no plan behind, and there is none to end
  if (!live && !existing) return { write: false, why: 'never_had_a_plan' }
  const planId = facts.planId ?? existing?.plan_id ?? null
  if (!planId) return { write: false, why: 'unknown_plan' }

  const paymentFailed = facts.status === 'past_due'
  return {
    write: true,
    paymentFailed,
    row: {
      plan_id: planId,
      status: facts.status,
      stripe_customer_id: facts.stripeCustomerId ?? existing?.stripe_customer_id ?? null,
      stripe_subscription_id: live ? facts.stripeSubscriptionId : null,
      billing_interval: facts.interval,
      current_period_start: facts.currentPeriodStart,
      current_period_end: facts.currentPeriodEnd,
      cancel_at: facts.cancelAt,
      // a failure is stamped when it starts and cleared when the payment is good again (or the plan is gone)
      payment_failed_at: paymentFailed ? existing?.payment_failed_at ?? now.toISOString() : null,
      ...(paymentFailed ? {} : { payment_failed_notified_at: null }),
    },
  }
}

export type SyncResult =
  | { ok: true; tenantId: string; status: StoredSubscriptionStatus; planId: string; /** T-201: a plan is live now that was not the plan held a moment ago */ planStarted: boolean }
  | { ok: false; why: 'not_found' | 'no_tenant' | 'older_subscription' | 'unknown_plan' | 'never_had_a_plan' | 'write_failed' }

/**
 * Read one subscription from Stripe and store it. `hint` is the business the
 * caller already knows (Checkout's own reference); without it the business is
 * the one the subscription names, else the row that already holds this
 * subscription or this customer.
 */
export async function syncSubscriptionFromStripe(
  admin: SupabaseClient,
  stripe: Stripe,
  subscriptionId: string,
  hint: { tenantId?: string | null } = {}
): Promise<SyncResult> {
  let subscription: Stripe.Subscription
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    console.error('[Billing] Could not read the subscription from Stripe:', error instanceof Error ? error.message : 'unknown')
    return { ok: false, why: 'not_found' }
  }
  const facts = subscriptionFacts(subscription, process.env)

  const columns = 'tenant_id, plan_id, status, stripe_customer_id, stripe_subscription_id, payment_failed_at'
  let tenantId = hint.tenantId ?? facts.tenantId
  let existing: StoredSubscription | null = null
  if (tenantId) {
    const { data } = await admin.from('subscriptions').select(columns).eq('tenant_id', tenantId).maybeSingle()
    existing = data as StoredSubscription | null
  } else {
    const bySubscription = await admin.from('subscriptions').select(columns).eq('stripe_subscription_id', facts.stripeSubscriptionId).maybeSingle()
    existing = bySubscription.data as StoredSubscription | null
    if (!existing && facts.stripeCustomerId) {
      const byCustomer = await admin.from('subscriptions').select(columns).eq('stripe_customer_id', facts.stripeCustomerId).maybeSingle()
      existing = byCustomer.data as StoredSubscription | null
    }
    tenantId = existing?.tenant_id ?? null
  }
  if (!tenantId) {
    console.error(`[Billing] No business found for Stripe subscription ${facts.stripeSubscriptionId}`)
    return { ok: false, why: 'no_tenant' }
  }

  const decision = decideSync(facts, existing, new Date())
  if (!decision.write) {
    if (decision.why === 'unknown_plan') {
      console.error(`[Billing] Subscription ${facts.stripeSubscriptionId} has no price that matches a plan: check the STRIPE_PRICE_* settings`)
    }
    return { ok: false, why: decision.why }
  }

  // Signup never creates a subscriptions row, so the first purchase inserts one (T-134)
  const { error } = await admin.from('subscriptions').upsert({ tenant_id: tenantId, ...decision.row }, { onConflict: 'tenant_id' })
  if (error) {
    console.error('[Billing] Failed to store the subscription:', error.code ?? error.message)
    return { ok: false, why: 'write_failed' }
  }
  console.log(`[Billing] Subscription stored for ${tenantId}: ${decision.row.plan_id} ${facts.status}`)

  // T-199: a plan that includes the business's own address has just started: Home offers it again
  // (the one rule decides what each row gives; nothing is read here but the two rows)
  const gives = (row: { plan_id?: string | null; status?: string | null } | null) => canUse(businessAccess({ subscription: row, region: null, quotesUsed: null }), 'own_address')
  if (gives(decision.row as { plan_id?: string | null; status?: string | null }) && !gives(existing)) await offerAddressAgain(admin as Parameters<typeof offerAddressAgain>[0], tenantId)

  if (decision.paymentFailed) await notifyPaymentFailedOnce(admin, tenantId)
  return {
    ok: true,
    tenantId,
    status: facts.status,
    planId: decision.row.plan_id as string,
    planStarted: planJustStarted(existing, decision.row as { plan_id?: string | null; status?: string | null }),
  }
}

/**
 * The one "your payment didn't go through" email for a failed payment. The
 * stamp is claimed first, so however many events report the same failure
 * (Stripe retries several times), one email is sent. It is cleared when a
 * payment succeeds, so a later failure gets its own email. Never throws.
 */
export async function notifyPaymentFailedOnce(admin: SupabaseClient, tenantId: string): Promise<void> {
  try {
    const { data: claimed } = await admin
      .from('subscriptions')
      .update({ payment_failed_notified_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('status', 'past_due')
      .is('payment_failed_notified_at', null)
      .select('tenant_id')
    if (!claimed || claimed.length === 0) return // already told about this failure

    if (!isPostmarkConfigured()) return
    const to = await businessEmailFor(tenantId)
    if (!to) return
    const { data: tenant } = await admin.from('tenants').select('name').eq('id', tenantId).single()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    // T-202: what its new requests fall back on if the plan ends, with this business's own numbers
    const afterPlan = await readAllowanceAfterPlan(admin, tenantId)
    const email = paymentFailedEmail({ businessName: (tenant as { name?: string } | null)?.name || 'Your business', billingUrl: `${appUrl}/app/settings/billing`, afterPlan })
    await sendEmail({ from: { kind: 'business' }, to, subject: email.subject, htmlBody: email.html, tag: 'payment-failed' })
    console.log('[Billing] Payment-failed notice sent')
  } catch (error) {
    console.error('[Billing] Failed to send the payment-failed notice:', error instanceof Error ? error.message : 'unknown')
  }
}

/** The subscription an invoice belongs to (under `parent` since the 2025 API versions) */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return idOf(invoice.parent?.subscription_details?.subscription)
}
