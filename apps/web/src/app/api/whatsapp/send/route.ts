import { createClient } from '@/lib/supabase/server'
import { sendTextMessage, decryptToken } from '@/lib/whatsapp'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface SendMessageRequest {
  toPhone: string
  message: string
  conversationId?: string
}

/**
 * POST /api/whatsapp/send
 * Send a WhatsApp message (authenticated, for dashboard use)
 */
export async function POST(request: Request) {
  try {
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

    const tenantId = profile.tenant_id

    // Parse request
    const body: SendMessageRequest = await request.json()

    if (!body.toPhone || !body.message) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'toPhone and message are required' } },
        { status: 400 }
      )
    }

    // Get WhatsApp config for tenant
    const { data: waConfig } = await supabase
      .from('whatsapp_configs')
      .select('phone_number_id, display_phone_number, access_token_encrypted, is_active')
      .eq('tenant_id', tenantId)
      .single()

    if (!waConfig) {
      return NextResponse.json(
        { error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp is not configured for this tenant' } },
        { status: 400 }
      )
    }

    if (!waConfig.is_active) {
      return NextResponse.json(
        { error: { code: 'WHATSAPP_DISABLED', message: 'WhatsApp is disabled for this tenant' } },
        { status: 400 }
      )
    }

    // Decrypt access token
    const accessToken = decryptToken(waConfig.access_token_encrypted)

    // Send the message
    const result = await sendTextMessage(
      {
        phoneNumberId: waConfig.phone_number_id,
        accessToken,
      },
      {
        to: body.toPhone,
        text: body.message,
      }
    )

    if (!result.success) {
      return NextResponse.json(
        { error: { code: 'SEND_FAILED', message: result.error || 'Failed to send message' } },
        { status: 500 }
      )
    }

    // Store outbound message
    let conversationId = body.conversationId

    if (!conversationId) {
      // Find or create conversation
      const { data: existingConversation } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('customer_phone', body.toPhone)
        .eq('status', 'active')
        .single()

      if (existingConversation) {
        conversationId = existingConversation.id
      } else {
        const { data: newConversation } = await supabase
          .from('whatsapp_conversations')
          .insert({
            tenant_id: tenantId,
            customer_phone: body.toPhone,
            status: 'active',
          })
          .select('id')
          .single()

        conversationId = newConversation?.id
      }
    }

    if (conversationId) {
      await supabase.from('whatsapp_messages').insert({
        tenant_id: tenantId,
        conversation_id: conversationId,
        wa_message_id: result.messageId,
        direction: 'outbound',
        message_type: 'text',
        from_phone: waConfig.display_phone_number,
        to_phone: body.toPhone,
        content: body.message,
        status: 'sent',
      })
    }

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
    })
  } catch (error) {
    console.error('WhatsApp send error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
