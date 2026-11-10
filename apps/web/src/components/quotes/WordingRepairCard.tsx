/**
 * T-148: business-only view of banned customer words found in the generated
 * wording and what was done about them (rewritten, removed, or left for the
 * business to edit). Rendered on the dashboard trace page only.
 */
import type { WordingRepairRecord } from '@estimator/shared'

const PATH_LABEL: Record<WordingRepairRecord['path'], string> = {
  generation: 'When the estimate was written',
  reprice: 'When the estimate was updated from the customer’s answers',
  approval: 'When you approved it',
}

export function WordingRepairCard({ record }: { record: WordingRepairRecord }) {
  return (
    <div className="rounded-warm-lg border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-lg font-medium text-text-primary">Customer wording</h2>
        <p className="text-sm text-text-muted">
          {PATH_LABEL[record.path]}: {record.found} sentence{record.found === 1 ? '' : 's'} used words customers
          shouldn&apos;t see. Only you can see this.
        </p>
      </div>
      <div className="space-y-4 px-6 py-4 text-sm">
        {record.rewritten.length > 0 && (
          <section>
            <h3 className="mb-2 font-medium text-text-primary">Rewritten</h3>
            <ul className="space-y-2">
              {record.rewritten.map((r, i) => (
                <li key={i} className="rounded-warm-lg bg-background p-3">
                  <p className="text-xs text-text-muted">{r.field}</p>
                  <p className="text-text-muted line-through">{r.before}</p>
                  <p className="text-text-primary">{r.after}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {record.removed.length > 0 && (
          <section>
            <h3 className="mb-2 font-medium text-text-primary">Removed</h3>
            <ul className="space-y-2">
              {record.removed.map((r, i) => (
                <li key={i} className="rounded-warm-lg bg-background p-3">
                  <p className="text-xs text-text-muted">{r.field}</p>
                  <p className="text-text-muted line-through">{r.text}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {record.unresolved.length > 0 && (
          <section>
            <h3 className="mb-2 font-medium text-text-primary">Needs your edit</h3>
            <ul className="list-disc space-y-1 pl-5 text-text-secondary">
              {record.unresolved.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </section>
        )}
        {record.rewriteCalled && record.rewriteError && (
          <p className="text-xs text-text-muted">The rewrite didn&apos;t work ({record.rewriteError}), so the sentences were removed.</p>
        )}
      </div>
    </div>
  )
}
