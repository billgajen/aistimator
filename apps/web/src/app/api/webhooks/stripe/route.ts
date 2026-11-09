import { createAdminClient } from '@/lib/supabase/server'
import { planForStripePrice } from '@estimator/shared'
import { getStripeClient } from '@/lib/stripe'
import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { sendMetaEvent } from '@/lib/meta-capi'

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 */
export async function POST(request: Request) {
  try {
    const stripe = getStripeClient()
    if (!stripe) {
      console.error('Stripe not configured')
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
    }

    if (!webhookSecret) {
      console.error('Stripe webhook secret not configured')
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }

    // Get raw body for signature verification
    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    console.log(`[Stripe Webhook] Received event: ${event.type}`)

    const supabase = createAdminClient()

    // Handle subscription events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(supabase, stripe, session)
        // T-144: server-side Subscribe for the ad funnel (no-op unless Meta is configured)
        await sendMetaEvent({
          eventName: session.status === 'complete' && session.amount_total === 0 ? 'StartTrial' : 'Subscribe',
          eventId: session.id,
          email: session.customer_details?.email ?? null,
          ...(session.amount_total !== null && session.currency && { value: session.amount_total / 100, currency: session.currency }),
        })
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdated(supabase, subscription)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(supabase, subscription)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentSucceeded(supabase, invoice)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentFailed(supabase, invoice)
        break
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

/**
 * Handle checkout.session.completed
 * Create or update subscription after successful checkout
 */
async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createAdminClient>,
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  const tenantId = session.metadata?.tenant_id
  if (!tenantId) {
    console.error('[Stripe Webhook] No tenant_id in checkout session metadata')
    return
  }

  const subscriptionId = session.subscription as string
  if (!subscriptionId) {
    console.error('[Stripe Webhook] No subscription ID in checkout session')
    return
  }

  // Get subscription details from Stripe
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  })

  // T-134: plan from the shared definitions via the env price-id map (the
  // plans table never had a stripe_price_id column — checkout could not bind)
  const match = findPlanForSubscription(stripeSubscription)
  if (!match) {
    console.error('[Stripe Webhook] No plan matches the subscription price IDs (check STRIPE_PRICE_* env)')
    return
  }
  const plan = match.plan

  // Extract period dates (handle different Stripe API versions)
  const subData = stripeSubscription as unknown as {
    status: Stripe.Subscription.Status
    current_period_start: number
    current_period_end: number
  }

  // Upsert: signup never creates a subscriptions row, so an update-only write
  // silently recorded nothing for first-time subscribers (found in T-134)
  const { error } = await supabase.from('subscriptions').upsert(
    {
      tenant_id: tenantId,
      plan_id: plan.id,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subscriptionId,
      status: mapStripeStatus(subData.status),
      current_period_start: new Date(subData.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subData.current_period_end * 1000).toISOString(),
    },
    { onConflict: 'tenant_id' }
  )

  if (error) {
    console.error('[Stripe Webhook] Failed to update subscription:', error)
  } else {
    console.log(`[Stripe Webhook] Subscription updated for tenant: ${tenantId}`)
  }
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof createAdminClient>,
  subscription: Stripe.Subscription
) {
  const tenantId = subscription.metadata?.tenant_id
  if (!tenantId) {
    // Try to find tenant by Stripe customer ID
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('tenant_id')
      .eq('stripe_subscription_id', subscription.id)
      .single()

    if (!sub) {
      console.error('[Stripe Webhook] Cannot find tenant for subscription:', subscription.id)
      return
    }

    await updateSubscriptionRecord(supabase, sub.tenant_id, subscription)
  } else {
    await updateSubscriptionRecord(supabase, tenantId, subscription)
  }
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof createAdminClient>,
  subscription: Stripe.Subscription
) {
  // Find subscription by Stripe ID
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tenant_id')
    .eq('stripe_subscription_id', subscription.id)
    .single()

  if (!sub) {
    console.error('[Stripe Webhook] Cannot find subscription to delete:', subscription.id)
    return
  }

  // Get default/free plan
  const { data: freePlan } = await supabase
    .from('plans')
    .select('id')
    .eq('price_cents', 0)
    .single()

  // Update to canceled status and revert to free plan
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      plan_id: freePlan?.id || null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
    })
    .eq('tenant_id', sub.tenant_id)

  if (error) {
    console.error('[Stripe Webhook] Failed to handle subscription deletion:', error)
  } else {
    console.log(`[Stripe Webhook] Subscription canceled for tenant: ${sub.tenant_id}`)
  }
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(
  supabase: ReturnType<typeof createAdminClient>,
  invoice: Stripe.Invoice
) {
  // Get subscription ID from the invoice (using type assertion for older Stripe types)
  const subscriptionId = (invoice as unknown as { subscription?: string | null }).subscription
  if (!subscriptionId) return

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tenant_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single()

  if (sub) {
    // Update subscription status to active
    await supabase
      .from('subscriptions')
      .update({ status: 'active' })
      .eq('tenant_id', sub.tenant_id)

    console.log(`[Stripe Webhook] Payment succeeded for tenant: ${sub.tenant_id}`)
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(
  supabase: ReturnType<typeof createAdminClient>,
  invoice: Stripe.Invoice
) {
  // Get subscription ID from the invoice (using type assertion for older Stripe types)
  const subscriptionId = (invoice as unknown as { subscription?: string | null }).subscription
  if (!subscriptionId) return

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tenant_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single()

  if (sub) {
    // Update subscription status to past_due
    await supabase
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('tenant_id', sub.tenant_id)

    console.log(`[Stripe Webhook] Payment failed for tenant: ${sub.tenant_id}`)
  }
}

/**
 * Update subscription record from Stripe data
 */
async function updateSubscriptionRecord(
  supabase: ReturnType<typeof createAdminClient>,
  tenantId: string,
  subscription: Stripe.Subscription
) {
  // T-134: upgrades/downgrades via the Customer Portal change the price → plan
  const match = findPlanForSubscription(subscription)

  // Extract period dates (handle different Stripe API versions)
  const subData = subscription as unknown as {
    status: Stripe.Subscription.Status
    current_period_start: number
    current_period_end: number
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({
      // Unknown price (e.g. env not set yet): keep the current plan, still sync status
      ...(match ? { plan_id: match.plan.id } : {}),
      status: mapStripeStatus(subData.status),
      current_period_start: new Date(subData.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subData.current_period_end * 1000).toISOString(),
    })
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('[Stripe Webhook] Failed to update subscription:', error)
  } else {
    console.log(`[Stripe Webhook] Subscription updated for tenant: ${tenantId}`)
  }
}

/** The plan for a subscription: first item whose price id is a configured plan price. */
function findPlanForSubscription(subscription: Stripe.Subscription) {
  for (const item of subscription.items.data) {
    const match = planForStripePrice(item.price.id, process.env)
    if (match) return match
  }
  return null
}

/**
 * Map Stripe subscription status to our status
 */
function mapStripeStatus(
  stripeStatus: Stripe.Subscription.Status
): 'active' | 'past_due' | 'canceled' | 'trialing' {
  switch (stripeStatus) {
    case 'active':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled'
    case 'trialing':
      return 'trialing'
    case 'incomplete':
    case 'paused':
    default:
      return 'active' // Default to active for edge cases
  }
}
