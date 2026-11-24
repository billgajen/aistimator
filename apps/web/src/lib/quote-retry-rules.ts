/**
 * T-201: the rules and the words of "Try again" on a request that could not
 * be priced. Pure, and safe for the page to read (lib/quote-retry.ts does the
 * work on the server and says why a retry is never counted twice).
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
