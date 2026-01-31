import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/dashboard/EmptyState'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Main Dashboard Page
 *
 * Shows overview of quotes and quick actions.
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
  // This shouldn't happen with the trigger, but handles edge cases
  if (!profile?.tenant_id) {
    redirect('/signup?error=account_incomplete')
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', profile.tenant_id)
    .single()

  // Get quote stats (placeholder - will be real data in T-020)
  const stats = {
    sent: 0,
    viewed: 0,
    accepted: 0,
    revenue: 0,
  }

  return (
    <div>
      <PageHeader
        title={`Welcome back${profile?.display_name ? `, ${profile.display_name}` : ''}`}
        description={tenant?.name || 'Your Business'}
      />

      {/* Stats grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Quotes Sent" value={stats.sent.toString()} />
        <StatCard title="Quotes Viewed" value={stats.viewed.toString()} />
        <StatCard title="Quotes Accepted" value={stats.accepted.toString()} />
        <StatCard title="Revenue" value={`$${stats.revenue.toLocaleString()}`} />
      </div>

      {/* Quick actions */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <QuickAction
            href="/app/onboarding"
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            title="Setup Checklist"
            description="Complete your account setup"
          />
        </div>
      </div>

      {/* Setup reminder */}
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h3 className="font-medium text-yellow-800">Complete Your Setup</h3>
            <p className="mt-1 text-sm text-yellow-700">
              Configure your services, pricing rules, and embed the widget on your website to start receiving quotes.
            </p>
            <Link
              href="/app/onboarding"
              className="mt-2 inline-flex items-center text-sm font-medium text-yellow-800 hover:underline"
            >
              View setup checklist
              <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
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
      className="flex items-start gap-4 rounded-lg bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="rounded-lg bg-blue-50 p-2 text-blue-600">{icon}</div>
      <div>
        <h3 className="font-medium text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    </Link>
  )
}
