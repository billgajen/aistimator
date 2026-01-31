/**
 * Postmark Email Client
 *
 * Simple client for sending transactional emails via Postmark API.
 * https://postmarkapp.com/developer/api/email-api
 */

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email'

export interface PostmarkConfig {
  apiToken: string
  fromEmail: string
  fromName?: string
}

export interface EmailMessage {
  to: string
  subject: string
  htmlBody: string
  textBody?: string
  tag?: string
  replyTo?: string
}

export interface PostmarkResponse {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Send an email via Postmark
 */
export async function sendEmail(
  config: PostmarkConfig,
  message: EmailMessage
): Promise<PostmarkResponse> {
  try {
    const response = await fetch(POSTMARK_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': config.apiToken,
      },
      body: JSON.stringify({
        From: config.fromName
          ? `${config.fromName} <${config.fromEmail}>`
          : config.fromEmail,
        To: message.to,
        Subject: message.subject,
        HtmlBody: message.htmlBody,
        TextBody: message.textBody || stripHtml(message.htmlBody),
        Tag: message.tag,
        ReplyTo: message.replyTo,
        MessageStream: 'outbound',
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = (errorData as { Message?: string }).Message || `HTTP ${response.status}`
      console.error('[Postmark] API error:', errorMessage)
      return {
        success: false,
        error: errorMessage,
      }
    }

    const data = await response.json() as { MessageID?: string }
    return {
      success: true,
      messageId: data.MessageID,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Postmark] Request failed:', errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Strip HTML tags to create plain text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
