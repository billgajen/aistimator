import type { QuoteTurn } from '@qolumns/shared'
import { STATUS_TONE } from '@/lib/status-tone'
import { NeedsYouDot } from './NeedsYouDot'

/**
 * T-158: whose turn it is on a quote. The label and the detail line come from
 * `quoteTurn` in @qolumns/shared; nothing is worded here. The colour is by
 * whose turn it is (T-164, lib/status-tone.ts).
 */
export function TurnBadge({ turn, showDetail = true }: { turn: Pick<QuoteTurn, 'label' | 'detail' | 'tone'>; showDetail?: boolean }) {
  return (
    <div className="min-w-0">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[turn.tone]}`}
        data-testid="turn-label"
        data-tone={turn.tone}
      >
        {turn.tone === 'attention' && <NeedsYouDot className="mr-1.5" />}
        {turn.label}
      </span>
      {showDetail && turn.detail && (
        <p className="mt-1 text-xs text-text-muted" data-testid="turn-detail">
          {turn.detail}
        </p>
      )}
    </div>
  )
}
