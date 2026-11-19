/**
 * T-180: the Stripe events the webhook handles, and nothing else. The setup
 * script (apps/web/scripts/stripe-setup-plans.mts) registers the endpoint for
 * exactly this list, so the two cannot drift.
 *
 * Every one of them ends in the same place: re-read the subscription from
 * Stripe and store what it says (lib/billing-sync.ts). So the order they
 * arrive in does not matter, and a missed one is repaired by the next.
 *   checkout.session.completed      a plan was bought (this is what ties the Stripe customer to the business)
 *   customer.subscription.updated   plan or interval changed, cancelled or un-cancelled, a payment failed or recovered
 *   customer.subscription.deleted   the subscription ended (cancelled period over, or Stripe gave up on the card)
 *   invoice.payment_failed          a renewal payment failed
 *   invoice.paid                    a payment went through (a retry that worked)
 *   charge.refunded                 T-191: money given back; a full refund of the current period ends the plan
 *   charge.dispute.closed           T-191: a dispute was decided; a lost one ends the plan
 * The two T-191 events re-read the charge or dispute, its invoice and the subscription from Stripe
 * (lib/billing-reversals.ts), and end the plan through the same sync.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
  'charge.refunded',
  'charge.dispute.closed',
] as const

export type HandledStripeEvent = (typeof STRIPE_WEBHOOK_EVENTS)[number]

export function isHandledStripeEvent(type: string): type is HandledStripeEvent {
  return (STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type)
}

/** Where Stripe posts them */
export const STRIPE_WEBHOOK_PATH = '/api/webhooks/stripe'
