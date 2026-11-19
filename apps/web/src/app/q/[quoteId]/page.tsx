'use client'

import { AcceptDetailsForm } from '@/components/quote/AcceptDetailsForm'
import { Money, SectionLabel } from '@/components/quote/document-parts'
import { MinimumNote } from '@/components/quote/MinimumNote'
import { AlsoAskedCards } from '@/components/quote/AlsoAskedCards'
import type { AddResult, AnswerValue } from '@/components/quote/AlsoAskedCards'
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { brandStyleVars } from '@/lib/color'
import { timingLabel } from '@/lib/acceptance'
import type { QuoteViewResponse, QuoteStatus } from '@qolumns/shared'
import { formatMoney, formatDate, isQuoteProcessing, canCustomerDecide, customerDecisionWords, splitLabelMath, PRODUCT_NAME, splitMinimum, withoutMinimumNote, crossServiceLine, SLOW_PREPARING_MS, slowPreparingLine, failedRequestTitle, failedRequestLine, willConfirmLine, addedForCustomer } from '@qolumns/shared'

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

  // T-151: Accept opens the next-step questions; errors show in the page, never alert()
  const [acceptMode, setAcceptMode] = useState(false)
  const [acceptErrors, setAcceptErrors] = useState<Partial<Record<string, string>>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  // T-171: accepted just now, on this visit: the confirmation arrives once, with what the customer told the business
  const [justAccepted, setJustAccepted] = useState<{ timing: string; phone: string } | null>(null)

  // Feedback state
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState<'none' | 'feedback'>('none')
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

  // Queue path: the customer can arrive before the worker has priced the quote.
  // Poll quietly (poll=1 doesn't count as a view); once the status moves on,
  // load it normally so the real view is recorded.
  const [slowPreparing, setSlowPreparing] = useState(false)
  // the page has stopped checking (about 10 minutes): the tape stops moving
  const [stoppedChecking, setStoppedChecking] = useState(false)
  const processing = isQuoteProcessing(quote?.status)
  // T-178: after 60 seconds of "Preparing" the customer is told it is slow.
  // The page keeps checking; only the wording changes. (It used to stay on
  // "this usually takes a minute or two" for about ten minutes.)
  useEffect(() => {
    if (!processing) {
      setSlowPreparing(false)
      return
    }
    const timer = setTimeout(() => setSlowPreparing(true), SLOW_PREPARING_MS)
    return () => clearTimeout(timer)
  }, [processing])
  useEffect(() => {
    if (!processing || !token) return
    let cancelled = false
    let polls = 0
    const maxPolls = 150 // ~10 min, then stop checking
    const interval = setInterval(async () => {
      polls++
      if (polls > maxPolls) {
        clearInterval(interval)
        if (!cancelled) setStoppedChecking(true)
        return
      }
      try {
        const poll = await fetch(`/api/public/quotes/${quoteId}?token=${token}&poll=1`)
        if (!poll.ok) return
        const polled = (await poll.json()) as QuoteViewResponse
        if (cancelled || isQuoteProcessing(polled.status)) return
        clearInterval(interval)
        const full = await fetch(`/api/public/quotes/${quoteId}?token=${token}`)
        if (!cancelled && full.ok) setQuote((await full.json()) as QuoteViewResponse)
      } catch {
        // best-effort; the next tick retries
      }
    }, 4000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [processing, quoteId, token])

  // T-147: an estimate shown before approval — check quietly for the
  // business's confirmation so this same page becomes the confirmed quote
  // (with Accept) without a reload.
  const awaitingConfirmation = quote?.status === 'pending_review' && quote.review?.confirmationPending === true
  useEffect(() => {
    if (!awaitingConfirmation || !token) return
    let cancelled = false
    let polls = 0
    const interval = setInterval(async () => {
      polls++
      if (polls > 60) return clearInterval(interval) // ~15 min; a reload still works
      try {
        const poll = await fetch(`/api/public/quotes/${quoteId}?token=${token}&poll=1`)
        if (!poll.ok) return
        const polled = (await poll.json()) as QuoteViewResponse
        if (cancelled || polled.status === 'pending_review') return
        clearInterval(interval)
        const full = await fetch(`/api/public/quotes/${quoteId}?token=${token}`)
        if (!cancelled && full.ok) setQuote((await full.json()) as QuoteViewResponse)
      } catch {
        // best-effort; the next tick retries
      }
    }, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [awaitingConfirmation, quoteId, token])

  async function handleAccept(details: { timing: string; timingNote: string; address: string; phone: string }) {
    if (!token || accepting) return

    setAccepting(true)
    setActionError(null)
    setAcceptErrors({})
    try {
      const response = await fetch(`/api/public/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, details }),
      })

      if (response.ok) {
        setAccepted(true)
        setJustAccepted({ timing: timingLabel(details.timing), phone: details.phone })
        setAcceptMode(false)
        if (quote) {
          setQuote({ ...quote, status: 'accepted' as QuoteStatus })
        }
      } else {
        const data = await response.json().catch(() => null)
        if (data?.error?.fields) setAcceptErrors(data.error.fields)
        setActionError(data?.error?.message || 'We couldn’t accept this just now. Please try again.')
      }
    } catch {
      setActionError('We couldn’t reach the server. Check your connection and try again.')
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
        const data = await response.json().catch(() => null)
        setActionError(data?.error?.message || 'We couldn’t send that just now. Please try again.')
      }
    } catch {
      setActionError('We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setDeclining(false)
    }
  }

  const handleFeedback = useCallback(async () => {
    if (!token || submittingFeedback || !feedbackText.trim()) return

    setSubmittingFeedback(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/public/quotes/${quoteId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          feedbackType: 'feedback',
          feedbackText: feedbackText.trim(),
        }),
      })

      if (response.ok) {
        setFeedbackSubmitted(true)
        setFeedbackMode('none')
        if (quote) {
          // T-157: an estimate shown before approval stays pending_review on
          // the server (T-147), so it stays so here too: Accept must not
          // appear until the business confirms.
          setQuote({
            ...quote,
            questionPending: true,
            ...(quote.status !== 'pending_review' && { status: 'feedback_received' as QuoteStatus }),
          })
        }
      } else {
        const data = await response.json().catch(() => null)
        setActionError(data?.error?.message || 'We couldn’t send your message just now. Please try again.')
      }
    } catch {
      setActionError('We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setSubmittingFeedback(false)
    }
  }, [token, quoteId, feedbackText, submittingFeedback, quote])

  // T-179: the customer adds a service they asked for to this quote, or takes
  // one off again. The server prices it (the business's price list, no AI)
  // and works the totals out; the page then reads the quote afresh.
  const [changingSection, setChangingSection] = useState<string | null>(null)
  const [sectionNote, setSectionNote] = useState<string | null>(null)
  const reloadQuote = useCallback(async () => {
    const fresh = await fetch(`/api/public/quotes/${quoteId}?token=${token}&poll=1`)
    if (fresh.ok) setQuote((await fresh.json()) as QuoteViewResponse)
  }, [quoteId, token])
  const addSection = useCallback(
    async (serviceId: string, answers: Array<{ fieldId: string; value: AnswerValue }>): Promise<AddResult> => {
      setSectionNote(null)
      try {
        const response = await fetch(`/api/public/quotes/${quoteId}/sections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, serviceId, answers }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          return { ok: false, message: data?.error?.message || 'We couldn’t add that just now. Please try again.', questions: data?.error?.questions }
        }
        await reloadQuote()
        return { ok: true }
      } catch {
        return { ok: false, message: 'We couldn’t reach the server. Check your connection and try again.' }
      }
    },
    [quoteId, token, reloadQuote]
  )
  const removeSection = useCallback(
    async (serviceId: string) => {
      setChangingSection(serviceId)
      setSectionNote(null)
      try {
        const response = await fetch(`/api/public/quotes/${quoteId}/sections`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, serviceId }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => null)
          setSectionNote(data?.error?.message || 'We couldn’t remove that just now. Please try again.')
        } else {
          await reloadQuote()
        }
      } catch {
        setSectionNote('We couldn’t reach the server. Check your connection and try again.')
      } finally {
        setChangingSection(null)
      }
    },
    [quoteId, token, reloadQuote]
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="tape-rule tape-measuring w-40 mx-auto" aria-hidden="true" />
          <p className="mt-4 text-sm text-text-secondary">Preparing your estimate…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md bg-surface border border-border rounded-3xl shadow-warm-md p-8">
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

  const { business, branding, customer, pricing, notes, validUntil, assets, status, actions, crossServicePricing, signalRecommendations, version: quoteVersion, acceptQuoteEnabled, reference, review, estimateRange } = quote
  // T-146: exactly two customer states — an unreviewed Estimate or a reviewed Quote
  const isReviewedQuote = review?.state === 'quote'
  // T-158: "quote" around Accept and Decline once the business has reviewed
  // it; "estimate" on one that was sent automatically
  const words = customerDecisionWords(isReviewedQuote)
  // T-133: tenant locale for money and dates (legacy quotes without one render as before)
  const locale = quote.locale || 'en-GB'
  const brandVars = brandStyleVars(branding?.primaryColor)
  // T-165: the minimum charge is a floor, not an item. The customer sees the
  // job's real lines, then one note above the total when the minimum applied;
  // nothing when it did not. (shared/minimum-charge.ts; it also reads quotes
  // stored with the top-up as a line, and drops the sentence the engine used
  // to repeat among the notes.)
  const { lines: priceLines, minimum: minimumApplied } = splitMinimum(pricing.breakdown)
  const pricingNotes = withoutMinimumNote(pricing.notes)
  // T-171: what was read or measured, in the customer's terms (never the takeoff's amounts)
  const readLines = quote.read ?? []
  const showAcceptButton = acceptQuoteEnabled !== false
  // T-147: the estimate is shown while the business reviews it — Accept is
  // locked until they confirm; asking a question stays available
  const confirmationPending = status === 'pending_review' && review?.confirmationPending === true
  // T-157: a question the business has not answered yet (also after a reload).
  // It never hides Accept or Decline; only a second question stays off.
  const questionOpen = feedbackSubmitted || quote.questionPending === true
  const settled = accepted || declined
  const canDecide = canCustomerDecide(status) && !settled
  const canAskQuestion =
    (['sent', 'viewed', 'revised'].includes(status) || confirmationPending) && !questionOpen && !settled
  const showActions = (canDecide || confirmationPending) && !settled

  // Not priced yet (queued / generating), or processing failed: no document to show
  // T-146: held for the business with no price to show yet — same holding screen
  const awaitingBusiness = status === 'pending_review' && !quote.provisional && !confirmationPending
  if (processing || status === 'failed' || awaitingBusiness) {
    const failed = status === 'failed'
    return (
      <div className="min-h-screen bg-background py-8 px-4 sm:py-14" style={brandVars}>
        <div className="max-w-2xl mx-auto animate-fade-in-up">
          <div className="bg-background rounded-3xl shadow-document overflow-hidden">
            <Letterhead
              business={business}
              reference={reference}
              customerName={customer.name}
              locale={locale}
            />
            <div className="px-6 sm:px-10 py-10 bg-primary text-on-primary" role="status" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-primary mb-3">
                Estimate for {customer.name}
              </p>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
                {failed ? failedRequestTitle(business.name) : awaitingBusiness ? 'Your estimate is being prepared' : 'Preparing your estimate'}
              </h1>
              <div className={`tape-rule-light mt-8 ${failed || stoppedChecking || awaitingBusiness ? '' : 'tape-measuring'}`} aria-hidden="true" />
              <p className="mt-6 text-sm text-on-primary max-w-md" data-testid={failed ? 'request-failed' : slowPreparing && !awaitingBusiness ? 'preparing-slow' : 'preparing'}>
                {awaitingBusiness
                  ? `${business.name} will review and send it shortly.`
                  : failed
                  ? failedRequestLine(business.name)
                  : slowPreparing
                    ? slowPreparingLine(customer.hasEmail !== false)
                    : `${business.name} is pricing your job from the details you sent. This usually takes a minute or two — this page updates by itself.`}
              </p>
              {!failed && !slowPreparing && customer.hasEmail !== false && (
                <p className="mt-2 text-xs text-on-primary max-w-md">
                  You can close it: we’ll email you the link as soon as it’s ready.
                </p>
              )}
            </div>
          </div>
          <DocumentFooter footerNotes={branding?.footerNotes} showPoweredBy={branding?.showPoweredBy !== false} />
        </div>
      </div>
    )
  }

  // T-109 range-first: provisional quotes show an estimated range, not exact pricing
  if (quote.provisional) {
    const { rangeLow, rangeHigh, reason } = quote.provisional
    return (
      <div className="min-h-screen bg-background py-8 px-4 sm:py-14" style={brandVars}>
        <div className="max-w-2xl mx-auto animate-fade-in-up">
          <div className="bg-background rounded-3xl shadow-document overflow-hidden">
            <Letterhead
              business={business}
              reference={reference}
              customerName={customer.name}
              validUntil={validUntil}
              pdfUrl={actions.pdfUrl}
              locale={locale}
            />

            {/* Provisional price instrument */}
            <div className="px-6 sm:px-10 py-10 bg-primary text-on-primary">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-primary mb-3">
                {reason === 'pending_review' ? 'Your estimate is being prepared' : `Estimate for ${customer.name}`}
              </p>
              <p className="figure text-4xl sm:text-5xl font-medium tracking-tight">
                <Money amount={rangeLow} currency={pricing.currency} locale={locale} />
                <span className="text-on-primary mx-2 font-light" aria-hidden="true">—</span>
                <Money amount={rangeHigh} currency={pricing.currency} locale={locale} />
              </p>

              <div className="tape-rule-light mt-8" />

              {reason === 'awaiting_clarification' ? (
                <div className="mt-6">
                  <p className="text-sm text-on-primary mb-5 max-w-md">
                    Confirm a couple of details so we can price it for your job. It takes less than a minute.
                  </p>
                  <a
                    href={`/q/${quoteId}/clarify?token=${token}`}
                    className="inline-flex min-h-[48px] items-center px-6 py-3.5 bg-on-primary text-primary font-semibold rounded-xl active:scale-[0.99] transition" data-testid="confirm-details"
                  >
                    Confirm details
                  </a>
                </div>
              ) : (
                <p className="mt-6 text-sm text-on-primary max-w-md">
                  Your estimate is being prepared. {business.name} will review and send it shortly.
                </p>
              )}
            </div>

            {pricingNotes.length > 0 && (
              <div className="px-6 sm:px-10 py-6">
                {pricingNotes.map((note, i) => (
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
        <div className="animate-fade-in-up bg-background rounded-3xl shadow-document overflow-hidden">
          <Letterhead
            business={business}
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-primary mb-3">
                  {isReviewedQuote ? 'Your quote' : 'Your estimate'}{pricing.taxAmount > 0 ? ` · incl. ${pricing.taxLabel || 'tax'}` : ''}
                </p>
                <p className="figure text-5xl sm:text-6xl font-medium tracking-tight leading-none">
                  <Money amount={pricing.total} currency={pricing.currency} locale={locale} emphasize />
                </p>
                <p className="mt-4 text-[13px] leading-snug text-on-primary max-w-sm">
                  {isReviewedQuote
                    ? `Reviewed and confirmed by ${business.name}.`
                    : `This is an estimate based on your photos and details. ${business.name} will review and confirm it.`}
                </p>
              </div>
            </div>

            {/* Price range for uncertain quantities — no label */}
            {estimateRange && (
              <RangeScale
                low={estimateRange.low}
                high={estimateRange.high}
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

              {/* T-179: a combined quote shows each service as a section with its subtotal; a single-service quote is unchanged */}
              {quote.sections && quote.sections.length > 0 ? (
                <div className="mb-5 space-y-6" data-testid="price-sections">
                  {quote.sections.map((section, sectionIndex) => (
                    <div key={section.serviceId ?? sectionIndex} data-testid="price-section" data-main={section.main ? 'true' : 'false'}>
                      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 className="text-sm font-semibold text-text-primary" data-testid="price-section-name">
                          {section.serviceName}
                        </h3>
                        {!section.main && section.addedBy === 'customer' && quote.canChangeSections && !settled && section.serviceId && (
                          <button
                            type="button"
                            onClick={() => removeSection(section.serviceId as string)}
                            disabled={changingSection !== null}
                            className="inline-flex min-h-[44px] items-center text-sm text-text-secondary underline underline-offset-4 hover:text-text-primary disabled:opacity-50"
                            data-testid="price-section-remove"
                          >
                            {changingSection === section.serviceId ? 'Removing…' : 'Remove'}
                          </button>
                        )}
                      </div>
                      {section.awaitingApproval ? (
                        // its service is approved by the business first: no price for this part yet, and it is not in the total
                        <p className="border-t border-border pt-2 text-sm text-text-secondary" data-testid="price-section-awaiting">
                          {willConfirmLine(business.name)}
                        </p>
                      ) : (
                        <>
                          <PriceLines lines={section.lines} currency={pricing.currency} locale={locale} />
                          <div className="mt-2.5 space-y-1.5">
                            <MinimumNote minimumCharge={section.minimum?.minimumCharge} currency={pricing.currency} locale={locale} />
                            <div className="flex justify-between border-t border-border pt-2 text-sm">
                              <span className="text-text-secondary">{section.serviceName} subtotal</span>
                              <span className="figure text-text-primary" data-testid="price-section-subtotal">
                                {formatCurrency(section.subtotal, pricing.currency, locale)}
                              </span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {sectionNote && (
                    <p className="text-sm text-danger" role="alert">
                      {sectionNote}
                    </p>
                  )}
                </div>
              ) : (
                priceLines.length > 0 && (
                  <div className="mb-5">
                    <PriceLines lines={priceLines} currency={pricing.currency} locale={locale} />
                  </div>
                )
              )}

              {pricingNotes.length > 0 && (
                <div className="border rounded-xl px-4 py-3.5 mb-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-tertiary mb-1.5">Worth knowing</p>
                  <ul className="text-[13px] leading-relaxed text-tertiary space-y-1.5">
                    {pricingNotes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-t border-border pt-4 space-y-2">
                {/* a combined quote states each service's minimum in its own section, above */}
                {!(quote.sections && quote.sections.length > 0) && (
                  <MinimumNote minimumCharge={minimumApplied?.minimumCharge} currency={pricing.currency} locale={locale} />
                )}
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

            {/* Measurement & takeoff. T-171: what was read or measured, in the customer's terms, and only
                that: the price lines are above, once, and are not repeated here. No amounts, no rates, nothing
                about how a quantity was fixed. The lines are built on the server (lib/customer-read.ts). */}
            {readLines.length > 0 && (
              <section className="mb-8" data-testid="what-was-read">
                <div className="rounded-2xl border border-tape/40 bg-butter/40 overflow-hidden">
                  <div className="px-5 pt-4 pb-3">
                    <SectionLabel tone="tape">Measurement &amp; takeoff</SectionLabel>
                    <p className="text-xs text-text-muted -mt-1">
                      What was measured or read for this estimate.
                    </p>
                  </div>
                  <div className="tape-rule mx-5" />
                  <ul className="px-5 py-4 space-y-2">
                    {readLines.map((line) => (
                      <li key={line} className="text-sm text-text-primary" data-testid="read-line">{line}</li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* Optional extras */}
            {pricing.availableAddons && pricing.availableAddons.length > 0 && (
              <section className="mb-8">
                <div className="bg-mint/70 border border-primary/15 rounded-2xl px-5 py-4">
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

            {/* T-179: other services the customer asked for (they can add them to this quote), and anything not offered */}
            {quote.alsoAsked && quote.alsoAsked.length > 0 && (
              <AlsoAskedCards
                items={quote.alsoAsked}
                currency={pricing.currency}
                locale={locale}
                canChange={quote.canChangeSections === true && !settled}
                businessName={business.name}
                onAdd={addSection}
              />
            )}

            {/* Cross-service pricing (quotes made before T-179) */}
            {crossServicePricing && crossServicePricing.length > 0 && !(quote.alsoAsked && quote.alsoAsked.length > 0) && (
              <section className="mb-8">
                <div className="bg-mist/70 border border-border rounded-2xl px-5 py-4">
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
                            <div key={i}>{crossServiceLine(line)}</div>
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
                <div className="bg-surface border border-border rounded-2xl px-5 py-4">
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
                <div className="border-l-2 pl-4">
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
                      className="block aspect-square bg-surface rounded-xl overflow-hidden hover:opacity-85 transition-opacity"
                    >
                      <img
                        src={asset.smallUrl ?? asset.viewUrl}
                        alt="Attached photo"
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    </a>
                  ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {showActions && (
            <div className="px-6 sm:px-10 pb-8">
              <div className="tape-rule mb-7" />
              {confirmationPending && (
                <p className="mb-6 rounded-xl border border-border bg-surface px-4 py-3.5 text-center text-sm text-text-secondary">
                  You can accept once {business.name} confirms this estimate.
                </p>
              )}
              {actionError && (
                <p role="alert" className="mb-5 rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger" data-testid="action-error">
                  {actionError}
                </p>
              )}
              {showAcceptButton && canDecide && acceptMode && (
                <div className="mb-6">
                  <AcceptDetailsForm
                    businessName={business.name}
                    initialPhone={customer.phone || ''}
                    submitting={accepting}
                    serverErrors={acceptErrors}
                    onCancel={() => {
                      setAcceptMode(false)
                      setActionError(null)
                    }}
                    onConfirm={handleAccept}
                  />
                </div>
              )}
              {showAcceptButton && canDecide && !acceptMode && (
                <>
                  <button
                    onClick={() => setAcceptMode(true)}
                    disabled={accepting}
                    className="w-full py-4 px-4 rounded-2xl font-display font-bold text-on-primary text-base bg-primary hover:bg-primary-hover active:scale-[0.995] disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {accepting ? 'Accepting…' : `${words.accept} — ${formatCurrency(pricing.total, pricing.currency, locale)}`}
                  </button>
                  <p className="text-xs text-text-muted text-center mt-2.5">
                    Accepting tells {business.name} to go ahead. Nothing is charged today.
                  </p>

                  {canAskQuestion && (
                    <div className="flex items-center my-6">
                      <div className="flex-1 border-t border-border" />
                      <span className="px-3 text-xs text-text-muted">or</span>
                      <div className="flex-1 border-t border-border" />
                    </div>
                  )}
                </>
              )}

              {canAskQuestion && feedbackMode === 'none' && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setFeedbackMode('feedback')}
                    className="flex-1 py-3 px-4 text-sm font-semibold text-text-primary bg-surface border border-border rounded-xl hover:border-border-strong transition"
                  >
                    Ask a question
                  </button>
                </div>
              )}

              {canAskQuestion && feedbackMode === 'feedback' && (
                <div className="space-y-3">
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Questions, changes, anything we should know…"
                    className="w-full px-4 py-3 text-sm border border-border rounded-xl bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:border-primary resize-none transition"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setFeedbackMode('none'); setFeedbackText('') }}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-text-secondary border border-border rounded-xl hover:bg-surface transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleFeedback}
                      disabled={submittingFeedback || !feedbackText.trim()}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {submittingFeedback ? 'Sending…' : 'Send message'}
                    </button>
                  </div>
                </div>
              )}

              {/* Decline — deliberately quiet, below the primary actions */}
              {!declineMode && canDecide && (
                <p className="text-center mt-6">
                  <button
                    onClick={() => setDeclineMode(true)}
                    className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary transition"
                  >
                    {words.declineLink}
                  </button>
                </p>
              )}

              {declineMode && canDecide && (
                <div className="mt-6 space-y-3 border border-border rounded-xl p-4 bg-surface">
                  <p className="text-sm font-semibold text-text-primary">{words.declineTitle}</p>
                  <textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="Optional: let us know why, it helps us improve"
                    maxLength={500}
                    className="w-full px-4 py-3 text-sm border border-border rounded-xl bg-white text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:border-primary resize-none transition"
                    rows={3}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setDeclineMode(false); setDeclineReason('') }}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-text-secondary border border-border rounded-xl hover:bg-white transition"
                    >
                      {words.keep}
                    </button>
                    <button
                      onClick={handleDecline}
                      disabled={declining}
                      className="flex-1 py-3 px-4 text-sm font-semibold text-danger border border-danger/30 rounded-xl hover:bg-danger-light disabled:opacity-50 transition"
                    >
                      {declining ? 'Declining…' : words.declineButton}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Question sent: stays while the business has not answered it */}
          {questionOpen && !settled && (
            <div className="mx-6 sm:mx-10 mb-8 bg-mint border border-primary/15 rounded-2xl p-6 text-center">
              <h3 className="font-display text-lg font-bold text-text-primary mb-1">Message sent</h3>
              <p className="text-sm text-text-secondary">
                {business.name} will review it and get back to you.
              </p>
            </div>
          )}

          {/* Declined state */}
          {declined && (
            <div className="mx-6 sm:mx-10 mb-8 bg-surface border border-border rounded-2xl p-6 text-center">
              <h3 className="font-display text-lg font-bold text-text-primary mb-1">{words.declined}</h3>
              <p className="text-sm text-text-secondary">
                No problem — thanks for letting {business.name} know. If anything changes, just get in touch.
              </p>
            </div>
          )}

          {/* Accepted state. T-171: one short entrance when it has just happened (250 ms, opacity and a small
              rise; nothing under reduced motion), then what happens next in three steps. The business has no
              setting for these words yet, so they are ours, with its name and what the customer just said. */}
          {accepted && (
            <div
              className={`mx-6 sm:mx-10 mb-8 bg-mint border border-secondary-line rounded-2xl p-6 ${justAccepted ? 'animate-fade-in-up' : ''}`}
              role="status"
              data-testid="accepted"
              data-just-accepted={justAccepted ? 'true' : 'false'}
            >
              <div className="text-center">
                <div
                  className="grade-seal mx-auto mb-3"
                  style={{ color: JUNIPER, ['--seal-gap' as never]: 'var(--color-mint)' }}
                >
                  <span className="font-display text-xl font-bold">✓</span>
                  <span className="mt-1 text-[7.5px] font-semibold uppercase tracking-[0.14em]">Accepted</span>
                </div>
                <h3 className="font-display text-lg font-bold text-secondary mb-1">{words.accepted}</h3>
                <p className="text-sm text-text-secondary">Thank you. {business.name} has your details.</p>
              </div>
              <div className="mt-5 border-t border-secondary-line pt-5" data-testid="what-happens-next">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-text-secondary">What happens next</h4>
                <ol className="mt-3 space-y-3">
                  {[
                    {
                      title: `${business.name} gets in touch`,
                      text: justAccepted ? `They will call or text you on ${justAccepted.phone}.` : 'They will call or text you on the number you gave.',
                    },
                    {
                      title: 'You agree a time',
                      text: justAccepted ? `For a visit or to book the job. You said: ${justAccepted.timing.charAt(0).toLowerCase()}${justAccepted.timing.slice(1)}.` : 'For a visit or to book the job, at a time that suits you.',
                    },
                    {
                      title: 'The job',
                      text: `${business.name} does the work set out above. Nothing is charged today.`,
                    },
                  ].map((step, i) => (
                    <li key={step.title} className="flex gap-3" data-testid="next-step">
                      <span className="figure flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-secondary text-xs text-secondary" aria-hidden="true">{i + 1}</span>
                      <span className="min-w-0 text-sm">
                        <span className="block font-semibold text-text-primary">{step.title}</span>
                        <span className="block text-text-secondary">{step.text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>

        <DocumentFooter footerNotes={branding?.footerNotes} showPoweredBy={branding?.showPoweredBy !== false} />
      </div>
    </div>
  )
}

/* ================= document pieces ================= */

/**
 * T-171: no status pill here ("Viewed", "Under review" were the database's
 * words). The line under the price says where the estimate stands.
 */
function Letterhead({
  business,
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
          {/* T-183: a logo never stands in for the name. With a logo, the name is beside it; with none, the name alone. */}
          <div className="flex min-w-0 items-center gap-3" data-testid="business-identity">
            {business.logoUrl && (
              // the name is beside it, so the picture needs no words of its own
              <img src={business.logoUrl} alt="" className="h-11 w-auto max-w-[9rem] shrink-0 object-contain" data-testid="business-logo" />
            )}
            <h1 className="min-w-0 break-words font-display text-2xl font-bold tracking-tight text-text-primary" data-testid="business-name">
              {business.name}
            </h1>
          </div>
          {business.tagline && (
            <p className="mt-1 text-xs text-text-secondary">{business.tagline}</p>
          )}
          {contactParts.length > 0 && (
            <p className="mt-1 text-xs text-text-muted">
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
      <div className="flex justify-between text-xs text-on-primary mb-1.5">
        <span className="figure">{formatCurrency(low, currency, locale)}</span>
        <span aria-hidden="true" />
        <span className="figure">{formatCurrency(high, currency, locale)}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-on-primary/20 overflow-visible">
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
        <p className="text-xs text-text-muted" data-testid="prepared-with">
          <span className="figure">Prepared with {PRODUCT_NAME}</span>
        </p>
      )}
    </div>
  )
}

/** T-133: Intl formatting with the tenant's locale (any ISO currency) */
/** One service's price lines, as the ledger has always shown them (T-179: used once per section on a combined quote) */
function PriceLines({
  lines,
  currency,
  locale,
}: {
  lines: Array<{ label: string; amount: number; autoRecommended?: boolean; source?: unknown }>
  currency: string
  locale: string
}) {
  if (lines.length === 0) return null
  return (
    <div className="space-y-2.5">
      {lines.map((item, index) => {
        const [labelMain, labelMath] = splitLabelMath(item.label)
        return (
          <div key={index}>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="text-text-primary">{labelMain}</span>
              <span className="flex-1 border-b border-dotted border-border-strong translate-y-[-3px]" />
              <span className="figure text-text-primary whitespace-nowrap">{formatCurrency(item.amount, currency, locale)}</span>
            </div>
            {labelMath && <p className="figure text-xs text-text-muted mt-0.5">{labelMath}</p>}
            {item.autoRecommended && (
              <p className="text-xs text-primary mt-0.5" data-testid="added-for-you">
                {/* T-189: the line's real source (photos or description), not the engine's one reason for every extra */}
                {addedForCustomer(item.source)}
              </p>
            )}
          </div>
        )
      })}
      {lines.some((item) => item.autoRecommended) && (
        <p className="text-xs text-text-muted pt-1">
          Items marked &quot;added for you&quot; came from your description or photos —
          ask us to remove any you don&apos;t need.
        </p>
      )}
    </div>
  )
}

function formatCurrency(amount: number, currency: string, locale: string): string {
  return formatMoney(amount, currency, locale)
}
