/**
 * POST /api/quotes/:quoteId/feedback/:feedbackId/answered — "Mark as answered"
 * on the quote page (T-157).
 *
 * The business has dealt with a customer question (or an old review request)
 * outside the app. This saves that: the feedback becomes `acknowledged`, and
 * when the quote was waiting on it (`feedback_received`) with nothing else
 * pending, the quote goes back to `viewed`.
 *
 * Signed-in business only (dashboard cookie or app Bearer). Every read and
 * write is scoped to the user's tenant AND this quote, so an id from another
 * business, or from another quote, finds nothing (404). Pressing it twice is
 * harmless: the second press reports the saved state and changes nothing.
 */

import { NextResponse } from 'next/server'
import { statusAfterQuestionAnswered } from '@estimator/shared'
import type { MarkFeedbackAnsweredResponse, QuoteStatus } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'

export const dynamic = 'force-dynamic'

/** Feedback ids are prefixed text ("fb_…"; older rows may be uuids). Anything else can't be one. */
const FEEDBACK_ID = /^[A-Za-z0-9_-]{1,80}$/
const notFound = () =>
  NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Question not found' } }, { status: 404 })

export async function POST(
  _request: Request,
  { params }: { params: { quoteId: string; feedbackId: string } }
) {
  try {
    const auth = await requireTenant()
    if (!auth.ok) return auth.response
    const { supabase, tenantId } = auth
    const { quoteId, feedbackId } = params
    if (!FEEDBACK_ID.test(feedbackId)) return notFound()

    const { data: quote } = await supabase
      .from('quotes')
      .select('id, status')
      .eq('id', quoteId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!quote) return notFound()

    const { data: feedback } = await supabase
      .from('quote_feedback')
      .select('id, status')
      .eq('id', feedbackId)
      .eq('quote_id', quoteId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!feedback) return notFound()

    let feedbackStatus = feedback.status as 'pending' | 'acknowledged' | 'resolved'
    if (feedbackStatus === 'pending') {
      const { error: updateError } = await supabase
        .from('quote_feedback')
        .update({ status: 'acknowledged' })
        .eq('id', feedbackId)
        .eq('quote_id', quoteId)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
      if (updateError) {
        console.error('[FeedbackAnswered] update failed:', updateError.message)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Could not save that. Please try again.' } },
          { status: 500 }
        )
      }
      feedbackStatus = 'acknowledged'
    }

    const { count, error: countError } = await supabase
      .from('quote_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('quote_id', quoteId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
    // If the count can't be read, assume something is still pending: the
    // quote's status is only moved on a known zero
    if (countError) console.error('[FeedbackAnswered] pending count failed:', countError.message)
    const pendingLeft = countError ? 1 : count ?? 0

    let quoteStatus = quote.status as QuoteStatus
    const nextStatus = statusAfterQuestionAnswered(quoteStatus, pendingLeft)
    if (nextStatus !== quoteStatus) {
      // The status guard: a quote the customer accepted or declined a moment
      // ago is never moved back
      const { data: moved } = await supabase
        .from('quotes')
        .update({ status: nextStatus })
        .eq('id', quoteId)
        .eq('tenant_id', tenantId)
        .eq('status', quoteStatus)
        .select('id')
      if (moved && moved.length > 0) quoteStatus = nextStatus
    }

    const response: MarkFeedbackAnsweredResponse = {
      feedbackId,
      feedbackStatus,
      quoteStatus,
      pendingLeft,
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error('[FeedbackAnswered] error:', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
