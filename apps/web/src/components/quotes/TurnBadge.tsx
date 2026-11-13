import type { QuoteTurn, QuoteTurnTone } from '@estimator/shared'

const TONE: Record<QuoteTurnTone, string> = {
  attention: 'bg-tertiary-light text-tertiary',
  danger: 'bg-danger-light text-danger',
  waiting: 'bg-primary-light text-primary',
  good: 'bg-secondary-light text-secondary',
  closed: 'border border-border bg-surface text-text-muted',
  working: 'border border-border bg-surface text-text-secondary',
}

/**
 * T-158: whose turn it is on a quote. The label and the detail line come from
 * `quoteTurn` in @estimator/shared; nothing is worded here.
 */
export function TurnBadge({ turn, showDetail = true }: { turn: Pick<QuoteTurn, 'label' | 'detail' | 'tone'>; showDetail?: boolean }) {
  return (
    <div className="min-w-0">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[turn.tone]}`}
        data-testid="turn-label"
      >
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
