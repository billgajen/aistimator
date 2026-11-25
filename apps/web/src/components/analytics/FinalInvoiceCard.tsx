'use client'

/**
 * Record what the job was finally invoiced at (T-143). This is the ground
 * truth the accuracy report compares every estimate against.
 */
import { useState } from 'react'
import { FINAL_INVOICE_ASK, finalInvoiceLooksOff, formatMoney, parseMoneyInput } from '@qolumns/shared'

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
  // T-204: an amount under half or over double the quote is asked about first (the amount it was asked for)
  const [asking, setAsking] = useState<number | null>(null)

  const parsed = parseMoneyInput(amount)
  const diff = saved && props.quotedTotal > 0 ? (saved.amount - props.quotedTotal) / props.quotedTotal : null

  async function save(confirmed = false) {
    if (parsed === null) {
      setError('Enter the invoiced amount, e.g. 2450 or 2,450.00')
      return
    }
    if (!confirmed && finalInvoiceLooksOff(parsed, props.quotedTotal)) {
      setError(null)
      setAsking(parsed)
      return
    }
    setAsking(null)
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
    <div className="mb-6 rounded-2xl border border-border bg-background p-5" data-testid="final-invoice">
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
            onChange={(e) => {
              setAmount(e.target.value)
              setAsking(null)
            }}
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
          onClick={() => save()}
          disabled={busy || parsed === null || asking !== null}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : saved ? 'Update' : 'Save'}
        </button>
      </div>
      {asking !== null && (
        <div className="mt-3 rounded-lg border border-tertiary-line bg-tertiary-light p-3" role="alertdialog" aria-labelledby="final-invoice-ask" data-testid="final-invoice-ask">
          <p id="final-invoice-ask" className="text-sm font-semibold text-text-primary">{FINAL_INVOICE_ASK}</p>
          <p className="mt-1 text-sm text-text-secondary">
            <span className="figure">{formatMoney(asking, props.currency)}</span> is {asking < props.quotedTotal ? 'less than half' : 'more than double'} the quote of{' '}
            <span className="figure">{formatMoney(props.quotedTotal, props.currency)}</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => save(true)} disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" data-testid="final-invoice-yes">
              Yes, save it
            </button>
            <button type="button" onClick={() => setAsking(null)} disabled={busy} className="rounded-lg border border-field bg-white px-4 py-2 text-sm font-semibold text-text-primary hover:bg-background disabled:opacity-50" data-testid="final-invoice-change">
              Change the amount
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
