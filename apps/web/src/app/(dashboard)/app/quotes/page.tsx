'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { EmptyState, PageHeader } from '@/components/dashboard/EmptyState'
import type { QuoteListItem, QuoteStatus } from '@estimator/shared'

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<QuoteListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | ''>('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const fetchQuotes = useCallback(async (cursor?: string | null, append = false) => {
    try {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`/api/quotes?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to fetch quotes')
      }

      if (append) {
        setQuotes((prev) => [...prev, ...data.items])
      } else {
        setQuotes(data.items)
      }
      setNextCursor(data.nextCursor)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch quotes')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [search, statusFilter])

  useEffect(() => {
    const debounce = setTimeout(() => {
      fetchQuotes()
    }, 300)
    return () => clearTimeout(debounce)
  }, [fetchQuotes])

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleCopyLink = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }), // Always generate fresh link for sharing
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate link')
      }

      await navigator.clipboard.writeText(data.quoteViewUrl)
      showToast('Quote link copied to clipboard', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to copy link', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleResendEmail = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/resend`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to resend email')
      }

      showToast(`Quote email sent to ${data.sentTo}`, 'success')
      // Refresh to update status
      fetchQuotes()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resend email', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleGeneratePdf = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/pdf`, {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to generate PDF')
      }

      if (data.downloadUrl) {
        window.open(data.downloadUrl, '_blank')
        showToast('PDF generated successfully', 'success')
      } else {
        showToast('PDF generated but download URL not available', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate PDF', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDownloadPdf = async (quoteId: string) => {
    setActionLoading(quoteId)
    try {
      const response = await fetch(`/api/quotes/${quoteId}/pdf`)
      const data = await response.json()

      if (!response.ok) {
        // If PDF doesn't exist, try generating it
        if (data.error?.code === 'PDF_NOT_FOUND') {
          await handleGeneratePdf(quoteId)
          return
        }
        throw new Error(data.error?.message || 'Failed to download PDF')
      }

      window.open(data.downloadUrl, '_blank')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to download PDF', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const formatCurrency = (amount: number, currency: string) => {
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const formatTime = (dateString: string | null) => {
    if (!dateString) return ''
    return new Date(dateString).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: QuoteStatus) => {
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
    const { label, className } = config[status] || config.sent
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
        {label}
      </span>
    )
  }

  return (
    <div>
      <PageHeader
        title="Quotes"
        description="View and manage all your quotes"
      />

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-warm-lg shadow-warm-lg ${
            toast.type === 'success'
              ? 'bg-secondary-light text-secondary border border-secondary/20'
              : 'bg-danger-light text-danger border border-danger/20'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by customer name or email..."
            className="w-full max-w-md rounded-warm-lg border border-border bg-surface px-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-warm-lg border border-border bg-surface px-4 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | '')}
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="generating">Processing</option>
          <option value="pending_review">Review Required</option>
          <option value="sent">Sent</option>
          <option value="viewed">Viewed</option>
          <option value="accepted">Accepted</option>
          <option value="paid">Paid</option>
          <option value="expired">Expired</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-warm-lg bg-danger-light border border-danger/20 p-4 text-danger">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : quotes.length === 0 ? (
        <EmptyState
          title="No quotes yet"
          description={
            search || statusFilter
              ? 'No quotes match your search criteria. Try adjusting your filters.'
              : 'Quotes will appear here once customers submit requests through your widget. Embed the widget on your website to start receiving quotes.'
          }
          icon={
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          action={
            !search && !statusFilter
              ? {
                  label: 'Get embed code',
                  href: '/app/widget',
                }
              : undefined
          }
        />
      ) : (
        <>
          {/* Quotes table */}
          <div className="overflow-x-auto rounded-xl border border-border bg-background">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">
                    Customer
                  </th>
                  <th className="px-6 py-4 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">
                    Service
                  </th>
                  <th className="px-6 py-4 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">
                    Total
                  </th>
                  <th className="px-6 py-4 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">
                    Created
                  </th>
                  <th className="px-6 py-4 text-right text-[11px] font-bold text-text-muted uppercase tracking-widest">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {quotes.map((quote) => (
                  <tr key={quote.quoteId} className="hover:bg-surface transition-colors">
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="text-sm font-semibold text-text-primary">{quote.customerName}</div>
                      <div className="text-sm text-text-secondary">{quote.customerEmail}</div>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="text-sm text-text-primary">{quote.serviceName}</div>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="text-sm font-medium text-text-primary">
                        {formatCurrency(quote.total, quote.currency)}
                      </div>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      {getStatusBadge(quote.status)}
                      {quote.viewedAt && quote.status === 'viewed' && (
                        <div className="text-xs text-text-muted mt-1">
                          {formatDate(quote.viewedAt)} {formatTime(quote.viewedAt)}
                        </div>
                      )}
                      {quote.acceptedAt && (quote.status === 'accepted' || quote.status === 'paid') && (
                        <div className="text-xs text-text-muted mt-1">
                          {formatDate(quote.acceptedAt)} {formatTime(quote.acceptedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap">
                      <div className="text-sm text-text-primary">{formatDate(quote.createdAt)}</div>
                      <div className="text-xs text-text-muted">{formatTime(quote.createdAt)}</div>
                    </td>
                    <td className="px-6 py-5 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {/* View / Edit */}
                        <Link
                          href={`/app/quotes/${quote.quoteId}`}
                          className="text-text-secondary hover:text-text-primary transition-colors"
                          title="View quote"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </Link>

                        {/* View Trace */}
                        {['sent', 'viewed', 'accepted', 'paid', 'feedback_received', 'revised'].includes(quote.status) && (
                          <Link
                            href={`/app/quotes/${quote.quoteId}/trace`}
                            className="text-text-secondary hover:text-text-primary transition-colors"
                            title="View pricing trace"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                          </Link>
                        )}

                        {/* Copy Link */}
                        {['sent', 'viewed', 'accepted', 'paid', 'expired'].includes(quote.status) && (
                          <button
                            onClick={() => handleCopyLink(quote.quoteId)}
                            disabled={actionLoading === quote.quoteId}
                            className="text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
                            title="Copy quote link"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                          </button>
                        )}

                        {/* Download PDF */}
                        {['sent', 'viewed', 'accepted', 'paid'].includes(quote.status) && (
                          <button
                            onClick={() => handleDownloadPdf(quote.quoteId)}
                            disabled={actionLoading === quote.quoteId}
                            className="text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
                            title="Download PDF"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </button>
                        )}

                        {/* Resend Email */}
                        {['sent', 'viewed', 'expired'].includes(quote.status) && (
                          <button
                            onClick={() => handleResendEmail(quote.quoteId)}
                            disabled={actionLoading === quote.quoteId}
                            className="text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
                            title="Resend email"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}

                        {/* Loading indicator */}
                        {actionLoading === quote.quoteId && (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Load more button */}
          {nextCursor && (
            <div className="mt-6 text-center">
              <button
                onClick={() => fetchQuotes(nextCursor, true)}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50 transition-colors"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    Loading...
                  </span>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
