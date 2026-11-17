import type { RequestDetails, ServiceSuggestion } from '@qolumns/shared'

/**
 * T-178: what the customer sent, in the business's own question wording.
 *
 * Shown on the dashboard quote page when there is no estimate to read
 * instead: a request that could not be priced, or one with no price yet. The
 * business needs the answers to quote it by hand. The photos sit just below
 * (UnderstoodPanel). Nothing is rendered when the customer sent nothing.
 */
export function CustomerSent({ request, serviceName }: { request: RequestDetails | undefined; serviceName: string | null }) {
  if (!request) return null
  const where = [request.address, request.postcode].filter(Boolean).join(', ')
  const rows = [
    ...request.answers,
    ...(request.quantity ? [{ label: 'Quantity', value: String(request.quantity) }] : []),
    ...(where ? [{ label: 'Where', value: where }] : []),
  ]
  if (!request.description && rows.length === 0) return null

  return (
    <section className="mb-6 rounded-2xl border border-border bg-white p-5 shadow-warm-md" aria-labelledby="customer-sent-title" data-testid="customer-sent">
      <h2 id="customer-sent-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
        What the customer sent
      </h2>
      {serviceName && <p className="mt-1 text-sm text-text-secondary">For {serviceName}</p>}
      {request.description && (
        <p className="mt-4 whitespace-pre-wrap break-words text-sm text-text-primary" data-testid="customer-sent-words">
          {request.description}
        </p>
      )}
      {rows.length > 0 && (
        <dl className="mt-4 divide-y divide-border border-t border-border text-sm">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between sm:gap-6" data-testid="customer-sent-answer">
              <dt className="text-text-secondary">{row.label}</dt>
              <dd className="break-words font-medium text-text-primary sm:text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

/**
 * T-178: the request form thought another of the business's services fits
 * what the customer wrote. The request was made on the service the customer
 * chose and is held; this tells the business why. A notice, so `tertiary`
 * (system.md, Colour).
 */
export function ServiceSuggestionNote({ suggestion, chosenServiceName }: { suggestion: ServiceSuggestion | null | undefined; chosenServiceName: string | null }) {
  if (!suggestion) return null
  return (
    <div className="mb-6 rounded-2xl border border-tertiary-line bg-tertiary-light p-4" role="note" data-testid="service-suggestion">
      <p className="text-xs font-semibold uppercase text-tertiary">Check the service</p>
      <p className="mt-1 text-sm text-text-primary">
        The customer chose {chosenServiceName ? <strong>{chosenServiceName}</strong> : 'this service'}, but what they wrote reads more like{' '}
        <strong>{suggestion.serviceName}</strong>. This price is for the service they chose. Check which they need before you send it.
      </p>
      {suggestion.reason && <p className="mt-1 text-sm text-text-secondary">{suggestion.reason}</p>}
    </div>
  )
}
