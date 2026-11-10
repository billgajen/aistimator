'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatMoney } from '@estimator/shared'
import { useCopy } from '@/components/share/useCopy'

interface TestQuote {
  id: string
  status: string
  serviceName: string | null
  currency: string | null
  subtotal: number
  taxAmount: number
  taxLabel: string | null
  total: number
  lines: Array<{ label: string; amount: number }>
  scopeSummary: string | null
}

const WORKING = new Set(['queued', 'generating'])

/**
 * T-150: setup's last step. The owner tries their own quote page as a
 * customer (test mode: not counted), sees the estimate it produced right here,
 * approves it as the business, then gets the link to share.
 */
export function TestQuoteStep({
  createdCount,
  quoteLink,
  locale,
  fallbackCurrency,
}: {
  createdCount: number
  quoteLink: string | null
  locale: string
  fallbackCurrency: string
}) {
  const [since, setSince] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [quote, setQuote] = useState<TestQuote | null>(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { copy, copiedId } = useCopy()

  async function openTest() {
    setOpening(true)
    setError(null)
    // Open the tab first (in the click) so pop-up blockers allow it
    const tab = window.open('about:blank', '_blank')
    try {
      const res = await fetch('/api/onboarding/test-link', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || 'Could not start the test')
      setSince(json.issuedAt)
      setQuote(null)
      setApproved(false)
      if (tab) tab.location.href = json.url
      else window.location.assign(json.url)
    } catch (e) {
      tab?.close()
      setError(e instanceof Error ? e.message : 'Could not start the test')
    } finally {
      setOpening(false)
    }
  }

  // Wait for the test request to arrive and be priced
  useEffect(() => {
    if (!since || approved) return
    if (quote && !WORKING.has(quote.status)) return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/onboarding/test-quote?since=${encodeURIComponent(since)}`)
        const json = await res.json()
        if (!cancelled && res.ok && json.quote) setQuote(json.quote as TestQuote)
      } catch {
        // keep waiting
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [since, quote, approved])

  async function approve() {
    if (!quote) return
    setApproving(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${quote.id}/approve`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || 'Could not approve')
      setApproved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve')
    } finally {
      setApproving(false)
    }
  }

  const money = (n: number) => formatMoney(n, quote?.currency || fallbackCurrency, locale)
  const priced = quote && !WORKING.has(quote.status)

  return (
    <div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">Now try it as your customer</h1>
      <p className="mt-2 text-text-secondary">
        {createdCount} service{createdCount === 1 ? '' : 's'} ready. Open your quote page, ask for a job as if you were a
        customer, and watch the estimate arrive here. Test requests don&apos;t count toward your plan.
      </p>

      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold text-text-primary">1. Try it as your customer</h2>
        <button
          type="button"
          onClick={openTest}
          disabled={opening}
          className="mt-3 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {opening ? 'Opening…' : since ? 'Open it again' : 'Try it as your customer'}
        </button>
        {since && !quote && (
          <p className="mt-3 text-sm text-text-secondary" role="status" aria-live="polite">
            Waiting for your test request… fill in the form in the other tab.
          </p>
        )}
        {quote && WORKING.has(quote.status) && (
          <p className="mt-3 text-sm text-text-secondary" role="status" aria-live="polite">
            Got it. Pricing your test request…
          </p>
        )}
      </div>

      {priced && quote && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-5" data-testid="test-estimate">
          <h2 className="font-semibold text-text-primary">2. Here&apos;s the estimate your customer got</h2>
          {quote.status === 'awaiting_clarification' ? (
            <p className="mt-2 text-sm text-text-secondary">
              Your quote page asked a quick question to get the price right. Answer it in the other tab and the estimate
              will appear here.
            </p>
          ) : (
            <>
              {quote.serviceName && <p className="mt-1 text-sm text-text-muted">{quote.serviceName}</p>}
              <ul className="mt-3 divide-y divide-border">
                {quote.lines.map((line, i) => (
                  <li key={i} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="text-text-primary">{line.label}</span>
                    <span className="figure text-text-primary">{money(line.amount)}</span>
                  </li>
                ))}
                {quote.taxAmount > 0 && (
                  <li className="flex justify-between gap-3 py-2 text-sm">
                    <span className="text-text-secondary">{quote.taxLabel || 'Tax'}</span>
                    <span className="figure text-text-secondary">{money(quote.taxAmount)}</span>
                  </li>
                )}
              </ul>
              <p className="mt-2 flex justify-between border-t border-border pt-3 font-semibold text-text-primary">
                <span>Total</span>
                <span className="figure" data-testid="test-estimate-total">{money(quote.total)}</span>
              </p>

              <div className="mt-4">
                {quote.status === 'pending_review' && !approved && (
                  <>
                    <p className="text-sm text-text-secondary">
                      This is what you&apos;ll see for every new request: check it, then approve it.
                    </p>
                    <button
                      type="button"
                      onClick={approve}
                      disabled={approving || quote.total <= 0}
                      className="mt-3 inline-flex items-center rounded-lg bg-secondary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {approving ? 'Sending…' : 'Approve & send'}
                    </button>
                  </>
                )}
                {(approved || ['sent', 'viewed'].includes(quote.status)) && (
                  <p className="text-sm font-medium text-secondary" role="status">
                    Sent. Your customer now has your confirmed quote and can accept it.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="mt-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-semibold text-text-primary">{priced ? '3' : '2'}. Share your quote link</h2>
        {quoteLink && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary">{quoteLink}</code>
            <button
              type="button"
              onClick={() => copy('link', quoteLink)}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              {copiedId === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Link
            href="/app"
            className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-text-primary hover:bg-background"
          >
            Go to dashboard
          </Link>
          <Link href="/app/share" className="text-sm text-text-secondary underline underline-offset-2">
            QR code, ready-made texts and website code
          </Link>
        </div>
      </div>
    </div>
  )
}
