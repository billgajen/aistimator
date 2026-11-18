import Stripe from 'stripe'

/**
 * Stripe (T-180, AD-062). The account uses Managed Payments: Stripe is the
 * merchant of record. It sells the plan, works out and pays the sales tax and
 * VAT, sends the receipts and handles disputes. What that asks of this code:
 *   - a subscription is only ever created by Checkout, with
 *     `managed_payments.enabled`; never through the API;
 *   - each product carries a tax code Managed Payments accepts
 *     (scripts/stripe-setup-plans.mts sets it);
 *   - Checkout is sent none of the settings Managed Payments owns (tax,
 *     payment method types, invoice settings, adaptive pricing);
 *   - the subscription's default card is never set through the API: the
 *     customer changes it in the portal.
 * The SDK pins the API version, so what the webhook receives has the shapes
 * the SDK's types describe (the period is on the subscription's item, an
 * invoice's subscription is under `parent`).
 */

function secretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || undefined
}

export function getStripeClient(): Stripe | null {
  const key = secretKey()
  if (!key) {
    console.warn('Stripe not configured: STRIPE_SECRET_KEY missing')
    return null
  }
  return new Stripe(key)
}

export function isStripeConfigured(): boolean {
  return Boolean(secretKey())
}

/** What Checkout is asked for. Pure, so a test can read exactly what is sent. */
export interface CheckoutInput {
  priceId: string
  tenantId: string
  successUrl: string
  cancelUrl: string
  /** A business that has bought before keeps its Stripe customer (its invoices stay in one place) */
  customerId?: string | null
  /** A first purchase: Checkout creates the customer, with this address filled in */
  customerEmail?: string | null
  /** T-134: free-trial days. No plan has one (AD-047); the mechanism stays, driven by the plan data. */
  trialDays?: number
}

export function checkoutSessionParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    // AD-062: Stripe is the seller. It adds the tax, picks the payment methods and sends the receipt.
    managed_payments: { enabled: true },
    line_items: [{ price: input.priceId, quantity: 1 }],
    ...(input.customerId ? { customer: input.customerId } : input.customerEmail ? { customer_email: input.customerEmail } : {}),
    // which business this is, three ways: the session, its metadata, and the subscription it creates
    client_reference_id: input.tenantId,
    metadata: { tenant_id: input.tenantId },
    subscription_data: {
      ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
      metadata: { tenant_id: input.tenantId },
    },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  }
}

/**
 * Create a Stripe Checkout session for a plan. A stored customer id that this
 * Stripe account does not know (one left from an old test account) is dropped
 * and Checkout makes a new customer.
 */
export async function createCheckoutSession(stripe: Stripe, input: CheckoutInput): Promise<Stripe.Checkout.Session> {
  try {
    return await stripe.checkout.sessions.create(checkoutSessionParams(input))
  } catch (error) {
    const stale = input.customerId && error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing' && error.param === 'customer'
    if (!stale) throw error
    console.warn('[Stripe] Stored customer is unknown to this Stripe account; Checkout will create a new one')
    return stripe.checkout.sessions.create(checkoutSessionParams({ ...input, customerId: null }))
  }
}

/**
 * Report one overage quote to Stripe via the Billing Meter Events API (T-102).
 * The quote ID is used as the event identifier so retries can never double-bill.
 * The meter (matching STRIPE_OVERAGE_METER_EVENT) must be configured in Stripe
 * and referenced by the plan's metered price.
 */
export async function reportOverageMeterEvent(
  stripe: Stripe,
  params: { customerId: string; quoteId: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    await stripe.billing.meterEvents.create({
      event_name: process.env.STRIPE_OVERAGE_METER_EVENT || 'estimate_overage',
      identifier: params.quoteId,
      payload: {
        stripe_customer_id: params.customerId,
        value: '1',
      },
    })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Stripe error'
    console.error('[Stripe] Failed to report overage meter event:', message)
    return { success: false, error: message }
  }
}

/**
 * Create a Stripe Customer Portal session
 */
export async function createPortalSession(
  stripe: Stripe,
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}

/**
 * Get subscription details from Stripe
 */
export async function getSubscriptionDetails(
  stripe: Stripe,
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product'],
    })
  } catch {
    return null
  }
}

/**
 * Format price for display
 */
export function formatPrice(amountCents: number, currency: string): string {
  const amount = amountCents / 100
  const symbols: Record<string, string> = {
    usd: '$',
    gbp: '£',
    eur: '€',
    aud: 'A$',
    cad: 'C$',
  }
  const symbol = symbols[currency.toLowerCase()] || currency.toUpperCase() + ' '
  return `${symbol}${amount.toFixed(2)}`
}
