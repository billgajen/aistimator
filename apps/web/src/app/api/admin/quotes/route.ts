import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin } from '@/lib/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/quotes
 * Search quotes across all tenants (admin only)
 */
export async function GET(request: Request) {
  // Verify admin access
  const admin = await verifyAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  try {
    const url = new URL(request.url)
    const search = url.searchParams.get('search')?.trim() || ''
    const status = url.searchParams.get('status')
    const tenantId = url.searchParams.get('tenantId')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
    const cursor = url.searchParams.get('cursor')

    const supabase = createAdminClient()

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
        tenant_id,
        tenants!tenant_id (
          id,
          name
        ),
        services!service_id (
          id,
          name
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    // Apply filters
    if (status) {
      query = query.eq('status', status)
    }

    if (tenantId) {
      query = query.eq('tenant_id', tenantId)
    }

    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    // Apply search (quote ID or customer email)
    if (search) {
      if (search.startsWith('qte_')) {
        // Search by quote ID
        query = query.eq('id', search)
      } else {
        // Search by customer email
        query = query.ilike('customer_json->>email', `%${search}%`)
      }
    }

    const { data: quotes, error } = await query

    if (error) {
      console.error('Admin quotes search error:', error)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to search quotes' } },
        { status: 500 }
      )
    }

    // Check for more results
    const hasMore = quotes && quotes.length > limit
    const items = quotes?.slice(0, limit) || []

    // Transform to response format
    const responseItems = items.map((quote) => {
      const customer = quote.customer_json as { name: string; email: string } | null
      const pricing = quote.pricing_json as { total: number; currency: string } | null
      const tenant = quote.tenants as unknown as { id: string; name: string } | null
      const service = quote.services as unknown as { id: string; name: string } | null

      return {
        quoteId: quote.id,
        tenantId: quote.tenant_id,
        tenantName: tenant?.name || 'Unknown',
        serviceName: service?.name || 'Unknown',
        customerName: customer?.name || 'Unknown',
        customerEmail: customer?.email || '',
        status: quote.status,
        createdAt: quote.created_at,
        sentAt: quote.sent_at,
        viewedAt: quote.viewed_at,
        acceptedAt: quote.accepted_at,
        paidAt: quote.paid_at,
        total: pricing?.total || 0,
        currency: pricing?.currency || 'USD',
      }
    })

    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? lastItem.created_at : null

    return NextResponse.json({
      items: responseItems,
      nextCursor,
    })
  } catch (error) {
    console.error('Admin quotes error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
