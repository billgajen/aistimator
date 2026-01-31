import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin, logAdminActivity } from '@/lib/admin'
import { enqueueQuoteJob } from '@/lib/queue'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/quotes/:quoteId/retry
 * Retry a failed quote job (admin only)
 */
export async function POST(
  _request: Request,
  { params }: { params: { quoteId: string } }
) {
  const admin = await verifyAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  try {
    const { quoteId } = params
    const supabase = createAdminClient()

    // Get quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, tenant_id, quote_request_id, status')
      .eq('id', quoteId)
      .single()

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

    // Update quote to queued status with new token
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'queued',
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

    // Enqueue the job
    await enqueueQuoteJob({
      quoteId: quote.id,
      quoteRequestId: quote.quote_request_id,
      tenantId: quote.tenant_id,
      timestamp: Date.now(),
      quoteToken: token,
    })

    // Log activity
    await logAdminActivity(supabase, {
      adminUserId: admin.userId,
      action: 'retry',
      resourceType: 'quote',
      resourceId: quoteId,
      details: { previousStatus: quote.status },
    })

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
