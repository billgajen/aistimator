'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { TRY_IT_COPY } from '@/lib/try-it-copy'

/**
 * T-202: "Delete this test" on a test estimate's own page. It asks first and
 * says exactly what goes (the pattern of "Regenerate" on Services, T-201);
 * "Cancel" changes nothing. The server deletes only a test of this business
 * (DELETE /api/quotes/:id); afterwards the business is back on its quote list.
 */
export function DeleteTestEstimate({ quoteId }: { quoteId: string }) {
  const D = TRY_IT_COPY.delete
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setDeleting(true)
    setError(null)
    try {
      const response = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}`, { method: 'DELETE' })
      const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!response.ok) {
        setError(json?.error?.message || D.failed)
        return
      }
      router.push('/app/quotes')
      router.refresh()
    } catch {
      setError(D.failed)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mb-6" data-testid="delete-test">
      {!asking && (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface"
          data-testid="delete-test-button"
        >
          {D.button}
        </button>
      )}
      {asking && (
        <div className="rounded-lg border border-border-strong bg-background p-4" role="alertdialog" aria-labelledby="delete-test-title" data-testid="delete-test-confirm">
          <h2 id="delete-test-title" className="text-sm font-bold text-text-primary">
            {D.title}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{D.body}</p>
          <p className="mt-1 text-sm text-text-secondary">{D.counted}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-danger px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
              data-testid="delete-test-yes"
            >
              {deleting ? D.deleting : D.confirm}
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false)
                setError(null)
              }}
              disabled={deleting}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-field bg-background px-4 text-sm font-semibold text-text-primary transition-colors hover:bg-surface disabled:opacity-50"
              data-testid="delete-test-cancel"
            >
              {D.cancel}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
