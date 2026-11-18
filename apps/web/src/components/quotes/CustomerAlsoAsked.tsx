import type { AlsoAsked } from '@qolumns/shared'

const STATE: Record<AlsoAsked['state'], { label: string; tone: string }> = {
  // the status colours of the design system (system.md, Status colours); the words carry the meaning, not the colour
  added: { label: 'Added by the customer', tone: 'bg-secondary-light text-secondary' },
  offered: { label: 'Not added yet', tone: 'bg-mist text-text-secondary' },
  not_offered: { label: 'Not one of your services', tone: 'border border-border bg-surface text-text-muted' },
}

/**
 * T-179: at the top of a quote, what else the customer asked for in their
 * note, each with where it stands: added to this quote by the customer, not
 * added yet, or not one of the business's services. It sits beside T-178's
 * "Check the service" notice, never in place of it.
 *
 * `states` tells apart a service the customer added from one the business
 * added in the editor.
 */
export function CustomerAlsoAsked({ items, addedBy }: { items: AlsoAsked[]; addedBy?: Record<string, 'customer' | 'business'> }) {
  if (items.length === 0) return null
  return (
    <section className="mb-6 rounded-2xl border border-border bg-white p-5 shadow-warm-md" aria-labelledby="also-asked-title" data-testid="customer-also-asked">
      <h2 id="also-asked-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
        Customer also asked for
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {items.map((item) => {
          const byBusiness = item.state === 'added' && item.serviceId && addedBy?.[item.serviceId] === 'business'
          const state = byBusiness ? { label: 'Added by you', tone: STATE.added.tone } : STATE[item.state]
          return (
            <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6" data-testid="also-asked-item" data-state={item.state}>
              <div className="min-w-0">
                {item.serviceName && <p className="text-sm font-semibold text-text-primary">{item.serviceName}</p>}
                <p className="break-words text-sm text-text-secondary">“{item.words}”</p>
                {item.state === 'not_offered' && (
                  <p className="mt-1 text-sm text-text-secondary">No price was given. The customer was told you will confirm it with them separately.</p>
                )}
              </div>
              <span className={`inline-flex shrink-0 items-center self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${state.tone}`} data-testid="also-asked-state">
                {state.label}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
