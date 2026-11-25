import type { PricingFlag } from '@qolumns/shared'

/**
 * T-204: the flags on a service's prices, wherever they are shown (the compile
 * review, setup, "Test & Publish"). They stay visible and never block
 * applying or saving: a question that changes no price line, and a line whose
 * words say it depends on something while nothing decides it.
 */
export function PricingFlagsNote({ flags, title, hint, testId = 'pricing-flags' }: { flags: readonly PricingFlag[] | undefined; title: string; hint: string; testId?: string }) {
  if (!flags || flags.length === 0) return null
  return (
    <div className="rounded-lg border border-tertiary-line bg-background p-4" data-testid={testId}>
      <h4 className="mb-2 text-sm font-bold text-tertiary">{title}</h4>
      <ul className="space-y-1.5 text-sm text-text-primary">
        {flags.map((flag) => (
          <li key={flag.kind === 'question_unused' ? `q-${flag.fieldId}` : `l-${flag.stepId}`} data-testid={`flag-${flag.kind}`}>
            {flag.kind === 'question_unused' ? (
              <>
                <span className="font-medium">&quot;{flag.label}&quot;</span>: {flag.message}.
              </>
            ) : (
              <>{flag.message}.</>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-muted">{hint}</p>
    </div>
  )
}
