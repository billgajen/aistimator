/**
 * "Try again" on a request that could not be priced: the rules and the words,
 * for the dashboard's quote page (T-201) and the phone app (T-202). One place,
 * so the two cannot say different things.
 *
 * Pure. The work is done on the server (apps/web/src/lib/quote-retry.ts, which
 * also says why a retry is never counted against the plan twice); the button's
 * own label is `QUOTE_TURN_COPY.pageButtons.tryAgain` (quote-turn.ts).
 */

/** How many times a business can try one failed request again */
export const BUSINESS_RETRY_LIMIT = 5

export const RETRY_COPY = {
  started: 'Pricing started. This page will update shortly.',
  paused: 'Your account is paused, so this request cannot be priced yet',
  limit: `This request has been tried ${BUSINESS_RETRY_LIMIT} times and still has no price. Contact the customer and quote it yourself, or tell us with Help.`,
  notStarted: 'Could not start pricing. Try again.',
} as const

/** How many times the business has tried this request again so far */
export function businessRetriesOf(content: unknown): number {
  const tries = (content as { businessRetries?: unknown } | null)?.businessRetries
  return typeof tries === 'number' && Number.isFinite(tries) && tries > 0 ? Math.floor(tries) : 0
}

/** May the business try this request again? Only a failed one, and only so many times. */
export function canBusinessRetry(quote: { status: string; content_json?: unknown }): boolean {
  return quote.status === 'failed' && businessRetriesOf(quote.content_json) < BUSINESS_RETRY_LIMIT
}

/**
 * T-202: what a screen that does not hold the quote's content (the phone app)
 * is told about a failed request: how many tries are left. Absent on any
 * request that did not fail.
 */
export interface TryAgainView {
  left: number
}

export function tryAgainView(quote: { status: string; content_json?: unknown }): TryAgainView | undefined {
  if (quote.status !== 'failed') return undefined
  return { left: Math.max(0, BUSINESS_RETRY_LIMIT - businessRetriesOf(quote.content_json)) }
}
