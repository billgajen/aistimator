import { QUOTE_TURN_COPY } from '@estimator/shared'
import type { QuoteTrackerStep } from '@estimator/shared'

/**
 * T-158: the four steps a quote goes through, replacing the plain timeline.
 * The steps, their labels and their dates come from `quoteTracker` in
 * @estimator/shared. Side by side on a wide screen, stacked on a phone.
 */
export function QuoteTracker({ steps }: { steps: QuoteTrackerStep[] }) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-5" data-testid="quote-tracker">
      <h3 className="mb-4 text-sm font-semibold text-text-primary">{QUOTE_TURN_COPY.tracker.title}</h3>
      <ol className="grid gap-4 sm:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="flex items-start gap-3 sm:flex-col sm:gap-2"
            data-testid="tracker-step"
            data-step={step.key}
            data-done={step.done ? 'true' : 'false'}
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                step.ended
                  ? 'border border-border bg-background text-text-muted'
                  : step.done
                    ? 'bg-primary text-white'
                    : 'border border-border bg-background text-text-muted'
              }`}
            >
              {step.ended ? (
                '–'
              ) : step.done ? (
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
              <p className={`text-sm font-medium ${step.done && !step.ended ? 'text-text-primary' : 'text-text-secondary'}`}>{step.label}</p>
              {step.date && <p className="figure text-xs text-text-muted">{step.date}</p>}
              {step.note && <p className="figure text-xs text-text-muted">{step.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
