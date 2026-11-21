/**
 * T-197: the owner's support inbox (server only, service role). Every caller
 * has already proved the user is a platform admin (`verifyAdmin`).
 *
 * The inbox reads every business's reports, so nothing here is ever reached
 * from a business's route. What a business is shown about its own report is
 * written here on purpose and in one place each: a reply (a thread message),
 * a status, and the "fixed" or "shipped" notice.
 *
 * Emails go to the user who reported (the business's own address when that
 * user is gone), each business once: the report or the vote records that it
 * was told, and a second "Fixed" or "Shipped" tells only those not yet told.
 * A business is told in its Help panel whether or not an email can be sent.
 */
import {
  FEATURE_STATUSES,
  SUPPORT_COPY,
  SUPPORT_MERGE_SUGGEST_AT,
  SUPPORT_STATUSES,
  byPriority,
  byVotes,
  cleanSupportContext,
  estimateChoicesOf,
  estimateDigest,
  featureShippedEmail,
  fixedRecipients,
  helpLink,
  shippedRecipients,
  supportContextLines,
  supportFixedEmail,
  supportReplyEmail,
  ticketWithBusinesses,
  titleFromWords,
  type EstimateChoice,
  type EstimateDigest,
  type FeatureStatus,
  type SupportAiKind,
  type SupportCause,
  type SupportEmail,
  type SupportReportKind,
  type SupportSeverity,
  type SupportStatus,
} from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { resolveBusinessEmail } from '@/lib/business-email'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { emailOfUser, one, plansOf, requestSupportJob, threadOf, type ThreadMessage } from '@/lib/support'

type Admin = ReturnType<typeof createAdminClient>

/** How an email leaves. True when it went. Injected so the rules can be tested without Postmark. */
export type SendSupportEmail = (to: string, email: SupportEmail, tag: string) => Promise<boolean>

export interface SupportMailer {
  send: SendSupportEmail
  appUrl: string
}

interface InternalRow {
  title: string | null
  summary: string | null
  ai_kind: SupportAiKind | null
  severity: SupportSeverity | null
  similar_json: Array<{ id: string; confidence: number }> | null
  likely_cause: SupportCause | null
  evidence: string | null
  fix_ticket: string | null
  service_template: string | null
  sort_state: 'waiting' | 'sorted' | 'failed'
  sort_attempts: number | null
  sorted_at: string | null
  merged_into: string | null
  approved_at: string | null
  owner_note: string | null
  fixed_emailed_at: string | null
}

interface ReportRow {
  id: string
  tenant_id: string
  user_id: string | null
  kind: SupportReportKind
  body: string | null
  choices: unknown
  expected_total: number | string | null
  currency: string | null
  quote_id: string | null
  is_test: boolean | null
  screenshot_asset_id: string | null
  context_json: unknown
  status: SupportStatus
  setup_hint: { line?: string; rate?: string } | null
  created_at: string
  tenant: unknown
  internal: unknown
}

const INTERNAL_COLUMNS =
  'title, summary, ai_kind, severity, similar_json, likely_cause, evidence, fix_ticket, service_template, sort_state, sort_attempts, sorted_at, merged_into, approved_at, owner_note, fixed_emailed_at'
const REPORT_COLUMNS = `id, tenant_id, user_id, kind, body, choices, expected_total, currency, quote_id, is_test, screenshot_asset_id, context_json, status, setup_hint, created_at, tenant:tenants!tenant_id (name), internal:support_report_internal!report_id (${INTERNAL_COLUMNS})`

const internalOf = (row: ReportRow): InternalRow | null => one(row.internal as InternalRow | InternalRow[] | null)
const tenantName = (row: ReportRow): string => one(row.tenant as { name?: string } | null)?.name ?? 'A business'

async function allReports(admin: Admin): Promise<ReportRow[]> {
  const { data } = await admin.from('support_reports').select(REPORT_COLUMNS).order('created_at', { ascending: false }).limit(1000)
  return (data ?? []) as unknown as ReportRow[]
}

// ---------------------------------------------------------------------------
// The lists
// ---------------------------------------------------------------------------

export interface ProblemRow {
  id: string
  title: string
  reportKind: SupportReportKind
  aiKind: SupportAiKind | null
  severity: SupportSeverity | null
  /** Businesses affected: its own and those merged into it */
  businesses: number
  business: string
  status: SupportStatus
  createdAt: string
  sortState: 'waiting' | 'sorted' | 'failed'
  /** The AI found an open problem that looks the same with high confidence */
  mergeSuggested: boolean
  likelyCause: SupportCause | null
  serviceTemplate: string | null
  isTest: boolean
  approved: boolean
}

/** Businesses on each problem: its own and those of the reports merged into it */
function businessesByPrimary(rows: ReportRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const row of rows) {
    const primary = internalOf(row)?.merged_into ?? row.id
    if (!out.has(primary)) out.set(primary, new Set())
    out.get(primary)!.add(row.tenant_id)
  }
  return out
}

function problemRowOf(row: ReportRow, businesses: number): ProblemRow {
  const internal = internalOf(row)
  return {
    id: row.id,
    title: internal?.title || titleFromWords(row.body || estimateChoicesOf(row.choices).map((c) => SUPPORT_COPY.choices[c]).join(', ') || 'A report'),
    reportKind: row.kind,
    aiKind: internal?.ai_kind ?? null,
    severity: internal?.severity ?? null,
    businesses,
    business: tenantName(row),
    status: row.status,
    createdAt: row.created_at,
    sortState: internal?.sort_state ?? 'waiting',
    mergeSuggested: (internal?.similar_json ?? []).some((s) => s.confidence >= SUPPORT_MERGE_SUGGEST_AT),
    likelyCause: internal?.likely_cause ?? null,
    serviceTemplate: internal?.service_template ?? null,
    isTest: row.is_test === true,
    approved: Boolean(internal?.approved_at),
  }
}

/** The problems, by priority: severity, then businesses affected, then age. A merged report is counted under the one it joined. */
export async function listProblems(admin: Admin): Promise<ProblemRow[]> {
  const rows = await allReports(admin)
  const businesses = businessesByPrimary(rows)
  return rows
    .filter((row) => !internalOf(row)?.merged_into)
    .map((row) => problemRowOf(row, businesses.get(row.id)?.size ?? 1))
    .sort(byPriority)
}

export interface FeatureRow {
  id: string
  title: string
  summary: string
  status: FeatureStatus
  /** Businesses that asked */
  votes: number
  /** Of those, how many are on a paid plan */
  paying: number
  createdAt: string
  isNew: boolean
  /** Still in the first business's own words: not shown to other businesses until it is titled */
  ownWords: boolean
}

interface RequestRow {
  id: string
  title: string
  summary: string | null
  title_source: 'words' | 'ai' | 'owner'
  status: FeatureStatus
  merged_into: string | null
  reviewed_at: string | null
  created_at: string
}

interface VoteRow {
  id: string
  request_id: string
  tenant_id: string
  user_id: string | null
  body: string | null
  shipped_emailed_at: string | null
  created_at: string
}

/** The feature requests, by votes (businesses), then by how many of them pay */
export async function listFeatures(admin: Admin): Promise<FeatureRow[]> {
  const [{ data: requestData }, { data: voteData }] = await Promise.all([
    admin.from('feature_requests').select('id, title, summary, title_source, status, merged_into, reviewed_at, created_at').is('merged_into', null).order('created_at', { ascending: false }).limit(1000),
    admin.from('feature_votes').select('request_id, tenant_id').limit(5000),
  ])
  const votes = (voteData ?? []) as Array<{ request_id: string; tenant_id: string }>
  const plans = await plansOf(admin, votes.map((v) => v.tenant_id))
  const byRequest = new Map<string, Set<string>>()
  for (const vote of votes) {
    if (!byRequest.has(vote.request_id)) byRequest.set(vote.request_id, new Set())
    byRequest.get(vote.request_id)!.add(vote.tenant_id)
  }
  return ((requestData ?? []) as RequestRow[])
    .map((request) => {
      const tenants = [...(byRequest.get(request.id) ?? [])]
      return {
        id: request.id,
        title: request.title,
        summary: request.summary ?? '',
        status: request.status,
        votes: tenants.length,
        paying: tenants.filter((t) => plans.get(t)?.paying).length,
        createdAt: request.created_at,
        isNew: !request.reviewed_at,
        ownWords: request.title_source === 'words',
      }
    })
    .sort(byVotes)
}

/** New items, for the admin menu: problems still "New" (not merged away) and feature requests the owner has not opened */
export async function newSupportCount(admin: Admin): Promise<number> {
  const [{ data: reports }, { count: features }] = await Promise.all([
    admin.from('support_reports').select('id, internal:support_report_internal!report_id (merged_into)').eq('status', 'new').limit(1000),
    admin.from('feature_requests').select('id', { count: 'exact', head: true }).is('reviewed_at', null).is('merged_into', null),
  ])
  const problems = ((reports ?? []) as unknown as Array<{ internal: unknown }>).filter((r) => !one(r.internal as { merged_into?: string | null } | null)?.merged_into).length
  return problems + (features ?? 0)
}

// ---------------------------------------------------------------------------
// One problem
// ---------------------------------------------------------------------------

export interface ProblemDetail {
  id: string
  row: ProblemRow
  business: { id: string; name: string; plan: string | null; paying: boolean }
  body: string
  choices: EstimateChoice[]
  expectedTotal: number | null
  currency: string | null
  quoteId: string | null
  context: Array<{ label: string; value: string }>
  screenshotUrl: string | null
  hasScreenshot: boolean
  setupHint: { line: string; rate: string } | null
  estimate: EstimateDigest | null
  sorting: {
    state: 'waiting' | 'sorted' | 'failed'
    attempts: number
    sortedAt: string | null
    summary: string | null
    evidence: string | null
    fixTicket: string | null
    similar: Array<{ id: string; title: string; confidence: number; suggestMerge: boolean; status: SupportStatus | null }>
  }
  mergedInto: { id: string; title: string } | null
  merged: Array<{ id: string; business: string; body: string; createdAt: string }>
  approvedAt: string | null
  ownerNote: string
  messages: ThreadMessage[]
  /** Other problems this one could be merged into */
  mergeTargets: Array<{ id: string; title: string }>
}

export async function problemDetail(admin: Admin, id: string): Promise<ProblemDetail | null> {
  const rows = await allReports(admin)
  const row = rows.find((r) => r.id === id)
  if (!row) return null
  const internal = internalOf(row)
  const businesses = businessesByPrimary(rows)
  const titleOf = (other: ReportRow) => problemRowOf(other, 1).title
  const plans = await plansOf(admin, [row.tenant_id])
  const plan = plans.get(row.tenant_id)

  let screenshotUrl: string | null = null
  if (row.screenshot_asset_id && isR2Configured()) {
    const { data: asset } = await admin.from('assets').select('r2_key').eq('id', row.screenshot_asset_id).eq('tenant_id', row.tenant_id).maybeSingle()
    const key = (asset as { r2_key?: string } | null)?.r2_key
    if (key) screenshotUrl = await generateDownloadUrl(key, 900).catch(() => null)
  }

  let estimate: EstimateDigest | null = null
  if (row.quote_id) {
    const { data: quote } = await admin
      .from('quotes')
      .select('id, status, is_test, service_id, pricing_json, pricing_trace_json, service:services!service_id (name, work_steps)')
      .eq('id', row.quote_id)
      .eq('tenant_id', row.tenant_id)
      .maybeSingle()
    if (quote) {
      const q = quote as unknown as { id: string; status?: string; is_test?: boolean; service_id?: string; pricing_json?: Parameters<typeof estimateDigest>[0]['pricing']; pricing_trace_json?: Parameters<typeof estimateDigest>[0]['trace']; service: unknown }
      const service = one(q.service as { name?: string; work_steps?: Parameters<typeof estimateDigest>[0]['workSteps'] } | null)
      estimate = estimateDigest({ quoteId: q.id, serviceId: q.service_id, serviceName: service?.name, status: q.status, isTest: q.is_test, pricing: q.pricing_json, trace: q.pricing_trace_json, workSteps: service?.work_steps ?? [] })
    }
  }

  const similar = (internal?.similar_json ?? []).flatMap((s) => {
    const other = rows.find((r) => r.id === s.id)
    return other ? [{ id: other.id, title: titleOf(other), confidence: s.confidence, suggestMerge: s.confidence >= SUPPORT_MERGE_SUGGEST_AT, status: other.status }] : []
  })
  const into = internal?.merged_into ? rows.find((r) => r.id === internal.merged_into) : null
  const expected = row.expected_total === null || row.expected_total === undefined ? null : Number(row.expected_total)
  const hint = row.setup_hint && typeof row.setup_hint.line === 'string' && typeof row.setup_hint.rate === 'string' ? { line: row.setup_hint.line, rate: row.setup_hint.rate } : null

  return {
    id: row.id,
    row: problemRowOf(row, businesses.get(row.id)?.size ?? 1),
    business: { id: row.tenant_id, name: tenantName(row), plan: plan?.plan ?? null, paying: plan?.paying ?? false },
    body: row.body ?? '',
    choices: estimateChoicesOf(row.choices),
    expectedTotal: expected !== null && Number.isFinite(expected) ? expected : null,
    currency: row.currency,
    quoteId: row.quote_id,
    context: supportContextLines(cleanSupportContext(row.context_json)),
    screenshotUrl,
    hasScreenshot: Boolean(row.screenshot_asset_id),
    setupHint: hint,
    estimate,
    sorting: {
      state: internal?.sort_state ?? 'waiting',
      attempts: internal?.sort_attempts ?? 0,
      sortedAt: internal?.sorted_at ?? null,
      summary: internal?.summary ?? null,
      evidence: internal?.evidence ?? null,
      fixTicket: internal?.fix_ticket ? ticketWithBusinesses(internal.fix_ticket, businesses.get(row.id)?.size ?? 1) : null,
      similar,
    },
    mergedInto: into ? { id: into.id, title: titleOf(into) } : null,
    merged: rows.filter((r) => internalOf(r)?.merged_into === row.id).map((r) => ({ id: r.id, business: tenantName(r), body: r.body ?? '', createdAt: r.created_at })),
    approvedAt: internal?.approved_at ?? null,
    ownerNote: internal?.owner_note ?? '',
    messages: await threadOf(admin, row.id, row.tenant_id),
    mergeTargets: rows.filter((r) => r.id !== row.id && !internalOf(r)?.merged_into).slice(0, 200).map((r) => ({ id: r.id, title: titleOf(r) })),
  }
}

const internalPatch = async (admin: Admin, reportId: string, patch: Record<string, unknown>): Promise<boolean> => {
  const { error } = await admin.from('support_report_internal').upsert({ report_id: reportId, ...patch }, { onConflict: 'report_id' })
  return !error
}

export async function setProblemStatus(admin: Admin, id: string, status: SupportStatus): Promise<boolean> {
  if (!SUPPORT_STATUSES.includes(status)) return false
  const { error } = await admin.from('support_reports').update({ status }).eq('id', id)
  return !error
}

export const setOwnerNote = (admin: Admin, id: string, note: string) => internalPatch(admin, id, { owner_note: note.trim().slice(0, 4000) || null })
export const setApproved = (admin: Admin, id: string, approved: boolean, now: Date = new Date()) => internalPatch(admin, id, { approved_at: approved ? now.toISOString() : null })

/** Ask for a report to be sorted again: one more try, by the worker. The report is not changed here. */
export async function sortAgain(admin: Admin, id: string): Promise<boolean> {
  await internalPatch(admin, id, { sort_state: 'waiting' })
  return requestSupportJob('support_sort', id)
}

/**
 * Merge a problem into another. The owner's act only: the AI never merges.
 * Anything already merged into this one follows it, so a merged problem's
 * businesses count towards the one it joined.
 */
export async function mergeProblem(admin: Admin, id: string, into: string, now: Date = new Date()): Promise<{ ok: boolean; message?: string }> {
  if (id === into) return { ok: false, message: 'A problem cannot be merged into itself.' }
  const { data } = await admin.from('support_reports').select('id, internal:support_report_internal!report_id (merged_into)').in('id', [id, into])
  const rows = (data ?? []) as unknown as Array<{ id: string; internal: unknown }>
  const target = rows.find((r) => r.id === into)
  if (!rows.some((r) => r.id === id) || !target) return { ok: false, message: 'That problem could not be found.' }
  // merging into something that is itself merged goes to where that one went
  const final = one(target.internal as { merged_into?: string | null } | null)?.merged_into ?? into
  if (final === id) return { ok: false, message: 'That problem is already merged into this one. Undo that merge first.' }
  const at = now.toISOString()
  if (!(await internalPatch(admin, id, { merged_into: final, merged_at: at }))) return { ok: false, message: 'The merge could not be saved.' }
  await admin.from('support_report_internal').update({ merged_into: final, merged_at: at }).eq('merged_into', id)
  return { ok: true }
}

export const unmergeProblem = (admin: Admin, id: string) => internalPatch(admin, id, { merged_into: null, merged_at: null })

// ---------------------------------------------------------------------------
// Telling the business
// ---------------------------------------------------------------------------

async function recipientOf(admin: Admin, userId: string | null, tenantId: string): Promise<string | null> {
  return (await emailOfUser(admin, userId)) ?? (await resolveBusinessEmail(admin, tenantId).catch(() => null))
}

/** Add our side to a report's thread and put the dot on the business's Help item */
async function addTeamMessage(admin: Admin, reportId: string, tenantId: string, body: string): Promise<boolean> {
  const { error } = await admin.from('support_messages').insert({ report_id: reportId, tenant_id: tenantId, author: 'team', body: body.slice(0, 4000) })
  if (error) return false
  await admin.from('support_reports').update({ reply_unread: true }).eq('id', reportId)
  return true
}

/** Reply on a report: to the business's Help panel, and by email to the user who reported it */
export async function replyToReport(admin: Admin, id: string, text: string, mailer: SupportMailer): Promise<{ ok: boolean; emailed: boolean }> {
  const body = text.trim()
  if (!body) return { ok: false, emailed: false }
  const { data } = await admin.from('support_reports').select('id, tenant_id, user_id, body, tenant:tenants!tenant_id (name)').eq('id', id).maybeSingle()
  const report = data as unknown as { id: string; tenant_id: string; user_id: string | null; body: string | null; tenant: unknown } | null
  if (!report) return { ok: false, emailed: false }
  if (!(await addTeamMessage(admin, report.id, report.tenant_id, body))) return { ok: false, emailed: false }
  const to = await recipientOf(admin, report.user_id, report.tenant_id)
  const email = supportReplyEmail({
    businessName: one(report.tenant as { name?: string } | null)?.name ?? '',
    reply: body,
    yourWords: report.body ?? '',
    link: helpLink(mailer.appUrl, { kind: 'report', id: report.id }),
  })
  const emailed = to ? await mailer.send(to, email, 'support-reply').catch(() => false) : false
  return { ok: true, emailed }
}

interface Attached {
  reportId: string
  tenantId: string
  userId: string | null
  businessName: string
  body: string
  createdAt: string
  fixedEmailedAt: string | null
}

/** A problem's own report and every report merged into it */
export async function attachedReports(admin: Admin, id: string): Promise<Attached[]> {
  const rows = await allReports(admin)
  return rows
    .filter((row) => row.id === id || internalOf(row)?.merged_into === id)
    .map((row) => ({
      reportId: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      businessName: tenantName(row),
      body: row.body ?? '',
      createdAt: row.created_at,
      fixedEmailedAt: internalOf(row)?.fixed_emailed_at ?? null,
    }))
}

const FIXED_LINE = 'This is fixed now. Thank you for telling us.'

/** What "Fixed" will send, and to how many businesses, before the owner confirms */
export async function fixedPreview(admin: Admin, id: string, message: string, appUrl: string): Promise<{ businesses: number; email: SupportEmail } | null> {
  const attached = await attachedReports(admin, id)
  if (attached.length === 0) return null
  const recipients = fixedRecipients(attached)
  const sample = recipients[0] ?? attached[0]!
  return {
    businesses: recipients.length,
    email: supportFixedEmail({ businessName: sample.businessName, message, yourWords: sample.body, link: helpLink(appUrl, { kind: 'report', id: sample.reportId }) }),
  }
}

/**
 * The owner confirmed "Fixed". Every report attached to the problem is set to
 * fixed; every business attached is told once (its Help panel, and an email
 * to the user who reported). A business told before is not told again.
 */
export async function markFixed(admin: Admin, id: string, message: string, mailer: SupportMailer, now: Date = new Date()): Promise<{ ok: boolean; businesses: number; emailed: number }> {
  const attached = await attachedReports(admin, id)
  if (attached.length === 0) return { ok: false, businesses: 0, emailed: 0 }
  await admin.from('support_reports').update({ status: 'fixed' }).in('id', attached.map((a) => a.reportId))
  const recipients = fixedRecipients(attached)
  let emailed = 0
  for (const recipient of recipients) {
    // recorded first: whatever happens next, this business is never told twice
    if (!(await internalPatch(admin, recipient.reportId, { fixed_emailed_at: now.toISOString() }))) continue
    await addTeamMessage(admin, recipient.reportId, recipient.tenantId, message.trim() || FIXED_LINE)
    const to = await recipientOf(admin, recipient.userId, recipient.tenantId)
    if (!to) continue
    const email = supportFixedEmail({ businessName: recipient.businessName, message, yourWords: recipient.body, link: helpLink(mailer.appUrl, { kind: 'report', id: recipient.reportId }) })
    if (await mailer.send(to, email, 'support-fixed').catch(() => false)) emailed++
  }
  return { ok: true, businesses: recipients.length, emailed }
}

// ---------------------------------------------------------------------------
// One feature request
// ---------------------------------------------------------------------------

export interface FeatureDetail {
  id: string
  title: string
  summary: string
  status: FeatureStatus
  ownWords: boolean
  createdAt: string
  votes: Array<{ id: string; business: string; plan: string | null; paying: boolean; body: string; createdAt: string }>
  merged: Array<{ id: string; title: string }>
  mergedInto: { id: string; title: string } | null
  mergeTargets: Array<{ id: string; title: string }>
}

async function votesOn(admin: Admin, requestIds: string[]): Promise<VoteRow[]> {
  const { data } = await admin.from('feature_votes').select('id, request_id, tenant_id, user_id, body, shipped_emailed_at, created_at').in('request_id', requestIds).order('created_at', { ascending: true }).limit(2000)
  return (data ?? []) as VoteRow[]
}

/** One request, the businesses that asked and their own words. Opening it counts it as seen. */
export async function featureDetail(admin: Admin, id: string, now: Date = new Date()): Promise<FeatureDetail | null> {
  const { data } = await admin.from('feature_requests').select('id, title, summary, title_source, status, merged_into, reviewed_at, created_at').limit(1000)
  const all = (data ?? []) as RequestRow[]
  const request = all.find((r) => r.id === id)
  if (!request) return null
  if (!request.reviewed_at) await admin.from('feature_requests').update({ reviewed_at: now.toISOString() }).eq('id', id)
  const votes = await votesOn(admin, [id])
  const plans = await plansOf(admin, votes.map((v) => v.tenant_id))
  const into = request.merged_into ? all.find((r) => r.id === request.merged_into) : null
  return {
    id: request.id,
    title: request.title,
    summary: request.summary ?? '',
    status: request.status,
    ownWords: request.title_source === 'words',
    createdAt: request.created_at,
    votes: votes.map((v) => {
      const plan = plans.get(v.tenant_id)
      return { id: v.id, business: plan?.name ?? 'A business', plan: plan?.plan ?? null, paying: plan?.paying ?? false, body: v.body ?? '', createdAt: v.created_at }
    }),
    merged: all.filter((r) => r.merged_into === id).map((r) => ({ id: r.id, title: r.title })),
    mergedInto: into ? { id: into.id, title: into.title } : null,
    mergeTargets: all.filter((r) => r.id !== id && !r.merged_into).slice(0, 300).map((r) => ({ id: r.id, title: r.title })),
  }
}

export async function renameFeature(admin: Admin, id: string, patch: { title?: string; summary?: string }): Promise<boolean> {
  const update: Record<string, unknown> = {}
  if (typeof patch.title === 'string') {
    const title = patch.title.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!title) return false
    update.title = title
    // the owner's own title may be shown to other businesses
    update.title_source = 'owner'
  }
  if (typeof patch.summary === 'string') update.summary = patch.summary.replace(/\s+/g, ' ').trim().slice(0, 400)
  if (Object.keys(update).length === 0) return false
  const { error } = await admin.from('feature_requests').update(update).eq('id', id)
  return !error
}

/** A status other than "Shipped" (that one is confirmed, and emails) */
export async function setFeatureStatus(admin: Admin, id: string, status: FeatureStatus): Promise<boolean> {
  if (!FEATURE_STATUSES.includes(status) || status === 'shipped') return false
  const { error } = await admin.from('feature_requests').update({ status }).eq('id', id)
  return !error
}

/**
 * Merge a request into another: its votes move across. A business that asked
 * for both keeps one vote on the request it joined (its other stays on the
 * merged one, which is no longer listed).
 */
export async function mergeFeature(admin: Admin, id: string, into: string): Promise<{ ok: boolean; message?: string }> {
  if (id === into) return { ok: false, message: 'A request cannot be merged into itself.' }
  const { data } = await admin.from('feature_requests').select('id, merged_into').in('id', [id, into])
  const rows = (data ?? []) as Array<{ id: string; merged_into: string | null }>
  const target = rows.find((r) => r.id === into)
  if (!rows.some((r) => r.id === id) || !target) return { ok: false, message: 'That request could not be found.' }
  const final = target.merged_into ?? into
  if (final === id) return { ok: false, message: 'That request is already merged into this one.' }
  const [mine, theirs] = await Promise.all([votesOn(admin, [id]), votesOn(admin, [final])])
  const already = new Set(theirs.map((v) => v.tenant_id))
  const moving = mine.filter((v) => !already.has(v.tenant_id)).map((v) => v.id)
  if (moving.length) await admin.from('feature_votes').update({ request_id: final }).in('id', moving)
  await admin.from('feature_requests').update({ merged_into: final }).eq('merged_into', id)
  const { error } = await admin.from('feature_requests').update({ merged_into: final }).eq('id', id)
  return error ? { ok: false, message: 'The merge could not be saved.' } : { ok: true }
}

/** Split one business's ask out into a request of its own (the reverse of a merge, one business at a time) */
export async function splitFeature(admin: Admin, id: string, voteId: string, now: Date = new Date()): Promise<{ ok: boolean; newId?: string; message?: string }> {
  const votes = await votesOn(admin, [id])
  const vote = votes.find((v) => v.id === voteId)
  if (!vote) return { ok: false, message: 'That business is not on this request.' }
  if (votes.length < 2) return { ok: false, message: 'This request has one business on it: there is nothing to split.' }
  const { data: created, error } = await admin
    .from('feature_requests')
    .insert({ title: titleFromWords(vote.body ?? ''), title_source: 'words', reviewed_at: now.toISOString() })
    .select('id')
    .single()
  if (error || !created) return { ok: false, message: 'The split could not be saved.' }
  const newId = (created as { id: string }).id
  const { error: moveError } = await admin.from('feature_votes').update({ request_id: newId }).eq('id', voteId)
  if (moveError) {
    await admin.from('feature_requests').delete().eq('id', newId)
    return { ok: false, message: 'The split could not be saved.' }
  }
  if ((vote.body ?? '').trim()) await requestSupportJob('feature_title', newId)
  return { ok: true, newId }
}

interface ShippedVote {
  voteId: string
  tenantId: string
  userId: string | null
  shippedEmailedAt: string | null
}

/** Every business that voted for a request, counting the requests merged into it */
async function votersOf(admin: Admin, id: string): Promise<{ request: RequestRow; votes: ShippedVote[] } | null> {
  const { data } = await admin.from('feature_requests').select('id, title, summary, title_source, status, merged_into, reviewed_at, created_at').or(`id.eq.${id},merged_into.eq.${id}`)
  const rows = (data ?? []) as RequestRow[]
  const request = rows.find((r) => r.id === id)
  if (!request) return null
  const votes = await votesOn(admin, rows.map((r) => r.id))
  return { request, votes: votes.map((v) => ({ voteId: v.id, tenantId: v.tenant_id, userId: v.user_id, shippedEmailedAt: v.shipped_emailed_at })) }
}

export async function shippedPreview(admin: Admin, id: string, appUrl: string): Promise<{ businesses: number; email: SupportEmail } | null> {
  const found = await votersOf(admin, id)
  if (!found) return null
  const recipients = shippedRecipients(found.votes)
  const names = await plansOf(admin, recipients.slice(0, 1).map((r) => r.tenantId))
  return {
    businesses: recipients.length,
    email: featureShippedEmail({ businessName: names.get(recipients[0]?.tenantId ?? '')?.name ?? '', title: found.request.title, summary: found.request.summary, link: `${appUrl.replace(/\/+$/, '')}/app?help=open` }),
  }
}

/** The owner confirmed "Shipped": the status is set and every business that voted is emailed once */
export async function markShipped(admin: Admin, id: string, mailer: SupportMailer, now: Date = new Date()): Promise<{ ok: boolean; businesses: number; emailed: number }> {
  const found = await votersOf(admin, id)
  if (!found) return { ok: false, businesses: 0, emailed: 0 }
  const { error } = await admin.from('feature_requests').update({ status: 'shipped' }).eq('id', id)
  if (error) return { ok: false, businesses: 0, emailed: 0 }
  const recipients = shippedRecipients(found.votes)
  const names = await plansOf(admin, recipients.map((r) => r.tenantId))
  let emailed = 0
  for (const recipient of recipients) {
    // recorded first, for every vote of this business on the request: it is never emailed twice
    const mine = found.votes.filter((v) => v.tenantId === recipient.tenantId).map((v) => v.voteId)
    const { error: markError } = await admin.from('feature_votes').update({ shipped_emailed_at: now.toISOString() }).in('id', mine)
    if (markError) continue
    const to = await recipientOf(admin, recipient.userId, recipient.tenantId)
    if (!to) continue
    const email = featureShippedEmail({ businessName: names.get(recipient.tenantId)?.name ?? '', title: found.request.title, summary: found.request.summary, link: `${mailer.appUrl.replace(/\/+$/, '')}/app?help=open` })
    if (await mailer.send(to, email, 'feature-shipped').catch(() => false)) emailed++
  }
  return { ok: true, businesses: recipients.length, emailed }
}
