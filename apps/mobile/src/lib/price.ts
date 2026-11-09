/**
 * How the app states a quote's price (pure). Same rules as the hosted quote
 * page: a provisional quote shows its range, a final one the exact total.
 */

import { formatMoney, type AppQuoteView } from '@estimator/shared'

export function headlinePrice(q: Pick<AppQuoteView, 'pricing' | 'status'>, locale = 'en-US'): string {
  const { total, currency, estimate } = q.pricing
  if (q.status === 'queued' || q.status === 'generating') return 'Pricing…'
  if (estimate?.rangeLow !== undefined && estimate.rangeHigh !== undefined && estimate.grade !== 'A') {
    return `${formatMoney(estimate.rangeLow, currency, locale, { decimals: 0 })}–${formatMoney(estimate.rangeHigh, currency, locale, { decimals: 0 })}`
  }
  return formatMoney(total, currency, locale)
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Pricing',
  generating: 'Pricing',
  awaiting_clarification: 'Needs a confirmation',
  pending_review: 'Held for your review',
  sent: 'Sent to customer',
  viewed: 'Viewed by customer',
  accepted: 'Accepted',
  declined: 'Declined',
  paid: 'Paid',
  expired: 'Expired',
  failed: 'Failed',
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

/** Poll while the worker is still pricing. */
export function isPricing(status: string): boolean {
  return status === 'queued' || status === 'generating'
}
