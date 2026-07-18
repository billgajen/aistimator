'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/dashboard/EmptyState'
import type { AnalyticsResponse, ServiceCalibration, ServiceBenchmark } from '@estimator/shared'

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // T-110: per-service pricing calibration from quote outcomes
  const [calibration, setCalibration] = useState<ServiceCalibration[] | null>(null)
  // T-115: anonymized cross-tenant rate benchmarks (opt-in)
  const [benchmarks, setBenchmarks] = useState<{
    optedIn: boolean
    currency?: string
    benchmarks: ServiceBenchmark[]
  } | null>(null)
  const [optingIn, setOptingIn] = useState(false)

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

    async function fetchCalibration() {
      try {
        const response = await fetch('/api/learning/calibration')
        if (!response.ok) return // insights are best-effort; core analytics still render
        const result = await response.json()
        setCalibration(result.services || [])
      } catch {
        // Non-fatal
      }
    }

    async function fetchBenchmarks() {
      try {
        const response = await fetch('/api/learning/benchmarks')
        if (!response.ok) return
        setBenchmarks(await response.json())
      } catch {
        // Non-fatal
      }
    }

    fetchAnalytics()
    fetchCalibration()
    fetchBenchmarks()
  }, [])

  // T-115: opt in to benchmark sharing, then refetch
  async function handleBenchmarkOptIn() {
    setOptingIn(true)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benchmarksOptIn: true }),
      })
      if (res.ok) {
        const refreshed = await fetch('/api/learning/benchmarks')
        if (refreshed.ok) setBenchmarks(await refreshed.json())
      }
    } catch {
      // Non-fatal
    } finally {
      setOptingIn(false)
    }
  }

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

      {/* Pricing Insights (T-110): outcome calibration suggestions */}
      {calibration && calibration.some((s) => s.suggestions.length > 0) && (
        <div className="mb-8">
          <h3 className="mb-1 text-lg font-semibold text-text-primary">Pricing Insights</h3>
          <p className="mb-4 text-sm text-text-muted">
            Based on how your quotes performed over the last 90 days. Suggestions only — nothing
            changes unless you apply it.
          </p>
          <div className="space-y-3">
            {calibration
              .flatMap((svc) => svc.suggestions.map((sug) => ({ svc, sug })))
              .map(({ svc, sug }, i) => (
                <div
                  key={`${svc.serviceId}-${sug.type}-${i}`}
                  className="rounded-warm-lg bg-surface p-5 shadow-warm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
                            sug.type === 'raise_rates'
                              ? 'bg-green-500'
                              : sug.type === 'lower_rates'
                                ? 'bg-amber-500'
                                : 'bg-blue-500'
                          }`}
                        />
                        <h4 className="font-semibold text-text-primary">{sug.headline}</h4>
                      </div>
                      <p className="mt-1 text-sm text-text-secondary">{sug.detail}</p>
                      {(sug.type === 'raise_rates' || sug.type === 'lower_rates') && (
                        <p className="mt-2 text-xs text-text-muted">
                          To apply: open the service&apos;s pricing and tell the composer:{' '}
                          <span className="font-medium text-text-secondary">
                            &quot;{sug.suggestedAction}&quot;
                          </span>
                        </p>
                      )}
                    </div>
                    <Link
                      href="/app/services"
                      className="inline-flex shrink-0 items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-background"
                    >
                      Adjust pricing →
                    </Link>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Per-service outcomes table (T-110) */}
      {calibration && calibration.length > 0 && (
        <div className="mb-8 rounded-warm-lg bg-surface p-6 shadow-warm">
          <h3 className="mb-4 text-lg font-semibold text-text-primary">Quote Outcomes by Service</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted">
                  <th className="pb-2 pr-4 font-medium">Service</th>
                  <th className="pb-2 pr-4 font-medium">Sent</th>
                  <th className="pb-2 pr-4 font-medium">Accepted</th>
                  <th className="pb-2 pr-4 font-medium">Acceptance</th>
                  <th className="pb-2 font-medium">Median edit before send</th>
                </tr>
              </thead>
              <tbody>
                {calibration.map((svc) => (
                  <tr key={svc.serviceId} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium text-text-primary">{svc.serviceName}</td>
                    <td className="py-2 pr-4 text-text-secondary">{svc.quotesSent}</td>
                    <td className="py-2 pr-4 text-text-secondary">{svc.accepted}</td>
                    <td className="py-2 pr-4 text-text-secondary">
                      {svc.acceptanceRatePct !== null ? `${svc.acceptanceRatePct}%` : '—'}
                    </td>
                    <td className="py-2 text-text-secondary">
                      {svc.medianDeltaPct !== null
                        ? `${svc.medianDeltaPct > 0 ? '+' : ''}${svc.medianDeltaPct}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Market benchmarks (T-115) — anonymized, opt-in, informational only */}
      {benchmarks && (
        <div className="mb-8 rounded-warm-lg bg-surface p-6 shadow-warm">
          <h3 className="text-lg font-semibold text-text-primary">Market Benchmarks</h3>
          {!benchmarks.optedIn ? (
            <div className="mt-2">
              <p className="text-sm text-text-secondary">
                See what similar businesses charge per room, square metre or hour — anonymized
                across businesses in your currency. To see benchmarks, you share your own rates
                into the same anonymous pool (nothing identifies your business).
              </p>
              <button
                type="button"
                onClick={handleBenchmarkOptIn}
                disabled={optingIn}
                className="mt-3 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {optingIn ? 'Enabling…' : 'Share & See Benchmarks'}
              </button>
            </div>
          ) : benchmarks.benchmarks.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">
              Not enough comparable businesses yet — benchmarks appear once at least 3 other
              businesses with similar services and your currency are sharing rates.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {benchmarks.benchmarks.map((b, i) => {
                const inRange = b.yourRate >= b.p25 && b.yourRate <= b.p75
                const position =
                  b.yourRate < b.p25 ? 'below' : b.yourRate > b.p75 ? 'above' : 'within'
                return (
                  <div key={`${b.serviceId}-${b.unit}-${i}`} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-text-primary">
                        {b.serviceName} — per {b.unit}
                      </p>
                      <p className="text-xs text-text-muted">
                        {b.sampleTenants} similar businesses
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      Similar businesses charge{' '}
                      <span className="font-semibold text-text-primary">
                        {b.p25.toLocaleString()}–{b.p75.toLocaleString()}
                      </span>{' '}
                      per {b.unit} (median {b.median.toLocaleString()}). You charge{' '}
                      <span
                        className={`font-semibold ${
                          inRange ? 'text-secondary' : 'text-amber-600'
                        }`}
                      >
                        {b.yourRate.toLocaleString()}
                      </span>
                      {position !== 'within' && ` — ${position} the typical range`}.
                    </p>
                  </div>
                )
              })}
              <p className="text-xs text-text-muted">
                Informational only — benchmarks never change your pricing.
              </p>
            </div>
          )}
        </div>
      )}

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
