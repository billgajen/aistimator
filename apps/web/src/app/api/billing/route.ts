import { createClient } from '@/lib/supabase/server'
import { getStripeClient, getSubscriptionDetails } from '@/lib/stripe'
import { toPlanInfo } from '@/lib/plans-view'
import { getPlan, offeredPlans, noSubscriptionLimit, usageLevel } from '@estimator/shared'
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

    // T-134: plans come from the shared definitions, not the plans table
    const { data: tenantRow } = await supabase.from('tenants').select('region, currency').eq('id', tenantId).single()
    const tenantRegion = (tenantRow as { region?: string } | null)?.region ?? null

    let subscriptionInfo: SubscriptionInfo = {
      status: 'none',
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      stripeCustomerId: null,
    }

    const currentPlan = subscription ? getPlan(subscription.plan_id as string) : null
    if (subscription) {
      let cancelAtPeriodEnd = false
      if (subscription.stripe_subscription_id) {
        const stripe = getStripeClient()
        if (stripe) {
          const stripeSubscription = await getSubscriptionDetails(stripe, subscription.stripe_subscription_id)
          if (stripeSubscription) cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end
        }
      }
      subscriptionInfo = {
        status: subscription.status as SubscriptionInfo['status'],
        plan: currentPlan ? toPlanInfo(currentPlan) : null,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd,
        stripeCustomerId: subscription.stripe_customer_id,
      }
    }

    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    const live = subscription && ['active', 'trialing', 'past_due'].includes(subscription.status as string)
    const created = usageCounter?.estimates_created || 0
    const planLimit = live && currentPlan ? currentPlan.quoteLimit : noSubscriptionLimit(tenantRegion)
    const overagePriceCents =
      subscription?.status === 'active' && currentPlan?.overageEnabled ? currentPlan.overagePriceCents ?? null : null

    // Leads captured over the limit this period (T-134)
    const { count: heldLeads } = await supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_review')
      .gte('created_at', periodStart.toISOString())
      .contains('content_json', { limitHold: true })

    const usage: BillingUsage = {
      estimatesCreated: created,
      estimatesSent: usageCounter?.estimates_sent || 0,
      planLimit,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      overageUsed: planLimit > 0 ? Math.max(0, created - planLimit) : 0,
      overagePriceCents,
      level: usageLevel(created, planLimit),
      heldLeads: heldLeads ?? 0,
    }

    const availablePlans: PlanInfo[] = offeredPlans().map((p) => toPlanInfo(p))

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
