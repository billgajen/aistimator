import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { createEstimateTemplate, loadEstimateTemplate, type TemplateResult } from '@/lib/whatsapp-template-service'

export const dynamic = 'force-dynamic'

/**
 * T-176: the signed-in business's one WhatsApp message template ("estimate
 * ready"). The stored token is read with the service role for the caller's
 * own tenant; nothing about the template is stored, Meta is asked each time.
 * No response carries a token.
 */
const answer = (result: TemplateResult) =>
  result.ok
    ? NextResponse.json({ ok: true, template: result.template, problem: result.problem })
    : NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status })

/** GET /api/whatsapp/template — the template as Meta has it now (not made yet, in review, approved, rejected, …) */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  return answer(await loadEstimateTemplate(createAdminClient(), auth.tenantId))
}

/** POST /api/whatsapp/template — create it (Meta then reviews the wording). Pressing twice makes one. */
export async function POST() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  return answer(await createEstimateTemplate(createAdminClient(), auth.tenantId))
}
