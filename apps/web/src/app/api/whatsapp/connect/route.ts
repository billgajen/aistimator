import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { connectWithEmbeddedSignup } from '@/lib/whatsapp-connect'
import { accessRefusal, whatsappAccess } from '@/lib/whatsapp-access'
import { ensureEstimateTemplate } from '@/lib/whatsapp-template-service'

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
 *
 * T-177:
 * - Only a business whose plan includes WhatsApp, with a live subscription,
 *   may connect (403 PLAN_REQUIRED / ASSISTANT_PAUSED otherwise).
 * - Once connected, the message template is looked for on Meta and created
 *   only if it is not there (there is no button for it any more). That is
 *   tried once and never fails the connection: the page shows where it stands.
 */
export async function POST(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const refusal = accessRefusal(await whatsappAccess(admin, auth.tenantId))
  if (refusal) return NextResponse.json({ error: { code: refusal.code, message: refusal.message } }, { status: refusal.status })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = await connectWithEmbeddedSignup(admin, auth.tenantId, {
    code: body?.code,
    wabaId: body?.wabaId,
    phoneNumberId: body?.phoneNumberId,
    businessId: body?.businessId,
    onBusinessApp: body?.onBusinessApp,
  })
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status })
  // use the template Meta already has, or create it; best effort
  await ensureEstimateTemplate(admin, auth.tenantId).catch(() => undefined)
  return NextResponse.json({ ok: true, config: result.connection, registrationProblem: result.registrationProblem })
}
