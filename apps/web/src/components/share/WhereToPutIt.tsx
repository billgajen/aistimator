'use client'

import type { ShareText } from '@/lib/share-texts'
import { useCopy } from './useCopy'

/** T-149: ready-to-copy texts, each with its own Copy button. */
export function WhereToPutIt({ texts }: { texts: ShareText[] }) {
  const { copy, copiedId } = useCopy()
  return (
    <section className="rounded-warm-lg bg-surface p-6 shadow-warm">
      <h2 className="text-lg font-medium text-text-primary">Where to put it</h2>
      <p className="mt-1 text-sm text-text-muted">Copy a ready-made line and paste it where your customers already find you.</p>
      <ul className="mt-4 space-y-3">
        {texts.map((t) => (
          <li key={t.id} className="rounded-warm-lg border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text-primary">{t.label}</h3>
                <p className="mt-0.5 text-xs text-text-muted">{t.hint}</p>
              </div>
              <button
                type="button"
                onClick={() => copy(t.id, t.text)}
                className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-text-primary hover:bg-background"
              >
                {copiedId === t.id ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 whitespace-pre-line break-words text-sm text-text-secondary" data-testid={`share-text-${t.id}`}>
              {t.text}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
