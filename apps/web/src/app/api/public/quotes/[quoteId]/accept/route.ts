import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import type { AcceptQuoteResponse } from '@estimator/shared'

/**
 * POST /api/public/quotes/:quoteId/accept
 * Accept a quote. Requires valid token in body.
 */
export async function POST(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const body = await request.json()
    const token = body.token

    if (!token) {
      return NextResponse.json(
        { error: { code: 'MISSING_TOKEN', message: 'Token is required' } },
        { status: 401 }
      )
    }

    // Hash the token to compare with stored hash
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const supabase = createAdminClient()

    // Fetch quote with token validation
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, status, quote_token_hash, token_expires_at, accepted_at')
      .eq('id', quoteId)
      .eq('quote_token_hash', tokenHash)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found or invalid token' } },
        { status: 404 }
      )
    }

    // Check token expiry
    if (quote.token_expires_at && new Date(quote.token_expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'TOKEN_EXPIRED', message: 'Quote link has expired' } },
        { status: 410 }
      )
    }

    // Check if already accepted
    if (quote.accepted_at) {
      return NextResponse.json(
        { error: { code: 'ALREADY_ACCEPTED', message: 'Quote has already been accepted' } },
        { status: 409 }
      )
    }

    // Check if quote is in a valid state to accept
    const validStatuses = ['sent', 'viewed', 'revised', 'feedback_received']
    if (!validStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot accept quote with status: ${quote.status}` } },
        { status: 400 }
      )
    }

    // Update quote status to accepted
    const acceptedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'accepted',
        accepted_at: acceptedAt,
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Failed to accept quote:', updateError)
      return NextResponse.json(
        { error: { code: 'UPDATE_FAILED', message: 'Failed to accept quote' } },
        { status: 500 }
      )
    }

    const response: AcceptQuoteResponse = {
      status: 'accepted',
      acceptedAt,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Accept quote error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
