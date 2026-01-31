import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin, logAdminActivity } from '@/lib/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/quotes/:quoteId
 * Get detailed quote information (admin only)
 */
export async function GET(
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

    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        quote_requests!quote_request_id (*),
        tenants!tenant_id (
          id,
          name,
          currency
        ),
        services!service_id (
          id,
          name
        )
      `)
      .eq('id', quoteId)
      .single()

    if (error || !quote) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Log activity
    await logAdminActivity(supabase, {
      adminUserId: admin.userId,
      action: 'view',
      resourceType: 'quote',
      resourceId: quoteId,
    })

    return NextResponse.json({ quote })
  } catch (error) {
    console.error('Admin quote detail error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
