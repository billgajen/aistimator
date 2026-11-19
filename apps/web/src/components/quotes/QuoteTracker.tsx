'use client'

import { QUOTE_TURN_COPY } from '@qolumns/shared'
import type { QuoteStep } from '@qolumns/shared'

/**
 * T-158: where a quote is on its way. The steps come from the shared
 * `quoteStory`, so the dates and the wording are decided in one place.
 *
 * T-186: the same steps, by the same names, as the on-site app shows:
 * Received, Approve and send, Opened, Accepted. A done step is ticked with
 * its date, the step now stands out, later ones are quiet, and a line under a
 * step says what comes first when it is not simply "now".
 */
export function QuoteTracker({ steps }: { steps: QuoteStep[] }) {
  return (
    <section className="p-5" data-testid="quote-tracker">
      <h3 className="mb-4 text-sm font-semibold text-text-primary">{QUOTE_TURN_COPY.tracker.title}</h3>
      <ol className="grid gap-4 sm:grid-cols-4">
        {steps.map((step, index) => {
          const done = step.state === 'done'
          const current = step.state === 'current'
          const ended = step.state === 'ended'
          return (
            <li
              key={step.key}
              className="flex items-start gap-3 sm:flex-col sm:gap-2"
              data-testid="tracker-step"
              data-step={step.key}
              data-state={step.state}
              data-done={done || ended ? 'true' : 'false'}
              aria-current={current ? 'step' : undefined}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  done ? 'bg-primary text-white' : current ? 'border-2 border-primary bg-mint text-primary' : 'border border-border bg-background text-text-muted'
                }`}
              >
                {ended ? (
                  '–'
                ) : done ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0">
                <p className={`text-sm ${current ? 'font-semibold text-text-primary' : done ? 'font-medium text-text-primary' : 'font-medium text-text-secondary'}`} data-testid="tracker-step-name">
                  {step.name}
                </p>
                {step.date && <p className="figure text-xs text-text-muted">{step.date}</p>}
                {step.note && (
                  <p className={`text-xs ${current ? 'text-text-secondary' : 'text-text-muted'}`} data-testid="tracker-step-note">
                    {step.note}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
