import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import {
  sendEmail,
  isPostmarkConfigured,
  generateCustomerEmailHtml,
} from '@/lib/postmark'
import type { QuotePricing, TenantBranding } from '@estimator/shared'

/**
 * POST /api/quotes/:quoteId/resend
 * Regenerate token and resend quote email to customer
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

    // Check if email is configured
    if (!isPostmarkConfigured()) {
      return NextResponse.json(
        { error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email service is not configured' } },
        { status: 503 }
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

    // Check if quote can be resent (must be in a valid status)
    const resendableStatuses = ['sent', 'viewed', 'expired']
    if (!resendableStatuses.includes(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot resend quote with status '${quote.status}'` } },
        { status: 400 }
      )
    }

    // Generate new token
    const { token, hash } = generateQuoteToken()
    const tokenExpiry = getTokenExpiry(30) // 30 days

    // Update quote with new token
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        quote_token_hash: hash,
        token_expires_at: tokenExpiry.toISOString(),
        status: 'sent', // Reset to sent status
        sent_at: new Date().toISOString(),
      })
      .eq('id', quoteId)

    if (updateError) {
      console.error('Failed to update quote token:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update quote' } },
        { status: 500 }
      )
    }

    // Extract data for email
    const tenant = quote.tenants as {
      id: string
      name: string
      branding_json: TenantBranding | null
    }
    const service = quote.services as { id: string; name: string }
    const customer = quote.customer_json as { name: string; email: string }
    const pricing = quote.pricing_json as QuotePricing
    const branding = tenant.branding_json || { primaryColor: '#2563eb' }

    // Format total
    const symbols: Record<string, string> = {
      GBP: '£',
      USD: '$',
      EUR: '€',
      AUD: 'A$',
      CAD: 'C$',
      NZD: 'NZ$',
    }
    const symbol = symbols[pricing.currency] || pricing.currency + ' '
    const totalFormatted = `${symbol}${pricing.total.toFixed(2)}`

    // Calculate validity date
    const validUntil = tokenExpiry.toLocaleDateString('en-GB', {
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
