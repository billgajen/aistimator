/**
 * T-204, Part C: emails.
 *
 *   11  one shared page for every email: a card 600 px wide whatever is in it
 *   12  where the quote stands, as a clear line beside the price, in every customer email
 *   13  the business's answer to a customer's question, in the email, above the price
 *   14  the email to the business when a customer asks: who asked, and the question itself
 *   15  the product's logo reads on a dark background; a phone uses its width
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANSWER_CHANGE_FIELD,
  ANSWER_TO_CUSTOMER_MAX,
  EMAIL_PHONE_MAX_WIDTH,
  EMAIL_PHONE_PADDING,
  EMAIL_WIDTH,
  PRODUCT_LOGO_EMAIL,
  businessAnswerHtml,
  cleanAnswerToCustomer,
  customerQuoteState,
  customerStatusHtml,
  customerStatusLine,
  emailFootnote,
  emailShell,
  failedRequestEmail,
  opsAlertEmail,
  poweredByRow,
  productLogoRow,
  productLogoUrl,
  supportReplyEmail,
} from '@qolumns/shared'
import type { CombinedPricing, CustomerQuoteState } from '@qolumns/shared'
import { generateCustomerEmailHtml } from '@/lib/postmark'
import {
  customerQuestionEmailWords,
  generateFeedbackNotificationEmailHtml,
  generateLeadHeldEmailHtml,
  generateLimitReachedEmailHtml,
  generateQuoteAcceptedEmailHtml,
  generateQuoteDeclinedEmailHtml,
  generateQuoteReminderEmailHtml,
  generateRevisedQuoteEmailHtml,
  generateWhatsAppRenewalEmailHtml,
} from '@/lib/email-templates'
import { alreadyRegisteredEmail, confirmEmail, resetPasswordEmail } from '@/lib/auth-emails'
import { freeQuotesLeftEmail, paymentFailedEmail } from '@/lib/billing-emails'
import { requestUpdatedEmail } from '@/lib/request-updated-email'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

const BUSINESS = 'Harlow Heating & Air'
const base = { customerName: 'Megan Grant', businessName: BUSINESS, serviceName: 'Service A', quoteViewUrl: 'https://x.test/q', total: '$2,512.38' }
const LONG = 'A long sentence about the work, repeated so that it is wider than any card. '.repeat(12)
const pricing = { sections: [], subtotal: 100, taxAmount: 0, total: 100, currency: 'USD' } as unknown as CombinedPricing

const customerEmails: Array<[string, string]> = [
  ['quote (approved)', generateCustomerEmailHtml({ ...base, state: 'confirmed' })],
  ['updated quote', generateRevisedQuoteEmailHtml(base)],
  ['reminder', generateQuoteReminderEmailHtml({ businessName: BUSINESS, customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '$2,512.38', quoteViewUrl: 'https://x.test/q' })],
]
const businessEmails: Array<[string, string]> = [
  ['customer question', generateFeedbackNotificationEmailHtml({ businessName: BUSINESS, customerName: 'Derek Shaw', serviceName: 'Service A', feedbackType: 'feedback', feedbackText: 'Is the old unit taken away?', dashboardUrl: 'https://x.test/app' })],
  ['limit reached', generateLimitReachedEmailHtml({ businessName: BUSINESS, used: 10, limit: 10, billingUrl: 'https://x.test/b' })],
  ['request held', generateLeadHeldEmailHtml({ businessName: BUSINESS, customerName: 'Megan Grant', serviceName: 'Service A', used: 10, limit: 10, billingUrl: 'https://x.test/b', quoteUrl: 'https://x.test/q' })],
  ['accepted', generateQuoteAcceptedEmailHtml({ businessName: BUSINESS, customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '$100.00', dashboardUrl: 'https://x.test/app' })],
  ['declined', generateQuoteDeclinedEmailHtml({ businessName: BUSINESS, customerName: 'Megan Grant', serviceName: 'Service A', dashboardUrl: 'https://x.test/app' })],
  ['WhatsApp renewal', generateWhatsAppRenewalEmailHtml({ businessName: BUSINESS, displayPhoneNumber: '+1 555 0100', daysLeft: 3, expiresOn: '22 November', whatsappUrl: 'https://x.test/w' })],
  ['confirm email', confirmEmail({ businessName: BUSINESS, confirmUrl: 'https://x.test/c' }).htmlBody],
  ['reset password', resetPasswordEmail({ resetUrl: 'https://x.test/r' }).htmlBody],
  ['already registered', alreadyRegisteredEmail({ loginUrl: 'https://x.test/l', forgotUrl: 'https://x.test/f' }).htmlBody],
  ['free quotes left', freeQuotesLeftEmail({ businessName: BUSINESS, used: 8, limit: 10, billingUrl: 'https://x.test/b' })!.html],
  ['payment failed', paymentFailedEmail({ businessName: BUSINESS, billingUrl: 'https://x.test/b' }).html],
  ['failed request', failedRequestEmail({ customerName: 'Megan Grant', serviceName: 'Service A', quoteUrl: 'https://x.test/q' }).html],
  ['request updated', requestUpdatedEmail({ customerName: 'Megan Grant', mainServiceName: 'Service A', changedServiceName: 'Service B', change: 'added', pricing, locale: 'en-US', awaitingApproval: false, dashboardUrl: 'https://x.test/app' }).html],
  ['support reply', supportReplyEmail({ businessName: BUSINESS, reply: 'Thanks, fixed.', yourWords: 'The button did nothing', link: 'https://x.test/app' }).html],
  ['ops alert', opsAlertEmail({ kind: 'ai_busy', details: { 'Busy retries': 24 } } as never, { appUrl: 'https://x.test' }).html],
]

/** Everything of the page that is not the caller's: up to the card's own cell, and after it */
function pageAround(html: string): { before: string; after: string } {
  const open = html.indexOf('data-role="email-card"')
  const cell = html.indexOf('<td class="email-card"', open)
  const close = html.lastIndexOf('</td>\n          </tr>\n        </table>')
  return { before: html.slice(html.indexOf('<body'), html.indexOf('>', cell) + 1), after: html.slice(close) }
}

// ---------------------------------------------------------------------------------------------
describe('T-204 item 11: one page, one fixed content width', () => {
  for (const [name, html] of [...customerEmails, ...businessEmails]) {
    it(`"${name}" is in the shared page: one card, 600 px wide whatever is in it`, () => {
      expect(html.match(/data-role="email-card"/g)).toHaveLength(1)
      const card = /<table role="presentation" data-role="email-card"[^>]*>/.exec(html)![0]
      // a width of its own (it no longer shrinks to its text), capped at 600, and 600 for Outlook
      expect(card).toContain(`width="${EMAIL_WIDTH}"`)
      expect(card).toContain(`width: 100%; max-width: ${EMAIL_WIDTH}px;`)
      expect(html).toContain(`<!--[if mso]><table role="presentation" width="${EMAIL_WIDTH}"`)
      expect(html.match(/<body/g)).toHaveLength(1)
    })
  }

  it('the width is 600', () => {
    expect(EMAIL_WIDTH).toBe(600)
  })

  it('a short email and a long one are in the same page, character for character', () => {
    const short = pageAround(emailShell({ title: 'Short', content: '<p>Hi</p>' }))
    const long = pageAround(emailShell({ title: 'Long', content: `<p>${LONG}</p>` }))
    expect(short).toEqual(long)
  })

  it('the two emails that differed (the customer’s quote and the updated quote) now share the page around their card', () => {
    const quote = pageAround(generateCustomerEmailHtml({ ...base, state: 'confirmed' }))
    const updated = pageAround(generateRevisedQuoteEmailHtml(base))
    expect(quote.before).toBe(updated.before)
    // under the card both carry the same "Powered by" row
    expect(quote.after).toBe(updated.after)
  })

  it('what sits above and under the card is at the card’s width too', () => {
    for (const row of [productLogoRow(), poweredByRow(true), emailFootnote('Qolumns')]) {
      expect(row).toContain('width="600"')
      expect(row).toMatch(/max-width: 600px/)
      expect(row).toMatch(/width: 100%/)
    }
  })

  it('no email writes its own page any more: the page is in one file', () => {
    const files = [
      'apps/worker/src/email/templates.ts',
      'apps/web/src/lib/postmark.ts',
      'apps/web/src/lib/email-templates.ts',
      'apps/web/src/lib/request-updated-email.ts',
      'apps/web/src/lib/billing-emails.ts',
      'apps/web/src/lib/auth-emails.ts',
      'packages/shared/src/support-emails.ts',
      'packages/shared/src/failed-request.ts',
      'packages/shared/src/ops-alerts.ts',
    ]
    for (const file of files) {
      const code = read(file)
      expect(code, file).not.toMatch(/<!DOCTYPE|<body|<\/html>/)
      expect(code, file).toContain('emailShell(')
    }
    expect(read('packages/shared/src/email-shell.ts').match(/<body/g)).toHaveLength(1)
  })

  it('a title is escaped by the page, not by its caller', () => {
    expect(emailShell({ title: 'A & B <x>', content: '' })).toContain('<title>A &amp; B &lt;x&gt;</title>')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 12: where the quote stands, beside the price', () => {
  it('the three cases, in the words of the ticket', () => {
    expect(customerStatusLine('waiting', 'Northgate')).toBe('Waiting for Northgate to confirm')
    expect(customerStatusLine('confirmed', 'Northgate')).toBe('Reviewed and confirmed by Northgate')
    // sent automatically: no review happened, so none is claimed
    expect(customerStatusLine('estimate', 'Northgate')).toBe('Estimate based on your photos and details')
    expect(customerStatusLine('estimate', 'Northgate')).not.toMatch(/review|confirm/i)
  })

  it('the state follows the same two facts as the line on the estimate page', () => {
    expect(customerQuoteState({ reviewed: true, confirmationPending: false })).toBe('confirmed')
    expect(customerQuoteState({ reviewed: true, confirmationPending: true })).toBe('confirmed')
    expect(customerQuoteState({ reviewed: false, confirmationPending: true })).toBe('waiting')
    expect(customerQuoteState({ reviewed: false, confirmationPending: false })).toBe('estimate')
    expect(read('packages/shared/src/quote-turn.ts')).toContain('export function customerEstimateNote')
  })

  const states: CustomerQuoteState[] = ['confirmed', 'waiting', 'estimate']
  for (const state of states) {
    it(`"${state}" is one marked line, with the business's name escaped`, () => {
      const html = customerStatusHtml(state, 'A <b> & Co')
      expect(html).toContain(`data-role="quote-status" data-state="${state}"`)
      expect(html).not.toContain('<b>')
      if (state !== 'estimate') expect(html).toContain('A &lt;b&gt; &amp; Co')
      expect(html).toContain('font-weight: 600')
    })
  }

  it('the quote email after approval says "Reviewed and confirmed by", inside the price panel, after the figure', () => {
    const html = generateCustomerEmailHtml({ ...base, state: 'confirmed' })
    const panel = html.slice(html.indexOf('data-role="price-panel"'), html.indexOf('</div>', html.indexOf('data-role="quote-status"')))
    expect(panel).toContain('$2,512.38')
    expect(panel).toContain(`Reviewed and confirmed by ${BUSINESS.replace('&', '&amp;')}`)
    expect(panel.indexOf('data-role="price"')).toBeLessThan(panel.indexOf('data-role="quote-status"'))
  })

  it('"Send again" of a quote that went out automatically does not claim a review', () => {
    const html = generateCustomerEmailHtml({ ...base, state: 'estimate' })
    expect(html).toContain('data-state="estimate"')
    expect(html).not.toContain('Reviewed and confirmed')
    expect(read('apps/web/src/app/api/quotes/[quoteId]/resend/route.ts')).toMatch(/approved_at \? 'confirmed' : 'estimate'/)
  })

  it('an updated quote is always the business’s own send: confirmed', () => {
    const html = generateRevisedQuoteEmailHtml(base)
    expect(html).toContain('data-state="confirmed"')
    expect(html).toContain('Updated total')
  })

  it('the reminder says it under its price line, and claims a review only when told there was one', () => {
    const reminder = (state?: CustomerQuoteState) =>
      generateQuoteReminderEmailHtml({ businessName: BUSINESS, customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '$2,512.38', quoteViewUrl: 'https://x.test/q', state })
    expect(reminder()).toContain('data-state="estimate"')
    expect(reminder()).not.toContain('Reviewed and confirmed')
    expect(reminder('confirmed')).toContain('Reviewed and confirmed by')
    expect(reminder('confirmed').indexOf('$2,512.38')).toBeLessThan(reminder('confirmed').indexOf('data-role="quote-status"'))
    // the daily job reads whether the business approved it
    expect(read('apps/web/src/lib/quote-reminders.ts')).toMatch(/sent_at, approved_at,/)
    expect(read('apps/web/src/app/api/cron/lifecycle/route.ts')).toMatch(/row\.approved_at \? 'confirmed' : 'estimate'/)
  })

  it('every email to a customer carries exactly one status line; none to a business does', () => {
    for (const [name, html] of customerEmails) expect(html.match(/data-role="quote-status"/g), name).toHaveLength(1)
    for (const [name, html] of businessEmails) expect(html, name).not.toContain('data-role="quote-status"')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 13: the business’s answer to the customer’s question', () => {
  it('nothing typed: nothing in the email', () => {
    expect(businessAnswerHtml({ businessName: BUSINESS, answer: '' })).toBe('')
    expect(businessAnswerHtml({ businessName: BUSINESS, answer: '   \n ' })).toBe('')
    expect(businessAnswerHtml({ businessName: BUSINESS, answer: null })).toBe('')
    expect(generateRevisedQuoteEmailHtml(base)).not.toContain('data-role="business-answer"')
    expect(generateRevisedQuoteEmailHtml({ ...base, answer: null })).not.toContain('answer to your question')
  })

  it('the updated-quote email shows it above the price, under "<Business>’s answer to your question"', () => {
    const html = generateRevisedQuoteEmailHtml({ ...base, businessName: 'Northgate', answer: { text: 'Yes, we take the old unit away.', question: 'Is the old unit taken away?' } })
    expect(html).toContain('Northgate’s answer to your question')
    expect(html).toContain('You asked: “Is the old unit taken away?”')
    expect(html).toContain('Yes, we take the old unit away.')
    expect(html.indexOf('data-role="business-answer"')).toBeLessThan(html.indexOf('data-role="price-panel"'))
  })

  it('so does the first quote email, when a held estimate is edited and sent with an answer', () => {
    const html = generateCustomerEmailHtml({ ...base, answer: { text: 'It is included.' } })
    expect(html.indexOf('data-role="business-answer"')).toBeGreaterThan(0)
    expect(html.indexOf('data-role="business-answer"')).toBeLessThan(html.indexOf('data-role="price-panel"'))
    expect(html).not.toContain('You asked')
  })

  it('what was typed is text, never markup: it is escaped, line breaks kept', () => {
    const html = businessAnswerHtml({ businessName: 'A <b>', answer: '<script>alert(1)</script>\nSecond "line" & more', question: '<img src=x>' })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;\nSecond &quot;line&quot; &amp; more')
    expect(html).toContain('white-space: pre-wrap')
  })

  it('it is cleaned and capped before it is kept or sent', () => {
    expect(cleanAnswerToCustomer('  Hello\r\n\r\n\r\n\r\nthere\u0000\u0007  ')).toBe('Hello\n\nthere')
    expect(cleanAnswerToCustomer(42)).toBe('')
    expect(cleanAnswerToCustomer(undefined)).toBe('')
    const long = cleanAnswerToCustomer('x'.repeat(ANSWER_TO_CUSTOMER_MAX + 500))
    expect(long.length).toBe(ANSWER_TO_CUSTOMER_MAX)
    expect(long.endsWith('…')).toBe(true)
    expect(ANSWER_TO_CUSTOMER_MAX).toBe(2000)
  })

  it('a business whose name ends in "s" is not given a second one', () => {
    expect(businessAnswerHtml({ businessName: 'Harlow & Sons', answer: 'Yes.' })).toContain('Harlow &amp; Sons’ answer to your question')
  })

  it('a long question is shortened when it is quoted back', () => {
    const html = businessAnswerHtml({ businessName: BUSINESS, answer: 'Yes.', question: 'why '.repeat(200) })
    expect(html).toMatch(/You asked: “[^”]{200,240}”/)
  })

  const route = read('apps/web/src/app/api/quotes/[quoteId]/route.ts')
  it('the save route uses it only when the quote is being sent and a question is in fact pending', () => {
    expect(route).toMatch(/body\.sendToCustomer \? cleanAnswerToCustomer\(body\.answerToCustomer\) : ''/)
    const block = route.slice(route.indexOf('const typedAnswer'), route.indexOf('const newVersion'))
    expect(block).toContain(".eq('status', 'pending')")
    expect(block).toContain(".eq('tenant_id', auth.tenantId)")
    // no question pending: `answer` stays null and nothing is emailed or recorded
    expect(block).toMatch(/if \(asked\) \{/)
  })

  it('it is kept on the amendment (no new column), and both customer emails are given it', () => {
    expect(ANSWER_CHANGE_FIELD).toBe('answer_to_customer')
    expect(route).toContain("changes.push({ field: ANSWER_CHANGE_FIELD, path: asked.id, before: asked.feedback_text, after: typedAnswer, type: 'added' })")
    expect(route.match(/^\s+answer,$/gm)?.length).toBe(2)
    // the question was read before the pending ones are marked resolved
    expect(route.indexOf('const typedAnswer')).toBeLessThan(route.indexOf(".update({ status: 'resolved' })"))
    // the learning analysis reads pricing and content entries only
    for (const file of ['apps/web/src/app/api/learning/analyze/route.ts', 'apps/worker/src/ai/amendment-analyzer.ts']) {
      expect(read(file), file).not.toContain('answer_to_customer')
    }
    expect(existsSync(join(ROOT, 'supabase/migrations'))).toBe(true)
  })

  it('sending still marks every pending question answered', () => {
    const after = route.slice(route.indexOf('if (body.sendToCustomer) {\n      await supabase\n        .from(\'quote_feedback\')'))
    expect(after).toContain(".update({ status: 'resolved' })")
  })

  it('the editor offers the box only while a question is pending, and sends it only with "Save & Send"', () => {
    const editor = read('apps/web/src/components/quote-editor/QuoteEditor.tsx')
    expect(editor).toContain('{pendingQuestion && (')
    expect(editor).toContain("label={`Your answer to ${pendingQuestion.customerFirstName ?? 'the customer'} (optional)`}")
    expect(editor).toContain('...(sendToCustomer && pendingQuestion && answerToCustomer.trim() && { answerToCustomer: answerToCustomer.trim() })')
    expect(editor).toContain('ANSWER_TO_CUSTOMER_MAX')
    const page = read('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain('pendingQuestion={')
    expect(page).toContain('customerFirstName((quote.customer_json as { name?: string } | null)?.name)')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 14: the email to the business when a customer asks a question', () => {
  it('the subject says who asked and what, with no guessed pronoun', () => {
    const words = customerQuestionEmailWords({ customerName: 'Derek Shaw', feedbackType: 'feedback' })
    expect(words.subject).toBe('Derek asked a question about their quote')
    expect(words.subject).not.toMatch(/\b(his|her)\b/)
    expect(words.title).toBe(words.subject)
  })

  it('a test request is marked "[Test]"; no name reads "A customer"', () => {
    expect(customerQuestionEmailWords({ customerName: 'Derek Shaw', feedbackType: 'feedback', isTest: true }).subject).toBe('[Test] Derek asked a question about their quote')
    expect(customerQuestionEmailWords({ customerName: '  ', feedbackType: 'feedback' }).subject).toBe('A customer asked a question about their quote')
  })

  it('the review-request kind keeps its own words', () => {
    const words = customerQuestionEmailWords({ customerName: 'Derek Shaw', feedbackType: 'approval_request' })
    expect(words.subject).toBe('Derek asked you to review their quote')
    expect(words.label).toBe('Review request')
    const html = generateFeedbackNotificationEmailHtml({ businessName: BUSINESS, customerName: 'Derek Shaw', serviceName: 'Service A', feedbackType: 'approval_request', dashboardUrl: 'https://x.test/app' })
    expect(html).toContain('Derek asked you to review their quote')
    expect(html).not.toContain('data-role="customer-message"')
  })

  it('the customer’s message is in the email, escaped, under the heading', () => {
    const html = generateFeedbackNotificationEmailHtml({
      businessName: BUSINESS,
      customerName: 'Derek Shaw',
      serviceName: 'Service A',
      feedbackType: 'feedback',
      feedbackText: 'Is the <old> unit taken away?\nAnd when?',
      dashboardUrl: 'https://x.test/app/quotes/qte_1',
    })
    expect(html).toContain('Derek asked a question about their quote')
    expect(html).toContain('Their question')
    expect(html).toContain('Is the &lt;old&gt; unit taken away?\nAnd when?')
    expect(html.indexOf('data-role="heading"')).toBeLessThan(html.indexOf('data-role="customer-message"'))
    expect(html).toContain('href="https://x.test/app/quotes/qte_1"')
    // from the product: our logo, no "Powered by", no status line
    expect(html).toContain('data-role="product-logo"')
    expect(html).not.toContain('data-role="powered-by"')
  })

  it('the route sends that subject, and marks a test', () => {
    const route = read('apps/web/src/app/api/public/quotes/[quoteId]/feedback/route.ts')
    expect(route).toContain('subject: customerQuestionEmailWords({ customerName: customer.name, feedbackType: body.feedbackType, isTest }).subject')
    expect(route).toContain('is_demo, is_test,')
    expect(route).not.toContain('on quote: ${customer.name}')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-204 item 15: dark mode and a phone', () => {
  const html = generateQuoteAcceptedEmailHtml({ businessName: BUSINESS, customerName: 'Megan Grant', serviceName: 'Service A', totalFormatted: '$100.00', dashboardUrl: 'https://x.test/app' })

  it('the logo is the wordmark on its own light panel, part of the picture', () => {
    expect(productLogoUrl()).toBe('https://qolumns.com/brand/qolumns-wordmark-email-panel.png')
    const file = readFileSync(join(ROOT, 'apps/web/public', PRODUCT_LOGO_EMAIL.path))
    // PNG: width and height are at bytes 16 and 20; colour type at 25 (6 = with transparency, for the rounded corners)
    expect(file.readUInt32BE(16)).toBe(PRODUCT_LOGO_EMAIL.width * 3)
    expect(file.readUInt32BE(20)).toBe(PRODUCT_LOGO_EMAIL.height * 3)
    expect(file[25]).toBe(6)
    expect(html).toContain(`width="${PRODUCT_LOGO_EMAIL.width}" height="${PRODUCT_LOGO_EMAIL.height}"`)
  })

  it('the cell behind it is light too, as a colour and as a gradient a dark mode leaves alone (pictures blocked: the name still reads)', () => {
    const row = productLogoRow()
    expect(row).toContain('data-role="product-logo-panel"')
    expect(row).toContain('background-color: #FFFFFF; background-image: linear-gradient(#FFFFFF, #FFFFFF);')
    expect(row).toMatch(/alt="Qolumns"[^>]*color: #1B2823/)
  })

  it('the earlier picture is still served: emails already sent point at it', () => {
    expect(existsSync(join(ROOT, 'apps/web/public/brand/qolumns-wordmark-email.png'))).toBe(true)
  })

  it('the page says it is light, on purpose', () => {
    expect(html).toContain('<meta name="color-scheme" content="light only">')
    expect(html).toContain('<meta name="supported-color-schemes" content="light only">')
    expect(html).toContain(':root { color-scheme: light only; }')
    // and it does not carry a second, dark design that nothing checks
    expect(html).not.toContain('prefers-color-scheme')
  })

  it('a phone gets less padding around the card and inside it, so the content uses the width', () => {
    expect(EMAIL_PHONE_MAX_WIDTH).toBe(480)
    expect(html).toContain(`@media only screen and (max-width: ${EMAIL_PHONE_MAX_WIDTH}px)`)
    expect(html).toContain(`.email-outer { padding: ${EMAIL_PHONE_PADDING.outer} !important; }`)
    expect(html).toContain(`.email-card { padding: ${EMAIL_PHONE_PADDING.card} !important; }`)
    expect(html).toContain('<td class="email-outer" align="center" style="padding: 40px 20px;">')
    expect(html).toContain('<td class="email-card" style="padding: 40px;">')
    // 375 px wide: 8 + 16 each side leaves 327 px for content (it was 255 px with 20 + 40)
    const side = (padding: string) => Number(/ (\d+)px$/.exec(padding)![1])
    expect(375 - 2 * (side(EMAIL_PHONE_PADDING.outer) + side(EMAIL_PHONE_PADDING.card))).toBe(327)
  })

  it('every email carries the rule and the two classes', () => {
    for (const [name, page] of [...customerEmails, ...businessEmails]) {
      expect(page, name).toContain('.email-card { padding:')
      expect(page.match(/class="email-outer"/g), name).toHaveLength(1)
      expect(page.match(/class="email-card"/g), name).toHaveLength(1)
    }
  })
})
