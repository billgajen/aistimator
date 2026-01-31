import { createClient } from '@/lib/supabase/server'
import { getStripeClient, isStripeConfigured, createPortalSession } from '@/lib/stripe'
import { NextResponse } from 'next/server'
import type { CreatePortalResponse } from '@estimator/shared'

/**
 * POST /api/billing/portal
 * Create a Stripe Customer Portal session
 */
export async function POST() {
  try {
    // Check Stripe configuration
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe is not configured' } },
        { status: 503 }
      )
    }

    const stripe = getStripeClient()!
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

    // Get user's tenant
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

    // Get subscription with Stripe customer ID
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('tenant_id', tenantId)
      .single()

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: { code: 'NO_CUSTOMER', message: 'No billing account found. Please subscribe to a plan first.' } },
        { status: 400 }
      )
    }

    // Build return URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const returnUrl = `${appUrl}/app/billing`

    // Create portal session
    const session = await createPortalSession(stripe, subscription.stripe_customer_id, returnUrl)

    const response: CreatePortalResponse = {
      portalUrl: session.url,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Portal error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
