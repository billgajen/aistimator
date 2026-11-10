import { timingLabel, type AcceptanceDetails } from '@/lib/acceptance'

/** T-151: the customer's next-step answers, shown on the dashboard quote page */
export function AcceptanceCard({ details }: { details: AcceptanceDetails }) {
  return (
    <div className="mb-6 rounded-lg border border-secondary/30 bg-secondary-light p-4" data-testid="acceptance-details">
      <p className="text-sm font-semibold text-text-primary">The customer accepted. Here&apos;s what they told you</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto,1fr]">
        <dt className="text-text-muted">When suits them</dt>
        <dd className="text-text-primary">{timingLabel(details.timing)}{details.timingNote ? ` · “${details.timingNote}”` : ''}</dd>
        <dt className="text-text-muted">Job address</dt>
        <dd className="text-text-primary">{details.address}</dd>
        <dt className="text-text-muted">Phone</dt>
        <dd className="text-text-primary">
          <a href={`tel:${details.phone.replace(/[^0-9+]/g, '')}`} className="font-semibold text-primary underline underline-offset-2">{details.phone}</a>
        </dd>
      </dl>
    </div>
  )
}
