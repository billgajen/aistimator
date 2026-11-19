'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { QuotePhoto } from '@qolumns/shared'
import { UNDERSTOOD_COPY } from '@/lib/quote-understanding'

/**
 * T-169: the photos the customer sent, on the dashboard quote page.
 *
 * Small pictures that open larger. Each small picture is a button with a
 * name ("Photo 2 of 3. Open larger."), so it works from the keyboard and a
 * screen reader. The larger view is the browser's own modal dialog: focus
 * moves into it and stays there, Escape closes it, and focus goes back to
 * the picture that opened it. The arrow keys and the two buttons move
 * between photos. Nothing animates (system.md: the dashboard has feedback
 * only).
 *
 * A photo's address is a path on our own site that needs the business's
 * sign-in (lib/quote-photos.ts); a storage address never reaches the page.
 */
export function CustomerPhotos({
  photos,
  customerName,
  title = UNDERSTOOD_COPY.photoStripTitle,
  ownPhotos = false,
}: {
  photos: QuotePhoto[]
  customerName: string
  /** The strip's heading (T-186: on a quote the business made, the photos are its own) */
  title?: string
  /** The business took these photos itself: they are not described as sent by the customer */
  ownPhotos?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const count = photos.length

  const show = (index: number) => {
    setOpen(index)
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
  }
  const close = () => dialog.current?.close()
  const step = useCallback((by: number) => setOpen((i) => (i === null ? i : (i + by + count) % count)), [count])

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [step])

  if (count === 0) return null
  const current = open === null ? null : photos[open] ?? null
  const BUTTON =
    'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-field bg-white px-4 text-sm font-semibold text-text-primary hover:bg-surface disabled:opacity-50'

  return (
    <div data-testid="customer-photos">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
        {title} <span className="figure">({count})</span>
      </h3>
      <ul className="mt-3 flex flex-wrap gap-2">
        {photos.map((photo, i) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => show(i)}
              aria-label={`Photo ${i + 1} of ${count}. Open larger.`}
              className="motion-press block h-20 w-20 overflow-hidden rounded-lg border border-border-strong bg-surface sm:h-24 sm:w-24"
              data-testid="customer-photo"
            >
              {failed[photo.id] ? (
                <span className="flex h-full w-full items-center justify-center px-1 text-center text-xs text-text-muted">Could not load</span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a private upload behind a signed redirect; the image optimiser cannot sign in
                <img
                  src={photo.smallUrl ?? photo.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={() => setFailed((f) => ({ ...f, [photo.id]: true }))}
                />
              )}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        aria-label={ownPhotos ? title : `Photos from ${customerName}`}
        className="photo-viewer w-[min(64rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-white p-3 shadow-warm-lg sm:p-4"
        onClose={() => setOpen(null)}
        onClick={(e) => {
          // a click on the dimmed area around the picture closes it
          if (e.target === dialog.current) close()
        }}
        data-testid="photo-viewer"
      >
        {current && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text-primary" aria-live="polite" data-testid="photo-viewer-count">
                Photo <span className="figure">{(open ?? 0) + 1}</span> of <span className="figure">{count}</span>
              </p>
              <button type="button" onClick={close} className={BUTTON} data-testid="photo-viewer-close">
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
            <img
              src={current.url}
              alt={`Photo ${(open ?? 0) + 1} of ${count}${ownPhotos ? '' : ` sent by ${customerName}`}`}
              className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg bg-surface object-contain"
              data-testid="photo-viewer-image"
            />
            {count > 1 && (
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => step(-1)} className={BUTTON} data-testid="photo-viewer-previous">
                  Previous photo
                </button>
                <button type="button" onClick={() => step(1)} className={BUTTON} data-testid="photo-viewer-next">
                  Next photo
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </div>
  )
}

/**
 * One small photo on a list row (Home's "Waiting for you", the quotes list).
 * It is there to recognise the job by; the row's own link opens the quote.
 * Hidden if it cannot be loaded.
 */
export function QuoteThumb({ url, customerName }: { url: string; customerName: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private upload behind a signed redirect
    <img
      src={url}
      alt={`Photo sent by ${customerName}`}
      width={48}
      height={48}
      loading="lazy"
      decoding="async"
      className="h-12 w-12 shrink-0 rounded-lg border border-border-strong bg-surface object-cover"
      onError={() => setFailed(true)}
      data-testid="quote-thumb"
    />
  )
}
