import { createAdminClient } from '@/lib/supabase/server'
import { parseWebhookPayload, sendTextMessage, verifyWebhookSignature } from '@/lib/whatsapp'
import { decryptSecret } from '@/lib/whatsapp-crypto'
import { whatsappChannel } from '@/lib/whatsapp-intake'
import { ACCOUNT_GONE_EVENTS, parseAccountUpdates, parseOwnerEchoes, signedForConnection } from '@/lib/whatsapp-webhook'
import { removeConnectionsOfAccount } from '@/lib/whatsapp-connect'
import { META_ERROR } from '@/lib/whatsapp-graph'
import { handleCustomerMessage, recordOwnerReply } from '@/lib/whatsapp-assistant'
import { whatsappAccess } from '@/lib/whatsapp-access'
import type { WhatsAppConversation, WhatsAppIntakeState } from '@qolumns/shared'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/whatsapp/webhook
 * Meta's verification handshake: answer the challenge when the verify token
 * matches. With no token set, nothing verifies.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const expected = process.env.WHATSAPP_VERIFY_TOKEN

  if (expected && mode === 'subscribe' && token === expected) {
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

interface StoredConfig {
  tenant_id: string
  access_token_encrypted: string
  app_secret_encrypted: string | null
  connection_method: 'manual' | 'embedded'
  number_kind: 'new_number' | 'business_app' | null
  messages_ready_at: string | null
}

/**
 * POST /api/whatsapp/webhook
 * Every business's incoming WhatsApp messages arrive here (T-175).
 *
 * - The signature is checked on every call. A message is acted on only when
 *   the call was signed by the Meta app its number is connected through (the
 *   platform's app, or for a manual connection the business's own). A call
 *   that proves nothing is answered 401 and nothing is read from it.
 * - A message goes to the business whose stored row has the phone number id
 *   Meta named, and to no other.
 * - Nothing about the customer is logged: no number, no text.
 *
 * T-177:
 * - The assistant is silent unless a customer asks for a price for something
 *   the business offers (`lib/whatsapp-assistant.ts`). A message it does not
 *   answer is kept without its text: only that it arrived, from whom and
 *   when, which the 24-hour rule and Meta's repeats need.
 * - A business whose plan does not include WhatsApp, or whose subscription is
 *   not live, gets no reply sent at all (`lib/whatsapp-access.ts`). Its
 *   connection is kept.
 * - When the business replies to a customer from its own WhatsApp Business
 *   app (Meta's `smb_message_echoes`), the assistant leaves that chat alone
 *   for 24 hours.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 401 })

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const platformSecret = process.env.WHATSAPP_APP_SECRET
  const signedByPlatform = Boolean(platformSecret) && verifyWebhookSignature(rawBody, signature, platformSecret as string)
  const entries = parseWebhookPayload(body)
  const supabase = createAdminClient()
  let acted = signedByPlatform

  try {
    for (const entry of entries) {
      const { data } = await supabase
        .from('whatsapp_configs')
        .select('tenant_id, access_token_encrypted, app_secret_encrypted, connection_method, number_kind, messages_ready_at')
        .eq('phone_number_id', entry.phoneNumberId)
        .eq('is_active', true)
        .maybeSingle()
      const config = data as StoredConfig | null
      if (!config) continue

      let ownAppSecret: string | null = null
      let accessToken: string
      try {
        if (config.app_secret_encrypted) ownAppSecret = decryptSecret(config.app_secret_encrypted)
        accessToken = decryptSecret(config.access_token_encrypted)
      } catch {
        console.error('[WhatsApp Webhook] a stored secret could not be read; the message was not handled')
        continue
      }
      // Signed by the app this number is connected through, or not acted on
      if (!signedForConnection(rawBody, signature, { connection_method: config.connection_method, ownAppSecret }, platformSecret)) continue
      acted = true

      await handleEntry(supabase, config, { phoneNumberId: entry.phoneNumberId, accessToken }, entry)
    }

    // T-177: the business answered a customer from its own app. Signed by the app the number is connected through, like a message.
    for (const echo of parseOwnerEchoes(body)) {
      const { data } = await supabase
        .from('whatsapp_configs')
        .select('tenant_id, app_secret_encrypted, connection_method')
        .eq('phone_number_id', echo.phoneNumberId)
        .eq('is_active', true)
        .maybeSingle()
      const owner = data as Pick<StoredConfig, 'tenant_id' | 'app_secret_encrypted' | 'connection_method'> | null
      if (!owner) continue
      let ownAppSecret: string | null = null
      try {
        if (owner.app_secret_encrypted) ownAppSecret = decryptSecret(owner.app_secret_encrypted)
      } catch {
        continue
      }
      if (!signedForConnection(rawBody, signature, { connection_method: owner.connection_method, ownAppSecret }, platformSecret)) continue
      acted = true
      // a message we sent ourselves is not the owner taking over
      const { data: ours } = await supabase.from('whatsapp_messages').select('id').eq('tenant_id', owner.tenant_id).eq('wa_message_id', echo.messageId).limit(1)
      if (ours && ours.length > 0) continue
      await recordOwnerReply(supabase, owner.tenant_id, echo.to, echo.at ?? new Date())
    }

    // The account left: only the platform's app is told this, so only its signature counts
    if (signedByPlatform) {
      for (const update of parseAccountUpdates(body)) {
        if (!ACCOUNT_GONE_EVENTS.includes(update.event)) continue
        const removed = await removeConnectionsOfAccount(supabase, update.wabaId)
        if (removed > 0) console.log(`[WhatsApp Webhook] ${update.event}: removed ${removed} stored connection(s)`)
      }
    }
  } catch (error) {
    console.error('[WhatsApp Webhook] error:', error instanceof Error ? error.name : 'unknown error')
    // acknowledged all the same, or Meta sends it again for days
    return NextResponse.json({ received: true })
  }

  if (!acted) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  return NextResponse.json({ received: true })
}

type Admin = ReturnType<typeof createAdminClient>
type Entry = ReturnType<typeof parseWebhookPayload>[number]

async function handleEntry(supabase: Admin, config: StoredConfig, whatsappConfig: { phoneNumberId: string; accessToken: string }, entry: Entry) {
  const tenantId = config.tenant_id
  // T-177: may this business's assistant speak at all? Asked once for the call.
  const access = entry.messages.length > 0 ? await whatsappAccess(supabase, tenantId) : { allowed: false as const, why: 'plan' as const }

  for (const message of entry.messages) {
    // Meta sends a message again if we were slow to answer: once is enough
    const { data: seen } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('wa_message_id', message.messageId)
      .limit(1)
    if (seen && seen.length > 0) continue

    let conversation: WhatsAppConversation
    const { data: existing } = await supabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('customer_phone', message.from)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
    if (existing && existing.length > 0) {
      conversation = existing[0] as WhatsAppConversation
    } else {
      const { data: created, error: convError } = await supabase
        .from('whatsapp_conversations')
        .insert({ tenant_id: tenantId, customer_phone: message.from, status: 'active', intake_state: 'idle', intake_data: {} })
        .select('*')
        .single()
      if (convError || !created) {
        console.error('[WhatsApp Webhook] could not start a conversation')
        continue
      }
      conversation = created as WhatsAppConversation
    }

    // Kept first, WITHOUT its text: that it arrived, from whom and when (Meta's repeats and the 24-hour rule need
    // that much). The text is added below only if the message turns out to be part of a price request.
    const { data: kept, error: msgError } = await supabase
      .from('whatsapp_messages')
      .insert({
        tenant_id: tenantId,
        conversation_id: conversation.id,
        wa_message_id: message.messageId,
        direction: 'inbound',
        message_type: message.type === 'text' ? 'text' : message.type === 'image' ? 'image' : 'document',
        from_phone: message.from,
        to_phone: entry.displayPhoneNumber,
        content: null,
        media_url: null,
        status: 'received',
      })
      .select('id')
      .single()
    if (msgError) console.error('[WhatsApp Webhook] could not store a message')

    // The plan does not include WhatsApp, or the subscription is not live: silent, and nothing is asked of the AI
    if (!access.allowed) continue

    const reply = async (text: string) => {
      const sent = await sendTextMessage(whatsappConfig, { to: message.from, text })
      if (sent.success) {
        await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          wa_message_id: sent.messageId ?? null,
          direction: 'outbound',
          message_type: 'text',
          from_phone: entry.displayPhoneNumber,
          to_phone: message.from,
          // the link to an estimate carries its token: it is not kept with the chat
          content: text.replace(/\?token=[A-Za-z0-9_-]+/g, ''),
          status: 'sent',
        })
        // a message went out: nothing is blocking this number
        if (!config.messages_ready_at) {
          config.messages_ready_at = new Date().toISOString()
          await supabase.from('whatsapp_configs').update({ messages_ready_at: config.messages_ready_at }).eq('tenant_id', tenantId).is('messages_ready_at', null)
        }
      } else if (sent.errorCode === META_ERROR.PAYMENT && config.messages_ready_at) {
        // Meta refused for the payment method: the dashboard shows that note again
        config.messages_ready_at = null
        await supabase.from('whatsapp_configs').update({ messages_ready_at: null }).eq('tenant_id', tenantId)
      }
    }

    try {
      const outcome = await handleCustomerMessage({
        admin: supabase,
        tenantId,
        conversation,
        message,
        profileName: message.profileName ?? null,
        channel: whatsappChannel(whatsappConfig),
      })

      if (outcome.keepText && kept?.id) {
        await supabase
          .from('whatsapp_messages')
          .update({ content: message.text || message.caption || null, media_url: message.mediaId || null })
          .eq('id', kept.id)
      }

      if (outcome.newState || outcome.newData || outcome.finished) {
        const updates: Record<string, unknown> = {}
        if (outcome.newState) updates.intake_state = outcome.newState as WhatsAppIntakeState
        // replaced, not merged: a dropped request leaves nothing of the customer's answers behind
        if (outcome.newData) updates.intake_data = outcome.newData
        if (outcome.newData?.customerName) updates.customer_name = outcome.newData.customerName
        // the request is made: this chat is finished, and the next message starts a new one
        if (outcome.finished) updates.status = 'completed'
        await supabase.from('whatsapp_conversations').update(updates).eq('id', conversation.id)
      }

      for (const text of outcome.replies) await reply(text)
    } catch (assistantError) {
      // silent: an error is never a reason to write into someone's chat
      console.error('[WhatsApp Webhook] the assistant failed:', assistantError instanceof Error ? assistantError.name : 'unknown error')
    }
  }

  // Delivery receipts, for this business's own messages only
  for (const status of entry.statuses) {
    // T-176: Meta accepts a message and reports later that it was not delivered. The code only: never the number.
    if (status.status === 'failed') console.error(`[WhatsApp Webhook] Meta did not deliver a message: code ${status.errorCode ?? 'none'}`)
    await supabase.from('whatsapp_messages').update({ status: status.status }).eq('tenant_id', tenantId).eq('wa_message_id', status.messageId)
  }
}
