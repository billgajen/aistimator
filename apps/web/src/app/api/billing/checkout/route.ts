import { createClient } from '@/lib/supabase/server'
import {
  getStripeClient,
  isStripeConfigured,
  getOrCreateStripeCustomer,
  createCheckoutSession,
} from '@/lib/stripe'
import { NextResponse } from 'next/server'
import type { CreateCheckoutRequest, CreateCheckoutResponse } from '@estimator/shared'

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for subscription
 */
export async function POST(request: Request) {
  try {
    // Check Stripe configuration
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe is not configured' } },
        { status: 503 }
      )
    }

    const stripe = getStripeClient()!
    const body: CreateCheckoutRequest = await request.json()

    if (!body.planId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'planId is required' } },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant and profile
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    const tenantId = profile.tenant_id

    // Get tenant details
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .single()

    if (!tenant) {
      return NextResponse.json(
        { error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } },
        { status: 404 }
      )
    }

    // Get the plan
    const { data: plan } = await supabase
      .from('plans')
      .select('*')
      .eq('id', body.planId)
      .eq('is_active', true)
      .single()

    if (!plan) {
      return NextResponse.json(
        { error: { code: 'PLAN_NOT_FOUND', message: 'Plan not found' } },
        { status: 404 }
      )
    }

    // Check if plan has a Stripe price ID
    const stripePriceId = (plan as { stripe_price_id?: string }).stripe_price_id
    if (!stripePriceId) {
      return NextResponse.json(
        { error: { code: 'NO_STRIPE_PRICE', message: 'Plan does not have a Stripe price configured' } },
        { status: 400 }
      )
    }

    // Get or create subscription record to get Stripe customer ID
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('tenant_id', tenantId)
      .single()

    // Get or create Stripe customer
    const customerId = await getOrCreateStripeCustomer(
      stripe,
      tenantId,
      user.email!,
      tenant.name,
      subscription?.stripe_customer_id
    )

    // Update subscription with customer ID if new
    if (!subscription?.stripe_customer_id) {
      await supabase
        .from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('tenant_id', tenantId)
    }

    // Build URLs
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const successUrl = `${appUrl}/app/billing?success=true`
    const cancelUrl = `${appUrl}/app/billing?canceled=true`

    // Create checkout session
    const session = await createCheckoutSession(stripe, {
      customerId,
      priceId: stripePriceId,
      tenantId,
      successUrl,
      cancelUrl,
    })

    if (!session.url) {
      return NextResponse.json(
        { error: { code: 'CHECKOUT_FAILED', message: 'Failed to create checkout session' } },
        { status: 500 }
      )
    }

    const response: CreateCheckoutResponse = {
      checkoutUrl: session.url,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Checkout error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
