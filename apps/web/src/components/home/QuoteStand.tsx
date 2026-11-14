import Link from 'next/link'
import { QUOTE_TURN_COPY } from '@estimator/shared'

/**
 * T-160: "Where your quotes stand" on Home — three counts by whose turn it
 * is, each opening that tab of the quotes list. The groups and their names
 * are the T-158 ones (quote-turn.ts). A business with no quotes yet gets one
 * friendly line instead of three zeros.
 */
export function QuoteStand({
  needsYou,
  waiting,
  accepted,
  hasQuotes,
}: {
  needsYou: number
  waiting: number
  /** Accepted in the last 30 days */
  accepted: number
  hasQuotes: boolean
}) {
  const T = QUOTE_TURN_COPY.tabs
  const S = QUOTE_TURN_COPY.home.stand
  const tiles = [
    { key: 'needs_you', label: T.needs_you, count: needsYou, note: null as string | null, tone: needsYou > 0 ? 'bg-butter' : 'bg-white' },
    { key: 'waiting', label: T.waiting, count: waiting, note: null as string | null, tone: 'bg-white' },
    { key: 'accepted', label: T.accepted, count: accepted, note: S.acceptedNote, tone: 'bg-white' },
  ]
  return (
    <section className="mb-8" data-testid="home-stand">
      <h2 className="mb-3 font-display text-lg font-bold text-text-primary">{S.title}</h2>
      {hasQuotes ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {tiles.map((tile) => (
            <Link
              key={tile.key}
              href={`/app/quotes?tab=${tile.key}`}
              className={`flex items-center justify-between gap-3 rounded-warm-xl p-5 shadow-warm-md transition-shadow hover:shadow-warm-lg sm:flex-col sm:items-start sm:justify-start ${tile.tone}`}
              data-testid="stand-tile"
              data-group={tile.key}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{tile.label}</span>
                {tile.note && <span className="block text-xs text-text-muted">{tile.note}</span>}
              </span>
              <span className="figure text-3xl font-medium tracking-tight text-text-primary sm:mt-2 sm:text-4xl" data-testid="stand-count">
                {tile.count}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-warm-xl bg-white p-5 text-sm text-text-secondary shadow-warm-md" data-testid="stand-empty">
          {S.empty}
        </p>
      )}
    </section>
  )
}
