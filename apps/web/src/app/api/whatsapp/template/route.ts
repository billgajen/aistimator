import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { loadEstimateTemplate } from '@/lib/whatsapp-template-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/whatsapp/template
 * T-176: the signed-in business's one WhatsApp message template ("estimate
 * ready") as Meta has it now: not there yet, in review, approved, rejected, …
 * The stored token is read with the service role for the caller's own tenant;
 * nothing about the template is stored, Meta is asked each time. No response
 * carries a token.
 *
 * T-177: this only READS. The template is created when a business connects,
 * if Meta has none with our name (`ensureEstimateTemplate`); there is no route
 * that creates one on request, so opening the page can never make a second.
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const result = await loadEstimateTemplate(createAdminClient(), auth.tenantId)
  return result.ok
    ? NextResponse.json({ ok: true, template: result.template, problem: result.problem })
    : NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status })
}
