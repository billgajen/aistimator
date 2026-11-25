'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { DASHBOARD_CHANGED_EVENT, PULSE_INTERVAL_MS, PULSE_RETRY_MS, type PulseAnswer } from '@/lib/dashboard-pulse'

/**
 * T-204: the dashboard's pulse. Mounted once, in the dashboard's layout.
 *
 * While the tab is on screen it asks `/api/quotes/pulse` every few seconds,
 * the first time as soon as it is mounted. The first answer is only
 * remembered. When a later answer carries another stamp, it tells the page
 * (`DASHBOARD_CHANGED_EVENT`); the page decides what to read again. A hidden
 * tab asks nothing, and asks at once when it is shown again. A failed ask is
 * quiet and is tried again less often.
 *
 * A tab that was hidden before it had its first answer (opened in the
 * background, or left within a moment) has nothing to compare with when it is
 * shown, and what it drew may be old by then. So its first answer counts as a
 * change: the page reads itself once, and compares from there.
 *
 * `onCount` is given the menu badge's number with every answer.
 */
export function useDashboardPulse(onCount?: (newUnfinished: number) => void): void {
  const report = useRef(onCount)
  report.current = onCount

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let asking = false
    let last: string | null = null
    // an ask fell due while the tab was hidden and there was still no stamp to compare with
    let missedFirst = false

    const schedule = (ms: number) => {
      if (timer !== undefined) clearTimeout(timer)
      if (!stopped) timer = setTimeout(ask, ms)
    }

    async function ask() {
      if (stopped || asking) return
      if (document.visibilityState !== 'visible') {
        if (last === null) missedFirst = true
        return // asked again when the tab is shown
      }
      asking = true
      let wait = PULSE_INTERVAL_MS
      try {
        const response = await fetch('/api/quotes/pulse', { cache: 'no-store' })
        if (!response.ok) throw new Error(String(response.status))
        const answer = (await response.json()) as PulseAnswer
        if (stopped) return
        if (typeof answer.newUnfinished === 'number') report.current?.(answer.newUnfinished)
        if (typeof answer.stamp === 'string') {
          if (last === null ? missedFirst : answer.stamp !== last) window.dispatchEvent(new Event(DASHBOARD_CHANGED_EVENT))
          last = answer.stamp
        }
      } catch {
        wait = PULSE_RETRY_MS
      } finally {
        asking = false
        schedule(wait)
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule(0)
    }
    document.addEventListener('visibilitychange', onVisible)
    // at once: the stamp to compare with is taken as close to the page's own read as can be
    schedule(0)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}

/** Run `onChange` when the pulse says this business's data changed */
export function useDashboardChanged(onChange: () => void): void {
  const run = useRef(onChange)
  run.current = onChange
  useEffect(() => {
    const listener = () => run.current()
    window.addEventListener(DASHBOARD_CHANGED_EVENT, listener)
    return () => window.removeEventListener(DASHBOARD_CHANGED_EVENT, listener)
  }, [])
}

/**
 * For a page the server draws (Home): read it again when something changed.
 * `router.refresh()` keeps the scroll position and the state of every client
 * component on the page; only the server's part is drawn again.
 */
export function RefreshOnChange() {
  const router = useRouter()
  useDashboardChanged(() => router.refresh())
  return null
}
