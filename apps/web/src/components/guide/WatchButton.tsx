'use client'

import { GUIDE_COPY, type GuideId } from '@/lib/guides'
import { WATCH_BUTTON } from '@/lib/marketing/cta'
import { useGuide } from './useGuide'

/**
 * T-208: a marketing page's video button, "See how it works · 33 s".
 *
 * Words with a play mark and no ground of its own: quieter than the buttons
 * it sits beside. It opens the guide in the same window as the dashboard's
 * "Watch how" link, and the video starts inside the press, with sound. The
 * length comes from the one list (lib/guides.ts); the page gives the words.
 *
 * Unlike the dashboard's link it remembers nothing: a visitor's browser is
 * left alone.
 *
 * It is a button followed by a (closed) dialog, so it belongs in a row or a
 * block, never inside a paragraph.
 */
export function WatchButton({ id, words, className = '' }: { id: GuideId; words: string; className?: string }) {
  const { guide, opener, show, dialog } = useGuide(id)
  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={show}
        aria-label={GUIDE_COPY.buttonLabel(words, guide)}
        aria-haspopup="dialog"
        className={`${WATCH_BUTTON} ${className}`}
        data-testid={`watch-${id}`}
      >
        <svg className="h-3.5 w-3.5 shrink-0 text-primary" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M2.5 1.6c0-.6.6-.9 1.1-.6l6.6 4.4c.4.3.4.9 0 1.2L3.6 11c-.5.3-1.1 0-1.1-.6V1.6z" />
        </svg>
        <span className="group-hover:underline group-hover:underline-offset-4">{words}</span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="figure">{guide.seconds}</span> s
        </span>
      </button>
      {dialog}
    </>
  )
}
