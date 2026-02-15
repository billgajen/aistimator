import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
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
          template_json
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
      .eq('quote_token_hash', tokenHash)
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

    // Update viewed_at if not already set
    if (!quote.viewed_at) {
      await supabase
        .from('quotes')
        .update({
          viewed_at: new Date().toISOString(),
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
    const tenant = quote.tenants as { id: string; name: string; template_json: Record<string, unknown> | null }
    const pricing = quote.pricing_json as QuotePricing
    const content = quote.content_json as QuoteContent & {
      validityDays?: number
      crossServicePricing?: CrossServicePricing[]
      signalRecommendations?: SignalRecommendation[]
    }
    const customer = quote.customer_json as { name: string; email: string }

    // Note: logoUrl will be added when branding is implemented (T-008)
    const business: QuoteViewBusiness = {
      name: tenant.name,
    }

    const customerView: QuoteViewCustomer = {
      name: customer.name,
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

    const response: QuoteViewResponse = {
      quoteId: quote.id,
      status: quote.status,
      documentType: quote.document_type,
      version: quote.version ?? 1,
      business,
      customer: customerView,
      pricing: {
        currency: pricing.currency || 'GBP',
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
      },
      breakdown: pricing.breakdown || [],
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
      // Accept quote toggle — defaults to true for backward compatibility
      acceptQuoteEnabled: tenant.template_json?.acceptQuoteEnabled !== false,
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
