/**
 * T-201: what every email to a CUSTOMER carries of the business and of us.
 * One place, read by the web app's emails and the worker's, so the two cannot
 * drift.
 *
 *   - The business's logo, when it has one, at the top of the card (above its
 *     name). Until T-201 no email carried it. The picture is the business's
 *     own upload, kept private; an email needs an address that still works
 *     when it is opened weeks later, so it points at the web app
 *     (`/api/public/logo/<asset id>`), which sends the reader on to the
 *     picture. That address serves only a picture that is some business's
 *     logo today.
 *   - "Powered by <product>" under the card: shown or not by THE SAME RULE as
 *     the "Prepared with" line on the estimate page: `canUse(access,
 *     'no_badge')` (access.ts). Each app asks that rule through its own small
 *     loader and passes the answer here as `showPoweredBy`; nothing in this
 *     file decides it. Until T-201 every customer email said "Powered by",
 *     whatever the plan.
 *
 * Emails to a business are the product's own (productLogoRow) and never use
 * this.
 *
 * Pure.
 */
import { PRODUCT_NAME } from './brand'
import { EMAIL_COLOR, EMAIL_FONT } from './email-style'
import { customerStatusLine } from './quote-turn'
import type { CustomerQuoteState } from './quote-turn'

/** Where the web app serves a business's logo for its emails */
export const BUSINESS_LOGO_PATH = '/api/public/logo'

/** The shown height in px. The width follows the picture's own shape. */
export const BUSINESS_LOGO_EMAIL_HEIGHT = 48

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** The logo's address for an email, or null when the business has no logo (or the web app's address is not known) */
export function businessLogoUrl(appUrl: string | null | undefined, logoAssetId: unknown): string | null {
  const base = (appUrl ?? '').trim().replace(/\/+$/, '')
  if (!base || typeof logoAssetId !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(logoAssetId)) return null
  return `${base}${BUSINESS_LOGO_PATH}/${logoAssetId}`
}

/**
 * The logo, for the top of the card. Empty when there is none, so the card
 * starts with the business's name as it always has. With pictures blocked the
 * alt text is the business's name.
 */
export function businessLogoBlock(logoUrl: string | null | undefined, businessName: string): string {
  if (!logoUrl) return ''
  const height = BUSINESS_LOGO_EMAIL_HEIGHT
  return `<div data-role="business-logo" style="margin: 0 0 20px;"><img src="${escapeHtml(logoUrl)}" height="${height}" alt="${escapeHtml(businessName)}" style="display: block; height: ${height}px; width: auto; max-width: 100%; border: 0; outline: none; text-decoration: none; color: ${EMAIL_COLOR.ink}; font-size: 16px; font-weight: 700;"></div>`
}

/** The line under the card. `show` is the access rule's answer (true unless the plan removes the badge). */
export function poweredByRow(show: boolean | null | undefined): string {
  if (show === false) return ''
  return `<table role="presentation" width="600" align="center" style="width: 100%; max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td data-role="powered-by" style="text-align: center; color: ${EMAIL_COLOR.muted}; font-size: 12px;">
              Powered by ${PRODUCT_NAME}
            </td>
          </tr>
        </table>`
}

/** What a customer email is given about the business and the badge */
export interface CustomerEmailBrand {
  /** the logo's address (`businessLogoUrl`), or null */
  logoUrl?: string | null
  /** false when the business's plan removes the badge; anything else shows it */
  showPoweredBy?: boolean
}

// ---------------------------------------------------------------------------
// T-204: the price, and where the quote stands, in every email to a customer
// ---------------------------------------------------------------------------

/** The mark and colour of each state: text colours only, on the price panel (`mist`) */
const STATUS_LOOK: Record<CustomerQuoteState, { mark: string; color: string }> = {
  confirmed: { mark: '&#10003; ', color: EMAIL_COLOR.success },
  waiting: { mark: '&#9679; ', color: EMAIL_COLOR.warning },
  estimate: { mark: '', color: EMAIL_COLOR.textSecondary },
}

/**
 * Where the quote stands, as one clear line: "Waiting for <business> to
 * confirm", "Reviewed and confirmed by <business>", or, for a quote that went
 * out automatically, that it is an estimate (no review is claimed). The words
 * are `customerStatusLine` (quote-turn.ts).
 */
export function customerStatusHtml(state: CustomerQuoteState, businessName: string, options: { bare?: boolean } = {}): string {
  const look = STATUS_LOOK[state]
  const frame = options.bare ? 'margin: 0 0 24px;' : `margin: 14px 0 0; padding-top: 12px; border-top: 1px solid ${EMAIL_COLOR.borderStrong};`
  return `<p data-role="quote-status" data-state="${state}" style="${frame} font-size: 14px; font-weight: 600; line-height: 1.4; color: ${look.color};">${look.mark}${escapeHtml(customerStatusLine(state, businessName))}</p>`
}

/**
 * The price panel of a customer email: a small label, the figure in the
 * business's colour, and the status line under it. One block, so the three
 * emails that state a price (estimate or quote, updated quote) cannot differ.
 * `total` is already formatted; `colour` is `textColourOnCardForEmail(...)`.
 */
export function customerPricePanel(input: { label: string; total: string; colour: string; state: CustomerQuoteState; businessName: string }): string {
  return `<div data-role="price-panel" style="margin: 24px 0; padding: 24px; background-color: ${EMAIL_COLOR.mist}; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 4px; color: ${EMAIL_COLOR.muted}; font-size: 14px;">${escapeHtml(input.label)}</p>
      <p data-role="price" style="margin: 0; font-size: 36px; font-weight: 700; font-family: ${EMAIL_FONT.figure}; font-variant-numeric: tabular-nums; color: ${input.colour};">
        ${escapeHtml(input.total)}
      </p>
      ${customerStatusHtml(input.state, input.businessName)}
    </div>`
}

/**
 * The `field` of the entry an answer is kept under, in the list of changes of the amendment it was
 * sent with (`quote_amendments.changes_json`): `{ field, path: <the question's id>, before: <the
 * question>, after: <the answer>, type: 'added' }`. No column holds an answer.
 */
export const ANSWER_CHANGE_FIELD = 'answer_to_customer'

/** How long a business's answer to a customer's question may be, in an email (characters) */
export const ANSWER_TO_CUSTOMER_MAX = 2000

/**
 * A business's typed answer, made safe to keep and to send: no control
 * characters, runs of blank lines closed up, trimmed, and cut at the limit.
 * Empty when there is nothing left. It is still plain text: whoever puts it in
 * HTML escapes it (`businessAnswerHtml` does).
 */
export function cleanAnswerToCustomer(answer: unknown): string {
  if (typeof answer !== 'string') return ''
  const text = answer
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > ANSWER_TO_CUSTOMER_MAX ? `${text.slice(0, ANSWER_TO_CUSTOMER_MAX - 1).trimEnd()}…` : text
}

/**
 * "<Business>'s answer to your question", for an email to the customer: above
 * the price. The customer's own question is quoted first (shortened), so the
 * answer reads without the customer having to remember what was asked.
 * Empty when there is no answer.
 */
export function businessAnswerHtml(input: { businessName: string; answer: string | null | undefined; question?: string | null }): string {
  const answer = cleanAnswerToCustomer(input.answer)
  if (!answer) return ''
  const asked = (input.question ?? '').replace(/\s+/g, ' ').trim()
  const question = asked ? (asked.length > 240 ? `${asked.slice(0, 239)}…` : asked) : ''
  const owner = /s$/i.test(input.businessName.trim()) ? `${input.businessName.trim()}’` : `${input.businessName.trim()}’s`
  return `<div data-role="business-answer" style="margin: 0 0 24px; padding: 16px; background-color: ${EMAIL_COLOR.surface}; border-left: 4px solid ${EMAIL_COLOR.juniper}; border-radius: 0 8px 8px 0;">
      <p style="margin: 0 0 8px; font-weight: 600; color: ${EMAIL_COLOR.ink}; font-size: 14px;">${escapeHtml(owner)} answer to your question</p>
      ${question ? `<p data-role="your-question" style="margin: 0 0 8px; color: ${EMAIL_COLOR.muted}; font-size: 13px; line-height: 1.5;">You asked: “${escapeHtml(question)}”</p>` : ''}
      <p data-role="answer-text" style="margin: 0; color: ${EMAIL_COLOR.ink}; font-size: 15px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(answer)}</p>
    </div>`
}
