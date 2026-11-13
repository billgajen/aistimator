import { createClient } from '@/lib/supabase/server'
import { formatMoney, getRegion, statusAfterResend, QUOTE_SEND_AGAIN_STATUSES } from '@estimator/shared'
import { NextResponse } from 'next/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import {
  sendEmail,
  isPostmarkConfigured,
  generateCustomerEmailHtml,
} from '@/lib/postmark'
import { businessReplyTo } from '@/lib/business-email'
import type { QuotePricing, QuoteStatus, TenantBranding } from '@estimator/shared'

/**
 * POST /api/quotes/:quoteId/resend
 * "Send again": email the customer the quote with a fresh link.
 *
 * T-157:
 * - the statuses are the rule the Send again button reads
 *   (QUOTE_SEND_AGAIN_STATUSES): sent, viewed, revised, expired;
 * - every check runs before anything is written, so a refusal changes nothing;
 * - a revised quote stays revised;
 * - the link in the customer's earlier email keeps working (the database
 *   trigger keeps the replaced token in quotes.link_token_hashes).
 */
export async function POST(
  _request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const supabase = await createClient()

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Fetch quote with tenant data
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        tenants!tenant_id (
          id,
          name,
          region,
          branding_json,
          template_json
        ),
        services!service_id (
          id,
          name
        )
      `)
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // Check if quote can be resent (the rule the button reads)
    if (!(QUOTE_SEND_AGAIN_STATUSES as readonly string[]).includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot resend quote with status '${quote.status}'` } },
        { status: 400 }
      )
    }

    // Extract data for email
    const tenant = quote.tenants as {
      id: string
      name: string
      region?: string | null
      branding_json: TenantBranding | null
    }
    const service = quote.services as { id: string; name: string }
    const customer = quote.customer_json as { name: string; email: string }
    // T-151: a phone-only customer can't be emailed. Checked before the token
    // changes, so a refusal leaves the quote exactly as it was.
    if (!customer?.email) {
      return NextResponse.json(
        { error: { code: 'NO_EMAIL', message: 'This customer gave no email address. Copy the link and send it to them another way.' } },
        { status: 400 }
      )
    }

    // Check if email is configured (after the quote's own checks, so the
    // answer is about this quote first; still before anything is written)
    if (!isPostmarkConfigured()) {
      return NextResponse.json(
        { error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email service is not configured' } },
        { status: 503 }
      )
    }

    // Generate new token
    const { token, hash } = generateQuoteToken()
    const tokenExpiry = getTokenExpiry(30) // 30 days

    // Update quote with new token. The status guard makes this safe against
    // a change made since the quote was read.
    const { data: updated, error: updateError } = await supabase
      .from('quotes')
      .update({
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
        status: statusAfterResend(quote.status as QuoteStatus),
        sent_at: new Date().toISOString(),
      })
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .eq('status', quote.status)
      .select('id')

    if (updateError) {
      console.error('Failed to update quote token:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update quote' } },
        { status: 500 }
      )
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: 'This quote changed while sending. Reload and try again.' } },
        { status: 409 }
      )
    }

    const pricing = quote.pricing_json as QuotePricing
    const branding = tenant.branding_json || { primaryColor: '#2563eb' }

    // Format total
    // T-133: tenant locale for the customer email
    const locale = getRegion(tenant.region).locale
    const totalFormatted = formatMoney(pricing.total, pricing.currency, locale)

    // Calculate validity date
    const validUntil = tokenExpiry.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    // Build quote URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const quoteViewUrl = `${appUrl}/q/${quoteId}?token=${token}`

    // Generate email HTML
    const htmlBody = generateCustomerEmailHtml({
      customerName: customer.name,
      businessName: tenant.name,
      serviceName: service.name,
      quoteViewUrl,
      total: totalFormatted,
      validUntil,
      primaryColor: branding.primaryColor,
    })

    // Send email
    const emailResult = await sendEmail({
      to: customer.email,
      subject: `Your quote from ${tenant.name}`,
      htmlBody,
      tag: 'quote-resend',
      // T-157: replies reach the business
      replyTo: await businessReplyTo(profile.tenant_id),
    })

    if (!emailResult.success) {
      console.error('Failed to send email:', emailResult.error)
      return NextResponse.json(
        { error: { code: 'EMAIL_FAILED', message: emailResult.error || 'Failed to send email' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Quote email sent successfully',
      sentTo: customer.email,
      quoteViewUrl,
    })
  } catch (error) {
    console.error('Resend quote error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
