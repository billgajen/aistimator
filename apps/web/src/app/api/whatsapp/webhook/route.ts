import { createAdminClient } from '@/lib/supabase/server'
import { verifyWebhookSignature, parseWebhookPayload, decryptToken } from '@/lib/whatsapp'
import { processIntakeMessage, sendIntakeResponse } from '@/lib/whatsapp-intake'
import type { WhatsAppConversation, WhatsAppIntakeState, WhatsAppIntakeData } from '@estimator/shared'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN
const APP_SECRET = process.env.WHATSAPP_APP_SECRET

/**
 * GET /api/whatsapp/webhook
 * Webhook verification endpoint for WhatsApp
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Webhook] Verification successful')
    return new Response(challenge, { status: 200 })
  }

  console.warn('[WhatsApp Webhook] Verification failed')
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

/**
 * POST /api/whatsapp/webhook
 * Receive incoming messages from WhatsApp
 */
export async function POST(request: Request) {
  try {
    // Get raw body for signature verification
    const rawBody = await request.text()

    // Verify signature if app secret is configured
    if (APP_SECRET) {
      const signature = request.headers.get('x-hub-signature-256')
      if (!signature || !verifyWebhookSignature(rawBody, signature, APP_SECRET)) {
        console.warn('[WhatsApp Webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    // Parse the payload
    const body = JSON.parse(rawBody)
    const entries = parseWebhookPayload(body)

    if (entries.length === 0) {
      // No relevant data, just acknowledge
      return NextResponse.json({ received: true })
    }

    const supabase = createAdminClient()

    for (const entry of entries) {
      // Find tenant by phone number ID
      const { data: waConfig } = await supabase
        .from('whatsapp_configs')
        .select('tenant_id, access_token_encrypted')
        .eq('phone_number_id', entry.phoneNumberId)
        .eq('is_active', true)
        .single()

      if (!waConfig) {
        console.warn(`[WhatsApp Webhook] No config found for phone number ID: ${entry.phoneNumberId}`)
        continue
      }

      const tenantId = waConfig.tenant_id

      // Get decrypted access token for sending responses
      let accessToken: string
      try {
        accessToken = decryptToken(waConfig.access_token_encrypted)
      } catch (decryptError) {
        console.error('[WhatsApp Webhook] Failed to decrypt access token:', decryptError)
        continue
      }

      const whatsappConfig = {
        phoneNumberId: entry.phoneNumberId,
        accessToken,
      }

      // Process incoming messages
      for (const message of entry.messages) {
        console.log(`[WhatsApp Webhook] Received ${message.type} from ${message.from}`)

        // Find or create conversation
        let conversation: WhatsAppConversation

        const { data: existingConversation } = await supabase
          .from('whatsapp_conversations')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('customer_phone', message.from)
          .eq('status', 'active')
          .single()

        if (existingConversation) {
          conversation = existingConversation as WhatsAppConversation
        } else {
          // Create new conversation
          const { data: newConversation, error: convError } = await supabase
            .from('whatsapp_conversations')
            .insert({
              tenant_id: tenantId,
              customer_phone: message.from,
              status: 'active',
              intake_state: 'idle',
              intake_data: {},
            })
            .select('*')
            .single()

          if (convError || !newConversation) {
            console.error('[WhatsApp Webhook] Failed to create conversation:', convError)
            continue
          }

          conversation = newConversation as WhatsAppConversation
        }

        // Store the message
        const { error: msgError } = await supabase.from('whatsapp_messages').insert({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          wa_message_id: message.messageId,
          direction: 'inbound',
          message_type: message.type === 'text' ? 'text' : message.type === 'image' ? 'image' : 'document',
          from_phone: message.from,
          to_phone: entry.displayPhoneNumber,
          content: message.text || message.caption || null,
          media_url: message.mediaId || null,
          status: 'received',
        })

        if (msgError) {
          console.error('[WhatsApp Webhook] Failed to store message:', msgError)
        }

        // Process through intake flow
        try {
          const intakeResult = await processIntakeMessage({
            supabase,
            waConfig: whatsappConfig,
            tenantId,
            conversation,
            message,
          })

          // Update conversation state if changed
          if (intakeResult.newState || intakeResult.newData) {
            const updates: Partial<WhatsAppConversation> = {}
            if (intakeResult.newState) {
              updates.intake_state = intakeResult.newState as WhatsAppIntakeState
            }
            if (intakeResult.newData) {
              updates.intake_data = {
                ...(conversation.intake_data || {}),
                ...intakeResult.newData,
              } as WhatsAppIntakeData
            }
            if (intakeResult.newData?.customerName) {
              updates.customer_name = intakeResult.newData.customerName
            }

            await supabase
              .from('whatsapp_conversations')
              .update(updates)
              .eq('id', conversation.id)
          }

          // Send response message
          if (intakeResult.responseText) {
            const sent = await sendIntakeResponse(
              whatsappConfig,
              message.from,
              intakeResult.responseText
            )

            // Store outbound message
            if (sent) {
              await supabase.from('whatsapp_messages').insert({
                tenant_id: tenantId,
                conversation_id: conversation.id,
                direction: 'outbound',
                message_type: 'text',
                from_phone: entry.displayPhoneNumber,
                to_phone: message.from,
                content: intakeResult.responseText,
                status: 'sent',
              })
            }
          }
        } catch (intakeError) {
          console.error('[WhatsApp Webhook] Intake processing error:', intakeError)
          // Send error response
          await sendIntakeResponse(
            whatsappConfig,
            message.from,
            "Sorry, something went wrong. Please try again or contact us directly."
          )
        }
      }

      // Process status updates
      for (const status of entry.statuses) {
        // Update message status in database
        await supabase
          .from('whatsapp_messages')
          .update({ status: status.status })
          .eq('wa_message_id', status.messageId)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[WhatsApp Webhook] Error:', error)
    // Always return 200 to avoid retries from WhatsApp
    return NextResponse.json({ received: true })
  }
}
