/**
 * One definition of what happened to a quote, for every figure on Analytics
 * (T-201 #22 to #24, T-204 #22). Pure.
 *
 * - A setup test (`is_test`) is in no figure.
 * - "Sent": the quote reached the customer. A declined, expired, revised or
 *   questioned quote was sent; an older row with no `sent_at` is read by its
 *   status.
 * - "Opened": the customer opened it, whatever happened next.
 * - "Accepted": the customer accepted it.
 *
 * A quote is one row whatever is done to it afterwards: revising it changes
 * its status and its version, never the number of quotes.
 */
export interface QuoteOutcomeRow {
  status: string
  is_test?: boolean | null
  sent_at?: string | null
  viewed_at?: string | null
}

const ACCEPTED = new Set(['accepted', 'paid'])
/** A quote in one of these was opened, even where an older row carries no `viewed_at` */
const OPENED_BY_STATUS = new Set(['viewed', 'accepted', 'paid'])
/** A quote in one of these reached the customer, even where an older row carries no `sent_at` */
const SENT_BY_STATUS = new Set(['sent', 'viewed', 'feedback_received', 'revised', 'accepted', 'paid', 'declined', 'expired'])

export const isSetupTest = (row: { is_test?: boolean | null }): boolean => row.is_test === true
export const quoteWasSent = (row: QuoteOutcomeRow): boolean => Boolean(row.sent_at) || SENT_BY_STATUS.has(row.status)
export const quoteWasOpened = (row: QuoteOutcomeRow): boolean => Boolean(row.viewed_at) || OPENED_BY_STATUS.has(row.status)
export const quoteWasAccepted = (row: Pick<QuoteOutcomeRow, 'status'>): boolean => ACCEPTED.has(row.status)
