/**
 * T-197: the worker's side of the Help button. Three jobs, all reading and
 * sorting only (the rules and the prompts are in packages/shared):
 *
 *   sortReport       a problem report: title, kind, severity, look-alikes,
 *                    an estimate report's likely cause, a draft fix ticket
 *   titleFeature     a new feature request: a plain title and one line
 *   matchFeatures    which existing feature requests mean the same thing
 *
 * and the owner's daily summary (`supportDaily`).
 *
 * Nothing here changes a price, a setting, a service or a quote: the only
 * rows written are the support tables' own. Nothing here throws, and nothing
 * is retried: a sort that fails or runs out of time leaves the report as it
 * was, marked unsorted, for the owner's "Sort again".
 *
 * The model is sent ids, numbers, the names of price lines, the business's
 * own setup and the business's own words with customer details taken out
 * (`scrubCustomerDetails`). Logs carry ids and an error's name only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FEATURE_OPEN_STATUSES,
  MATCH_RESPONSE_SCHEMA,
  MATCH_SYSTEM_PROMPT,
  REPLY_RESPONSE_SCHEMA,
  REPLY_SYSTEM_PROMPT,
  SORT_HELP_MAX,
  SUPPORT_REPLY_TIMEOUT_MS,
  buildReplyPrompt,
  parseReplyAnswer,
  SORT_RESPONSE_SCHEMA,
  SORT_SYSTEM_PROMPT,
  SUPPORT_OPEN_STATUSES,
  SUPPORT_SORT_TIMEOUT_MS,
  TITLE_RESPONSE_SCHEMA,
  TITLE_SYSTEM_PROMPT,
  buildMatchPrompt,
  buildSortPrompt,
  buildTitlePrompt,
  askCutoff,
  byPriority,
  cleanSupportContext,
  couldNotAnswer,
  errorNameOf,
  estimateChoicesOf,
  estimateDigest,
  formatFixTicket,
  getRegion,
  parseMatchAnswer,
  parseSortAnswer,
  parseTitleAnswer,
  setupHintFor,
  supportDailyEmail,
  type AiTask,
  type CustomerDetails,
  type EstimateDigest,
  type KnownRequest,
  type OpenProblem,
  type SortInput,
  type StoredAskOutcome,
  type SupportAiKind,
  type SupportSeverity,
} from '@qolumns/shared'
import { createAiClient } from './ai/factory'
import type { AiEnv } from './ai/client'
import { sendOpsAlert, type OpsAlertEnv } from './ops-alert'
import { sendEmail } from './email/postmark'

export interface SupportEnv extends AiEnv, OpsAlertEnv {
  /** Per-task model overrides (ai-models.json holds the defaults) */
  AI_MODEL_SUPPORT_SORT?: string
  AI_MODEL_FEATURE_MATCH?: string
  AI_MODEL_SUPPORT_REPLY?: string
}

/** One question to a model, answered as JSON. Throws when there is no answer. */
export type Ask = (task: AiTask, prompt: string, schema: Record<string, unknown>, system: string) => Promise<unknown>

/** The real model for a task, or null when none can be asked (no key, or the checks' stand-in) */
export function modelAsk(env: SupportEnv): Ask | null {
  const ready = createAiClient('support_sort', env) !== null
  if (!ready) return null
  return async (task, prompt, schema, system) => {
    const client = createAiClient(task, env)
    if (!client) throw new Error('no model')
    return client.generateWithSchema<unknown>(prompt, schema, system)
  }
}

class SupportTimeout extends Error {
  constructor() {
    super('the model did not answer in time')
    this.name = 'SupportTimeout'
  }
}

/** Run with a time limit. The late answer of a call that ran out of time is dropped. */
async function within<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = run()
  work.catch(() => undefined)
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new SupportTimeout()), ms)))])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null))
type Db = Pick<SupabaseClient, 'from'>

// ---------------------------------------------------------------------------
// Sorting a problem report
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string
  tenant_id: string
  kind: 'problem' | 'estimate'
  body: string | null
  choices: unknown
  expected_total: number | string | null
  quote_id: string | null
  context_json: unknown
  from_assistant?: boolean | null
}

interface Loaded {
  report: ReportRow
  sort: SortInput
  estimate: EstimateDigest | null
  locale: string
  previousSeverity: SupportSeverity | null
  attempts: number
  /** Businesses on this problem: its own and those merged into it */
  businesses: number
}

/** Everything the sorter reads for one report, or null when there is no such report */
export async function loadSortInput(supabase: Db, reportId: string): Promise<Loaded | null> {
  const { data: reportData } = await supabase
    .from('support_reports')
    .select('id, tenant_id, kind, body, choices, expected_total, quote_id, context_json, from_assistant, tenant:tenants!tenant_id (region)')
    .eq('id', reportId)
    .maybeSingle()
  if (!reportData) return null
  const report = reportData as unknown as ReportRow & { tenant: unknown }
  const region = getRegion(one(report.tenant as { region?: string | null } | null)?.region)

  const { data: internalData } = await supabase.from('support_report_internal').select('severity, sort_attempts').eq('report_id', reportId).maybeSingle()
  const internal = internalData as { severity?: SupportSeverity | null; sort_attempts?: number | null } | null

  const customers: CustomerDetails[] = []
  let estimate: EstimateDigest | null = null
  // The quote is read by its id AND the report's own business: a report can never reach another business's estimate
  const quoteId = report.quote_id
  if (quoteId) {
    const { data: quoteData } = await supabase
      .from('quotes')
      .select('id, status, is_test, service_id, customer_json, pricing_json, pricing_trace_json, service:services!service_id (name, work_steps), request:quote_requests!quote_request_id (job_address, job_postcode)')
      .eq('id', quoteId)
      .eq('tenant_id', report.tenant_id)
      .maybeSingle()
    const quote = quoteData as unknown as {
      id: string
      status?: string | null
      is_test?: boolean | null
      service_id?: string | null
      customer_json?: { name?: string; email?: string; phone?: string } | null
      pricing_json?: Parameters<typeof estimateDigest>[0]['pricing']
      pricing_trace_json?: Parameters<typeof estimateDigest>[0]['trace']
      service: unknown
      request: unknown
    } | null
    if (quote) {
      const service = one(quote.service as { name?: string; work_steps?: Parameters<typeof estimateDigest>[0]['workSteps'] } | null)
      const request = one(quote.request as { job_address?: string | null; job_postcode?: string | null } | null)
      // used only to take the customer's details out of the business's words; never sent
      customers.push({ name: quote.customer_json?.name, email: quote.customer_json?.email, phone: quote.customer_json?.phone, address: request?.job_address })
      if (request?.job_postcode) customers.push({ address: request.job_postcode })
      if (report.kind === 'estimate') {
        estimate = estimateDigest({
          quoteId: quote.id,
          serviceId: quote.service_id ?? null,
          serviceName: service?.name ?? null,
          status: quote.status ?? null,
          isTest: quote.is_test,
          pricing: quote.pricing_json,
          trace: quote.pricing_trace_json,
          workSteps: service?.work_steps ?? [],
        })
      }
    }
  }

  // Open problems already sorted, other than this one and anything merged away: the look-alikes on offer
  const { data: openData } = await supabase
    .from('support_report_internal')
    .select('report_id, title, summary, merged_into, report:support_reports!report_id (status)')
    .eq('sort_state', 'sorted')
    .is('merged_into', null)
    .neq('report_id', reportId)
    .order('created_at', { ascending: false })
    .limit(80)
  const open: OpenProblem[] = ((openData ?? []) as unknown as Array<{ report_id: string; title: string | null; summary: string | null; report: unknown }>)
    .filter((row) => row.title && (SUPPORT_OPEN_STATUSES as readonly string[]).includes(one(row.report as { status?: string } | null)?.status ?? ''))
    .slice(0, 40)
    .map((row) => ({ id: row.report_id, title: row.title ?? '', summary: row.summary ?? '' }))

  const { data: mergedData } = await supabase.from('support_report_internal').select('report_id, report:support_reports!report_id (tenant_id)').eq('merged_into', reportId).limit(500)
  const tenants = new Set<string>([report.tenant_id])
  for (const row of (mergedData ?? []) as unknown as Array<{ report: unknown }>) {
    const tenantId = one(row.report as { tenant_id?: string } | null)?.tenant_id
    if (tenantId) tenants.add(tenantId)
  }

  const expected = report.expected_total === null || report.expected_total === undefined ? null : Number(report.expected_total)
  return {
    report,
    estimate,
    locale: region.locale,
    previousSeverity: internal?.severity ?? null,
    attempts: internal?.sort_attempts ?? 0,
    businesses: tenants.size,
    sort: {
      kind: report.kind,
      words: report.body ?? '',
      choices: estimateChoicesOf(report.choices),
      expectedTotal: expected !== null && Number.isFinite(expected) ? expected : null,
      context: cleanSupportContext(report.context_json),
      customers,
      estimate,
      open,
      // T-198: sent on from the Help assistant: a how-to question, whatever the model calls it
      fromAssistant: report.from_assistant === true,
    },
  }
}

export type SortOutcome = 'sorted' | 'failed' | 'missing'

export interface SortDeps {
  /** The model. Undefined = the real one for this env; null = none can be asked. */
  ask?: Ask | null
  timeoutMs?: number
  alert?: typeof sendOpsAlert
  now?: () => Date
  /** T-198: what the help guide says near the report's words, for the draft reply */
  help?: string
  replyTimeoutMs?: number
}

/**
 * Sort one report and store what the AI said. Tried once: on any failure the
 * report is left exactly as the business sent it, marked unsorted. Never
 * throws.
 */
export async function sortReport(supabase: SupabaseClient, env: SupportEnv, reportId: string, deps: SortDeps = {}): Promise<SortOutcome> {
  const now = (deps.now ?? (() => new Date()))()
  let attempts = 0
  try {
    const loaded = await loadSortInput(supabase, reportId)
    if (!loaded) return 'missing'
    attempts = loaded.attempts + 1
    const ask = deps.ask === undefined ? modelAsk(env) : deps.ask
    if (!ask) throw new SupportUnsorted('NoModel')

    const sort = deps.help ? { ...loaded.sort, help: deps.help } : loaded.sort
    const raw = await within(deps.timeoutMs ?? SUPPORT_SORT_TIMEOUT_MS, () => ask('support_sort', buildSortPrompt(sort), SORT_RESPONSE_SCHEMA, SORT_SYSTEM_PROMPT))
    const result = parseSortAnswer(raw, sort)
    if (!result) throw new SupportUnsorted('UnreadableAnswer')

    const hint = setupHintFor(loaded.estimate, result.setupLineId, loaded.locale)
    const { error } = await supabase
      .from('support_report_internal')
      .upsert(
        {
          report_id: reportId,
          title: result.title,
          summary: result.summary,
          ai_kind: result.kind,
          severity: result.severity,
          similar_json: result.similar,
          likely_cause: result.likelyCause,
          evidence: result.evidence || null,
          // T-198: a fix ticket only for a fault; every other kind gets a draft reply, asked for below
          fix_ticket: result.ticket ? formatFixTicket(result.ticket, { reportId, businesses: loaded.businesses, quoteId: loaded.report.quote_id, severity: result.severity }) : null,
          draft_reply: null,
          sort_state: 'sorted',
          sort_attempts: attempts,
          sorted_at: now.toISOString(),
        },
        { onConflict: 'report_id' }
      )
    if (error) throw new SupportUnsorted('NotSaved')
    // The one thing a business is shown from the sorting: a possibility, written from its own setup
    await supabase.from('support_reports').update({ setup_hint: hint }).eq('id', reportId)

    console.log(`[Support] sorted ${reportId}: ${result.kind}, ${result.severity}`)
    // A high-severity problem reaches the owner at once (one email an hour for a burst; the rest are counted)
    if (result.severity === 'high' && loaded.previousSeverity !== 'high') {
      await (deps.alert ?? sendOpsAlert)(supabase, env, { kind: 'support_high', details: { Report: reportId, Kind: result.kind, Businesses: loaded.businesses } })
    }
    // T-198: the sorting is stored and the owner told. Only now the draft reply, on its own: if it is slow,
    // fails or invents a figure there is simply no draft, and the report keeps its sorting.
    if (result.kind !== 'fault') await draftReply(supabase, ask, reportId, sort, result, deps.replyTimeoutMs)
    return 'sorted'
  } catch (error) {
    console.error(`[Support] sorting ${reportId} failed (${errorNameOf(error)}); the report is kept, unsorted`)
    try {
      await supabase.from('support_report_internal').upsert({ report_id: reportId, sort_state: 'failed', sort_attempts: Math.max(attempts, 1) }, { onConflict: 'report_id' })
    } catch {
      // the report itself is untouched either way
    }
    return 'failed'
  }
}

class SupportUnsorted extends Error {
  constructor(name: string) {
    super(name)
    this.name = name
  }
}

// ---------------------------------------------------------------------------
// Feature requests
// ---------------------------------------------------------------------------

/**
 * Give a new feature request a plain title and one line, in place of the
 * first business's own words. Only a request still titled by those words is
 * touched (the owner's title is never overwritten). Never throws.
 */
export async function titleFeature(supabase: SupabaseClient, env: SupportEnv, requestId: string, deps: SortDeps = {}): Promise<'titled' | 'failed' | 'skipped'> {
  try {
    const { data } = await supabase.from('feature_requests').select('id, title_source').eq('id', requestId).maybeSingle()
    if (!data || (data as { title_source?: string }).title_source !== 'words') return 'skipped'
    const { data: vote } = await supabase.from('feature_votes').select('body').eq('request_id', requestId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    const words = (vote as { body?: string } | null)?.body ?? ''
    if (!words.trim()) return 'skipped'
    const ask = deps.ask === undefined ? modelAsk(env) : deps.ask
    if (!ask) throw new SupportUnsorted('NoModel')
    const raw = await within(deps.timeoutMs ?? SUPPORT_SORT_TIMEOUT_MS, () => ask('feature_match', buildTitlePrompt(words), TITLE_RESPONSE_SCHEMA, TITLE_SYSTEM_PROMPT))
    const answer = parseTitleAnswer(raw)
    if (!answer) throw new SupportUnsorted('UnreadableAnswer')
    // only while it is still the business's words: the owner may have renamed it meanwhile
    await supabase.from('feature_requests').update({ title: answer.title, summary: answer.summary, title_source: 'ai' }).eq('id', requestId).eq('title_source', 'words')
    return 'titled'
  } catch (error) {
    console.error(`[Support] titling request ${requestId} failed (${errorNameOf(error)}); it keeps its first words`)
    return 'failed'
  }
}

/** The requests another business may be offered: open, not merged away, and titled by the AI or the owner (never someone's own words) */
export async function knownRequests(supabase: Db): Promise<KnownRequest[]> {
  const { data } = await supabase
    .from('feature_requests')
    .select('id, title, summary')
    .in('status', [...FEATURE_OPEN_STATUSES])
    .in('title_source', ['ai', 'owner'])
    .is('merged_into', null)
    .order('created_at', { ascending: false })
    .limit(150)
  return ((data ?? []) as Array<{ id: string; title: string; summary: string | null }>).map((row) => ({ id: row.id, title: row.title, summary: row.summary ?? '' }))
}

/**
 * Up to three existing requests that mean the same as these words. An empty
 * list on any failure: the request is then saved as a new one. The caller
 * sets the time limit (the web app waits five seconds at most). Never throws.
 */
export async function matchFeatures(supabase: Db, env: SupportEnv, words: string, deps: SortDeps = {}): Promise<KnownRequest[]> {
  try {
    const known = await knownRequests(supabase)
    if (known.length === 0) return []
    const ask = deps.ask === undefined ? modelAsk(env) : deps.ask
    if (!ask) return []
    const raw = await within(deps.timeoutMs ?? SUPPORT_SORT_TIMEOUT_MS, () => ask('feature_match', buildMatchPrompt(words, known), MATCH_RESPONSE_SCHEMA, MATCH_SYSTEM_PROMPT))
    const ids = parseMatchAnswer(raw, known)
    return ids.map((id) => known.find((r) => r.id === id)).filter((r): r is KnownRequest => Boolean(r))
  } catch (error) {
    console.error(`[Support] matching a feature request failed (${errorNameOf(error)}); it is saved as new`)
    return []
  }
}

// ---------------------------------------------------------------------------
// The jobs, as the queue and the HTTP handler run them
// ---------------------------------------------------------------------------

/** `help`: the help guide's entries that share words with the report (T-198), sent by the web app for the draft reply */
/**
 * T-198: draft a reply to a report that is not a fault, for the owner to edit
 * and send. It writes one column on the owner's side and sends nothing. Never
 * throws.
 */
async function draftReply(supabase: SupabaseClient, ask: Ask, reportId: string, sort: SortInput, sorted: { title: string; summary: string; kind: SupportAiKind }, timeoutMs?: number): Promise<void> {
  try {
    const prompt = buildReplyPrompt(sort, sorted)
    const raw = await within(timeoutMs ?? SUPPORT_REPLY_TIMEOUT_MS, () => ask('support_reply', prompt, REPLY_RESPONSE_SCHEMA, REPLY_SYSTEM_PROMPT))
    const reply = parseReplyAnswer(raw, sort, prompt)
    if (reply) await supabase.from('support_report_internal').update({ draft_reply: reply }).eq('report_id', reportId)
  } catch (error) {
    console.error(`[Support] no draft reply for ${reportId} (${errorNameOf(error)}); its sorting is kept`)
  }
}

export type SupportJob = { kind: 'support_sort'; id: string; help?: string } | { kind: 'feature_title'; id: string }

export function isSupportJob(body: unknown): body is SupportJob {
  const job = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (job.help !== undefined && (typeof job.help !== 'string' || job.help.length > SORT_HELP_MAX)) return false
  return (job.kind === 'support_sort' || job.kind === 'feature_title') && typeof job.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(job.id)
}

/** Run one support job. Never throws; a job is never run twice by the queue (the caller acknowledges it whatever happens). */
export async function runSupportJob(supabase: SupabaseClient, env: SupportEnv, job: SupportJob, deps: SortDeps = {}): Promise<string> {
  return job.kind === 'support_sort' ? sortReport(supabase, env, job.id, { ...deps, help: job.help ?? deps.help }) : titleFeature(supabase, env, job.id, deps)
}

// ---------------------------------------------------------------------------
// The owner's daily summary
// ---------------------------------------------------------------------------

const DAILY = 'support_daily'
const DAY_SECONDS = 86_400

/**
 * Once a day, one email to the owner when something is new since the last
 * one: counts by kind and the top three problems by priority. Nothing new, no
 * email (and the day is not used up). Off without ALERT_EMAIL. Never throws.
 */
export async function supportDaily(
  supabase: SupabaseClient,
  env: SupportEnv,
  now: Date = new Date(),
  send: typeof sendEmail = sendEmail
): Promise<'off' | 'nothing' | 'too_soon' | 'sent' | 'failed'> {
  try {
    const to = (env.ALERT_EMAIL ?? '').trim()
    if (!to || !env.POSTMARK_API_TOKEN || !env.POSTMARK_FROM_EMAIL) return 'off'
    const { data: lastData } = await supabase.from('ops_alerts').select('last_sent_at').eq('kind', DAILY).maybeSingle()
    const last = (lastData as { last_sent_at?: string } | null)?.last_sent_at
    const since = last ? new Date(last) : new Date(now.getTime() - DAY_SECONDS * 1000)
    if (last && now.getTime() - since.getTime() < DAY_SECONDS * 1000) return 'too_soon'

    const { data: reportData } = await supabase
      .from('support_reports')
      .select('id, tenant_id, created_at, internal:support_report_internal!report_id (title, ai_kind, severity, merged_into)')
      .gt('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(500)
    const reports = ((reportData ?? []) as unknown as Array<{ id: string; tenant_id: string; created_at: string; internal: unknown }>).map((row) => {
      const internal = one(row.internal as { title?: string | null; ai_kind?: SupportAiKind | null; severity?: SupportSeverity | null; merged_into?: string | null } | null)
      return { id: row.id, createdAt: row.created_at, title: internal?.title ?? null, kind: internal?.ai_kind ?? null, severity: internal?.severity ?? null, merged: Boolean(internal?.merged_into) }
    })
    const { count: featureCount } = await supabase.from('feature_requests').select('id', { count: 'exact', head: true }).gt('created_at', since.toISOString())
    // T-198: questions put to the Help assistant, and how many it could not answer (outcomes only: no words are read)
    const { data: askedData } = await supabase.from('help_questions').select('outcome').gt('created_at', since.toISOString()).limit(5000)
    const asked = (askedData ?? []) as Array<{ outcome: StoredAskOutcome }>

    const problems: Partial<Record<SupportAiKind | 'unsorted', number>> = {}
    for (const report of reports) problems[report.kind ?? 'unsorted'] = (problems[report.kind ?? 'unsorted'] ?? 0) + 1
    const top = reports
      .filter((r) => !r.merged)
      .map((r) => ({ title: r.title ?? 'Not sorted yet', severity: r.severity, businesses: 1, createdAt: r.createdAt }))
      .sort(byPriority)
      .slice(0, 3)
    const email = supportDailyEmail({
      problems,
      featureRequests: featureCount ?? 0,
      top,
      inboxUrl: `${(env.APP_URL ?? '').replace(/\/+$/, '')}/admin/support`,
      environment: env.ENVIRONMENT,
      questions: { asked: asked.length, unanswered: asked.filter((q) => couldNotAnswer(q.outcome)).length },
    })
    if (!email) return 'nothing'

    // One summary a day across every copy of the worker: whoever is told "yes" sends it
    const { data: claim, error } = await supabase.rpc('claim_ops_alert', { p_kind: DAILY, p_every_seconds: DAY_SECONDS })
    const row = (Array.isArray(claim) ? claim[0] : claim) as { send?: boolean } | null
    if (error || !row?.send) return 'too_soon'
    const result = await send(
      { apiToken: env.POSTMARK_API_TOKEN, fromEmail: env.POSTMARK_FROM_EMAIL },
      { from: { kind: 'business' }, to, subject: email.subject, htmlBody: email.html, textBody: email.text, tag: 'support-daily' }
    )
    console.log(`[Support] daily summary: ${result.success ? 'sent' : 'failed'}`)
    return result.success ? 'sent' : 'failed'
  } catch (error) {
    console.error(`[Support] daily summary failed (${errorNameOf(error)})`)
    return 'failed'
  }
}

// ---------------------------------------------------------------------------
// T-198: questions put to the Help assistant are kept 90 days
// ---------------------------------------------------------------------------

const HELP_CLEANUP = 'help_cleanup'

/**
 * Once a day, delete the Help assistant's questions and answers that are
 * older than 90 days (`ASK_KEEP_DAYS`). The day is claimed through the same
 * rule the alerts use, so every copy of the worker does it once between
 * them. Never throws; a day that fails is tried again the next day.
 */
export async function helpCleanup(supabase: SupabaseClient, now: Date = new Date()): Promise<'too_soon' | 'done' | 'failed'> {
  try {
    // look before claiming: a claim that is refused is counted as "held back", and this runs every five minutes
    const { data: lastData } = await supabase.from('ops_alerts').select('last_sent_at').eq('kind', HELP_CLEANUP).maybeSingle()
    const last = (lastData as { last_sent_at?: string } | null)?.last_sent_at
    if (last && now.getTime() - new Date(last).getTime() < DAY_SECONDS * 1000) return 'too_soon'
    const { data: claim, error: claimError } = await supabase.rpc('claim_ops_alert', { p_kind: HELP_CLEANUP, p_every_seconds: DAY_SECONDS })
    const row = (Array.isArray(claim) ? claim[0] : claim) as { send?: boolean } | null
    if (claimError || !row?.send) return 'too_soon'
    const { error, count } = await supabase.from('help_questions').delete({ count: 'exact' }).lt('created_at', askCutoff(now).toISOString())
    if (error) throw new SupportUnsorted('NotDeleted')
    console.log(`[Support] help questions past their 90 days: ${count ?? 0} deleted`)
    return 'done'
  } catch (error) {
    console.error(`[Support] deleting old help questions failed (${errorNameOf(error)})`)
    return 'failed'
  }
}
