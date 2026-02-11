'use client'

import { useEffect, useState, useCallback } from 'react'

interface ActivityItem {
  id: string
  admin_user_id: string
  action: string
  resource_type: string
  resource_id: string
  details_json: Record<string, unknown>
  created_at: string
}

export default function AdminActivityPage() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resourceFilter, setResourceFilter] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchActivities = useCallback(async (cursor?: string | null, append = false) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (resourceFilter) params.set('resourceType', resourceFilter)
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`/api/admin/activity?${params}`)
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to fetch activity')
      }

      const data = await response.json()
      setActivities((prev) => (append ? [...prev, ...data.items] : data.items))
      setNextCursor(data.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch activity')
    } finally {
      setLoading(false)
    }
  }, [resourceFilter])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  const getActionBadge = (action: string) => {
    const styles: Record<string, string> = {
      view: 'bg-primary-light text-primary',
      retry: 'bg-tertiary-light text-tertiary',
      update: 'bg-secondary-light text-secondary',
      delete: 'bg-danger-light text-danger',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[action] || 'bg-background text-text-primary'}`}
      >
        {action}
      </span>
    )
  }

  const getResourceBadge = (type: string) => {
    const styles: Record<string, string> = {
      quote: 'bg-primary-light text-primary',
      tenant: 'bg-cyan-100 text-cyan-800',
      user: 'bg-tertiary-light text-tertiary',
      subscription: 'bg-teal-100 text-teal-800',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[type] || 'bg-background text-text-primary'}`}
      >
        {type}
      </span>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary">Activity Log</h1>
      <p className="mt-2 text-text-secondary">Audit trail of admin actions.</p>

      {/* Filters */}
      <div className="mt-6 flex gap-4">
        <select
          value={resourceFilter}
          onChange={(e) => {
            setResourceFilter(e.target.value)
            setActivities([])
          }}
          className="rounded-warm-lg border border-border px-4 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">All resources</option>
          <option value="quote">Quotes</option>
          <option value="tenant">Tenants</option>
          <option value="user">Users</option>
          <option value="subscription">Subscriptions</option>
        </select>
      </div>

      {/* Error State */}
      {error && <div className="mt-4 rounded-warm-lg bg-danger-light p-4 text-danger">{error}</div>}

      {/* Results Table */}
      <div className="mt-6 overflow-hidden rounded-warm-lg bg-surface shadow">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-background">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Timestamp
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Admin
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Resource
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Resource ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-text-muted">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activities.map((activity) => (
              <tr key={activity.id} className="hover:bg-background">
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-muted">
                  {new Date(activity.created_at).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <code className="text-xs text-text-secondary">{activity.admin_user_id.slice(0, 8)}...</code>
                </td>
                <td className="px-4 py-3">{getActionBadge(activity.action)}</td>
                <td className="px-4 py-3">{getResourceBadge(activity.resource_type)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <code className="text-sm text-text-secondary">{activity.resource_id}</code>
                </td>
                <td className="px-4 py-3 text-sm text-text-muted">
                  {Object.keys(activity.details_json || {}).length > 0
                    ? JSON.stringify(activity.details_json)
                    : '-'}
                </td>
              </tr>
            ))}

            {activities.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  No activity logged yet
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
              onClick={() => fetchActivities(nextCursor, true)}
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
