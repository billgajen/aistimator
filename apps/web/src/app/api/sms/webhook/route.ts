/**
 * POST /api/sms/webhook — Twilio inbound SMS/MMS (T-136).
 *
 * Fails closed: requests without a valid X-Twilio-Signature are rejected (401),
 * and if TWILIO_AUTH_TOKEN is not configured nothing is accepted (503).
 * Compliance keywords (STOP/START/HELP) are handled before the intake engine
 * and opt-outs are enforced on every reply by `sendSmsChecked`.
 */

import { createAdminClient } from '@/lib/supabase/server'
import {
  verifyTwilioSignature,
  classifyComplianceKeyword,
  isOptedOut,
  setOptOut,
  helpMessage,
  stopConfirmation,
  startConfirmation,
  sendSms,
  CONSENT_NOTICE,
} from '@/lib/sms'
import { smsChannel } from '@/lib/sms-intake'
import { runIntake } from '@/lib/messaging/intake-engine'
import type { InboundMessage, IntakeConversation } from '@/lib/messaging/types'
import type { WhatsAppIntakeData, WhatsAppIntakeState } from '@estimator/shared'

export const dynamic = 'force-dynamic'

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
const twiml = (status = 200) =>
  new Response(EMPTY_TWIML, { status, headers: { 'Content-Type': 'text/xml' } })

/** The URL Twilio signed: explicit env wins (proxies/tunnels), else the app URL */
function signedUrl(request: Request): string {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  const path = new URL(request.url).pathname + new URL(request.url).search
  return base ? `${base.replace(/\/$/, '')}${path}` : request.url
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[SMS Webhook] TWILIO_AUTH_TOKEN not configured — rejecting')
    return new Response('SMS not configured', { status: 503 })
  }

  const raw = await request.text()
  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v

  if (!verifyTwilioSignature(signedUrl(request), params, request.headers.get('x-twilio-signature'), authToken)) {
    console.warn('[SMS Webhook] Invalid or missing signature')
    return new Response('Invalid signature', { status: 401 })
  }

  const to = params.To || ''
  const from = params.From || ''
  if (!to || !from) return twiml()

  const supabase = createAdminClient()
  const { data: cfg } = await supabase
    .from('sms_configs')
    .select('tenant_id, phone_number, messaging_service_sid')
    .eq('phone_number', to)
    .eq('is_active', true)
    .maybeSingle()
  if (!cfg) {
    console.warn('[SMS Webhook] No active SMS config for the receiving number')
    return twiml()
  }
  const tenantId = cfg.tenant_id as string
  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single()
  const businessName = (tenant as { name?: string } | null)?.name || 'This business'

  // ── Compliance keywords first (before any intake logic) ──
  const optedOut = await isOptedOut(supabase, tenantId, from)
  const keyword = classifyComplianceKeyword(params.Body, optedOut)
  // Compliance replies bypass the opt-out gate (a STOP confirmation must reach
  // the number that just opted out) but are logged like every other send
  const reply = async (body: string) => {
    const r = await sendSms({ to: from, from: cfg.phone_number as string, body, messagingServiceSid: cfg.messaging_service_sid as string | null })
    await supabase.from('sms_messages').insert({
      tenant_id: tenantId,
      provider_message_id: r.messageId ?? null,
      direction: 'outbound',
      message_type: 'text',
      from_phone: cfg.phone_number,
      to_phone: from,
      content: body,
      segments: r.success ? r.segments ?? 0 : 0,
      status: r.success ? (r.test ? 'test' : 'sent') : 'failed',
    })
    return r
  }
  if (keyword === 'stop') {
    await setOptOut(supabase, tenantId, from, true, (params.Body || '').trim().toUpperCase())
    await reply(stopConfirmation(businessName)) // the one permitted confirmation
    return twiml()
  }
  if (keyword === 'start') {
    await setOptOut(supabase, tenantId, from, false, (params.Body || '').trim().toUpperCase())
    await reply(startConfirmation(businessName))
    return twiml()
  }
  if (optedOut) return twiml() // opted out: no processing, no replies
  if (keyword === 'help') {
    await reply(helpMessage(businessName))
    return twiml()
  }

  // ── Conversation ──
  let { data: conv } = await supabase
    .from('sms_conversations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_phone', from)
    .eq('status', 'active')
    .maybeSingle()
  if (!conv) {
    const created = await supabase
      .from('sms_conversations')
      .insert({ tenant_id: tenantId, customer_phone: from, status: 'active', intake_state: 'idle', intake_data: {} })
      .select('*')
      .single()
    conv = created.data
  }
  if (!conv) return twiml()
  let conversation = conv as IntakeConversation & { consent_notice_sent?: boolean }

  // MMS: each media item becomes an image message, then the text body (if any)
  const messages: InboundMessage[] = []
  const numMedia = Number(params.NumMedia || 0)
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`]
    if (!url) continue
    const mime = params[`MediaContentType${i}`] || 'image/jpeg'
    messages.push({
      messageId: `${params.MessageSid || 'mms'}_${i}`,
      from,
      type: mime.startsWith('image/') ? 'image' : 'document',
      mediaId: url,
      mimeType: mime,
    })
  }
  if ((params.Body || '').trim()) {
    messages.push({ messageId: params.MessageSid || `sms_${Date.now()}`, from, type: 'text', text: params.Body })
  }

  await supabase.from('sms_messages').insert({
    tenant_id: tenantId,
    conversation_id: conversation.id,
    provider_message_id: params.MessageSid || null,
    direction: 'inbound',
    message_type: numMedia > 0 ? 'image' : 'text',
    from_phone: from,
    to_phone: to,
    content: params.Body || null,
    media_url: numMedia > 0 ? params.MediaUrl0 || null : null,
    status: 'received',
  })

  const channel = smsChannel(
    supabase,
    { tenantId, phoneNumber: cfg.phone_number as string, messagingServiceSid: cfg.messaging_service_sid as string | null },
    conversation.id
  )

  // Run each message through the engine; send ONE reply (the last) to save segments
  let lastReply: string | undefined
  for (const message of messages) {
    try {
      const result = await runIntake({ supabase, channel, tenantId, conversation, message })
      if (result.newState || result.newData) {
        const updates: Record<string, unknown> = {}
        if (result.newState) updates.intake_state = result.newState as WhatsAppIntakeState
        if (result.newData) {
          updates.intake_data = { ...(conversation.intake_data || {}), ...result.newData } as WhatsAppIntakeData
        }
        if (result.newData?.customerName) updates.customer_name = result.newData.customerName
        await supabase.from('sms_conversations').update(updates).eq('id', conversation.id)
        conversation = { ...conversation, ...updates } as typeof conversation
      }
      if (result.responseText) lastReply = result.responseText
    } catch (error) {
      console.error('[SMS Webhook] Intake error:', error)
      lastReply = 'Sorry, something went wrong. Please try again or contact us directly.'
    }
  }

  if (lastReply) {
    // Consent line on the first reply of every conversation (TCPA/CTIA practice)
    const withConsent = conversation.consent_notice_sent ? lastReply : `${lastReply}\n\n${CONSENT_NOTICE}`
    const sent = await channel.send(from, withConsent)
    if (sent.success && !conversation.consent_notice_sent) {
      await supabase.from('sms_conversations').update({ consent_notice_sent: true }).eq('id', conversation.id)
    }
  }

  return twiml()
}
