'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/dashboard/EmptyState'
import type { AnalyticsResponse } from '@estimator/shared'

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const response = await fetch('/api/analytics')
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error?.message || 'Failed to fetch analytics')
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch analytics')
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
  }, [])

  // Format period to readable month/year
  const formatPeriod = (yyyymm: string) => {
    const year = yyyymm.slice(0, 4)
    const month = parseInt(yyyymm.slice(4, 6), 10)
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ]
    return `${months[month - 1]} ${year}`
  }

  // Calculate usage percentage
  const usagePercentage = data
    ? Math.min(100, Math.round((data.usage.estimatesCreated / data.usage.planLimit) * 100))
    : 0

  // Get usage bar color based on percentage
  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500'
    if (percentage >= 75) return 'bg-yellow-500'
    return 'bg-primary'
  }

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Analytics"
          description="Track your quote performance and conversion rates"
        />
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="Analytics"
          description="Track your quote performance and conversion rates"
        />
        <div className="rounded-warm-lg bg-danger-light p-4 text-danger">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Track your quote performance and conversion rates"
      />

      {/* Stats cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <p className="text-sm font-medium text-text-muted">Total Quotes</p>
          <p className="mt-2 text-3xl font-bold text-text-primary">
            {data?.metrics.totalQuotes || 0}
          </p>
        </div>
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <p className="text-sm font-medium text-text-muted">Quotes Viewed</p>
          <p className="mt-2 text-3xl font-bold text-text-primary">
            {data?.metrics.quotesViewed || 0}
          </p>
        </div>
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <p className="text-sm font-medium text-text-muted">Quotes Accepted</p>
          <p className="mt-2 text-3xl font-bold text-text-primary">
            {data?.metrics.quotesAccepted || 0}
          </p>
        </div>
        <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
          <p className="text-sm font-medium text-text-muted">Conversion Rate</p>
          <p className="mt-2 text-3xl font-bold text-text-primary">
            {data?.metrics.conversionRate || 0}%
          </p>
        </div>
      </div>

      {/* Usage section */}
      <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Monthly Usage</h3>
            <p className="text-sm text-text-muted">
              {data ? formatPeriod(data.usage.periodYYYYMM) : ''} - {data?.usage.planName} Plan
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-text-primary">
              {data?.usage.estimatesCreated || 0}
              <span className="text-lg font-normal text-text-muted">
                {' '}/ {data?.usage.planLimit || 0}
              </span>
            </p>
            <p className="text-sm text-text-muted">estimates created</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full transition-all ${getUsageColor(usagePercentage)}`}
              style={{ width: `${usagePercentage}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-text-muted">
            <span>{usagePercentage}% used</span>
            <span>{(data?.usage.planLimit || 0) - (data?.usage.estimatesCreated || 0)} remaining</span>
          </div>
        </div>

        {/* Sent vs Created */}
        <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4">
          <div>
            <p className="text-sm text-text-muted">Estimates Created</p>
            <p className="text-xl font-semibold text-text-primary">{data?.usage.estimatesCreated || 0}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Estimates Sent</p>
            <p className="text-xl font-semibold text-text-primary">{data?.usage.estimatesSent || 0}</p>
          </div>
        </div>
      </div>

      {/* Additional metrics */}
      <div className="mt-6 rounded-warm-lg bg-surface p-6 shadow-warm">
        <h3 className="text-lg font-semibold text-text-primary">Quote Funnel</h3>
        <p className="mb-4 text-sm text-text-muted">Track how quotes progress through stages</p>

        <div className="space-y-3">
          <FunnelRow
            label="Created"
            count={data?.metrics.totalQuotes || 0}
            total={data?.metrics.totalQuotes || 1}
          />
          <FunnelRow
            label="Viewed"
            count={data?.metrics.quotesViewed || 0}
            total={data?.metrics.totalQuotes || 1}
          />
          <FunnelRow
            label="Accepted"
            count={data?.metrics.quotesAccepted || 0}
            total={data?.metrics.totalQuotes || 1}
          />
          <FunnelRow
            label="Paid"
            count={data?.metrics.quotesPaid || 0}
            total={data?.metrics.totalQuotes || 1}
          />
        </div>
      </div>
    </div>
  )
}

function FunnelRow({
  label,
  count,
  total,
}: {
  label: string
  count: number
  total: number
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0

  return (
    <div className="flex items-center gap-4">
      <span className="w-20 text-sm text-text-secondary">{label}</span>
      <div className="flex-1">
        <div className="h-6 w-full overflow-hidden rounded bg-background">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <span className="w-12 text-right text-sm font-medium text-text-primary">{count}</span>
      <span className="w-12 text-right text-xs text-text-muted">{percentage}%</span>
    </div>
  )
}
