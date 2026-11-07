'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { brandStyleVars } from '@/lib/color'
import type { QuoteViewResponse, QuoteStatus } from '@estimator/shared'
import { formatMoney, formatDate, formatNumber, currencySymbol, unitDisplayLabel } from '@estimator/shared'

interface QuotePageProps {
  params: { quoteId: string }
}

const JUNIPER = '#205E56'

export default function QuotePage({ params }: QuotePageProps) {
  const { quoteId } = params
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [quote, setQuote] = useState<QuoteViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  // Decline state
  const [declining, setDeclining] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [declineMode, setDeclineMode] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  // Feedback state
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState<'none' | 'feedback' | 'review'>('none')
  const [feedbackText, setFeedbackText] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)

  useEffect(() => {
    async function fetchQuote() {
      if (!token) {
        setError('Missing access token')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/public/quotes/${quoteId}?token=${token}`)
        const data = await response.json()

        if (!response.ok) {
          setError(data.error?.message || 'Failed to load quote')
          setLoading(false)
          return
        }

        setQuote(data)
        setAccepted(data.status === 'accepted' || data.status === 'paid')
        setDeclined(data.status === 'declined')
      } catch {
        setError('Failed to load quote')
      } finally {
        setLoading(false)
      }
    }

    fetchQuote()
  }, [quoteId, token])

  async function handleAccept() {
    if (!token || accepting) return

    setAccepting(true)
    try {
      const response = await fetch(`/api/public/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      if (response.ok) {
        setAccepted(true)
        if (quote) {
          setQuote({ ...quote, status: 'accepted' as QuoteStatus })
        }
      } else {
        const data = await response.json()
        alert(data.error?.message || 'Failed to accept quote')
      }
    } catch {
      alert('Failed to accept quote')
    } finally {
      setAccepting(false)
    }
  }

  async function handleDecline() {
    if (!token || declining) return

    setDeclining(true)
    try {
      const response = await fetch(`/api/public/quotes/${quoteId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, reason: declineReason.trim() || undefined }),
      })

      if (response.ok) {
        setDeclined(true)
        setDeclineMode(false)
        if (quote) {
          setQuote({ ...quote, status: 'declined' as QuoteStatus })
        }
      } else {
        const data = await response.json()
        alert(data.error?.message || 'Failed to decline quote')
      }
    } catch {
      alert('Failed to decline quote')
    } finally {
      setDeclining(false)
    }
  }

  const handleFeedback = useCallback(async (type: 'feedback' | 'approval_request') => {
    if (!token || submittingFeedback) return
    if (type === 'feedback' && !feedbackText.trim()) return

    setSubmittingFeedback(true)
    try {
      const response = await fetch(`/api/public/quotes/${quoteId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          feedbackType: type,
          feedbackText: type === 'feedback' ? feedbackText.trim() : undefined,
        }),
      })

      if (response.ok) {
        setFeedbackSubmitted(true)
        setFeedbackMode('none')
        if (quote) {
          setQuote({ ...quote, status: 'feedback_received' as QuoteStatus })
        }
      } else {
        const data = await response.json()
        alert(data.error?.message || 'Failed to submit feedback')
      }
    } catch {
      alert('Failed to submit feedback')
    } finally {
      setSubmittingFeedback(false)
    }
  }, [token, quoteId, feedbackText, submittingFeedback, quote])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="tape-rule w-40 mx-auto animate-pulse" />
          <p className="mt-4 text-sm text-text-secondary">Preparing your estimate…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md bg-surface border border-border rounded-warm-2xl shadow-warm-md p-8">
          <p className="figure text-danger text-3xl mb-3">!</p>
          <h1 className="font-display text-xl font-bold text-text-primary mb-2">This estimate can&apos;t be opened</h1>
          <p className="text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    )
  }

  if (!quote) {
    return null
  }

  const { business, branding, customer, pricing, notes, validUntil, assets, status, actions, crossServicePricing, signalRecommendations, version: quoteVersion, acceptQuoteEnabled, takeoff, reference } = quote
  // T-133: tenant locale for money and dates (legacy quotes without one render as before)
  const locale = quote.locale || 'en-GB'
  const brandVars = brandStyleVars(branding?.primaryColor)
  const showAcceptButton = acceptQuoteEnabled !== false
  const canSubmitFeedback = ['sent', 'viewed', 'revised'].includes(status) && !feedbackSubmitted && !accepted && !declined

  // T-109 range-first: provisional quotes show an estimated range, not exact pricing
  if (quote.provisional) {
    const { rangeLow, rangeHigh, reason } = quote.provisional
    return (
      <div className="min-h-screen bg-background py-8 px-4 sm:py-14" style={brandVars}>
        <div className="max-w-2xl mx-auto animate-fade-in-up">
          <div className="bg-background rounded-warm-2xl shadow-document overflow-hidden">
            <Letterhead
              business={business}
              status={status}
              reference={reference}
              customerName={customer.name}
              validUntil={validUntil}
              pdfUrl={actions.pdfUrl}
              locale={locale}
            />

            {/* Provisional price instrument */}
            <div className="px-6 sm:px-10 py-10 bg-primary text-on-primary">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-on-primary/60 mb-3">
                Estimated range for {customer.name}
              </p>
              <p className="figure text-4xl sm:text-5xl font-medium tracking-tight">
                <Money amount={rangeLow} currency={pricing.currency} locale={locale} />
                <span className="text-on-primary/40 mx-2 font-light">—</span>
                <Money amount={rangeHigh} currency={pricing.currency} locale={locale} />
              </p>

              <div className="tape-rule-light mt-8" />

              {reason === 'awaiting_clarification' ? (
                <div className="mt-6">
                  <p className="text-sm text-on-primary/80 mb-5 max-w-md">
                    Confirm a couple of details and this range becomes your exact price —
                    it takes less than a minute.
                  </p>
                  <a
                    href={`/q/${quoteId}/clarify?token=${token}`}
                    className="inline-block px-6 py-3.5 bg-butter text-ink font-semibold rounded-warm-lg hover:brightness-105 active:scale-[0.99] transition"
                  >
                    Confirm details
                  </a>
                </div>
              ) : (
                <p className="mt-6 text-sm text-on-primary/80 max-w-md">
                  {business.name} is double-checking the details. Your final estimate arrives
                  by email shortly — nothing needed from you.
                </p>
              )}
            </div>

            {pricing.notes && pricing.notes.length > 0 && (
              <div className="px-6 sm:px-10 py-6">
                {pricing.notes.map((note, i) => (
                  <p key={i} className="text-xs text-text-muted mb-1">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </div>
          <DocumentFooter footerNotes={branding?.footerNotes} showPoweredBy={branding?.showPoweredBy !== false} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4 sm:py-14" style={brandVars}>
      <div className="max-w-2xl mx-auto">
        {/* The document */}
        <div className="animate-fade-in-up bg-background rounded-warm-2xl shadow-document overflow-hidden">
          <Letterhead
            business={business}
            status={status}
            reference={reference}
            customerName={customer.name}
            validUntil={validUntil}
            pdfUrl={actions.pdfUrl}
            version={quoteVersion}
            locale={locale}
          />

          {/* ============ The price instrument (signature) ============ */}
          <div className="px-6 sm:px-10 py-9 bg-primary text-on-primary">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-on-primary/60 mb-3">
                  Your estimate{pricing.taxAmount > 0 ? ` · incl. ${pricing.taxLabel || 'tax'}` : ''}
                </p>
                <p className="figure text-5xl sm:text-6xl font-medium tracking-tight leading-none">
                  <Money amount={pricing.total} currency={pricing.currency} locale={locale} emphasize />
                </p>
                {pricing.estimate && (
                  <p className="mt-4 text-[13px] leading-snug text-on-primary/75 max-w-sm">
                    {pricing.estimate.description}
                  </p>
                )}
              </div>

              {pricing.estimate && (
                <div
                  className="grade-seal shrink-0"
                  style={{ color: '#F0DCA0', ['--seal-gap' as never]: 'var(--color-primary)' }}
                  aria-label={`Estimate grade ${pricing.estimate.grade} — ${pricing.estimate.label}`}
                >
                  <span className="font-display text-2xl font-bold">{pricing.estimate.grade}</span>
                  <span className="mt-1 text-[7.5px] font-semibold uppercase tracking-[0.14em]">
                    {pricing.estimate.label}
                  </span>
                </div>
              )}
            </div>

            {/* Measured range scale */}
            {pricing.estimate?.rangeLow !== undefined && pricing.estimate?.rangeHigh !== undefined && (
              <RangeScale
                low={pricing.estimate.rangeLow}
                high={pricing.estimate.rangeHigh}
                value={pricing.total}
                currency={pricing.currency}
                locale={locale}
              />
            )}

            <div className="tape-rule-light mt-8" />
          </div>

          {/* ============ Body ============ */}
          <div className="px-6 sm:px-10 py-8">
            {/* Scope */}
            {notes.scopeSummary && (
              <section className="mb-8">
                <SectionLabel>Scope of work</SectionLabel>
                <p className="text-[15px] leading-relaxed text-text-secondary">{notes.scopeSummary}</p>
              </section>
            )}

            {/* Pricing ledger */}
            <section className="mb-8">
              <SectionLabel>Price breakdown</SectionLabel>

              {pricing.breakdown && pricing.breakdown.length > 0 && (
                <div className="space-y-2.5 mb-5">
                  {pricing.breakdown.map((item, index) => {
                    const [labelMain, labelMath] = splitLabelMath(item.label)
                    return (
                    <div key={index}>
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="text-text-primary">{labelMain}</span>
                        <span className="flex-1 border-b border-dotted border-border-strong translate-y-[-3px]" />
                        <span className="figure text-text-primary whitespace-nowrap">
                          {formatCurrency(item.amount, pricing.currency, locale)}
                        </span>
                      </div>
                      {labelMath && (
                        <p className="figure text-xs text-text-muted mt-0.5">{labelMath}</p>
                      )}
                      {item.autoRecommended && (
                        <p className="text-xs text-primary mt-0.5">
                          Added for you{item.recommendationReason ? ` — ${item.recommendationReason.toLowerCase()}` : ''}
                        </p>
                      )}
                    </div>
                  )})}
                  {pricing.breakdown.some((item) => item.autoRecommended) && (
                    <p className="text-xs text-text-muted pt-1">
                      Items marked &quot;added for you&quot; came from your description or photos —
                      ask us to remove any you don&apos;t need.
                    </p>
                  )}
                </div>
              )}

              {pricing.notes && pricing.notes.length > 0 && (
                <div className="bg-butter/50 border border-tape/30 rounded-warm-lg px-4 py-3.5 mb-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary mb-1.5">Worth knowing</p>
                  <ul className="text-[13px] leading-relaxed text-tertiary space-y-1.5">
                    {pricing.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Subtotal</span>
                  <span className="figure text-text-primary">
                    {formatCurrency(pricing.subtotal, pricing.currency, locale)}
                  </span>
                </div>

                {pricing.taxAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">
                      {pricing.taxLabel || 'Tax'}
                      {pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
                    </span>
                    <span className="figure text-text-primary">
                      {formatCurrency(pricing.taxAmount, pricing.currency, locale)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-baseline pt-3 border-t-2 border-ink">
                  <span className="font-display font-bold text-text-primary">Total</span>
                  <span className="figure text-xl font-medium text-text-primary">
                    {formatCurrency(pricing.total, pricing.currency, locale)}
                  </span>
                </div>
              </div>
            </section>

            {/* Measurement & takeoff */}
            {takeoff && takeoff.length > 0 && (
              <section className="mb-8">
                <div className="rounded-warm-xl border border-tape/40 bg-butter/40 overflow-hidden">
                  <div className="px-5 pt-4 pb-3">
                    <SectionLabel tone="tape">Measurement &amp; takeoff</SectionLabel>
                    <p className="text-xs text-text-muted -mt-1">
                      How each part of this estimate was established.
                    </p>
                  </div>
                  <div className="tape-rule mx-5" />
                  <div className="px-5 py-4 space-y-4">
                    {takeoff.map((entry, index) => (
                      <div key={index}>
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="font-medium text-text-primary">{entry.item}</span>
                          <span className="flex-1" />
                          <span className="figure text-text-primary whitespace-nowrap">
                            {formatCurrency(entry.amount, pricing.currency, locale)}
                          </span>
                        </div>
                        {entry.quantity !== undefined && (
                          <p className="figure text-xs text-tertiary mt-0.5">
                            {formatNumber(entry.quantity, locale)}{entry.unit ? ` ${unitDisplayLabel(entry.unit)}` : ''}
                            {entry.rate !== undefined &&
                              ` × ${formatCurrency(entry.rate, pricing.currency, locale)}${entry.unit ? `/${unitDisplayLabel(entry.unit)}` : ''}`}
                          </p>
                        )}
                        <p className="text-xs text-text-muted mt-0.5">{entry.method}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Optional extras */}
            {pricing.availableAddons && pricing.availableAddons.length > 0 && (
              <section className="mb-8">
                <div className="bg-mint/70 border border-primary/15 rounded-warm-xl px-5 py-4">
                  <SectionLabel tone="brand">Optional extras</SectionLabel>
                  <div className="space-y-2">
                    {pricing.availableAddons.map((addon) => (
                      <div key={addon.id} className="flex items-baseline gap-2 text-sm">
                        <span className="text-text-primary">{addon.label}</span>
                        <span className="flex-1 border-b border-dotted border-primary/25 translate-y-[-3px]" />
                        <span className="figure text-primary whitespace-nowrap">
                          +{formatCurrency(addon.price, pricing.currency, locale)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted mt-3">
                    Ask us to add any of these to your estimate.
                  </p>
                </div>
              </section>
            )}

            {/* Cross-service pricing */}
            {crossServicePricing && crossServicePricing.length > 0 && (
              <section className="mb-8">
                <div className="bg-mist/70 border border-border rounded-warm-xl px-5 py-4">
                  <SectionLabel>
                    {crossServicePricing.every(s => !s.isEstimate)
                      ? 'Other services you mentioned'
                      : 'Other services you might need'}
                  </SectionLabel>
                  {crossServicePricing.map((service, index) => (
                    <div
                      key={index}
                      className="mb-4 last:mb-0 pb-4 last:pb-0 border-b last:border-b-0 border-border"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <span className="text-sm font-medium text-text-primary">{service.serviceName}</span>
                          <p className="text-xs text-text-secondary">{service.reason}</p>
                        </div>
                        <span className="figure text-sm text-text-primary whitespace-nowrap">
                          {service.isEstimate ? '~' : ''}
                          {formatCurrency(service.estimatedTotal, pricing.currency, locale)}
                        </span>
                      </div>
                      {service.extractedDetails && service.extractedDetails.length > 0 && (
                        <ul className="text-xs text-text-secondary mb-1 ml-2">
                          {service.extractedDetails.map((detail, i) => (
                            <li key={i}>• {detail}</li>
                          ))}
                        </ul>
                      )}
                      {service.breakdown && service.breakdown.length > 0 && (
                        <div className="text-xs text-text-muted space-y-0.5">
                          {service.breakdown.map((line, i) => (
                            <div key={i}>{line}</div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-text-muted mt-1">{service.note}</p>
                    </div>
                  ))}
                  <p className="text-xs text-text-muted mt-3">
                    Want these included? Reply after accepting, or send us a note below.
                  </p>
                </div>
              </section>
            )}

            {/* Potential additional work */}
            {signalRecommendations && signalRecommendations.length > 0 && (
              <section className="mb-8">
                <div className="bg-surface border border-border rounded-warm-xl px-5 py-4">
                  <SectionLabel>Worth considering</SectionLabel>
                  <p className="text-xs text-text-secondary mb-3 -mt-1">
                    From your description, you may also need:
                  </p>
                  {signalRecommendations.map((rec, index) => (
                    <div
                      key={index}
                      className="mb-3 last:mb-0 pb-3 last:pb-0 border-b last:border-b-0 border-border"
                    >
                      <span className="text-sm font-medium text-text-primary">{rec.workDescription}</span>
                      <p className="text-xs text-text-secondary">{rec.evidence}</p>
                      {rec.costBreakdown && (
                        <p className="figure text-xs text-text-muted mt-0.5">{rec.costBreakdown}</p>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-text-muted mt-3">
                    Ask for pricing — final scope confirmed on site.
                  </p>
                </div>
              </section>
            )}

            {/* Assumptions & exclusions */}
            {((notes.assumptions && notes.assumptions.length > 0) || (notes.exclusions && notes.exclusions.length > 0)) && (
              <section className="mb-8 grid gap-6 sm:grid-cols-2">
                {notes.assumptions && notes.assumptions.length > 0 && (
                  <div>
                    <SectionLabel>Assumptions</SectionLabel>
                    <ul className="text-[13px] leading-relaxed text-text-secondary space-y-1.5">
                      {notes.assumptions.map((item, index) => (
                        <li key={index} className="pl-3 relative">
                          <span className="absolute left-0 top-[0.55em] h-px w-1.5 bg-tape" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {notes.exclusions && notes.exclusions.length > 0 && (
                  <div>
                    <SectionLabel>Not included</SectionLabel>
                    <ul className="text-[13px] leading-relaxed text-text-secondary space-y-1.5">
                      {notes.exclusions.map((item, index) => (
                        <li key={index} className="pl-3 relative">
                          <span className="absolute left-0 top-[0.55em] h-px w-1.5 bg-border-strong" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Notes */}
            {notes.notes && (
              <section className="mb-2">
                <SectionLabel tone="tape">A note from {business.name}</SectionLabel>
                <div className="border-l-2 border-tape/60 pl-4">
                  <p className="text-[13px] leading-relaxed text-text-secondary">{notes.notes}</p>
                </div>
              </section>
            )}
          </div>

          {/* Photos */}
          {assets.length > 0 && (
            <div className="px-6 sm:px-10 pb-8">
              <SectionLabel>Your photos</SectionLabel>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {assets
                  .filter((a) => a.type === 'image')
                  .map((asset) => (
                    <a
                      key={asset.assetId}
                      href={asset.viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-square bg-surface rounded-warm-lg overflow-hidden hover:opacity-85 transition-opacity"
                    >
                      <img
                        src={asset.viewUrl}
                        alt="Attached photo"
                        className="w-full h-full object-cover"
                      />
                    </a>
                  ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {canSubmitFeedback && (
            <div className="px-6 sm:px-10 pb-8">
              <div className="tape-rule mb-7" />
              {showAcceptButton && (
                <>
                  <button
                    onClick={handleAccept}
                    disabled={accepting}
                    className="w-full py-4 px-4 rounded-warm-xl font-display font-bold text-on-primary text-base bg-primary hover:bg-primary-hover active:scale-[0.995] disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {accepting ? 'Accepting…' : `Accept this estimate — ${formatCurrency(pricing.total, pricing.currency, locale)}`}
                  </button>
                  <p className="text-xs text-text-muted text-center mt-2.5">
                    Accepting tells {business.name} to go ahead. Nothing is charged today.
                  </p>

                  <div className="flex items-center my-6">
                    <div className="flex-1 border-t border-border" />
                    <span className="px-3 text-xs text-text-muted">or</span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                </>
              )}

              {feedbackMode === 'none' && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleFeedback('approval_request')}
                    disabled={submittingFeedback}
                    className="flex-1 py-3 px-4 text-sm font-semibold text-text-primary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition disabled:opacity-50"
                  >
                    {submittingFeedback ? 'Sending…' : 'Send for review'}
                  </button>
                  <button
                    onClick={() => setFeedbackMode('feedback')}
                    className="flex-1 py-3 px-4 text-sm font-semibold text-text-primary bg-surface border border-border rounded-warm-lg hover:border-border-strong transition"
                  >
                    Ask a question
                  </button>
                </div>
              )}

              {feedbackMode === 'feedback' && (
                <div className="space-y-3">
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Questions, changes, anything we should know…"
                    className="w-full px-4 py-3 text-sm border border-border rounded-warm-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary resize-none transition"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setFeedbackMode('none'); setFeedbackText('') }}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-text-secondary border border-border rounded-warm-lg hover:bg-surface transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleFeedback('feedback')}
                      disabled={submittingFeedback || !feedbackText.trim()}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-on-primary bg-primary rounded-warm-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {submittingFeedback ? 'Sending…' : 'Send message'}
                    </button>
                  </div>
                </div>
              )}

              {/* Decline — deliberately quiet, below the primary actions */}
              {!declineMode && (
                <p className="text-center mt-6">
                  <button
                    onClick={() => setDeclineMode(true)}
                    className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary transition"
                  >
                    No longer need this? Decline this estimate
                  </button>
                </p>
              )}

              {declineMode && (
                <div className="mt-6 space-y-3 border border-border rounded-warm-lg p-4 bg-surface">
                  <p className="text-sm font-semibold text-text-primary">Decline this estimate</p>
                  <textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="Optional: let us know why, it helps us improve"
                    maxLength={500}
                    className="w-full px-4 py-3 text-sm border border-border rounded-warm-lg bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary resize-none transition"
                    rows={3}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setDeclineMode(false); setDeclineReason('') }}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-text-secondary border border-border rounded-warm-lg hover:bg-white transition"
                    >
                      Keep the estimate
                    </button>
                    <button
                      onClick={handleDecline}
                      disabled={declining}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-danger border border-danger/30 rounded-warm-lg hover:bg-danger-light disabled:opacity-50 transition"
                    >
                      {declining ? 'Declining…' : 'Decline estimate'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Feedback submitted confirmation */}
          {feedbackSubmitted && !accepted && (
            <div className="mx-6 sm:mx-10 mb-8 bg-mint border border-primary/15 rounded-warm-xl p-6 text-center">
              <h3 className="font-display text-lg font-bold text-text-primary mb-1">Message sent</h3>
              <p className="text-sm text-text-secondary">
                {business.name} will review it and get back to you.
              </p>
            </div>
          )}

          {/* Declined state */}
          {declined && (
            <div className="mx-6 sm:mx-10 mb-8 bg-surface border border-border rounded-warm-xl p-6 text-center">
              <h3 className="font-display text-lg font-bold text-text-primary mb-1">Estimate declined</h3>
              <p className="text-sm text-text-secondary">
                No problem — thanks for letting {business.name} know. If anything changes, just get in touch.
              </p>
            </div>
          )}

          {/* Accepted state */}
          {accepted && (
            <div className="mx-6 sm:mx-10 mb-8 bg-mint border border-primary/20 rounded-warm-xl p-6 text-center">
              <div
                className="grade-seal mx-auto mb-3"
                style={{ color: JUNIPER, ['--seal-gap' as never]: 'var(--color-mint)' }}
              >
                <span className="font-display text-xl font-bold">✓</span>
                <span className="mt-1 text-[7.5px] font-semibold uppercase tracking-[0.14em]">Accepted</span>
              </div>
              <h3 className="font-display text-lg font-bold text-primary mb-1">Estimate accepted</h3>
              <p className="text-sm text-text-secondary">
                Thank you! {business.name} will be in touch shortly.
              </p>
            </div>
          )}
        </div>

        <DocumentFooter footerNotes={branding?.footerNotes} showPoweredBy={branding?.showPoweredBy !== false} />
      </div>
    </div>
  )
}

/* ================= document pieces ================= */

function Letterhead({
  business,
  status,
  reference,
  customerName,
  validUntil,
  pdfUrl,
  version,
  locale,
}: {
  business: {
    name: string
    logoUrl?: string | null
    tagline?: string | null
    phone?: string | null
    email?: string | null
    website?: string | null
  }
  status: QuoteStatus
  reference?: string | null
  customerName: string
  validUntil?: string | null
  pdfUrl?: string | null
  version?: number
  locale: string
}) {
  const contactParts = [business.phone, business.email, business.website].filter(Boolean)
  return (
    <div className="px-6 sm:px-10 pt-8 pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {business.logoUrl ? (
            <img src={business.logoUrl} alt={business.name} className="h-11 object-contain" />
          ) : (
            <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary truncate">
              {business.name}
            </h1>
          )}
          {business.tagline && (
            <p className="mt-1 text-xs text-text-secondary">{business.tagline}</p>
          )}
          {contactParts.length > 0 && (
            <p className="mt-1 text-[11px] text-text-muted">
              {contactParts.join(' · ')}
            </p>
          )}
          <p className="mt-1 text-xs text-text-muted">Estimate prepared for {customerName}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-secondary bg-surface border border-border rounded-full hover:border-border-strong transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              PDF
            </a>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      {(reference || validUntil || (version && version > 1)) && (
        <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
          {reference && (
            <span className="figure text-text-secondary">{reference}</span>
          )}
          {validUntil && (
            <span className="text-text-muted">
              Valid until <span className="text-text-secondary">{formatDate(validUntil, locale)}</span>
            </span>
          )}
          {version && version > 1 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-mint text-primary">
              Revised · v{version}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** The measured-range scale: a graduated band with your price marked on it. */
function RangeScale({
  low,
  high,
  value,
  currency,
  locale,
}: {
  low: number
  high: number
  value: number
  currency: string
  locale: string
}) {
  const span = high - low
  const pct = span > 0 ? Math.min(96, Math.max(4, ((value - low) / span) * 100)) : 50
  return (
    <div className="mt-7 max-w-md">
      <div className="flex justify-between text-[11px] text-on-primary/60 mb-1.5">
        <span className="figure">{formatCurrency(low, currency, locale)}</span>
        <span className="uppercase tracking-[0.14em] font-semibold text-[10px] text-on-primary/50">Measured range</span>
        <span className="figure">{formatCurrency(high, currency, locale)}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-white/15 overflow-visible">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-butter/80"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4.5 w-[3px] rounded-full bg-butter shadow"
          style={{ left: `${pct}%`, height: '18px' }}
        />
      </div>
    </div>
  )
}

function SectionLabel({ children, tone }: { children: React.ReactNode; tone?: 'brand' | 'tape' }) {
  const color = tone === 'brand' ? 'text-primary' : tone === 'tape' ? 'text-tertiary' : 'text-text-muted'
  return (
    <h3 className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${color} mb-3`}>
      {children}
    </h3>
  )
}

/** Money with lighter pence — how fine documents set figures. */
function Money({
  amount,
  currency,
  locale,
  emphasize,
}: {
  amount: number
  currency: string
  locale: string
  emphasize?: boolean
}) {
  const symbol = currencySymbol(currency, locale)
  const [whole, pence] = amount.toFixed(2).split('.')
  const wholeFormatted = Number(whole).toLocaleString(locale)
  return (
    <span className="whitespace-nowrap">
      <span className={emphasize ? 'text-on-primary/60' : ''}>{symbol}</span>
      {wholeFormatted}
      <span className={emphasize ? 'text-[0.55em] align-super text-on-primary/60' : 'text-[0.7em]'}>.{pence}</span>
    </span>
  )
}

function DocumentFooter({
  footerNotes,
  showPoweredBy = true,
}: {
  footerNotes?: string | null
  showPoweredBy?: boolean
}) {
  return (
    <div className="text-center mt-7">
      {footerNotes && (
        <p className="mx-auto mb-3 max-w-md whitespace-pre-wrap text-[12px] text-text-secondary">
          {footerNotes}
        </p>
      )}
      {showPoweredBy && (
        <p className="text-[11px] text-text-muted">
          <span className="figure">Prepared with Aistimator</span>
        </p>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const statusConfig: Record<QuoteStatus, { label: string; className: string }> = {
    queued: { label: 'Processing', className: 'bg-butter text-tertiary' },
    generating: { label: 'Processing', className: 'bg-butter text-tertiary' },
    pending_review: { label: 'Under review', className: 'bg-butter text-tertiary' },
    awaiting_clarification: { label: 'Awaiting info', className: 'bg-butter text-tertiary' },
    sent: { label: 'Ready to review', className: 'bg-mint text-primary' },
    viewed: { label: 'Viewed', className: 'bg-mint text-primary' },
    feedback_received: { label: 'Feedback received', className: 'bg-butter text-tertiary' },
    revised: { label: 'Updated', className: 'bg-mint text-primary' },
    accepted: { label: 'Accepted', className: 'bg-secondary-light text-secondary' },
    declined: { label: 'Declined', className: 'bg-surface text-text-muted' },
    paid: { label: 'Paid', className: 'bg-secondary-light text-secondary' },
    expired: { label: 'Expired', className: 'bg-surface text-text-muted' },
    failed: { label: 'Error', className: 'bg-danger-light text-danger' },
  }

  const config = statusConfig[status] || statusConfig.sent

  return (
    <span className={`px-3 py-1 rounded-full text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </span>
  )
}

/** Engine labels embed their maths ("Hourly service  £28 x 4(Hrs)") — split it
 *  out so the ledger line stays clean and the working sits beneath in mono. */
function splitLabelMath(label: string): [string, string | null] {
  const m = label.match(/^(.*?)\s{2,}([£$€].+\sx\s.+)$/)
  if (!m) return [label, null]
  return [m[1] ?? label, (m[2] ?? '').replace(/\sx\s/, ' × ').replace(/\(/, ' ').replace(/\)/, '')]
}

/** T-133: Intl formatting with the tenant's locale (any ISO currency) */
function formatCurrency(amount: number, currency: string, locale: string): string {
  return formatMoney(amount, currency, locale)
}
