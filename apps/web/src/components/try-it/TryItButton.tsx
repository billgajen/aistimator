'use client'

import Link from 'next/link'
import { useState } from 'react'
import { TRY_IT_COPY, TRY_IT_PATH } from '@/lib/try-it-copy'
import { LimitLine } from './LimitLine'

type Stop = { reason: 'limit'; availableAt: string | null } | { reason: 'no_service' } | { reason: 'error' }

/**
 * T-202: the one "Try it yourself" button (setup's last step and Home). It
 * asks the server first whether a test can be started (one of the day's five
 * left, a service switched on), so the limit is said before a form is filled
 * in; then it opens the business's own request form in test mode in a new tab
 * (/app/try-it, inside the signed-in dashboard: the address carries nothing).
 */
export function TryItButton({
  label = TRY_IT_COPY.button,
  onStarted,
  className = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50',
}: {
  label?: string
  /** told the server's time when the test page was opened (to look for the test request from then on) */
  onStarted?: (sinceIso: string) => void
  className?: string
}) {
  const [opening, setOpening] = useState(false)
  const [stop, setStop] = useState<Stop | null>(null)

  async function start() {
    setOpening(true)
    setStop(null)
    // Open the tab first (inside the click), so pop-up blockers allow it
    const tab = window.open('about:blank', '_blank')
    try {
      const response = await fetch('/api/test-estimates', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as { canStart?: boolean; reason?: string | null; availableAt?: string | null; url?: string; now?: string } | null
      if (!response.ok || !json) throw new Error('not started')
      if (!json.canStart) {
        tab?.close()
        setStop(json.reason === 'no_service' ? { reason: 'no_service' } : { reason: 'limit', availableAt: json.availableAt ?? null })
        return
      }
      const url = json.url || TRY_IT_PATH
      if (tab) tab.location.href = url
      else window.location.assign(url)
      onStarted?.(json.now ?? new Date().toISOString())
    } catch {
      tab?.close()
      setStop({ reason: 'error' })
    } finally {
      setOpening(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={start} disabled={opening} className={className} data-testid="try-it-button">
        {opening ? TRY_IT_COPY.opening : label}
      </button>
      {stop?.reason === 'limit' && <LimitLine availableAt={stop.availableAt} className="mt-3 text-sm text-text-secondary" />}
      {stop?.reason === 'no_service' && (
        <p className="mt-3 text-sm text-text-secondary" role="status" data-testid="try-it-no-service">
          {TRY_IT_COPY.noService}{' '}
          <Link href="/app/services" className="font-semibold text-primary underline underline-offset-2">
            {TRY_IT_COPY.noServiceLink}
          </Link>
        </p>
      )}
      {stop?.reason === 'error' && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {TRY_IT_COPY.notStarted}
        </p>
      )}
    </div>
  )
}
