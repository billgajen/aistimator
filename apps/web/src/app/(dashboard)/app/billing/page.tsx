'use client'

import { Suspense, useEffect, useState } from 'react'
import { formatMoney } from '@estimator/shared'
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
  // T-134: monthly or annual (two months free)
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly')
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
        body: JSON.stringify({ planId, interval: billingInterval }),
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
      active: 'bg-secondary-light text-secondary',
      trialing: 'bg-blue-100 text-primary',
      past_due: 'bg-tertiary-light text-tertiary',
      canceled: 'bg-background text-text-primary',
      none: 'bg-background text-text-primary',
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
        <div className="rounded-warm-lg bg-danger-light p-4 text-danger">{error}</div>
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
          className={`mb-4 rounded-warm-lg p-4 ${
            toast.type === 'success' ? 'bg-secondary-light text-secondary' : 'bg-danger-light text-danger'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Current plan card */}
      <div className="mb-8 rounded-warm-lg bg-surface p-6 shadow-warm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-text-primary">Current Plan</h2>
            <p className="mt-1 text-sm text-text-muted">
              {currentPlan ? currentPlan.name : 'Free'} plan
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(data?.subscription.status || 'none')}
            {isPaid && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                className="rounded-warm-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
              >
                {portalLoading ? 'Loading...' : 'Manage Billing'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-text-muted">Quotes this month</p>
            <p className="mt-1 text-2xl font-bold text-text-primary">
              {data?.usage.estimatesCreated || 0} / {data?.usage.planLimit || 50}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full ${usagePercentage >= 90 ? 'bg-red-500' : usagePercentage >= 75 ? 'bg-yellow-500' : 'bg-primary'}`}
                style={{ width: `${usagePercentage}%` }}
              />
            </div>
            {/* T-102: overage status */}
            {data?.usage.overagePriceCents ? (
              <p className="mt-2 text-xs text-text-muted">
                Beyond your limit, extra quotes are billed at{' '}
                <span className="font-medium text-text-secondary">
                  {formatPrice(data.usage.overagePriceCents)} each
                </span>
                {(data.usage.overageUsed || 0) > 0 && (
                  <>
                    {' '}
                    — <span className="font-medium text-text-secondary">{data.usage.overageUsed} overage quote{data.usage.overageUsed === 1 ? '' : 's'}</span> this period
                  </>
                )}
              </p>
            ) : data?.usage.level === 'limit' ? (
              <p className="mt-2 text-xs text-red-600">
                Limit reached — new requests are saved as leads but not priced
                {data.usage.heldLeads ? ` (${data.usage.heldLeads} waiting)` : ''}. Upgrade to price them.
              </p>
            ) : data?.usage.level === 'warning' ? (
              <p className="mt-2 text-xs text-tertiary">You&apos;ve used 80% or more of this month&apos;s estimates.</p>
            ) : null}
          </div>
          <div>
            <p className="text-sm text-text-muted">
              {data?.subscription.status === 'trialing' ? 'Trial ends' : 'Renews on'}
            </p>
            <p className="mt-1 text-2xl font-bold text-text-primary">
              {data?.subscription.currentPeriodEnd
                ? new Date(data.subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Monthly cost</p>
            <p className="mt-1 text-2xl font-bold text-text-primary">
              {currentPlan ? formatPrice(currentPlan.priceCents) : '$0'}
              <span className="text-base font-normal text-text-muted">/mo</span>
            </p>
          </div>
        </div>

        {data?.subscription.cancelAtPeriodEnd && (
          <div className="mt-4 rounded-warm-lg bg-tertiary-light p-3 text-sm text-tertiary">
            Your subscription will be canceled at the end of the current billing period.
          </div>
        )}
      </div>

      {/* Available plans */}
      <div className="rounded-warm-lg bg-surface p-6 shadow-warm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-text-primary">Available Plans</h2>
            <p className="mt-1 text-sm text-text-muted">Subscription only — no commission, no per-estimate fees</p>
          </div>
          <div className="inline-flex rounded-full border border-border bg-background p-1 text-sm">
            {(['monthly', 'annual'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setBillingInterval(opt)}
                className={`rounded-full px-3 py-1 font-medium ${billingInterval === opt ? 'bg-primary text-on-primary' : 'text-text-secondary'}`}
              >
                {opt === 'monthly' ? 'Monthly' : 'Annual · 2 months free'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.availablePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={currentPlan?.id === plan.id}
              // T-150: the plan picked before signup, highlighted until they subscribe
              isChosen={!isPaid && data?.selectedPlanId === plan.id}
              interval={billingInterval}
              // Existing subscribers change plans in the Stripe portal (proration on);
              // new subscribers go through checkout (trial where the plan has one)
              onSelect={() =>
                data?.subscription.stripeCustomerId &&
                ['active', 'trialing', 'past_due'].includes(data.subscription.status)
                  ? handlePortal()
                  : handleCheckout(plan.id)
              }
              loading={checkoutLoading === plan.id}
              disabled={currentPlan?.id === plan.id}
            />
          ))}
        </div>

        {data?.availablePlans.length === 0 && (
          <div className="mt-6 text-center text-text-muted">
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
  isChosen = false,
  onSelect,
  loading,
  disabled,
  interval,
}: {
  plan: PlanInfo
  interval: 'monthly' | 'annual'
  isCurrent: boolean
  isChosen?: boolean
  onSelect: () => void
  loading: boolean
  disabled: boolean
}) {
  return (
    <div
      className={`relative rounded-warm-lg border p-6 ${
        isCurrent ? 'border-blue-500 ring-2 ring-blue-500' : isChosen ? 'border-primary ring-2 ring-primary' : 'border-border'
      }`}
    >
      {isChosen && !isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-on-primary">
            The plan you picked
          </span>
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-medium text-white">
            Current Plan
          </span>
        </div>
      )}

      <div className="text-center">
        <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
        <div className="mt-2">
          <span className="text-3xl font-bold text-text-primary">
            {interval === 'annual' && plan.annualPriceCents
              ? formatMoney(plan.annualPriceCents / 100, plan.currency.toUpperCase(), 'en-US', { decimals: 0 })
              : formatMoney(plan.priceCents / 100, plan.currency.toUpperCase(), 'en-US', { decimals: 0 })}
          </span>
          <span className="text-text-muted">{interval === 'annual' && plan.annualPriceCents ? '/yr' : '/mo'}</span>
        </div>
        {plan.trialDays ? (
          <p className="mt-1 text-xs font-medium text-primary">{plan.trialDays}-day free trial</p>
        ) : null}
        <p className="mt-2 text-sm text-text-muted">
          {plan.monthlyEstimateLimit.toLocaleString()} estimates/month
        </p>
      </div>

      <ul className="mt-6 space-y-3">
        <FeatureItem included={plan.features.pdfGeneration} label="PDF generation" />
        <FeatureItem included={plan.features.emailNotifications} label="Email notifications" />
        <FeatureItem included={plan.features.customBranding} label="Custom branding" />
        <FeatureItem included={plan.features.prioritySupport} label="Priority support" />
        <FeatureItem included={Boolean(plan.channels?.includes('sms'))} label="Quoting by text (SMS)" />
        <FeatureItem included={Boolean(plan.channels?.includes('whatsapp'))} label="WhatsApp quoting" />
        <FeatureItem included={Boolean(plan.channels?.includes('mobile_app'))} label="On-site mobile app" />
        <FeatureItem included={Boolean(plan.features.calibrationInsights)} label="Accuracy insights" />
        <FeatureItem included={Boolean(plan.features.lidarScanning)} label="LiDAR scanning" />
      </ul>

      <button
        onClick={onSelect}
        disabled={disabled || loading}
        className={`mt-6 w-full rounded-warm-lg px-4 py-2 text-sm font-medium transition-colors ${
          isCurrent
            ? 'cursor-not-allowed bg-background text-text-muted'
            : disabled
              ? 'cursor-not-allowed bg-background text-text-muted'
              : 'bg-primary text-white hover:bg-primary-hover'
        }`}
      >
        {loading ? 'Loading...' : isCurrent ? 'Current Plan' : plan.trialDays ? `Start ${plan.trialDays}-day trial` : 'Select Plan'}
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
      <span className={included ? 'text-text-secondary' : 'text-text-muted'}>{label}</span>
    </li>
  )
}
