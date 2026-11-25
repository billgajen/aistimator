/**
 * T-204: how the Quotes list takes a quiet refresh (the dashboard's pulse said
 * something changed), without moving what the business is looking at.
 */

/** The list API's page size, and the most it gives in one request */
export const QUOTE_PAGE_SIZE = 50
export const QUOTE_PAGE_MAX = 100

/** How many quotes a quiet refresh asks for: as many as are listed, within the API's bounds */
export function quietRefreshSize(listed: number): number {
  return Math.min(QUOTE_PAGE_MAX, Math.max(QUOTE_PAGE_SIZE, listed))
}

interface Row {
  quoteId: string
  createdAt: string
}

/**
 * The list after a quiet refresh.
 *
 * `coversAll`: the request asked for at least as many quotes as were on screen,
 * so its answer is the list. Otherwise ("Load more" went past what one request
 * reads) the answer replaces the newest part and the older quotes already on
 * screen stay below it, so the page never shrinks under the reader.
 */
export function mergeRefreshed<T extends Row>(shown: readonly T[], fresh: readonly T[], coversAll: boolean): T[] {
  if (coversAll || fresh.length === 0) return [...fresh]
  const ids = new Set(fresh.map((row) => row.quoteId))
  const oldest = fresh[fresh.length - 1]!.createdAt
  return [...fresh, ...shown.filter((row) => !ids.has(row.quoteId) && row.createdAt < oldest)]
}
