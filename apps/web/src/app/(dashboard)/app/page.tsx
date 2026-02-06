import { createClient } from '@/lib/supabase/server'
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

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name, branding_json')
    .eq('id', profile.tenant_id)
    .single()

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
  const [servicesResult, widgetResult, sitesResult] = await Promise.all([
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
    // Check if tenant has active site configured
    supabase
      .from('tenant_sites')
      .select('id')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .limit(1),
  ])

  const hasService = (servicesResult.data?.length ?? 0) > 0
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
  const hasVerifiedSite = (sitesResult.data?.length ?? 0) > 0

  const setupSteps = [
    { id: 'service', label: 'Add a service', completed: hasService, href: '/app/services' },
    { id: 'widget', label: 'Configure widget', completed: hasWidgetConfig, href: '/app/widget' },
    { id: 'branding', label: 'Customize branding', completed: hasBranding, href: '/app/branding' },
    { id: 'embed', label: 'Embed on website', completed: hasVerifiedSite, href: '/app/widget' },
  ]

  const completedCount = setupSteps.filter((s) => s.completed).length
  const allComplete = completedCount === setupSteps.length

  return (
    <div>
      <PageHeader
        title={tenant?.name || 'Dashboard'}
        description="Overview of your quotes and activity"
      />

      {/* Setup Progress - only show if not all complete */}
      {!allComplete && (
        <div className="mb-8 rounded-xl border border-border bg-background p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-bold text-text-primary">Complete your setup</h2>
            <span className="text-sm font-medium text-text-secondary">{completedCount} of {setupSteps.length} done</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-surface mb-5">
            <div
              className="h-2 rounded-full bg-secondary transition-all"
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
                    ? 'bg-secondary-light text-secondary'
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
        <StatCard title="Revenue" value={`$${stats.revenue.toLocaleString()}`} />
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
            href="/app/widget"
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            }
            title="Get Embed Code"
            description="Add the widget to your site"
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
    <div className="rounded-xl border border-border bg-background p-6">
      <p className="text-sm font-medium text-text-muted">{title}</p>
      <p className="mt-2 font-display text-4xl font-extrabold tracking-tight text-text-primary">{value}</p>
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
      className="flex items-start gap-4 rounded-xl border border-border bg-background p-5 transition-all hover:border-border-strong"
    >
      <div className="rounded-lg bg-surface p-2.5 text-text-primary">{icon}</div>
      <div>
        <h3 className="font-semibold text-text-primary">{title}</h3>
        <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
      </div>
    </Link>
  )
}
