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
      view: 'bg-blue-100 text-blue-800',
      retry: 'bg-yellow-100 text-yellow-800',
      update: 'bg-green-100 text-green-800',
      delete: 'bg-red-100 text-red-800',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[action] || 'bg-gray-100 text-gray-800'}`}
      >
        {action}
      </span>
    )
  }

  const getResourceBadge = (type: string) => {
    const styles: Record<string, string> = {
      quote: 'bg-purple-100 text-purple-800',
      tenant: 'bg-cyan-100 text-cyan-800',
      user: 'bg-orange-100 text-orange-800',
      subscription: 'bg-teal-100 text-teal-800',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${styles[type] || 'bg-gray-100 text-gray-800'}`}
      >
        {type}
      </span>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
      <p className="mt-2 text-gray-600">Audit trail of admin actions.</p>

      {/* Filters */}
      <div className="mt-6 flex gap-4">
        <select
          value={resourceFilter}
          onChange={(e) => {
            setResourceFilter(e.target.value)
            setActivities([])
          }}
          className="rounded-md border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All resources</option>
          <option value="quote">Quotes</option>
          <option value="tenant">Tenants</option>
          <option value="user">Users</option>
          <option value="subscription">Subscriptions</option>
        </select>
      </div>

      {/* Error State */}
      {error && <div className="mt-4 rounded-lg bg-red-50 p-4 text-red-600">{error}</div>}

      {/* Results Table */}
      <div className="mt-6 overflow-hidden rounded-lg bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Timestamp
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Admin
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Resource
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Resource ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {activities.map((activity) => (
              <tr key={activity.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {new Date(activity.created_at).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <code className="text-xs text-gray-600">{activity.admin_user_id.slice(0, 8)}...</code>
                </td>
                <td className="px-4 py-3">{getActionBadge(activity.action)}</td>
                <td className="px-4 py-3">{getResourceBadge(activity.resource_type)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <code className="text-sm text-gray-600">{activity.resource_id}</code>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {Object.keys(activity.details_json || {}).length > 0
                    ? JSON.stringify(activity.details_json)
                    : '-'}
                </td>
              </tr>
            ))}

            {activities.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No activity logged yet
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
              onClick={() => fetchActivities(nextCursor, true)}
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
