import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { unreadReplies } from '@/lib/support'

export const dynamic = 'force-dynamic'

/**
 * GET /api/support/unread
 * T-197: how many of the business's reports carry a reply nobody there has
 * opened: the dot on the menu's Help item. Own business only. A count that
 * cannot be read is zero: the dot must never break the menu.
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ count: await unreadReplies(auth.supabase, auth.tenantId) })
  } catch {
    return NextResponse.json({ count: 0 })
  }
}
