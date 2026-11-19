/**
 * T-191: money taken back on a plan's payment. Under Managed Payments Stripe handles refunds and disputes (and
 * may refund on its own, AD-062); until now the plan carried on as if it had been paid.
 *
 *   a FULL refund of the payment for the CURRENT period     the plan ends now
 *   a dispute that is LOST (the bank took the money back)   the plan ends now
 *   a partial refund, a refund of an earlier period          nothing changes (a goodwill refund keeps the plan)
 *   a dispute that is opened, under review or won            nothing changes (the plan stands until it is lost)
 *
 * "Ends" means: the subscription is cancelled at Stripe at once, with no new invoice and no proration, and the
 * row is synced from Stripe as every other change is (`syncSubscriptionFromStripe`), so it reads "no plan" by the
 * one rule. Stripe's own `customer.subscription.deleted` follows and changes nothing more.
 *
 * As AD-062 says, nothing is decided from an event's payload: the charge or the dispute is read from Stripe
 * again, then its invoice, then the subscription.
 */
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invoiceSubscriptionId, syncSubscriptionFromStripe } from './billing-sync'

export type Reversal = { kind: 'refund'; charge: Pick<Stripe.Charge, 'refunded' | 'amount' | 'amount_refunded'> } | { kind: 'dispute'; dispute: Pick<Stripe.Dispute, 'status'> }

export interface ReversalFacts {
  /** the invoice the money was for */
  invoiceId: string
  subscriptionId: string
  /** the subscription's latest invoice: the payment for the period it is in now */
  latestInvoiceId: string | null
  subscriptionStatus: Stripe.Subscription.Status
}

export type ReversalDecision = { end: true; why: 'refunded' | 'dispute_lost' } | { end: false; why: 'partial_refund' | 'earlier_period' | 'dispute_open' | 'already_ended' }

/** Does this reversal end the plan? Pure. */
export function decideReversal(reversal: Reversal, facts: ReversalFacts): ReversalDecision {
  if (facts.subscriptionStatus === 'canceled' || facts.subscriptionStatus === 'incomplete_expired') return { end: false, why: 'already_ended' }
  if (reversal.kind === 'dispute') return reversal.dispute.status === 'lost' ? { end: true, why: 'dispute_lost' } : { end: false, why: 'dispute_open' }
  const { charge } = reversal
  const full = charge.refunded === true || (charge.amount > 0 && charge.amount_refunded >= charge.amount)
  if (!full) return { end: false, why: 'partial_refund' }
  if (facts.latestInvoiceId !== facts.invoiceId) return { end: false, why: 'earlier_period' }
  return { end: true, why: 'refunded' }
}

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === 'string' ? value : value?.id ?? null)

/** The invoice and subscription a payment was for, or null when it was not a plan's payment */
export async function invoiceForPayment(stripe: Stripe, paymentIntentId: string): Promise<{ invoiceId: string; subscriptionId: string } | null> {
  const payments = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 })
  const invoiceId = idOf(payments.data[0]?.invoice)
  if (!invoiceId) return null
  const invoice = await stripe.invoices.retrieve(invoiceId)
  const subscriptionId = invoiceSubscriptionId(invoice)
  return subscriptionId ? { invoiceId, subscriptionId } : null
}

export type ReversalResult = { handled: false; why: 'not_a_plan_payment' } | { handled: true; decision: ReversalDecision; subscriptionId: string }

/**
 * Handle a refund (`charge.refunded`) or a closed dispute (`charge.dispute.closed`). Reads everything from Stripe
 * again. Throws on a Stripe or database failure, so the webhook answers 5xx and Stripe sends the event again
 * (safe: the decision is the same, and a cancelled subscription is not cancelled twice).
 */
export async function handleReversal(admin: SupabaseClient, stripe: Stripe, event: { kind: 'refund'; chargeId: string } | { kind: 'dispute'; disputeId: string }): Promise<ReversalResult> {
  let reversal: Reversal
  let paymentIntentId: string | null
  if (event.kind === 'refund') {
    const charge = await stripe.charges.retrieve(event.chargeId)
    reversal = { kind: 'refund', charge }
    paymentIntentId = idOf(charge.payment_intent)
  } else {
    const dispute = await stripe.disputes.retrieve(event.disputeId)
    reversal = { kind: 'dispute', dispute }
    paymentIntentId = idOf(dispute.payment_intent)
    if (!paymentIntentId) {
      const charge = await stripe.charges.retrieve(idOf(dispute.charge) ?? '')
      paymentIntentId = idOf(charge.payment_intent)
    }
  }
  if (!paymentIntentId) return { handled: false, why: 'not_a_plan_payment' }

  const paid = await invoiceForPayment(stripe, paymentIntentId)
  if (!paid) return { handled: false, why: 'not_a_plan_payment' }

  const subscription = await stripe.subscriptions.retrieve(paid.subscriptionId)
  const decision = decideReversal(reversal, {
    invoiceId: paid.invoiceId,
    subscriptionId: paid.subscriptionId,
    latestInvoiceId: idOf(subscription.latest_invoice),
    subscriptionStatus: subscription.status,
  })
  console.log(`[Billing] ${event.kind} on subscription ${paid.subscriptionId}: ${decision.end ? 'the plan ends' : 'no change'} (${decision.why})`)
  // an ended subscription is synced too: a retry after a failed write (the cancel went through) must still store it
  if (!decision.end && decision.why !== 'already_ended') return { handled: true, decision, subscriptionId: paid.subscriptionId }

  if (decision.end) await stripe.subscriptions.cancel(paid.subscriptionId, { invoice_now: false, prorate: false })
  const stored = await syncSubscriptionFromStripe(admin, stripe, paid.subscriptionId)
  if (!stored.ok && (stored.why === 'write_failed' || stored.why === 'not_found')) throw new Error(`ended plan not stored: ${stored.why}`)
  return { handled: true, decision, subscriptionId: paid.subscriptionId }
}
