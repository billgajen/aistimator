'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface TenantItem {
  tenantId: string
  name: string
  currency: string
  createdAt: string
  subscriptionStatus: string
  planName: string
  planPrice: number
  quoteCount: number
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchTenants = useCallback(async (cursor?: string | null, append = false) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`/api/admin/tenants?${params}`)
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to fetch tenants')
      }

      const data = await response.json()
      setTenants((prev) => (append ? [...prev, ...data.items] : data.items))
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tenants')
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    fetchTenants()
  }, [fetchTenants])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setTenants([])
    fetchTenants()
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      trialing: 'bg-blue-100 text-blue-800',
      past_due: 'bg-yellow-100 text-yellow-800',
      canceled: 'bg-gray-100 text-gray-800',
      none: 'bg-gray-100 text-gray-800',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}
      >
        {status}
      </span>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
      <p className="mt-2 text-gray-600">View and search tenant accounts.</p>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mt-6 flex gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by tenant ID (tnt_...) or name"
          className="flex-1 rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
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
                Tenant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Plan
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Quotes
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
            {tenants.map((tenant) => (
              <tr key={tenant.tenantId} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{tenant.name}</div>
                  <code className="text-xs text-gray-500">{tenant.tenantId}</code>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-gray-900">{tenant.planName}</div>
                  <div className="text-xs text-gray-500">
                    ${(tenant.planPrice / 100).toFixed(0)}/mo
                  </div>
                </td>
                <td className="px-4 py-3">{getStatusBadge(tenant.subscriptionStatus)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                  {tenant.quoteCount}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  <Link
                    href={`/admin/quotes?tenantId=${tenant.tenantId}`}
                    className="text-blue-600 hover:underline"
                  >
                    View Quotes
                  </Link>
                </td>
              </tr>
            ))}

            {tenants.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No tenants found
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
              onClick={() => fetchTenants(nextCursor, true)}
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
