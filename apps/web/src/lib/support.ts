/**
 * T-197: the web app's side of the Help button (server only). The rules and
 * the words are in packages/shared/src/support.ts; the AI's sorting runs in
 * the worker.
 *
 * Everything a business does goes through its own signed-in client, so the
 * database's row-level rules are what keep one business's reports from
 * another's. The service-role client is used only for what a business may
 * not write itself: the owner's side of a report, feature requests and votes
 * (one vote per business per request is the table's own rule), and marking a
 * reply as read.
 *
 * Nothing here throws into a page: a count that cannot be read allows the
 * report (the limit fails open), and a worker that does not answer leaves the
 * report saved and unsorted.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FEATURE_MATCH_TIMEOUT_MS,
  SUPPORT_COPY,
  getPlan,
  isFreeTestAccount,
  subscriptionLive,
  type EstimateChoice,
  type FeatureStatus,
  type KnownRequest,
  type SetupHint,
  type SupportContext,
  type SupportReportKind,
  type SupportStatus,
} from '@qolumns/shared'
import { askWorker, isSyncProcessing } from '@/lib/queue'
import { listPacks } from '@/lib/vertical-packs'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>
type Db = Pick<SupabaseClient, 'from'>

export const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null))

// ---------------------------------------------------------------------------
// What a business sees
// ---------------------------------------------------------------------------

export interface MyReport {
  id: string
  kind: SupportReportKind
  body: string
  choices: EstimateChoice[]
  quoteId: string | null
  isTest: boolean
  status: SupportStatus
  statusLabel: string
  setupHint: SetupHint | null
  unread: boolean
  createdAt: string
}

export interface MyRequest {
  /** The vote's id: a business's own item */
  id: string
  /** What the business wrote, or the request's title when it only added its vote */
  text: string
  status: FeatureStatus
  statusLabel: string
  createdAt: string
}

export interface ThreadMessage {
  id: string
  from: 'business' | 'team'
  body: string
  createdAt: string
}

export const REPORT_COLUMNS = 'id, kind, body, choices, quote_id, is_test, status, setup_hint, reply_unread, created_at'

interface ReportRow {
  id: string
  kind: SupportReportKind
  body: string | null
  choices: EstimateChoice[] | null
  quote_id: string | null
  is_test: boolean | null
  status: SupportStatus
  setup_hint: SetupHint | null
  reply_unread: boolean | null
  created_at: string
}

export function myReportOf(row: unknown): MyReport {
  const r = row as ReportRow
  const hint = r.setup_hint && typeof r.setup_hint.line === 'string' && typeof r.setup_hint.rate === 'string' ? r.setup_hint : null
  return {
    id: r.id,
    kind: r.kind,
    body: r.body ?? '',
    choices: r.choices ?? [],
    quoteId: r.quote_id,
    isTest: r.is_test === true,
    status: r.status,
    statusLabel: SUPPORT_COPY.status[r.status] ?? r.status,
    setupHint: hint,
    unread: r.reply_unread === true,
    createdAt: r.created_at,
  }
}

/**
 * The business's own reports, newest first (its own client: the database
 * decides what it may read). With a quote: only the reports ON that estimate
 * ("Report a problem with this estimate"), not a general problem that was
 * sent while its page happened to be open.
 */
export async function myReports(supabase: Db, tenantId: string, quoteId?: string | null): Promise<MyReport[]> {
  let query = supabase.from('support_reports').select(REPORT_COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(100)
  if (quoteId) query = query.eq('quote_id', quoteId).eq('kind', 'estimate')
  const { data } = await query
  return (data ?? []).map(myReportOf)
}

/** The business's own feature requests and votes, newest first, each with the status of the request it sits on */
export async function myRequests(supabase: Db, tenantId: string): Promise<MyRequest[]> {
  const { data } = await supabase
    .from('feature_votes')
    .select('id, body, created_at, request:feature_requests!request_id (title, status)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100)
  return ((data ?? []) as unknown as Array<{ id: string; body: string | null; created_at: string; request: unknown }>).map((row) => {
    const request = one(row.request as { title?: string; status?: FeatureStatus } | null)
    const status = request?.status ?? 'under_review'
    return { id: row.id, text: (row.body ?? '').trim() || request?.title || '', status, statusLabel: SUPPORT_COPY.featureStatus[status], createdAt: row.created_at }
  })
}

/** How many of the business's reports carry a reply nobody there has opened */
export async function unreadReplies(supabase: Db, tenantId: string): Promise<number> {
  const { count } = await supabase.from('support_reports').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('reply_unread', true)
  return count ?? 0
}

export async function threadOf(supabase: Db, reportId: string, tenantId: string): Promise<ThreadMessage[]> {
  const { data } = await supabase
    .from('support_messages')
    .select('id, author, body, created_at')
    .eq('report_id', reportId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(200)
  return ((data ?? []) as Array<{ id: string; author: 'business' | 'team'; body: string; created_at: string }>).map((m) => ({ id: m.id, from: m.author, body: m.body, createdAt: m.created_at }))
}

export interface SubscriptionLike {
  status?: string | null
  plan_id?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
}

/** What a business with no live plan is on: the free offer */
export const FREE_PLAN_NAME = 'Free'

/**
 * A business's plan in words, and whether it pays for it. The names are the
 * shared plan definitions' (T-134); a plan is held only while the
 * subscription is live (T-180), otherwise the business is on the free offer.
 * A free test account holds a plan without paying for it.
 */
export function planOf(subscription: SubscriptionLike | null | undefined): { plan: string; paying: boolean } {
  const plan = subscription && subscriptionLive(subscription.status) ? getPlan(subscription.plan_id) : null
  if (!plan) return { plan: FREE_PLAN_NAME, paying: false }
  return { plan: plan.name, paying: !isFreeTestAccount(subscription as Parameters<typeof isFreeTestAccount>[0]) }
}

/** The business's plan, by its name ("Free", "Pro"), or null when it cannot be read */
export async function planName(supabase: Db, tenantId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('subscriptions').select('status, plan_id, stripe_customer_id, stripe_subscription_id').eq('tenant_id', tenantId).maybeSingle()
    return error ? null : planOf(data as SubscriptionLike | null).plan
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The daily limit: counted in the database, and never the reason a report is lost
// ---------------------------------------------------------------------------

/** How many rows of a table this business added in the last day, or null when that cannot be counted (then the report is allowed) */
export async function sentToday(supabase: Db, table: 'support_reports' | 'feature_votes', tenantId: string, now: Date = new Date()): Promise<number | null> {
  try {
    const since = new Date(now.getTime() - 86_400_000).toISOString()
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt('created_at', since)
    return error || typeof count !== 'number' ? null : count
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/**
 * Ask the worker to sort a report or title a request. The row is already
 * saved; this never throws and waits three seconds at most. If the worker
 * cannot be reached the row stays as it is: the owner sees the report
 * unsorted and can press "Sort again".
 */
export async function requestSupportJob(kind: 'support_sort' | 'feature_title', id: string): Promise<boolean> {
  const answer = await askWorker<{ success?: boolean }>('/support/job', { kind, id, mode: isSyncProcessing() ? 'direct' : 'queue' }, 3000)
  if (!answer?.success) console.warn(`[Support] the worker did not take ${kind} for ${id}; it stays unsorted`)
  return answer?.success === true
}

/** Up to three existing requests that mean the same as these words. Empty when the worker fails or takes over five seconds. */
export async function matchFeatureRequests(words: string): Promise<KnownRequest[]> {
  const answer = await askWorker<{ matches?: KnownRequest[] }>('/support/match', { words }, FEATURE_MATCH_TIMEOUT_MS)
  const matches = Array.isArray(answer?.matches) ? answer.matches : []
  return matches
    .filter((m) => m && typeof m.id === 'string' && typeof m.title === 'string')
    .slice(0, 3)
    .map((m) => ({ id: m.id, title: m.title, summary: typeof m.summary === 'string' ? m.summary : '' }))
}

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

const sameName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The template a service matches, by name (the rule the services page uses
 * for "you already have this one"): "Pack: Service", or null. No service
 * name is typed here: the names are the packs' own data.
 */
export function serviceTemplateOf(serviceName: string | null | undefined): string | null {
  const wanted = sameName(serviceName ?? '')
  if (!wanted) return null
  for (const pack of listPacks()) {
    const service = pack.services.find((svc) => sameName(svc.name) === wanted)
    if (service) return `${pack.name}: ${service.name}`
  }
  return null
}

/** The owner's row for a new report. Written by the server: a business can neither read nor write it. */
export async function openInternal(admin: Admin, reportId: string, serviceTemplate: string | null): Promise<void> {
  const { error } = await admin.from('support_report_internal').upsert({ report_id: reportId, service_template: serviceTemplate }, { onConflict: 'report_id' })
  if (error) console.error(`[Support] the owner's row for ${reportId} was not written (${error.code ?? 'error'})`)
}

/** A user's account email, for a reply. Null when the user is gone. Never logged. */
export async function emailOfUser(admin: Admin, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  try {
    const { data } = await admin.auth.admin.getUserById(userId)
    return data?.user?.email ?? null
  } catch {
    return null
  }
}

/** Free and paying businesses, by tenant id: the plan's name, and whether it costs anything */
export async function plansOf(admin: Admin, tenantIds: readonly string[]): Promise<Map<string, { name: string; plan: string | null; paying: boolean }>> {
  const out = new Map<string, { name: string; plan: string | null; paying: boolean }>()
  const ids = [...new Set(tenantIds)]
  if (ids.length === 0) return out
  const { data } = await admin.from('tenants').select('id, name, subscriptions!tenant_id (status, plan_id, stripe_customer_id, stripe_subscription_id)').in('id', ids)
  for (const row of (data ?? []) as unknown as Array<{ id: string; name: string; subscriptions: unknown }>) {
    out.set(row.id, { name: row.name, ...planOf(one(row.subscriptions as SubscriptionLike | SubscriptionLike[] | null)) })
  }
  return out
}

export type { SupportContext }
