import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { refreshConnection } from '@/lib/whatsapp-connect'

export const dynamic = 'force-dynamic'

/**
 * POST /api/whatsapp/status
 * T-175: ask Meta how the business's connection stands (the number's name,
 * whether a payment method is on the account, whether the token is still
 * good), store it, and return the refreshed view. "Check again" on the page.
 * T-176: also `live`, what Meta says now about the display name's review and a
 * card on the account (shown, not stored); the page asks once when it opens.
 */
export async function POST() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const { connection, problem, live } = await refreshConnection(createAdminClient(), auth.tenantId)
  if (!connection) return NextResponse.json({ error: { code: 'NOT_CONNECTED', message: 'WhatsApp is not connected.' } }, { status: 404 })
  return NextResponse.json({ ok: true, config: connection, problem, live })
}
