'use client'

import Link from 'next/link'
import { useState } from 'react'
import { approvalOutcomeCopy, PRODUCT_NAME, type ApprovalOutcome } from '@estimator/shared'
import type { ApprovalSummary } from '@/lib/approval-link'

/**
 * T-156: the phone-first confirmation card. One button, "Approve & send";
 * every state offers "Open in dashboard to edit".
 */
export function ApproveCard({ token, initialOutcome, summary }: { token: string; initialOutcome: ApprovalOutcome; summary: ApprovalSummary | null }) {
  const [outcome, setOutcome] = useState<ApprovalOutcome | 'error'>(initialOutcome)
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const copy = message ?? (outcome === 'error' ? { title: 'Something went wrong', body: 'Nothing was sent. Try again, or open the quote in your dashboard.' } : approvalOutcomeCopy(outcome, { customerName: summary?.customerName }))
  const dashboard = summary ? `/app/quotes/${summary.quoteId}` : '/app'

  async function approve() {
    setBusy(true)
    try {
      const res = await fetch(`/api/public/approval/${encodeURIComponent(token)}`, { method: 'POST' })
      const json = (await res.json().catch(() => null)) as { outcome?: ApprovalOutcome; title?: string; body?: string } | null
      if (json?.outcome && json.title && json.body) {
        setOutcome(json.outcome)
        setMessage({ title: json.title, body: json.body })
      } else {
        setOutcome(res.status === 429 ? 'too_many' : 'error')
        setMessage(null)
      }
    } catch {
      setOutcome('error')
    } finally {
      setBusy(false)
    }
  }

  const done = outcome === 'approved'
  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:py-12">
      <div className="mx-auto max-w-md">
        <p className="mb-4 text-center font-display text-sm font-extrabold tracking-tight text-text-secondary">{PRODUCT_NAME}</p>
        <div className="rounded-warm-xl bg-white p-5 shadow-warm-md sm:p-6" data-testid="approve-card" data-outcome={outcome}>
          {summary && (
            <div className="border-b border-border pb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">{summary.businessName}</p>
              <p className="mt-2 font-display text-xl font-bold text-text-primary">{summary.customerName}</p>
              <p className="text-sm text-text-secondary">{summary.serviceName}</p>
              {summary.price && <p className="figure mt-3 text-3xl text-text-primary" data-testid="approve-price">{summary.price}</p>}
              {summary.scopeSummary && <p className="mt-3 text-sm leading-relaxed text-text-secondary">{summary.scopeSummary}</p>}
            </div>
          )}

          <div className={summary ? 'pt-4' : ''} role="status" aria-live="polite">
            <h1 className={`font-display text-lg font-bold ${done ? 'text-primary' : 'text-text-primary'}`} data-testid="approve-title">
              {copy.title}
            </h1>
            <p className="mt-1 text-sm text-text-secondary" data-testid="approve-body">
              {copy.body}
            </p>
          </div>

          {outcome === 'ready' && (
            <button
              type="button"
              onClick={approve}
              disabled={busy}
              className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-lg bg-primary px-6 text-base font-bold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              data-testid="approve-button"
            >
              {busy ? 'Sending…' : 'Approve & send'}
            </button>
          )}

          <Link
            href={dashboard}
            className="mt-4 flex min-h-[44px] items-center justify-center text-sm font-semibold text-primary underline underline-offset-2"
            data-testid="approve-dashboard"
          >
            Open in dashboard to edit
          </Link>
        </div>
      </div>
    </main>
  )
}
