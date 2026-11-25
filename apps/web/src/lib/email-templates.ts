/**
 * Additional email templates for the quote editing and feedback flow.
 * Supplements the existing templates in postmark.ts.
 */
/**
 * T-184: the emails in this file that go to the BUSINESS (customer feedback, the plan limit, a
 * request held, quote accepted, quote declined, WhatsApp renewal) carry no "Powered by" line:
 * they are from the product itself. The two that go to a customer (updated quote, reminder)
 * keep theirs. A unit test holds both (app-t184.test.ts).
 *
 * T-201: the two customer emails carry the business's logo when it has one, and their "Powered by"
 * line follows the plan by the same rule as the estimate page (`brand`: lib/customer-email-brand.ts).
 *
 * T-204: every email here is put in the one shared page (`emailShell`: a fixed 600 px card, less
 * padding on a phone). The two customer emails say where the quote stands beside its price, and the
 * updated-quote email can carry the business's answer to the customer's question.
 */
import { EMAIL_COLOR, PRODUCT_NAME, brandColourForEmail, businessAnswerHtml, businessLogoBlock, customerFirstName, customerPricePanel, customerStatusHtml, emailShell, poweredByRow, productLogoRow, textColourOnCardForEmail, textOnColourForEmail } from '@qolumns/shared'
import type { CustomerEmailBrand, CustomerQuoteState } from '@qolumns/shared'

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
  /** T-201: the business's logo and whether "Powered by" shows (lib/customer-email-brand.ts) */
  brand?: CustomerEmailBrand
  /** T-204: the business's answer to the customer's question, shown above the price (plain text; escaped here) */
  answer?: { text: string; question?: string | null } | null
}): string {
  const primaryColor = brandColourForEmail(data.primaryColor)

  // The status beside the price is always 'confirmed': an updated quote is one the business
  // edited and sent itself, and that is its review (T-146).
  const content = `${businessLogoBlock(data.brand?.logoUrl, data.businessName)}
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

              ${businessAnswerHtml({ businessName: data.businessName, answer: data.answer?.text, question: data.answer?.question })}
              ${customerPricePanel({ label: 'Updated total', total: data.total, colour: textColourOnCardForEmail(primaryColor), state: 'confirmed', businessName: data.businessName })}

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
              </p>`

  return emailShell({ title: 'Updated quote', content, below: poweredByRow(data.brand?.showPoweredBy) })
}

/**
 * T-204: the words of the email a business gets when a customer writes from the quote page.
 * The subject says who and what, in the customer's first name: "Derek asked a question about
 * their quote" ("their": the product does not know anyone's pronoun and never guesses one).
 * A request made from the business's own test is marked "[Test]", as the review email is.
 */
export function customerQuestionEmailWords(input: { customerName: string; feedbackType: 'feedback' | 'approval_request'; isTest?: boolean }): {
  subject: string
  title: string
  label: string
  messageLabel: string
  closing: string
} {
  const who = customerFirstName(input.customerName) ?? 'A customer'
  const review = input.feedbackType === 'approval_request'
  const title = review ? `${who} asked you to review their quote` : `${who} asked a question about their quote`
  return {
    subject: `${input.isTest ? '[Test] ' : ''}${title}`,
    title,
    label: review ? 'Review request' : 'Question',
    messageLabel: review ? 'Their message' : 'Their question',
    closing: review
      ? 'Open the quote to look it over. If you change it, press Save & Send and the customer gets the updated quote.'
      : 'Open the quote to answer. Edit it and press Save & Send, with your answer, and the customer gets both in one email. Or reply to them yourself and press "Mark as answered".',
  }
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
  isTest?: boolean
}): string {
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's
  const words = customerQuestionEmailWords(data)

  // T-204: the customer's own words are in the email, so the business can read the question without opening anything
  const feedbackSection = data.feedbackText
    ? `
              <div data-role="customer-message" style="margin: 24px 0; padding: 16px; background-color: #F2F0EA; border-left: 4px solid #CFC0A6; border-radius: 0 8px 8px 0;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #4F5D57; font-size: 14px;">${escapeHtml(words.messageLabel)}</p>
                <p style="margin: 0; color: #1B2823; font-size: 15px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(data.feedbackText)}</p>
              </div>
    `
    : ''

  const content = `<div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #F2F0EA; border-radius: 6px;">
                <span style="font-weight: 600; font-size: 14px; color: #7F5710;">${escapeHtml(words.label)}</span>
              </div>

              <h1 data-role="heading" style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
                ${escapeHtml(words.title)}
              </h1>
              <p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.customerName)} &middot; ${escapeHtml(data.serviceName)}
              </p>

              ${feedbackSection}

              <table role="presentation" style="width: 100%; margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${escapeHtml(data.dashboardUrl)}" data-role="dashboard" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
                      Open the quote
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #626C66; font-size: 13px; line-height: 1.5;">
                ${escapeHtml(words.closing)}
              </p>`

  return emailShell({ title: words.title, content, above: productLogoRow() })
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
       automatically — customers are told you'll send their estimate shortly. Upgrade your plan and the
       requests saved in the last 30 days are priced for you, oldest first, as far as the plan's monthly
       number goes (any others can be priced with one click)${
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
     ${data.per === 'total' ? 'your free quotes are used up' : "your plan's monthly limit is reached"}. Upgrade and it is priced for you, or reply to the customer
     yourself: <a href="${escapeHtml(data.quoteUrl)}">open the lead</a>.`
  return generateLimitReachedEmailBody(data, consequence)
}

function generateLimitReachedEmailBody(
  data: { businessName: string; used: number; limit: number; billingUrl: string; per?: 'month' | 'total' },
  consequenceHtml: string
): string {
  const content = `<h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #A23D2F;">
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
              </p>`

  return emailShell({ title: data.per === 'total' ? 'Free quotes used' : 'Monthly quote limit reached', content, above: productLogoRow() })
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

  const content = `<div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #E0F0E4; border-radius: 6px;">
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
              </table>`

  return emailShell({ title: 'Quote accepted', content, above: productLogoRow() })
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

  const content = `<div style="margin: 0 0 24px; padding: 8px 16px; display: inline-block; background-color: #F8E3DD; border-radius: 6px;">
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
              </p>`

  return emailShell({ title: 'Quote declined', content, above: productLogoRow() })
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
  /** T-201: the business's logo and whether "Powered by" shows (lib/customer-email-brand.ts) */
  brand?: CustomerEmailBrand
  /**
   * T-204: where the quote stands, said under its price: 'confirmed' when the business approved it,
   * 'estimate' when it went out automatically. Left out, the neutral 'estimate': a reminder never
   * claims a review it cannot know of.
   */
  state?: CustomerQuoteState
}): string {
  const primaryColor = brandColourForEmail(data.primaryColor)

  const content = `${businessLogoBlock(data.brand?.logoUrl, data.businessName)}
              <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
                Your quote is still ready, ${escapeHtml(data.customerName)}
              </h1>
              <p style="margin: 0 0 8px; color: #626C66; font-size: 14px;">
                ${escapeHtml(data.businessName)} &middot; ${escapeHtml(data.serviceName)} &middot; ${escapeHtml(data.totalFormatted)}
              </p>
              ${customerStatusHtml(data.state ?? 'estimate', data.businessName, { bare: true })}

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
              </p>`

  return emailShell({ title: `Your quote from ${data.businessName}`, content, below: poweredByRow(data.brand?.showPoweredBy) })
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
  const content = `<h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #1B2823;">
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
              </a>`

  return emailShell({ title: 'Reconnect WhatsApp', content, above: productLogoRow() })
}
