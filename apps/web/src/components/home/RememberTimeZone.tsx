'use client'

import { useEffect } from 'react'

/**
 * T-196: tells the server the browser's time zone, once, when the business
 * has none yet. Draws nothing. The month on Home is then counted from the
 * business's own midnight; until then its region's time zone is used.
 */
export function RememberTimeZone() {
  useEffect(() => {
    let timeZone: string | undefined
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      timeZone = undefined
    }
    if (!timeZone) return
    void fetch('/api/tenant/time-zone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone }) }).catch(() => undefined)
  }, [])
  return null
}
