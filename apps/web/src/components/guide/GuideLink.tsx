'use client'

import { GUIDE_COPY, watchedEnough, watchedKey, type GuideId } from '@/lib/guides'
import { remember, useRemembered } from './memory'
import { useGuide } from './useGuide'

/**
 * T-207: "Watch how · 32 s", the quiet link that opens a guide's video.
 *
 * It takes the guide's id and nothing else: the title, the length and the
 * file come from the one list (lib/guides.ts). The window, and opening and
 * closing it, are `useGuide`'s (T-208), shared with the marketing pages'
 * video buttons.
 *
 * - Pressing it opens the window and starts the video, with sound: the press
 *   is the person's own action, which is what lets a browser play sound.
 *   Nothing in the dashboard plays by itself.
 * - Once the guide has been watched past four fifths, or its window closed,
 *   this browser remembers it and the link carries a small tick. Nothing else
 *   changes: the link still opens the guide.
 * - When the window closes the video stops and the focus comes back here.
 *
 * It is a button followed by a (closed) dialog, so it belongs in a row or a
 * block, never inside a paragraph.
 */
export function GuideLink({ id }: { id: GuideId }) {
  const key = watchedKey(id)
  const watched = useRemembered(key)
  const { guide, opener, show, dialog } = useGuide(id, {
    progress: (currentTime, duration) => {
      if (watchedEnough(currentTime, duration)) remember(key)
    },
    closed: () => remember(key),
  })

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={show}
        aria-label={GUIDE_COPY.linkLabel(guide, watched)}
        aria-haspopup="dialog"
        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md text-sm font-semibold text-primary hover:underline sm:min-h-[24px]"
        data-testid={`guide-link-${id}`}
        data-watched={watched ? 'true' : 'false'}
      >
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM8 6.6c0-.5.5-.8.9-.5l5 3.4c.4.2.4.8 0 1l-5 3.4c-.4.3-.9 0-.9-.5V6.6z" />
        </svg>
        <span>{GUIDE_COPY.watch}</span>
        <span aria-hidden="true">·</span>
        <span>
          <span className="figure">{guide.seconds}</span> s
        </span>
        {watched && (
          <svg className="h-4 w-4 shrink-0 text-secondary" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" data-testid="guide-watched">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      {dialog}
    </>
  )
}
