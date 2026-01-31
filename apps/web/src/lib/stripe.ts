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
