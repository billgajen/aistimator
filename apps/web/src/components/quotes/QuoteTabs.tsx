'use client'

import { QUOTE_LIST_TABS, QUOTE_TURN_COPY } from '@estimator/shared'
import type { QuoteListCounts, QuoteListTab } from '@estimator/shared'

/**
 * T-158: the quotes list is split by whose turn it is. The row scrolls
 * sideways on a phone instead of wrapping.
 */
export function QuoteTabs({
  active,
  counts,
  onSelect,
}: {
  active: QuoteListTab | null
  counts: QuoteListCounts | null
  onSelect: (tab: QuoteListTab) => void
}) {
  return (
    <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="quote-tabs">
      <div role="tablist" aria-label="Quotes by whose turn it is" className="flex min-w-max gap-1 border-b border-border">
        {QUOTE_LIST_TABS.map((tab) => {
          const selected = tab === active
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(tab)}
              className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                selected ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
              data-testid={`tab-${tab}`}
            >
              {QUOTE_TURN_COPY.tabs[tab]}
              {counts && (
                <span
                  className={`figure rounded-full px-2 py-0.5 text-xs font-medium ${
                    selected ? 'bg-mint text-primary' : 'bg-surface text-text-secondary'
                  }`}
                  data-testid={`tab-count-${tab}`}
                >
                  {counts[tab]}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
