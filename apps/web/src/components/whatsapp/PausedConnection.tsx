'use client'

import { useState } from 'react'
import { PRODUCT_NAME } from '@qolumns/shared'
import type { ConnectionView } from '@/lib/whatsapp-state'

const quiet = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50'

/**
 * T-177: a number that was connected before the plan stopped including
 * WhatsApp. It is kept, and silent. The only thing to do here is disconnect
 * it; choosing a plan with WhatsApp brings the assistant back as it was.
 */
export function PausedConnection({ config, onDisconnected }: { config: ConnectionView; onDisconnected: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function disconnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      onDisconnected()
    } catch {
      setError('Could not disconnect. Try again.')
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl bg-surface p-6 shadow-warm" data-testid="whatsapp-paused-connection">
      <p className="text-sm font-semibold text-text-secondary">Connected, paused</p>
      <h2 className="mt-1 font-display text-2xl font-bold text-text-primary">{config.displayPhoneNumber}</h2>
      <p className="mt-1 max-w-2xl text-sm text-text-secondary">
        Your number stays connected, and {PRODUCT_NAME} sends nothing from it while it is paused. Your chats and your WhatsApp account are as they were.
      </p>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className={`mt-4 ${quiet}`} data-testid="disconnect">
          Disconnect WhatsApp
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="disconnect-confirm">
          <button type="button" onClick={disconnect} disabled={busy} className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? 'Disconnecting…' : 'Yes, disconnect'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={quiet}>
            Keep it connected
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
