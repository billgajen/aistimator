/**
 * The Analytics page's four figures and its funnel (T-201). Pure, so each rule is testable.
 *
 * - Setup tests (`is_test`) are in no figure.
 * - "Total Quotes": every other quote, whatever its status.
 * - "Quotes Viewed": every quote the customer opened, whatever happened next. A quote that was
 *   opened and then declined or expired still counts: it was opened.
 * - "Quotes Accepted": quotes the customer accepted.
 * - "Conversion Rate": accepted ÷ sent, where "sent" is every quote that reached the customer,
 *   declined ones included (a declined quote was sent and not won).
 */
import type { AnalyticsMetrics } from '@qolumns/shared'

export interface AnalyticsQuoteRow {
  status: string
  is_test?: boolean | null
  sent_at?: string | null
  viewed_at?: string | null
  accepted_at?: string | null
}

const ACCEPTED = new Set(['accepted', 'paid'])
/** A quote in one of these was opened, even where an older row carries no `viewed_at` */
const OPENED_BY_STATUS = new Set(['viewed', 'accepted', 'paid'])
/** A quote in one of these reached the customer, even where an older row carries no `sent_at` */
const SENT_BY_STATUS = new Set(['sent', 'viewed', 'feedback_received', 'revised', 'accepted', 'paid', 'declined', 'expired'])

export function analyticsMetrics(rows: ReadonlyArray<AnalyticsQuoteRow> | null | undefined): AnalyticsMetrics {
  const quotes = (rows ?? []).filter((q) => q.is_test !== true)
  const opened = quotes.filter((q) => Boolean(q.viewed_at) || OPENED_BY_STATUS.has(q.status))
  const accepted = quotes.filter((q) => ACCEPTED.has(q.status))
  const sent = quotes.filter((q) => Boolean(q.sent_at) || SENT_BY_STATUS.has(q.status))
  return {
    totalQuotes: quotes.length,
    quotesSent: sent.length,
    quotesViewed: opened.length,
    quotesAccepted: accepted.length,
    // kept in the answer for when payments exist; no page shows it today (PAYMENTS_LIVE)
    quotesPaid: quotes.filter((q) => q.status === 'paid').length,
    conversionRate: sent.length > 0 ? Math.round((accepted.length / sent.length) * 100) : 0,
  }
}
