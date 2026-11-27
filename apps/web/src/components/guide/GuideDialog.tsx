'use client'

import { useId, type RefObject } from 'react'
import { GUIDE_COPY, type Guide } from '@/lib/guides'

/**
 * T-207: the window a guide plays in.
 *
 * The browser's own modal dialog, as the customer photo viewer is (T-169): the
 * browser keeps the focus inside it, Escape closes it, and the page behind
 * cannot be reached while it is open. Nothing animates (system.md: the
 * dashboard has feedback only).
 *
 * The video is only in the page while the window is open, so a closed guide
 * loads nothing: no video, no poster. `preload="none"` keeps even an open one
 * from loading until it is played. It never starts by itself: GuideLink starts
 * it from inside the press that opened the window.
 */
export function GuideDialog({
  guide,
  open,
  dialogRef,
  videoRef,
  onClosed,
  onProgress,
}: {
  guide: Guide
  open: boolean
  dialogRef: RefObject<HTMLDialogElement>
  videoRef: RefObject<HTMLVideoElement>
  /** The window has closed, however it was closed */
  onClosed: () => void
  onProgress: (currentTime: number, duration: number) => void
}) {
  const titleId = useId()
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="guide-dialog w-[min(56rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-white p-0 shadow-warm-lg"
      onClose={onClosed}
      onClick={(e) => {
        // a click on the dimmed page around the window closes it (the window's own content fills its box)
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
      data-testid="guide-dialog"
      data-guide={guide.id}
    >
      {open && (
        <div className="flex flex-col gap-3 p-3 text-left sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="min-w-0 font-display text-lg font-bold text-text-primary">
              {guide.title}
            </h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-field bg-white px-4 text-sm font-semibold text-text-primary hover:bg-surface"
              data-testid="guide-close"
            >
              {GUIDE_COPY.close}
            </button>
          </div>
          <video
            ref={videoRef}
            controls
            playsInline
            preload="none"
            poster={guide.poster}
            src={guide.src}
            width={guide.width}
            height={guide.height}
            aria-label={guide.title}
            className="mx-auto block h-auto max-h-[70dvh] w-full rounded-lg bg-surface"
            onTimeUpdate={(e) => onProgress(e.currentTarget.currentTime, e.currentTarget.duration)}
            data-testid="guide-video"
          />
          <GuideTranscript lines={guide.transcript} />
        </div>
      )}
    </dialog>
  )
}

/** The voiceover in words, closed until asked for */
export function GuideTranscript({ lines, className = '' }: { lines: readonly string[]; className?: string }) {
  return (
    <details className={`group rounded-lg border border-border bg-white ${className}`} data-testid="guide-transcript">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
        <svg className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {GUIDE_COPY.transcript}
      </summary>
      <div className="space-y-2 px-3 pb-3 text-sm leading-relaxed text-text-secondary">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </details>
  )
}
