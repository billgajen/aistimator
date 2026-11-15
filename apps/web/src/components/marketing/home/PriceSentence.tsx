'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * T-165: the home page's one extra moment (system.md, Motion). A plain-English
 * price sentence, and the price list it becomes: each phrase is marked in
 * turn and its line lands beside it.
 *
 * The sentence and the finished list are on the page from the first paint.
 * Only when script runs, motion is allowed and the section is still below the
 * screen do the lines wait, and they land once when the section comes into
 * view. "Show it again" plays it once more. CSS only (demo-in, --at).
 */
export interface PriceSentencePart {
  words: string
  line: { label: string; amount: string }
}

export function PriceSentence({ lead, parts, listTitle, replay }: { lead: string; parts: readonly PriceSentencePart[]; listTitle: string; replay: string }) {
  const root = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'still' | 'waiting' | 'playing'>('still')
  const [run, setRun] = useState(0)

  useEffect(() => {
    const el = root.current
    if (!el || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // already on screen at load: leave it still (nothing may vanish in front of the reader)
    if (el.getBoundingClientRect().top < window.innerHeight) return
    setState('waiting')
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState('playing')
          seen.disconnect()
        }
      },
      { threshold: 0.45 }
    )
    seen.observe(el)
    return () => seen.disconnect()
  }, [])

  const playing = state === 'playing'
  const at = (ms: number): CSSProperties => ({ '--at': `${ms}ms` } as CSSProperties)

  return (
    <div ref={root} data-moment={state} data-testid="price-sentence" className="mx-auto max-w-3xl text-center">
      {/* One centred column: the sentence, the tape rule, then the list it becomes */}
      <div>
        <p className="text-sm font-medium text-text-secondary">{lead}</p>
        <p className="mt-3 font-display text-2xl font-bold leading-snug text-text-primary sm:text-4xl" data-testid="price-sentence-words">
          “
          {parts.map((part, i) => (
            <span key={part.words}>
              <span key={`${run}-${i}`} className={`rounded-md px-1 ${playing ? 'demo-in' : ''} bg-white`} style={at(i * 700)}>
                {part.words}
              </span>{' '}
            </span>
          ))}
          ”
        </p>
      </div>
      <div className="mx-auto mt-8 max-w-xl rounded-2xl bg-white p-6 text-left shadow-warm-md">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{listTitle}</p>
        <ul className="mt-4 space-y-3" data-testid="price-lines">
          {parts.map((part, i) => (
            <li key={`${run}-${part.line.label}`} className={`moment-line flex items-baseline gap-2 text-base ${playing ? 'demo-in' : ''}`} style={at(i * 700 + 300)}>
              <span className="text-text-primary">{part.line.label}</span>
              <span className="flex-1 translate-y-[-3px] border-b border-dotted border-border-strong" />
              <span className="figure whitespace-nowrap text-text-primary">{part.line.amount}</span>
            </li>
          ))}
        </ul>
        <div className="tape-rule mt-5" aria-hidden="true" />
        <button
          type="button"
          onClick={() => {
            setState('playing')
            setRun((n) => n + 1)
          }}
          className="motion-press mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary"
          data-testid="price-sentence-replay"
        >
          {replay}
        </button>
      </div>
    </div>
  )
}
