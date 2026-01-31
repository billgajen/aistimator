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
      queued: 'bg-gray-100 text-gray-800',
      generating: 'bg-blue-100 text-blue-800',
      sent: 'bg-green-100 text-green-800',
      viewed: 'bg-cyan-100 text-cyan-800',
      accepted: 'bg-emerald-100 text-emerald-800',
      paid: 'bg-teal-100 text-teal-800',
      failed: 'bg-red-100 text-red-800',
      expired: 'bg-orange-100 text-orange-800',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}
      >
        {status}
      </span>
    )
  }

  const canRetry = (status: string) => ['failed', 'queued', 'generating'].includes(status)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
      <p className="mt-2 text-gray-600">Search and manage quotes across all tenants.</p>

      {/* Toast */}
      {toast && (
        <div
          className={`mt-4 rounded-lg p-4 ${
            toast.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
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
          className="flex-1 rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          className="rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
        >
          Search
        </button>
      </form>

      {/* Error State */}
      {error && <div className="mt-4 rounded-lg bg-red-50 p-4 text-red-600">{error}</div>}

      {/* Results Table */}
      <div className="mt-6 overflow-hidden rounded-lg bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Quote ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Tenant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Customer
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Total
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {quotes.map((quote) => (
              <tr key={quote.quoteId} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3">
                  <code className="text-sm text-gray-600">{quote.quoteId}</code>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/tenants?search=${quote.tenantId}`}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {quote.tenantName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{quote.customerName}</div>
                  <div className="text-sm text-gray-500">{quote.customerEmail}</div>
                </td>
                <td className="px-4 py-3">{getStatusBadge(quote.status)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                  {quote.currency} {quote.total.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {new Date(quote.createdAt).toLocaleDateString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  {canRetry(quote.status) && (
                    <button
                      onClick={() => handleRetry(quote.quoteId)}
                      disabled={retrying === quote.quoteId}
                      className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 hover:bg-yellow-200 disabled:opacity-50"
                    >
                      {retrying === quote.quoteId ? 'Retrying...' : 'Retry'}
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {quotes.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No quotes found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          </div>
        )}

        {/* Load More */}
        {nextCursor && !loading && (
          <div className="border-t p-4 text-center">
            <button
              onClick={() => fetchQuotes(nextCursor, true)}
              className="text-blue-600 hover:underline"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
