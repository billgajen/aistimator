'use client'

/**
 * Record what the job was finally invoiced at (T-143). This is the ground
 * truth the accuracy report compares every estimate against.
 */
import { useState } from 'react'
import { formatMoney, parseMoneyInput } from '@estimator/shared'

export function FinalInvoiceCard(props: {
  quoteId: string
  currency: string
  quotedTotal: number
  initialAmount: number | null
  initialNote: string | null
  recordedAt: string | null
}) {
  const [amount, setAmount] = useState(props.initialAmount !== null ? String(props.initialAmount) : '')
  const [note, setNote] = useState(props.initialNote ?? '')
  const [saved, setSaved] = useState<{ amount: number; at: string } | null>(
    props.initialAmount !== null && props.recordedAt ? { amount: props.initialAmount, at: props.recordedAt } : null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseMoneyInput(amount)
  const diff = saved && props.quotedTotal > 0 ? (saved.amount - props.quotedTotal) / props.quotedTotal : null

  async function save() {
    if (parsed === null) {
      setError('Enter the invoiced amount, e.g. 2450 or 2,450.00')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${props.quoteId}/final-invoice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parsed, note: note.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error?.message || 'Could not save')
      setSaved({ amount: json.finalInvoiceAmount, at: json.finalInvoiceRecordedAt })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-6 bg-surface border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-1">Final invoice</h3>
      <p className="text-xs text-text-muted mb-3">
        What you finally charged for this job. It measures how close your estimates are (Analytics → Estimate accuracy).
      </p>
      {saved && diff !== null && (
        <p className="text-sm text-text-secondary mb-3">
          Invoiced <span className="figure font-semibold text-text-primary">{formatMoney(saved.amount, props.currency)}</span>{' '}
          against a quote of <span className="figure">{formatMoney(props.quotedTotal, props.currency)}</span>:{' '}
          <span className={`figure font-semibold ${Math.abs(diff) <= 0.1 ? 'text-primary' : 'text-tertiary'}`}>
            {diff >= 0 ? '+' : ''}
            {(diff * 100).toFixed(1)}%
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-text-secondary mb-1">Invoiced amount ({props.currency})</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="figure w-40 rounded-lg border border-border px-3 py-2"
            placeholder="0.00"
          />
        </label>
        <label className="text-sm flex-1 min-w-[12rem]">
          <span className="block text-text-secondary mb-1">Note (optional)</span>
          <input
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2"
            placeholder="e.g. customer added a second room"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={busy || parsed === null}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : saved ? 'Update' : 'Save'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
