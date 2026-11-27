'use client'

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { GUIDE_COPY, guide, type Guide, type GuideSource } from '@/lib/guides'
import { GuideTranscript } from './GuideDialog'

/** The width at which the wide video takes over from the upright one (Tailwind's `sm`) */
const WIDE_FROM = '(min-width: 640px)'

/**
 * T-207: the hero video on the marketing home page.
 *
 * A poster with a large play button. It plays, with sound, when it is
 * pressed, and never by itself. There are two of it: the wide video from
 * 640 px, the upright one under that, and CSS decides which is shown. Only
 * the one on screen loads anything: the hidden one's poster is a lazy image
 * that is never laid out, and a video is not in the page until its button is
 * pressed (and then with `preload="none"`).
 *
 * The voiceover is written out under it, closed until asked for.
 */
export function HeroVideo() {
  const hero = guide('hero')
  return (
    <div data-testid="hero-video">
      {hero.tall && (
        <div className="mx-auto max-w-[20rem] sm:hidden" data-testid="hero-video-tall">
          <Player hero={hero} source={hero.tall} />
        </div>
      )}
      <div className="hidden max-w-2xl sm:block" data-testid="hero-video-wide">
        <Player hero={hero} source={hero} />
      </div>
      <GuideTranscript lines={hero.transcript} className="mx-auto mt-3 max-w-[20rem] sm:mx-0 sm:max-w-2xl" />
    </div>
  )
}

function Player({ hero, source }: { hero: Guide; source: GuideSource }) {
  const [started, setStarted] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  // Turning a phone, or resizing the window, swaps which of the two is shown: one that is no longer shown stops
  useEffect(() => {
    if (!started) return
    const query = window.matchMedia(WIDE_FROM)
    const stop = () => video.current?.pause()
    query.addEventListener('change', stop)
    return () => query.removeEventListener('change', stop)
  }, [started])

  const play = () => {
    // the video is put in the page inside the press, and started inside it, so it may play with sound
    flushSync(() => setStarted(true))
    const el = video.current
    if (!el) return
    el.focus()
    try {
      const starting = el.play()
      if (starting && typeof starting.catch === 'function') starting.catch(() => undefined)
    } catch {
      // the controls are there
    }
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border-strong bg-white shadow-warm-lg"
      style={{ aspectRatio: `${source.width} / ${source.height}` }}
    >
      {started ? (
        <video
          ref={video}
          controls
          playsInline
          preload="none"
          poster={source.poster}
          src={source.src}
          width={source.width}
          height={source.height}
          aria-label={hero.title}
          className="block h-full w-full bg-surface"
        />
      ) : (
        <button type="button" onClick={play} aria-label={GUIDE_COPY.play(hero)} className="group absolute inset-0 block h-full w-full" data-testid="hero-video-play">
          {/* eslint-disable-next-line @next/next/no-img-element -- the video's own poster frame, the same file the video then shows; lazy, so the one that is not on screen is never fetched */}
          <img src={source.poster} alt="" width={source.width} height={source.height} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="motion-press flex h-20 w-20 items-center justify-center rounded-full border border-ink bg-white text-ink shadow-warm-lg group-hover:bg-surface">
              <svg className="ml-1 h-9 w-9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.6c0-.8.9-1.3 1.5-.8l9 6.4c.6.4.6 1.2 0 1.6l-9 6.4c-.6.5-1.5 0-1.5-.8V5.6z" />
              </svg>
            </span>
          </span>
        </button>
      )}
    </div>
  )
}
