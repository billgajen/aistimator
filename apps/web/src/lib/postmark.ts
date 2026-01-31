/**
 * Postmark Email Client for Web App
 *
 * Used for resending quote emails from the dashboard.
 */

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email'

interface EmailMessage {
  to: string
  subject: string
  htmlBody: string
  textBody?: string
  tag?: string
  replyTo?: string
}

interface PostmarkResponse {
  success: boolean
  messageId?: string
  error?: string
}

/**
 * Check if Postmark is configured
 */
export function isPostmarkConfigured(): boolean {
  return !!(process.env.POSTMARK_API_TOKEN && process.env.POSTMARK_FROM_EMAIL)
}

/**
 * Send an email via Postmark
 */
export async function sendEmail(message: EmailMessage): Promise<PostmarkResponse> {
  const apiToken = process.env.POSTMARK_API_TOKEN
  const fromEmail = process.env.POSTMARK_FROM_EMAIL

  if (!apiToken || !fromEmail) {
    return {
      success: false,
      error: 'Postmark not configured',
    }
  }

  try {
    const response = await fetch(POSTMARK_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': apiToken,
      },
      body: JSON.stringify({
        From: fromEmail,
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
      const errorData = (await response.json().catch(() => ({}))) as { Message?: string }
      const errorMessage = errorData.Message || `HTTP ${response.status}`
      console.error('[Postmark] API error:', errorMessage)
      return {
        success: false,
        error: errorMessage,
      }
    }

    const data = (await response.json()) as { MessageID?: string }
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

/**
 * Generate customer quote email HTML
 */
export function generateCustomerEmailHtml(data: {
  customerName: string
  businessName: string
  serviceName: string
  quoteViewUrl: string
  total: string
  validUntil?: string
  primaryColor?: string
}): string {
  const primaryColor = data.primaryColor || '#2563eb'

  const validitySection = data.validUntil
    ? `<p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">This quote is valid until <strong>${escapeHtml(data.validUntil)}</strong>.</p>`
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Quote</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: ${primaryColor};">
                ${escapeHtml(data.businessName)}
              </h1>
              <p style="margin: 0 0 32px; color: #6b7280; font-size: 14px;">
                Your quote for ${escapeHtml(data.serviceName)}
              </p>

              <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.5;">
                Hi ${escapeHtml(data.customerName)},
              </p>
              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.5;">
                Here's your quote:
              </p>

              <div style="margin: 24px 0; padding: 24px; background-color: #f0f9ff; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 4px; color: #6b7280; font-size: 14px;">Quoted Total</p>
                <p style="margin: 0; font-size: 36px; font-weight: 700; color: ${primaryColor};">
                  ${escapeHtml(data.total)}
                </p>
              </div>

              ${validitySection}

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View Full Quote
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                If you have any questions, simply reply to this email and we'll get back to you.
              </p>

              <p style="margin: 24px 0 0; color: #374151; font-size: 14px;">
                Best regards,<br>
                <strong>${escapeHtml(data.businessName)}</strong>
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #9ca3af; font-size: 12px;">
              Powered by Estimator
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char)
}
