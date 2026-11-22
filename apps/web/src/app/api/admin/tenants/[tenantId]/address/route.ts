import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdmin, logAdminActivity } from '@/lib/admin'
import { adminChangeAddress } from '@/lib/own-address'

export const dynamic = 'force-dynamic'

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * PUT /api/admin/tenants/:tenantId/address  { address: string | null, note?: string }
 * (T-199) Change or remove a business's own address. Platform admins only:
 * a business chooses once and cannot change it itself.
 *
 * The old name is held for 90 days before another business can take it
 * (`own_address_changes.held_until`). Every change is written there and to
 * `admin_activity_logs`, with who made it.
 */
export async function PUT(request: Request, { params }: { params: { tenantId: string } }) {
  const admin = await verifyAdmin()
  if (!admin) return refuse(403, 'FORBIDDEN', 'Admin access required')
  const body = (await request.json().catch(() => null)) as { address?: unknown; note?: unknown } | null
  if (body?.address !== null && typeof body?.address !== 'string') return refuse(400, 'VALIDATION_ERROR', 'address must be a name, or null to remove it')
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''

  const supabase = createAdminClient()
  const { data: before } = await supabase.from('tenants').select('own_address').eq('id', params.tenantId).maybeSingle()
  const result = await adminChangeAddress(supabase, params.tenantId, admin.userId, body.address === null ? null : body.address, note)
  if (!result.ok) return refuse(result.status, result.code, result.message)

  const old = (before as { own_address?: string | null } | null)?.own_address ?? null
  if (old !== result.address) {
    await logAdminActivity(supabase, {
      adminUserId: admin.userId,
      action: 'change_address',
      resourceType: 'tenant',
      resourceId: params.tenantId,
      details: { from: old, to: result.address, heldUntil: result.held?.until ?? null, note: note || null },
    })
    console.log(`[Admin] Address of business ${params.tenantId} changed`)
  }
  return NextResponse.json({ tenantId: params.tenantId, address: result.address, held: result.held ?? null })
}
