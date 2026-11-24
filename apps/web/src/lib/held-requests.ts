/**
 * Requests saved without a price because the quote limit was reached (T-134),
 * and how they come to be priced.
 *
 *   - One at a time, by the business: "Price this request"
 *     (POST /api/quotes/[quoteId]/process).
 *   - T-201: by themselves, when a plan is bought. The free-quotes email has
 *     always said a saved request "is priced as soon as you pick a plan";
 *     until T-201 nothing did it.
 *
 * Both go the same way (`priceHeldRequest`): the quote is claimed against the
 * plan in one step inside the database (T-180), handed to the worker as an
 * ordinary pricing job, and from there on it is a request like any other: the
 * business's own review setting decides whether the customer is sent the
 * estimate or the business approves it first.
 *
 * What the automatic run will and will not do (`priceHeldRequestsForPlan`):
 *   - oldest first, so the customer who has waited longest is answered first;
 *   - only requests from the last 30 days (an older one is the business's to
 *     price by hand: its customer may have gone elsewhere);
 *   - at most 20 in one run (the rest keep "Price this request");
 *   - never past the plan's limit, and never as paid overage: it stops at the
 *     first request the plan has no room for;
 *   - never one that is already priced or already being priced: the request
 *     is taken with one conditional write, so two runs at once (Stripe sends
 *     an event again) price it once and count it once;
 *   - never when the count could not be written: an uncounted quote is right
 *     for a customer's new request (T-101), not for a batch we start;
 *   - never for a suspended business, and never a test request.
 * It never throws: a purchase is stored whatever happens here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { claimPlanQuote, maybeNotifyLimitReached, maybeWarnFreeQuotesLeft, recordOverageQuote, releasePlanQuote } from '@/lib/plan-limits'
import type { PlanClaim } from '@/lib/plan-limits'
import { enqueueQuoteJob } from '@/lib/queue'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { markQuoteFailed } from '@/lib/failed-quote'

export const HELD_AUTO_MAX = 20
export const HELD_AUTO_DAYS = 30

export type HeldPriceOutcome =
  | { priced: true; claim: PlanClaim }
  | { priced: false; why: 'limit' | 'suspended' | 'not_counted'; claim: PlanClaim }
  | { priced: false; why: 'not_held' | 'update_failed' | 'queue_failed' }

/**
 * Price one held request. `automatic` is the run after a purchase: no paid
 * overage, and nothing is priced when the count could not be written.
 * Needs the service-role client (the count is the server's record, T-173).
 */
export async function priceHeldRequest(
  admin: SupabaseClient,
  tenantId: string,
  quote: { id: string; quoteRequestId: string },
  options: { automatic?: boolean } = {}
): Promise<HeldPriceOutcome> {
  const claim = await claimPlanQuote(admin, tenantId, { overage: !options.automatic })
  if (!claim.claimed) return { priced: false, why: claim.reason === 'suspended' ? 'suspended' : 'limit', claim }
  if (options.automatic && !claim.counted) return { priced: false, why: 'not_counted', claim }

  // Take the request: only while it is still held. Two runs at once cannot both start it.
  const { token, hash } = generateQuoteToken()
  const taken = await admin
    .from('quotes')
    .update({ status: 'queued', content_json: {}, quote_token_hash: hash, token_expires_at: getTokenExpiry(30).toISOString() })
    .eq('id', quote.id)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending_review')
    .eq('content_json->>limitHold', 'true')
    .select('id')
  if (taken.error || !taken.data || taken.data.length === 0) {
    // counted but not started: give the count back
    await releasePlanQuote(admin, tenantId, claim)
    return { priced: false, why: taken.error ? 'update_failed' : 'not_held' }
  }

  const { data: tenant } = await admin.from('tenants').select('name').eq('id', tenantId).single()
  const businessName = (tenant as { name?: string } | null)?.name || 'Your business'
  await maybeWarnFreeQuotesLeft(admin, tenantId, businessName, claim.status)
  await maybeNotifyLimitReached(admin, tenantId, businessName)
  if (claim.overage) await recordOverageQuote(claim.status, quote.id)

  try {
    await enqueueQuoteJob({ quoteId: quote.id, quoteRequestId: quote.quoteRequestId, tenantId, timestamp: Date.now(), quoteToken: token })
  } catch (error) {
    console.error('[HeldRequests] Could not hand a held request to the pricing worker:', error instanceof Error ? error.message : 'unknown')
    await markQuoteFailed(admin as Parameters<typeof markQuoteFailed>[0], quote.id, 'The request could not be handed to the pricing worker')
    return { priced: false, why: 'queue_failed' }
  }
  return { priced: true, claim }
}

export interface HeldRunResult {
  /** held requests found within the bounds */
  found: number
  priced: number
  /** why the run ended before the last one, when it did */
  stopped: 'limit' | 'suspended' | 'not_counted' | null
}

/**
 * T-201: a plan has just been bought. Price the requests that were saved
 * without a price, within the bounds at the top of this file. Never throws.
 */
export async function priceHeldRequestsForPlan(
  admin: SupabaseClient,
  tenantId: string,
  options: { max?: number; days?: number; now?: Date } = {}
): Promise<HeldRunResult> {
  const result: HeldRunResult = { found: 0, priced: 0, stopped: null }
  try {
    const since = new Date((options.now ?? new Date()).getTime() - (options.days ?? HELD_AUTO_DAYS) * 86_400_000).toISOString()
    const { data, error } = await admin
      .from('quotes')
      .select('id, quote_request_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_review')
      .eq('content_json->>limitHold', 'true')
      .eq('is_test', false)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(options.max ?? HELD_AUTO_MAX)
    if (error) {
      console.error('[HeldRequests] Could not read the held requests:', error.code ?? error.message)
      return result
    }
    const held = (data ?? []) as Array<{ id: string; quote_request_id: string }>
    result.found = held.length
    for (const quote of held) {
      const outcome = await priceHeldRequest(admin, tenantId, { id: quote.id, quoteRequestId: quote.quote_request_id }, { automatic: true })
      if (outcome.priced) {
        result.priced += 1
        continue
      }
      if (outcome.why === 'limit' || outcome.why === 'suspended' || outcome.why === 'not_counted') {
        result.stopped = outcome.why
        break
      }
      // not_held (someone else started it), update_failed, queue_failed: carry on with the next
    }
    if (result.found > 0) console.log(`[HeldRequests] After the purchase: ${result.priced} of ${result.found} held requests sent for pricing${result.stopped ? ` (stopped: ${result.stopped})` : ''}`)
  } catch (error) {
    console.error('[HeldRequests] The run after a purchase failed:', error instanceof Error ? error.message : 'unknown')
  }
  return result
}
