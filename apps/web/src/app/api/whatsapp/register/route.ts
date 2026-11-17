import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { finishRegistration } from '@/lib/whatsapp-connect'

export const dynamic = 'force-dynamic'

/**
 * POST /api/whatsapp/register  { pin? }
 * T-175: finish registering a number Meta did not accept at connect time.
 * `pin` is the number's own two-step PIN when it already has one; left out,
 * a new one is set. The PIN is never logged or returned.
 */
export async function POST(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { pin?: unknown } | null
  const result = await finishRegistration(createAdminClient(), auth.tenantId, body?.pin)
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status })
  return NextResponse.json({ ok: true, config: result.connection })
}
