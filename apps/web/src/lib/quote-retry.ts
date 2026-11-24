/**
 * T-201: "Try again" for a request that could not be priced, from the
 * business's own dashboard (and the same route the app's "Price this request"
 * calls: POST /api/quotes/:id/process).
 *
 * Until T-201 only the platform's admin could price a failed request again
 * (T-178, /api/admin/quotes/:id/retry); the business was told to contact the
 * customer and quote by hand.
 *
 * IT IS NOT COUNTED AGAIN. A request is counted against the plan once, when
 * it arrives (`claimPlanQuote` in lib/quote-intake.ts and the messaging
 * intake), and that count is not given back when pricing fails. So trying
 * again claims nothing: the same request, the same one place in the count. A
 * setup test was never counted and is not counted here either.
 *
 * A request can be tried `BUSINESS_RETRY_LIMIT` times by the business. Each
 * try runs the whole pricing pipeline, the model included, and costs nothing
 * on the plan, so it cannot be endless. After that the page says to price it
 * by hand; the platform's admin retry has no such limit.
 *
 * The rules and the words are in lib/quote-retry-rules.ts (the page reads
 * them too); `retryFailedQuote` here is the one function with IO.
 */
import { NextResponse } from 'next/server'
import { contentForRetry } from '@/lib/retry-code'
import { enqueueQuoteJob } from '@/lib/queue'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { markQuoteFailed } from '@/lib/failed-quote'
import type { createAdminClient } from '@/lib/supabase/server'
import { BUSINESS_RETRY_LIMIT, RETRY_COPY, businessRetriesOf } from '@/lib/quote-retry-rules'

export { BUSINESS_RETRY_LIMIT, RETRY_COPY, businessRetriesOf, canBusinessRetry } from '@/lib/quote-retry-rules'

type Admin = ReturnType<typeof createAdminClient>

/**
 * The quote's content for a fresh run: the old error and its time are dropped
 * (as the admin's retry does), "the business was told" stays, so a second
 * failure sends no second email, and the try is counted.
 */
export function contentForBusinessRetry(content: unknown): Record<string, unknown> {
  return { ...contentForRetry(content), businessRetries: businessRetriesOf(content) + 1 }
}

/**
 * Price a failed request again. `admin` is the service-role client: the write
 * sets a new link token, which the business's own client may not.
 */
export async function retryFailedQuote(
  admin: Admin,
  quote: { id: string; status: string; content_json: unknown; quote_request_id: string; tenant_id: string }
): Promise<NextResponse> {
  if (businessRetriesOf(quote.content_json) >= BUSINESS_RETRY_LIMIT) {
    return NextResponse.json({ error: { code: 'RETRY_LIMIT', message: RETRY_COPY.limit } }, { status: 429 })
  }
  // T-180: a suspended business prices nothing, whatever its plan says
  const { data: tenant } = await admin.from('tenants').select('suspended_at').eq('id', quote.tenant_id).maybeSingle()
  if ((tenant as { suspended_at?: string | null } | null)?.suspended_at) {
    return NextResponse.json({ error: { code: 'ACCOUNT_PAUSED', message: RETRY_COPY.paused } }, { status: 403 })
  }

  const { token, hash } = generateQuoteToken()
  // Only a quote that is still failed is started: two presses, or two people, start one run
  const { data: started, error: updateError } = await admin
    .from('quotes')
    .update({
      status: 'queued',
      content_json: contentForBusinessRetry(quote.content_json),
      quote_token_hash: hash,
      token_expires_at: getTokenExpiry(30).toISOString(),
    })
    .eq('id', quote.id)
    .eq('tenant_id', quote.tenant_id)
    .eq('status', 'failed')
    .select('id')
  if (updateError) {
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: RETRY_COPY.notStarted } }, { status: 500 })
  }
  if (!started || started.length === 0) {
    // someone else started it a moment ago: it is being priced
    return NextResponse.json({ queued: true, retried: true })
  }

  try {
    await enqueueQuoteJob({
      quoteId: quote.id,
      quoteRequestId: quote.quote_request_id,
      tenantId: quote.tenant_id,
      timestamp: Date.now(),
      quoteToken: token,
    })
  } catch (error) {
    console.error(`[Retry] could not hand ${quote.id} to the pricing worker: ${error instanceof Error ? error.name : 'unknown error'}`)
    await markQuoteFailed(admin, quote.id, 'The retry could not be handed to the pricing worker')
    return NextResponse.json({ error: { code: 'QUEUE_FAILED', message: RETRY_COPY.notStarted } }, { status: 502 })
  }
  return NextResponse.json({ queued: true, retried: true })
}
