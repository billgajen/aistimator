import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { sendEmail, isPostmarkConfigured } from '@/lib/postmark'
import { generateQuoteDeclinedEmailHtml } from '@/lib/email-templates'
import type { DeclineQuoteResponse, TenantBranding } from '@estimator/shared'

const MAX_REASON_LENGTH = 500

/**
 * POST /api/public/quotes/:quoteId/decline
 * Decline a quote. Requires valid token in body; reason is optional.
 * Mirrors the accept route's validation, then notifies the business.
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

    const reason =
      typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : null

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const supabase = createAdminClient()

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id, status, quote_token_hash, token_expires_at, accepted_at, declined_at,
        customer_json,
        tenants!tenant_id ( id, name, notification_email, branding_json ),
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

    if (quote.token_expires_at && new Date(quote.token_expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'TOKEN_EXPIRED', message: 'Quote link has expired' } },
        { status: 410 }
      )
    }

    if (quote.declined_at) {
      return NextResponse.json(
        { error: { code: 'ALREADY_DECLINED', message: 'Quote has already been declined' } },
        { status: 409 }
      )
    }

    if (quote.accepted_at) {
      return NextResponse.json(
        { error: { code: 'ALREADY_ACCEPTED', message: 'Quote has already been accepted' } },
        { status: 409 }
      )
    }

    const validStatuses = ['sent', 'viewed', 'revised', 'feedback_received']
    if (!validStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot decline quote with status: ${quote.status}` } },
        { status: 400 }
      )
    }

    const declinedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'declined',
        declined_at: declinedAt,
        decline_reason: reason,
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Failed to decline quote:', updateError)
      return NextResponse.json(
        { error: { code: 'UPDATE_FAILED', message: 'Failed to decline quote' } },
        { status: 500 }
      )
    }

    // Notify the business — never fail the decline if email fails
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenantRaw = quote.tenants as any
      const tenant = (Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw) as {
        id: string; name: string; notification_email: string | null; branding_json: TenantBranding | null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serviceRaw = quote.services as any
      const service = (Array.isArray(serviceRaw) ? serviceRaw[0] : serviceRaw) as { id: string; name: string }
      const customer = quote.customer_json as { name: string; email: string }

      if (tenant?.notification_email && isPostmarkConfigured()) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const htmlBody = generateQuoteDeclinedEmailHtml({
          businessName: tenant.name,
          customerName: customer?.name || 'A customer',
          serviceName: service?.name || 'your service',
          reason: reason || undefined,
          dashboardUrl: `${appUrl}/app/quotes/${quoteId}`,
          primaryColor: tenant.branding_json?.primaryColor,
        })
        await sendEmail({
          to: tenant.notification_email,
          subject: `Quote declined: ${customer?.name || 'Customer'} - ${service?.name || ''}`,
          htmlBody,
        })
      }
    } catch (emailError) {
      console.error('[Decline] Failed to send business notification:', emailError)
    }

    const response: DeclineQuoteResponse = {
      status: 'declined',
      declinedAt,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Decline quote error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
