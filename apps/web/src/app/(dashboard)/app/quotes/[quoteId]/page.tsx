'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import type {
  QuoteDetailResponse,
  QuoteStatus,
  QuotePricing,
  QuoteContent,
  AmendmentSummary,
  QuoteFeedback,
  FeedbackStatus,
} from '@estimator/shared'

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

  const fetchQuote = useCallback(async () => {
    try {
      const response = await fetch(`/api/quotes/${quoteId}`)
      if (!response.ok) {
        const errData = await response.json()
        setError(errData.error?.message || 'Failed to load quote')
        return
      }
      const result = await response.json()
      setData(result)
    } catch {
      setError('Failed to load quote')
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => {
    fetchQuote()
  }, [fetchQuote])

  const handleResend = async () => {
    setResending(true)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/resend`, {
        method: 'POST',
      })
      if (response.ok) {
        await fetchQuote()
      } else {
        const errData = await response.json()
        alert(errData.error?.message || 'Failed to resend')
      }
    } catch {
      alert('Failed to resend quote')
    } finally {
      setResending(false)
    }
  }

  const handleResolveFeedback = async (feedbackId: string) => {
    // Mark feedback as acknowledged via the PATCH endpoint (include in a save)
    // For now, we'll handle this when edit mode save is implemented
    if (!data) return
    setData({
      ...data,
      feedback: data.feedback.map((f) =>
        f.id === feedbackId ? { ...f, status: 'acknowledged' as FeedbackStatus } : f
      ),
    })
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
  const customer = quote.customer_json as { name: string; email: string; phone?: string }
  const pendingFeedback = feedback.filter((f) => f.status === 'pending')
  const canEdit = !['accepted', 'paid', 'generating', 'queued', 'failed'].includes(quote.status)
  const canSend = !['generating', 'queued', 'failed'].includes(quote.status)

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

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/app/quotes"
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-text-primary">
              Quote for {customer.name}
            </h1>
            <p className="text-sm text-text-secondary">
              {service.name} &middot; Created {formatDate(quote.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={quote.status as QuoteStatus} />
          {canEdit && (
            <button
              onClick={() => setEditMode(true)}
              className="px-4 py-2 text-sm font-semibold text-text-primary bg-background border border-border rounded-lg hover:bg-surface transition-colors"
            >
              Edit
            </button>
          )}
          {canSend && (
            <button
              onClick={handleResend}
              disabled={resending}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {resending ? 'Sending...' : 'Send'}
            </button>
          )}
        </div>
      </div>

      {/* Pending feedback alert */}
      {pendingFeedback.length > 0 && (
        <div className="mb-6 space-y-3">
          {pendingFeedback.map((fb) => (
            <div
              key={fb.id}
              className="bg-tertiary-light border border-tertiary/20 rounded-lg p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold uppercase text-tertiary">
                      {fb.feedback_type === 'approval_request' ? 'Review Request' : 'Customer Feedback'}
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
                  onClick={() => handleResolveFeedback(fb.id)}
                  className="px-3 py-1.5 text-xs font-medium text-text-secondary border border-border rounded-lg hover:bg-background transition-colors whitespace-nowrap"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Business notes */}
      {quote.business_notes && (
        <div className="mb-6 bg-surface border border-border rounded-lg p-4">
          <h3 className="text-xs font-semibold uppercase text-text-muted mb-2">Business Notes</h3>
          <p className="text-sm text-text-primary whitespace-pre-wrap">{quote.business_notes}</p>
          <p className="text-xs text-text-muted mt-2">Only visible to you</p>
        </div>
      )}

      {/* Scope of work */}
      {content.scopeSummary && (
        <Section title="Scope of Work">
          <p className="text-sm text-text-secondary">{content.scopeSummary}</p>
        </Section>
      )}

      {/* Pricing */}
      <Section title="Pricing">
        <div className="space-y-2">
          {pricing.breakdown.map((item, index) => (
            <div key={index} className="flex justify-between text-sm">
              <span className="text-text-secondary">
                {item.label}
                {item.autoRecommended && (
                  <span className="ml-2 text-xs text-secondary">(auto-recommended)</span>
                )}
              </span>
              <span className="text-text-primary font-medium">
                {formatCurrency(item.amount, pricing.currency)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-border mt-4 pt-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="text-text-primary">{formatCurrency(pricing.subtotal, pricing.currency)}</span>
          </div>
          {pricing.taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">
                {pricing.taxLabel || 'Tax'}
                {pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
              </span>
              <span className="text-text-primary">{formatCurrency(pricing.taxAmount, pricing.currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold pt-2 border-t border-border">
            <span className="text-text-primary">Total</span>
            <span className="text-text-primary">{formatCurrency(pricing.total, pricing.currency)}</span>
          </div>
        </div>
      </Section>

      {/* Assumptions */}
      {content.assumptions && content.assumptions.length > 0 && (
        <Section title="Assumptions">
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
            {content.assumptions.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Exclusions */}
      {content.exclusions && content.exclusions.length > 0 && (
        <Section title="Exclusions">
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
            {content.exclusions.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Notes */}
      {content.notes && (
        <Section title="Notes">
          <p className="text-sm text-text-secondary">{content.notes}</p>
        </Section>
      )}

      {/* Version history */}
      {amendments.length > 0 && (
        <VersionHistory amendments={amendments} currentVersion={quote.version} createdAt={quote.created_at} />
      )}

      {/* Customer info */}
      <Section title="Customer">
        <div className="text-sm space-y-1">
          <p className="text-text-primary font-medium">{customer.name}</p>
          <p className="text-text-secondary">{customer.email}</p>
          {customer.phone && <p className="text-text-secondary">{customer.phone}</p>}
        </div>
      </Section>

      {/* Timeline */}
      <Section title="Timeline">
        <div className="text-sm space-y-2">
          <TimelineEntry label="Created" date={quote.created_at} />
          {quote.sent_at && <TimelineEntry label="Sent" date={quote.sent_at} />}
          {quote.viewed_at && <TimelineEntry label="Viewed" date={quote.viewed_at} />}
          {quote.last_amended_at && (
            <TimelineEntry label={`Edited (v${quote.version})`} date={quote.last_amended_at} />
          )}
          {quote.accepted_at && <TimelineEntry label="Accepted" date={quote.accepted_at} />}
          {quote.paid_at && <TimelineEntry label="Paid" date={quote.paid_at} />}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 bg-surface border border-border rounded-lg p-5">
      <h3 className="text-sm font-semibold text-text-primary mb-3">{title}</h3>
      {children}
    </div>
  )
}

function TimelineEntry({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-muted">{formatDate(date)}</span>
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
    <div className="mb-6 bg-surface border border-border rounded-lg p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <h3 className="text-sm font-semibold text-text-primary">
          Version History ({currentVersion} version{currentVersion > 1 ? 's' : ''})
        </h3>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
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

function StatusBadge({ status }: { status: QuoteStatus }) {
  const config: Record<QuoteStatus, { label: string; className: string }> = {
    queued: { label: 'Queued', className: 'bg-background text-text-secondary' },
    generating: { label: 'Processing', className: 'bg-tertiary-light text-tertiary' },
    pending_review: { label: 'Review Required', className: 'bg-tertiary-light text-tertiary' },
    awaiting_clarification: { label: 'Awaiting Info', className: 'bg-tertiary-light text-tertiary' },
    sent: { label: 'Sent', className: 'bg-primary-light text-primary' },
    viewed: { label: 'Viewed', className: 'bg-primary-light text-primary' },
    feedback_received: { label: 'Feedback', className: 'bg-tertiary-light text-tertiary' },
    revised: { label: 'Revised', className: 'bg-primary-light text-primary' },
    accepted: { label: 'Accepted', className: 'bg-secondary-light text-secondary' },
    paid: { label: 'Paid', className: 'bg-secondary-light text-secondary' },
    expired: { label: 'Expired', className: 'bg-background text-text-muted' },
    failed: { label: 'Failed', className: 'bg-danger-light text-danger' },
  }
  const c = config[status] || config.sent
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
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
      onSave={onSave}
      onCancel={onCancel}
    />
  )
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '\u00a3', USD: '$', EUR: '\u20ac', AUD: 'A$', CAD: 'C$', NZD: 'NZ$',
  }
  const symbol = symbols[currency] || currency + ' '
  return `${symbol}${amount.toFixed(2)}`
}
