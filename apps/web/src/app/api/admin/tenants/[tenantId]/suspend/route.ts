import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin, logAdminActivity } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/admin/tenants/:tenantId/suspend  { suspended: boolean, reason?: string }
 * (T-180) The suspend switch. Platform admins only.
 *
 * While a business is suspended:
 *   - no new quote is priced: a request is saved as a held lead, exactly as at
 *     the plan limit, and the customer is told the estimate is on its way
 *     (`claim_plan_quote` refuses; lib/plan-limits.ts);
 *   - a held lead cannot be priced by hand;
 *   - its WhatsApp assistant is silent (lib/whatsapp-access.ts);
 *   - quotes it has already sent still open for its customers.
 * Nothing is deleted and its Stripe subscription is not touched: suspending is
 * ours, billing is Stripe's. Restoring clears it; held leads can then be priced.
 *
 * Every change is written to `admin_activity_logs` with who did it and the
 * reason. The reason is the admin's note: the business never sees it.
 */
export async function POST(request: Request, { params }: { params: { tenantId: string } }) {
  const admin = await verifyAdmin()
  if (!admin) return refuse(403, 'FORBIDDEN', 'Admin access required')

  const body = (await request.json().catch(() => null)) as { suspended?: unknown; reason?: unknown } | null
  if (typeof body?.suspended !== 'boolean') return refuse(400, 'VALIDATION_ERROR', 'suspended must be true or false')
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  if (body.suspended && !reason) return refuse(400, 'VALIDATION_ERROR', 'A reason is required to suspend a business')

  const supabase = createAdminClient()
  const { data: tenant } = await supabase.from('tenants').select('id, suspended_at, is_demo').eq('id', params.tenantId).maybeSingle()
  const row = tenant as { id: string; suspended_at: string | null; is_demo: boolean | null } | null
  if (!row) return refuse(404, 'NOT_FOUND', 'Tenant not found')
  if (row.is_demo) return refuse(400, 'DEMO_BUSINESS', 'The public demo business cannot be suspended')

  const already = Boolean(row.suspended_at) === body.suspended
  if (!already) {
    const { error } = await supabase
      .from('tenants')
      .update(body.suspended ? { suspended_at: new Date().toISOString(), suspended_reason: reason } : { suspended_at: null, suspended_reason: null })
      .eq('id', row.id)
    if (error) {
      console.error('[Admin] Suspend failed:', error.code ?? error.message)
      return refuse(500, 'DB_ERROR', 'Could not change the business')
    }
    await logAdminActivity(supabase, {
      adminUserId: admin.userId,
      action: body.suspended ? 'suspend' : 'restore',
      resourceType: 'tenant',
      resourceId: row.id,
      details: body.suspended ? { reason } : { reason: reason || null },
    })
    console.log(`[Admin] Business ${row.id} ${body.suspended ? 'suspended' : 'restored'}`)
  }

  const { data: after } = await supabase.from('tenants').select('suspended_at').eq('id', row.id).single()
  return NextResponse.json({ tenantId: row.id, suspended: Boolean((after as { suspended_at?: string | null } | null)?.suspended_at), changed: !already })
}
