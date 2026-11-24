import Link from 'next/link'
import { WON_COPY, type WonLines, type WonSummary } from '@qolumns/shared'

/**
 * T-196: "Won through Qolumns" on Home — what the business won this calendar
 * month. Customer requests carry the headline and four steps (Requests,
 * Estimates sent, Opened, Accepted), each with its share of the step before
 * ("67% of requests", T-198); estimates the business made on site are one quieter line that is
 * never added in. The page shows this only once an estimate has been
 * accepted; the rule and every word are the shared ones (won.ts).
 */
/** A sentence with its money and counts in the figure face (system.md: every figure is mono) */
function Figures({ text }: { text: string }) {
  return (
    <>
      {text.split(/([^\s\d]?\d[\d,.]*%?)/).map((part, i) =>
        /\d/.test(part) ? (
          <span key={i} className="figure">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  )
}

export function WonPanel({ summary, lines }: { summary: WonSummary; lines: WonLines }) {
  const steps = summary.customer?.steps ?? null
  return (
    <section className="mb-8 rounded-2xl bg-white p-5 shadow-warm-md sm:p-6" data-testid="won-panel" data-kind={summary.customer ? 'customer' : 'on-site'}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-text-primary">{lines.title}</h2>
        <Link href="/app/analytics" className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-semibold text-primary hover:underline sm:min-h-[24px]">
          {WON_COPY.allNumbers}
        </Link>
      </div>

      {summary.customer && lines.headline && (
        <div data-testid="won-customer">
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{WON_COPY.customerTitle}</p>
          <p className="mt-2 font-display text-2xl font-bold tracking-tight text-text-primary" data-testid="won-headline">
            <Figures text={lines.headline} />
          </p>
          {lines.lastMonth && (
            <p className="mt-1 text-xs text-text-secondary" data-testid="won-last-month">
              <Figures text={lines.lastMonth} />
            </p>
          )}

          {steps && (
            <ol className="mt-5 grid grid-cols-2 gap-x-3 gap-y-4 sm:flex sm:items-stretch sm:gap-0" data-testid="won-steps">
              {steps.map((step, i) => (
                <li key={step.key} className="flex min-w-0 items-stretch sm:flex-1" data-testid="won-step" data-step={step.key}>
                  {/* between two steps on a wide screen: a rule. T-198: the share is said under the step, at every width. */}
                  {i > 0 && (
                    <span className="hidden w-8 shrink-0 items-center justify-center px-1 sm:flex" aria-hidden="true">
                      <span className="block h-px w-full bg-border" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 rounded-xl bg-surface px-4 py-3">
                    <span className="block text-xs font-semibold text-text-secondary">{step.label}</span>
                    <span className="figure mt-1 block text-2xl font-medium tracking-tight text-text-primary" data-testid="won-step-count">
                      {step.count}
                    </span>
                    {i > 0 && step.share && (
                      <span className="mt-0.5 block text-xs text-text-secondary" data-testid="won-step-share">
                        <Figures text={WON_COPY.shareOf(step.share, steps[i - 1]!.key)} />
                      </span>
                    )}
                    {/* T-201: Accepted counts on-site estimates too; when some are in it, that is said here */}
                    {step.note && (
                      <span className="mt-0.5 block text-xs text-text-secondary" data-testid="won-step-note">
                        <Figures text={step.note} />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {lines.onSite && (
        <p className={summary.customer ? 'mt-4 border-t border-border pt-4 text-sm text-text-secondary' : 'mt-2 font-display text-2xl font-bold tracking-tight text-text-primary'} data-testid="won-on-site">
          <Figures text={lines.onSite} />
        </p>
      )}
      {!summary.customer && lines.lastMonth && (
        <p className="mt-1 text-xs text-text-secondary" data-testid="won-last-month">
          <Figures text={lines.lastMonth} />
        </p>
      )}
    </section>
  )
}
