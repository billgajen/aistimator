'use client'

import { useCallback, useRef } from 'react'

/**
 * Invisible-by-default Cloudflare Turnstile integration for the embed widget.
 *
 * Render the returned container div where a challenge may appear (it stays
 * empty for legitimate visitors — appearance is interaction-only). getToken()
 * resolves with a fresh single-use token, or null when Turnstile is not
 * configured or unreachable; the server fails open on null in that case too.
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
const TOKEN_TIMEOUT_MS = 90_000

let scriptPromise: Promise<TurnstileApi | null> | null = null

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => resolve(window.turnstile ?? null)
      script.onerror = () => resolve(null)
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
      const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS)
      pendingRef.current = finish

      try {
        if (widgetIdRef.current === null) {
          widgetIdRef.current = turnstile.render(containerRef.current as HTMLElement, {
            sitekey: siteKey,
            execution: 'execute',
            appearance: 'interaction-only',
            callback: (token: string) => pendingRef.current?.(token),
            'error-callback': () => pendingRef.current?.(null),
            'timeout-callback': () => pendingRef.current?.(null),
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
