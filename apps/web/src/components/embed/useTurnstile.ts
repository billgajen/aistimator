'use client'

import { useCallback, useRef } from 'react'

/**
 * Invisible-by-default Cloudflare Turnstile integration for the embed widget.
 *
 * Render the returned container div where a challenge may appear (it stays
 * empty for legitimate visitors — appearance is interaction-only). getToken()
 * resolves with a fresh single-use token, or null when Turnstile is not
 * configured, blocked, slow or unreachable. A request sent with no token goes
 * ahead on the server (lib/turnstile.ts, AD-060).
 *
 * T-178: the form never waits on Cloudflare for long. The script is given 4
 * seconds to load (it used to be waited for with no limit, so a blocked or
 * stalled script left the customer on "Sending…" for ever), and a token 8
 * seconds to arrive. The one exception is a challenge the person has been
 * asked to answer: while it is on screen they get 90 seconds.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
/** How long the script may take to load before the request is sent without a token */
export const SCRIPT_TIMEOUT_MS = 4_000
/** How long a token may take when nothing is asked of the person */
export const TOKEN_TIMEOUT_MS = 8_000
/** How long the person has once Cloudflare shows them a challenge to answer */
export const CHALLENGE_TIMEOUT_MS = 90_000

let scriptPromise: Promise<TurnstileApi | null> | null = null

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      // a script that is blocked without an error, or stalls, must not hold the form
      const timer = setTimeout(() => resolve(null), SCRIPT_TIMEOUT_MS)
      script.onload = () => {
        clearTimeout(timer)
        resolve(window.turnstile ?? null)
      }
      script.onerror = () => {
        clearTimeout(timer)
        resolve(null)
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

export function useTurnstile(siteKey: string | undefined) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  // The widget's callbacks are bound once at render time, so they must
  // dispatch through this ref to reach whichever getToken call is in flight.
  const pendingRef = useRef<((token: string | null) => void) | null>(null)
  // Called when Cloudflare puts a challenge on screen: the call in flight is given longer
  const challengeRef = useRef<(() => void) | null>(null)

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!siteKey || !containerRef.current) return null
    const turnstile = await loadTurnstile()
    if (!turnstile || !containerRef.current) return null

    return new Promise<string | null>((resolve) => {
      // A newer call supersedes any in-flight one
      pendingRef.current?.(null)

      let done = false
      const finish = (token: string | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (pendingRef.current === finish) pendingRef.current = null
        resolve(token)
      }
      let timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS)
      pendingRef.current = finish
      challengeRef.current = () => {
        if (done) return
        clearTimeout(timer)
        timer = setTimeout(() => finish(null), CHALLENGE_TIMEOUT_MS)
      }

      try {
        if (widgetIdRef.current === null) {
          widgetIdRef.current = turnstile.render(containerRef.current as HTMLElement, {
            sitekey: siteKey,
            execution: 'execute',
            appearance: 'interaction-only',
            callback: (token: string) => pendingRef.current?.(token),
            'error-callback': () => pendingRef.current?.(null),
            'timeout-callback': () => pendingRef.current?.(null),
            'unsupported-callback': () => pendingRef.current?.(null),
            'before-interactive-callback': () => challengeRef.current?.(),
          })
        } else {
          // Tokens are single-use: reset before re-executing
          turnstile.reset(widgetIdRef.current)
        }
        turnstile.execute(widgetIdRef.current)
      } catch {
        finish(null)
      }
    })
  }, [siteKey])

  return { containerRef, getToken }
}
