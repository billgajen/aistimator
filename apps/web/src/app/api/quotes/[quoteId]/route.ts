import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import {
  sendEmail,
  isPostmarkConfigured,
} from '@/lib/postmark'
import { generateRevisedQuoteEmailHtml } from '@/lib/email-templates'
import type {
  UpdateQuoteRequest,
  UpdateQuoteResponse,
  QuoteDetailResponse,
  AmendmentSummary,
} from '@estimator/shared'
import type {
  QuotePricing,
  QuoteContent,
  QuoteStatus,
  AmendmentChange,
  TenantBranding,
  QuoteFeedback,
} from '@estimator/shared'

/** Auth helper — returns user ID + tenant ID or an error response */
async function getAuthContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      error: NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      ),
    }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) {
    return {
      error: NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      ),
    }
  }

  return { userId: user.id, tenantId: profile.tenant_id }
}

/**
 * GET /api/quotes/[quoteId]
 * Get a single quote with all details including amendments and feedback
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await params
    const supabase = await createClient()
    const auth = await getAuthContext(supabase)
    if ('error' in auth) return auth.error

    // Fetch quote with service
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        service:services (
          id,
          name,
          description,
          work_steps,
          expected_signals
        )
      `)
      .eq('id', quoteId)
      .eq('tenant_id', auth.tenantId)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Fetch amendments and feedback in parallel
    const [amendmentsResult, feedbackResult] = await Promise.all([
      supabase
        .from('quote_amendments')
        .select('id, version, source, changes_json, created_at, amended_by')
        .eq('quote_id', quoteId)
        .eq('tenant_id', auth.tenantId)
        .order('version', { ascending: false }),
      supabase
        .from('quote_feedback')
        .select('*')
        .eq('quote_id', quoteId)
        .eq('tenant_id', auth.tenantId)
        .order('created_at', { ascending: false }),
    ])

    const amendments: AmendmentSummary[] = (amendmentsResult.data || []).map(
      (a: { id: string; version: number; source: string; changes_json: unknown[]; created_at: string; amended_by: string }) => ({
        id: a.id,
        version: a.version,
        source: a.source as AmendmentSummary['source'],
        changeCount: Array.isArray(a.changes_json) ? a.changes_json.length : 0,
        createdAt: a.created_at,
        amendedBy: a.amended_by,
      })
    )

    const feedback = (feedbackResult.data || []) as QuoteFeedback[]

    const response: QuoteDetailResponse = {
      quote: {
        id: quote.id,
        tenant_id: quote.tenant_id,
        quote_request_id: quote.quote_request_id,
        service_id: quote.service_id,
        customer_json: quote.customer_json,
        pricing_json: quote.pricing_json,
        document_type: quote.document_type,
        content_json: quote.content_json,
        status: quote.status,
        business_notes: quote.business_notes ?? null,
        version: quote.version ?? 1,
        last_amended_at: quote.last_amended_at ?? null,
        last_amended_by: quote.last_amended_by ?? null,
        created_at: quote.created_at,
        sent_at: quote.sent_at,
        viewed_at: quote.viewed_at,
        accepted_at: quote.accepted_at,
        paid_at: quote.paid_at,
        signals_json: quote.signals_json,
        pricing_trace_json: quote.pricing_trace_json,
        triage_json: quote.triage_json,
        quality_gate_json: quote.quality_gate_json,
      },
      service: quote.service,
      amendments,
      feedback,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Quote GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/** Compute a structured diff between old and new pricing/content */
function computeChanges(
  beforePricing: QuotePricing,
  afterPricing: QuotePricing,
  beforeContent: QuoteContent,
  afterContent: QuoteContent
): AmendmentChange[] {
  const changes: AmendmentChange[] = []

  // Compare breakdown items
  const beforeLabels = new Set(beforePricing.breakdown.map((b) => b.label))
  const afterLabels = new Set(afterPricing.breakdown.map((b) => b.label))

  for (const item of afterPricing.breakdown) {
    if (!beforeLabels.has(item.label)) {
      changes.push({
        field: 'pricing',
        path: `breakdown.${item.label}`,
        before: null,
        after: item,
        type: 'added',
      })
    }
  }

  for (const item of beforePricing.breakdown) {
    if (!afterLabels.has(item.label)) {
      changes.push({
        field: 'pricing',
        path: `breakdown.${item.label}`,
        before: item,
        after: null,
        type: 'removed',
      })
    }
  }

  for (const afterItem of afterPricing.breakdown) {
    const beforeItem = beforePricing.breakdown.find((b) => b.label === afterItem.label)
    if (beforeItem && beforeItem.amount !== afterItem.amount) {
      changes.push({
        field: 'pricing',
        path: `breakdown.${afterItem.label}.amount`,
        before: beforeItem.amount,
        after: afterItem.amount,
        type: 'modified',
      })
    }
  }

  // Compare totals
  if (beforePricing.total !== afterPricing.total) {
    changes.push({
      field: 'pricing',
      path: 'total',
      before: beforePricing.total,
      after: afterPricing.total,
      type: 'modified',
    })
  }

  // Compare content fields
  const contentFields: (keyof QuoteContent)[] = [
    'scopeSummary',
    'assumptions',
    'exclusions',
    'notes',
  ]

  for (const key of contentFields) {
    const before = beforeContent[key]
    const after = afterContent[key]
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({
        field: 'content',
        path: key,
        before: before ?? null,
        after: after ?? null,
        type: before == null ? 'added' : after == null ? 'removed' : 'modified',
      })
    }
  }

  return changes
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
}

function formatTotal(pricing: QuotePricing): string {
  const symbol = CURRENCY_SYMBOLS[pricing.currency] || pricing.currency + ' '
  return `${symbol}${pricing.total.toFixed(2)}`
}

/**
 * PATCH /api/quotes/[quoteId]
 * Edit a quote: update pricing, content, business notes. Optionally resend to customer.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await params
    const supabase = await createClient()
    const auth = await getAuthContext(supabase)
    if ('error' in auth) return auth.error

    const body = (await request.json()) as UpdateQuoteRequest

    // Validate required fields
    if (body.version == null || !body.pricing_json || !body.content_json) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'version, pricing_json, and content_json are required' } },
        { status: 400 }
      )
    }

    // Fetch current quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        tenants!tenant_id (
          id, name, currency, tax_enabled, tax_label, tax_rate, branding_json, notification_email
        ),
        services!service_id (
          id, name
        )
      `)
      .eq('id', quoteId)
      .eq('tenant_id', auth.tenantId)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Reject if status doesn't allow editing
    const nonEditableStatuses: QuoteStatus[] = ['accepted', 'paid', 'generating', 'queued', 'failed']
    if (nonEditableStatuses.includes(quote.status as QuoteStatus)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot edit quote with status '${quote.status}'` } },
        { status: 400 }
      )
    }

    // Optimistic lock check
    const currentVersion = quote.version ?? 1
    if (body.version !== currentVersion) {
      return NextResponse.json(
        {
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Quote was modified by another user. Please reload and try again.',
          },
        },
        { status: 409 }
      )
    }

    // Server-side tax recalculation
    const tenant = quote.tenants as {
      id: string; name: string; currency: string
      tax_enabled: boolean; tax_label: string | null; tax_rate: number
      branding_json: TenantBranding | null; notification_email: string | null
    }
    const service = quote.services as { id: string; name: string }

    const pricing = { ...body.pricing_json }
    pricing.subtotal = pricing.breakdown.reduce((sum, item) => sum + item.amount, 0)

    if (tenant.tax_enabled && tenant.tax_rate > 0) {
      pricing.taxLabel = tenant.tax_label || 'Tax'
      pricing.taxRate = tenant.tax_rate * 100
      pricing.taxAmount = Math.round(pricing.subtotal * tenant.tax_rate * 100) / 100
    } else {
      pricing.taxAmount = 0
    }
    pricing.total = Math.round((pricing.subtotal + pricing.taxAmount) * 100) / 100

    // Compute changes
    const beforePricing = quote.pricing_json as QuotePricing
    const beforeContent = quote.content_json as QuoteContent
    const changes = computeChanges(beforePricing, pricing, beforeContent, body.content_json)

    const newVersion = currentVersion + 1
    const now = new Date().toISOString()

    // Determine new status
    let newStatus = quote.status as QuoteStatus
    if (body.sendToCustomer) {
      const wasAlreadySent = ['sent', 'viewed', 'feedback_received'].includes(quote.status)
      newStatus = wasAlreadySent ? 'revised' : 'sent'
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = {
      pricing_json: pricing,
      content_json: body.content_json,
      version: newVersion,
      last_amended_at: now,
      last_amended_by: auth.userId,
      status: newStatus,
    }

    if (body.business_notes !== undefined) {
      updatePayload.business_notes = body.business_notes
    }

    // If sending to customer, generate/refresh token
    let quoteViewUrl: string | undefined
    if (body.sendToCustomer) {
      const { token, hash } = generateQuoteToken()
      const tokenExpiry = getTokenExpiry(30)
      updatePayload.quote_token_hash = hash
      updatePayload.token_expires_at = tokenExpiry.toISOString()
      updatePayload.sent_at = now

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      quoteViewUrl = `${appUrl}/q/${quoteId}?token=${token}`
    }

    // Update quote
    const { error: updateError } = await supabase
      .from('quotes')
      .update(updatePayload)
      .eq('id', quoteId)
      .eq('version', currentVersion) // Double-check optimistic lock at DB level

    if (updateError) {
      console.error('Quote update error:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update quote' } },
        { status: 500 }
      )
    }

    // Insert amendment record
    const amendmentSource = body.feedbackId ? 'feedback_response' : 'manual'
    await supabase.from('quote_amendments').insert({
      quote_id: quoteId,
      tenant_id: auth.tenantId,
      version: newVersion,
      amended_by: auth.userId,
      before_pricing: beforePricing,
      after_pricing: pricing,
      before_content: beforeContent,
      after_content: body.content_json,
      changes_json: changes,
      source: amendmentSource,
      feedback_id: body.feedbackId || null,
    })

    // Resolve linked feedback if applicable
    if (body.feedbackId) {
      await supabase
        .from('quote_feedback')
        .update({ status: 'resolved' })
        .eq('id', body.feedbackId)
        .eq('tenant_id', auth.tenantId)
    }

    // Send revised email to customer if requested
    if (body.sendToCustomer && quoteViewUrl && isPostmarkConfigured()) {
      const customer = quote.customer_json as { name: string; email: string }
      const branding = tenant.branding_json || { primaryColor: '#2563eb' }

      const htmlBody = generateRevisedQuoteEmailHtml({
        customerName: customer.name,
        businessName: tenant.name,
        serviceName: service.name,
        quoteViewUrl,
        total: formatTotal(pricing),
        primaryColor: branding.primaryColor,
      })

      const emailResult = await sendEmail({
        to: customer.email,
        subject: `Updated quote from ${tenant.name}`,
        htmlBody,
        tag: 'quote-revised',
      })

      if (!emailResult.success) {
        console.error('Failed to send revised quote email:', emailResult.error)
      }
    }

    // Check if learning analysis should be triggered (fire-and-forget)
    // Trigger if >= 5 amendments since last analysis
    triggerLearningAnalysisIfNeeded(supabase, auth.tenantId, quote.service_id).catch((e) =>
      console.error('Learning analysis trigger failed (non-blocking):', e)
    )

    const response: UpdateQuoteResponse = {
      quoteId,
      version: newVersion,
      status: newStatus,
      updatedAt: now,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Quote PATCH error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * Check if we should trigger learning analysis and if so, call the analysis API.
 * Non-blocking — errors are logged but don't affect the PATCH response.
 */
async function triggerLearningAnalysisIfNeeded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  serviceId: string
) {
  // Get the last analysis time for this service
  const { data: context } = await supabase
    .from('tenant_learning_context')
    .select('last_analyzed_at, total_amendments_analyzed')
    .eq('tenant_id', tenantId)
    .eq('service_id', serviceId)
    .single()

  const lastAnalyzed = context?.last_analyzed_at || '1970-01-01T00:00:00Z'

  // Count amendments since last analysis
  const { count } = await supabase
    .from('quote_amendments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gt('created_at', lastAnalyzed)

  // Trigger analysis if >= 5 new amendments
  if (count && count >= 5) {
    console.log(`[Learning] Triggering analysis: ${count} amendments since last analysis for service ${serviceId}`)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await fetch(`${appUrl}/api/learning/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId }),
    }).catch((e: unknown) => console.error('[Learning] Failed to trigger analysis:', e))
  }
}
