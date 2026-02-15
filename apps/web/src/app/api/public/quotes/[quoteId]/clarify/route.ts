import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import type { ClarifyQuoteRequest } from '@estimator/shared'

/**
 * POST /api/public/quotes/:quoteId/clarify
 * Accepts customer answers to clarification questions.
 * Validates token + quote status, stores answers, re-enqueues for processing.
 */
export async function POST(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const body: ClarifyQuoteRequest = await request.json()

    if (!body.token) {
      return NextResponse.json(
        { error: { code: 'MISSING_TOKEN', message: 'Token is required' } },
        { status: 401 }
      )
    }

    if (!body.answers || body.answers.length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Answers are required' } },
        { status: 400 }
      )
    }

    const tokenHash = createHash('sha256').update(body.token).digest('hex')
    const supabase = createAdminClient()

    // Fetch quote and validate token + status
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, status, quote_token_hash, token_expires_at, quote_request_id')
      .eq('id', quoteId)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Validate token
    if (quote.quote_token_hash !== tokenHash) {
      return NextResponse.json(
        { error: { code: 'INVALID_TOKEN', message: 'Invalid token' } },
        { status: 401 }
      )
    }

    // Check token expiry
    if (quote.token_expires_at && new Date(quote.token_expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'TOKEN_EXPIRED', message: 'Token has expired' } },
        { status: 401 }
      )
    }

    // Validate status is awaiting_clarification
    if (quote.status !== 'awaiting_clarification') {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Quote is not awaiting clarification (status: ${quote.status})` } },
        { status: 400 }
      )
    }

    // Store answers and update status to re-process
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        clarification_answers_json: body.answers,
        clarification_count: 1,
        status: 'queued', // Re-enqueue for processing
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('[Clarify] Failed to update quote:', updateError)
      return NextResponse.json(
        { error: { code: 'UPDATE_FAILED', message: 'Failed to save answers' } },
        { status: 500 }
      )
    }

    // Note: The worker will pick up the re-queued quote and process it again.
    // On re-processing, clarification_count >= 1 means the quality gate is skipped.

    return NextResponse.json({
      success: true,
      message: 'Thank you! Your answers have been received. Your updated quote will be ready shortly.',
    })
  } catch (error) {
    console.error('[Clarify] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
