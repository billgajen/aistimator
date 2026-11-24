import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { businessIsAsked, isMadeByBusiness, isQuoteProcessing, resolveRegionContext, isShownEarly, customerEstimateRange, customerRangeAllowed, customerSeesNoFigure, reviewModeOf, canCustomerDecide, displaySectionsForCustomer, alsoAskedOf, alsoAskedWithStates, addedSections, roomScanOfAnswers, customerRoomScanView } from '@qolumns/shared'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { hasCustomBranding } from '@/lib/plan-features'
import { customerReadLines } from '@/lib/customer-read'
import { customerTerms } from '@/lib/quote-terms'
import { pricingForCustomerView } from '@/lib/quote-sections-service'
import type {
  QuoteViewResponse,
  QuoteViewBusiness,
  QuoteViewCustomer,
  QuoteViewAsset,
  CombinedPricing,
  QuoteContent,
  CrossServicePricing,
  SignalRecommendation,
} from '@qolumns/shared'

/**
 * GET /api/public/quotes/:quoteId
 * Returns quote view data for the hosted quote page.
 * Requires valid token in query param.
 */
export async function GET(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return NextResponse.json(
        { error: { code: 'MISSING_TOKEN', message: 'Token is required' } },
        { status: 401 }
      )
    }

    // Hash the token to compare with stored hash
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const supabase = createAdminClient()

    // Fetch quote with token validation
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        pdf_asset_id,
        tenants!tenant_id (
          id,
          name,
          region,
          currency,
          unit_system,
          template_json,
          branding_json,
          default_terms_text
        ),
        services!service_id (
          id,
          name,
          auto_send,
          hold_until_approved
        ),
        quote_requests!quote_request_id (
          id,
          asset_ids,
          source_json,
          job_answers
        )
      `)
      .eq('id', quoteId)
      .or(quoteTokenFilter(tokenHash))
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found or invalid token' } },
        { status: 404 }
      )
    }

    // Check token expiry
    if (quote.token_expires_at && new Date(quote.token_expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'TOKEN_EXPIRED', message: 'Quote link has expired' } },
        { status: 410 }
      )
    }

    // Update viewed_at if not already set.
    // Skip when this is a background status poll (T-108) — the widget polls
    // after submission and must not count as the customer viewing the quote.
    const isStatusPoll = url.searchParams.get('poll') === '1'
    // Queue path: opening the page before the worker has priced the quote is
    // not a view of the estimate (it would also block the later sent → viewed).
    // T-147: a view never moves a quote off pending_review (only `sent` moves,
    // to `viewed`). A customer who opened the estimate before approval already
    // has viewed_at, so the first view after approval must still record
    // sent → viewed.
    if (!isStatusPoll && !isQuoteProcessing(quote.status) && (!quote.viewed_at || quote.status === 'sent')) {
      await supabase
        .from('quotes')
        .update({
          ...(!quote.viewed_at && { viewed_at: new Date().toISOString() }),
          status: quote.status === 'sent' ? 'viewed' : quote.status
        })
        .eq('id', quoteId)
    }

    // Fetch assets if any
    const assetIds = (quote.quote_requests as { asset_ids: string[] })?.asset_ids || []
    let assets: QuoteViewAsset[] = []

    if (assetIds.length > 0) {
      const { data: assetRecords } = await supabase
        .from('assets')
        .select('id, type, file_name')
        .in('id', assetIds)

      if (assetRecords) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        assets = assetRecords.map((asset) => ({
          assetId: asset.id,
          type: asset.type === 'image' ? 'image' : 'document',
          viewUrl: `${appUrl}/api/public/assets/${asset.id}?token=${token}`,
          ...(asset.type === 'image' && { smallUrl: `${appUrl}/api/public/assets/${asset.id}?token=${token}&size=small` }),
        }))
      }
    }

    // Build response
    const tenant = quote.tenants as {
      id: string
      name: string
      region?: string | null
      currency?: string | null
      unit_system?: string | null
      template_json: Record<string, unknown> | null
      default_terms_text?: string | null
      branding_json: {
        logoAssetId?: string | null
        primaryColor?: string
        footerNotes?: string | null
        tagline?: string | null
        phone?: string | null
        email?: string | null
        website?: string | null
      } | null
    }
    // T-179: a part the customer added whose service holds until approved has
    // no price for them yet. It is left out of every figure below, so the rest
    // of the quote reads exactly as it did before they added it.
    const fullPricing = quote.pricing_json as CombinedPricing
    const { pricing, awaiting: awaitingParts } = await pricingForCustomerView(supabase, {
      tenant_id: quote.tenant_id as string,
      service_id: quote.service_id as string,
      status: quote.status,
      pricing_json: fullPricing,
    })
    const content = quote.content_json as QuoteContent & {
      validityDays?: number
      crossServicePricing?: CrossServicePricing[]
      signalRecommendations?: SignalRecommendation[]
    }
    const customer = quote.customer_json as { name: string; email?: string | null; phone?: string | null }

    // Tenant branding: logo (short-lived signed URL), colour, footer notes
    const brandingJson = tenant.branding_json || {}
    let logoUrl: string | undefined
    if (brandingJson.logoAssetId && isR2Configured()) {
      const { data: logoAsset } = await supabase
        .from('assets')
        .select('r2_key')
        .eq('id', brandingJson.logoAssetId)
        .single()
      if (logoAsset) {
        logoUrl = await generateDownloadUrl(logoAsset.r2_key)
      }
    }

    const business: QuoteViewBusiness = {
      name: tenant.name,
      logoUrl,
      tagline: brandingJson.tagline ?? null,
      phone: brandingJson.phone ?? null,
      email: brandingJson.email ?? null,
      website: brandingJson.website ?? null,
    }

    // White-label: Growth/Pro (custom_branding) drop the Qolumns badge
    const whiteLabel = await hasCustomBranding(supabase, tenant.id)

    const customerView: QuoteViewCustomer = {
      name: customer.name,
      phone: customer.phone ?? null,
      hasEmail: Boolean(customer.email && customer.email.trim()),
    }

    // Calculate validity date
    let validUntil: string | undefined
    if (content.validityDays && quote.sent_at) {
      const sentDate = new Date(quote.sent_at)
      sentDate.setDate(sentDate.getDate() + content.validityDays)
      validUntil = sentDate.toISOString()
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Build actions object
    const actions: QuoteViewResponse['actions'] = {
      acceptUrl: `${appUrl}/api/public/quotes/${quoteId}/accept`,
      // payUrl would be added when Stripe is integrated
    }

    // Add PDF download URL if PDF exists
    if (quote.pdf_asset_id && awaitingParts.length === 0) {
      actions.pdfUrl = `${appUrl}/api/public/quotes/${quoteId}/pdf?token=${token}`
    }

    // T-109 range-first: while the quote is provisional (awaiting customer
    // confirmation or business review), withhold exact pricing and expose an
    // estimated range instead — the final price may still change.
    // T-147: a quote held only for the default business review, on a service
    // set to "show, then confirm", is shown now with its real figures. Anything
    // a check held (or an older / held row) stays provisional and hidden.
    const shownEarly = isShownEarly({
      status: quote.status,
      review_hold: (quote as { review_hold?: string | null }).review_hold,
      total: (quote.pricing_json as { total?: number } | null)?.total,
      limitHold: (quote.content_json as { limitHold?: boolean } | null)?.limitHold,
    })
    // T-186: a quote the business made never asks the customer anything. While the business has its
    // own questions to answer, the customer's page reads as a quote the business is still preparing.
    const requestOfQuote = ((r: unknown) => (Array.isArray(r) ? r[0] : r))((quote as { quote_requests?: unknown }).quote_requests) as { source_json?: unknown } | null | undefined
    const customerStatus: typeof quote.status = businessIsAsked(quote.status, isMadeByBusiness(requestOfQuote?.source_json)) ? 'pending_review' : quote.status
    const isProvisional =
      (customerStatus === 'awaiting_clarification' || customerStatus === 'pending_review') && !shownEarly
    let provisional: QuoteViewResponse['provisional']
    const storedRange = (pricing as { range?: { low?: number; high?: number } }).range
    const measuredLow = storedRange?.low ?? pricing.estimate?.rangeLow
    const measuredHigh = storedRange?.high ?? pricing.estimate?.rangeHigh
    // T-201: a quote waiting for the business that the customer was not shown
    // ("Hold until I approve", or one a check held) gives the customer no
    // figure at all: no price, no low and no high, here or in the PDF. Until
    // T-201 it showed the engine's measured range (T-146), which is a price by
    // another name. A range is now shown only while the customer is confirming
    // a detail, and not even then for a service that holds until approved.
    const serviceRow = quote.services as { auto_send?: boolean | null; hold_until_approved?: boolean | null } | null
    const showRange = customerRangeAllowed({ status: customerStatus, mode: reviewModeOf(serviceRow ?? {}) })
    // No figure of any kind: also none hidden in a note or a sentence the pipeline wrote, and no PDF
    // (a PDF carries every price). Both the held quote and the detail still to confirm on a holding service.
    const noFigures = customerSeesNoFigure({ status: customerStatus, shownEarly }) || (isProvisional && !showRange)
    // (the PDF route refuses these too; a range is not a PDF's worth of prices either)
    if (isProvisional) delete actions.pdfUrl
    if (isProvisional && (pricing.total || 0) > 0 && showRange) {
      const total = pricing.total || 0
      // Prefer the engine's measured range; fall back to ±12%, rounded to 10s
      const low = measuredLow ?? Math.floor((total * 0.88) / 10) * 10
      const high = measuredHigh ?? Math.ceil((total * 1.12) / 10) * 10
      provisional = {
        rangeLow: low,
        rangeHigh: high,
        reason: customerStatus as 'awaiting_clarification' | 'pending_review',
      }
    }

    // T-146: the customer sees exactly two states. "quote" once the business
    // approved it; otherwise an "estimate". Grades/confidence never leave the
    // server. An unreviewed estimate with uncertain quantities shows its range,
    // unlabelled; once the business confirms it, the price is the price.
    const approvedAt = (quote as { approved_at?: string | null }).approved_at ?? null
    const review: QuoteViewResponse['review'] = approvedAt
      ? { state: 'quote', approvedAt }
      : { state: 'estimate', ...(shownEarly && { confirmationPending: true }) }
    const estimateRange = !isProvisional && !approvedAt ? customerEstimateRange(pricing.estimate) : undefined
    // Takeoff for the customer: plain-words method only (technical evidence is business-only)
    const customerTakeoff = (content.takeoff || []).map((row) => ({
      item: row.item,
      ...(row.quantity !== undefined && { quantity: row.quantity }),
      ...(row.unit !== undefined && { unit: row.unit }),
      ...(row.rate !== undefined && { rate: row.rate }),
      amount: row.amount,
      method: row.method,
    }))

    // T-157: is a question from the customer still waiting for the business?
    // The page keeps its "Message sent" note while one is (also after a
    // reload) and offers no second question. Only looked up where a question
    // can exist: a quote the customer can decide on, or an estimate shown early.
    let questionPending = false
    if (canCustomerDecide(quote.status) || shownEarly) {
      const { count } = await supabase
        .from('quote_feedback')
        .select('id', { count: 'exact', head: true })
        .eq('quote_id', quoteId)
        .eq('tenant_id', quote.tenant_id)
        .eq('status', 'pending')
      questionPending = (count ?? 0) > 0
    }

    // T-133: locale + currency fallback come from the tenant's region
    const regionCtx = resolveRegionContext(tenant)
    const scanOfRequest = roomScanOfAnswers((requestOfQuote as { job_answers?: unknown } | null | undefined)?.job_answers)
    // T-194: only the sizes that priced the quote (not known while the price is still a range)
    const customerScan = scanOfRequest ? customerRoomScanView(scanOfRequest, regionCtx.unitSystem, regionCtx.locale, { takeoff: isProvisional ? [] : content.takeoff }) : null
    // T-171: what was read or measured, in the customer's terms (no amounts, no label text).
    // Withheld with the takeoff while the price is still a range.
    const read = isProvisional
      ? []
      : customerReadLines({
          signals: (quote as { signals_json?: unknown }).signals_json,
          questions: quote.clarification_questions_json,
          answers: (quote as { clarification_answers_json?: unknown }).clarification_answers_json,
          takeoff: content.takeoff,
          locale: regionCtx.locale,
        })

    // T-179: a combined quote's sections, and what else the customer asked for
    const mainServiceName = (quote.services as { name?: string } | null)?.name ?? ''
    const combinedSections = displaySectionsForCustomer(pricing, awaitingParts, { serviceId: quote.service_id as string, serviceName: mainServiceName })
    // (from the full quote: a part waiting for approval is still on it, so it is no longer a card)
    const alsoAsked = alsoAskedWithStates(alsoAskedOf(content), addedSections(fullPricing))

    const response: QuoteViewResponse = {
      quoteId: quote.id,
      status: customerStatus,
      documentType: quote.document_type,
      locale: regionCtx.locale,
      version: quote.version ?? 1,
      business,
      branding: {
        primaryColor: brandingJson.primaryColor,
        footerNotes: brandingJson.footerNotes ?? null,
        showPoweredBy: !whiteLabel,
      },
      customer: customerView,
      review,
      ...(estimateRange && { estimateRange }),
      ...(provisional && { provisional }),
      // T-108: surface stored questions so the clarify page can render them
      // (previously never returned — the clarify page could not load questions)
      ...(customerStatus === 'awaiting_clarification' &&
        quote.clarification_questions_json && {
          clarificationQuestions: quote.clarification_questions_json,
        }),
      // T-122: takeoff (withheld while provisional — exact amounts) + reference
      ...(!isProvisional && customerTakeoff.length > 0 && { takeoff: customerTakeoff }),
      ...(read.length > 0 && { read }),
      ...(content.reference && { reference: content.reference }),
      pricing: isProvisional
        ? {
            // Exact figures withheld while provisional — range shown instead
            currency: pricing.currency || regionCtx.currency,
            subtotal: 0,
            taxAmount: 0,
            total: 0,
            breakdown: [],
            notes: noFigures ? [] : pricing.notes || [],
          }
        : {
            currency: pricing.currency || regionCtx.currency,
            subtotal: pricing.subtotal || 0,
            taxLabel: pricing.taxLabel,
            taxRate: pricing.taxRate,
            taxAmount: pricing.taxAmount || 0,
            total: pricing.total || 0,
            breakdown: pricing.breakdown || [],
            notes: pricing.notes || [],
            ...(pricing.availableAddons && pricing.availableAddons.length > 0 && {
              availableAddons: pricing.availableAddons,
            }),
            // T-146: no `estimate` (grade/label/description) — business-only
          },
      breakdown: isProvisional ? [] : pricing.breakdown || [],
      // T-201: nothing the pipeline wrote is sent while the customer may see no figure (a sentence can name one)
      notes: noFigures
        ? { validityDays: content.validityDays }
        : {
            scopeSummary: content.scopeSummary,
            assumptions: content.assumptions,
            exclusions: content.exclusions,
            notes: content.notes,
            validityDays: content.validityDays,
          },
      validUntil,
      assets,
      actions,
      // Include cross-service pricing if available (quotes made before T-179)
      ...(!noFigures && content.crossServicePricing && content.crossServicePricing.length > 0 && {
        crossServicePricing: content.crossServicePricing,
      }),
      // T-179: one request, several services. Only once the customer can see
      // a price: the sections of a combined quote, and what else they asked for.
      serviceName: mainServiceName,
      ...(!isProvisional && combinedSections && { sections: combinedSections }),
      ...(!isProvisional && alsoAsked.length > 0 && { alsoAsked }),
      ...(!isProvisional && alsoAsked.some((a) => a.state !== 'not_offered') && {
        canChangeSections: canCustomerDecide(quote.status) || shownEarly,
      }),
      // Include AI-recommended additional work if available
      ...(!noFigures && content.signalRecommendations && content.signalRecommendations.length > 0 && {
        signalRecommendations: content.signalRecommendations,
      }),
      // Accept quote toggle — defaults to true for backward compatibility.
      // Never accept-able while provisional (price isn't final yet), nor
      // (T-147) while an estimate shown early awaits the business's approval.
      acceptQuoteEnabled: !isProvisional && !shownEarly && tenant.template_json?.acceptQuoteEnabled !== false,
      ...(questionPending && { questionPending: true }),
      // T-201: the business's "Default Terms & Conditions" (Settings), printed below the price. Only when
      // filled in, and only on a page that shows a price (a held quote shows no document at all).
      ...(!isProvisional && customerTerms(tenant.default_terms_text) && { terms: customerTerms(tenant.default_terms_text)! }),
      // T-193: what the room scan measured, the plans and the models (asked for when the customer opens one)
      ...(customerScan && !isQuoteProcessing(quote.status) && { roomScan: customerScan }),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Quote view error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
