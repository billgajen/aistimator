'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/dashboard/EmptyState'
import type { BillingResponse, PlanInfo } from '@estimator/shared'

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingPageLoading />}>
      <BillingPageContent />
    </Suspense>
  )
}

function BillingPageLoading() {
  return (
    <div>
      <PageHeader title="Billing" description="Manage your subscription and payment methods" />
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    </div>
  )
}

function BillingPageContent() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Check for success/canceled query params
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setToast({ message: 'Subscription updated successfully!', type: 'success' })
      // Remove query params
      window.history.replaceState({}, '', '/app/billing')
    } else if (searchParams.get('canceled') === 'true') {
      setToast({ message: 'Checkout was canceled', type: 'error' })
      window.history.replaceState({}, '', '/app/billing')
    }
  }, [searchParams])

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  useEffect(() => {
    async function fetchBilling() {
      try {
        const response = await fetch('/api/billing')
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error?.message || 'Failed to fetch billing info')
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch billing info')
      } finally {
        setLoading(false)
      }
    }

    fetchBilling()
  }, [])

  const handleCheckout = async (planId: string) => {
    setCheckoutLoading(planId)
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to create checkout session')
      }

      const result = await response.json()
      window.location.href = result.checkoutUrl
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to start checkout',
        type: 'error',
      })
    } finally {
      setCheckoutLoading(null)
    }
  }

  const handlePortal = async () => {
    setPortalLoading(true)
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Failed to open billing portal')
      }

      const result = await response.json()
      window.location.href = result.portalUrl
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to open billing portal',
        type: 'error',
      })
    } finally {
      setPortalLoading(false)
    }
  }

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      trialing: 'bg-blue-100 text-blue-800',
      past_due: 'bg-yellow-100 text-yellow-800',
      canceled: 'bg-gray-100 text-gray-800',
      none: 'bg-gray-100 text-gray-800',
    }
    const labels: Record<string, string> = {
      active: 'Active',
      trialing: 'Trial',
      past_due: 'Past Due',
      canceled: 'Canceled',
      none: 'Free',
    }
    return (
      <span
        className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${styles[status] || styles.none}`}
      >
        {labels[status] || 'Unknown'}
      </span>
    )
  }

  const usagePercentage = data
    ? Math.min(100, Math.round((data.usage.estimatesCreated / data.usage.planLimit) * 100))
    : 0

  if (loading) {
    return (
      <div>
        <PageHeader title="Billing" description="Manage your subscription and payment methods" />
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Billing" description="Manage your subscription and payment methods" />
        <div className="rounded-lg bg-red-50 p-4 text-red-600">{error}</div>
      </div>
    )
  }

  const currentPlan = data?.subscription.plan
  const isPaid = currentPlan && currentPlan.priceCents > 0

  return (
    <div>
      <PageHeader title="Billing" description="Manage your subscription and payment methods" />

      {/* Toast notification */}
      {toast && (
        <div
          className={`mb-4 rounded-lg p-4 ${
            toast.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Current plan card */}
      <div className="mb-8 rounded-lg bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Current Plan</h2>
            <p className="mt-1 text-sm text-gray-500">
              {currentPlan ? currentPlan.name : 'Free'} plan
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(data?.subscription.status || 'none')}
            {isPaid && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {portalLoading ? 'Loading...' : 'Manage Billing'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-gray-500">Quotes this month</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data?.usage.estimatesCreated || 0} / {data?.usage.planLimit || 50}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full ${usagePercentage >= 90 ? 'bg-red-500' : usagePercentage >= 75 ? 'bg-yellow-500' : 'bg-blue-600'}`}
                style={{ width: `${usagePercentage}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-500">
              {data?.subscription.status === 'trialing' ? 'Trial ends' : 'Renews on'}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data?.subscription.currentPeriodEnd
                ? new Date(data.subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Monthly cost</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {currentPlan ? formatPrice(currentPlan.priceCents) : '$0'}
              <span className="text-base font-normal text-gray-500">/mo</span>
            </p>
          </div>
        </div>

        {data?.subscription.cancelAtPeriodEnd && (
          <div className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            Your subscription will be canceled at the end of the current billing period.
          </div>
        )}
      </div>

      {/* Available plans */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium text-gray-900">Available Plans</h2>
        <p className="mt-1 text-sm text-gray-500">Choose a plan that fits your needs</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.availablePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={currentPlan?.id === plan.id}
              onSelect={() => handleCheckout(plan.id)}
              loading={checkoutLoading === plan.id}
              disabled={!plan.stripePriceId || currentPlan?.id === plan.id}
            />
          ))}
        </div>

        {data?.availablePlans.length === 0 && (
          <div className="mt-6 text-center text-gray-500">
            No plans available at this time.
          </div>
        )}
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  isCurrent,
  onSelect,
  loading,
  disabled,
}: {
  plan: PlanInfo
  isCurrent: boolean
  onSelect: () => void
  loading: boolean
  disabled: boolean
}) {
  return (
    <div
      className={`relative rounded-lg border p-6 ${
        isCurrent ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-200'
      }`}
    >
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white">
            Current Plan
          </span>
        </div>
      )}

      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
        <div className="mt-2">
          <span className="text-3xl font-bold text-gray-900">
            ${(plan.priceCents / 100).toFixed(0)}
          </span>
          <span className="text-gray-500">/mo</span>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {plan.monthlyEstimateLimit.toLocaleString()} estimates/month
        </p>
      </div>

      <ul className="mt-6 space-y-3">
        <FeatureItem included={plan.features.pdfGeneration} label="PDF generation" />
        <FeatureItem included={plan.features.emailNotifications} label="Email notifications" />
        <FeatureItem included={plan.features.customBranding} label="Custom branding" />
        <FeatureItem included={plan.features.prioritySupport} label="Priority support" />
        <FeatureItem included={plan.features.apiAccess} label="API access" />
      </ul>

      <button
        onClick={onSelect}
        disabled={disabled || loading}
        className={`mt-6 w-full rounded-md px-4 py-2 text-sm font-medium transition-colors ${
          isCurrent
            ? 'cursor-not-allowed bg-gray-100 text-gray-500'
            : disabled
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {loading ? 'Loading...' : isCurrent ? 'Current Plan' : disabled ? 'Not Available' : 'Select Plan'}
      </button>
    </div>
  )
}

function FeatureItem({ included, label }: { included: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {included ? (
        <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-4 w-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      <span className={included ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
    </li>
  )
}
