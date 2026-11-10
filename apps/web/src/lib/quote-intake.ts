/**
 * Quote intake (T-137): everything between "this request belongs to tenant X"
 * and "the job is queued", shared by the website widget route
 * (/api/public/quotes, tenant from the public key + bot checks) and the
 * business app route (/api/app/quotes, tenant from the signed-in user).
 *
 * Moved verbatim from the public route; the only behaviour switches are
 * `skipServiceMatch` (the business picked the service on site) and the
 * caller-supplied `source`.
 */

import { descriptionRequired } from '@/lib/contact-rules'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { enqueueQuoteJob } from '@/lib/queue'
import { incrementUsageCounter } from '@/lib/usage'
import { checkPlanLimit, maybeNotifyLimitReached, recordOverageQuote } from '@/lib/plan-limits'
import { leadHoldContent, leadHeldMessage, notifyLeadHeld } from '@/lib/lead-hold'
import { validateServiceMatch } from '@/lib/ai/service-matcher'
import type { createAdminClient } from '@/lib/supabase/server'

export interface CustomerInput {
  name: string
  /** T-151: optional when the business requires a phone number instead */
  email?: string
  phone?: string
}

export interface JobInput {
  address?: string
  postcodeOrZip?: string
  quantity?: number
  answers?: Array<{ fieldId: string; value: string | number | boolean | string[] }>
}

export interface QuoteIntakeInput {
  tenantId: string
  serviceId: string
  customer: CustomerInput
  job?: JobInput
  assetIds?: string[]
  source: Record<string, unknown>
  /** Business-created on site: the business chose the service, skip the AI service match */
  skipServiceMatch?: boolean
  /**
   * T-150: the owner's test request from setup (decided by the caller from a
   * server-issued token). Not limited by the plan and never counted.
   */
  isTest?: boolean
  /**
   * T-151 (public widget only): when the service asks no questions of its
   * own, the free-text description is required. WhatsApp/SMS don't set it.
   */
  requireDescriptionWithoutQuestions?: boolean
}

export interface QuoteIntakeResult {
  status: number
  json: Record<string, unknown>
}

/** Same call shape as NextResponse.json, so the moved code reads unchanged */
function respond(json: Record<string, unknown>, init?: { status?: number }): QuoteIntakeResult {
  return { status: init?.status ?? 200, json }
}

export async function createQuoteSubmission(
  supabase: ReturnType<typeof createAdminClient>,
  input: QuoteIntakeInput
): Promise<QuoteIntakeResult> {
  const tenantId = input.tenantId

  // 2. Validate serviceId belongs to this tenant and is active
  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('id, name, document_type_default')
    .eq('id', input.serviceId)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .single()

  if (serviceError || !service) {
    return respond(
      { error: { code: 'INVALID_SERVICE', message: 'Service not found or not available' } },
      { status: 400 }
    )
  }

  // 3. Get tenant details for quote (moved up for service matching settings)
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select(
      'id, name, currency, tax_enabled, tax_label, tax_rate, service_area_mode, service_area_values'
    )
    .eq('id', tenantId)
    .single()

  if (tenantError || !tenant) {
    return respond(
      { error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } },
      { status: 500 }
    )
  }

  // 3b. Enforce plan limit (T-101/T-102) — before any records are created.
  // Over the limit: metered overage lets the quote proceed (active paid plans
  // with overage pricing); otherwise hard block. Customer-facing message is
  // deliberately neutral: never expose the business's billing state.
  const planLimit = await checkPlanLimit(supabase, tenantId)
  // T-150: a test request is outside the plan: never held, never metered
  const isTest = input.isTest === true
  const isOverageQuote = !isTest && !planLimit.allowed && planLimit.overageAvailable
  // T-134 (AD-026): over the limit with overage off → capture as an unpriced
  // lead (never lose a submission); no AI runs, the business is told to upgrade
  const limitHold = !isTest && !planLimit.allowed && !planLimit.overageAvailable
  if (limitHold) {
    console.warn(
      `[Quotes] Plan limit reached for tenant (${planLimit.used}/${planLimit.limit}) — capturing as held lead`
    )
  }

  // Get service matching settings (may not exist if migration not applied)
  const { data: tenantSettings } = await supabase
    .from('tenants')
    .select('service_match_mode, general_inquiry_enabled')
    .eq('id', tenantId)
    .single()

  // Use defaults if columns don't exist yet
  const serviceMatchMode = (tenantSettings?.service_match_mode as string) || 'medium'
  const generalInquiryEnabled = tenantSettings?.general_inquiry_enabled ?? true

  // 4. Validate service match using AI (if enabled)
  let isGeneralInquiry = false
  const projectDescription = input.job?.answers?.find((a) => a.fieldId === '_project_description')
    ?.value as string | undefined

  if (!limitHold && !input.skipServiceMatch && serviceMatchMode !== 'off' && projectDescription) {
    // Get all active services for this tenant for suggestions
    const { data: allServices } = await supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('active', true)

    const geminiKey = process.env.GEMINI_API_KEY
    if (geminiKey && allServices && allServices.length > 0) {
      const matchResult = await validateServiceMatch(
        projectDescription,
        { id: service.id, name: service.name },
        allServices,
        geminiKey
      )

      // Determine confidence threshold based on strictness
      // Higher strictness = lower threshold to trigger rejection
      const thresholds: Record<string, number> = {
        low: 0.9, // Only reject if 90%+ confident it's wrong
        medium: 0.8, // Reject if 80%+ confident it's wrong (default)
        high: 0.7, // Reject if 70%+ confident it's wrong
      }
      const threshold = thresholds[serviceMatchMode] || 0.8

      // If not a match with sufficient confidence, handle it
      if (!matchResult.isMatch && matchResult.confidence >= threshold) {
        // Check if there's a suggested service
        if (matchResult.suggestedServiceId && matchResult.suggestedServiceName) {
          // Wrong service selected, suggest the correct one
          return respond(
            {
              error: {
                code: 'SERVICE_MISMATCH',
                message: `The selected service doesn't match your project description. Did you mean "${matchResult.suggestedServiceName}"?`,
                suggestedService: {
                  id: matchResult.suggestedServiceId,
                  name: matchResult.suggestedServiceName,
                },
              },
            },
            { status: 400 }
          )
        }

        // No matching service available
        if (generalInquiryEnabled) {
          // Create as general inquiry instead of rejecting
          isGeneralInquiry = true
          console.log(
            `[QuoteAPI] Creating general inquiry for unmatched project: "${projectDescription.slice(0, 50)}..."`
          )
        } else {
          // Reject the request
          return respond(
            {
              error: {
                code: 'SERVICE_NOT_AVAILABLE',
                message: `Sorry, we don't currently offer services matching your description: '${projectDescription.slice(0, 100)}${projectDescription.length > 100 ? '...' : ''}'.`,
                reason: matchResult.reason,
              },
            },
            { status: 400 }
          )
        }
      }
    }
  }

  // 5. Validate service area if configured
  if (tenant.service_area_mode !== 'none' && input.job?.postcodeOrZip) {
    const postcode = input.job.postcodeOrZip.toUpperCase().trim()
    const allowedValues = (tenant.service_area_values as string[]) || []

    if (tenant.service_area_mode === 'postcode_allowlist') {
      // Check if postcode starts with any allowed prefix
      const isAllowed = allowedValues.some((prefix) => postcode.startsWith(prefix.toUpperCase()))
      if (!isAllowed) {
        return respond(
          { error: { code: 'OUTSIDE_SERVICE_AREA', message: 'Location is outside service area' } },
          { status: 400 }
        )
      }
    }
    // county_state mode would need additional lookup - skip for now
  }

  // 6. Validate required form fields from widget config.
  // T-129 (hardcore-test F4): fields live in TWO places — the global row
  // (service_id NULL, fields optionally scoped via a serviceId property) AND
  // a per-service row created by /api/services from compiled suggestedFields.
  // Validating only the global row let every per-service required field
  // through unanswered, which the engine then priced at quantity 1.
  type WidgetField = {
    fieldId: string
    label: string
    type?: string
    required: boolean
    serviceId?: string | null
    criticalForPricing?: boolean
  }
  const { data: widgetConfigRows } = await supabase
    .from('widget_configs')
    .select('service_id, config_json')
    .eq('tenant_id', tenantId)

  // General inquiries aren't bound to the selected service's form
  if (widgetConfigRows && widgetConfigRows.length > 0 && !isGeneralInquiry) {
    const fieldsToValidate: WidgetField[] = []
    for (const row of widgetConfigRows) {
      const fields = (row.config_json as { fields?: WidgetField[] } | null)?.fields
      if (!fields?.length) continue
      if (row.service_id === null) {
        // Global row: fields apply when unscoped or scoped to this service
        fieldsToValidate.push(
          ...fields.filter((f) => !f.serviceId || f.serviceId === input.serviceId)
        )
      } else if (row.service_id === input.serviceId) {
        fieldsToValidate.push(...fields)
      }
    }

    // Required fields OR criticalForPricing fields must be validated (dedupe by fieldId)
    const seen = new Set<string>()
    const requiredFields = fieldsToValidate.filter((f) => {
      if (!(f.required || f.criticalForPricing) || seen.has(f.fieldId)) return false
      seen.add(f.fieldId)
      return true
    })
    const answers = input.job?.answers || []
    const answerMap = new Map(answers.map((a) => [a.fieldId, a.value]))

    const missingFields: string[] = []
    const missingCriticalFields: string[] = []
    for (const field of requiredFields) {
      const value = answerMap.get(field.fieldId)
      const isEmpty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        // a number field answered with non-numeric text is not an answer —
        // the engine would silently fall back to quantity 1
        (field.type === 'number' && !Number.isFinite(Number(value)))

      if (isEmpty) {
        if (field.criticalForPricing) {
          missingCriticalFields.push(field.label)
        } else if (field.required) {
          missingFields.push(field.label)
        }
      }
    }

    if (missingFields.length > 0 || missingCriticalFields.length > 0) {
      const allMissing = [...missingFields, ...missingCriticalFields]
      return respond(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              missingCriticalFields.length > 0
                ? `Missing critical fields for accurate pricing: ${missingCriticalFields.join(', ')}`
                : `Missing required fields: ${allMissing.join(', ')}`,
          },
        },
        { status: 400 }
      )
    }
  }

  // 6a. T-151: a service with no questions of its own needs the free-text
  // description (the business has nothing else to go on); with questions it
  // is optional. Counted from the same rows the widget shows.
  if (input.requireDescriptionWithoutQuestions && !isGeneralInquiry && !limitHold) {
    const questionIds = new Set<string>()
    for (const row of widgetConfigRows || []) {
      const fields = (row.config_json as { fields?: WidgetField[] } | null)?.fields || []
      for (const f of fields) {
        if (row.service_id === null ? !f.serviceId || f.serviceId === input.serviceId : row.service_id === input.serviceId) {
          questionIds.add(f.fieldId)
        }
      }
    }
    if (descriptionRequired(questionIds.size) && !(projectDescription || '').trim()) {
      return respond(
        { error: { code: 'VALIDATION_ERROR', message: 'Please describe the job.' } },
        { status: 400 }
      )
    }
  }

  // 6b. Validate photo requirements from service media config
  const { data: serviceWithMedia } = await supabase
    .from('services')
    .select('media_config')
    .eq('id', input.serviceId)
    .single()

  if (serviceWithMedia?.media_config) {
    const mediaConfig = serviceWithMedia.media_config as {
      minPhotos?: number
      requiredAngles?: Array<{ id: string; label: string }>
    }

    const assetCount = input.assetIds?.length || 0
    const minPhotos = mediaConfig.minPhotos || 0
    const requiredAngles = mediaConfig.requiredAngles || []

    if (assetCount < minPhotos) {
      return respond(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Please provide at least ${minPhotos} photo${minPhotos > 1 ? 's' : ''} for an accurate quote`,
          },
        },
        { status: 400 }
      )
    }

    // Note: We can't validate specific angles server-side without metadata
    // Only enforce requiredAngles if minPhotos > 0 (respects the business setting)
    if (minPhotos > 0 && requiredAngles.length > 0 && assetCount === 0) {
      return respond(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Please provide required photos: ${requiredAngles.map((a) => a.label).join(', ')}`,
          },
        },
        { status: 400 }
      )
    }
  }

  // 7. Validate assetIds belong to this tenant (if provided)
  if (input.assetIds && input.assetIds.length > 0) {
    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', input.assetIds)

    if (assetsError) {
      console.error('Failed to validate assets:', assetsError)
    } else if (!assets || assets.length !== input.assetIds.length) {
      return respond(
        { error: { code: 'INVALID_ASSETS', message: 'One or more asset IDs are invalid' } },
        { status: 400 }
      )
    }
  }

  // 8. Create quote_request record
  const { data: quoteRequest, error: qrError } = await supabase
    .from('quote_requests')
    .insert({
      tenant_id: tenantId,
      service_id: input.serviceId,
      customer_name: input.customer.name,
      customer_email: input.customer.email,
      customer_phone: input.customer.phone || null,
      job_postcode: input.job?.postcodeOrZip || null,
      job_address: input.job?.address || null,
      job_quantity: input.job?.quantity || null,
      job_answers: input.job?.answers || [],
      asset_ids: input.assetIds || [],
      source_json: input.source,
    })
    .select()
    .single()

  if (qrError || !quoteRequest) {
    console.error('Failed to create quote request:', qrError)
    return respond(
      { error: { code: 'CREATE_FAILED', message: 'Failed to create quote request' } },
      { status: 500 }
    )
  }

  // 9. Generate token for quote view URL
  const { token, hash } = generateQuoteToken()
  const tokenExpiry = getTokenExpiry(30) // 30 days

  // 10. Create quote record with status 'queued'
  // For general inquiries, use the selected service's document type but mark status as ready
  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenantId,
      quote_request_id: quoteRequest.id,
      service_id: input.serviceId,
      customer_json: {
        name: input.customer.name,
        email: input.customer.email,
        phone: input.customer.phone,
      },
      pricing_json: {
        currency: tenant.currency,
        subtotal: 0,
        taxLabel: tenant.tax_enabled ? tenant.tax_label : undefined,
        // DB stores rate as decimal (0.20 = 20%), display expects whole number (20 = 20%)
        taxRate: tenant.tax_enabled ? (tenant.tax_rate || 0) * 100 : undefined,
        taxAmount: 0,
        total: 0,
        breakdown: isGeneralInquiry
          ? [{ description: 'General Inquiry - Manual review required', amount: 0 }]
          : [],
      },
      document_type: service.document_type_default,
      is_general_inquiry: isGeneralInquiry,
      is_test: isTest,
      content_json: limitHold
        ? leadHoldContent(tenant.name)
        : isGeneralInquiry
          ? {
              title: 'General Inquiry',
              intro: `Thank you for your inquiry. Our team will review your request and get back to you shortly.`,
              scope: projectDescription || 'No description provided',
            }
          : {},
      status: limitHold ? 'pending_review' : isGeneralInquiry ? 'sent' : 'queued',
      quote_token_hash: hash,
      token_expires_at: tokenExpiry.toISOString(),
    })
    .select('id')
    .single()

  if (quoteError || !quote) {
    console.error('Failed to create quote:', quoteError)
    // Clean up quote request
    await supabase.from('quote_requests').delete().eq('id', quoteRequest.id)
    return respond(
      { error: { code: 'CREATE_FAILED', message: 'Failed to create quote' } },
      { status: 500 }
    )
  }

  // 11. Update assets to link to this quote request
  if (input.assetIds && input.assetIds.length > 0) {
    const { error: linkError } = await supabase
      .from('assets')
      .update({ quote_request_id: quoteRequest.id })
      .in('id', input.assetIds)

    if (linkError) {
      console.error(
        `[Quotes] Failed to link assets to quote request ${quoteRequest.id}:`,
        linkError
      )
      // Don't fail the request — asset_ids are also stored on quote_request as a fallback
    }
  }

  // 12. Held leads (T-134) are not priced, so they don't consume the plan
  if (limitHold) {
    await notifyLeadHeld(supabase, {
      tenantId,
      businessName: tenant.name,
      customerName: input.customer.name,
      serviceName: service.name,
      quoteId: quote.id,
      used: planLimit.used,
      limit: planLimit.limit,
      per: planLimit.per,
    })
    const appUrlHeld = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return respond({
      quoteId: quote.id,
      status: 'held',
      isGeneralInquiry: false,
      message: leadHeldMessage(tenant.name),
      quoteViewUrl: `${appUrlHeld}/q/${quote.id}?token=${token}`,
      tokenExpiresAt: tokenExpiry.toISOString(),
    })
  }

  // 12a. Increment usage counter for estimates_created (T-150: not for tests)
  if (!isTest) {
    await incrementUsageCounter(supabase, tenantId, 'estimates_created')
    // 12b. If this consumed the last quote in the plan, notify the business once (T-101)
    await maybeNotifyLimitReached(supabase, tenantId, tenant.name)
  }

  // 12c. Meter this quote to Stripe when it's beyond the plan limit (T-102).
  // Uses the quote ID as the idempotency identifier — retries can't double-bill.
  if (isOverageQuote) {
    await recordOverageQuote(planLimit, quote.id)
  }

  // 13. Enqueue job for processing (skip for general inquiries - they need manual review)
  let queueFailed = false
  if (!isGeneralInquiry) {
    try {
      await enqueueQuoteJob({
        quoteId: quote.id,
        quoteRequestId: quoteRequest.id,
        tenantId: tenantId,
        timestamp: Date.now(),
        quoteToken: token, // Pass token for email links
      })
    } catch (queueError) {
      console.error(`[Quotes] Failed to enqueue quote ${quote.id}:`, queueError)
      queueFailed = true
      // Mark quote as failed so it's visible in dashboard and can be retried
      await supabase
        .from('quotes')
        .update({ status: 'failed', error_message: 'Queue dispatch failed — will retry' })
        .eq('id', quote.id)
    }
  } else {
    // For general inquiries, mark as ready (no AI processing needed)
    await supabase.from('quotes').update({ status: 'sent' }).eq('id', quote.id)
  }

  // 14. Build response
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const quoteViewUrl = `${appUrl}/q/${quote.id}?token=${token}`

  return respond({
    quoteId: quote.id,
    status: isGeneralInquiry ? 'sent' : queueFailed ? 'failed' : 'queued',
    isGeneralInquiry,
    quoteViewUrl,
    tokenExpiresAt: tokenExpiry.toISOString(),
    ...(queueFailed && { warning: 'Quote created but processing delayed. We will retry shortly.' }),
  })
}
