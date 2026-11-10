import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { verifyTestToken } from '@/lib/test-quote-token'
import { checkContact, contactRequirementOf } from '@/lib/contact-rules'
import { hashLeadToken, newLeadToken } from '@/lib/request-leads'
import { publicSource } from '@/lib/test-quotes'

interface CreateLeadBody {
  tenantKey?: string
  serviceId?: string
  customer?: { name?: string; email?: string | null; phone?: string | null }
  turnstileToken?: string
  website?: string
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
  if (!turnstile.ok) return fail(403, 'VERIFICATION_FAILED', 'Security check failed. Please refresh the page and try again.')

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('tenant_sites').select('tenant_id, is_active').eq('tenant_key', body.tenantKey).maybeSingle()
  if (!site?.is_active) return fail(400, 'INVALID_TENANT_KEY', 'Invalid or unknown tenant key')
  const tenantId = site.tenant_id as string

  // T-150: the owner's test from setup is never an unfinished lead
  if (body.testToken) {
    if (!verifyTestToken(String(body.testToken), tenantId).ok) {
      return fail(403, 'TEST_LINK_INVALID', 'This test link has expired or is not valid. Start a new test from setup.')
    }
    return NextResponse.json({ skipped: true })
  }

  const [{ data: service }, { data: tenant }] = await Promise.all([
    supabase.from('services').select('id').eq('id', body.serviceId).eq('tenant_id', tenantId).eq('active', true).maybeSingle(),
    supabase.from('tenants').select('contact_requirement').eq('id', tenantId).single(),
  ])
  if (!service) return fail(400, 'INVALID_SERVICE', 'Service not found or not available')

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
