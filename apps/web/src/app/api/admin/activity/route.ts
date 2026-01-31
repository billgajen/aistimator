import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin } from '@/lib/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/activity
 * Get admin activity log (admin only)
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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)
    const cursor = url.searchParams.get('cursor')
    const resourceType = url.searchParams.get('resourceType')

    const supabase = createAdminClient()

    // Build query
    let query = supabase
      .from('admin_activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (cursor) {
      query = query.lt('created_at', cursor)
    }

    if (resourceType) {
      query = query.eq('resource_type', resourceType)
    }

    const { data: logs, error } = await query

    if (error) {
      // Table might not exist yet - return empty
      if (error.code === '42P01') {
        return NextResponse.json({ items: [], nextCursor: null })
      }
      console.error('Admin activity log error:', error)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch activity log' } },
        { status: 500 }
      )
    }

    // Check for more results
    const hasMore = logs && logs.length > limit
    const items = logs?.slice(0, limit) || []

    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? lastItem.created_at : null

    return NextResponse.json({
      items,
      nextCursor,
    })
  } catch (error) {
    console.error('Admin activity error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
