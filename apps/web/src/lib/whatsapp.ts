import crypto from 'crypto'
import { decryptSecret, encryptSecret } from './whatsapp-crypto'
import { graphApiUrl } from './whatsapp-graph'

/**
 * WhatsApp Cloud API client
 */

/** T-176: a send that Meta does not answer is given up on, so nothing that waits for it hangs */
const SEND_TIMEOUT_MS = 15_000

export interface WhatsAppConfig {
  phoneNumberId: string
  accessToken: string
}

export interface SendMessageParams {
  to: string
  text: string
}

export interface SendTemplateParams {
  to: string
  templateName: string
  languageCode: string
  components?: Array<{
    type: 'body' | 'header'
    parameters: Array<{
      type: 'text'
      text: string
    }>
  }>
}

export interface WhatsAppMessageResponse {
  messaging_product: string
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

/**
 * Send a text message via WhatsApp
 */
export async function sendTextMessage(
  config: WhatsAppConfig,
  params: SendMessageParams
): Promise<{ success: boolean; messageId?: string; error?: string; errorCode?: number }> {
  try {
    const response = await fetch(
      `${graphApiUrl()}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to,
          type: 'text',
          text: {
            preview_url: true,
            body: params.text,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number } }
      // Meta's code only: the message can name the number it was sent to
      console.error(`[WhatsApp] send refused: HTTP ${response.status}, code ${error.error?.code ?? 'none'}`)
      return {
        success: false,
        error: error.error?.message || `HTTP ${response.status}`,
        errorCode: error.error?.code,
      }
    }

    const data: WhatsAppMessageResponse = await response.json()
    return {
      success: true,
      messageId: data.messages[0]?.id,
    }
  } catch (error) {
    console.error('[WhatsApp] send failed:', error instanceof Error ? error.name : 'unknown error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Send a template message via WhatsApp
 */
export async function sendTemplateMessage(
  config: WhatsAppConfig,
  params: SendTemplateParams
): Promise<{ success: boolean; messageId?: string; error?: string; errorCode?: number }> {
  try {
    const response = await fetch(
      `${graphApiUrl()}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to,
          type: 'template',
          template: {
            name: params.templateName,
            language: {
              code: params.languageCode,
            },
            components: params.components,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number } }
      // Meta's code only: the message can name the number it was sent to
      console.error(`[WhatsApp] send refused: HTTP ${response.status}, code ${error.error?.code ?? 'none'}`)
      return {
        success: false,
        error: error.error?.message || `HTTP ${response.status}`,
        errorCode: error.error?.code,
      }
    }

    const data: WhatsAppMessageResponse = await response.json()
    return {
      success: true,
      messageId: data.messages[0]?.id,
    }
  } catch (error) {
    console.error('[WhatsApp] send failed:', error instanceof Error ? error.name : 'unknown error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Download media from WhatsApp
 */
export async function downloadMedia(
  accessToken: string,
  mediaId: string
): Promise<{ success: boolean; data?: Buffer; contentType?: string; error?: string }> {
  try {
    // First get the media URL
    const urlResponse = await fetch(`${graphApiUrl()}/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!urlResponse.ok) {
      return { success: false, error: 'Failed to get media URL' }
    }

    const { url } = await urlResponse.json()

    // Then download the media
    const mediaResponse = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!mediaResponse.ok) {
      return { success: false, error: 'Failed to download media' }
    }

    const contentType = mediaResponse.headers.get('content-type') || 'application/octet-stream'
    const arrayBuffer = await mediaResponse.arrayBuffer()
    const data = Buffer.from(arrayBuffer)

    return { success: true, data, contentType }
  } catch (error) {
    console.error('[WhatsApp] media download failed:', error instanceof Error ? error.name : 'unknown error')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Verify a webhook call's signature: Meta signs the raw body with the app's
 * secret (HMAC-SHA256, hex, "sha256=" in front). Compared in constant time.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  if (!appSecret || !signature) return false
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`)
  const given = Buffer.from(signature)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/**
 * Parse incoming webhook payload
 */
export interface IncomingMessage {
  messageId: string
  from: string
  timestamp: string
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'sticker' | 'location' | 'contacts'
  text?: string
  mediaId?: string
  mimeType?: string
  caption?: string
  /** T-177: the name WhatsApp shows for the sender, when Meta sent one */
  profileName?: string
}

export interface WebhookEntry {
  phoneNumberId: string
  displayPhoneNumber: string
  messages: IncomingMessage[]
  statuses: Array<{
    messageId: string
    status: 'sent' | 'delivered' | 'read' | 'failed'
    timestamp: string
    recipientId: string
    /** T-176: Meta's code for why a message was not delivered (a failed status only) */
    errorCode: number | null
  }>
}

export function parseWebhookPayload(body: unknown): WebhookEntry[] {
  const entries: WebhookEntry[] = []

  const payload = body as {
    object?: string
    entry?: Array<{
      id: string
      changes: Array<{
        value: {
          messaging_product: string
          metadata: {
            display_phone_number: string
            phone_number_id: string
          }
          contacts?: Array<{
            profile?: { name?: string }
            wa_id?: string
          }>
          messages?: Array<{
            id: string
            from: string
            timestamp: string
            type: string
            text?: { body: string }
            image?: { id: string; mime_type: string; caption?: string }
            document?: { id: string; mime_type: string; filename?: string; caption?: string }
            audio?: { id: string; mime_type: string }
            video?: { id: string; mime_type: string; caption?: string }
          }>
          statuses?: Array<{
            id: string
            status: string
            timestamp: string
            recipient_id: string
            errors?: Array<{ code?: unknown }>
          }>
        }
        field: string
      }>
    }>
  }

  if (payload.object !== 'whatsapp_business_account') {
    return entries
  }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue

      const value = change.value
      const phoneNumberId = value.metadata.phone_number_id
      const displayPhoneNumber = value.metadata.display_phone_number

      const messages: IncomingMessage[] = []
      for (const msg of value.messages || []) {
        const message: IncomingMessage = {
          messageId: msg.id,
          from: msg.from,
          timestamp: msg.timestamp,
          type: msg.type as IncomingMessage['type'],
        }
        const profile = (value.contacts || []).find((c) => c.wa_id === msg.from)?.profile?.name
        if (typeof profile === 'string' && profile.trim()) message.profileName = profile.trim()

        if (msg.type === 'text' && msg.text) {
          message.text = msg.text.body
        } else if (msg.type === 'image' && msg.image) {
          message.mediaId = msg.image.id
          message.mimeType = msg.image.mime_type
          message.caption = msg.image.caption
        } else if (msg.type === 'document' && msg.document) {
          message.mediaId = msg.document.id
          message.mimeType = msg.document.mime_type
          message.caption = msg.document.caption
        }

        messages.push(message)
      }

      const statuses = (value.statuses || []).map((s) => ({
        messageId: s.id,
        status: s.status as 'sent' | 'delivered' | 'read' | 'failed',
        timestamp: s.timestamp,
        recipientId: s.recipient_id,
        errorCode: typeof s.errors?.[0]?.code === 'number' ? s.errors[0].code : null,
      }))

      entries.push({
        phoneNumberId,
        displayPhoneNumber,
        messages,
        statuses,
      })
    }
  }

  return entries
}

/**
 * Storing a business's access token. T-175: the work is in whatsapp-crypto.ts
 * (no built-in fallback key; authenticated encryption for new values).
 */
export function encryptToken(token: string): string {
  return encryptSecret(token)
}

export function decryptToken(encryptedToken: string): string {
  return decryptSecret(encryptedToken)
}
