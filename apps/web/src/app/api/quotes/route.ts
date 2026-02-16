import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { QuoteListItem, QuotesListResponse, QuoteStatus } from '@estimator/shared'

const VALID_STATUSES: QuoteStatus[] = [
  'queued',
  'generating',
  'pending_review',
  'awaiting_clarification',
  'sent',
  'viewed',
  'feedback_received',
  'revised',
  'accepted',
  'paid',
  'expired',
  'failed',
]

/**
 * GET /api/quotes
 * List quotes for the current tenant with optional filtering
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Parse query parameters
    const url = new URL(request.url)
    const search = url.searchParams.get('search')?.trim() || ''
    const status = url.searchParams.get('status') as QuoteStatus | null
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
    const cursor = url.searchParams.get('cursor')

    // Build query
    let query = supabase
      .from('quotes')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        viewed_at,
        accepted_at,
        paid_at,
        customer_json,
        pricing_json,
        services!service_id (
          id,
          name
        )
      `)
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(limit + 1) // Fetch one extra to check for more

    // Apply status filter
    if (status && VALID_STATUSES.includes(status)) {
      query = query.eq('status', status)
    }

    // Apply cursor for pagination
    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    // Apply search filter (customer name or email)
    if (search) {
      // Search in customer_json using JSONB operators
      query = query.or(
        `customer_json->name.ilike.%${search}%,customer_json->email.ilike.%${search}%`
      )
    }

    const { data: quotes, error: quotesError } = await query

    if (quotesError) {
      console.error('Error fetching quotes:', quotesError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch quotes' } },
        { status: 500 }
      )
    }

    // Check if there are more results
    const hasMore = quotes && quotes.length > limit
    const items = quotes?.slice(0, limit) || []

    // Transform to response format
    const responseItems: QuoteListItem[] = items.map((quote) => {
      const customer = quote.customer_json as { name: string; email: string } | null
      const pricing = quote.pricing_json as { total: number; currency: string } | null
      // Supabase returns single relation as object, not array
      const service = quote.services as unknown as { id: string; name: string } | null

      return {
        quoteId: quote.id,
        serviceName: service?.name || 'Unknown Service',
        customerName: customer?.name || 'Unknown',
        customerEmail: customer?.email || '',
        status: quote.status as QuoteStatus,
        createdAt: quote.created_at,
        sentAt: quote.sent_at,
        viewedAt: quote.viewed_at,
        acceptedAt: quote.accepted_at,
        paidAt: quote.paid_at,
        total: pricing?.total || 0,
        currency: pricing?.currency || 'GBP',
      }
    })

    // Get next cursor if there are more results
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? lastItem.created_at : null

    const response: QuotesListResponse = {
      items: responseItems,
      nextCursor,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Quotes list error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
