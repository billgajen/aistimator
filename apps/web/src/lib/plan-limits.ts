import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentPeriod } from './usage'
import { sendEmail, isPostmarkConfigured } from './postmark'
import { generateLimitReachedEmailHtml } from './email-templates'

/** Default monthly estimate limit for tenants without a subscription (trial). Matches /api/billing. */
export const DEFAULT_TRIAL_LIMIT = 50

export interface PlanLimitStatus {
  allowed: boolean
  used: number
  limit: number
  /** limit <= 0 means the plan is unlimited */
  unlimited: boolean
}

/**
 * Pure limit evaluation — kept separate from IO for testability.
 */
export function evaluateLimit(used: number, limit: number): PlanLimitStatus {
  const unlimited = limit <= 0
  return {
    allowed: unlimited || used < limit,
    used,
    limit,
    unlimited,
  }
}

/**
 * Check whether the tenant may create another estimate this period.
 * Limit comes from the subscription's plan; tenants without a subscription
 * get the trial default. Fails open on read errors — a billing lookup
 * failure must never block a customer quote (log and allow).
 */
export async function checkPlanLimit(
  supabase: SupabaseClient,
  tenantId: string
): Promise<PlanLimitStatus> {
  try {
    const period = getCurrentPeriod()

    const [{ data: subscription }, { data: usageCounter }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('status, plans!plan_id (monthly_estimate_limit)')
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('usage_counters')
        .select('estimates_created')
        .eq('tenant_id', tenantId)
        .eq('period_yyyymm', period)
        .single(),
    ])

    const plan = subscription?.plans as { monthly_estimate_limit: number } | null | undefined
    const limit = plan?.monthly_estimate_limit ?? DEFAULT_TRIAL_LIMIT
    const used = usageCounter?.estimates_created ?? 0

    return evaluateLimit(used, limit)
  } catch (error) {
    console.error('[PlanLimits] Failed to check plan limit, allowing request:', error)
    return { allowed: true, used: 0, limit: DEFAULT_TRIAL_LIMIT, unlimited: false }
  }
}

/**
 * Resolve the business notification email: tenants.notification_email override,
 * falling back to the tenant owner's account email (same resolution as the worker).
 */
async function resolveBusinessEmail(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string | null> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('notification_email')
    .eq('id', tenantId)
    .single()

  if (tenant?.notification_email) return tenant.notification_email

  const { data: ownerProfile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (!ownerProfile?.id) return null
  const { data: authUser } = await supabase.auth.admin.getUserById(ownerProfile.id)
  return authUser?.user?.email ?? null
}

/**
 * If the tenant has hit their monthly limit and hasn't been notified this period,
 * send the limit-reached email exactly once. Safe to call after every increment —
 * the conditional update on limit_notified_at IS NULL guards against races.
 */
export async function maybeNotifyLimitReached(
  supabase: SupabaseClient,
  tenantId: string,
  businessName: string
): Promise<void> {
  try {
    const period = getCurrentPeriod()
    const status = await checkPlanLimit(supabase, tenantId)
    if (status.unlimited || status.used < status.limit) return

    // Claim the notification slot atomically; only one caller wins per period
    const { data: claimed } = await supabase
      .from('usage_counters')
      .update({ limit_notified_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('period_yyyymm', period)
      .is('limit_notified_at', null)
      .select('id')

    if (!claimed || claimed.length === 0) return // already notified this period

    if (!isPostmarkConfigured()) {
      console.warn('[PlanLimits] Limit reached but Postmark not configured; skipping email')
      return
    }

    const to = await resolveBusinessEmail(supabase, tenantId)
    if (!to) {
      console.error('[PlanLimits] Limit reached but no business email resolved for tenant')
      return
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    await sendEmail({
      to,
      subject: `You've reached your monthly quote limit (${status.limit})`,
      htmlBody: generateLimitReachedEmailHtml({
        businessName,
        used: status.used,
        limit: status.limit,
        billingUrl: `${appUrl}/app/billing`,
      }),
      tag: 'plan-limit-reached',
    })
    console.log('[PlanLimits] Limit-reached notification sent')
  } catch (error) {
    // Notification failures must never affect quote processing
    console.error('[PlanLimits] Failed to send limit notification:', error)
  }
}
