'use client'

import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import type { Quote, PricingTrace, PricingTraceStep } from '@estimator/shared'

interface QuoteWithService extends Quote {
  service: {
    id: string
    name: string
    description: string | null
    work_steps: unknown[]
    expected_signals: unknown[]
  } | null
}

/**
 * Pricing Trace Viewer
 *
 * Shows exactly how a quote was calculated step by step.
 */
export default function PricingTracePage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = use(params)
  const [quote, setQuote] = useState<QuoteWithService | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchQuote() {
      try {
        setLoading(true)
        const res = await fetch(`/api/quotes/${quoteId}`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error?.message || 'Failed to fetch quote')
        }

        setQuote(data.quote)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch quote')
      } finally {
        setLoading(false)
      }
    }

    fetchQuote()
  }, [quoteId])

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  const getStepIcon = (type: PricingTraceStep['type']) => {
    switch (type) {
      case 'base_fee':
        return (
          <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
      case 'work_step':
        return (
          <svg className="h-5 w-5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        )
      case 'addon':
        return (
          <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        )
      case 'multiplier':
        return (
          <svg className="h-5 w-5 text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
        )
      case 'minimum':
        return (
          <svg className="h-5 w-5 text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        )
      case 'tax':
        return (
          <svg className="h-5 w-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        )
      default:
        return (
          <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )
    }
  }

  const getStepTypeLabel = (type: PricingTraceStep['type']) => {
    switch (type) {
      case 'base_fee':
        return 'Base Fee'
      case 'work_step':
        return 'Work Step'
      case 'addon':
        return 'Add-on'
      case 'multiplier':
        return 'Multiplier'
      case 'minimum':
        return 'Minimum Charge'
      case 'tax':
        return 'Tax'
      default:
        return type
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error || !quote) {
    return (
      <div className="rounded-warm-lg bg-danger-light p-6 text-center">
        <p className="text-danger">{error || 'Quote not found'}</p>
        <Link href="/app/quotes" className="mt-4 inline-block text-primary hover:text-primary">
          Back to Quotes
        </Link>
      </div>
    )
  }

  const trace = quote.pricing_trace_json as PricingTrace | null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/app/quotes"
            className="mb-2 inline-flex items-center text-sm text-text-secondary hover:text-text-primary"
          >
            <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Quotes
          </Link>
          <h1 className="text-2xl font-semibold text-text-primary">Pricing Trace</h1>
          <p className="mt-1 text-sm text-text-muted">
            Quote for {quote.customer_json.name} - {quote.service?.name || 'Unknown Service'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-text-primary">{formatCurrency(quote.pricing_json.total)}</p>
          <p className="text-sm text-text-muted">Final Total</p>
        </div>
      </div>

      {/* Quote Summary Card */}
      <div className="rounded-warm-lg border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-medium text-text-primary">Quote Summary</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-text-muted">Customer</p>
            <p className="font-medium text-text-primary">{quote.customer_json.name}</p>
            <p className="text-sm text-text-secondary">{quote.customer_json.email}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Service</p>
            <p className="font-medium text-text-primary">{quote.service?.name || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Status</p>
            <p className="font-medium text-text-primary capitalize">{quote.status}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Created</p>
            <p className="font-medium text-text-primary">{formatDate(quote.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Pricing Trace */}
      {trace ? (
        <div className="rounded-warm-lg border border-border bg-surface">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium text-text-primary">Calculation Steps</h2>
            <p className="text-sm text-text-muted">
              Calculated at {formatDate(trace.calculatedAt)}
              {trace.configVersion && ` - Config v${trace.configVersion}`}
            </p>
          </div>

          <div className="divide-y divide-border">
            {trace.trace.map((step, index) => (
              <div
                key={index}
                className="flex items-start gap-4 px-6 py-4 hover:bg-background"
              >
                <div className="mt-0.5">{getStepIcon(step.type)}</div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-text-primary">{step.description}</p>
                      <p className="text-xs text-text-muted">{getStepTypeLabel(step.type)}</p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-medium ${
                          step.amount < 0 ? 'text-danger' : 'text-text-primary'
                        }`}
                      >
                        {step.amount >= 0 ? '+' : ''}
                        {formatCurrency(step.amount)}
                      </p>
                      <p className="text-sm text-text-muted">
                        Running: {formatCurrency(step.runningTotal)}
                      </p>
                    </div>
                  </div>

                  {/* Calculation formula */}
                  {step.calculation && (
                    <p className="mt-1 text-sm text-text-secondary">
                      <span className="font-mono text-xs">{step.calculation}</span>
                    </p>
                  )}

                  {/* Signals used */}
                  {step.signalsUsed && step.signalsUsed.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {step.signalsUsed.map((signal, sigIndex) => (
                        <span
                          key={sigIndex}
                          className="inline-flex items-center rounded-warm-lg bg-background px-2 py-0.5 text-xs text-text-secondary"
                        >
                          {signal.key}: {String(signal.value)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          {trace.summary && (
            <div className="border-t border-border bg-background px-6 py-4">
              <h3 className="mb-3 text-sm font-medium text-text-primary">Summary</h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-4">
                <div className="flex justify-between">
                  <span className="text-text-secondary">Base Fee:</span>
                  <span className="font-medium">{formatCurrency(trace.summary.baseFee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Work Steps:</span>
                  <span className="font-medium">{formatCurrency(trace.summary.workStepsTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-secondary">Add-ons:</span>
                  <span className="font-medium">{formatCurrency(trace.summary.addonsTotal)}</span>
                </div>
                {trace.summary.multiplierAdjustment !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Multipliers:</span>
                    <span
                      className={`font-medium ${
                        trace.summary.multiplierAdjustment < 0 ? 'text-secondary' : 'text-tertiary'
                      }`}
                    >
                      {trace.summary.multiplierAdjustment >= 0 ? '+' : ''}
                      {formatCurrency(trace.summary.multiplierAdjustment)}
                    </span>
                  </div>
                )}
                {trace.summary.minimumApplied && (
                  <div className="flex justify-between col-span-2">
                    <span className="text-tertiary">Minimum charge applied</span>
                  </div>
                )}
                {trace.summary.taxAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Tax:</span>
                    <span className="font-medium">{formatCurrency(trace.summary.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-2 md:col-span-4">
                  <span className="font-medium text-text-primary">Total:</span>
                  <span className="font-bold text-text-primary">{formatCurrency(trace.summary.total)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-warm-lg border border-border bg-surface p-6 text-center">
          <svg className="mx-auto h-12 w-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="mt-4 text-text-secondary">
            No pricing trace available for this quote.
          </p>
          <p className="mt-1 text-sm text-text-muted">
            This quote may have been created before pricing traces were implemented.
          </p>
        </div>
      )}

      {/* Extracted Signals */}
      {quote.signals_json && (
        <div className="rounded-warm-lg border border-border bg-surface">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium text-text-primary">Extracted Signals</h2>
            <p className="text-sm text-text-muted">
              Data extracted from photos and form inputs
            </p>
          </div>
          <div className="px-6 py-4">
            <pre className="overflow-x-auto rounded-warm-lg bg-background p-4 text-sm text-text-primary">
              {JSON.stringify(quote.signals_json, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
