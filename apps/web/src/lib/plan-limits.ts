import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentPeriod } from './usage'
import { sendEmail, isPostmarkConfigured } from './postmark'
import { generateLimitReachedEmailHtml } from './email-templates'
import { freeQuotesLeftEmail } from './billing-emails'
import { getStripeClient, reportOverageMeterEvent, formatPrice } from './stripe'
import { getPlan, freeAllowance, freeQuotesLeftLine, freeQuotesUsed, noSubscriptionLimit, subscriptionLive } from '@qolumns/shared'
import type { UsageRow } from '@qolumns/shared'
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
  /**
   * T-180: a platform admin suspended the business. Nothing new is priced
   * (requests are held, like at the limit) until it is restored.
   */
  suspended?: boolean
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
 * T-152: priced quotes counted against an allowance — this month's row, or,
 * for the free quotes that never reset, the quotes priced as free ones in
 * every month together (T-201: `freeQuotesUsed`; a quote priced on a plan is
 * not one of them). Pure.
 * (Tests and unfinished requests never increment these counters.)
 */
export function usedForAllowance(
  rows: UsageRow[] | null | undefined,
  per: 'month' | 'total',
  period: string
): number {
  const list = rows ?? []
  if (per === 'total') return freeQuotesUsed(list)
  return list.find((r) => r.period_yyyymm === period)?.estimates_created ?? 0
}

/**
 * T-202: what a business falls back on when its plan ends (a payment that was
 * never taken, a cancellation): its region's allowance without a plan, with
 * the numbers of this business. Read by the payment-failed email, so it says
 * what will really happen and not "new requests are then saved".
 *   per 'total'  the free quotes that never reset: `left` are still unused
 *                (a quote priced on the plan was never one of them, T-201)
 *   per 'month'  the old monthly allowance (pre-US businesses): `limit` a month
 * Pure. The same rule as `checkPlanLimit` below applies once there is no plan.
 */
export interface AfterPlanEnds {
  per: 'month' | 'total'
  limit: number
  left: number
}

export function allowanceAfterPlan(region: string | null | undefined, rows: UsageRow[] | null | undefined, period: string): AfterPlanEnds {
  const allowance = freeAllowance(region)
  const used = usedForAllowance(rows, allowance.per, period)
  return { per: allowance.per, limit: allowance.quotes, left: Math.max(0, allowance.quotes - used) }
}

/** Reads it for one business. Null when it cannot be read: the email then states the rule without numbers. */
export async function readAllowanceAfterPlan(supabase: SupabaseClient, tenantId: string): Promise<AfterPlanEnds | null> {
  try {
    const [{ data: tenant, error: tenantError }, { data: rows, error: usageError }] = await Promise.all([
      supabase.from('tenants').select('region').eq('id', tenantId).single(),
      supabase.from('usage_counters').select('period_yyyymm, estimates_created, plan_estimates_created').eq('tenant_id', tenantId),
    ])
    if (tenantError || usageError || !tenant) return null
    return allowanceAfterPlan((tenant as { region?: string | null }).region, rows as UsageRow[] | null, getCurrentPeriod())
  } catch {
    return null
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

    const [{ data: subscription }, { data: usageRows }, { data: tenant }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('status, plan_id, stripe_customer_id, plans!plan_id (stripe_metered_price_id)')
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('usage_counters')
        .select('period_yyyymm, estimates_created, plan_estimates_created')
        .eq('tenant_id', tenantId),
      supabase.from('tenants').select('region, suspended_at').eq('id', tenantId).single(),
    ])

    // T-134: limits, overage and features come from the plan definitions in
    // @qolumns/shared — never from DB numbers. Stripe's metered price id is
    // account-specific data and stays on the plans row (T-102).
    const live = subscription && subscriptionLive(subscription.status as string)
    const plan = live ? getPlan(subscription.plan_id as string) : null
    const meteredPriceId = (subscription?.plans as { stripe_metered_price_id?: string | null } | null)
      ?.stripe_metered_price_id
    // T-152: a live plan counts this month; no plan = the region's free
    // allowance (US: 10 in total, never resets; legacy GB: 50 a month)
    const allowance = plan ? null : freeAllowance((tenant as { region?: string } | null)?.region)
    const limit = plan ? plan.quoteLimit : allowance!.quotes
    const per = allowance?.per ?? 'month'
    const used = usedForAllowance(usageRows as UsageRow[] | null, per, period)

    const status = evaluateLimit(
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
    // T-180: a suspended business prices nothing, whatever its plan says
    const suspended = Boolean((tenant as { suspended_at?: string | null } | null)?.suspended_at)
    return suspended ? { ...status, allowed: false, overageAvailable: false, overagePriceCents: null, suspended: true } : status
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

/** What `claimPlanQuote` decided for one request */
export interface PlanClaim {
  /** true: this request is a priced quote (and it has been counted, unless `counted` is false) */
  claimed: boolean
  /** why it was not claimed; 'ok' when it was */
  reason: 'ok' | 'limit' | 'suspended'
  /** false only when the count could not be written (the request still goes ahead) */
  counted: boolean
  /** counted beyond the limit, as metered overage (a plan that has it) */
  overage: boolean
  /** the plan's terms, with `used` as it stands after this claim */
  status: PlanLimitStatus
  /** the period the claim was counted in (needed to give it back) */
  period: string
}

/**
 * T-180 (AD-063): decide whether one request is a priced quote AND count it,
 * in one step inside the database (`claim_plan_quote`, migration 44).
 *
 * Before, the limit was read in one step and the count written in another, so
 * requests arriving together could all pass a limit with one place left, and
 * the count itself lost updates. Now the database takes one business at a
 * time: 20 requests at once are 20 claims, and the 10 free quotes or the
 * plan's monthly number hold exactly.
 *
 * The limit and what it counts (this month, or in total) come from the plan
 * definitions through `checkPlanLimit`; the database is only told the number.
 * One request is one quote, however many services it carries (T-179).
 *
 * Fails open: if the database call fails, the request is priced and the miss
 * is logged. A billing fault must never cost a customer's request (T-101).
 * Needs the service-role client.
 */
export async function claimPlanQuote(
  supabase: SupabaseClient,
  tenantId: string,
  /** T-201: `overage: false` never counts past the limit as metered overage (requests priced by themselves after a purchase) */
  options: { overage?: boolean } = {}
): Promise<PlanClaim> {
  const period = getCurrentPeriod()
  const status = await checkPlanLimit(supabase, tenantId)
  const claim = async (limit: number) =>
    supabase.rpc('claim_plan_quote', { p_tenant_id: tenantId, p_period: period, p_limit: limit, p_per: status.per })
  const read = (data: unknown) => (Array.isArray(data) ? data[0] : data) as { claimed?: boolean; used?: number; reason?: string } | null

  try {
    const first = await claim(status.unlimited ? 0 : status.limit)
    const row = read(first.data)
    if (first.error || !row) throw new Error(first.error?.code ?? first.error?.message ?? 'no answer')
    const used = typeof row.used === 'number' ? row.used : status.used

    if (row.claimed) {
      return { claimed: true, reason: 'ok', counted: true, overage: false, status: { ...status, used, allowed: true, suspended: false }, period }
    }
    if (row.reason === 'suspended') {
      return { claimed: false, reason: 'suspended', counted: false, overage: false, status: { ...status, used, allowed: false, overageAvailable: false, suspended: true }, period }
    }
    // Over the limit. A plan with metered overage counts it anyway and bills it (T-102).
    if (status.overageAvailable && options.overage !== false) {
      const extra = await claim(0)
      const extraRow = read(extra.data)
      if (extra.error || !extraRow?.claimed) throw new Error(extra.error?.code ?? 'overage claim refused')
      return { claimed: true, reason: 'ok', counted: true, overage: true, status: { ...status, used: extraRow.used ?? used + 1, allowed: false }, period }
    }
    return { claimed: false, reason: 'limit', counted: false, overage: false, status: { ...status, used, allowed: false }, period }
  } catch (error) {
    console.error('[PlanLimits] Could not claim a quote, pricing the request anyway (not counted):', error instanceof Error ? error.message : 'unknown')
    return { claimed: true, reason: 'ok', counted: false, overage: false, status, period }
  }
}

/** Give a claim back: the quote could not be saved after it was counted. Never throws. */
export async function releasePlanQuote(supabase: SupabaseClient, tenantId: string, claim: PlanClaim): Promise<void> {
  if (!claim.claimed || !claim.counted) return
  try {
    // T-201: the kind of claim goes back with it, so the plan's share of the month stays exact
    const { error } = await supabase.rpc('release_plan_quote', { p_tenant_id: tenantId, p_period: claim.period, p_per: claim.status.per })
    if (error) console.error('[PlanLimits] Could not give a claim back:', error.code ?? error.message)
  } catch (error) {
    console.error('[PlanLimits] Could not give a claim back:', error instanceof Error ? error.message : 'unknown')
  }
}

/**
 * T-180: the one "2 free quotes left" email. Sent once per business, ever:
 * the stamp on the tenant is claimed first, so two requests arriving together
 * send one email. Only for the free allowance. Never throws.
 */
export async function maybeWarnFreeQuotesLeft(
  supabase: SupabaseClient,
  tenantId: string,
  businessName: string,
  status: PlanLimitStatus
): Promise<void> {
  try {
    if (status.per !== 'total') return
    const line = freeQuotesLeftLine(status.used, status.limit)
    if (!line) return

    const { data: claimed } = await supabase
      .from('tenants')
      .update({ free_warning_sent_at: new Date().toISOString() })
      .eq('id', tenantId)
      .is('free_warning_sent_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) return // already sent

    if (!isPostmarkConfigured()) return
    const to = await businessEmailFor(tenantId)
    if (!to) return
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    const email = freeQuotesLeftEmail({ businessName, used: status.used, limit: status.limit, billingUrl: `${appUrl}/app/settings/billing` })
    if (!email) return
    await sendEmail({ from: { kind: 'business' }, to, subject: email.subject, htmlBody: email.html, tag: 'free-quotes-left' })
    console.log('[PlanLimits] Free-quotes-left notice sent')
  } catch (error) {
    console.error('[PlanLimits] Failed to send the free-quotes-left notice:', error instanceof Error ? error.message : 'unknown')
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
