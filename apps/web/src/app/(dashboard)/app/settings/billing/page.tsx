'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { formatMoney, getPlan } from '@qolumns/shared'
import { COMING_SOON, PLUS_TAX, planLines } from '@/lib/marketing/plan-claims'
import type { BillingResponse, PlanInfo } from '@qolumns/shared'
import { pendingChangeLine, type PendingPlanChange } from '@/lib/billing-pending'

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
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    </div>
  )
}

function BillingPageContent() {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  // T-134: monthly or annual (two months free)
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  // T-180: a downgrade asked for in the portal, waiting for the end of the paid period
  const [pending, setPending] = useState<PendingPlanChange | null>(null)

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  // Runs once. The address is read here and then cleaned; it must not be a dependency: cleaning it
  // changes it, which would start a second load that races the first and can show the old state
  // (found by verify-t180: the page showed "Free" after a paid checkout until it was reloaded).
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    async function load() {
      try {
        // T-180: back from Checkout. Store the plan from Stripe now, so it shows without
        // waiting for the webhook; then read the page's data. A failed confirm is not an
        // error: the webhook stores the same thing a moment later.
        const params = new URLSearchParams(window.location.search)
        const sessionId = params.get('session_id')
        const success = params.get('success') === 'true'
        const canceled = params.get('canceled') === 'true'
        if (success || canceled) window.history.replaceState({}, '', '/app/settings/billing')
        if (success && sessionId) {
          await fetch('/api/billing/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          }).catch(() => undefined)
        }
        const response = await fetch('/api/billing')
        if (!response.ok) {
          const err = await response.json()
          throw new Error(err.error?.message || 'Failed to fetch billing info')
        }
        const result: BillingResponse = await response.json()
        setData(result)
        // Is a plan change waiting? Asked only for a business with a paid plan; never holds the page up.
        if (result.subscription.plan && result.canManage && !result.subscription.testAccount) {
          fetch('/api/billing/pending')
            .then((res) => (res.ok ? res.json() : null))
            .then((json: { pending?: PendingPlanChange | null } | null) => setPending(json?.pending ?? null))
            .catch(() => undefined)
        }
        if (success) {
          setToast(
            result.subscription.plan
              ? { message: `Your ${result.subscription.plan.name} plan is active.`, type: 'success' }
              : { message: 'Payment received. Your plan will show here in a moment: reload the page.', type: 'success' }
          )
        } else if (canceled) {
          setToast({ message: 'Checkout was not finished. Nothing was charged.', type: 'error' })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch billing info')
      } finally {
        setLoading(false)
      }
    }

    load()
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
      trialing: 'bg-primary-light text-primary',
      past_due: 'bg-danger-light text-danger',
      canceled: 'bg-background text-text-primary',
      none: 'bg-background text-text-primary',
    }
    const labels: Record<string, string> = {
      active: 'Active',
      trialing: 'Trial',
      past_due: 'Payment problem',
      canceled: 'No plan',
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

  // T-152: without a plan, the free allowance counts every month (never resets)
  const freeTotal = data?.usage.per === 'total'

  const usagePercentage = data
    ? Math.min(100, Math.round((data.usage.estimatesCreated / data.usage.planLimit) * 100))
    : 0

  if (loading) {
    return (
      <div>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <div className="rounded-xl bg-danger-light p-4 text-danger">{error}</div>
      </div>
    )
  }

  const subscription = data?.subscription
  const currentPlan = subscription?.plan
  const isPaid = currentPlan && currentPlan.priceCents > 0
  // T-180: what this business can do here. A test account (T-177) has its plan without
  // paying: no Checkout, no portal. A business with a plan changes it in Stripe's portal.
  // Only a business with no plan now is offered Checkout.
  const testAccount = subscription?.testAccount === true
  const canCheckout = data?.canCheckout !== false && !testAccount
  const canManage = data?.canManage === true && !testAccount
  const yearly = subscription?.interval === 'annual'
  const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`mb-4 rounded-xl p-4 ${
            toast.type === 'success' ? 'bg-secondary-light text-secondary' : 'bg-danger-light text-danger'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Current plan card */}
      <div className="mb-8 rounded-xl bg-surface p-6 shadow-warm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-text-primary">Current Plan</h2>
            <p className="mt-1 text-sm text-text-muted" data-testid="current-plan">
              {currentPlan
                ? `${currentPlan.name} plan${testAccount ? '' : yearly ? ', billed yearly' : subscription?.interval === 'monthly' ? ', billed monthly' : ''}`
                : freeTotal
                  ? `Free: ${data?.usage.planLimit ?? 0} priced quotes in total, no card`
                  : 'Free plan'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {testAccount ? (
              <span className="inline-flex items-center rounded-full bg-mist px-3 py-1 text-sm font-medium text-text-secondary" data-testid="test-account-tag">
                Test account
              </span>
            ) : (
              getStatusBadge(subscription?.status || 'none')
            )}
            {canManage && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                data-testid="manage-billing"
                className="min-h-[44px] rounded-lg border border-field bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-background disabled:opacity-50"
              >
                {portalLoading ? 'Loading...' : currentPlan ? 'Manage billing' : 'Invoices and card'}
              </button>
            )}
          </div>
        </div>

        {/* T-180: the one thing to know about this plan right now, in words */}
        {testAccount && (
          <p className="mt-4 rounded-xl bg-mist p-3 text-sm text-text-secondary" data-testid="test-account-note">
            This is a test account. It has the {currentPlan?.name} plan without paying: nothing is billed, and there is nothing to buy or manage here.
          </p>
        )}
        {subscription?.paymentFailed && !testAccount && (
          <div className="mt-4 rounded-xl border border-danger-line bg-danger-light p-3 text-sm text-danger" data-testid="payment-failed-note">
            Your payment didn&rsquo;t go through. Your plan keeps working while the payment is tried again. Update your card in &ldquo;Manage billing&rdquo; to keep your quotes running.
          </div>
        )}
        {subscription?.cancelAt && currentPlan && !subscription.paymentFailed && (
          <p className="mt-4 rounded-xl bg-mist p-3 text-sm text-text-secondary" data-testid="cancel-note">
            Your {currentPlan.name} plan ends on {longDate(subscription.cancelAt)}. It works as normal until then. To keep it, open &ldquo;Manage billing&rdquo;.
          </p>
        )}
        {pending && currentPlan && !subscription?.cancelAt && (
          <p className="mt-4 rounded-xl bg-mist p-3 text-sm text-text-secondary" data-testid="pending-change">
            {pendingChangeLine(pending, currentPlan.name, longDate(pending.at))} Until then your {currentPlan.name} plan works as normal.
          </p>
        )}
        {!currentPlan && subscription?.endedPlanName && (
          <p className="mt-4 rounded-xl bg-mist p-3 text-sm text-text-secondary" data-testid="ended-note">
            Your {subscription.endedPlanName} plan has ended. New requests are saved for you but not priced until you pick a plan.
          </p>
        )}
        {data?.suspended && (
          <p className="mt-4 rounded-xl border border-danger-line bg-danger-light p-3 text-sm text-danger" data-testid="suspended-note">
            Your account is paused. New requests are being saved, not priced.
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-text-muted">{freeTotal ? 'Free quotes used' : 'Quotes this month'}</p>
            <p className="mt-1 text-2xl font-bold text-text-primary" data-testid="usage-count">
              {data?.usage.estimatesCreated || 0} / {data?.usage.planLimit ?? 0}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className={`h-full ${usagePercentage >= 90 ? 'bg-danger' : usagePercentage >= 75 ? 'bg-tertiary' : 'bg-primary'}`}
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
              <p className="mt-2 text-xs text-danger">
                {freeTotal ? 'Free quotes used' : 'Limit reached'} — new requests are saved as leads but not priced
                {data.usage.heldLeads ? ` (${data.usage.heldLeads} waiting)` : ''}. {freeTotal ? 'Pick a plan' : 'Upgrade'} to price them.
              </p>
            ) : data?.freeQuotesLeftLine ? (
              <p className="mt-2 text-xs font-medium text-text-primary" data-testid="free-quotes-left">
                {data.freeQuotesLeftLine}
              </p>
            ) : data?.usage.level === 'warning' ? (
              <p className="mt-2 text-xs text-tertiary">
                {freeTotal ? 'You’ve used most of your free quotes.' : 'You’ve used 80% or more of this month’s estimates.'}
              </p>
            ) : freeTotal ? (
              <p className="mt-2 text-xs text-text-muted">
                Free quotes don’t reset each month. Tests from setup and unfinished requests don’t count.
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-sm text-text-muted">
              {subscription?.status === 'trialing' ? 'Trial ends' : subscription?.cancelAt ? 'Ends on' : 'Renews on'}
            </p>
            <p className="mt-1 text-2xl font-bold text-text-primary" data-testid="renews-on">
              {subscription?.currentPeriodEnd && !testAccount
                ? new Date(subscription.cancelAt ?? subscription.currentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-text-muted">{yearly ? 'Yearly cost' : 'Monthly cost'}</p>
            <p className="mt-1 text-2xl font-bold text-text-primary" data-testid="plan-cost">
              {testAccount
                ? '$0'
                : currentPlan
                  ? formatPrice(yearly && currentPlan.annualPriceCents ? currentPlan.annualPriceCents : currentPlan.priceCents)
                  : '$0'}
              <span className="text-base font-normal text-text-muted">{yearly ? '/yr' : '/mo'}</span>
            </p>
            {currentPlan && !testAccount && <p className="mt-1 text-xs text-text-muted">Before tax. Tax is added by Stripe, who sells the plan.</p>}
          </div>
        </div>
      </div>

      {/* Available plans */}
      <div className="rounded-xl bg-surface p-6 shadow-warm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-text-primary">Available Plans</h2>
            <p className="mt-1 text-sm text-text-muted">Subscription only — no commission, no per-estimate fees</p>
            {/* T-180: a business with a plan changes it in one place, Stripe's portal: plan, monthly
                or yearly, card, cancel. The cards below are then for reading. */}
            {!canCheckout && canManage && currentPlan && (
              <button
                onClick={handlePortal}
                disabled={portalLoading}
                data-testid="change-plan"
                className="mt-3 min-h-[44px] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {portalLoading ? 'Loading...' : 'Change plan'}
              </button>
            )}
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
              // T-180: only a business with no plan now starts Checkout from a card
              canSelect={canCheckout}
              onSelect={() => handleCheckout(plan.id)}
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
  canSelect,
  onSelect,
  loading,
  disabled,
  interval,
}: {
  plan: PlanInfo
  interval: 'monthly' | 'annual'
  isCurrent: boolean
  isChosen?: boolean
  /** T-180: false for a business that has a plan (it changes plan in the portal) and for a test account */
  canSelect: boolean
  onSelect: () => void
  loading: boolean
  disabled: boolean
}) {
  // the plan as it is defined (packages/shared/src/plans.ts), for its lines
  const definition = getPlan(plan.id)
  const lines = definition ? planLines(definition) : []
  return (
    <div
      className={`relative rounded-xl border p-6 ${
        isCurrent ? 'border-ink ring-2 ring-ink' : isChosen ? 'border-primary ring-2 ring-primary' : 'border-border'
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
        {/* T-180: Stripe adds the tax at checkout */}
        <p className="mt-1 text-xs text-text-muted" data-testid="plus-tax">{PLUS_TAX}</p>
        {plan.trialDays ? (
          <p className="mt-1 text-xs font-medium text-primary">{plan.trialDays}-day free trial</p>
        ) : null}
        <p className="mt-2 text-sm text-text-muted">
          {plan.monthlyEstimateLimit.toLocaleString()} estimates/month
        </p>
      </div>

      {/* T-171: the plan's lines come from the same list the public Pricing page reads
          (lib/marketing/plan-claims.ts), so the two pages cannot disagree: a line that is not live yet says
          "Coming later" here too. Every plan on offer can be chosen here, Business included. */}
      <ul className="mt-6 space-y-3" data-testid="plan-lines">
        {lines.map((line) => (
          <PlanLineItem key={line.label} label={line.label} live={line.live} />
        ))}
      </ul>

      {(canSelect || isCurrent) && (
        <button
          onClick={onSelect}
          disabled={disabled || loading || !canSelect}
          className={`mt-6 min-h-[44px] w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            isCurrent || disabled || !canSelect ? 'cursor-not-allowed bg-background text-text-muted' : 'bg-primary text-white hover:bg-primary-hover'
          }`}
        >
          {loading ? 'Loading...' : isCurrent ? 'Current Plan' : plan.trialDays ? `Start ${plan.trialDays}-day trial` : 'Select Plan'}
        </button>
      )}
    </div>
  )
}

function PlanLineItem({ label, live }: { label: string; live: boolean }) {
  return (
    <li className="flex items-start gap-2 text-sm" data-testid="plan-line" data-live={live ? 'true' : 'false'}>
      {live ? (
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        // not live yet: a hollow mark and the words, never a tick
        <svg className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="7" strokeWidth={2} />
        </svg>
      )}
      <span className="text-text-secondary">
        {label}
        {!live && ' '}
        {!live && (
          <span className="ml-1 inline-block whitespace-nowrap rounded-full border border-field px-2 text-xs font-semibold text-text-secondary" data-testid="coming-later">
            {COMING_SOON}
          </span>
        )}
      </span>
    </li>
  )
}
