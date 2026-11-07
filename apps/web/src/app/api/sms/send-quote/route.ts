/**
 * POST /api/sms/send-quote — text a quote link to the customer (T-136).
 * Body: { quoteId, phone? } (phone defaults to the customer's phone on the quote).
 *
 * Rotates the quote token (raw tokens are never stored — same trade-off as
 * the resend route) and refuses numbers that replied STOP.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getRegion } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { normalizePhone, sendSmsChecked } from '@/lib/sms'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const SENDABLE = ['sent', 'viewed', 'feedback_received', 'revised', 'expired']

export async function POST(request: NextRequest) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const body = (await request.json().catch(() => ({}))) as { quoteId?: string; phone?: string }
  if (!body.quoteId) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'quoteId is required' } }, { status: 400 })
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, status, customer_json, tenant_id')
    .eq('id', body.quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (!quote) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  if (!SENDABLE.includes(quote.status as string)) {
    return NextResponse.json(
      { error: { code: 'INVALID_STATUS', message: `Cannot text a quote with status '${quote.status}'` } },
      { status: 400 }
    )
  }

  const { data: cfg } = await supabase
    .from('sms_configs')
    .select('phone_number, messaging_service_sid, is_active')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!cfg?.is_active) {
    return NextResponse.json({ error: { code: 'SMS_NOT_CONFIGURED', message: 'Connect an SMS number first' } }, { status: 400 })
  }

  const { data: tenant } = await supabase.from('tenants').select('name, region').eq('id', tenantId).single()
  const tenantRow = tenant as { name?: string; region?: string } | null
  const customer = quote.customer_json as { name?: string; phone?: string } | null
  const rawPhone = body.phone || customer?.phone
  if (!rawPhone) {
    return NextResponse.json({ error: { code: 'NO_PHONE', message: 'No phone number for this customer' } }, { status: 400 })
  }
  const to = normalizePhone(rawPhone, getRegion(tenantRow?.region).callingCode)

  const { token, hash } = generateQuoteToken()
  await supabase
    .from('quotes')
    .update({ quote_token_hash: hash, token_expires_at: getTokenExpiry(30).toISOString(), status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', quote.id)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const link = `${appUrl}/q/${quote.id}?token=${token}`
  const greeting = customer?.name ? `Hi ${customer.name.split(' ')[0]}, ` : ''
  const text = `${greeting}your estimate from ${tenantRow?.name || 'us'} is ready: ${link}\nReply STOP to opt out.`

  // Logging writes through the service role (users may only insert messages, not upsert opt-outs)
  const result = await sendSmsChecked(createAdminClient(), {
    tenantId,
    to,
    from: cfg.phone_number as string,
    body: text,
    messagingServiceSid: cfg.messaging_service_sid as string | null,
  })
  if (!result.success) {
    return NextResponse.json(
      { error: { code: result.blocked ? 'OPTED_OUT' : 'SEND_FAILED', message: result.error || 'Failed to send' } },
      { status: result.blocked ? 409 : 502 }
    )
  }
  return NextResponse.json({ sent: true, to, segments: result.segments, test: Boolean(result.test) })
}
