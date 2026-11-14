import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { unfinishedFilter } from '@/lib/unfinished-leads'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leads/new-count
 * T-160: how many unfinished requests the business has not seen yet — the
 * number on the menu's "Unfinished requests" item. Own tenant only.
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const { count, error } = await unfinishedFilter(
    auth.supabase.from('request_leads').select('id', { count: 'exact', head: true }),
    auth.tenantId,
    { newOnly: true }
  )
  if (error || count === null) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load' } }, { status: 500 })
  }
  return NextResponse.json({ count })
}
