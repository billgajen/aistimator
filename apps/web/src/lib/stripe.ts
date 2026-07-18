import Stripe from 'stripe'

// Initialize Stripe client
const stripeSecretKey = process.env.STRIPE_SECRET_KEY

export function getStripeClient(): Stripe | null {
  if (!stripeSecretKey) {
    console.warn('Stripe not configured: STRIPE_SECRET_KEY missing')
    return null
  }

  return new Stripe(stripeSecretKey, {
    typescript: true,
  })
}

export function isStripeConfigured(): boolean {
  return !!stripeSecretKey
}

/**
 * Create or get a Stripe customer for a tenant
 */
export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  tenantId: string,
  email: string,
  name: string,
  existingCustomerId?: string | null
): Promise<string> {
  // Return existing customer if we have one
  if (existingCustomerId) {
    return existingCustomerId
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      tenant_id: tenantId,
    },
  })

  return customer.id
}

/**
 * Create a Stripe Checkout session for subscription
 */
export async function createCheckoutSession(
  stripe: Stripe,
  params: {
    customerId: string
    priceId: string
    tenantId: string
    successUrl: string
    cancelUrl: string
    /** Metered overage price to attach (T-102) — no quantity, billed via meter events */
    meteredPriceId?: string
  }
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    customer: params.customerId,
    mode: 'subscription',
    line_items: [
      {
        price: params.priceId,
        quantity: 1,
      },
      // Metered items must not specify quantity
      ...(params.meteredPriceId ? [{ price: params.meteredPriceId }] : []),
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      tenant_id: params.tenantId,
    },
    subscription_data: {
      metadata: {
        tenant_id: params.tenantId,
      },
    },
  })
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
