'use client'

import { useCallback, useState } from 'react'

/**
 * Copy text, show "Copied" briefly, and tell the server the link was shared
 * (T-149 home checklist). The share event is best-effort.
 */
export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = useCallback(async (id: string, text: string, { shareEvent = true } = {}) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000)
    if (shareEvent) {
      fetch('/api/tenant/share-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'copied' }),
      }).catch(() => undefined)
    }
    return true
  }, [])
  return { copy, copiedId }
}
