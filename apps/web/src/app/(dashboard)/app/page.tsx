import { syncSelectedPlan } from '@/lib/signup-choices'
import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { QUOTE_TURN_COPY, agoWords, businessIsAsked, formatMoney, freeQuotesLeftLine, getRegion, isMadeByBusiness, monthStart, quoteActivityLine, quoteTurn, wonLines, wonSummary } from '@qolumns/shared'
import { applyGroupFilter, businessAskedQuoteIds, groupFilter, questionCountOf, requestSourceOf } from '@/lib/business-asked'
import { buildChecklist } from '@/lib/setup-checklist'
import {
  buildHomeActivity,
  changeWords,
  compareHomeNumbers,
  homeNumbers,
  homeSeries,
  seriesSummary,
  waitingForYou,
  WAITING_FOR_YOU_STATUSES,
  HOME_WINDOW_DAYS,
  type HomeQuestionRow,
  type HomeQuoteRow,
  type NumberChange,
} from '@/lib/home-numbers'
import { unfinishedFilter } from '@/lib/unfinished-leads'
import { appOriginFrom } from '@/lib/tenant-site'
import { assetIdsOf, firstPhotoUrls } from '@/lib/quote-photos'
import { Sparkline, TrendMark } from '@/components/home/Sparkline'
import { WaitingForYou, type WaitingQuote } from '@/components/home/WaitingForYou'
import { QuoteStand } from '@/components/home/QuoteStand'
import { NeedsYouDot } from '@/components/quotes/NeedsYouDot'
import { NEEDS_YOU_MARK } from '@/lib/status-tone'
import { LatestActivity, type ActivityLine } from '@/components/home/LatestActivity'
import { HomeQuoteLink } from '@/components/home/HomeQuoteLink'
import { WonPanel } from '@/components/home/WonPanel'
import { RememberTimeZone } from '@/components/home/RememberTimeZone'
import { businessTimeZone, everAccepted, wonReadsFrom } from '@/lib/won'
import { checkPlanLimit } from '@/lib/plan-limits'
import { PageHeader } from '@/components/dashboard/EmptyState'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Home, top to bottom (T-152, T-160, AD-044):
 * a. Waiting for you: quotes to approve, customer questions, requests that
 *    could not be priced
 * b. new unfinished requests (only ones the business has not seen)
 *    (then the plan usage banner, when there is one)
 * c. the setup checklist until it is done
 * w. T-196: "Won through Qolumns", this calendar month, once an estimate has been accepted
 * d. Where your quotes stand: three counts by whose turn it is
 * e. Latest activity   f. Your quote link
 * g. four numbers for the last 30 days, each against the 30 days before
 *    (only while w does not show: a number has one home, AD-079)
 *
 * Every query is scoped to the signed-in user's tenant, and their number is
 * fixed: nothing is fetched per quote. Setup tests stay out of every count.
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
      .select('name, slug, region, currency, time_zone, quote_link_copied_at, quote_link_first_visit_at, selected_plan, onboarding_skipped_at, prices_checked_at')
      .eq('id', profile.tenant_id)
      .single(),
    checkPlanLimit(supabase, profile.tenant_id),
  ])

  // T-160: unfinished requests the business has not seen yet (the same rule
  // as the menu badge; opening the Unfinished list clears both)
  const { count: unfinishedCount } = await unfinishedFilter(
    supabase.from('request_leads').select('id', { count: 'exact', head: true }),
    profile.tenant_id,
    { newOnly: true }
  )

  const tenantRow = tenant as {
    slug?: string | null
    region?: string | null
    currency?: string | null
    time_zone?: string | null
    selected_plan?: string | null
    onboarding_skipped_at?: string | null
    quote_link_copied_at?: string | null
    quote_link_first_visit_at?: string | null
    prices_checked_at?: string | null
  } | null
  const currency = tenantRow?.currency || 'USD'
  const locale = getRegion(tenantRow?.region).locale
  const now = new Date()
  const since = new Date(now.getTime() - HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  // T-160: the 30 days before, for "up 3 / down 1 / same"
  const sinceBefore = new Date(now.getTime() - 2 * HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  // T-196: "Won through Qolumns" counts calendar months in the business's time zone. The same rows
  // serve it, so the read reaches back to whichever starts earlier: 60 days ago or last month.
  const timeZone = businessTimeZone(tenantRow)
  const earliest = (a: Date, b: Date) => (a.getTime() < b.getTime() ? a : b)
  const readFrom = earliest(sinceBefore, wonReadsFrom(now, timeZone))
  const readEventsFrom = earliest(since, monthStart(now, timeZone))

  // T-186: quotes the business made that have open questions need the business, not a customer
  const businessAsked = await businessAskedQuoteIds(supabase, profile.tenant_id)
  const forYou = groupFilter('needs_you', businessAsked)
  const forCustomer = groupFilter('waiting', businessAsked)

  // Every query below is scoped to this tenant (RLS + explicit filter)
  const [servicesResult, waitingResult, recentResult, realRequestResult, waitingCountResult, anyQuoteResult, questionsResult, everWon] = await Promise.all([
    supabase.from('services').select('id').eq('tenant_id', profile.tenant_id).eq('active', true).limit(1),
    // a. waiting for the owner, newest first (T-158: also customer questions
    // and requests that could not be priced)
    applyGroupFilter(
      supabase
        .from('quotes')
        // T-160: the exact count is the "Needs you" number (the rows are capped at 25)
        .select('id, status, created_at, customer_json, pricing_json, content_json, clarification_questions_json, is_test, services!service_id (name), request:quote_requests!quote_request_id (asset_ids, source_json)', { count: 'exact' })
        .eq('tenant_id', profile.tenant_id),
      { ...forYou, statuses: [...WAITING_FOR_YOU_STATUSES] }
    )
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(25),
    // e + g. anything that happened in the last 30 days, and (for the
    // comparison) what was requested, sent or accepted in the 30 before
    supabase
      .from('quotes')
      .select('id, status, created_at, sent_at, approved_at, viewed_at, accepted_at, declined_at, customer_name:customer_json->>name, pricing_json, is_test, quote_requests!quote_request_id (source_type:source_json->>type)')
      .eq('tenant_id', profile.tenant_id)
      .or(
        [
          ...['created_at', 'sent_at', 'accepted_at'].map((column) => `${column}.gte.${readFrom.toISOString()}`),
          ...['approved_at', 'viewed_at', 'declined_at'].map((column) => `${column}.gte.${readEventsFrom.toISOString()}`),
        ].join(',')
      ),
    // c. first real request: a customer's (not a setup test, not the business's
    // own app quote — the source lives on the request row)
    supabase
      .from('quotes')
      .select('id, quote_requests!quote_request_id!inner (id)')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_test', false)
      .or('source_json->>type.is.null,source_json->>type.neq.app', { referencedTable: 'quote_requests' })
      .limit(1),
    // d. how many quotes wait for a customer (T-158 group)
    applyGroupFilter(
      supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id)
        .eq('is_test', false),
      forCustomer
    ),
    // d + e. has this business had any quote at all (a new one gets a friendly line, not zeros)
    supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id)
      .eq('is_test', false),
    // e. customer questions in the last 30 days
    supabase
      .from('quote_feedback')
      .select('quote_id, created_at, quotes!inner (customer_name:customer_json->>name, is_test)')
      .eq('tenant_id', profile.tenant_id)
      .eq('feedback_type', 'feedback')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
    // w. T-196: has an estimate ever been accepted (any kind, and from a customer's own request)
    everAccepted(supabase, profile.tenant_id),
  ])

  const hasService = (servicesResult.data?.length ?? 0) > 0

  // T-150: keep the plan chosen before signup, and take a business with no
  // services straight to setup (unless it chose to set up by hand)
  await syncSelectedPlan(supabase, profile.tenant_id, tenantRow?.selected_plan, user.user_metadata)
  if (!hasService && !tenantRow?.onboarding_skipped_at) {
    redirect('/app/onboarding')
  }

  const waitingRows = waitingForYou(
    (waitingResult.data ?? []) as unknown as Array<{
      id: string
      status: string
      created_at: string
      customer_json: { name?: string; email?: string } | null
      pricing_json: { total?: number } | null
      content_json: { limitHold?: boolean } | null
      is_test: boolean | null
      services: { name?: string } | Array<{ name?: string }> | null
      request?: unknown
      clarification_questions_json?: unknown
    }>,
    // T-186: its own questions to answer
    (q) => !q.is_test && businessIsAsked(q.status, isMadeByBusiness(requestSourceOf(q)))
  )
  // T-169: one small photo per waiting row, when the customer sent any (one query, this tenant only)
  const waitingPhotos = await firstPhotoUrls(
    supabase,
    profile.tenant_id,
    waitingRows.map((q) => ({ quoteId: q.id, assetIds: assetIdsOf(q.request) }))
  )
  const waiting: WaitingQuote[] = waitingRows.map((q) => {
    const service = Array.isArray(q.services) ? q.services[0] : q.services
    const total = q.pricing_json?.total ?? 0
    // T-158: the same label and next step the quotes list shows
    const turn = quoteTurn({
      status: q.status,
      customerName: q.customer_json?.name,
      hasEmail: Boolean(q.customer_json?.email),
      total,
      held: q.content_json?.limitHold === true,
      madeByBusiness: isMadeByBusiness(requestSourceOf(q)),
      openQuestions: questionCountOf(q),
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
      photoUrl: waitingPhotos.get(q.id) ?? null,
    }
  })

  const checklist = buildChecklist({
    hasService,
    pricesCheckedAt: tenantRow?.prices_checked_at,
    quoteLinkCopiedAt: tenantRow?.quote_link_copied_at,
    quoteLinkFirstVisitAt: tenantRow?.quote_link_first_visit_at,
    hasRealRequest: (realRequestResult.data?.length ?? 0) > 0,
  })

  const recentRows = (
    (recentResult.data ?? []) as unknown as Array<
      HomeQuoteRow & { quote_requests?: { source_type?: string | null } | Array<{ source_type?: string | null }> | null }
    >
  ).map((q) => ({ ...q, source_type: (Array.isArray(q.quote_requests) ? q.quote_requests[0] : q.quote_requests)?.source_type ?? null }))

  // g. this period, and the one before it
  const numbers = homeNumbers(recentRows, since)
  const changes = compareHomeNumbers(numbers, homeNumbers(recentRows, sinceBefore, since))
  const money = (amount: number) => formatMoney(amount, currency, locale, { decimals: 0 })
  // T-169: the same numbers in 5-day steps across both periods, for the small line under each
  const series = changes ? homeSeries(recentRows, sinceBefore, now) : null

  // w. T-196: won this calendar month, from the rows above; null until the first accepted estimate
  const won = wonSummary(
    recentRows.map((q) => ({ ...q, source: q.source_type })),
    { now, timeZone, everAccepted: everWon }
  )

  // d. where the quotes stand
  const hasQuotes = (anyQuoteResult.count ?? 0) > 0
  const stand = { needsYou: waitingResult.count ?? 0, waiting: waitingCountResult.count ?? 0, accepted: numbers.accepted }

  // e. latest activity, from timestamps the quotes already carry
  const questionRows: HomeQuestionRow[] = (
    (questionsResult.data ?? []) as unknown as Array<{
      quote_id: string
      created_at: string
      quotes: { customer_name?: string | null; is_test?: boolean | null } | Array<{ customer_name?: string | null; is_test?: boolean | null }> | null
    }>
  ).map((f) => {
    const quote = Array.isArray(f.quotes) ? f.quotes[0] : f.quotes
    return { quote_id: f.quote_id, created_at: f.created_at, customer_name: quote?.customer_name ?? null, is_test: quote?.is_test ?? null }
  })
  const activity: ActivityLine[] = buildHomeActivity(recentRows, questionRows, since).map((event) => ({
    text: quoteActivityLine(event.kind, event.customerName),
    when: agoWords(event.at, { now, locale }) ?? '',
    href: `/app/quotes/${event.quoteId}`,
    kind: event.kind,
  }))

  // f. the business's own quote link
  const quoteLink = tenantRow?.slug ? `${appOriginFrom(headers().get('host'))}/quote/${tenantRow.slug}` : null
  const N = QUOTE_TURN_COPY.home.numbers
  const U = QUOTE_TURN_COPY.unfinished

  const usagePercent = planLimit.unlimited ? 0 : Math.min(100, Math.round((planLimit.used / planLimit.limit) * 100))
  const limitReached = !planLimit.unlimited && planLimit.used >= planLimit.limit
  const nearLimit = !limitReached && usagePercent >= 80
  const free = planLimit.per === 'total'

  return (
    <div>
      <PageHeader title={tenant?.name || 'Home'} />

      {/* a. T-152: the work waiting for the owner comes first */}
      <WaitingForYou quotes={waiting} />

      {/* b. T-151/T-160: new people who started a request but didn't finish.
          Only ones the business has not seen: opening the list clears it. */}
      {(unfinishedCount ?? 0) > 0 && (
        <Link
          href="/app/quotes?filter=unfinished"
          className="mb-8 flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-5 py-4 text-sm text-text-primary shadow-warm-md hover:border-field"
          data-testid="unfinished-count"
        >
          <span className="flex min-w-0 items-center gap-3">
            {/* T-165: the strong yellow behind the count, with the marker: "needs you" */}
            <span className={`figure inline-flex shrink-0 items-center rounded-lg px-2.5 py-1 text-lg font-bold ${NEEDS_YOU_MARK}`} data-testid="unfinished-count-figure">
              <NeedsYouDot className="mr-1.5" />
              {unfinishedCount}
            </span>
            <span>{U.banner(unfinishedCount ?? 0)}</span>
          </span>
          <span className="shrink-0 font-semibold text-primary">{U.bannerButton}</span>
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
              ? // T-180: "2 free quotes left. Pick a plan to keep pricing every request."
                freeQuotesLeftLine(planLimit.used, planLimit.limit) ?? `${planLimit.used} of your ${planLimit.limit} free quotes used`
              : `${usagePercent}% of your monthly quote limit used (${planLimit.used}/${planLimit.limit})`
          }
          text={
            free
              ? 'After your free quotes, new requests are saved as leads but not priced until you pick a plan.'
              : 'At the limit, new requests are saved as leads but not priced until you upgrade or the month resets.'
          }
          cta={free ? 'Pick a plan' : 'View plans'}
        />
      )}

      {/* c. Setup checklist until complete (T-152) */}
      {!checklist.complete && (
        <section className="mb-8 rounded-2xl bg-white p-6 shadow-warm-md" data-testid="setup-checklist">
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
                className={`flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
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

      {/* w. T-196: what was won this month. Not before the first accepted estimate. */}
      {won && <WonPanel summary={won} lines={wonLines(won, currency, locale)} />}
      {!tenantRow?.time_zone && <RememberTimeZone />}

      {/* d. T-160: where every quote stands, by whose turn it is */}
      <QuoteStand needsYou={stand.needsYou} waiting={stand.waiting} accepted={stand.accepted} hasQuotes={hasQuotes} />

      {/* e + f. T-160: what happened lately, and the link to hand out */}
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {/* min-w-0: a grid cell is otherwise as wide as its longest line (the link) */}
        <div className={`min-w-0 ${quoteLink ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <LatestActivity lines={activity} hasQuotes={hasQuotes} />
        </div>
        {quoteLink && <HomeQuoteLink link={quoteLink} />}
      </div>

      {/* g. Four numbers for the last 30 days, each against the 30 days before. T-196: once the panel above
          shows, it is the one home for requests, sent, accepted and their value (AD-079). */}
      {!won && (
      <section data-testid="home-numbers">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-text-primary">{N.title(HOME_WINDOW_DAYS)}</h2>
            {changes && <p className="text-xs text-text-muted" data-testid="numbers-note">{N.note(HOME_WINDOW_DAYS)}</p>}
          </div>
          <Link href="/app/analytics" className="inline-flex min-h-[44px] shrink-0 items-center text-sm font-semibold text-primary hover:underline sm:min-h-[24px]">
            {N.all}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title={N.requests} value={numbers.requests.toString()} change={changes?.requests} points={series?.requests} />
          <StatCard title={N.sent} value={numbers.sent.toString()} change={changes?.sent} points={series?.sent} />
          <StatCard title={N.accepted} value={numbers.accepted.toString()} change={changes?.accepted} points={series?.accepted} />
          <StatCard title={N.valueAccepted} value={money(numbers.valueAccepted)} change={changes?.valueAccepted} points={series?.valueAccepted} format={money} />
        </div>
      </section>
      )}
    </div>
  )
}

function UsageBanner({ tone, title, text, cta }: { tone: 'warn' | 'danger'; title: string; text: string; cta: string }) {
  const danger = tone === 'danger'
  return (
    <div className={`mb-8 rounded-2xl border p-5 ${danger ? 'border-danger/30 bg-danger-light' : 'bg-butter'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className={`font-display text-base font-bold ${danger ? 'text-danger' : 'text-tertiary'}`}>{title}</h2>
          <p className={`mt-1 text-sm ${danger ? 'text-danger' : 'text-tertiary'}`}>{text}</p>
        </div>
        <Link
          href="/app/settings/billing"
          className={`inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90 ${
            danger ? 'bg-danger' : 'bg-primary'
          }`}
        >
          {cta}
        </Link>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  change,
  points,
  format,
}: {
  title: string
  value: string
  change?: NumberChange | null
  points?: number[] | null
  format?: (n: number) => string
}) {
  return (
    <div className="rounded-2xl bg-white shadow-warm-md p-4 sm:p-6" data-testid="home-number">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{title}</p>
      <p className="figure mt-3 text-2xl font-medium tracking-tight text-text-primary sm:text-4xl">{value}</p>
      {/* T-160: against the 30 days before. T-169: with a mark that is a shape, so the direction never rests on colour */}
      {change && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary" data-testid="number-change" data-direction={change.direction}>
          <TrendMark direction={change.direction} />
          {changeWords(change, format)}
        </p>
      )}
      {/* T-169: the last 60 days in 5-day steps; the 30 days before in grey, the last 30 in juniper */}
      {points && points.some((n) => n > 0) && <Sparkline points={points} summary={seriesSummary(points, HOME_WINDOW_DAYS, undefined, format)} />}
    </div>
  )
}
