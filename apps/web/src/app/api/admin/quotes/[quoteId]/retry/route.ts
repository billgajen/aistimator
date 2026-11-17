import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin, logAdminActivity } from '@/lib/admin'
import { enqueueQuoteJob } from '@/lib/queue'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { markQuoteFailed } from '@/lib/failed-quote'
import { RETRY_CODE_HEADER, contentForRetry, looksLikeRetryCode, retryCodeValid } from '@/lib/retry-code'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const forbidden = () => NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, { status: 403 })

/**
 * POST /api/admin/quotes/:quoteId/retry
 * Price a failed (or stuck) quote again. For the platform admin: either
 * signed in, or holding the one-time code `scripts/retry-failed-quote.sh`
 * wrote onto the quote (T-178, lib/retry-code.ts).
 *
 * The quote gets a new link for the emails the worker sends; the link the
 * customer already has keeps working (every earlier link is kept, T-157).
 */
export async function POST(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  const admin = await verifyAdmin()
  const code = request.headers.get(RETRY_CODE_HEADER)
  // Nothing is read for a caller who is neither signed in as admin nor holding something shaped like a code
  if (!admin && !looksLikeRetryCode(code)) return forbidden()

  try {
    const { quoteId } = params
    const supabase = createAdminClient()

    // Get quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, tenant_id, quote_request_id, status, content_json')
      .eq('id', quoteId)
      .single()

    if (!admin && !retryCodeValid(code, quote?.content_json)) return forbidden()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Only allow retry for failed or stuck quotes
    const retryableStatuses = ['failed', 'queued', 'generating']
    if (!retryableStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot retry quote with status '${quote.status}'` } },
        { status: 400 }
      )
    }

    // Generate new token for the retry
    const { token, hash } = generateQuoteToken()
    const tokenExpiry = getTokenExpiry(30)

    // Update quote to queued status with new token. The one-time code is
    // removed in the same write, so it cannot be used twice.
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'queued',
        content_json: contentForRetry(quote.content_json),
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Failed to update quote for retry:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update quote' } },
        { status: 500 }
      )
    }

    // Enqueue the job. If the worker cannot be reached the quote goes back to
    // failed (it used to stay "queued" with nothing working on it).
    try {
      await enqueueQuoteJob({
        quoteId: quote.id,
        quoteRequestId: quote.quote_request_id,
        tenantId: quote.tenant_id,
        timestamp: Date.now(),
        quoteToken: token,
      })
    } catch {
      await markQuoteFailed(supabase, quote.id, 'The retry could not be handed to the pricing worker')
      return NextResponse.json({ error: { code: 'QUEUE_FAILED', message: 'Could not reach the pricing worker. The quote is still marked failed; try again.' } }, { status: 502 })
    }

    // Log activity
    if (admin) {
      await logAdminActivity(supabase, {
        adminUserId: admin.userId,
        action: 'retry',
        resourceType: 'quote',
        resourceId: quoteId,
        details: { previousStatus: quote.status },
      })
    } else {
      console.log(`[Admin] Quote ${quoteId} retried with a one-time code (was ${quote.status})`)
    }

    return NextResponse.json({
      success: true,
      message: 'Quote job queued for retry',
      quoteId,
      status: 'queued',
    })
  } catch (error) {
    console.error('Admin retry error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
