/**
 * Additional email templates for the quote editing and feedback flow.
 * Supplements the existing templates in postmark.ts.
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

/**
 * Revised quote email — sent to customer after business edits and resends a quote
 */
export function generateRevisedQuoteEmailHtml(data: {
  customerName: string
  businessName: string
  serviceName: string
  quoteViewUrl: string
  total: string
  primaryColor?: string
}): string {
  const primaryColor = data.primaryColor || '#2563eb'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Updated Quote</title>
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
                Updated quote for ${escapeHtml(data.serviceName)}
              </p>

              <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.5;">
                Hi ${escapeHtml(data.customerName)},
              </p>
              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.5;">
                Your quote has been updated. Please review the latest version:
              </p>

              <div style="margin: 24px 0; padding: 24px; background-color: #f0f9ff; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 4px; color: #6b7280; font-size: 14px;">Updated Total</p>
                <p style="margin: 0; font-size: 36px; font-weight: 700; color: ${primaryColor};">
                  ${escapeHtml(data.total)}
                </p>
              </div>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View Updated Quote
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

/**
 * Feedback notification email — sent to business when customer submits feedback
 */
export function generateFeedbackNotificationEmailHtml(data: {
  businessName: string
  customerName: string
  serviceName: string
  feedbackType: 'feedback' | 'approval_request'
  feedbackText?: string
  dashboardUrl: string
  primaryColor?: string
}): string {
  const primaryColor = data.primaryColor || '#2563eb'
  const feedbackLabel = data.feedbackType === 'approval_request'
    ? 'Review Request'
    : 'Feedback'

  const feedbackSection = data.feedbackText
    ? `
              <div style="margin: 24px 0; padding: 16px; background-color: #fefce8; border-left: 4px solid #eab308; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #374151; font-size: 14px;">Customer message:</p>
                <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(data.feedbackText)}</p>
              </div>
    `
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Customer ${feedbackLabel}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #fef3c7; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #92400e;">${feedbackLabel}</span>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #09090b;">
                Customer ${feedbackLabel.toLowerCase()} on quote
              </h1>
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">
                ${escapeHtml(data.customerName)} &middot; ${escapeHtml(data.serviceName)}
              </p>

              ${feedbackSection}

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View in Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #6b7280; font-size: 13px; line-height: 1.5;">
                You can review and respond to this ${feedbackLabel.toLowerCase()} from your dashboard.
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
