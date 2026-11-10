import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { formatMoney, resolveRegionContext } from '@estimator/shared'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { sendEmail, isPostmarkConfigured } from '@/lib/postmark'
import { generateQuoteAcceptedEmailHtml } from '@/lib/email-templates'
import { checkAcceptance, timingLabel, type AcceptanceDetails } from '@/lib/acceptance'
import type { AcceptQuoteResponse, QuotePricing, TenantBranding } from '@estimator/shared'

/**
 * POST /api/public/quotes/:quoteId/accept
 * Accept a quote. Requires valid token in body.
 */
export async function POST(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const body = await request.json()
    const token = body.token

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
        id, status, quote_token_hash, token_expires_at, accepted_at,
        customer_json, pricing_json,
        tenants!tenant_id ( id, name, region, currency, notification_email, branding_json ),
        services!service_id ( id, name )
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

    // Check if already accepted
    if (quote.accepted_at) {
      return NextResponse.json(
        { error: { code: 'ALREADY_ACCEPTED', message: 'Quote has already been accepted' } },
        { status: 409 }
      )
    }

    // Check if quote is in a valid state to accept
    const validStatuses = ['sent', 'viewed', 'revised', 'feedback_received']
    if (!validStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot accept quote with status: ${quote.status}` } },
        { status: 400 }
      )
    }

    // T-151: the next step — when suits them, the job address and a phone
    // number. The quote page always sends these; a page opened before this
    // change accepts without them, as before.
    let acceptance: AcceptanceDetails | null = null
    if (body.details !== undefined) {
      const check = checkAcceptance(body.details ?? {})
      if (!check.ok) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: Object.values(check.errors)[0] ?? 'Check your details', fields: check.errors } },
          { status: 400 }
        )
      }
      acceptance = check.value
    }

    // Update quote status to accepted
    const acceptedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'accepted',
        accepted_at: acceptedAt,
        ...(acceptance && { acceptance_json: acceptance }),
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Failed to accept quote:', updateError)
      return NextResponse.json(
        { error: { code: 'UPDATE_FAILED', message: 'Failed to accept quote' } },
        { status: 500 }
      )
    }

    // Notify the business — never fail the acceptance if email fails
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenantRaw = quote.tenants as any
      const tenant = (Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw) as {
        id: string; name: string; region?: string | null; currency?: string | null; notification_email: string | null; branding_json: TenantBranding | null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceRaw = quote.services as any
      const service = (Array.isArray(serviceRaw) ? serviceRaw[0] : serviceRaw) as { id: string; name: string }
      const customer = quote.customer_json as { name: string; email: string }
      const pricing = quote.pricing_json as QuotePricing | null

      if (tenant?.notification_email && isPostmarkConfigured()) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const totalFormatted = pricing
          ? (() => {
              // T-133: tenant region decides locale + currency fallback
              const regionCtx = resolveRegionContext(tenant ?? {})
              return formatMoney(pricing.total, pricing.currency || regionCtx.currency, regionCtx.locale)
            })()
          : ''
        const htmlBody = generateQuoteAcceptedEmailHtml({
          businessName: tenant.name,
          customerName: customer?.name || 'A customer',
          serviceName: service?.name || 'your service',
          totalFormatted,
          dashboardUrl: `${appUrl}/app/quotes/${quoteId}`,
          primaryColor: tenant.branding_json?.primaryColor,
          ...(acceptance && {
            nextStep: {
              timing: timingLabel(acceptance.timing),
              timingNote: acceptance.timingNote,
              address: acceptance.address,
              phone: acceptance.phone,
            },
          }),
        })
        await sendEmail({
          to: tenant.notification_email,
          subject: `Quote accepted: ${customer?.name || 'Customer'} - ${service?.name || ''}`,
          htmlBody,
        })
      }
    } catch (emailError) {
      console.error('[Accept] Failed to send business notification:', emailError)
    }

    const response: AcceptQuoteResponse = {
      status: 'accepted',
      acceptedAt,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Accept quote error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
