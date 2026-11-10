'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { EstimateWidget } from '@/components/embed/EstimateWidget'
import { DEMO_CONTACT, DEMO_SAMPLE_PHOTO_PATH, formatMoney, freeOfferLabel, isQuoteProcessing } from '@estimator/shared'
import type { QuoteViewResponse } from '@estimator/shared'
import { RECORDED_EXAMPLE, type DemoEstimate } from '@/lib/demo/recorded-example'

const POLL_MS = 1500
const POLL_LIMIT_MS = 180_000

/** The estimate the visitor got, in the shape this page shows */
export function toDemoEstimate(q: QuoteViewResponse, quoteViewUrl: string | null, serviceName: string | null): DemoEstimate {
  return {
    businessName: q.business.name,
    serviceName,
    currency: q.pricing.currency,
    locale: q.locale ?? 'en-US',
    lines: (q.pricing.breakdown ?? []).map((b) => ({ label: b.label, amount: b.amount })),
    taxLabel: q.pricing.taxAmount > 0 ? q.pricing.taxLabel ?? 'Tax' : null,
    taxAmount: q.pricing.taxAmount,
    total: q.pricing.total,
    range: q.provisional ? { low: q.provisional.rangeLow, high: q.provisional.rangeHigh } : q.estimateRange ?? null,
    needsAnswer: q.status === 'awaiting_clarification',
    quoteViewUrl,
  }
}

/**
 * T-153: /demo for visitors — the real widget for the example business, then
 * the estimate on the same page, what the business sees, and signup.
 */
export function DemoExperience({ tenantKey }: { tenantKey: string }) {
  const [phase, setPhase] = useState<'form' | 'waiting' | 'ready' | 'busy' | 'slow'>('form')
  const [estimate, setEstimate] = useState<DemoEstimate | null>(null)
  const startedAt = useRef(0)
  const resultRef = useRef<HTMLDivElement>(null)

  const onResult = useCallback(({ quoteId, quoteViewUrl, serviceName }: { quoteId: string; quoteViewUrl: string; serviceName: string | null }) => {
    startedAt.current = Date.now()
    setPhase('waiting')
    const token = new URL(quoteViewUrl, window.location.origin).searchParams.get('token') ?? ''
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/public/quotes/${quoteId}?token=${encodeURIComponent(token)}&poll=1`, { cache: 'no-store' })
        if (res.ok) {
          const q = (await res.json()) as QuoteViewResponse
          if (!isQuoteProcessing(q.status)) {
            setEstimate(toDemoEstimate(q, quoteViewUrl, serviceName))
            setPhase('ready')
            return
          }
        }
      } catch {
        // keep polling until the time limit
      }
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) {
        setPhase('slow')
        return
      }
      setTimeout(poll, POLL_MS)
    }
    void poll()
  }, [])

  useEffect(() => {
    if (phase === 'ready' || phase === 'busy') resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [phase])

  return (
    <div>
      <Suspense fallback={null}>
        <EstimateWidget
          tenantKey={tenantKey}
          demo={{
            contact: DEMO_CONTACT,
            contactNote: 'These are example details. No email or text will be sent to anyone.',
            samplePhotoUrl: DEMO_SAMPLE_PHOTO_PATH,
            onResult,
            onBusy: () => {
              setEstimate(RECORDED_EXAMPLE)
              setPhase('busy')
            },
          }}
        />
      </Suspense>

      <div ref={resultRef} className="mx-auto max-w-xl scroll-mt-20 px-3 sm:px-0">
        {phase === 'waiting' && (
          <p className="mt-6 flex items-center justify-center gap-3 text-sm text-text-secondary" role="status" data-testid="demo-waiting">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Pricing it from the business&apos;s own rates…
          </p>
        )}
        {phase === 'slow' && (
          <p className="mt-6 text-center text-sm text-text-secondary" role="status">
            This one is taking longer than usual. You can still open the estimate page from the message above.
          </p>
        )}
        {(phase === 'ready' || phase === 'busy') && estimate && (
          <div className="mt-8 space-y-6" data-testid="demo-result">
            <EstimateCard estimate={estimate} recorded={phase === 'busy'} />
            <BusinessSees estimate={estimate} />
            <div className="rounded-warm-xl bg-primary p-6 text-center text-white">
              <p className="font-display text-lg font-bold">Your customers could get this from you, with your prices.</p>
              <Link
                href="/signup"
                className="mt-4 inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-primary hover:bg-mint"
                data-testid="demo-signup"
              >
                {freeOfferLabel()}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function money(n: number, e: DemoEstimate) {
  return formatMoney(n, e.currency, e.locale)
}

function EstimateCard({ estimate, recorded }: { estimate: DemoEstimate; recorded: boolean }) {
  return (
    <section className="rounded-warm-2xl border border-border bg-white p-6 shadow-warm-lg" data-testid={recorded ? 'demo-recorded' : 'demo-estimate'}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">
        {recorded ? 'Example estimate (recorded)' : 'Your estimate'}
      </p>
      <h2 className="mt-1 font-display text-xl font-bold text-text-primary">
        {estimate.businessName}
        {estimate.serviceName ? <span className="block text-sm font-medium text-text-secondary">{estimate.serviceName}</span> : null}
      </h2>
      {recorded && (
        <p className="mt-2 text-sm text-text-secondary">
          The demo is busy right now, so here is one we recorded earlier. It works the same way.
        </p>
      )}
      <ul className="mt-4 divide-y divide-border text-sm">
        {estimate.lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-text-secondary">{l.label}</span>
            <span className="figure text-text-primary">{money(l.amount, estimate)}</span>
          </li>
        ))}
        {estimate.taxLabel && (
          <li className="flex items-baseline justify-between gap-4 py-2">
            <span className="text-text-secondary">{estimate.taxLabel}</span>
            <span className="figure text-text-primary">{money(estimate.taxAmount, estimate)}</span>
          </li>
        )}
      </ul>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <span className="font-semibold text-text-primary">Estimate</span>
        <span className="figure text-2xl font-medium text-text-primary" data-testid="demo-total">
          {estimate.range && estimate.needsAnswer
            ? `${money(estimate.range.low, estimate)} – ${money(estimate.range.high, estimate)}`
            : money(estimate.total, estimate)}
        </span>
      </div>
      {estimate.needsAnswer && (
        <p className="mt-2 text-sm text-text-secondary">The business would ask you one quick question to firm this up.</p>
      )}
      <p className="mt-4 text-xs text-text-muted">An example business with example prices. Every price comes from the business&apos;s own rates, never from the AI.</p>
      {estimate.quoteViewUrl && (
        <a href={estimate.quoteViewUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
          Open the full estimate page
        </a>
      )}
    </section>
  )
}

/** A static example of the owner's view — not a live dashboard */
function BusinessSees({ estimate }: { estimate: DemoEstimate }) {
  return (
    <section className="rounded-warm-2xl bg-surface p-6 shadow-warm" data-testid="demo-business-sees">
      <h2 className="font-display text-lg font-bold text-text-primary">What the business sees</h2>
      <p className="mt-1 text-sm text-text-secondary">An example of the owner&apos;s phone the moment a request arrives.</p>
      <div className="mt-4 rounded-warm-xl border border-border bg-white p-4" aria-label="Example of the business's view">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">New lead</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-text-primary">{DEMO_CONTACT.name}</p>
            <p className="truncate text-sm text-text-secondary">{estimate.serviceName ?? 'Your service'} · just now</p>
          </div>
          <span className="figure shrink-0 text-lg text-text-primary">{money(estimate.total, estimate)}</span>
        </div>
        <span className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white" aria-hidden="true">
          Approve &amp; send
        </span>
      </div>
      <p className="mt-3 text-xs text-text-muted">
        Approve with one tap, or let a service send on its own. In this demo nothing is sent to anyone.
      </p>
    </section>
  )
}
