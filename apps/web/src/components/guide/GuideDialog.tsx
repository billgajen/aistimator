'use client'

import { useId, useRef, type RefObject } from 'react'
import { GUIDE_COPY, type Guide, type GuideSource } from '@/lib/guides'
import { pressClosesWindow } from './control'

/**
 * T-207, T-208: the window a guide plays in. There is one, for the dashboard,
 * the support page and the marketing home page.
 *
 * The browser's own modal dialog, as the customer photo viewer is (T-169): the
 * browser keeps the focus inside it, Escape closes it, and the page behind
 * cannot be reached while it is open. Nothing animates.
 *
 * T-208: the page behind goes dark and the video is as large as fits, in the
 * middle (globals.css sizes the window and stops the page scrolling behind
 * it). Over the video: the guide's title and a ✕. It closes on the ✕, on
 * Escape, and on a press anywhere that is not the video.
 *
 * `source` is the video to play: null while the window is closed, so a closed
 * guide loads nothing (no video, no poster). `preload="none"` keeps even an
 * open one from loading until it is played. It never starts by itself: the
 * button that opened the window starts it from inside its own press.
 *
 * The voiceover's words are in the window for a screen reader only (the
 * captions are part of the picture): nothing of them is drawn.
 */
export function GuideDialog({
  guide,
  source,
  dialogRef,
  videoRef,
  onClosed,
  onProgress,
}: {
  guide: Guide
  /** The video this screen plays (`sourceFor`), or null while the window is closed */
  source: GuideSource | null
  dialogRef: RefObject<HTMLDialogElement>
  videoRef: RefObject<HTMLVideoElement>
  /** The window has closed, however it was closed */
  onClosed: () => void
  onProgress?: (currentTime: number, duration: number) => void
}) {
  const titleId = useId()
  const wordsId = useId()
  // where the press that is ending began: a drag of the video's own slider can end off the video
  const began = useRef<EventTarget | null>(null)
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={wordsId}
      className="guide-dialog"
      onClose={onClosed}
      onPointerDown={(e) => {
        began.current = e.target
      }}
      onClick={(e) => {
        if (pressClosesWindow(began.current as Element | null, e.target as Element)) e.currentTarget.close()
        began.current = null
      }}
      data-testid="guide-dialog"
      data-guide={guide.id}
    >
      {source && (
        <div className="flex h-full w-full items-center justify-center p-2 [--guide-chrome:4.25rem] sm:p-6 sm:[--guide-chrome:6.25rem]">
          {/* as wide as fits: the screen's width, or the width at which the video's height fits, and never larger than the video itself */}
          <div
            className="flex flex-col gap-2 text-left"
            style={{ width: `min(100%, calc((100dvh - var(--guide-chrome)) * ${source.width} / ${source.height}), ${source.width}px)` }}
            data-testid="guide-frame"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={titleId} className="min-w-0 truncate font-display text-base font-bold text-white">
                {guide.title}
              </h2>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label={GUIDE_COPY.close}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink hover:bg-surface"
                data-testid="guide-close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <video
              ref={videoRef}
              controls
              playsInline
              preload="none"
              poster={source.poster}
              src={source.src}
              width={source.width}
              height={source.height}
              aria-label={guide.title}
              className="block h-auto w-full rounded-xl bg-ink"
              style={{ aspectRatio: `${source.width} / ${source.height}` }}
              onTimeUpdate={(e) => onProgress?.(e.currentTarget.currentTime, e.currentTarget.duration)}
              data-testid="guide-video"
            />
            <div id={wordsId} className="sr-only" data-testid="guide-words">
              {guide.transcript.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </dialog>
  )
}
