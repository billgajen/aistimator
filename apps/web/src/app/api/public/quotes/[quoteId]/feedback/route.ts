import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { NextResponse } from 'next/server'
import { isShownEarly } from '@estimator/shared'
import { createHash } from 'crypto'
import {
  sendEmail,
  isPostmarkConfigured,
} from '@/lib/postmark'
import { generateFeedbackNotificationEmailHtml } from '@/lib/email-templates'
import { resolveBusinessEmail } from '@/lib/business-email'
import type { SubmitFeedbackRequest, SubmitFeedbackResponse } from '@estimator/shared'
import type { TenantBranding } from '@estimator/shared'

/**
 * POST /api/public/quotes/:quoteId/feedback
 * Customer submits feedback or review request on a quote.
 */
export async function POST(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const body = (await request.json()) as SubmitFeedbackRequest

    if (!body.token) {
      return NextResponse.json(
        { error: { code: 'MISSING_TOKEN', message: 'Token is required' } },
        { status: 401 }
      )
    }

    if (!body.feedbackType || !['feedback', 'approval_request'].includes(body.feedbackType)) {
      return NextResponse.json(
        { error: { code: 'INVALID_TYPE', message: 'feedbackType must be "feedback" or "approval_request"' } },
        { status: 400 }
      )
    }

    if (body.feedbackType === 'feedback' && !body.feedbackText?.trim()) {
      return NextResponse.json(
        { error: { code: 'MISSING_TEXT', message: 'feedbackText is required for feedback type' } },
        { status: 400 }
      )
    }

    // Hash the token to compare with stored hash
    const tokenHash = createHash('sha256').update(body.token).digest('hex')
    const supabase = createAdminClient()

    // Fetch quote with token validation
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        id, status, tenant_id, quote_token_hash, token_expires_at, is_demo,
        customer_json, service_id, review_hold, pricing_json, content_json,
        tenants!tenant_id (
          id, name, branding_json
        ),
        services!service_id (
          id, name
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

    // Check quote is in a valid state for feedback
    // T-147: a customer looking at an estimate shown before approval can ask a
    // question (not request a review: the business is already reviewing).
    const shownEarly = isShownEarly({
      status: quote.status,
      review_hold: quote.review_hold as string | null,
      total: (quote.pricing_json as { total?: number } | null)?.total,
      limitHold: (quote.content_json as { limitHold?: boolean } | null)?.limitHold,
    })
    const validStatuses = ['sent', 'viewed', 'revised']
    if (!validStatuses.includes(quote.status) && !(shownEarly && body.feedbackType === 'feedback')) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Cannot submit feedback for quote with status: ${quote.status}` } },
        { status: 400 }
      )
    }

    // Insert feedback
    const { error: insertError } = await supabase
      .from('quote_feedback')
      .insert({
        quote_id: quoteId,
        tenant_id: quote.tenant_id,
        feedback_type: body.feedbackType,
        feedback_text: body.feedbackText?.trim() || null,
        status: 'pending',
      })

    if (insertError) {
      console.error('Failed to insert feedback:', insertError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to submit feedback' } },
        { status: 500 }
      )
    }

    // Update quote status to feedback_received. T-147: not while the estimate
    // awaits approval — it must stay pending_review so the business can still
    // approve it and Accept stays locked.
    if (!shownEarly) {
      await supabase
        .from('quotes')
        .update({ status: 'feedback_received' })
        .eq('id', quoteId)
    }

    // Send notification email to business owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantRaw = quote.tenants as any
    const tenant = (Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw) as {
      id: string; name: string; branding_json: TenantBranding | null
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serviceRaw = quote.services as any
    const service = (Array.isArray(serviceRaw) ? serviceRaw[0] : serviceRaw) as { id: string; name: string }
    const customer = quote.customer_json as { name: string; email: string }

    // T-153: a demo quote emails no one. T-157: the one business email rule
    // (the Settings address, else the first user's account email). A failed
    // lookup never fails the customer's message, which is already saved.
    let businessEmail: string | null = null
    try {
      businessEmail =
        isPostmarkConfigured() && !(quote as { is_demo?: boolean }).is_demo
          ? await resolveBusinessEmail(supabase, quote.tenant_id)
          : null
    } catch (lookupError) {
      console.error('[Feedback] business email lookup failed:', lookupError instanceof Error ? lookupError.message : 'unknown error')
    }
    if (businessEmail) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const dashboardUrl = `${appUrl}/app/quotes/${quoteId}`
      const branding = tenant.branding_json || { primaryColor: '#2563eb' }

      const htmlBody = generateFeedbackNotificationEmailHtml({
        businessName: tenant.name,
        customerName: customer.name,
        serviceName: service.name,
        feedbackType: body.feedbackType,
        feedbackText: body.feedbackText?.trim(),
        dashboardUrl,
        primaryColor: branding.primaryColor,
      })

      const emailResult = await sendEmail({
        from: { kind: 'business' },
        to: businessEmail,
        subject: `Customer ${body.feedbackType === 'approval_request' ? 'review request' : 'feedback'} on quote: ${customer.name}`,
        htmlBody,
        tag: 'quote-feedback',
      })

      if (!emailResult.success) {
        console.error('Failed to send feedback notification email:', emailResult.error)
      }
    }

    const response: SubmitFeedbackResponse = {
      success: true,
      message: body.feedbackType === 'approval_request'
        ? 'Your review request has been sent.'
        : 'Your feedback has been submitted.',
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Feedback submission error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
