import Link from 'next/link'
import { QUOTE_TURN_COPY } from '@qolumns/shared'
import { NEEDS_YOU_MARK } from '@/lib/status-tone'
import { NeedsYouDot } from '@/components/quotes/NeedsYouDot'

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
  /** T-198: accepted this calendar month, the period "Won through …" counts */
  accepted: number
  hasQuotes: boolean
}) {
  const T = QUOTE_TURN_COPY.tabs
  const S = QUOTE_TURN_COPY.home.stand
  const tiles = [
    { key: 'needs_you', label: T.needs_you, count: needsYou, note: null as string | null, tone: 'bg-white', needsYou: needsYou > 0 },
    { key: 'waiting', label: T.waiting, count: waiting, note: null as string | null, tone: 'bg-white', needsYou: false },
    { key: 'accepted', label: T.accepted, count: accepted, note: S.acceptedNote, tone: 'bg-white', needsYou: false },
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
              className={`flex items-center justify-between gap-3 rounded-2xl p-5 shadow-warm-md transition-shadow hover:shadow-warm-lg sm:flex-col sm:items-start sm:justify-start ${tile.tone}`}
              data-testid="stand-tile"
              data-group={tile.key}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{tile.label}</span>
                {tile.note && <span className="block text-xs text-text-muted">{tile.note}</span>}
              </span>
              {/* T-165: when something needs the owner, the count sits on the strong yellow, with the marker */}
              <span
                className={`figure inline-flex items-center text-3xl font-medium tracking-tight sm:mt-2 sm:text-4xl ${tile.needsYou ? `rounded-xl px-3 py-0.5 ${NEEDS_YOU_MARK}` : 'text-text-primary'}`}
                data-testid="stand-mark"
                data-needs-you={tile.needsYou}
              >
                {tile.needsYou && <NeedsYouDot className="mr-2" />}
                <span data-testid="stand-count">{tile.count}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-white p-5 text-sm text-text-secondary shadow-warm-md" data-testid="stand-empty">
          {S.empty}
        </p>
      )}
    </section>
  )
}
