import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { countUnfinished } from '@/lib/unfinished-leads'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leads/new-count
 * T-160: how many unfinished requests the business has not seen yet — the
 * number on the menu's "Unfinished requests" item. Own tenant only.
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  // T-204: counted as the list shows them, one per person per service
  const count = await countUnfinished(auth.supabase, auth.tenantId, { newOnly: true })
  if (count === null) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load' } }, { status: 500 })
  }
  return NextResponse.json({ count })
}
