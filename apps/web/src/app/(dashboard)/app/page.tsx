import { syncSelectedPlan } from '@/lib/signup-choices'
import { createClient } from '@/lib/supabase/server'
import { formatMoney } from '@estimator/shared'
import { checkPlanLimit } from '@/lib/plan-limits'
import { PageHeader } from '@/components/dashboard/EmptyState'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Main Dashboard Page
 *
 * Shows overview of quotes, setup progress, and quick actions.
 */
export default async function DashboardPage() {
  const supabase = await createClient()

  // Get user profile with tenant info
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('tenant_id, display_name')
    .eq('id', user.id)
    .single()

  // Safety net: if user somehow has no profile, redirect to signup
  if (!profile?.tenant_id) {
    redirect('/signup?error=account_incomplete')
  }

  const [{ data: tenant }, planLimit] = await Promise.all([
    supabase
      .from('tenants')
      .select('name, branding_json, currency, quote_link_copied_at, quote_link_first_visit_at, selected_plan, onboarding_skipped_at')
      .eq('id', profile.tenant_id)
      .single(),
    checkPlanLimit(supabase, profile.tenant_id),
  ])

  const usagePercent = planLimit.unlimited
    ? 0
    : Math.min(100, Math.round((planLimit.used / planLimit.limit) * 100))
  const limitReached = !planLimit.unlimited && planLimit.used >= planLimit.limit
  const nearLimit = !limitReached && usagePercent >= 80

  // Fetch real quote stats
  const { data: quoteStats } = await supabase
    .from('quotes')
    .select('status, pricing_json')
    .eq('tenant_id', profile.tenant_id)

  const stats = {
    sent: 0,
    viewed: 0,
    accepted: 0,
    revenue: 0,
  }

  if (quoteStats) {
    for (const quote of quoteStats) {
      // Quotes Sent: status in sent, viewed, accepted, paid
      if (['sent', 'viewed', 'accepted', 'paid'].includes(quote.status)) {
        stats.sent++
      }
      // Quotes Viewed: status in viewed, accepted, paid
      if (['viewed', 'accepted', 'paid'].includes(quote.status)) {
        stats.viewed++
      }
      // Quotes Accepted: status in accepted, paid
      if (['accepted', 'paid'].includes(quote.status)) {
        stats.accepted++
        // Revenue: sum of total from accepted/paid quotes
        const total = (quote.pricing_json as { total?: number } | null)?.total
        if (typeof total === 'number') {
          stats.revenue += total
        }
      }
    }
  }

  // Fetch setup completion status
  const [servicesResult, widgetResult] = await Promise.all([
    // Check if tenant has at least one active service
    supabase
      .from('services')
      .select('id')
      .eq('tenant_id', profile.tenant_id)
      .eq('active', true)
      .limit(1),
    // Check if tenant has widget config with form fields
    supabase
      .from('widget_configs')
      .select('config_json')
      .eq('tenant_id', profile.tenant_id)
      .limit(1),
  ])

  const hasService = (servicesResult.data?.length ?? 0) > 0

  // T-150: keep the plan chosen before signup, and take a business with no
  // services straight to setup (unless it chose to set up by hand)
  await syncSelectedPlan(supabase, profile.tenant_id, (tenant as { selected_plan?: string | null } | null)?.selected_plan, user.user_metadata)
  if (!hasService && !(tenant as { onboarding_skipped_at?: string | null } | null)?.onboarding_skipped_at) {
    redirect('/app/onboarding')
  }
  const hasWidgetConfig = (() => {
    const firstConfig = widgetResult.data?.[0]
    if (!firstConfig) return false
    const config = firstConfig.config_json as { fields?: unknown[] } | null
    return Array.isArray(config?.fields) && config.fields.length > 0
  })()
  const hasBranding = (() => {
    if (!tenant?.branding_json) return false
    const branding = tenant.branding_json as { logoAssetId?: string | null; primaryColor?: string }
    // Check if logo is set OR primary color is different from default (#2563eb)
    return branding.logoAssetId !== null || (branding.primaryColor && branding.primaryColor !== '#2563eb')
  })()
  // T-149: ticked by real sharing (link copied, or the quote page's first
  // visit), not by the tenant_sites row the Share page creates on its own
  const hasSharedLink = Boolean(
    (tenant as { quote_link_copied_at?: string | null } | null)?.quote_link_copied_at ||
      (tenant as { quote_link_first_visit_at?: string | null } | null)?.quote_link_first_visit_at
  )

  const setupSteps = [
    { id: 'service', label: 'Add a service', completed: hasService, href: '/app/services' },
    { id: 'widget', label: 'Configure widget', completed: hasWidgetConfig, href: '/app/share' },
    { id: 'branding', label: 'Customize branding', completed: hasBranding, href: '/app/branding' },
    { id: 'share', label: 'Share your quote link', completed: hasSharedLink, href: '/app/share' },
  ]

  const completedCount = setupSteps.filter((s) => s.completed).length
  const allComplete = completedCount === setupSteps.length

  return (
    <div>
      <PageHeader
        title={tenant?.name || 'Dashboard'}
        description="Overview of your quotes and activity"
      />

      {/* Plan usage warnings (T-101/T-102) */}
      {limitReached && planLimit.overageAvailable && (
        <div className="mb-8 rounded-warm-xl border border-tape/40 bg-butter/50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-tertiary">
                Plan limit passed ({planLimit.used}/{planLimit.limit}) — overage billing active
              </h2>
              <p className="mt-1 text-sm text-tertiary">
                Quoting continues uninterrupted. Extra quotes are billed at{' '}
                {planLimit.overagePriceCents
                  ? `$${(planLimit.overagePriceCents / 100).toFixed(2)}`
                  : 'your plan rate'}{' '}
                each — upgrading to a bigger plan usually works out cheaper.
              </p>
            </div>
            <Link
              href="/app/billing"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
            >
              Compare Plans
            </Link>
          </div>
        </div>
      )}
      {limitReached && !planLimit.overageAvailable && (
        <div className="mb-8 rounded-warm-xl border border-danger/30 bg-danger-light/50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-danger">
                Monthly quote limit reached ({planLimit.used}/{planLimit.limit})
              </h2>
              <p className="mt-1 text-sm text-danger">
                New requests are still saved as leads, but they aren&apos;t priced — customers are told
                you&apos;ll send their estimate shortly. Upgrade to price them instantly.
              </p>
            </div>
            <Link
              href="/app/billing"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
            >
              Upgrade Plan
            </Link>
          </div>
        </div>
      )}
      {nearLimit && (
        <div className="mb-8 rounded-warm-xl border border-tape/40 bg-butter/50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-tertiary">
                {usagePercent}% of your monthly quote limit used ({planLimit.used}/{planLimit.limit})
              </h2>
              <p className="mt-1 text-sm text-tertiary">
                At the limit, new requests are saved as leads but not priced until you upgrade or the
                month resets. Upgrade now to keep every estimate instant.
              </p>
            </div>
            <Link
              href="/app/billing"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
            >
              View Plans
            </Link>
          </div>
        </div>
      )}

      {/* AI onboarding hero — new tenants with no services yet (T-106) */}
      {!hasService && (
        <div className="mb-8 rounded-xl border border-primary bg-primary p-6 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-xl font-bold">
                Set up with AI — about 5 minutes
              </h2>
              <p className="mt-1 text-sm text-white/80">
                Point us at your website (or describe your services), answer a couple of pricing
                questions in plain English, and start quoting today.
              </p>
            </div>
            <Link
              href="/app/onboarding"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
            >
              Start Setup
            </Link>
          </div>
        </div>
      )}

      {/* Setup Progress - only show if not all complete */}
      {!allComplete && (
        <div className="mb-8 rounded-warm-xl bg-white shadow-warm-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-bold text-text-primary">Complete your setup</h2>
            <span className="text-sm font-medium text-text-secondary">{completedCount} of {setupSteps.length} done</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-surface mb-5">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${(completedCount / setupSteps.length) * 100}%` }}
            />
          </div>

          {/* Steps grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {setupSteps.map((step) => (
              <Link
                key={step.id}
                href={step.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  step.completed
                    ? 'bg-mint text-primary'
                    : 'bg-surface text-text-secondary hover:bg-surface hover:text-text-primary'
                }`}
              >
                {step.completed ? (
                  <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-medium flex-shrink-0">
                    {setupSteps.indexOf(step) + 1}
                  </span>
                )}
                <span className="font-medium truncate">{step.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Quotes Sent" value={stats.sent.toString()} />
        <StatCard title="Quotes Viewed" value={stats.viewed.toString()} />
        <StatCard title="Quotes Accepted" value={stats.accepted.toString()} />
        <StatCard title="Revenue" value={formatMoney(stats.revenue, (tenant as { currency?: string } | null)?.currency || 'USD', undefined, { decimals: 0 })} />
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="mb-4 font-display text-xl font-bold text-text-primary">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            href="/app/services"
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
            title="Configure Services"
            description="Set up the services you offer"
          />
          <QuickAction
            href="/app/share"
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            }
            title="Share Your Quote Link"
            description="Your link, QR code and embed code"
          />
          <QuickAction
            href="/app/quotes"
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            title="View Quotes"
            description="See all customer quotes"
          />
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-warm-xl bg-white shadow-warm-md p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{title}</p>
      <p className="figure mt-3 text-4xl font-medium tracking-tight text-text-primary">{value}</p>
    </div>
  )
}

function QuickAction({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-4 rounded-warm-xl bg-white shadow-warm-md p-5 transition-all hover:shadow-warm-hover hover:-translate-y-0.5"
    >
      <div className="rounded-warm-lg bg-mint p-2.5 text-primary">{icon}</div>
      <div>
        <h3 className="font-semibold text-text-primary">{title}</h3>
        <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
      </div>
    </Link>
  )
}
