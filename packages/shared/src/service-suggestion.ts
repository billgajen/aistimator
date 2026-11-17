/**
 * T-178: a customer is never stopped at submit for picking "the wrong
 * service". When a request's only content is its description and that reads
 * clearly like another service the business offers, the request is still
 * made on the service the customer chose; the suggestion travels with it and
 * the worker holds the priced quote for the business to review.
 *
 * The suggestion is kept on the request (`quote_requests.source_json`), which
 * the web app writes and the worker reads. The names come from the business's
 * own services; nothing here knows a trade.
 */
export interface ServiceSuggestion {
  serviceId: string
  serviceName: string
  /** The matcher's one-sentence reason, for the business only */
  reason: string
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Read a suggestion off a request's source_json; null when there is none or it is malformed */
export function serviceSuggestionOf(source: unknown): ServiceSuggestion | null {
  const raw = (source as { serviceSuggestion?: unknown } | null | undefined)?.serviceSuggestion
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const serviceId = clean(s.serviceId, 80)
  const serviceName = clean(s.serviceName, 120)
  if (!serviceId || !serviceName) return null
  return { serviceId, serviceName, reason: clean(s.reason, 300) }
}

/** What the business is told, on the quote and in the review email */
export function suggestedServiceReason(suggestion: ServiceSuggestion, chosenServiceName: string): string {
  const why = suggestion.reason ? ` ${suggestion.reason.replace(/[.\s]+$/, '')}.` : ''
  return `The customer chose "${chosenServiceName}", but what they wrote reads more like "${suggestion.serviceName}".${why} Check which they need before you send a price.`
}
