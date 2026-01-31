import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin } from '@/lib/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/tenants
 * List/search tenants (admin only)
 */
export async function GET(request: Request) {
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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
    const cursor = url.searchParams.get('cursor')

    const supabase = createAdminClient()

    // Build query
    let query = supabase
      .from('tenants')
      .select(`
        id,
        name,
        currency,
        created_at,
        updated_at,
        subscriptions!tenant_id (
          status,
          plans!plan_id (
            name,
            price_cents
          )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    // Apply search
    if (search) {
      if (search.startsWith('tnt_')) {
        query = query.eq('id', search)
      } else {
        query = query.ilike('name', `%${search}%`)
      }
    }

    const { data: tenants, error } = await query

    if (error) {
      console.error('Admin tenants search error:', error)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to search tenants' } },
        { status: 500 }
      )
    }

    // Get quote counts per tenant
    const tenantIds = tenants?.map((t) => t.id) || []
    let quoteCounts: Record<string, number> = {}

    if (tenantIds.length > 0) {
      const { data: counts } = await supabase
        .from('quotes')
        .select('tenant_id')
        .in('tenant_id', tenantIds)

      if (counts) {
        quoteCounts = counts.reduce(
          (acc, item) => {
            acc[item.tenant_id] = (acc[item.tenant_id] || 0) + 1
            return acc
          },
          {} as Record<string, number>
        )
      }
    }

    // Check for more results
    const hasMore = tenants && tenants.length > limit
    const items = tenants?.slice(0, limit) || []

    // Transform to response format
    const responseItems = items.map((tenant) => {
      const subscription = Array.isArray(tenant.subscriptions)
        ? tenant.subscriptions[0]
        : tenant.subscriptions
      const plan = subscription?.plans as unknown as { name: string; price_cents: number } | null

      return {
        tenantId: tenant.id,
        name: tenant.name,
        currency: tenant.currency,
        createdAt: tenant.created_at,
        subscriptionStatus: subscription?.status || 'none',
        planName: plan?.name || 'Free',
        planPrice: plan?.price_cents || 0,
        quoteCount: quoteCounts[tenant.id] || 0,
      }
    })

    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? lastItem.created_at : null

    return NextResponse.json({
      items: responseItems,
      nextCursor,
    })
  } catch (error) {
    console.error('Admin tenants error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
