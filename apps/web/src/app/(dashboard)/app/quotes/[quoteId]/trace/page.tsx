'use client'

import { WordingRepairCard } from '@/components/quotes/WordingRepairCard'
import { useEffect, useState } from 'react'
import { formatMoney, minimumChargeNote, MINIMUM_ENTRY_LABEL } from '@qolumns/shared'
import Link from 'next/link'
import { TRACE_UNDERSTOOD_COPY, understoodTrace, understoodTraceEmpty } from '@/lib/trace-understood'
import { TRACE_AS_SENT_COPY, configVersionLabel, quoteAsSent } from '@/lib/trace-as-sent'
import type { Quote, PricingTrace, PricingTraceStep } from '@qolumns/shared'

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
  params: { quoteId: string }
}) {
  // T-165: this page read its address with `use(params)`, which this Next.js
  // version rejects ("An unsupported type was passed to use()"), so it never
  // opened. It reads it the way the quote page beside it does.
  const { quoteId } = params
  const [quote, setQuote] = useState<QuoteWithService | null>(null)
  // T-204: the quote's price before its first edit (null when it was never edited)
  const [firstPricing, setFirstPricing] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchQuote() {
      try {
        setLoading(true)
        const res = await fetch(`/api/quotes/${quoteId}?trace=1`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error?.message || 'Failed to fetch quote')
        }

        // T-204: the service comes beside the quote, not inside it. Reading `quote.service` was why
        // this page never showed the service's name.
        setQuote({ ...data.quote, service: data.service ?? null })
        setFirstPricing(data.firstPricing ?? null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch quote')
      } finally {
        setLoading(false)
      }
    }

    fetchQuote()
  }, [quoteId])

  // T-133: was hardcoded "$" — use the quote's own currency
  const formatCurrency = (amount: number) =>
    formatMoney(amount, quote?.pricing_json?.currency || 'USD')

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString(undefined, {
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
        return 'A floor, not a line: added to reach your minimum charge'
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
      <div className="rounded-xl bg-danger-light p-6 text-center">
        <p className="text-danger">{error || 'Quote not found'}</p>
        <Link href="/app/quotes" className="mt-4 inline-block text-primary hover:text-primary">
          Back to Quotes
        </Link>
      </div>
    )
  }

  const trace = quote.pricing_trace_json as PricingTrace | null
  // T-165: the minimum charge the engine applied, as the one sentence (null when it did not apply)
  const minimumStep = trace?.trace.find((step) => step.type === 'minimum' && step.amount > 0)
  const minimumNote = minimumStep ? minimumChargeNote(formatCurrency(minimumStep.runningTotal)) : null
  // T-201: what was read for this quote, as lines (not the stored record)
  const understood = understoodTrace(quote.signals_json, quote.service?.expected_signals)
  // T-204: the quote as it stands today, against its first price
  const sent = quoteAsSent(quote.pricing_json, firstPricing as Parameters<typeof quoteAsSent>[1])
  const C = TRACE_AS_SENT_COPY
  const serviceName = quote.service?.name || null
  const version = configVersionLabel(trace?.configVersion)

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
            Quote for {quote.customer_json.name}
            {serviceName ? ` - ${serviceName}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-text-primary">{formatCurrency(quote.pricing_json.total)}</p>
          <p className="text-sm text-text-muted">Final Total</p>
        </div>
      </div>

      {/* Quote Summary Card */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-lg font-medium text-text-primary">Quote Summary</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-text-muted">Customer</p>
            <p className="font-medium text-text-primary">{quote.customer_json.name}</p>
            <p className="text-sm text-text-secondary">{quote.customer_json.email}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Service</p>
            <p className="font-medium text-text-primary" data-testid="trace-service">{serviceName || '-'}</p>
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

      {/* T-204: the quote as sent. The engine's steps below are how the FIRST price was reached; a line
          added or changed with "Edit" is not among them, so the quote itself is printed first. */}
      <div className="rounded-xl border border-border bg-surface" data-testid="trace-as-sent">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-medium text-text-primary">{quote.sent_at ? C.titleSent : C.titleNotSent}</h2>
          <p className="text-sm text-text-muted">{C.intro}</p>
        </div>
        <div className="divide-y divide-border">
          {sent.lines.map((line, index) => (
            <div key={`${line.label}-${index}`} className="flex items-start justify-between gap-4 px-6 py-3" data-testid="trace-sent-line" data-mark={line.mark}>
              <div>
                <p className="font-medium text-text-primary">{line.label}</p>
                {line.mark !== 'first' && (
                  <p className="mt-0.5 text-xs font-medium text-tertiary">
                    {C.marks[line.mark]}
                    {line.mark === 'changed' && line.was !== undefined ? ` (${C.was(formatCurrency(line.was))})` : ''}
                  </p>
                )}
              </div>
              <p className="figure shrink-0 font-medium text-text-primary">{formatCurrency(line.amount)}</p>
            </div>
          ))}
          {sent.minimumCharge !== null && (
            <p className="px-6 py-3 text-sm text-tertiary">{minimumChargeNote(formatCurrency(sent.minimumCharge))}</p>
          )}
          {sent.sections.map((section) => (
            <div key={section.serviceName} className="px-6 py-3" data-testid="trace-sent-section">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-text-primary">{section.serviceName}</p>
                  <p className="mt-0.5 text-xs font-medium text-tertiary">{C.sectionBy[section.addedBy]}</p>
                </div>
                <p className="figure shrink-0 font-medium text-text-primary">{formatCurrency(section.subtotal)}</p>
              </div>
              <ul className="mt-2 space-y-1">
                {section.lines.map((line, index) => (
                  <li key={`${line.label}-${index}`} className="flex items-start justify-between gap-4 text-sm text-text-secondary">
                    <span>{line.label}</span>
                    <span className="figure shrink-0">{formatCurrency(line.amount)}</span>
                  </li>
                ))}
              </ul>
              {section.minimumCharge !== null && <p className="mt-1 text-sm text-tertiary">{minimumChargeNote(formatCurrency(section.minimumCharge))}</p>}
            </div>
          ))}
          {sent.removed.length > 0 && (
            <div className="px-6 py-3" data-testid="trace-sent-removed">
              <p className="text-xs font-medium text-text-muted">{C.removedTitle}</p>
              <ul className="mt-1 space-y-1">
                {sent.removed.map((line, index) => (
                  <li key={`${line.label}-${index}`} className="flex items-start justify-between gap-4 text-sm text-text-muted">
                    <span>{line.label}</span>
                    <span className="figure shrink-0">{formatCurrency(line.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-2 border-t border-border bg-background px-6 py-4 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal:</span>
            <span className="figure font-medium">{formatCurrency(sent.subtotal)}</span>
          </div>
          {sent.taxAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-text-secondary">
                {sent.taxLabel || 'Tax'}
                {sent.taxRate !== null ? ` (${sent.taxRate}%)` : ''}:
              </span>
              <span className="figure font-medium">{formatCurrency(sent.taxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2">
            <span className="font-medium text-text-primary">Total:</span>
            <span className="figure font-bold text-text-primary" data-testid="trace-sent-total">{formatCurrency(sent.total)}</span>
          </div>
        </div>
      </div>

      {/* Pricing Trace */}
      {trace ? (
        <div className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium text-text-primary">{sent.edited ? C.stepsTitleEdited : C.stepsTitle}</h2>
            {sent.edited && sent.firstTotal !== null && (
              <p className="text-sm text-text-secondary" data-testid="trace-edited-note">{C.edited(formatCurrency(sent.firstTotal))}</p>
            )}
            <p className="text-sm text-text-muted" data-testid="trace-calculated">
              Calculated at {formatDate(trace.calculatedAt)}
              {version && ` - Config ${version}`}
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
                      {/* T-165: the minimum is a floor, shown as the note every other page shows */}
                      <p className="font-medium text-text-primary" data-testid={step.type === 'minimum' ? 'minimum-note' : undefined}>
                        {step.type === 'minimum' ? minimumChargeNote(formatCurrency(step.runningTotal)) : step.description}
                      </p>
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
                          className="inline-flex items-center rounded-xl bg-background px-2 py-0.5 text-xs text-text-secondary"
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
                    <span className="text-tertiary">{minimumNote ?? MINIMUM_ENTRY_LABEL}</span>
                  </div>
                )}
                {trace.summary.taxAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Tax:</span>
                    <span className="font-medium">{formatCurrency(trace.summary.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-border pt-2 md:col-span-4">
                  <span className="font-medium text-text-primary">{sent.edited ? C.firstTotal : 'Total:'}</span>
                  <span className="font-bold text-text-primary">{formatCurrency(trace.summary.total)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
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

      {/* T-148: banned customer words found in the generated wording */}
      {trace?.wordingRepair && <WordingRepairCard record={trace.wordingRepair} />}

      {/* T-201: "What Qolumns understood", as lines a business can read (it was "Extracted Signals": the
          stored record printed as it is kept). lib/trace-understood.ts words it; nothing is added. */}
      {quote.signals_json && (
        <div className="rounded-xl border border-border bg-surface" data-testid="trace-understood">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium text-text-primary">{TRACE_UNDERSTOOD_COPY.title}</h2>
            <p className="text-sm text-text-muted">{TRACE_UNDERSTOOD_COPY.intro}</p>
          </div>
          {understoodTraceEmpty(understood) ? (
            <p className="px-6 py-4 text-sm text-text-secondary">{TRACE_UNDERSTOOD_COPY.nothing}</p>
          ) : (
            <div className="px-6 py-4">
              {understood.lines.length > 0 && (
                <dl className="divide-y divide-border">
                  {understood.lines.map((line, index) => (
                    <div key={`${line.name}-${index}`} className="py-3 first:pt-0 last:pb-0" data-testid="trace-understood-line">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <dt className="text-sm font-medium text-text-primary">{line.name}</dt>
                        <dd className="figure text-sm text-text-primary">{line.value}</dd>
                      </div>
                      <p className="mt-0.5 text-sm text-text-secondary">
                        {line.from}
                        {line.range ? `. ${line.range}` : ''}
                        {line.unsure ? `. ${TRACE_UNDERSTOOD_COPY.unsure}` : ''}
                      </p>
                      {line.note && <p className="mt-0.5 break-words text-sm text-text-muted">{line.note}</p>}
                    </div>
                  ))}
                </dl>
              )}
              {understood.notes.length > 0 && (
                <ul className={`space-y-1 text-sm text-text-secondary ${understood.lines.length > 0 ? 'mt-4 border-t border-border pt-4' : ''}`}>
                  {understood.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
