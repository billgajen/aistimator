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
      active: 'bg-secondary-light text-secondary',
      trialing: 'bg-primary-light text-primary',
      past_due: 'bg-tertiary-light text-tertiary',
      canceled: 'bg-background text-text-primary',
      none: 'bg-background text-text-primary',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[status] || 'bg-background text-text-primary'}`}
      >
        {status}
      </span>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Tenants</h1>
      <p className="mt-2 text-text-secondary">View and search tenant accounts.</p>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mt-6 flex gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by tenant ID (tnt_...) or name"
          className="flex-1 rounded-warm-lg border border-border px-4 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
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
                Tenant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Plan
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Quotes
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
            {tenants.map((tenant) => (
              <tr key={tenant.tenantId} className="hover:bg-background">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-text-primary">{tenant.name}</div>
                  <code className="text-xs text-text-muted">{tenant.tenantId}</code>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-text-primary">{tenant.planName}</div>
                  <div className="text-xs text-text-muted">
                    ${(tenant.planPrice / 100).toFixed(0)}/mo
                  </div>
                </td>
                <td className="px-4 py-3">{getStatusBadge(tenant.subscriptionStatus)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-primary">
                  {tenant.quoteCount}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-muted">
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  <Link
                    href={`/admin/quotes?tenantId=${tenant.tenantId}`}
                    className="text-primary hover:underline"
                  >
                    View Quotes
                  </Link>
                </td>
              </tr>
            ))}

            {tenants.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  No tenants found
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
              onClick={() => fetchTenants(nextCursor, true)}
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
