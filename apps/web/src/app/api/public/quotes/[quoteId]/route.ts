import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { isQuoteProcessing, resolveRegionContext, isShownEarly, customerEstimateRange, canCustomerDecide } from '@estimator/shared'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { hasCustomBranding } from '@/lib/plan-features'
import type {
  QuoteViewResponse,
  QuoteViewBusiness,
  QuoteViewCustomer,
  QuoteViewAsset,
  QuotePricing,
  QuoteContent,
  CrossServicePricing,
  SignalRecommendation,
} from '@estimator/shared'

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
          template_json,
          branding_json
        ),
        services!service_id (
          id,
          name
        ),
        quote_requests!quote_request_id (
          id,
          asset_ids
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
        }))
      }
    }

    // Build response
    const tenant = quote.tenants as {
      id: string
      name: string
      region?: string | null
      currency?: string | null
      template_json: Record<string, unknown> | null
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
    const pricing = quote.pricing_json as QuotePricing
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

    // White-label: Growth/Pro (custom_branding) drop the Aistimator badge
    const whiteLabel = await hasCustomBranding(supabase, tenant.id)

    const customerView: QuoteViewCustomer = {
      name: customer.name,
      phone: customer.phone ?? null,
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
    if (quote.pdf_asset_id) {
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
    const isProvisional =
      (quote.status === 'awaiting_clarification' || quote.status === 'pending_review') && !shownEarly
    let provisional: QuoteViewResponse['provisional']
    const storedRange = (pricing as { range?: { low?: number; high?: number } }).range
    const measuredLow = storedRange?.low ?? pricing.estimate?.rangeLow
    const measuredHigh = storedRange?.high ?? pricing.estimate?.rangeHigh
    const hasMeasuredRange = measuredLow !== undefined && measuredHigh !== undefined && measuredHigh > measuredLow
    // T-146: while the business reviews, show the instant range only if the
    // engine measured one — never a made-up ±12% around a flat price.
    const showRange = quote.status === 'awaiting_clarification' || hasMeasuredRange
    if (isProvisional && (pricing.total || 0) > 0 && showRange) {
      const total = pricing.total || 0
      // Prefer the engine's measured range; fall back to ±12%, rounded to 10s
      const low = measuredLow ?? Math.floor((total * 0.88) / 10) * 10
      const high = measuredHigh ?? Math.ceil((total * 1.12) / 10) * 10
      provisional = {
        rangeLow: low,
        rangeHigh: high,
        reason: quote.status as 'awaiting_clarification' | 'pending_review',
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
    const response: QuoteViewResponse = {
      quoteId: quote.id,
      status: quote.status,
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
      ...(quote.status === 'awaiting_clarification' &&
        quote.clarification_questions_json && {
          clarificationQuestions: quote.clarification_questions_json,
        }),
      // T-122: takeoff (withheld while provisional — exact amounts) + reference
      ...(!isProvisional && customerTakeoff.length > 0 && { takeoff: customerTakeoff }),
      ...(content.reference && { reference: content.reference }),
      pricing: isProvisional
        ? {
            // Exact figures withheld while provisional — range shown instead
            currency: pricing.currency || regionCtx.currency,
            subtotal: 0,
            taxAmount: 0,
            total: 0,
            breakdown: [],
            notes: pricing.notes || [],
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
      notes: {
        scopeSummary: content.scopeSummary,
        assumptions: content.assumptions,
        exclusions: content.exclusions,
        notes: content.notes,
        validityDays: content.validityDays,
      },
      validUntil,
      assets,
      actions,
      // Include cross-service pricing if available
      ...(content.crossServicePricing && content.crossServicePricing.length > 0 && {
        crossServicePricing: content.crossServicePricing,
      }),
      // Include AI-recommended additional work if available
      ...(content.signalRecommendations && content.signalRecommendations.length > 0 && {
        signalRecommendations: content.signalRecommendations,
      }),
      // Accept quote toggle — defaults to true for backward compatibility.
      // Never accept-able while provisional (price isn't final yet), nor
      // (T-147) while an estimate shown early awaits the business's approval.
      acceptQuoteEnabled: !isProvisional && !shownEarly && tenant.template_json?.acceptQuoteEnabled !== false,
      ...(questionPending && { questionPending: true }),
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
