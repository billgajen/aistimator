import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentPeriod } from './usage'
import { sendEmail, isPostmarkConfigured } from './postmark'
import { generateLimitReachedEmailHtml } from './email-templates'
import { getStripeClient, reportOverageMeterEvent, formatPrice } from './stripe'
import { getPlan, freeAllowance, noSubscriptionLimit } from '@estimator/shared'
import { businessEmailFor } from './business-email'

/** Legacy (GB) monthly allowance for tenants without a subscription — kept for callers/tests. */
export const DEFAULT_TRIAL_LIMIT = noSubscriptionLimit('GB')

export interface PlanLimitStatus {
  /** true while within the plan limit (or unlimited) */
  allowed: boolean
  used: number
  limit: number
  /** limit <= 0 means the plan is unlimited */
  unlimited: boolean
  /**
   * T-152: what `used` and `limit` count — this calendar month (plans and the
   * legacy GB allowance) or all time (the free allowance, which never resets)
   */
  per: 'month' | 'total'
  /**
   * T-102: over-limit quotes may proceed as metered overage when the plan
   * defines an overage price AND the subscription is active (never free/trial).
   */
  overageAvailable: boolean
  /** Per-quote overage price when overageAvailable */
  overagePriceCents: number | null
  /** Stripe customer to meter overage events against */
  stripeCustomerId: string | null
}

/**
 * Pure limit evaluation — kept separate from IO for testability.
 */
export function evaluateLimit(
  used: number,
  limit: number,
  overage?: { priceCents: number | null; subscriptionActive: boolean; stripeCustomerId: string | null },
  per: 'month' | 'total' = 'month'
): PlanLimitStatus {
  const unlimited = limit <= 0
  const overageAvailable = Boolean(
    overage &&
      overage.priceCents !== null &&
      overage.priceCents > 0 &&
      overage.subscriptionActive &&
      overage.stripeCustomerId
  )
  return {
    allowed: unlimited || used < limit,
    used,
    limit,
    unlimited,
    per,
    overageAvailable,
    overagePriceCents: overageAvailable ? overage!.priceCents : null,
    stripeCustomerId: overage?.stripeCustomerId ?? null,
  }
}

/**
 * T-152: priced quotes counted against an allowance — this month's row, or
 * every month's rows summed for an allowance that never resets. Pure.
 * (Tests and unfinished requests never increment these counters.)
 */
export function usedForAllowance(
  rows: Array<{ period_yyyymm: string; estimates_created: number | null }> | null | undefined,
  per: 'month' | 'total',
  period: string
): number {
  const list = rows ?? []
  if (per === 'total') return list.reduce((sum, r) => sum + (r.estimates_created ?? 0), 0)
  return list.find((r) => r.period_yyyymm === period)?.estimates_created ?? 0
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

    const [{ data: subscription }, { data: usageRows }, { data: tenant }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('status, plan_id, stripe_customer_id, plans!plan_id (stripe_metered_price_id)')
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('usage_counters')
        .select('period_yyyymm, estimates_created')
        .eq('tenant_id', tenantId),
      supabase.from('tenants').select('region').eq('id', tenantId).single(),
    ])

    // T-134: limits, overage and features come from the plan definitions in
    // @estimator/shared — never from DB numbers. Stripe's metered price id is
    // account-specific data and stays on the plans row (T-102).
    const live = subscription && ['active', 'trialing', 'past_due'].includes(subscription.status as string)
    const plan = live ? getPlan(subscription.plan_id as string) : null
    const meteredPriceId = (subscription?.plans as { stripe_metered_price_id?: string | null } | null)
      ?.stripe_metered_price_id
    // T-152: a live plan counts this month; no plan = the region's free
    // allowance (US: 10 in total, never resets; legacy GB: 50 a month)
    const allowance = plan ? null : freeAllowance((tenant as { region?: string } | null)?.region)
    const limit = plan ? plan.quoteLimit : allowance!.quotes
    const per = allowance?.per ?? 'month'
    const used = usedForAllowance(
      usageRows as Array<{ period_yyyymm: string; estimates_created: number | null }> | null,
      per,
      period
    )

    return evaluateLimit(
      used,
      limit,
      {
        priceCents: plan?.overageEnabled ? plan.overagePriceCents ?? null : null,
        // Overage only bills reliably on an active paid subscription — never trial
        subscriptionActive: subscription?.status === 'active' && Boolean(meteredPriceId),
        stripeCustomerId: subscription?.stripe_customer_id ?? null,
      },
      per
    )
  } catch (error) {
    console.error('[PlanLimits] Failed to check plan limit, allowing request:', error)
    return {
      allowed: true,
      used: 0,
      limit: DEFAULT_TRIAL_LIMIT,
      unlimited: false,
      per: 'month',
      overageAvailable: false,
      overagePriceCents: null,
      stripeCustomerId: null,
    }
  }
}

/**
 * Meter one over-limit quote to Stripe (T-102). Fire-and-forget from the
 * caller's perspective — a metering failure must never fail the quote (we
 * absorb the cost rather than lose the lead), but it is logged loudly.
 */
export async function recordOverageQuote(
  status: PlanLimitStatus,
  quoteId: string
): Promise<void> {
  if (!status.overageAvailable || !status.stripeCustomerId) return
  const stripe = getStripeClient()
  if (!stripe) {
    console.error('[PlanLimits] Overage quote but Stripe not configured — not billed:', quoteId)
    return
  }
  const result = await reportOverageMeterEvent(stripe, {
    customerId: status.stripeCustomerId,
    quoteId,
  })
  if (result.success) {
    console.log(`[PlanLimits] Overage quote metered: ${quoteId}`)
  } else {
    console.error(`[PlanLimits] OVERAGE NOT BILLED for quote ${quoteId}: ${result.error}`)
  }
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

    // T-157: the one business email rule (setting, else the first user's account email)
    const to = await businessEmailFor(tenantId)
    if (!to) {
      console.error('[PlanLimits] Limit reached but no business email resolved for tenant')
      return
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    // T-102: with overage active the message is "billing continues", not "paused"
    const overagePriceLabel =
      status.overageAvailable && status.overagePriceCents
        ? formatPrice(status.overagePriceCents, 'usd')
        : undefined
    await sendEmail({
      from: { kind: 'business' },
      to,
      subject: overagePriceLabel
        ? `Monthly quote limit reached — extra quotes now ${overagePriceLabel} each`
        : status.per === 'total'
          ? `You've used your ${status.limit} free quotes`
          : `You've reached your monthly quote limit (${status.limit})`,
      htmlBody: generateLimitReachedEmailHtml({
        businessName,
        used: status.used,
        limit: status.limit,
        billingUrl: `${appUrl}/app/settings/billing`,
        overagePriceLabel,
        per: status.per,
      }),
      tag: 'plan-limit-reached',
    })
    console.log('[PlanLimits] Limit-reached notification sent')
  } catch (error) {
    // Notification failures must never affect quote processing
    console.error('[PlanLimits] Failed to send limit notification:', error)
  }
}
