/**
 * Quote status groups shared by the widget, the hosted quote page and the
 * public quote API. With queue processing a customer can reach the quote
 * before the worker has priced it.
 */

import type { QuoteStatus } from './database.types'

/** The worker has not produced a document yet */
export const QUOTE_PROCESSING_STATUSES: readonly QuoteStatus[] = ['queued', 'generating']

export function isQuoteProcessing(status: string | null | undefined): boolean {
  return (QUOTE_PROCESSING_STATUSES as readonly string[]).includes(status ?? '')
}
