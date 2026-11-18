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
 */
export const STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
] as const

export type HandledStripeEvent = (typeof STRIPE_WEBHOOK_EVENTS)[number]

export function isHandledStripeEvent(type: string): type is HandledStripeEvent {
  return (STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(type)
}

/** Where Stripe posts them */
export const STRIPE_WEBHOOK_PATH = '/api/webhooks/stripe'
