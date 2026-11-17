import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { sendTextMessage, decryptToken } from '@/lib/whatsapp'
import { META_ERROR } from '@/lib/whatsapp-graph'
import { lastInboundAt, windowOpen } from '@/lib/whatsapp-window'
import { accessRefusal, whatsappAccess } from '@/lib/whatsapp-access'

export const dynamic = 'force-dynamic'

interface SendMessageRequest {
  toPhone?: unknown
  message?: unknown
  conversationId?: unknown
}


/**
 * POST /api/whatsapp/send  { toPhone, message, conversationId? }
 * Send a WhatsApp message from the signed-in business's own number (the
 * dashboard's test message). T-175: the stored token is read with the service
 * role for the caller's own tenant; a message that goes out marks the number
 * as working, and Meta's two usual refusals are said in plain words.
 *
 * T-176: Meta accepts a message to a phone that has not written to the
 * business in the last 24 hours, and then does not deliver it. The answer
 * says whether we hold such a message (`windowOpen`), so the page does not
 * say "sent" about a message that will not arrive.
 */
export async function POST(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const tenantId = auth.tenantId
  try {
    const body = (await request.json().catch(() => null)) as SendMessageRequest | null
    const toPhone = typeof body?.toPhone === 'string' ? body.toPhone.replace(/[^\d]/g, '') : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (toPhone.length < 7 || toPhone.length > 15 || !message || message.length > 4096) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Enter a phone number with its country code, and a message.' } },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    // T-177: a paused assistant sends nothing, a test message included
    const refusal = accessRefusal(await whatsappAccess(admin, tenantId))
    if (refusal) return NextResponse.json({ error: { code: refusal.code, message: refusal.message } }, { status: refusal.status })
    const { data: waConfig } = await admin
      .from('whatsapp_configs')
      .select('phone_number_id, display_phone_number, access_token_encrypted, is_active')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!waConfig) {
      return NextResponse.json({ error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not connected.' } }, { status: 400 })
    }
    if (!waConfig.is_active) {
      return NextResponse.json({ error: { code: 'WHATSAPP_DISABLED', message: 'WhatsApp is switched off for this business.' } }, { status: 400 })
    }

    const inWindow = windowOpen(await lastInboundAt(admin, tenantId, toPhone), new Date())

    const result = await sendTextMessage(
      { phoneNumberId: waConfig.phone_number_id as string, accessToken: decryptToken(waConfig.access_token_encrypted as string) },
      { to: toPhone, text: message }
    )

    if (!result.success) {
      if (result.errorCode === META_ERROR.PAYMENT) {
        await admin.from('whatsapp_configs').update({ messages_ready_at: null }).eq('tenant_id', tenantId)
        return NextResponse.json(
          { error: { code: 'PAYMENT_NEEDED', message: 'Meta did not send it: the WhatsApp account needs a payment method. Add one in WhatsApp Manager, then try again.' } },
          { status: 402 }
        )
      }
      if (result.errorCode === META_ERROR.OUTSIDE_WINDOW) {
        return NextResponse.json(
          { error: { code: 'OUTSIDE_WINDOW', message: 'WhatsApp only lets a business message someone who has messaged it in the last 24 hours. Send any message from that phone to your number first, then try again.' } },
          { status: 422 }
        )
      }
      if (result.errorCode === META_ERROR.NAME_NOT_APPROVED) {
        return NextResponse.json(
          { error: { code: 'NAME_IN_REVIEW', message: 'Meta has not approved the name on this number yet, and does not let it send until it has. Nothing is broken: try again once the name is approved.' } },
          { status: 422 }
        )
      }
      if (result.errorCode === META_ERROR.TOKEN) {
        return NextResponse.json({ error: { code: 'RECONNECT', message: 'The connection has expired or was removed. Reconnect WhatsApp, then try again.' } }, { status: 422 })
      }
      return NextResponse.json({ error: { code: 'SEND_FAILED', message: 'Meta did not send the message. Check the number and try again.' } }, { status: 502 })
    }

    // a message went out: nothing is blocking this number
    await admin.from('whatsapp_configs').update({ messages_ready_at: new Date().toISOString() }).eq('tenant_id', tenantId).is('messages_ready_at', null)

    // Keep the message with its conversation (the business's own, by row-level security)
    let conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined
    if (!conversationId) {
      const { data: existing } = await auth.supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('customer_phone', toPhone)
        .eq('status', 'active')
        .limit(1)
      conversationId = (existing?.[0]?.id as string | undefined) ?? undefined
      if (!conversationId) {
        const { data: created } = await auth.supabase
          .from('whatsapp_conversations')
          .insert({ tenant_id: tenantId, customer_phone: toPhone, status: 'active' })
          .select('id')
          .single()
        conversationId = created?.id as string | undefined
      }
    }
    if (conversationId) {
      await auth.supabase.from('whatsapp_messages').insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        wa_message_id: result.messageId,
        direction: 'outbound',
        message_type: 'text',
        from_phone: waConfig.display_phone_number,
        to_phone: toPhone,
        content: message,
        status: 'sent',
      })
    }

    return NextResponse.json({ ok: true, messageId: result.messageId, windowOpen: inWindow })
  } catch (error) {
    console.error('[WhatsApp send] failed:', error instanceof Error ? error.name : 'unknown error')
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Could not send the message.' } }, { status: 500 })
  }
}

/**
 * GET /api/whatsapp/send?messageId=…
 * T-176: what became of a message this business sent: 'sent' (Meta accepted
 * it), 'delivered', 'read' or 'failed', as Meta's status webhook reported it.
 * The business's own messages only (row-level security).
 */
export async function GET(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const messageId = new URL(request.url).searchParams.get('messageId') ?? ''
  if (!messageId || messageId.length > 300) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Name the message.' } }, { status: 400 })
  }
  const { data } = await auth.supabase
    .from('whatsapp_messages')
    .select('status')
    .eq('tenant_id', auth.tenantId)
    .eq('direction', 'outbound')
    .eq('wa_message_id', messageId)
    .limit(1)
  const status = (data?.[0] as { status?: string } | undefined)?.status
  if (!status) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No such message.' } }, { status: 404 })
  return NextResponse.json({ status })
}
