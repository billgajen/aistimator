import { syncSelectedPlan } from '@/lib/signup-choices'
import { createClient } from '@/lib/supabase/server'
import { formatMoney, getRegion, quoteTurn } from '@estimator/shared'
import { buildChecklist } from '@/lib/setup-checklist'
import { homeNumbers, waitingForYou, WAITING_FOR_YOU_STATUSES, HOME_WINDOW_DAYS, type HomeQuoteRow } from '@/lib/home-numbers'
import { WaitingForYou, type WaitingQuote } from '@/components/home/WaitingForYou'
import { checkPlanLimit } from '@/lib/plan-limits'
import { PageHeader } from '@/components/dashboard/EmptyState'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Home (T-152), top to bottom: quotes waiting for the owner (T-158: to
 * approve, a customer question, or a request that could not be priced), unfinished
 * requests, plan usage, the setup checklist until it's done, and four numbers
 * for the last 30 days ("See all numbers" opens Analytics).
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
      .select('name, region, currency, quote_link_copied_at, quote_link_first_visit_at, selected_plan, onboarding_skipped_at, prices_checked_at')
      .eq('id', profile.tenant_id)
      .single(),
    checkPlanLimit(supabase, profile.tenant_id),
  ])

  // T-151: unfinished requests from the last 7 days (own tenant; RLS + explicit filter)
  const { count: unfinishedCount } = await supabase
    .from('request_leads')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id)
    .is('completed_at', null)
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

  const tenantRow = tenant as {
    region?: string | null
    currency?: string | null
    selected_plan?: string | null
    onboarding_skipped_at?: string | null
    quote_link_copied_at?: string | null
    quote_link_first_visit_at?: string | null
    prices_checked_at?: string | null
  } | null
  const currency = tenantRow?.currency || 'USD'
  const locale = getRegion(tenantRow?.region).locale
  const since = new Date(Date.now() - HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  // Every query below is scoped to this tenant (RLS + explicit filter)
  const [servicesResult, waitingResult, recentResult, realRequestResult] = await Promise.all([
    supabase.from('services').select('id').eq('tenant_id', profile.tenant_id).eq('active', true).limit(1),
    // a. waiting for the owner, newest first (T-158: also customer questions
    // and requests that could not be priced)
    supabase
      .from('quotes')
      .select('id, status, created_at, customer_json, pricing_json, content_json, is_test, services!service_id (name)')
      .eq('tenant_id', profile.tenant_id)
      .in('status', [...WAITING_FOR_YOU_STATUSES])
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(25),
    // d. anything that happened in the last 30 days
    supabase
      .from('quotes')
      .select('status, created_at, sent_at, accepted_at, pricing_json, is_test, quote_requests!quote_request_id (source_type:source_json->>type)')
      .eq('tenant_id', profile.tenant_id)
      .or(`created_at.gte.${since.toISOString()},sent_at.gte.${since.toISOString()},accepted_at.gte.${since.toISOString()}`),
    // c. first real request: a customer's (not a setup test, not the business's
    // own app quote — the source lives on the request row)
    supabase
      .from('quotes')
      .select('id, quote_requests!quote_request_id!inner (id)')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_test', false)
      .or('source_json->>type.is.null,source_json->>type.neq.app', { referencedTable: 'quote_requests' })
      .limit(1),
  ])

  const hasService = (servicesResult.data?.length ?? 0) > 0

  // T-150: keep the plan chosen before signup, and take a business with no
  // services straight to setup (unless it chose to set up by hand)
  await syncSelectedPlan(supabase, profile.tenant_id, tenantRow?.selected_plan, user.user_metadata)
  if (!hasService && !tenantRow?.onboarding_skipped_at) {
    redirect('/app/onboarding')
  }

  const waiting: WaitingQuote[] = waitingForYou(
    (waitingResult.data ?? []) as unknown as Array<{
      id: string
      status: string
      created_at: string
      customer_json: { name?: string; email?: string } | null
      pricing_json: { total?: number } | null
      content_json: { limitHold?: boolean } | null
      is_test: boolean | null
      services: { name?: string } | Array<{ name?: string }> | null
    }>
  ).map((q) => {
    const service = Array.isArray(q.services) ? q.services[0] : q.services
    const total = q.pricing_json?.total ?? 0
    // T-158: the same label and next step the quotes list shows
    const turn = quoteTurn({
      status: q.status,
      customerName: q.customer_json?.name,
      hasEmail: Boolean(q.customer_json?.email),
      total,
      held: q.content_json?.limitHold === true,
    })
    return {
      id: q.id,
      customerName: q.customer_json?.name?.trim() || 'Customer',
      serviceName: service?.name || 'Service',
      priceLabel: total > 0 ? formatMoney(total, currency, locale) : null,
      createdLabel: new Date(q.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      label: turn.label,
      tone: turn.tone,
      action: turn.action === 'approve' ? 'approve' : 'open',
      buttonLabel: turn.buttonLabel ?? '',
    }
  })

  const checklist = buildChecklist({
    hasService,
    pricesCheckedAt: tenantRow?.prices_checked_at,
    quoteLinkCopiedAt: tenantRow?.quote_link_copied_at,
    quoteLinkFirstVisitAt: tenantRow?.quote_link_first_visit_at,
    hasRealRequest: (realRequestResult.data?.length ?? 0) > 0,
  })

  const numbers = homeNumbers(
    ((recentResult.data ?? []) as unknown as Array<HomeQuoteRow & { quote_requests?: { source_type?: string | null } | Array<{ source_type?: string | null }> | null }>).map(
      (q) => ({ ...q, source_type: (Array.isArray(q.quote_requests) ? q.quote_requests[0] : q.quote_requests)?.source_type ?? null })
    ),
    since
  )

  const usagePercent = planLimit.unlimited ? 0 : Math.min(100, Math.round((planLimit.used / planLimit.limit) * 100))
  const limitReached = !planLimit.unlimited && planLimit.used >= planLimit.limit
  const nearLimit = !limitReached && usagePercent >= 80
  const free = planLimit.per === 'total'

  return (
    <div>
      <PageHeader title={tenant?.name || 'Home'} />

      {/* a. T-152: the work waiting for the owner comes first */}
      <WaitingForYou quotes={waiting} />

      {/* b. T-151: people who started a request but didn't finish (last 7 days) */}
      {(unfinishedCount ?? 0) > 0 && (
        <Link
          href="/app/quotes?filter=unfinished"
          className="mb-8 flex items-center justify-between gap-3 rounded-warm-lg border border-tape/40 bg-butter px-5 py-4 text-sm text-text-primary hover:border-tape"
          data-testid="unfinished-count"
        >
          <span>
            <span className="figure text-lg font-bold">{unfinishedCount}</span>{' '}
            {(unfinishedCount ?? 0) === 1 ? 'person' : 'people'} started a request in the last 7 days but didn&apos;t finish. A quick call often wins the job.
          </span>
          <span className="shrink-0 font-semibold text-primary">See who</span>
        </Link>
      )}

      {/* Plan usage (T-101/T-102/T-134; T-152: the free allowance never resets) */}
      {limitReached && planLimit.overageAvailable && (
        <UsageBanner
          tone="warn"
          title={`Plan limit passed (${planLimit.used}/${planLimit.limit}) — overage billing active`}
          text={`Quoting continues uninterrupted. Extra quotes are billed at ${
            planLimit.overagePriceCents ? `$${(planLimit.overagePriceCents / 100).toFixed(2)}` : 'your plan rate'
          } each — upgrading to a bigger plan usually works out cheaper.`}
          cta="Compare plans"
        />
      )}
      {limitReached && !planLimit.overageAvailable && (
        <UsageBanner
          tone="danger"
          title={free ? `You've used your ${planLimit.limit} free quotes` : `Monthly quote limit reached (${planLimit.used}/${planLimit.limit})`}
          text={`New requests are still saved as leads, but they aren't priced — customers are told you'll send their estimate shortly. ${
            free ? 'Pick a plan to price them instantly.' : 'Upgrade to price them instantly.'
          }`}
          cta={free ? 'Pick a plan' : 'Upgrade plan'}
        />
      )}
      {nearLimit && (
        <UsageBanner
          tone="warn"
          title={
            free
              ? `${planLimit.used} of your ${planLimit.limit} free quotes used`
              : `${usagePercent}% of your monthly quote limit used (${planLimit.used}/${planLimit.limit})`
          }
          text={
            free
              ? 'After your free quotes, new requests are saved as leads but not priced until you pick a plan.'
              : 'At the limit, new requests are saved as leads but not priced until you upgrade or the month resets.'
          }
          cta="View plans"
        />
      )}

      {/* c. Setup checklist until complete (T-152) */}
      {!checklist.complete && (
        <section className="mb-8 rounded-warm-xl bg-white p-6 shadow-warm-md" data-testid="setup-checklist">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-text-primary">Get set up</h2>
            <span className="text-sm font-medium text-text-secondary">
              {checklist.done} of {checklist.steps.length} done
            </span>
          </div>
          <div className="mb-5 h-2 w-full rounded-full bg-surface">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${(checklist.done / checklist.steps.length) * 100}%` }}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {checklist.steps.map((step, i) => (
              <Link
                key={step.id}
                href={step.href}
                data-testid={`checklist-${step.id}`}
                data-done={step.completed ? 'true' : 'false'}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  step.completed ? 'bg-mint text-primary' : 'bg-surface text-text-secondary hover:text-text-primary'
                }`}
              >
                {step.completed ? (
                  <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-medium">
                    {i + 1}
                  </span>
                )}
                <span className="font-medium">{step.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* d. Four numbers for the last 30 days */}
      <section data-testid="home-numbers">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-text-primary">Last {HOME_WINDOW_DAYS} days</h2>
          <Link href="/app/analytics" className="text-sm font-semibold text-primary hover:underline">
            See all numbers
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title="Requests" value={numbers.requests.toString()} />
          <StatCard title="Estimates sent" value={numbers.sent.toString()} />
          <StatCard title="Accepted" value={numbers.accepted.toString()} />
          <StatCard title="Value accepted" value={formatMoney(numbers.valueAccepted, currency, locale, { decimals: 0 })} />
        </div>
      </section>
    </div>
  )
}

function UsageBanner({ tone, title, text, cta }: { tone: 'warn' | 'danger'; title: string; text: string; cta: string }) {
  const danger = tone === 'danger'
  return (
    <div className={`mb-8 rounded-warm-xl border p-5 ${danger ? 'border-danger/30 bg-danger-light' : 'border-tape/40 bg-butter'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className={`font-display text-base font-bold ${danger ? 'text-danger' : 'text-tertiary'}`}>{title}</h2>
          <p className={`mt-1 text-sm ${danger ? 'text-danger' : 'text-tertiary'}`}>{text}</p>
        </div>
        <Link
          href="/app/settings/billing"
          className={`inline-flex shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90 ${
            danger ? 'bg-danger' : 'bg-primary'
          }`}
        >
          {cta}
        </Link>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-warm-xl bg-white shadow-warm-md p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{title}</p>
      <p className="figure mt-3 text-2xl font-medium tracking-tight text-text-primary sm:text-4xl">{value}</p>
    </div>
  )
}
