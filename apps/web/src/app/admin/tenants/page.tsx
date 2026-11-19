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
  suspendedAt: string | null
  testAccount: boolean
  /** T-189: where the business came from at sign-up, in one line */
  cameFrom?: string
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<TenantItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  // T-180: the suspend switch. The row being suspended shows a reason field; restoring needs none.
  const [suspending, setSuspending] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const setSuspended = async (tenantId: string, suspended: boolean, why: string) => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended, reason: why }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error?.message || 'Could not change the business')
      setTenants((prev) => prev.map((t) => (t.tenantId === tenantId ? { ...t, suspendedAt: result.suspended ? new Date().toISOString() : null } : t)))
      setSuspending(null)
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the business')
    } finally {
      setSaving(false)
    }
  }

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
          className="flex-1 rounded-xl border border-border px-4 py-2 focus:border-primary focus:outline-none focus:ring-2"
        />
        <button
          type="submit"
          className="rounded-xl bg-primary px-6 py-2 text-white hover:bg-primary-hover"
        >
          Search
        </button>
      </form>

      {/* Error State */}
      {error && <div className="mt-4 rounded-xl bg-danger-light p-4 text-danger">{error}</div>}

      {/* Results Table */}
      <div className="mt-6 overflow-hidden rounded-xl bg-surface shadow">
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
                  {tenant.suspendedAt && (
                    <div className="mt-1">
                      <span className="inline-flex items-center rounded-full bg-danger-light px-2 py-1 text-xs font-medium text-danger" data-testid="suspended-tag">
                        Suspended
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-text-primary">{tenant.planName}</div>
                  <div className="text-xs text-text-muted">
                    {tenant.testAccount ? 'Test account, not billed' : `$${(tenant.planPrice / 100).toFixed(0)}/mo`}
                  </div>
                </td>
                <td className="px-4 py-3">{getStatusBadge(tenant.subscriptionStatus)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-primary">
                  {tenant.quoteCount}
                </td>
                <td className="px-4 py-3 text-sm text-text-muted">
                  <div className="whitespace-nowrap">{new Date(tenant.createdAt).toLocaleDateString()}</div>
                  {tenant.cameFrom && (
                    <div className="mt-0.5 max-w-[16rem] text-xs text-text-muted" data-testid="came-from">{tenant.cameFrom}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm">
                  <Link
                    href={`/admin/quotes?tenantId=${tenant.tenantId}`}
                    className="text-primary hover:underline"
                  >
                    View Quotes
                  </Link>
                  {/* T-180: apart from the link above, as a destructive action is (design: Layout) */}
                  <div className="mt-3 border-t border-border pt-3">
                    {tenant.suspendedAt ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setSuspended(tenant.tenantId, false, '')}
                        className="rounded-lg border border-field px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-background disabled:opacity-50"
                      >
                        Restore
                      </button>
                    ) : suspending === tenant.tenantId ? (
                      <form
                        className="flex flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          setSuspended(tenant.tenantId, true, reason)
                        }}
                      >
                        <label className="text-xs text-text-muted" htmlFor={`reason-${tenant.tenantId}`}>
                          Reason (required; the business never sees it)
                        </label>
                        <input
                          id={`reason-${tenant.tenantId}`}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          maxLength={500}
                          className="w-56 rounded-lg border border-field px-3 py-1.5 text-sm focus:outline-none focus:ring-2"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={saving || !reason.trim()}
                            className="rounded-lg bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Suspend
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSuspending(null)
                              setReason('')
                            }}
                            className="rounded-lg border border-field px-3 py-1.5 text-sm font-medium text-text-primary"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSuspending(tenant.tenantId)
                          setReason('')
                        }}
                        className="rounded-lg border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-light"
                      >
                        Suspend…
                      </button>
                    )}
                  </div>
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
