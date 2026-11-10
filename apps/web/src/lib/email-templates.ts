/**
 * Additional email templates for the quote editing and feedback flow.
 * Supplements the existing templates in postmark.ts.
 */
import { PRODUCT_NAME } from '@estimator/shared'

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
              Powered by ${PRODUCT_NAME}
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
              Powered by ${PRODUCT_NAME}
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
 * Plan limit reached email — sent to business once per period when their
 * monthly estimate limit is hit (T-101). New quote requests are blocked
 * until they upgrade or the period resets.
 */
export function generateLimitReachedEmailHtml(data: {
  businessName: string
  used: number
  limit: number
  billingUrl: string
  /** T-102: when set, quoting continues as metered overage at this price */
  overagePriceLabel?: string
  /** T-152: 'total' = the free allowance (never resets); default 'month' */
  per?: 'month' | 'total'
}): string {
  const consequence = data.overagePriceLabel
    ? `<strong>Quoting continues uninterrupted</strong> — extra quotes are now billed at
       <strong>${escapeHtml(data.overagePriceLabel)} each</strong> on your next invoice. Upgrade
       to a bigger plan if you expect this regularly; it usually works out cheaper.`
    : `<strong>New requests are still saved as leads</strong> in your dashboard, but they are not priced
       automatically — customers are told you'll send their estimate shortly. Upgrade your plan to price
       them instantly (held leads can be priced with one click after upgrading)${
         data.per === 'total' ? '.' : ', or wait until your limit resets at the start of next month.'
       }`
  return generateLimitReachedEmailBody(data, consequence)
}

/** T-134: one held lead (over the plan limit) — never lose a customer's submission */
export function generateLeadHeldEmailHtml(data: {
  businessName: string
  customerName: string
  serviceName: string
  used: number
  limit: number
  billingUrl: string
  quoteUrl: string
  /** T-152: 'total' = the free allowance (never resets); default 'month' */
  per?: 'month' | 'total'
}): string {
  const consequence = `<strong>${escapeHtml(data.customerName)}</strong> asked for an estimate for
     <strong>${escapeHtml(data.serviceName)}</strong>. It is saved as a lead but was not priced because
     ${data.per === 'total' ? 'your free quotes are used up' : "your plan's monthly limit is reached"}. Upgrade to price it instantly, or reply to the customer
     yourself: <a href="${escapeHtml(data.quoteUrl)}">open the lead</a>.`
  return generateLimitReachedEmailBody(data, consequence)
}

function generateLimitReachedEmailBody(
  data: { businessName: string; used: number; limit: number; billingUrl: string; per?: 'month' | 'total' },
  consequenceHtml: string
): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.per === 'total' ? 'Free quotes used' : 'Monthly Quote Limit Reached'}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #dc2626;">
                ${data.per === 'total' ? 'Your free quotes are used' : 'Monthly quote limit reached'}
              </h1>
              <p style="margin: 0 0 32px; color: #6b7280; font-size: 14px;">
                ${escapeHtml(data.businessName)}
              </p>

              <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.5;">
                ${
                  data.per === 'total'
                    ? `You've used <strong>${data.used} of ${data.limit}</strong> free quotes. Pick a plan to keep pricing every request instantly.`
                    : `You've used <strong>${data.used} of ${data.limit}</strong> quotes on your current plan this month.`
                }
              </p>
              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.5;">
                ${consequenceHtml}
              </p>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.billingUrl)}" style="display: inline-block; padding: 16px 32px; background-color: #09090b; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      Upgrade Your Plan
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                Every missed instant quote is a lead your competitors can answer first.
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #9ca3af; font-size: 12px;">
              Powered by ${PRODUCT_NAME}
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
 * Quote accepted notification — sent to the business when a customer
 * accepts a quote on the hosted quote page.
 */
export function generateQuoteAcceptedEmailHtml(data: {
  businessName: string
  customerName: string
  serviceName: string
  totalFormatted: string
  dashboardUrl: string
  primaryColor?: string
  /** T-151: what the customer told you when accepting */
  nextStep?: { timing: string; timingNote?: string | null; address: string; phone: string }
}): string {
  const primaryColor = data.primaryColor || '#205E56'
  const row = (label: string, value: string) =>
    `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 14px; width: 120px; vertical-align: top;">${escapeHtml(label)}</td><td style="padding: 6px 0; color: #111827; font-size: 14px;">${escapeHtml(value)}</td></tr>`
  const nextStepSection = data.nextStep
    ? `<table role="presentation" style="width: 100%; margin: 0 0 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px;">
        ${row('When suits them', data.nextStep.timing)}
        ${data.nextStep.timingNote ? row('Their note', data.nextStep.timingNote) : ''}
        ${row('Job address', data.nextStep.address)}
        ${row('Phone', data.nextStep.phone)}
      </table>`
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote Accepted</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #dcfce7; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #166534;">Accepted</span>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #09090b;">
                ${escapeHtml(data.customerName)} accepted your quote
              </h1>
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">
                ${escapeHtml(data.serviceName)} &middot; ${escapeHtml(data.totalFormatted)}
              </p>

              ${nextStepSection}
              <p style="margin: 0 0 24px; color: #374151; font-size: 14px; line-height: 1.6;">
                The customer is expecting to hear from you — reaching out quickly keeps the momentum going.
              </p>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View in Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #9ca3af; font-size: 12px;">
              Powered by ${PRODUCT_NAME}
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
 * Quote declined notification — sent to the business when a customer
 * declines a quote on the hosted quote page.
 */
export function generateQuoteDeclinedEmailHtml(data: {
  businessName: string
  customerName: string
  serviceName: string
  reason?: string
  dashboardUrl: string
  primaryColor?: string
}): string {
  const primaryColor = data.primaryColor || '#205E56'

  const reasonSection = data.reason
    ? `
              <div style="margin: 24px 0; padding: 16px; background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #374151; font-size: 14px;">Customer's reason:</p>
                <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(data.reason)}</p>
              </div>
    `
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote Declined</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #fee2e2; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #991b1b;">Declined</span>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #09090b;">
                ${escapeHtml(data.customerName)} declined your quote
              </h1>
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">
                ${escapeHtml(data.serviceName)}
              </p>

              ${reasonSection}

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
                You can follow up with the customer or revise the quote from your dashboard.
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #9ca3af; font-size: 12px;">
              Powered by ${PRODUCT_NAME}
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
 * Quote reminder — sent to the customer once, a few days after the quote
 * was sent, if it has not been accepted or declined. The link contains a
 * freshly rotated token.
 */
export function generateQuoteReminderEmailHtml(data: {
  businessName: string
  customerName: string
  serviceName: string
  totalFormatted: string
  quoteViewUrl: string
  primaryColor?: string
}): string {
  const primaryColor = data.primaryColor || '#205E56'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your quote from ${escapeHtml(data.businessName)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #09090b;">
                Your quote is still ready, ${escapeHtml(data.customerName)}
              </h1>
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">
                ${escapeHtml(data.businessName)} &middot; ${escapeHtml(data.serviceName)} &middot; ${escapeHtml(data.totalFormatted)}
              </p>

              <p style="margin: 0 0 24px; color: #374151; font-size: 14px; line-height: 1.6;">
                Just a gentle reminder that your quote is waiting for you. You can review the full breakdown, ask questions, or accept it online.
              </p>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View Your Quote
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #6b7280; font-size: 13px; line-height: 1.5;">
                If you no longer need this quote, you can decline it from the same page — no hard feelings.
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #9ca3af; font-size: 12px;">
              Powered by ${PRODUCT_NAME}
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
