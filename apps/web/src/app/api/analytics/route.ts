import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
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

    // Fetch subscription and plan info
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select(`
        plan_id,
        plans!plan_id (
          name,
          monthly_estimate_limit
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .single()

    // Extract plan info (Supabase returns single relation as object)
    const plan = subscription?.plans as unknown as { name: string; monthly_estimate_limit: number } | null

    const usage: UsageData = {
      periodYYYYMM: currentPeriod,
      estimatesCreated: usageCounter?.estimates_created || 0,
      estimatesSent: usageCounter?.estimates_sent || 0,
      planLimit: plan?.monthly_estimate_limit || 200, // Default to starter plan limit
      planName: plan?.name || 'Free',
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
