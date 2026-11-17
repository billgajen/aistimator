import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { connectWithEmbeddedSignup } from '@/lib/whatsapp-connect'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/whatsapp/connect  { code, wabaId, phoneNumberId?, businessId?, onBusinessApp? }
 * T-175: finish a connection started in Meta's Embedded Signup. The browser
 * sends the code from the login callback and the ids from Meta's message
 * event; everything else happens here, on the server: the code is exchanged,
 * Meta is asked whether the token really covers that account and number, our
 * app is subscribed, the number registered and the token stored encrypted.
 * The response never carries the token.
 */
export async function POST(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = await connectWithEmbeddedSignup(createAdminClient(), auth.tenantId, {
    code: body?.code,
    wabaId: body?.wabaId,
    phoneNumberId: body?.phoneNumberId,
    businessId: body?.businessId,
    onBusinessApp: body?.onBusinessApp,
  })
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status })
  return NextResponse.json({ ok: true, config: result.connection, registrationProblem: result.registrationProblem })
}
