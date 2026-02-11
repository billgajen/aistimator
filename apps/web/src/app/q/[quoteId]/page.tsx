'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { QuoteViewResponse, QuoteStatus } from '@estimator/shared'

interface QuotePageProps {
  params: { quoteId: string }
}

export default function QuotePage({ params }: QuotePageProps) {
  const { quoteId } = params
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [quote, setQuote] = useState<QuoteViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-text-secondary">Loading your quote...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <div className="text-danger text-5xl mb-4">!</div>
          <h1 className="font-display text-xl font-semibold text-text-primary mb-2">Unable to Load Quote</h1>
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    )
  }

  if (!quote) {
    return null
  }

  const { business, customer, pricing, notes, validUntil, assets, status, actions, crossServicePricing, signalRecommendations } = quote

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header with business branding */}
        <div className="animate-fade-in-up bg-surface rounded-warm-2xl shadow-warm border border-border p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              {business.logoUrl ? (
                <img
                  src={business.logoUrl}
                  alt={business.name}
                  className="h-12 object-contain"
                />
              ) : (
                <h1 className="font-display text-xl font-bold text-text-primary">{business.name}</h1>
              )}
            </div>
            <div className="flex items-center gap-3">
              {actions.pdfUrl && (
                <a
                  href={actions.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-text-secondary bg-background rounded-warm-lg hover:bg-border/50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download PDF
                </a>
              )}
              <StatusBadge status={status} />
            </div>
          </div>
        </div>

        {/* Quote details */}
        <div className="animate-fade-in-up animation-delay-100 bg-surface rounded-warm-2xl shadow-warm border border-border p-6 mb-6">
          <div className="mb-6">
            <h2 className="font-display text-lg font-semibold text-text-primary mb-1">
              Quote for {customer.name}
            </h2>
            {validUntil && (
              <p className="text-sm text-text-secondary">
                Valid until {new Date(validUntil).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Scope summary */}
          {notes.scopeSummary && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-text-primary mb-2">Scope of Work</h3>
              <p className="text-text-secondary">{notes.scopeSummary}</p>
            </div>
          )}

          {/* Pricing breakdown */}
          <div className="border-t border-border pt-6 mb-6">
            <h3 className="text-sm font-medium text-text-primary mb-4">Pricing</h3>

            {/* Main work items (non-recommended) */}
            {pricing.breakdown && pricing.breakdown.length > 0 && (
              <div className="space-y-2 mb-4">
                {pricing.breakdown
                  .filter((item) => !item.autoRecommended)
                  .map((item, index) => (
                    <div key={index} className="flex justify-between text-sm">
                      <span className="text-text-secondary">{item.label}</span>
                      <span className="text-text-primary">
                        {formatCurrency(item.amount, pricing.currency)}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {/* Recommended add-ons (auto-detected) */}
            {pricing.breakdown?.some((item) => item.autoRecommended) && (
              <div className="bg-secondary-light border border-secondary/20 rounded-lg p-4 mb-4">
                <h4 className="text-sm font-medium text-secondary mb-3">
                  Recommended Add-ons
                </h4>
                <p className="text-xs text-text-muted mb-3">
                  Based on your request, we recommend:
                </p>
                <div className="space-y-2">
                  {pricing.breakdown
                    .filter((item) => item.autoRecommended)
                    .map((item, index) => (
                      <div key={index} className="flex justify-between items-start text-sm">
                        <div>
                          <span className="text-text-primary">{item.label}</span>
                          {item.recommendationReason && (
                            <p className="text-xs text-text-muted">{item.recommendationReason}</p>
                          )}
                        </div>
                        <span className="text-secondary font-medium whitespace-nowrap">
                          {formatCurrency(item.amount, pricing.currency)}/each
                        </span>
                      </div>
                    ))}
                </div>
                <p className="text-xs text-text-muted mt-3 pt-3 border-t border-secondary/20">
                  Contact us to confirm quantities and add to your quote.
                </p>
              </div>
            )}

            {/* Pricing notes (warnings, site visit recommendations) */}
            {pricing.notes && pricing.notes.length > 0 && (
              <div className="bg-tertiary-light border border-tertiary/20 rounded-warm-lg p-3 mb-4">
                <h4 className="text-sm font-medium text-text-primary mb-1">Important Notes</h4>
                <ul className="text-sm text-text-secondary space-y-1">
                  {pricing.notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Subtotal</span>
                <span className="text-text-primary">
                  {formatCurrency(pricing.subtotal, pricing.currency)}
                </span>
              </div>

              {pricing.taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">
                    {pricing.taxLabel || 'Tax'}
                    {pricing.taxRate && ` (${pricing.taxRate}%)`}
                  </span>
                  <span className="text-text-primary">
                    {formatCurrency(pricing.taxAmount, pricing.currency)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-lg font-semibold pt-2 border-t border-border">
                <span className="text-text-primary">Total</span>
                <span className="text-text-primary">
                  {formatCurrency(pricing.total, pricing.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Optional Extras (available addons not triggered) */}
          {pricing.availableAddons && pricing.availableAddons.length > 0 && (
            <div className="bg-secondary-light border border-secondary/20 rounded-warm-lg p-4 mb-6">
              <h3 className="text-sm font-medium text-secondary mb-3">Optional Extras</h3>
              <div className="space-y-2">
                {pricing.availableAddons.map((addon) => (
                  <div key={addon.id} className="flex justify-between items-center text-sm">
                    <span className="text-text-primary">{addon.label}</span>
                    <span className="text-secondary font-medium">
                      +{formatCurrency(addon.price, pricing.currency)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-muted mt-3 pt-3 border-t border-secondary/20">
                Ask us to add any of these to your quote.
              </p>
            </div>
          )}

          {/* Cross-Service Pricing */}
          {crossServicePricing && crossServicePricing.length > 0 && (
            <div className="bg-primary-light border border-primary/20 rounded-warm-lg p-4 mb-6">
              <h3 className="text-sm font-medium text-primary mb-3">
                {crossServicePricing.every(s => !s.isEstimate)
                  ? 'Additional Services You Mentioned'
                  : 'Additional Services Recommended'}
              </h3>
              {crossServicePricing.map((service, index) => (
                <div
                  key={index}
                  className="mb-4 last:mb-0 pb-4 last:pb-0 border-b last:border-b-0 border-primary/10"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="font-medium text-text-primary">{service.serviceName}</span>
                      <p className="text-xs text-text-secondary">{service.reason}</p>
                    </div>
                    <span className="text-primary font-semibold">
                      {service.isEstimate ? '~' : ''}
                      {formatCurrency(service.estimatedTotal, pricing.currency)}
                    </span>
                  </div>

                  {/* Show extracted details */}
                  {service.extractedDetails && service.extractedDetails.length > 0 && (
                    <ul className="text-xs text-text-secondary mb-2 ml-2">
                      {service.extractedDetails.map((detail, i) => (
                        <li key={i}>• {detail}</li>
                      ))}
                    </ul>
                  )}

                  {/* Show breakdown */}
                  {service.breakdown && service.breakdown.length > 0 && (
                    <div className="text-xs text-text-muted space-y-0.5">
                      {service.breakdown.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-text-muted italic mt-1">{service.note}</p>
                </div>
              ))}
              <p className="text-xs text-text-secondary mt-3 pt-3 border-t border-primary/10">
                Want to add these services? Reply to accept or contact us to discuss.
              </p>
            </div>
          )}

          {/* AI-Recommended Additional Work (from unused signals) */}
          {signalRecommendations && signalRecommendations.length > 0 && (
            <div className="bg-tertiary-light border border-tertiary/20 rounded-warm-lg p-4 mb-6">
              <h3 className="text-sm font-medium text-tertiary mb-3">
                Potential Additional Work
              </h3>
              <p className="text-xs text-text-secondary mb-3">
                Based on your description, you may also need:
              </p>
              {signalRecommendations.map((rec, index) => (
                <div
                  key={index}
                  className="mb-3 last:mb-0 pb-3 last:pb-0 border-b last:border-b-0 border-tertiary/10"
                >
                  <div className="mb-1">
                    <span className="font-medium text-text-primary">{rec.workDescription}</span>
                  </div>
                  <p className="text-xs text-text-secondary">{rec.evidence}</p>
                  {rec.costBreakdown && (
                    <p className="text-xs text-text-muted italic">{rec.costBreakdown}</p>
                  )}
                </div>
              ))}
              <p className="text-xs text-text-muted mt-3 pt-3 border-t border-tertiary/10">
                Contact us for pricing on additional work. Final scope confirmed on-site.
              </p>
            </div>
          )}

          {/* Assumptions */}
          {notes.assumptions && notes.assumptions.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-text-primary mb-2">Assumptions</h3>
              <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                {notes.assumptions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Exclusions */}
          {notes.exclusions && notes.exclusions.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-text-primary mb-2">Exclusions</h3>
              <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                {notes.exclusions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Additional notes */}
          {notes.notes && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-text-primary mb-2">Notes</h3>
              <p className="text-sm text-text-secondary">{notes.notes}</p>
            </div>
          )}
        </div>

        {/* Photos section */}
        {assets.length > 0 && (
          <div className="animate-fade-in-up animation-delay-200 bg-surface rounded-warm-2xl shadow-warm border border-border p-6 mb-6">
            <h3 className="text-sm font-medium text-text-primary mb-4">Attached Photos</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {assets
                .filter((a) => a.type === 'image')
                .map((asset) => (
                  <a
                    key={asset.assetId}
                    href={asset.viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square bg-background rounded-warm-lg overflow-hidden hover:opacity-80 transition-opacity"
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

        {/* Accept CTA */}
        {!accepted && (status === 'sent' || status === 'viewed') && (
          <div className="animate-fade-in-up animation-delay-300 bg-surface rounded-warm-2xl shadow-warm border border-border p-6">
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full bg-primary text-white py-3 px-4 rounded-lg font-medium hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {accepting ? 'Accepting...' : 'Accept Quote'}
            </button>
            <p className="text-xs text-text-muted text-center mt-3">
              By accepting, you agree to proceed with this quote
            </p>
          </div>
        )}

        {/* Accepted state */}
        {accepted && (
          <div className="animate-fade-in-up animation-delay-300 bg-secondary-light border border-secondary/20 rounded-warm-2xl p-6 text-center">
            <div className="text-secondary text-3xl mb-2">&#10003;</div>
            <h3 className="font-display text-lg font-semibold text-secondary mb-1">Quote Accepted</h3>
            <p className="text-sm text-text-secondary">
              Thank you! {business.name} will be in touch shortly.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-xs text-text-muted">
          Powered by Estimator
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const statusConfig: Record<QuoteStatus, { label: string; className: string }> = {
    queued: { label: 'Processing', className: 'bg-tertiary-light text-tertiary' },
    generating: { label: 'Processing', className: 'bg-tertiary-light text-tertiary' },
    pending_review: { label: 'Under Review', className: 'bg-tertiary-light text-tertiary' },
    sent: { label: 'Awaiting Response', className: 'bg-primary-light text-primary' },
    viewed: { label: 'Viewed', className: 'bg-primary-light text-primary' },
    accepted: { label: 'Accepted', className: 'bg-secondary-light text-secondary' },
    paid: { label: 'Paid', className: 'bg-secondary-light text-secondary' },
    expired: { label: 'Expired', className: 'bg-background text-text-muted' },
    failed: { label: 'Error', className: 'bg-danger-light text-danger' },
  }

  const config = statusConfig[status] || statusConfig.sent

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '\u00a3',
    USD: '$',
    EUR: '\u20ac',
    AUD: 'A$',
    CAD: 'C$',
  }
  const symbol = symbols[currency] || currency + ' '
  return `${symbol}${amount.toFixed(2)}`
}
