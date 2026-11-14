import Link from 'next/link'
import { QUOTE_TURN_COPY } from '@estimator/shared'

export interface ActivityLine {
  /** "Sarah opened the quote" */
  text: string
  /** "2 hours ago" */
  when: string
  href: string
  kind: string
}

/**
 * T-160: "Latest activity" on Home — the newest things that happened to the
 * business's quotes, each linking to its quote. The lines are worded by the
 * shared map; this only lays them out.
 */
export function LatestActivity({ lines, hasQuotes }: { lines: ActivityLine[]; hasQuotes: boolean }) {
  const A = QUOTE_TURN_COPY.home.activity
  return (
    <section className="rounded-warm-xl bg-white p-6 shadow-warm-md" data-testid="home-activity">
      <h2 className="mb-3 font-display text-lg font-bold text-text-primary">{A.title}</h2>
      {lines.length === 0 ? (
        <p className="text-sm text-text-secondary" data-testid="activity-empty">
          {hasQuotes ? A.quiet : A.empty}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {lines.map((line, index) => (
            <li key={index} data-testid="activity-line" data-kind={line.kind}>
              <Link
                href={line.href}
                className="flex flex-col gap-0.5 py-2.5 hover:underline sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className="min-w-0 text-sm font-medium text-text-primary">{line.text}</span>
                <span className="shrink-0 text-xs text-text-muted">{line.when}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
