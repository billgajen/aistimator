import { createAdminClient } from '@/lib/supabase/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { enqueueQuoteJob } from '@/lib/queue'
import { incrementUsageCounter } from '@/lib/usage'
import { validateServiceMatch } from '@/lib/ai/service-matcher'
import { NextResponse } from 'next/server'

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

    if (!body.customer?.name || !body.customer?.email) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'customer name and email are required' } },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.customer.email)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' } },
        { status: 400 }
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

    // 2. Validate serviceId belongs to this tenant and is active
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id, name, document_type_default')
      .eq('id', body.serviceId)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single()

    if (serviceError || !service) {
      return NextResponse.json(
        { error: { code: 'INVALID_SERVICE', message: 'Service not found or not available' } },
        { status: 400 }
      )
    }

    // 3. Get tenant details for quote (moved up for service matching settings)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name, currency, tax_enabled, tax_label, tax_rate, service_area_mode, service_area_values')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      return NextResponse.json(
        { error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } },
        { status: 500 }
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
    const projectDescription = body.job?.answers?.find(
      (a) => a.fieldId === '_project_description'
    )?.value as string | undefined

    if (serviceMatchMode !== 'off' && projectDescription) {
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
            return NextResponse.json(
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
            return NextResponse.json(
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
    if (tenant.service_area_mode !== 'none' && body.job?.postcodeOrZip) {
      const postcode = body.job.postcodeOrZip.toUpperCase().trim()
      const allowedValues = (tenant.service_area_values as string[]) || []

      if (tenant.service_area_mode === 'postcode_allowlist') {
        // Check if postcode starts with any allowed prefix
        const isAllowed = allowedValues.some((prefix) =>
          postcode.startsWith(prefix.toUpperCase())
        )
        if (!isAllowed) {
          return NextResponse.json(
            { error: { code: 'OUTSIDE_SERVICE_AREA', message: 'Location is outside service area' } },
            { status: 400 }
          )
        }
      }
      // county_state mode would need additional lookup - skip for now
    }

    // 6. Validate required form fields from widget config
    const { data: widgetConfig } = await supabase
      .from('widget_configs')
      .select('config_json')
      .eq('tenant_id', tenantId)
      .is('service_id', null)
      .single()

    if (widgetConfig?.config_json) {
      const config = widgetConfig.config_json as {
        fields?: Array<{
          fieldId: string
          label: string
          required: boolean
          serviceId?: string | null
          criticalForPricing?: boolean
        }>
      }

      if (config.fields && config.fields.length > 0) {
        // Only validate fields that are global (no serviceId) or match the selected service
        const applicableFields = config.fields.filter((f) => !f.serviceId || f.serviceId === body.serviceId)
        // Required fields OR criticalForPricing fields must be validated
        const requiredFields = applicableFields.filter((f) => f.required || f.criticalForPricing)
        const answers = body.job?.answers || []
        const answerMap = new Map(answers.map((a) => [a.fieldId, a.value]))

        const missingFields: string[] = []
        const missingCriticalFields: string[] = []
        for (const field of requiredFields) {
          const value = answerMap.get(field.fieldId)
          const isEmpty =
            value === undefined ||
            value === null ||
            value === '' ||
            (Array.isArray(value) && value.length === 0)

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
          return NextResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: missingCriticalFields.length > 0
                  ? `Missing critical fields for accurate pricing: ${missingCriticalFields.join(', ')}`
                  : `Missing required fields: ${allMissing.join(', ')}`,
              },
            },
            { status: 400 }
          )
        }
      }
    }

    // 6b. Validate photo requirements from service media config
    const { data: serviceWithMedia } = await supabase
      .from('services')
      .select('media_config')
      .eq('id', body.serviceId)
      .single()

    if (serviceWithMedia?.media_config) {
      const mediaConfig = serviceWithMedia.media_config as {
        minPhotos?: number
        requiredAngles?: Array<{ id: string; label: string }>
      }

      const assetCount = body.assetIds?.length || 0
      const minPhotos = mediaConfig.minPhotos || 0
      const requiredAngles = mediaConfig.requiredAngles || []

      if (assetCount < minPhotos) {
        return NextResponse.json(
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
      // The widget enforces this, but we can warn if no photos provided and angles required
      if (requiredAngles.length > 0 && assetCount === 0) {
        return NextResponse.json(
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
    if (body.assetIds && body.assetIds.length > 0) {
      const { data: assets, error: assetsError } = await supabase
        .from('assets')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', body.assetIds)

      if (assetsError) {
        console.error('Failed to validate assets:', assetsError)
      } else if (!assets || assets.length !== body.assetIds.length) {
        return NextResponse.json(
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
        service_id: body.serviceId,
        customer_name: body.customer.name,
        customer_email: body.customer.email,
        customer_phone: body.customer.phone || null,
        job_postcode: body.job?.postcodeOrZip || null,
        job_address: body.job?.address || null,
        job_quantity: body.job?.quantity || null,
        job_answers: body.job?.answers || [],
        asset_ids: body.assetIds || [],
        source_json: body.source || { type: 'widget' },
      })
      .select()
      .single()

    if (qrError || !quoteRequest) {
      console.error('Failed to create quote request:', qrError)
      return NextResponse.json(
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
        service_id: body.serviceId,
        customer_json: {
          name: body.customer.name,
          email: body.customer.email,
          phone: body.customer.phone,
        },
        pricing_json: {
          currency: tenant.currency,
          subtotal: 0,
          taxLabel: tenant.tax_enabled ? tenant.tax_label : undefined,
          taxRate: tenant.tax_enabled ? tenant.tax_rate : undefined,
          taxAmount: 0,
          total: 0,
          breakdown: isGeneralInquiry
            ? [{ description: 'General Inquiry - Manual review required', amount: 0 }]
            : [],
        },
        document_type: service.document_type_default,
        is_general_inquiry: isGeneralInquiry,
        content_json: isGeneralInquiry
          ? {
              title: 'General Inquiry',
              intro: `Thank you for your inquiry. Our team will review your request and get back to you shortly.`,
              scope: projectDescription || 'No description provided',
            }
          : {},
        status: isGeneralInquiry ? 'sent' : 'queued',
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
      })
      .select('id')
      .single()

    if (quoteError || !quote) {
      console.error('Failed to create quote:', quoteError)
      // Clean up quote request
      await supabase.from('quote_requests').delete().eq('id', quoteRequest.id)
      return NextResponse.json(
        { error: { code: 'CREATE_FAILED', message: 'Failed to create quote' } },
        { status: 500 }
      )
    }

    // 11. Update assets to link to this quote request
    if (body.assetIds && body.assetIds.length > 0) {
      await supabase
        .from('assets')
        .update({ quote_request_id: quoteRequest.id })
        .in('id', body.assetIds)
    }

    // 12. Increment usage counter for estimates_created
    await incrementUsageCounter(supabase, tenantId, 'estimates_created')

    // 13. Enqueue job for processing (skip for general inquiries - they need manual review)
    if (!isGeneralInquiry) {
      await enqueueQuoteJob({
        quoteId: quote.id,
        quoteRequestId: quoteRequest.id,
        tenantId: tenantId,
        timestamp: Date.now(),
        quoteToken: token, // Pass token for email links
      })
    } else {
      // For general inquiries, mark as ready (no AI processing needed)
      await supabase
        .from('quotes')
        .update({ status: 'sent' })
        .eq('id', quote.id)
    }

    // 14. Build response
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const quoteViewUrl = `${appUrl}/q/${quote.id}?token=${token}`

    return NextResponse.json({
      quoteId: quote.id,
      status: isGeneralInquiry ? 'sent' : 'queued',
      isGeneralInquiry,
      quoteViewUrl,
      tokenExpiresAt: tokenExpiry.toISOString(),
    })
  } catch (error) {
    console.error('Quote request error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
