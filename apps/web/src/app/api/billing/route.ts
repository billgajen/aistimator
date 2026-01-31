import { createClient } from '@/lib/supabase/server'
import { getStripeClient, getSubscriptionDetails } from '@/lib/stripe'
import { NextResponse } from 'next/server'
import type { BillingResponse, PlanInfo, SubscriptionInfo, BillingUsage } from '@estimator/shared'

/**
 * GET /api/billing
 * Get billing information for the current tenant
 */
export async function GET() {
  try {
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

    // Get current period (YYYYMM)
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

    // Fetch subscription with plan
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select(`
        *,
        plans!plan_id (*)
      `)
      .eq('tenant_id', tenantId)
      .single()

    // Fetch usage counter
    const { data: usageCounter } = await supabase
      .from('usage_counters')
      .select('estimates_created, estimates_sent')
      .eq('tenant_id', tenantId)
      .eq('period_yyyymm', currentPeriod)
      .single()

    // Fetch all active plans
    const { data: plans } = await supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('price_cents', { ascending: true })

    // Build subscription info
    let subscriptionInfo: SubscriptionInfo = {
      status: 'none',
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
    }

    if (subscription) {
      const plan = subscription.plans as unknown as {
        id: string
        name: string
        monthly_estimate_limit: number
        price_cents: number
        features_json: {
          pdf_generation: boolean
          email_notifications: boolean
          custom_branding: boolean
          priority_support: boolean
          api_access: boolean
        }
        stripe_price_id?: string
      } | null

      // Get additional details from Stripe if available
      let cancelAtPeriodEnd = false
      if (subscription.stripe_subscription_id) {
        const stripe = getStripeClient()
        if (stripe) {
          const stripeSubscription = await getSubscriptionDetails(
            stripe,
            subscription.stripe_subscription_id
          )
          if (stripeSubscription) {
            cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end
          }
        }
      }

      subscriptionInfo = {
        status: subscription.status as SubscriptionInfo['status'],
        plan: plan
          ? {
              id: plan.id,
              name: plan.name,
              monthlyEstimateLimit: plan.monthly_estimate_limit,
              priceCents: plan.price_cents,
              currency: 'usd',
              features: {
                pdfGeneration: plan.features_json?.pdf_generation ?? true,
                emailNotifications: plan.features_json?.email_notifications ?? true,
                customBranding: plan.features_json?.custom_branding ?? false,
                prioritySupport: plan.features_json?.priority_support ?? false,
                apiAccess: plan.features_json?.api_access ?? false,
              },
              stripePriceId: plan.stripe_price_id,
            }
          : null,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd,
        stripeCustomerId: subscription.stripe_customer_id,
      }
    }

    // Calculate period dates
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    const usage: BillingUsage = {
      estimatesCreated: usageCounter?.estimates_created || 0,
      estimatesSent: usageCounter?.estimates_sent || 0,
      planLimit: subscriptionInfo.plan?.monthlyEstimateLimit || 50, // Default trial limit
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    }

    // Transform plans to API format
    const availablePlans: PlanInfo[] = (plans || []).map((p) => {
      const features = p.features_json as {
        pdf_generation?: boolean
        email_notifications?: boolean
        custom_branding?: boolean
        priority_support?: boolean
        api_access?: boolean
      } | null

      return {
        id: p.id,
        name: p.name,
        monthlyEstimateLimit: p.monthly_estimate_limit,
        priceCents: p.price_cents,
        currency: 'usd',
        features: {
          pdfGeneration: features?.pdf_generation ?? true,
          emailNotifications: features?.email_notifications ?? true,
          customBranding: features?.custom_branding ?? false,
          prioritySupport: features?.priority_support ?? false,
          apiAccess: features?.api_access ?? false,
        },
        stripePriceId: (p as { stripe_price_id?: string }).stripe_price_id,
      }
    })

    const response: BillingResponse = {
      subscription: subscriptionInfo,
      usage,
      availablePlans,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Billing error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
