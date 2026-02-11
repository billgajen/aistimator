'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface QuoteItem {
  quoteId: string
  tenantId: string
  tenantName: string
  serviceName: string
  customerName: string
  customerEmail: string
  status: string
  createdAt: string
  sentAt: string | null
  total: number
  currency: string
}

export default function AdminQuotesPage() {
  const [quotes, setQuotes] = useState<QuoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const fetchQuotes = useCallback(async (cursor?: string | null, append = false) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`/api/admin/quotes?${params}`)
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to fetch quotes')
      }

      const data = await response.json()
      setQuotes((prev) => (append ? [...prev, ...data.items] : data.items))
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch quotes')
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter])

  useEffect(() => {
    fetchQuotes()
  }, [fetchQuotes])

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuotes([])
    fetchQuotes()
  }

  const handleRetry = async (quoteId: string) => {
    setRetrying(quoteId)
    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/retry`, {
        method: 'POST',
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to retry')
      }

      setToast({ message: 'Quote job queued for retry', type: 'success' })
      // Refresh the list
      fetchQuotes()
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to retry',
        type: 'error',
      })
    } finally {
      setRetrying(null)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      queued: 'bg-background text-text-primary',
      generating: 'bg-primary-light text-primary',
      sent: 'bg-secondary-light text-secondary',
      viewed: 'bg-cyan-100 text-cyan-800',
      accepted: 'bg-emerald-100 text-emerald-800',
      paid: 'bg-teal-100 text-teal-800',
      failed: 'bg-danger-light text-danger',
      expired: 'bg-tertiary-light text-tertiary',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[status] || 'bg-background text-text-primary'}`}
      >
        {status}
      </span>
    )
  }

  const canRetry = (status: string) => ['failed', 'queued', 'generating'].includes(status)

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Quotes</h1>
      <p className="mt-2 text-text-secondary">Search and manage quotes across all tenants.</p>

      {/* Toast */}
      {toast && (
        <div
          className={`mt-4 rounded-warm-lg p-4 ${
            toast.type === 'success' ? 'bg-secondary-light text-secondary' : 'bg-danger-light text-danger'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mt-6 flex gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by quote ID (qte_...) or customer email"
          className="flex-1 rounded-warm-lg border border-border px-4 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-warm-lg border border-border px-4 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="generating">Generating</option>
          <option value="sent">Sent</option>
          <option value="viewed">Viewed</option>
          <option value="accepted">Accepted</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
          <option value="expired">Expired</option>
        </select>
        <button
          type="submit"
          className="rounded-warm-lg bg-primary px-6 py-2 text-white hover:bg-primary-hover"
        >
          Search
        </button>
      </form>

      {/* Error State */}
      {error && <div className="mt-4 rounded-warm-lg bg-danger-light p-4 text-danger">{error}</div>}

      {/* Results Table */}
      <div className="mt-6 overflow-hidden rounded-warm-lg bg-surface shadow">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-background">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Quote ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Tenant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Total
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {quotes.map((quote) => (
              <tr key={quote.quoteId} className="hover:bg-background">
                <td className="whitespace-nowrap px-4 py-3">
                  <code className="text-sm text-text-secondary">{quote.quoteId}</code>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/tenants?search=${quote.tenantId}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {quote.tenantName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-text-primary">{quote.customerName}</div>
                  <div className="text-sm text-text-muted">{quote.customerEmail}</div>
                </td>
                <td className="px-4 py-3">{getStatusBadge(quote.status)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-primary">
                  {quote.currency} {quote.total.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-muted">
                  {new Date(quote.createdAt).toLocaleDateString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {canRetry(quote.status) && (
                    <button
                      onClick={() => handleRetry(quote.quoteId)}
                      disabled={retrying === quote.quoteId}
                      className="rounded bg-tertiary-light px-2 py-1 text-xs font-medium text-tertiary hover:bg-yellow-200 disabled:opacity-50"
                    >
                      {retrying === quote.quoteId ? 'Retrying...' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {quotes.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                  No quotes found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {/* Load More */}
        {nextCursor && !loading && (
          <div className="border-t p-4 text-center">
            <button
              onClick={() => fetchQuotes(nextCursor, true)}
              className="text-primary hover:underline"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
