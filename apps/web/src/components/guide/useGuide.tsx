'use client'

import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { UPRIGHT_QUERY, guide as guideOf, sourceFor, type GuideId, type GuideSource } from '@/lib/guides'
import { guideClosed, openGuide } from './control'
import { GuideDialog } from './GuideDialog'

/**
 * T-208: what every button that opens a guide shares: the one window
 * (GuideDialog), opening it, and closing it.
 *
 * - `show` belongs on the button's own `onClick`. It puts the video in the
 *   page at once and starts it before the press is over, which is what lets a
 *   browser play it with sound. Nothing else starts a video.
 * - The video is chosen at the press: the upright one on a narrow screen, for
 *   a guide that has one (the hero); the wide one otherwise.
 * - When the window closes the video stops and the focus goes back to the
 *   button (`opener`).
 *
 * `dialog` is the closed window: draw it straight after the button.
 */
export function useGuide(id: GuideId, on: { progress?: (currentTime: number, duration: number) => void; closed?: () => void } = {}) {
  const guide = guideOf(id)
  const [source, setSource] = useState<GuideSource | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)

  const show = () => {
    const playing = sourceFor(guide, window.matchMedia(UPRIGHT_QUERY).matches)
    // the video is put in the page now, inside the press, so it can be started inside the press too
    flushSync(() => setSource(playing))
    openGuide(dialog.current, video.current)
  }

  return {
    guide,
    opener,
    show,
    dialog: (
      <GuideDialog
        guide={guide}
        source={source}
        dialogRef={dialog}
        videoRef={video}
        onProgress={on.progress}
        onClosed={() => {
          guideClosed(video.current, opener.current, on.closed)
          setSource(null)
        }}
      />
    ),
  }
}
