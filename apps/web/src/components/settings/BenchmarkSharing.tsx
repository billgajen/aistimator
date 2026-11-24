'use client'

import { useState } from 'react'
import { BENCHMARK_SHARING_COPY } from '@qolumns/shared'

/**
 * T-201: Settings → Business → "Market benchmarks". One switch: share this
 * business's rates, without its name, in the benchmarks on Analytics. On for a
 * new business. Off means nothing of this business is in anyone's benchmark,
 * and (the T-115 rule: you see them only while you share) it sees none.
 * Saved at once, like a switch.
 */
export function BenchmarkSharing({ initial }: { initial: boolean }) {
  const C = BENCHMARK_SHARING_COPY
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function change(next: boolean) {
    setSaving(true)
    setMessage(null)
    setOn(next)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benchmarksOptIn: next }),
      })
      if (!res.ok) throw new Error('not saved')
      setMessage({ ok: true, text: next ? C.savedOn : C.savedOff })
    } catch {
      setOn(!next)
      setMessage({ ok: false, text: C.failed })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-surface p-6 shadow-warm" data-testid="benchmark-sharing">
      <h2 className="text-lg font-medium text-text-primary">{C.title}</h2>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={saving}
          onChange={(e) => void change(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded-sm border-border text-primary"
          data-testid="benchmark-sharing-switch"
        />
        <span>
          <span className="block text-sm font-medium text-text-secondary">{C.label}</span>
          <span className="mt-0.5 block text-xs text-text-muted">{C.whatIsShared}</span>
        </span>
      </label>
      {message && (
        <p className={`mt-3 text-sm ${message.ok ? 'text-secondary' : 'text-danger'}`} role="status" data-testid="benchmark-sharing-message">
          {message.text}
        </p>
      )}
    </div>
  )
}
