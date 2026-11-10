import { checkContact, contactRequirementOf } from '@/lib/contact-rules'
import { completeLeads } from '@/lib/request-leads'
import { decideTestRequest, publicSource } from '@/lib/test-quotes'
import { createAdminClient } from '@/lib/supabase/server'
import { createQuoteSubmission } from '@/lib/quote-intake'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { checkDemoAllowance, demoBusyResponse } from '@/lib/demo/demo-guard'
import { NextResponse } from 'next/server'

// Vercel function budget: sync processing (SYNC_QUOTE_PROCESSING=true) holds
// this request for the pipeline; production enqueues instead (AD-031)
export const maxDuration = 60

// Request body types
interface CustomerInput {
  name: string
  email: string
  phone?: string
}

interface JobInput {
  address?: string
  postcodeOrZip?: string
  quantity?: number
  answers?: Array<{ fieldId: string; value: string | number | boolean }>
}

interface SourceInput {
  type: 'widget' | 'api'
  pageUrl?: string
}

interface CreateQuoteRequest {
  tenantKey: string
  serviceId: string
  customer: CustomerInput
  job?: JobInput
  assetIds?: string[]
  source?: SourceInput
  /** Cloudflare Turnstile token — required when TURNSTILE_SECRET_KEY is set */
  turnstileToken?: string
  /** Honeypot — hidden field no human sees; any value means a bot */
  website?: string
  /** T-150: server-issued test token from setup (owner's test request) */
  testToken?: string
  /** T-151: the unfinished request this submission completes */
  leadId?: string
  leadToken?: string
}

/**
 * POST /api/public/quotes
 * Create a quote request from widget submission.
 * Validates tenant, creates records, and enqueues for processing.
 */
export async function POST(request: Request) {
  try {
    const body: CreateQuoteRequest = await request.json()

    // Validate required fields
    if (!body.tenantKey) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantKey is required' } },
        { status: 400 }
      )
    }

    if (!body.serviceId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'serviceId is required' } },
        { status: 400 }
      )
    }

    if (!body.customer?.name) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'customer name is required' } },
        { status: 400 }
      )
    }

    // Honeypot: the widget renders a hidden "website" field no human can
    // see or fill. Response is a generic validation error on purpose.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      console.warn('[Quotes] Honeypot tripped — rejecting submission')
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid submission' } },
        { status: 400 }
      )
    }

    const clientIp = getClientIp(request)

    // Rate limit before any DB access — this route runs the full AI pipeline
    const rate = await checkPublicRateLimit('quotes', {
      ip: clientIp,
      tenantKey: body.tenantKey,
    })
    if (!rate.allowed) {
      return rateLimitedResponse(rate)
    }

    // Turnstile bot check (no-op until TURNSTILE_SECRET_KEY is configured)
    const turnstile = await verifyTurnstileToken(body.turnstileToken, clientIp)
    if (!turnstile.ok) {
      return NextResponse.json(
        {
          error: {
            code: 'VERIFICATION_FAILED',
            message: 'Security check failed. Please refresh the page and try again.',
          },
        },
        { status: 403 }
      )
    }

    const supabase = createAdminClient()

    // 1. Validate tenantKey and get tenant
    const { data: tenantSite, error: siteError } = await supabase
      .from('tenant_sites')
      .select('tenant_id, domain, is_active')
      .eq('tenant_key', body.tenantKey)
      .single()

    if (siteError || !tenantSite) {
      return NextResponse.json(
        { error: { code: 'INVALID_TENANT_KEY', message: 'Invalid or unknown tenant key' } },
        { status: 400 }
      )
    }

    if (!tenantSite.is_active) {
      return NextResponse.json(
        { error: { code: 'TENANT_INACTIVE', message: 'This tenant is not active' } },
        { status: 403 }
      )
    }

    const tenantId = tenantSite.tenant_id

    // T-151: which contact details this business requires (email, phone or both)
    const { data: tenantContact } = await supabase.from('tenants').select('contact_requirement, is_demo').eq('id', tenantId).single()
    // T-153: the public example business — its own limits, never counted
    const isDemo = (tenantContact as { is_demo?: boolean } | null)?.is_demo === true
    const contact = checkContact(body.customer, contactRequirementOf(tenantContact?.contact_requirement))
    if (!contact.ok) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: Object.values(contact.errors)[0] ?? 'Check your details', fields: contact.errors } },
        { status: 400 }
      )
    }

    let demoIp: string | null = null
    if (isDemo) {
      const demo = await checkDemoAllowance(supabase, tenantId, clientIp)
      if (demo.decision !== 'ok') return demoBusyResponse(demo.decision)
      demoIp = demo.ipHash
    }

    // T-150: only a valid server-issued token for this tenant makes a test request
    // (the demo business has no owner, so no test links)
    const test = isDemo ? ({ kind: 'normal' } as const) : await decideTestRequest(supabase, tenantId, body.testToken)
    if (test.kind === 'refused') {
      return NextResponse.json({ error: { code: test.code, message: test.message } }, { status: test.status })
    }

    const result = await createQuoteSubmission(supabase, {
      tenantId,
      serviceId: body.serviceId,
      customer: { name: contact.clean.name, email: contact.clean.email ?? undefined, phone: contact.clean.phone ?? undefined },
      job: body.job,
      assetIds: body.assetIds,
      source: {
        ...publicSource(body.source as Record<string, unknown> | undefined),
        // T-153: the per-IP demo limit's key (a salted hash; deleted with the request)
        ...(demoIp && { demoIp }),
      },
      isTest: test.kind === 'test',
      isDemo,
      // T-151: a service with no questions of its own still needs a description
      requireDescriptionWithoutQuestions: true,
    })

    // T-151: the request is now a quote — close the unfinished lead it came from
    const quoteId = (result.json as { quoteId?: string }).quoteId
    if (result.status === 200 && quoteId && !isDemo) {
      await completeLeads(supabase, {
        tenantId,
        quoteId,
        serviceId: body.serviceId,
        leadId: body.leadId,
        leadToken: body.leadToken,
        email: contact.clean.email,
        phone: contact.clean.phone,
      }).catch((error: unknown) => console.error('[Quotes] closing lead failed:', error instanceof Error ? error.message : error))
    }
    return NextResponse.json(result.json, { status: result.status })
  } catch (error) {
    console.error('Quote request error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
