import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin, logAdminActivity } from '@/lib/admin'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/tenants/:tenantId
 * Get detailed tenant information (admin only)
 */
export async function GET(
  _request: Request,
  { params }: { params: { tenantId: string } }
) {
  const admin = await verifyAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    )
  }

  try {
    const { tenantId } = params
    const supabase = createAdminClient()

    // Get tenant with related data
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select(`
        *,
        subscriptions!tenant_id (
          *,
          plans!plan_id (*)
        ),
        services!tenant_id (
          id,
          name,
          active
        ),
        tenant_sites!tenant_id (
          id,
          domain,
          tenant_key,
          is_active
        )
      `)
      .eq('id', tenantId)
      .single()

    if (error || !tenant) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Tenant not found' } },
        { status: 404 }
      )
    }

    // Get quote stats
    const { data: quoteStats } = await supabase
      .from('quotes')
      .select('status')
      .eq('tenant_id', tenantId)

    const stats = {
      total: quoteStats?.length || 0,
      queued: quoteStats?.filter((q) => q.status === 'queued').length || 0,
      generating: quoteStats?.filter((q) => q.status === 'generating').length || 0,
      sent: quoteStats?.filter((q) => q.status === 'sent').length || 0,
      viewed: quoteStats?.filter((q) => q.status === 'viewed').length || 0,
      accepted: quoteStats?.filter((q) => q.status === 'accepted').length || 0,
      paid: quoteStats?.filter((q) => q.status === 'paid').length || 0,
      failed: quoteStats?.filter((q) => q.status === 'failed').length || 0,
      expired: quoteStats?.filter((q) => q.status === 'expired').length || 0,
    }

    // Get usage for current month
    const now = new Date()
    const currentPeriod = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

    const { data: usage } = await supabase
      .from('usage_counters')
      .select('estimates_created, estimates_sent')
      .eq('tenant_id', tenantId)
      .eq('period_yyyymm', currentPeriod)
      .single()

    // Get users for this tenant
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, role, display_name, created_at')
      .eq('tenant_id', tenantId)

    // Log activity
    await logAdminActivity(supabase, {
      adminUserId: admin.userId,
      action: 'view',
      resourceType: 'tenant',
      resourceId: tenantId,
    })

    return NextResponse.json({
      tenant,
      stats,
      usage: usage || { estimates_created: 0, estimates_sent: 0 },
      users: users || [],
    })
  } catch (error) {
    console.error('Admin tenant detail error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
