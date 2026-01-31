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
      GBP: '£',
      USD: '$',
      EUR: '€',
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
      queued: { label: 'Queued', className: 'bg-gray-100 text-gray-800' },
      generating: { label: 'Processing', className: 'bg-yellow-100 text-yellow-800' },
      pending_review: { label: 'Review Required', className: 'bg-amber-100 text-amber-800' },
      sent: { label: 'Sent', className: 'bg-blue-100 text-blue-800' },
      viewed: { label: 'Viewed', className: 'bg-indigo-100 text-indigo-800' },
      accepted: { label: 'Accepted', className: 'bg-green-100 text-green-800' },
      paid: { label: 'Paid', className: 'bg-green-100 text-green-800' },
      expired: { label: 'Expired', className: 'bg-orange-100 text-orange-800' },
      failed: { label: 'Failed', className: 'bg-red-100 text-red-800' },
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
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
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
            className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
        <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-red-800">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Service
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {quotes.map((quote) => (
                  <tr key={quote.quoteId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{quote.customerName}</div>
                      <div className="text-sm text-gray-500">{quote.customerEmail}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{quote.serviceName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {formatCurrency(quote.total, quote.currency)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(quote.status)}
                      {quote.viewedAt && quote.status === 'viewed' && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDate(quote.viewedAt)} {formatTime(quote.viewedAt)}
                        </div>
                      )}
                      {quote.acceptedAt && (quote.status === 'accepted' || quote.status === 'paid') && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatDate(quote.acceptedAt)} {formatTime(quote.acceptedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{formatDate(quote.createdAt)}</div>
                      <div className="text-xs text-gray-500">{formatTime(quote.createdAt)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        {/* View Trace */}
                        {['sent', 'viewed', 'accepted', 'paid'].includes(quote.status) && (
                          <Link
                            href={`/app/quotes/${quote.quoteId}/trace`}
                            className="text-gray-600 hover:text-gray-900"
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
                            className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
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
                            className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
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
                            className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
                            title="Resend email"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}

                        {/* Loading indicator */}
                        {actionLoading === quote.quoteId && (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
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
                className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
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
