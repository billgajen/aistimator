import { TRY_IT_COPY } from '@/lib/try-it-copy'
import { TryItButton } from '@/components/try-it/TryItButton'

/**
 * T-202: "Try it yourself" on Home: the same button as setup's last step, for
 * a business that skipped setup or passed that step over. Home shows it until
 * the first real customer request arrives, and only while a service is
 * switched on (lib/try-it.ts: `showTryItOnHome`).
 */
export function HomeTryIt() {
  return (
    <section className="mb-8 flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-warm-md sm:flex-row sm:items-center sm:justify-between" data-testid="home-try-it">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold text-text-primary">{TRY_IT_COPY.title}</h2>
        <p className="mt-1 text-sm font-medium text-text-primary">{TRY_IT_COPY.line}</p>
        <p className="mt-1 text-sm text-text-secondary">{TRY_IT_COPY.about}</p>
      </div>
      <div className="shrink-0">
        <TryItButton />
      </div>
    </section>
  )
}
