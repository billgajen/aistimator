/**
 * Quote status groups shared by the widget, the hosted quote page, the
 * dashboard and the quote APIs.
 *
 * T-157: what the business can do with a quote in each status lives here, and
 * the button and the route it calls read the same rule, so a button only
 * shows when it will work.
 */

import type { QuoteStatus } from './database.types'

/** The worker has not produced a document yet */
export const QUOTE_PROCESSING_STATUSES: readonly QuoteStatus[] = ['queued', 'generating']

export function isQuoteProcessing(status: string | null | undefined): boolean {
  return (QUOTE_PROCESSING_STATUSES as readonly string[]).includes(status ?? '')
}

// ---------------------------------------------------------------------------
// What the business can do with a quote (T-157)
// ---------------------------------------------------------------------------

/** Send again: re-send the quote email */
export const QUOTE_SEND_AGAIN_STATUSES: readonly QuoteStatus[] = ['sent', 'viewed', 'revised', 'expired']

/** Copy link and Download PDF: the customer has (or had) a quote to look at */
export const QUOTE_LINK_STATUSES: readonly QuoteStatus[] = [
  'sent',
  'viewed',
  'feedback_received',
  'revised',
  'accepted',
  'paid',
  'expired',
]

/** Text link (SMS) */
export const QUOTE_TEXT_LINK_STATUSES: readonly QuoteStatus[] = [
  'sent',
  'viewed',
  'feedback_received',
  'revised',
  'expired',
]

/** Edit is closed once the customer agreed, and while there is no document */
export const QUOTE_NOT_EDITABLE_STATUSES: readonly QuoteStatus[] = ['accepted', 'paid', 'generating', 'queued', 'failed']

/** The customer has already been sent this quote, so sending an edit is a revision */
export const QUOTE_ALREADY_SENT_STATUSES: readonly QuoteStatus[] = ['sent', 'viewed', 'feedback_received', 'revised']

const has = (list: readonly QuoteStatus[], status: string | null | undefined) =>
  (list as readonly string[]).includes(status ?? '')

export function canEditQuote(status: string | null | undefined): boolean {
  return status != null && status !== '' && !has(QUOTE_NOT_EDITABLE_STATUSES, status)
}

/** Send again emails the customer, so it also needs an address to send to */
export function canSendQuoteAgain(status: string | null | undefined, ctx: { hasEmail: boolean }): boolean {
  return has(QUOTE_SEND_AGAIN_STATUSES, status) && ctx.hasEmail
}

export function canCopyQuoteLink(status: string | null | undefined): boolean {
  return has(QUOTE_LINK_STATUSES, status)
}

export function canDownloadQuotePdf(status: string | null | undefined): boolean {
  return has(QUOTE_LINK_STATUSES, status)
}

/** Text link needs the tenant's SMS number connected and active */
export function canTextQuoteLink(status: string | null | undefined, ctx: { smsActive: boolean }): boolean {
  return has(QUOTE_TEXT_LINK_STATUSES, status) && ctx.smsActive
}

export interface QuoteActions {
  edit: boolean
  sendAgain: boolean
  copyLink: boolean
  downloadPdf: boolean
  textLink: boolean
}

/** Every action for one quote, for the quote page and the quotes list */
export function quoteActions(
  status: string | null | undefined,
  ctx: { hasEmail: boolean; smsActive: boolean }
): QuoteActions {
  return {
    edit: canEditQuote(status),
    sendAgain: canSendQuoteAgain(status, ctx),
    copyLink: canCopyQuoteLink(status),
    downloadPdf: canDownloadQuotePdf(status),
    textLink: canTextQuoteLink(status, ctx),
  }
}

/**
 * The status a re-send (email or text) leaves behind. A revised quote stays
 * revised and an open customer question stays open; anything else is `sent`
 * again (an expired quote comes back to life with its new expiry).
 */
export function statusAfterResend(status: QuoteStatus): QuoteStatus {
  return status === 'revised' || status === 'feedback_received' ? status : 'sent'
}

/**
 * The status after the business edits a quote and sends it. A quote the
 * customer already had becomes (or stays) `revised`; a first send is `sent`.
 */
export function statusAfterEditAndSend(status: QuoteStatus): QuoteStatus {
  return has(QUOTE_ALREADY_SENT_STATUSES, status) ? 'revised' : 'sent'
}

/**
 * The status after the business marks a customer question as answered: once
 * nothing is pending, a quote waiting on the question goes back to `viewed`.
 * Every other status is left alone.
 */
export function statusAfterQuestionAnswered(status: QuoteStatus, pendingLeft: number): QuoteStatus {
  return status === 'feedback_received' && pendingLeft === 0 ? 'viewed' : status
}

/** The customer can accept or decline a quote in these statuses */
export const QUOTE_DECISION_STATUSES: readonly QuoteStatus[] = ['sent', 'viewed', 'revised', 'feedback_received']

export function canCustomerDecide(status: string | null | undefined): boolean {
  return has(QUOTE_DECISION_STATUSES, status)
}
