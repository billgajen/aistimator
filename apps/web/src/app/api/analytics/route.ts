import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkPlanLimit } from '@/lib/plan-limits'
import { getPlan } from '@estimator/shared'
import type { AnalyticsResponse, AnalyticsMetrics, UsageData } from '@estimator/shared'

/**
 * GET /api/analytics
 * Get quote metrics and usage data for the current tenant
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

    // Get current month period (YYYYMM format)
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

    // Fetch quote counts by status
    const { data: quotes, error: quotesError } = await supabase
      .from('quotes')
      .select('status')
      .eq('tenant_id', tenantId)

    if (quotesError) {
      console.error('Error fetching quotes:', quotesError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch quotes' } },
        { status: 500 }
      )
    }

    // Calculate metrics
    const totalQuotes = quotes?.length || 0
    const quotesViewed = quotes?.filter((q) =>
      ['viewed', 'accepted', 'paid'].includes(q.status)
    ).length || 0
    const quotesAccepted = quotes?.filter((q) =>
      ['accepted', 'paid'].includes(q.status)
    ).length || 0
    const quotesPaid = quotes?.filter((q) => q.status === 'paid').length || 0

    // Calculate conversion rate (accepted / total sent)
    const quotesSent = quotes?.filter((q) =>
      ['sent', 'viewed', 'accepted', 'paid', 'expired'].includes(q.status)
    ).length || 0
    const conversionRate = quotesSent > 0
      ? Math.round((quotesAccepted / quotesSent) * 100)
      : 0

    const metrics: AnalyticsMetrics = {
      totalQuotes,
      quotesViewed,
      quotesAccepted,
      quotesPaid,
      conversionRate,
    }

    // Fetch usage counter for current month
    const { data: usageCounter } = await supabase
      .from('usage_counters')
      .select('estimates_created, estimates_sent')
      .eq('tenant_id', tenantId)
      .eq('period_yyyymm', currentPeriod)
      .single()

    // T-152: the same limit and count as enforcement and billing (the free
    // allowance counts every month; plans count this month)
    const [{ data: subscription }, limit] = await Promise.all([
      supabase.from('subscriptions').select('plan_id, status').eq('tenant_id', tenantId).single(),
      checkPlanLimit(supabase, tenantId),
    ])
    const live = subscription && ['active', 'trialing', 'past_due'].includes(subscription.status as string)
    const plan = live ? getPlan(subscription.plan_id as string) : null

    const usage: UsageData = {
      periodYYYYMM: currentPeriod,
      estimatesCreated: limit.used,
      estimatesSent: usageCounter?.estimates_sent || 0,
      planLimit: limit.unlimited ? 0 : limit.limit,
      planName: plan?.name || 'Free',
      per: limit.per,
    }

    const response: AnalyticsResponse = {
      metrics,
      usage,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Analytics error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
