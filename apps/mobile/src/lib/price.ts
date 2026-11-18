/**
 * How the app states a quote's price and what it offers next (pure).
 *
 * The same rules as the dashboard and the customer's quote page:
 *   - a provisional quote shows its range, a final one the exact total
 *   - a request with no price shows no figure at all, never "0.00"
 *   - the minimum charge is a floor, said in one note above the total, never
 *     a line (AD-048)
 *   - a quote the business made itself is hidden from the customer until it
 *     is approved (T-146, T-147), so its link is shared only after approval
 */

import {
  canCopyQuoteLink,
  formatMoney,
  isQuoteProcessing,
  minimumChargeNote,
  type AppQuoteLine,
  type AppQuoteView,
} from '@qolumns/shared'

/** Poll while the worker is still pricing. */
export function isPricing(status: string): boolean {
  return isQuoteProcessing(status)
}

/** Is there a price to show? Not while it is worked out, not for a held or failed request. */
export function hasPrice(q: Pick<AppQuoteView, 'pricing' | 'status' | 'held'>): boolean {
  if (isPricing(q.status) || q.status === 'failed' || q.held) return false
  return q.pricing.total > 0
}

/** The headline figure, or null when the quote has no price to show */
export function headlinePrice(q: Pick<AppQuoteView, 'pricing' | 'status' | 'held'>, locale = 'en-US'): string | null {
  if (!hasPrice(q)) return null
  const { total, currency, estimate } = q.pricing
  if (estimate?.rangeLow !== undefined && estimate.rangeHigh !== undefined && estimate.grade !== 'A') {
    return `${formatMoney(estimate.rangeLow, currency, locale, { decimals: 0 })}–${formatMoney(estimate.rangeHigh, currency, locale, { decimals: 0 })}`
  }
  return formatMoney(total, currency, locale)
}

/** "Minimum charge of $120.00 applied", or null when no minimum applied */
export function minimumNote(minimum: { minimumCharge: number } | null | undefined, currency: string, locale = 'en-US'): string | null {
  return minimum ? minimumChargeNote(formatMoney(minimum.minimumCharge, currency, locale)) : null
}

export interface PriceLine extends AppQuoteLine {
  /** How the quantity behind the line was arrived at ("From your photos"), when the takeoff says */
  method?: string
}

/** The main service's price lines, each with how it was measured when the takeoff has the same item */
export function priceLines(q: Pick<AppQuoteView, 'lines' | 'takeoff'>): PriceLine[] {
  const methods = new Map(q.takeoff.map((entry) => [entry.item, entry.method]))
  // a quote from an older server carries only the takeoff
  const lines: AppQuoteLine[] = q.lines ?? q.takeoff.map((entry) => ({ label: entry.item, amount: entry.amount }))
  return lines.map((line) => {
    const method = methods.get(line.label)
    return method ? { ...line, method } : line
  })
}

/**
 * What the quote screen offers, in order of importance. One main action per
 * screen; anything else is quieter.
 *   confirm         answer the open questions on site, then it reprices
 *   send            approve the quote and hand the customer its link (one tap)
 *   share           hand the customer the link of a quote already sent
 *   price_request   price a request that was saved at the plan limit
 *   add_price       held with no price: it is finished in the dashboard
 *   contact         could not be priced: reach the customer
 *   wait            the price is being worked out
 */
export type QuoteAction = 'confirm' | 'send' | 'share' | 'price_request' | 'add_price' | 'contact' | 'wait'

export function mainAction(q: Pick<AppQuoteView, 'status' | 'held' | 'pricing' | 'questions'>): QuoteAction | null {
  if (isPricing(q.status)) return 'wait'
  if (q.status === 'awaiting_clarification') return q.questions.length > 0 ? 'confirm' : null
  if (q.status === 'failed') return 'contact'
  if (q.status === 'pending_review') {
    if (q.held) return 'price_request'
    return q.pricing.total > 0 ? 'send' : 'add_price'
  }
  return canCopyQuoteLink(q.status) ? 'share' : null
}

/** The final invoice can be recorded once the customer has the quote (T-143) */
export function canRecordInvoice(status: string): boolean {
  return ['accepted', 'paid', 'sent', 'viewed', 'revised'].includes(status)
}
