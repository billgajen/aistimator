/**
 * Additional email templates for the quote editing and feedback flow.
 * Supplements the existing templates in postmark.ts.
 */
/**
 * T-184: the emails in this file that go to the BUSINESS (customer feedback, the plan limit, a
 * request held, quote accepted, quote declined, WhatsApp renewal) carry no "Powered by" line:
 * they are from the product itself. The two that go to a customer (updated quote, reminder)
 * keep theirs. A unit test holds both (app-t184.test.ts).
 */
import { EMAIL_COLOR, EMAIL_FONT, PRODUCT_NAME, brandColourForEmail, emailHeadStyle, productLogoRow, textColourOnCardForEmail, textOnColourForEmail } from '@qolumns/shared'

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
  /** T-179: the services of a combined quote, as rows (lib/sections-email.ts); nothing for a single-service quote */
  sectionsHtml?: string
}): string {
  const primaryColor = brandColourForEmail(data.primaryColor)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Updated quote</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: ${textColourOnCardForEmail(primaryColor)};">
                ${escapeHtml(data.businessName)}
              </h1>
              <p style="margin: 0 0 32px; color: #626C66; font-size: 14px;">
                Updated quote for ${escapeHtml(data.serviceName)}
              </p>

              <p style="margin: 0 0 16px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
                Hi ${escapeHtml(data.customerName)},
              </p>
              <p style="margin: 0 0 24px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
                Your quote has been updated. Please review the latest version:
              </p>

              <div style="margin: 24px 0; padding: 24px; background-color: #EAEFF5; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 4px; color: #626C66; font-size: 14px;">Updated total</p>
                <p style="margin: 0; font-size: 36px; font-weight: 700; font-family: ${EMAIL_FONT.figure}; font-variant-numeric: tabular-nums; color: ${textColourOnCardForEmail(primaryColor)};">
                  ${escapeHtml(data.total)}
                </p>
              </div>

              ${data.sectionsHtml ?? ''}

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View updated quote
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #626C66; font-size: 14px; line-height: 1.5;">
                If you have any questions, simply reply to this email and we'll get back to you.
              </p>

              <p style="margin: 24px 0 0; color: #4F5D57; font-size: 14px;">
                Best regards,<br>
                <strong>${escapeHtml(data.businessName)}</strong>
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #626C66; font-size: 12px;">
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
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's
  const feedbackLabel = data.feedbackType === 'approval_request'
    ? 'Review request'
    : 'Feedback'

  const feedbackSection = data.feedbackText
    ? `
              <div style="margin: 24px 0; padding: 16px; background-color: #F2F0EA; border-left: 4px solid #CFC0A6; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #4F5D57; font-size: 14px;">Customer message:</p>
                <p style="margin: 0; color: #4F5D57; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(data.feedbackText)}</p>
              </div>
    `
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Customer ${feedbackLabel.toLowerCase()}</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        ${productLogoRow()}
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #F2F0EA; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #7F5710;">${feedbackLabel}</span>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
                Customer ${feedbackLabel.toLowerCase()} on quote
              </h1>
              <p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.customerName)} &middot; ${escapeHtml(data.serviceName)}
              </p>

              ${feedbackSection}

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View in dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #626C66; font-size: 13px; line-height: 1.5;">
                You can review and respond to this ${feedbackLabel.toLowerCase()} from your dashboard.
              </p>
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
  <title>${data.per === 'total' ? 'Free quotes used' : 'Monthly quote limit reached'}</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        ${productLogoRow()}
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #A23D2F;">
                ${data.per === 'total' ? 'Your free quotes are used' : 'Monthly quote limit reached'}
              </h1>
              <p style="margin: 0 0 32px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.businessName)}
              </p>

              <p style="margin: 0 0 16px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
                ${
                  data.per === 'total'
                    ? `You've used <strong>${data.used} of ${data.limit}</strong> free quotes. Pick a plan to keep pricing every request instantly.`
                    : `You've used <strong>${data.used} of ${data.limit}</strong> quotes on your current plan this month.`
                }
              </p>
              <p style="margin: 0 0 24px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
                ${consequenceHtml}
              </p>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.billingUrl)}" style="display: inline-block; padding: 16px 32px; background-color: #1B2823; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      Upgrade your plan
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #626C66; font-size: 14px; line-height: 1.5;">
                Every missed instant quote is a lead your competitors can answer first.
              </p>
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
  /** T-179: the services of a combined quote, as rows (lib/sections-email.ts); nothing for a single-service quote */
  sectionsHtml?: string
  dashboardUrl: string
  primaryColor?: string
  /** T-151: what the customer told you when accepting */
  nextStep?: { timing: string; timingNote?: string | null; address: string; phone: string }
}): string {
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's
  const row = (label: string, value: string) =>
    `<tr><td style="padding: 6px 0; color: #626C66; font-size: 14px; width: 120px; vertical-align: top;">${escapeHtml(label)}</td><td style="padding: 6px 0; color: #1B2823; font-size: 14px;">${escapeHtml(value)}</td></tr>`
  const nextStepSection = data.nextStep
    ? `<table role="presentation" style="width: 100%; margin: 0 0 24px; padding: 16px; background-color: #F2F0EA; border-radius: 8px;">
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
  <title>Quote accepted</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        ${productLogoRow()}
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #E0F0E4; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #326B49;">Accepted</span>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
                ${escapeHtml(data.customerName)} accepted your quote
              </h1>
              <p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.serviceName)} &middot; ${escapeHtml(data.totalFormatted)}
              </p>

              ${data.sectionsHtml ?? ''}
              ${nextStepSection}
              <p style="margin: 0 0 24px; color: #4F5D57; font-size: 14px; line-height: 1.6;">
                The customer is expecting to hear from you — reaching out quickly keeps the momentum going.
              </p>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View in dashboard
                    </a>
                  </td>
                </tr>
              </table>
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
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's

  const reasonSection = data.reason
    ? `
              <div style="margin: 24px 0; padding: 16px; background-color: #F8E3DD; border-left: 4px solid #A23D2F; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #4F5D57; font-size: 14px;">Customer's reason:</p>
                <p style="margin: 0; color: #4F5D57; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(data.reason)}</p>
              </div>
    `
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote declined</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        ${productLogoRow()}
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #F8E3DD; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #A23D2F;">Declined</span>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
                ${escapeHtml(data.customerName)} declined your quote
              </h1>
              <p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.serviceName)}
              </p>

              ${reasonSection}

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View in dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #626C66; font-size: 13px; line-height: 1.5;">
                You can follow up with the customer or revise the quote from your dashboard.
              </p>
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
  const primaryColor = brandColourForEmail(data.primaryColor)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your quote from ${escapeHtml(data.businessName)}</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
                Your quote is still ready, ${escapeHtml(data.customerName)}
              </h1>
              <p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.businessName)} &middot; ${escapeHtml(data.serviceName)} &middot; ${escapeHtml(data.totalFormatted)}
              </p>

              <p style="margin: 0 0 24px; color: #4F5D57; font-size: 14px; line-height: 1.6;">
                Just a gentle reminder that your quote is waiting for you. You can review the full breakdown, ask questions, or accept it online.
              </p>

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      View your quote
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #626C66; font-size: 13px; line-height: 1.5;">
                If you no longer need this quote, you can decline it from the same page — no hard feelings.
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center; color: #626C66; font-size: 12px;">
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
 * T-175: the business's WhatsApp connection is about to run out (Meta gives
 * each connection 60 days) and could not be renewed for it. One click on the
 * WhatsApp page reconnects it.
 */
export function generateWhatsAppRenewalEmailHtml(data: {
  businessName: string
  displayPhoneNumber: string
  /** whole days left; 0 = today; negative = already run out */
  daysLeft: number
  /** the last day, written out */
  expiresOn: string
  whatsappUrl: string
}): string {
  const when = data.daysLeft < 0 ? 'has run out' : data.daysLeft === 0 ? 'runs out today' : `runs out in ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}`
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reconnect WhatsApp</title>
${emailHeadStyle()}
</head>
<body style="margin: 0; padding: 0; font-family: ${EMAIL_FONT.body}; background-color: #FAF9F6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        ${productLogoRow()}
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #1B2823;">
                Your WhatsApp connection ${when}
              </h1>
              <p style="margin: 0 0 32px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.businessName)} · ${escapeHtml(data.displayPhoneNumber)}
              </p>
              <p style="margin: 0 0 16px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
                Meta gives each WhatsApp connection 60 days. Yours ${data.daysLeft < 0 ? 'ended' : 'ends'} on
                <strong>${escapeHtml(data.expiresOn)}</strong>. ${
                  data.daysLeft < 0
                    ? `${PRODUCT_NAME} can no longer answer customers on this number.`
                    : `After that, ${PRODUCT_NAME} can no longer answer customers on this number.`
                }
              </p>
              <p style="margin: 0 0 24px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
                Reconnecting takes one click and keeps the same number.
              </p>
              <a href="${data.whatsappUrl}" style="display: inline-block; padding: 12px 24px; background-color: #205E56; color: #FFFFFF; text-decoration: none; border-radius: 8px; font-weight: 600;">
                Reconnect WhatsApp
              </a>
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
