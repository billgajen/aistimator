'use client'

import { AcceptanceCard } from '@/components/quotes/AcceptanceCard'
import type { AcceptanceDetails } from '@/lib/acceptance'
import { useEffect, useState, useCallback } from 'react'
import { QUOTE_TURN_COPY, anyMeasuredFromPhotos, businessSources, certaintyLabel, certaintySentence, formatMoney, isQuoteProcessing, lineLabelNow, lineSourceCodes, quoteActions, quoteStory, customerFirstName, splitMinimum, addedSections, alsoAskedOf, alsoAskedWithStates, displaySections, sectionsAwaitingApproval } from '@qolumns/shared'
import { BusinessQuestions } from '@/components/quotes/BusinessQuestions'
import { NextStepBox } from '@/components/quotes/NextStepBox'
import { CustomerSent, ServiceSuggestionNote } from '@/components/quotes/CustomerSent'
import { CustomerAlsoAsked } from '@/components/quotes/CustomerAlsoAsked'
import { MinimumNote } from '@/components/quote/MinimumNote'
import { QuoteTracker } from '@/components/quotes/QuoteTracker'
import { TurnBadge } from '@/components/quotes/TurnBadge'
import { approvedWithoutEmailMessage, copyLinkFallbackMessage } from '@/lib/quote-action-copy'
import Link from 'next/link'
import { FinalInvoiceCard } from '@/components/analytics/FinalInvoiceCard'
import { UnderstoodPanel } from '@/components/quotes/UnderstoodPanel'
import { Money } from '@/components/quote/document-parts'
import { RoomScanCard } from '@/components/room-scan/RoomScanCard'
import { EstimateReport } from '@/components/help/EstimateReport'
import type {
  QuoteDetailResponse,
  QuotePricing,
  QuoteContent,
  AmendmentSummary,
  QuoteFeedback,
} from '@qolumns/shared'

/** T-186: after the business answers its questions, how often and how many times the page looks for the new price */
const REPRICE_LOOK_MS = 2000
const REPRICE_LOOKS = 15

export default function QuoteDetailPage({
  params,
}: {
  params: { quoteId: string }
}) {
  const { quoteId } = params
  const [data, setData] = useState<QuoteDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [resending, setResending] = useState(false)
  // T-136: text the quote link by SMS
  const [texting, setTexting] = useState(false)
  // T-134: price a lead held by the plan limit
  const [pricingHeld, setPricingHeld] = useState(false)
  const [priceResult, setPriceResult] = useState<string | null>(null)
  // T-157: one line under the header for what an action did, or why it
  // couldn't. Errors show here, never in a browser alert().
  const [actionNote, setActionNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [copying, setCopying] = useState(false)
  const [answering, setAnswering] = useState<string | null>(null)
  // T-188: the card for answering a customer's open questions for them is behind a quiet link
  const [answeringForCustomer, setAnsweringForCustomer] = useState(false)

  /** Loads the quote; answers its status, or null when it could not be loaded */
  const fetchQuote = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(`/api/quotes/${quoteId}`)
      if (!response.ok) {
        const errData = await response.json()
        setError(errData.error?.message || 'Failed to load quote')
        return null
      }
      const result = (await response.json()) as QuoteDetailResponse
      setData(result)
      return result.quote.status
    } catch {
      setError('Failed to load quote')
      return null
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => {
    fetchQuote()
  }, [fetchQuote])

  const handleResend = async () => {
    setResending(true)
    setActionNote(null)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/resend`, {
        method: 'POST',
      })
      const json = await response.json().catch(() => null)
      if (response.ok) {
        setActionNote({ text: 'Sent to the customer again', tone: 'ok' })
        await fetchQuote()
      } else {
        setActionNote({ text: json?.error?.message || 'Could not send this quote again', tone: 'error' })
      }
    } catch {
      setActionNote({ text: 'Could not send this quote again. Check your connection and try again.', tone: 'error' })
    } finally {
      setResending(false)
    }
  }

  // T-157: a link the business can send any way it likes. It is the only way
  // to reach a customer who gave no email address.
  const handleCopyLink = async () => {
    setCopying(true)
    setActionNote(null)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.quoteViewUrl) {
        setActionNote({ text: json?.error?.message || 'Could not make a link for this quote', tone: 'error' })
        return
      }
      try {
        await navigator.clipboard.writeText(json.quoteViewUrl)
        setActionNote({ text: 'Link copied', tone: 'ok' })
      } catch {
        // The browser refused the clipboard: show the link so it can be copied by hand
        setActionNote({ text: copyLinkFallbackMessage(json.quoteViewUrl), tone: 'ok' })
      }
    } catch {
      setActionNote({ text: 'Could not make a link for this quote. Check your connection and try again.', tone: 'error' })
    } finally {
      setCopying(false)
    }
  }

  // T-146: one-tap approval of a quote awaiting review
  const [approving, setApproving] = useState(false)
  const handleApprove = async () => {
    setApproving(true)
    setActionNote(null)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/approve`, { method: 'POST' })
      const json = await response.json().catch(() => null)
      if (response.ok) {
        // T-157: never point at Text link when it isn't on the page
        setActionNote({
          text: json?.emailed ? 'Sent to the customer' : approvedWithoutEmailMessage({ smsActive: data?.smsActive === true }),
          tone: 'ok',
        })
        await fetchQuote()
      } else {
        setActionNote({ text: json?.error?.message || 'Could not approve this quote', tone: 'error' })
      }
    } catch {
      setActionNote({ text: 'Could not approve this quote', tone: 'error' })
    } finally {
      setApproving(false)
    }
  }

  const handlePriceHeldLead = async () => {
    setPricingHeld(true)
    setPriceResult(null)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/process`, { method: 'POST' })
      const json = await response.json().catch(() => null)
      if (response.ok) {
        setPriceResult('Pricing started — this page will update shortly')
        await fetchQuote()
      } else {
        setPriceResult(json?.error?.message || 'Could not price this lead')
      }
    } finally {
      setPricingHeld(false)
    }
  }

  const handleTextLink = async () => {
    setTexting(true)
    setActionNote(null)
    try {
      const response = await fetch('/api/sms/send-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId }),
      })
      const json = await response.json().catch(() => null)
      if (response.ok) {
        setActionNote({ text: json?.test ? `Recorded (test mode) to ${json.to}` : `Texted to ${json?.to}`, tone: 'ok' })
        await fetchQuote()
      } else {
        setActionNote({ text: json?.error?.message || 'Failed to text the link', tone: 'error' })
      }
    } catch {
      setActionNote({ text: 'Failed to text the link', tone: 'error' })
    } finally {
      setTexting(false)
    }
  }

  // T-157: "Mark as answered" is saved (it used to change the screen only and
  // come back on refresh). The quote is re-read, since answering the last open
  // question moves it from "Feedback" back to "Viewed".
  const handleMarkAnswered = async (feedbackId: string) => {
    setAnswering(feedbackId)
    setActionNote(null)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/feedback/${feedbackId}/answered`, { method: 'POST' })
      const json = await response.json().catch(() => null)
      if (response.ok) {
        await fetchQuote()
      } else {
        setActionNote({ text: json?.error?.message || 'Could not save that. Please try again.', tone: 'error' })
      }
    } catch {
      setActionNote({ text: 'Could not save that. Check your connection and try again.', tone: 'error' })
    } finally {
      setAnswering(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p className="text-text-secondary">{error || 'Quote not found'}</p>
        <Link href="/app/quotes" className="text-primary text-sm mt-2 inline-block">
          Back to Quotes
        </Link>
      </div>
    )
  }

  const { quote, service, amendments, feedback } = data
  const pricing = quote.pricing_json as QuotePricing
  const content = quote.content_json as QuoteContent
  // T-165: the minimum charge is a floor, not an item: the job's lines, then a note
  const { lines: priceLines, minimum: minimumApplied } = splitMinimum(pricing.breakdown)
  // T-179: a combined quote's sections (null for a single-service quote, which renders as before)
  const combined = displaySections(pricing, { serviceId: quote.service_id, serviceName: data.service?.name ?? 'Service' })
  const customer = quote.customer_json as { name: string; email: string; phone?: string }
  // T-169: the big total is set like the customer's page sets it; the browser's locale, as the rest of the dashboard (T-133)
  const moneyLocale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  const pendingFeedback = feedback.filter((f) => f.status === 'pending')
  // T-157: a button only shows when it will work. These are the rules the
  // routes behind the buttons apply (packages/shared/src/quote-status.ts).
  const actions = quoteActions(quote.status, {
    hasEmail: Boolean(customer?.email),
    smsActive: data.smsActive === true,
  })
  const canEdit = actions.edit
  // T-151: what the customer told the business when accepting
  const acceptance = (quote as unknown as { acceptance_json?: AcceptanceDetails | null }).acceptance_json ?? null
  // T-146: a priced quote waiting for the business; held leads are priced first
  const held = (content as { limitHold?: boolean } | null)?.limitHold === true
  const awaitingApproval = quote.status === 'pending_review' && !held && (pricing?.total ?? 0) > 0
  // T-158, T-186: whose turn it is, the one next step and the Progress steps, from the one shared
  // function, so the badge, the sentence and Progress tell the same story. The same function
  // words the quotes list, Home and the on-site app.
  const businessQuestions = data.businessQuestions ?? []
  const story = quoteStory({
    status: quote.status,
    customerName: customer?.name,
    hasEmail: Boolean(customer?.email),
    total: pricing?.total,
    held,
    createdAt: quote.created_at,
    approvedAt: quote.approved_at,
    sentAt: quote.sent_at,
    viewedAt: quote.viewed_at,
    acceptedAt: quote.accepted_at,
    paidAt: quote.paid_at,
    declinedAt: quote.declined_at,
    expiresAt: quote.token_expires_at,
    madeByBusiness: data.madeByBusiness === true,
    openQuestions: businessQuestions.length,
  })
  const turn = story.turn
  const trackerSteps = story.steps
  // T-188: where each line came from, in the words the app, the approval page and the review email use
  // (one shared function): a line the product added from the photos or the notes says so
  const madeByBusiness = data.madeByBusiness === true
  const takeoff = (content as { takeoff?: unknown } | null)?.takeoff
  const lineNotes = businessSources(priceLines, takeoff, { madeByBusiness })
  // T-188: a request that waits for its customer's answers: the business can answer for them
  const customerQuestions = data.customerQuestions ?? []
  // T-186: was anything on this quote measured from the photos? An older quote's stored sentence may
  // say so when nothing was; the shared rule then shows one the quote does not contradict.
  const measuredOnQuote = anyMeasuredFromPhotos([
    ...lineSourceCodes(priceLines, (content as { takeoff?: unknown } | null)?.takeoff),
    ...addedSections(pricing).flatMap((section) => lineSourceCodes(splitMinimum(section.breakdown).lines)),
  ])

  if (editMode) {
    // Dynamic import to keep initial bundle small
    return (
      <QuoteEditorWrapper
        quoteId={quoteId}
        quote={quote}
        pricing={pricing}
        content={content}
        pendingFeedback={pendingFeedback}
        onSave={async () => {
          setEditMode(false)
          setLoading(true)
          await fetchQuote()
        }}
        onCancel={() => setEditMode(false)}
      />
    )
  }

  // T-169: the main controls are 44 px tall on a phone (system.md, Layout)
  const HEADER_BUTTON = 'inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-50 sm:min-h-[40px]'
  const QUIET = `${HEADER_BUTTON} border border-field bg-background text-text-primary hover:bg-surface`

  /*
   * T-169: the page reads top to bottom in one order (it was eight grey boxes
   * of the same weight):
   *   1 the next step            white, the one main button
   *   2 what the AI understood   on mist, with the customer's photos
   *   3 the price                white, the total in the figure style the customer sees
   *   4 the rest                 one quiet card, divided by rules
   */
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/app/quotes"
            aria-label="Back to quotes"
            className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
            data-testid="back-to-quotes"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-extrabold text-text-primary">
              Quote for {customer.name}
              {(quote as { is_test?: boolean }).is_test && (
                <span className="ml-2 inline-flex items-center rounded-full bg-butter px-2 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-tertiary" title="A test request from setup. It doesn't count toward your plan.">
                  Test
                </span>
              )}
            </h1>
            <p className="text-sm text-text-secondary">
              {service.name} &middot; Created {formatDate(quote.created_at)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <TurnBadge turn={turn} showDetail={false} />
          {/* T-158: a button that is the next step sits in the Next step box, not here as well */}
          {canEdit && turn.action !== 'add_price' && (
            <button onClick={() => setEditMode(true)} className={QUIET}>
              Edit
            </button>
          )}
          {actions.sendAgain && turn.action !== 'send_again' && (
            <button
              onClick={handleResend}
              disabled={resending}
              className={`${HEADER_BUTTON} bg-primary text-white hover:bg-primary-hover`}
              data-testid="send-again"
            >
              {resending ? 'Sending…' : 'Send again'}
            </button>
          )}
          {actions.copyLink && (
            <button onClick={handleCopyLink} disabled={copying} className={QUIET} data-testid="copy-link">
              {copying ? 'Copying…' : 'Copy link'}
            </button>
          )}
          {actions.textLink && (
            <button onClick={handleTextLink} disabled={texting} className={QUIET} data-testid="text-link">
              {texting ? 'Texting…' : 'Text link'}
            </button>
          )}
        </div>
      </div>

      {/* T-157: what the last action did, or why it couldn't (never an alert) */}
      {actionNote && (
        <p
          role={actionNote.tone === 'error' ? 'alert' : 'status'}
          data-testid="action-note"
          className={`mb-6 break-words rounded-lg border px-4 py-3 text-sm ${
            actionNote.tone === 'error'
              ? 'border-danger-line bg-danger-light text-danger'
              : 'border-border bg-surface text-text-secondary'
          }`}
        >
          {actionNote.text}
        </p>
      )}

      {/* 1. T-158: whose turn it is, in one sentence, with the one main button */}
      <NextStepBox
        turn={turn}
        firstName={customerFirstName(customer?.name)}
        email={customer?.email || null}
        phone={acceptance?.phone || customer?.phone || null}
        approving={approving}
        onApprove={handleApprove}
        onEdit={() => setEditMode(true)}
        pricing={pricingHeld}
        priceResult={priceResult}
        onPrice={handlePriceHeldLead}
        resending={resending}
        onSendAgain={handleResend}
        note={
          awaitingApproval
            ? (quote as { review_hold?: string | null }).review_hold === 'shown'
              ? 'The customer can already see this as an estimate. They can accept it once you approve.'
              : 'The customer sees “Your estimate is being prepared” and no price until you approve.'
            : null
        }
      />

      {/* T-186: a quote the business made asks the business, here. Answering prices it again. */}
      {story.asksBusiness && (
        <BusinessQuestions
          quoteId={quote.id}
          questions={businessQuestions}
          onAnswered={async () => {
            // the new price is worked out in a moment: look again until it is there
            for (let tries = 0; tries < REPRICE_LOOKS; tries++) {
              const fresh = await fetchQuote()
              if (fresh && !isQuoteProcessing(fresh)) return
              await new Promise((resolve) => setTimeout(resolve, REPRICE_LOOK_MS))
            }
          }}
        />
      )}

      {/* T-188: a request that waits for the customer's answers. The page says the customer was asked; a quiet
          link lets the business answer for them (after a phone call, say), with the same card and route. */}
      {customerQuestions.length > 0 && !story.asksBusiness && (
        answeringForCustomer ? (
          <BusinessQuestions
            forCustomer
            quoteId={quote.id}
            questions={customerQuestions}
            onAnswered={async () => {
              setAnsweringForCustomer(false)
              for (let tries = 0; tries < REPRICE_LOOKS; tries++) {
                const fresh = await fetchQuote()
                if (fresh && !isQuoteProcessing(fresh)) return
                await new Promise((resolve) => setTimeout(resolve, REPRICE_LOOK_MS))
              }
            }}
          />
        ) : (
          <p className="-mt-3 mb-6">
            <button
              type="button"
              onClick={() => setAnsweringForCustomer(true)}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover"
              data-testid="answer-for-customer"
            >
              {QUOTE_TURN_COPY.questions.answerForCustomer}
            </button>
          </p>
        )
      )}

      {/* Open customer questions (and old review requests, which customers can no longer send): part of the next step */}
      {pendingFeedback.length > 0 && (
        <div className="mb-6 space-y-3">
          {pendingFeedback.map((fb) => (
            <div key={fb.id} className="rounded-2xl border border-tertiary-line bg-tertiary-light p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase text-tertiary">
                      {fb.feedback_type === 'approval_request' ? 'Review Request' : 'Customer question'}
                    </span>
                    <span className="text-xs text-text-muted">{formatDate(fb.created_at)}</span>
                  </div>
                  {fb.feedback_text && (
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{fb.feedback_text}</p>
                  )}
                  {fb.feedback_type === 'approval_request' && !fb.feedback_text && (
                    <p className="text-sm text-text-secondary italic">Customer requested a review of this quote.</p>
                  )}
                </div>
                <button
                  onClick={() => handleMarkAnswered(fb.id)}
                  disabled={answering === fb.id}
                  className={`${QUIET} whitespace-nowrap bg-white`}
                  data-testid="mark-answered"
                >
                  {answering === fb.id ? 'Saving…' : 'Mark as answered'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* T-178: the request form's suggestion of another service, on a quote held for that reason */}
      {quote.status === 'pending_review' && <ServiceSuggestionNote suggestion={data.serviceSuggestion} chosenServiceName={data.service?.name ?? null} />}

      {/* T-179: what else the customer asked for, and where each stands. Beside "Check the service", not instead of it. */}
      <CustomerAlsoAsked
        items={alsoAskedWithStates(alsoAskedOf(content), addedSections(pricing))}
        addedBy={Object.fromEntries(addedSections(pricing).map((sec) => [sec.serviceId, sec.addedBy]))}
        priceWaits={sectionsAwaitingApproval(pricing, quote.status).map((sec) => sec.serviceId)}
      />

      {/* T-178: no estimate to read (it failed, or has no price yet): the customer's own answers, to quote it by hand */}
      {(quote.status === 'failed' || (pricing?.total ?? 0) <= 0) && <CustomerSent request={data.request} serviceName={data.service?.name ?? null} madeByBusiness={data.madeByBusiness === true} />}

      {/* T-151: what the customer told you when accepting (it is what you act on next) */}
      {acceptance && <AcceptanceCard details={acceptance} />}

      {/* 2. T-169: what the AI understood, with the customer's photos. Nothing when it produced nothing. */}
      <UnderstoodPanel understanding={data.understanding} photos={data.photos ?? []} customerName={customer.name} madeByBusiness={data.madeByBusiness === true} />

      {/* T-193: what the room scan measured, above the price it priced */}
      {data.roomScan && <RoomScanCard view={data.roomScan} modelPath={`/api/quotes/${quoteId}/room-models/{modelId}`} className="mb-6" />}

      {/* 3. The price: the total first, in the figure style the customer's page uses */}
      <section className="mb-6 rounded-2xl border border-border bg-white p-5 shadow-warm-md" aria-labelledby="pricing-title" data-testid="pricing">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 id="pricing-title" className="text-xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
              Pricing
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {pricing.taxAmount > 0 ? `Total, with ${pricing.taxLabel || 'tax'}` : 'Total'}
            </p>
          </div>
          <p className="figure text-4xl font-medium tracking-tight text-text-primary" data-testid="quote-total">
            <Money amount={pricing.total} currency={pricing.currency} locale={moneyLocale} />
          </p>
        </div>
        <div className="tape-rule mt-4 opacity-60" aria-hidden="true" />
        {/* T-179: a combined quote shows each service as a section with its subtotal */}
        {combined ? (
          <div className="mt-4 space-y-5" data-testid="quote-sections">
            {combined.map((section, sectionIndex) => (
              <div key={section.serviceId ?? sectionIndex} data-testid="quote-section">
                <h3 className="text-sm font-semibold text-text-primary">
                  {section.serviceName}
                  {!section.main && (
                    <span className="ml-2 text-xs font-normal text-text-muted">{section.addedBy === 'business' ? 'added by you' : 'added by the customer'}</span>
                  )}
                </h3>
                <div className="mt-2 space-y-2">
                  {section.lines.map((item, index) => (
                    <div key={index} className="flex justify-between gap-4 text-sm" data-testid="price-line">
                      <span className="min-w-0 text-text-secondary">
                        {lineLabelNow(item.label)}
                        {item.autoRecommended && <span className="ml-2 text-xs text-secondary">(auto-recommended)</span>}
                        <LineSourceNote note={businessSources(section.lines, section.main ? takeoff : undefined, { madeByBusiness })[index]} />
                      </span>
                      <span className="figure shrink-0 font-medium text-text-primary">{formatCurrency(item.amount, pricing.currency)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-1">
                  <MinimumNote minimumCharge={section.minimum?.minimumCharge} currency={pricing.currency} />
                  <div className="flex justify-between gap-4 border-t border-border pt-2 text-sm">
                    <span className="text-text-secondary">{section.serviceName} subtotal</span>
                    <span className="figure text-text-primary" data-testid="quote-section-subtotal">{formatCurrency(section.subtotal, pricing.currency)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="mt-4 space-y-2">
          {priceLines.map((item, index) => (
            <div key={index} className="flex justify-between gap-4 text-sm" data-testid="price-line">
              <span className="min-w-0 text-text-secondary">
                {lineLabelNow(item.label)}
                {item.autoRecommended && (
                  <span className="ml-2 text-xs text-secondary">(auto-recommended)</span>
                )}
                <LineSourceNote note={lineNotes[index]} />
              </span>
              <span className="figure shrink-0 font-medium text-text-primary">
                {formatCurrency(item.amount, pricing.currency)}
              </span>
            </div>
          ))}
        </div>
        )}
        <div className="border-t border-border mt-4 pt-4 space-y-2">
          {!combined && <MinimumNote minimumCharge={minimumApplied?.minimumCharge} currency={pricing.currency} />}
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="figure text-text-primary">{formatCurrency(pricing.subtotal, pricing.currency)}</span>
          </div>
          {pricing.taxAmount > 0 && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-text-secondary">
                {pricing.taxLabel || 'Tax'}
                {pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
              </span>
              <span className="figure text-text-primary">{formatCurrency(pricing.taxAmount, pricing.currency)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
            <span className="text-text-primary">Total</span>
            <span className="figure text-text-primary">{formatCurrency(pricing.total, pricing.currency)}</span>
          </div>
        </div>
        {/* T-146: grade and confidence are business-only — the customer never sees them. It is about the price, so it sits with it. */}
        {pricing.estimate && (
          <EstimateGradePanel
            estimate={pricing.estimate}
            measuredOnQuote={measuredOnQuote}
            currency={pricing.currency}
            gate={quote.quality_gate_json as { action?: string; reason?: string } | null}
            awaitingApproval={awaitingApproval}
          />
        )}
      </section>

      {/* 4. The rest: one card, divided by rules */}
      <section className="mb-6 divide-y divide-border rounded-2xl border border-border bg-background" aria-label="The rest of this quote" data-testid="quote-rest">
        {/* T-158: the four steps, replacing the plain timeline */}
        <QuoteTracker steps={trackerSteps} />

        {content.scopeSummary && (
          <Section title="Scope of work">
            <p className="text-sm text-text-secondary">{content.scopeSummary}</p>
          </Section>
        )}

        {content.assumptions && content.assumptions.length > 0 && (
          <Section title="Assumptions">
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              {content.assumptions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Section>
        )}

        {content.exclusions && content.exclusions.length > 0 && (
          <Section title="Exclusions">
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              {content.exclusions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Section>
        )}

        {content.notes && (
          <Section title="Notes">
            <p className="text-sm text-text-secondary">{content.notes}</p>
          </Section>
        )}

        {quote.business_notes && (
          <Section title="Business notes">
            <p className="text-sm text-text-primary whitespace-pre-wrap">{quote.business_notes}</p>
            <p className="text-xs text-text-muted mt-2">Only visible to you</p>
          </Section>
        )}

        <Section title="Customer">
          <div className="text-sm space-y-1">
            <p className="text-text-primary font-medium">{customer.name}</p>
            <p className="text-text-secondary">{customer.email}</p>
            {customer.phone && <p className="text-text-secondary">{customer.phone}</p>}
          </div>
        </Section>

        {amendments.length > 0 && (
          <VersionHistory amendments={amendments} currentVersion={quote.version} createdAt={quote.created_at} />
        )}
      </section>

      {/* T-143: final invoice (accuracy ground truth) */}
      {['sent', 'viewed', 'accepted', 'paid', 'expired', 'declined'].includes(quote.status) && (
        <FinalInvoiceCard
          quoteId={quote.id}
          currency={pricing.currency}
          quotedTotal={pricing.total}
          initialAmount={quote.final_invoice_amount != null ? Number(quote.final_invoice_amount) : null}
          initialNote={quote.final_invoice_note ?? null}
          recordedAt={quote.final_invoice_recorded_at ?? null}
        />
      )}

      {/* T-197: a quiet link under everything else. It records a report; it changes nothing on this estimate. */}
      <EstimateReport quoteId={quote.id} currency={pricing.currency} isTest={(quote as { is_test?: boolean }).is_test === true} />
    </div>
  )
}

/** T-188: where a price line came from, in the business's words, on a line of its own under the line's name */
function LineSourceNote({ note }: { note: string | null | undefined }) {
  if (!note) return null
  return (
    <span className="block text-xs text-text-muted" data-testid="price-line-source">
      {note}
    </span>
  )
}

/** One part of "the rest": a title and its content, inside the divided card */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-2">{title}</h3>
      {children}
    </div>
  )
}

function VersionHistory({
  amendments,
  currentVersion,
  createdAt,
}: {
  amendments: AmendmentSummary[]
  currentVersion: number
  createdAt: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="-my-2 flex min-h-[44px] w-full items-center justify-between text-left"
      >
        <h3 className="text-sm font-semibold text-text-primary">
          Version History ({currentVersion} version{currentVersion > 1 ? 's' : ''})
        </h3>
        <svg
          className={`w-4 h-4 text-text-muted ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          {amendments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">v{a.version}</span>
                <span className="text-text-muted">&mdash;</span>
                <span className="text-text-secondary capitalize">{a.source.replace('_', ' ')}</span>
                <span className="text-xs text-text-muted">&middot; {a.changeCount} change{a.changeCount !== 1 ? 's' : ''}</span>
              </div>
              <span className="text-text-muted text-xs">{formatDate(a.createdAt)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary">v1</span>
              <span className="text-text-muted">&mdash;</span>
              <span className="text-text-secondary">Original</span>
            </div>
            <span className="text-text-muted text-xs">{formatDate(createdAt)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Wrapper that renders the QuoteEditor component.
 * This will be implemented in Ticket 8.
 */
function QuoteEditorWrapper({
  quoteId,
  quote,
  pricing,
  content,
  pendingFeedback,
  onSave,
  onCancel,
}: {
  quoteId: string
  quote: QuoteDetailResponse['quote']
  pricing: QuotePricing
  content: QuoteContent
  pendingFeedback: QuoteFeedback[]
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  // Lazy-load QuoteEditor to keep initial bundle small
  const [Editor, setEditor] = useState<React.ComponentType<{
    quoteId: string
    initialPricing: QuotePricing
    initialContent: QuoteContent
    businessNotes: string | null
    version: number
    currency: string
    feedbackId?: string
    mainServiceId?: string
    onSave: () => Promise<void>
    onCancel: () => void
  }> | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    import('@/components/quote-editor/QuoteEditor')
      .then((mod) => setEditor(() => mod.default))
      .catch(() => setLoadError(true))
  }, [])

  if (loadError) {
    return (
      <div className="text-center py-20">
        <p className="text-text-secondary">Failed to load editor.</p>
        <button onClick={onCancel} className="text-primary text-sm mt-2">
          Back to View
        </button>
      </div>
    )
  }

  if (!Editor) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const firstFeedback = pendingFeedback[0]
  const feedbackId = firstFeedback ? firstFeedback.id : undefined

  return (
    <Editor
      quoteId={quoteId}
      initialPricing={pricing}
      initialContent={content}
      businessNotes={quote.business_notes}
      version={quote.version}
      currency={pricing.currency}
      feedbackId={feedbackId}
      mainServiceId={quote.service_id}
      onSave={onSave}
      onCancel={onCancel}
    />
  )
}

function formatDate(dateString: string): string {
  // T-133: dashboard dates follow the viewer's browser locale
  return new Date(dateString).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(amount: number, currency: string): string {
  return formatMoney(amount, currency) // T-133: any ISO currency
}

/**
 * T-146: the internal estimate grade, shown only to the business. The
 * customer sees an "Estimate" or a "Quote" and, for uncertain quantities, a
 * range with no label.
 */
function EstimateGradePanel({
  estimate,
  measuredOnQuote,
  currency,
  gate,
  awaitingApproval,
}: {
  estimate: NonNullable<QuotePricing['estimate']>
  /** Whether any line of the quote was measured from the photos; undefined when no line's source is known */
  measuredOnQuote?: boolean
  currency: string
  gate: { action?: string; reason?: string } | null | undefined
  awaitingApproval: boolean
}) {
  // Butter is for measurement: a grade is one (system.md, Colour)
  const tone =
    estimate.grade === 'A' ? 'border-border bg-mint' : estimate.grade === 'B' ? 'border-border bg-butter' : 'border-danger-line bg-danger-light'
  return (
    <div className={`mt-5 rounded-xl border p-4 ${tone}`} data-testid="estimate-grade">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border-2 border-current text-primary">
          <span className="font-display text-lg font-bold leading-none">{estimate.grade}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">
            Grade {estimate.grade} · {certaintyLabel(estimate, { measuredOnQuote })}
            <span className="ml-2 text-xs font-normal text-text-muted">Only visible to you</span>
          </p>
          {/* T-185, T-186: one plain sentence, built from why the price is not confirmed (shared grading.ts).
              An older quote's stored words are replaced when they use a banned word or the quote proves them wrong. */}
          <p className="mt-0.5 text-sm text-text-secondary" data-testid="certainty-sentence">{certaintySentence(estimate, { measuredOnQuote })}</p>
          {estimate.rangeLow !== undefined && estimate.rangeHigh !== undefined && estimate.rangeHigh > estimate.rangeLow && (
            <p className="mt-1 text-xs text-text-muted">
              Range {formatCurrency(estimate.rangeLow, currency)} – {formatCurrency(estimate.rangeHigh, currency)}
              {awaitingApproval ? ' (the customer sees this range until you approve)' : ''}
            </p>
          )}
          {gate?.action === 'require_review' && gate.reason && (
            <p className="mt-1 text-xs text-tertiary">Held because: {gate.reason}</p>
          )}
        </div>
      </div>
    </div>
  )
}
