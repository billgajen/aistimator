'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface WaitingQuote {
  id: string
  customerName: string
  serviceName: string
  priceLabel: string
  createdLabel: string
}

/**
 * T-152: the top of Home — quotes waiting for the owner's approval, each with
 * one Approve & send (the same POST /api/quotes/:id/approve as the quote page).
 * Hidden when there is nothing waiting.
 */
export function WaitingForYou({ quotes }: { quotes: WaitingQuote[] }) {
  const [state, setState] = useState<Record<string, { busy?: boolean; sent?: string; error?: string }>>({})

  if (quotes.length === 0) return null

  async function approve(q: WaitingQuote) {
    setState((s) => ({ ...s, [q.id]: { busy: true } }))
    try {
      const res = await fetch(`/api/quotes/${q.id}/approve`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error?.message || 'Could not approve this quote')
      setState((s) => ({
        ...s,
        [q.id]: { sent: json?.emailed ? `Sent to ${q.customerName}` : 'Approved. No email went out; open it to text or copy the link.' },
      }))
    } catch (e) {
      setState((s) => ({ ...s, [q.id]: { error: e instanceof Error ? e.message : 'Could not approve this quote' } }))
    }
  }

  const open = quotes.filter((q) => !state[q.id]?.sent).length

  return (
    <section className="mb-8 rounded-warm-xl bg-white p-6 shadow-warm-md" data-testid="waiting-for-you">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-text-primary">Waiting for you</h2>
        <span className="text-sm text-text-secondary">
          <span className="figure">{open}</span> to approve
        </span>
      </div>
      <ul className="divide-y divide-border">
        {quotes.map((q) => {
          const st = state[q.id] ?? {}
          return (
            <li key={q.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" data-testid="waiting-quote">
              <Link href={`/app/quotes/${q.id}`} className="min-w-0 hover:underline">
                <p className="truncate font-semibold text-text-primary">{q.customerName}</p>
                <p className="truncate text-sm text-text-secondary">
                  {q.serviceName} · {q.createdLabel}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-3">
                <span className="figure text-lg font-medium text-text-primary">{q.priceLabel}</span>
                {st.sent ? (
                  <span className="text-sm font-medium text-primary" role="status">
                    {st.sent}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => approve(q)}
                    disabled={st.busy}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
                  >
                    {st.busy ? 'Sending…' : 'Approve & send'}
                  </button>
                )}
              </div>
              {st.error && (
                <p className="text-sm text-danger sm:basis-full" role="alert">
                  {st.error}{' '}
                  <Link href={`/app/quotes/${q.id}`} className="font-semibold underline">
                    Open it
                  </Link>
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
