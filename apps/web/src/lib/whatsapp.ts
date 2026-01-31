import crypto from 'crypto'

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0'

/**
 * WhatsApp Cloud API client
 */

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
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
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
      const error = await response.json()
      console.error('WhatsApp API error:', error)
      return {
        success: false,
        error: error.error?.message || `HTTP ${response.status}`,
      }
    }

    const data: WhatsAppMessageResponse = await response.json()
    return {
      success: true,
      messageId: data.messages[0]?.id,
    }
  } catch (error) {
    console.error('WhatsApp send error:', error)
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
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetch(
      `${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
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
      const error = await response.json()
      console.error('WhatsApp API error:', error)
      return {
        success: false,
        error: error.error?.message || `HTTP ${response.status}`,
      }
    }

    const data: WhatsAppMessageResponse = await response.json()
    return {
      success: true,
      messageId: data.messages[0]?.id,
    }
  } catch (error) {
    console.error('WhatsApp send error:', error)
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
    const urlResponse = await fetch(`${WHATSAPP_API_URL}/${mediaId}`, {
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
    console.error('WhatsApp media download error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Verify webhook signature from WhatsApp
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex')

  return `sha256=${expectedSignature}` === signature
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
            profile: { name: string }
            wa_id: string
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
 * Simple encryption for storing access tokens
 * In production, use a proper secret management service
 */
const ENCRYPTION_KEY = process.env.WHATSAPP_ENCRYPTION_KEY || 'default-key-change-in-production!'

export function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16)
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(token, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

export function decryptToken(encryptedToken: string): string {
  const parts = encryptedToken.split(':')
  const ivHex = parts[0]
  const encrypted = parts[1]

  if (!ivHex || !encrypted) {
    throw new Error('Invalid encrypted token format')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32)
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
