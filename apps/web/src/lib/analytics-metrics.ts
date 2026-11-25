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
import { isSetupTest, quoteWasAccepted, quoteWasOpened, quoteWasSent, type AnalyticsMetrics } from '@qolumns/shared'

export interface AnalyticsQuoteRow {
  status: string
  is_test?: boolean | null
  sent_at?: string | null
  viewed_at?: string | null
  accepted_at?: string | null
}

export function analyticsMetrics(rows: ReadonlyArray<AnalyticsQuoteRow> | null | undefined): AnalyticsMetrics {
  // T-204: the rules themselves are shared (quote-outcomes.ts), so "Quote Outcomes by Service" counts the same way
  const quotes = (rows ?? []).filter((q) => !isSetupTest(q))
  const opened = quotes.filter(quoteWasOpened)
  const accepted = quotes.filter(quoteWasAccepted)
  const sent = quotes.filter(quoteWasSent)
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
