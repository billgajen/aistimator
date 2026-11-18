import { createClient, bearerToken } from '@/lib/supabase/server'
import {
  formatMoney,
  resolveRegionContext,
  roundMoney,
  dropStaleLabelMath,
  editedBreakdown,
  canEditQuote,
  statusAfterEditAndSend,
  QUOTE_ALREADY_SENT_STATUSES,
} from '@qolumns/shared'
import { type NextRequest, NextResponse } from 'next/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import {
  sendEmail,
  isPostmarkConfigured,
  generateCustomerEmailHtml,
} from '@/lib/postmark'
import { generateRevisedQuoteEmailHtml } from '@/lib/email-templates'
import { businessReplyTo } from '@/lib/business-email'
import { notifyEstimateReady } from '@/lib/whatsapp-notify'
import { assetIdsOf, quotePhotos } from '@/lib/quote-photos'
import { quoteUnderstanding, SHOW_WORTH_CHECKING } from '@/lib/quote-understanding'
import type {
  UpdateQuoteRequest,
  UpdateQuoteResponse,
  QuoteDetailResponse,
  AmendmentSummary,
} from '@qolumns/shared'
import { CHECKER_SETTINGS_VERSION, serviceSuggestionOf, MAX_ADDED_SECTIONS, addedSections, alsoAskedOf, alsoAskedWithStates, editedSectionBreakdown, withSections } from '@qolumns/shared'
import type { CombinedPricing, QuoteSection } from '@qolumns/shared'
import { sectionTaxFor } from '@/lib/quote-sections-service'
import { sectionsEmailHtml } from '@/lib/sections-email'
import { fieldLabels, requestDetails } from '@/lib/request-details'
import type { FieldRow } from '@/lib/request-details'
import type {
  QuotePricing,
  QuoteContent,
  QuoteStatus,
  AmendmentChange,
  TenantBranding,
  QuoteFeedback,
} from '@qolumns/shared'

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
        ),
        request:quote_requests!quote_request_id (asset_ids, job_answers, job_postcode, job_address, job_quantity, source_json)
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

    // Fetch amendments and feedback in parallel, plus (T-157) whether the
    // tenant has an active SMS number: "Text link" only shows when it can work
    // T-169: the customer's photos, and the newest run of the quote checker
    // that found something. Both are read for this tenant only. The checker's
    // log is read only while "Worth checking" is switched on (it is, since T-172).
    const [amendmentsResult, feedbackResult, smsResult, photos, checkerResult, fieldRows] = await Promise.all([
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
      supabase
        .from('sms_configs')
        .select('is_active')
        .eq('tenant_id', auth.tenantId)
        .maybeSingle(),
      quotePhotos(supabase, auth.tenantId, quoteId, assetIdsOf((quote as { request?: unknown }).request)),
      SHOW_WORTH_CHECKING
        ? supabase
            .from('quote_validation_logs')
            .select('issues:validation_result->issues, checked_total:original_quote_snapshot->total')
            .eq('quote_id', quoteId)
            .eq('tenant_id', auth.tenantId)
            .neq('outcome', 'passed')
            // T-172: only a check made with the business's money settings. Rows from
            // before (marked 'v1') were made without the minimum charge, base fee, tax
            // and currency, and could flag a correct quote; they are never shown.
            .eq('input_snapshot->>serviceConfigVersion', CHECKER_SETTINGS_VERSION)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // T-178: the form's questions, to word the customer's answers as the business asked them
      supabase.from('widget_configs').select('service_id, config_json').eq('tenant_id', auth.tenantId),
    ])

    // T-178: what the customer sent, and the request form's suggestion of another service (if any)
    const requestRow = ((r: unknown) => (Array.isArray(r) ? r[0] : r))((quote as { request?: unknown }).request) as
      | { job_answers?: unknown; job_postcode?: string | null; job_address?: string | null; job_quantity?: number | null; source_json?: unknown }
      | null
      | undefined

    // T-169: what the AI produced for this quote, worded for the business.
    // Built here so the page never reads the checker's log or the raw signals.
    const checkerRow = checkerResult.data as { issues?: unknown; checked_total?: unknown } | null
    const understanding = quoteUnderstanding({
      photoCount: photos.length,
      signals: quote.signals_json,
      content: quote.content_json,
      pricing: quote.pricing_json,
      questions: (quote as { clarification_questions_json?: unknown }).clarification_questions_json,
      answers: (quote as { clarification_answers_json?: unknown }).clarification_answers_json,
      expectedSignals: (quote.service as { expected_signals?: unknown } | null)?.expected_signals,
      checker: checkerRow ? { issues: checkerRow.issues, checkedTotal: checkerRow.checked_total } : null,
    })

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
        approved_at: quote.approved_at ?? null,
        // T-158: the tracker's final step (declined or expired) shows its date
        declined_at: quote.declined_at ?? null,
        token_expires_at: quote.token_expires_at ?? null,
        // This response enumerates fields: a column left out here is invisible
        // to the dashboard quote page. T-147's review_hold and T-150's is_test
        // were missing until T-151 added acceptance_json.
        review_hold: ((quote as { review_hold?: string | null }).review_hold ?? null) as 'shown' | 'held' | 'check' | null,
        is_test: (quote as { is_test?: boolean }).is_test === true,
        acceptance_json: ((quote as { acceptance_json?: unknown }).acceptance_json ?? null) as QuoteDetailResponse['quote']['acceptance_json'],
      },
      service: quote.service,
      amendments,
      feedback,
      smsActive: (smsResult.data as { is_active?: boolean } | null)?.is_active === true,
      photos,
      understanding,
      request: requestDetails(requestRow, fieldLabels(fieldRows.data as FieldRow[] | null, quote.service_id)),
      serviceSuggestion: serviceSuggestionOf(requestRow?.source_json),
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

/** T-133: customer-facing total in the tenant's locale */
function formatTotal(pricing: QuotePricing, locale: string): string {
  return formatMoney(pricing.total, pricing.currency, locale)
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
    if (!Array.isArray(body.pricing_json.breakdown)) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'pricing_json.breakdown must be a list of lines' } },
        { status: 400 }
      )
    }

    // Fetch current quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        tenants!tenant_id (
          id, name, region, currency, tax_enabled, tax_label, tax_rate, branding_json
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

    // Reject if status doesn't allow editing (the rule the Edit button reads)
    if (!canEditQuote(quote.status)) {
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
      id: string; name: string; region?: string | null; currency: string
      tax_enabled: boolean; tax_label: string | null; tax_rate: number
      branding_json: TenantBranding | null
    }
    const service = quote.services as { id: string; name: string }

    const beforePricing = quote.pricing_json as QuotePricing
    const beforeContent = quote.content_json as QuoteContent

    // T-157: money is always rounded. Each line to 2 decimals, and the
    // subtotal is the sum of the rounded lines, so the lines always add up.
    // A line whose amount changed under an untouched generated label loses
    // that label's maths ("£18 x 34.6(Sqm)"): the customer never sees maths
    // that doesn't match the amount. Text the business typed is left alone.
    const generatedLabels = (
      (quote.pricing_trace_json as { trace?: Array<{ description?: unknown }> } | null)?.trace ?? []
    )
      .map((step) => step.description)
      .filter((d): d is string => typeof d === 'string')
    const pricing = { ...body.pricing_json }
    // T-165: the minimum charge is a floor, not an item. A quote that carries
    // one keeps it only as the marked entry, worked out again here from the
    // lines that were sent (never the amount the client sent); a quote
    // without one never gets one (shared/minimum-charge.ts).
    pricing.breakdown = editedBreakdown(
      beforePricing?.breakdown ?? [],
      dropStaleLabelMath(
        beforePricing?.breakdown ?? [],
        body.pricing_json.breakdown.map((item) => ({ ...item, amount: roundMoney(Number(item.amount)) })),
        generatedLabels
      )
    )
    pricing.subtotal = roundMoney(pricing.breakdown.reduce((sum, item) => sum + item.amount, 0))

    if (tenant.tax_enabled && tenant.tax_rate > 0) {
      pricing.taxLabel = resolveRegionContext(tenant).taxLabel // T-133: region default label
      pricing.taxRate = tenant.tax_rate * 100
      pricing.taxAmount = Math.round(pricing.subtotal * tenant.tax_rate * 100) / 100
    } else {
      pricing.taxAmount = 0
    }
    pricing.total = Math.round((pricing.subtotal + pricing.taxAmount) * 100) / 100

    // T-179: service sections on a combined quote. The editor can add, edit
    // or remove them; every figure is worked out again here. A quote that
    // neither had nor gets a section takes none of this path.
    const beforeSections = addedSections(beforePricing)
    const sentRaw = (body.pricing_json as unknown as { sections?: unknown }).sections
    const sentSections = Array.isArray(sentRaw) ? (sentRaw as Array<Partial<QuoteSection>>) : []
    let combined: CombinedPricing = pricing
    const storedSections: QuoteSection[] = []
    delete (pricing as CombinedPricing).sections
    if (beforeSections.length > 0 || sentSections.length > 0) {
      if (sentSections.length > MAX_ADDED_SECTIONS) {
        return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: `A quote can carry up to ${MAX_ADDED_SECTIONS} added services` } }, { status: 400 })
      }
      const ids = sentSections.map((sec) => sec.serviceId).filter((id): id is string => typeof id === 'string')
      if (ids.length !== sentSections.length || new Set(ids).size !== ids.length || ids.includes(service.id) || sentSections.some((sec) => !Array.isArray(sec.breakdown))) {
        return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Each added service must be a different one of your services, with its lines' } }, { status: 400 })
      }
      // Only this business's own active services (or one already on the quote) can be a section
      const { data: serviceRows } = ids.length
        ? await supabase.from('services').select('id, name, tax_exempt, active').eq('tenant_id', auth.tenantId).in('id', ids)
        : { data: [] }
      const known = new Map(((serviceRows ?? []) as Array<{ id: string; name: string; tax_exempt?: boolean | null; active?: boolean | null }>).map((row) => [row.id, row]))
      const nowIso = new Date().toISOString()
      for (const sent of sentSections) {
        const row = known.get(sent.serviceId as string)
        const before = beforeSections.find((sec) => sec.serviceId === sent.serviceId)
        if (!row || (!before && row.active === false)) {
          return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'An added service is not one of your active services' } }, { status: 400 })
        }
        const lines = (sent.breakdown ?? [])
          .filter((line) => line && typeof line.label === 'string')
          .map((line) => ({ ...line, amount: roundMoney(Number(line.amount)) }))
        const breakdown = editedSectionBreakdown(before?.breakdown, lines)
        storedSections.push({
          serviceId: row.id,
          serviceName: row.name,
          breakdown,
          subtotal: roundMoney(breakdown.reduce((sum, line) => sum + line.amount, 0)),
          ...(row.tax_exempt === true && { taxExempt: true }),
          addedBy: before?.addedBy ?? 'business',
          addedAt: before?.addedAt ?? nowIso,
          ...((before?.answers ?? sent.answers) && { answers: (before?.answers ?? sent.answers ?? []).slice(0, 40) }),
        })
      }
      // read with the signed-in business's own access: its tenant row and its service
      const { tax } = await sectionTaxFor(supabase as unknown as Parameters<typeof sectionTaxFor>[0], auth.tenantId, service.id)
      combined = withSections(pricing, storedSections, tax)
      Object.assign(pricing, combined)
      if (storedSections.length === 0) delete (pricing as CombinedPricing).sections
    }

    // T-179: what the customer also asked for is not the editor's to drop. It
    // is kept from the stored quote, each service's state following the sections.
    const keptAlsoAsked = alsoAskedWithStates(alsoAskedOf(beforeContent), storedSections)
    if (keptAlsoAsked.length > 0) (body.content_json as QuoteContent).alsoAsked = keptAlsoAsked

    // Compute changes
    const changes = computeChanges(beforePricing, pricing, beforeContent, body.content_json)

    const newVersion = currentVersion + 1
    const now = new Date().toISOString()

    // Determine new status
    // T-157: a quote the customer already had becomes, or stays, revised
    let newStatus = quote.status as QuoteStatus
    if (body.sendToCustomer) newStatus = statusAfterEditAndSend(newStatus)

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
      // T-146: sending after editing IS the business's review — the customer
      // sees "Quote — reviewed and confirmed". The link the customer already
      // holds stays valid alongside the new one (T-157: so does every earlier
      // link, kept by the database trigger in link_token_hashes).
      updatePayload.previous_token_hash = quote.quote_token_hash
      updatePayload.quote_token_hash = hash
      updatePayload.token_expires_at = tokenExpiry.toISOString()
      updatePayload.sent_at = now
      updatePayload.approved_at = now
      updatePayload.approved_by = auth.userId
      // T-156: editing then sending is an approval too
      updatePayload.approved_via = bearerToken(request.headers.get('authorization')) ? 'app' : 'dashboard'

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      quoteViewUrl = `${appUrl}/q/${quoteId}?token=${token}`
    }

    // Update quote
    const { error: updateError } = await supabase
      .from('quotes')
      .update(updatePayload)
      .eq('id', quoteId)
      .eq('tenant_id', auth.tenantId)
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

    // T-157: sending the edited quote answers the customer, so every pending
    // question on this quote is resolved, not only the one the editor linked.
    // A plain save still resolves just the linked one, as before.
    if (body.sendToCustomer) {
      await supabase
        .from('quote_feedback')
        .update({ status: 'resolved' })
        .eq('quote_id', quoteId)
        .eq('tenant_id', auth.tenantId)
        .eq('status', 'pending')
    } else if (body.feedbackId) {
      await supabase
        .from('quote_feedback')
        .update({ status: 'resolved' })
        .eq('id', body.feedbackId)
        .eq('quote_id', quoteId)
        .eq('tenant_id', auth.tenantId)
    }

    // Send revised email to customer if requested
    // T-146: a held quote's first send is the customer's FIRST quote, not an update
    const firstSend = !(QUOTE_ALREADY_SENT_STATUSES as readonly string[]).includes(quote.status)
    // T-176: a first send is an approval, so an estimate asked for on WhatsApp is announced there too
    // (as in lib/quote-approval.ts). Started here to run beside the email; it never throws, and a
    // revised quote is not announced: the template says "is ready", not "has changed".
    const whatsappNotice =
      body.sendToCustomer && quoteViewUrl && firstSend
        ? notifyEstimateReady({ tenantId: auth.tenantId, quoteId, businessName: tenant.name, region: tenant.region, quoteViewUrl }).catch(() => null)
        : null
    // T-151: a phone-only customer has no email address to send to
    const customerEmail = (quote.customer_json as { email?: string | null } | null)?.email
    // T-157: replies to a customer email reach the business
    const replyTo =
      body.sendToCustomer && quoteViewUrl && isPostmarkConfigured() && customerEmail
        ? await businessReplyTo(auth.tenantId)
        : undefined
    if (body.sendToCustomer && quoteViewUrl && isPostmarkConfigured() && firstSend && customerEmail) {
      const customer = quote.customer_json as { name: string; email: string }
      const locale = resolveRegionContext(tenant).locale
      const emailResult = await sendEmail({
        from: { kind: 'customer', businessName: tenant.name },
        to: customer.email,
        subject: `Your quote from ${tenant.name}`,
        htmlBody: generateCustomerEmailHtml({
          customerName: customer.name,
          businessName: tenant.name,
          serviceName: service.name,
          quoteViewUrl,
          total: formatTotal(pricing, locale),
          sectionsHtml: sectionsEmailHtml(pricing, service.name, locale),
          primaryColor: tenant.branding_json?.primaryColor,
        }),
        tag: 'quote-approved',
        replyTo,
      })
      if (!emailResult.success) console.error('Failed to send quote email:', emailResult.error)
    } else if (body.sendToCustomer && quoteViewUrl && isPostmarkConfigured() && customerEmail) {
      const customer = quote.customer_json as { name: string; email: string }
      const branding = tenant.branding_json || { primaryColor: '#2563eb' }

      const htmlBody = generateRevisedQuoteEmailHtml({
        customerName: customer.name,
        businessName: tenant.name,
        serviceName: service.name,
        quoteViewUrl,
        total: formatTotal(pricing, resolveRegionContext(tenant).locale),
        sectionsHtml: sectionsEmailHtml(pricing, service.name, resolveRegionContext(tenant).locale),
        primaryColor: branding.primaryColor,
      })

      const emailResult = await sendEmail({
        from: { kind: 'customer', businessName: tenant.name },
        to: customer.email,
        subject: `Updated quote from ${tenant.name}`,
        htmlBody,
        tag: 'quote-revised',
        replyTo,
      })

      if (!emailResult.success) {
        console.error('Failed to send revised quote email:', emailResult.error)
      }
    }

    await whatsappNotice

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
