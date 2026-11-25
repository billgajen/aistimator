import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { verifyTurnstileToken, HUMAN_CHECK_FAILED_MESSAGE } from '@/lib/turnstile'
import { checkContact, contactRequirementOf } from '@/lib/contact-rules'
import { hashLeadToken, newLeadToken } from '@/lib/request-leads'
import { decideTestRequest, publicSource } from '@/lib/test-estimates'
import { currentTenant } from '@/lib/current-tenant'

interface CreateLeadBody {
  tenantKey?: string
  serviceId?: string
  customer?: { name?: string; email?: string | null; phone?: string | null }
  turnstileToken?: string
  website?: string
  /** T-202: the business's own test, from the form inside its dashboard (needs its signed-in session) */
  ownTest?: boolean
  /** T-150's code from the old test link: refused */
  testToken?: string
  source?: Record<string, unknown>
}

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: { code, message, ...extra } }, { status })

/**
 * POST /api/public/leads
 * T-151: save an unfinished request the moment the customer has given their
 * contact details. Same anti-abuse as submission (rate limit, Turnstile,
 * honeypot); no AI runs and nothing counts toward usage. A test request from
 * setup never creates one. Returns a token the widget uses for updates.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CreateLeadBody | null
  if (!body?.tenantKey || !body.serviceId) return fail(400, 'VALIDATION_ERROR', 'tenantKey and serviceId are required')
  if (typeof body.website === 'string' && body.website.trim() !== '') return fail(400, 'VALIDATION_ERROR', 'Invalid submission')

  const ip = getClientIp(request)
  const rate = await checkPublicRateLimit('leads', { ip, tenantKey: body.tenantKey })
  if (!rate.allowed) return rateLimitedResponse(rate)
  const turnstile = await verifyTurnstileToken(body.turnstileToken, ip)
  if (!turnstile.ok) return fail(403, 'VERIFICATION_FAILED', HUMAN_CHECK_FAILED_MESSAGE)

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('tenant_sites').select('tenant_id, is_active').eq('tenant_key', body.tenantKey).maybeSingle()
  if (!site?.is_active) return fail(400, 'INVALID_TENANT_KEY', 'Invalid or unknown tenant key')
  const tenantId = site.tenant_id as string

  // T-202: the business's own test is never an unfinished lead. The same rule as on submission
  // (the body says "test" AND the session is that business's); nothing is counted here.
  const test = await decideTestRequest(
    supabase,
    tenantId,
    {
      ownTest: body.ownTest,
      oldToken: body.testToken,
      signedInTenantId: async () => {
        const auth = await currentTenant()
        return auth.ok ? auth.tenantId : null
      },
    },
    { claim: false }
  )
  if (test.kind === 'refused') return fail(test.status, test.code, test.message)
  if (test.kind === 'test') return NextResponse.json({ skipped: true })

  const [{ data: service }, { data: tenant }] = await Promise.all([
    supabase.from('services').select('id').eq('id', body.serviceId).eq('tenant_id', tenantId).eq('active', true).maybeSingle(),
    supabase.from('tenants').select('contact_requirement, is_demo').eq('id', tenantId).single(),
  ])
  if (!service) return fail(400, 'INVALID_SERVICE', 'Service not found or not available')
  // T-153: a visitor trying the public demo is never anyone's lead
  if ((tenant as { is_demo?: boolean } | null)?.is_demo) return NextResponse.json({ skipped: true })

  const contact = checkContact(body.customer ?? {}, contactRequirementOf(tenant?.contact_requirement))
  if (!contact.ok) return fail(400, 'VALIDATION_ERROR', Object.values(contact.errors)[0] ?? 'Check your details', { fields: contact.errors })

  const token = newLeadToken()
  const { data: lead, error } = await supabase
    .from('request_leads')
    .insert({
      tenant_id: tenantId,
      service_id: service.id,
      customer_name: contact.clean.name,
      customer_email: contact.clean.email,
      customer_phone: contact.clean.phone,
      progress: 'contact',
      source_json: publicSource(body.source),
      lead_token_hash: hashLeadToken(token),
    })
    .select('id')
    .single()
  if (error || !lead) {
    console.error('[Leads] insert failed:', error?.code)
    return fail(500, 'DB_ERROR', 'Could not save your details')
  }
  return NextResponse.json({ leadId: lead.id, leadToken: token })
}
