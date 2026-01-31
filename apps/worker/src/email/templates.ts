/**
 * Email Templates
 *
 * HTML email templates for quote notifications.
 * Uses inline styles for maximum email client compatibility.
 */

export interface CustomerEmailData {
  customerName: string
  businessName: string
  serviceName: string
  quoteViewUrl: string
  total: string
  currency: string
  validUntil?: string
  scopeSummary?: string
  primaryColor?: string
}

export interface BusinessEmailData {
  businessName: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  serviceName: string
  jobAddress?: string
  quoteId: string
  dashboardUrl: string
  total: string
  currency: string
  primaryColor?: string
}

/**
 * Base email wrapper with consistent styling
 */
function emailWrapper(content: string, _primaryColor: string = '#2563eb'): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              ${content}
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

/**
 * Customer quote notification email
 */
export function customerQuoteEmail(data: CustomerEmailData): string {
  const primaryColor = data.primaryColor || '#2563eb'

  const validitySection = data.validUntil
    ? `<p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">This quote is valid until <strong>${data.validUntil}</strong>.</p>`
    : ''

  const scopeSection = data.scopeSummary
    ? `
      <div style="margin: 24px 0; padding: 16px; background-color: #f9fafb; border-radius: 8px;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #374151; font-size: 14px;">Scope of Work</p>
        <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.5;">${escapeHtml(data.scopeSummary)}</p>
      </div>
    `
    : ''

  const content = `
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
      Thank you for your enquiry. We've prepared a quote for you:
    </p>

    <div style="margin: 24px 0; padding: 24px; background-color: #f0f9ff; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 4px; color: #6b7280; font-size: 14px;">Quoted Total</p>
      <p style="margin: 0; font-size: 36px; font-weight: 700; color: ${primaryColor};">
        ${escapeHtml(data.total)}
      </p>
    </div>

    ${scopeSection}
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
  `

  return emailWrapper(content, primaryColor)
}

/**
 * Business new lead notification email
 */
export function businessNotificationEmail(data: BusinessEmailData): string {
  const primaryColor = data.primaryColor || '#2563eb'

  const phoneSection = data.customerPhone
    ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">Phone: ${escapeHtml(data.customerPhone)}</p>`
    : ''

  const addressSection = data.jobAddress
    ? `
      <div style="margin-top: 16px;">
        <p style="margin: 0; font-weight: 600; color: #374151; font-size: 14px;">Job Location</p>
        <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${escapeHtml(data.jobAddress)}</p>
      </div>
    `
    : ''

  const content = `
    <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 14px; color: #6b7280;">New Quote Generated</p>
      <h1 style="margin: 8px 0 0; font-size: 24px; font-weight: 700; color: #111827;">
        ${escapeHtml(data.customerName)}
      </h1>
    </div>

    <div style="margin-bottom: 24px;">
      <table role="presentation" style="width: 100%;">
        <tr>
          <td style="width: 50%; vertical-align: top;">
            <p style="margin: 0; font-weight: 600; color: #374151; font-size: 14px;">Service</p>
            <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">${escapeHtml(data.serviceName)}</p>
          </td>
          <td style="width: 50%; vertical-align: top; text-align: right;">
            <p style="margin: 0; font-weight: 600; color: #374151; font-size: 14px;">Quote Total</p>
            <p style="margin: 4px 0 0; font-size: 20px; font-weight: 700; color: ${primaryColor};">${escapeHtml(data.total)}</p>
          </td>
        </tr>
      </table>
    </div>

    <div style="margin-bottom: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px;">
      <p style="margin: 0; font-weight: 600; color: #374151; font-size: 14px;">Customer Details</p>
      <p style="margin: 8px 0 0; color: #6b7280; font-size: 14px;">${escapeHtml(data.customerName)}</p>
      <p style="margin: 4px 0 0; color: #6b7280; font-size: 14px;">
        <a href="mailto:${escapeHtml(data.customerEmail)}" style="color: ${primaryColor}; text-decoration: none;">
          ${escapeHtml(data.customerEmail)}
        </a>
      </p>
      ${phoneSection}
      ${addressSection}
    </div>

    <p style="margin: 0 0 8px; color: #6b7280; font-size: 12px;">
      Quote ID: ${escapeHtml(data.quoteId)}
    </p>

    <table role="presentation" style="width: 100%; margin: 24px 0;">
      <tr>
        <td style="text-align: center;">
          <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 14px 28px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 8px;">
            View in Dashboard
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 24px 0 0; color: #6b7280; font-size: 12px; text-align: center;">
      The customer has been sent their quote automatically.
    </p>
  `

  return emailWrapper(content, primaryColor)
}

/**
 * Escape HTML special characters
 */
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
