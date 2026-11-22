/**
 * T-198: "Ask Qolumns", the web app's side (server only). The rules, the
 * words and the checks on every answer are in packages/shared/src/help-ask.ts.
 *
 * It is an extra and it only reads: this file writes to one table
 * (`help_questions`) and nowhere else. If any part of it fails, the business
 * is told "I couldn't answer just now." and offered the report form; the
 * Help panel and the page behind it carry on.
 *
 * What reaches the model: the help guide, the business's own state, the
 * estimate's pricing record with the customer taken out, and the business's
 * words after `cleanQuestion`. The customer's own details are read here only
 * to take them out of those words; they are never sent, stored or logged.
 * Logs carry an id and an outcome.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ASK_COPY,
  ASK_DAILY_LIMIT,
  ASK_HISTORY_TURNS,
  ASK_SYSTEM_PROMPT,
  ASK_TIMEOUT_MS,
  FIXED_ANSWERS,
  askActions,
  buildAskPrompt,
  canBeRated,
  cleanQuestion,
  estimateDigest,
  finishAnswer,
  guideText,
  parseAskHead,
  quoteIdOfPath,
  selectEntries,
  suggestedQuestions,
  type AskAnswer,
  type AskEvent,
  type AskHead,
  type AskRating,
  type AskSuggestion,
  type AskTurn,
  type CustomerDetails,
  type EstimateDigest,
  type HelpEntry,
  type HelpGuide,
  type HelpState,
  type StoredAskOutcome,
} from '@qolumns/shared'
import { geminiModelFor } from '@/lib/ai/models'
import { streamModel } from '@/lib/ai/stream'
import { one } from '@/lib/support'
import { HELP_PAGE_NAMES, helpGuide, pageNamesFor } from './guide'
import { dashboardPath, loadHelpState } from './state'

type Db = SupabaseClient
/** The service-role client: the only one that may write `help_questions` */
type Admin = Pick<SupabaseClient, 'from'>

/** The model, as this file needs it: a system text and a message in, the answer's text out, piece by piece */
export type AskModel = (system: string, prompt: string, signal: AbortSignal) => AsyncIterable<string>

const realModel: AskModel = (system, prompt, signal) => streamModel('help_answer', { system, prompt, signal })

// ---------------------------------------------------------------------------
// The daily limit: counted in the database, and it fails open
// ---------------------------------------------------------------------------

/** Questions this business asked in the last day, or null when that cannot be counted (then the question is allowed) */
export async function askedToday(admin: Admin, tenantId: string, now: Date = new Date()): Promise<number | null> {
  try {
    const since = new Date(now.getTime() - 86_400_000).toISOString()
    const { count, error } = await admin.from('help_questions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gt('created_at', since)
    return error || typeof count !== 'number' ? null : count
  } catch {
    return null
  }
}

export function underAskLimit(count: number | null): boolean {
  return typeof count !== 'number' || !Number.isFinite(count) || count < ASK_DAILY_LIMIT
}

// ---------------------------------------------------------------------------
// The estimate the question was asked from
// ---------------------------------------------------------------------------

export interface QuoteForHelp {
  estimate: EstimateDigest
  /** Used only to take the customer's details out of the business's words; never sent */
  customers: CustomerDetails[]
}

/**
 * The quote a question was asked from, read through the business's own
 * client by its id AND this business: another business's quote is simply
 * not found. What comes back for the model is the digest (lines, rates,
 * quantities and where each quantity came from): no name, no contact
 * details, no address, no photos, no message.
 */
export async function loadQuoteForHelp(supabase: Db, tenantId: string, quoteId: string | null): Promise<QuoteForHelp | null> {
  if (!quoteId) return null
  try {
    const { data } = await supabase
      .from('quotes')
      .select('id, status, is_test, service_id, customer_json, pricing_json, pricing_trace_json, service:services!service_id (name, work_steps), request:quote_requests!quote_request_id (job_address, job_postcode)')
      .eq('id', quoteId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const quote = data as unknown as {
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
    if (!quote) return null
    const service = one(quote.service as { name?: string; work_steps?: Parameters<typeof estimateDigest>[0]['workSteps'] } | null)
    const request = one(quote.request as { job_address?: string | null; job_postcode?: string | null } | null)
    const customers: CustomerDetails[] = [{ name: quote.customer_json?.name, email: quote.customer_json?.email, phone: quote.customer_json?.phone, address: request?.job_address }]
    if (request?.job_postcode) customers.push({ address: request.job_postcode })
    return {
      customers,
      estimate: estimateDigest({
        quoteId: quote.id,
        serviceId: quote.service_id ?? null,
        serviceName: service?.name ?? null,
        status: quote.status ?? null,
        isTest: quote.is_test,
        pricing: quote.pricing_json,
        trace: quote.pricing_trace_json,
        workSteps: service?.work_steps ?? [],
      }),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Earlier questions of this sitting
// ---------------------------------------------------------------------------

/** The stored turns of one conversation of THIS business, oldest first. Another business's conversation id finds nothing. */
export async function conversationTurns(admin: Admin, tenantId: string, conversationId: string, limit = 20): Promise<Array<AskTurn & { id: string }>> {
  try {
    const { data } = await admin
      .from('help_questions')
      .select('id, question, answer, created_at')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)
    return ((data ?? []) as Array<{ id: string; question: string; answer: string | null }>)
      .map((row) => ({ id: row.id, question: row.question, answer: row.answer ?? ASK_COPY.failed }))
      .reverse()
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------

export interface AskRequest {
  tenantId: string
  userId: string
  conversationId: string
  question: string
  page: unknown
}

export interface AskDeps {
  /** The business's own signed-in client */
  supabase: Db
  admin: Admin
  model?: AskModel
  guide?: HelpGuide
  timeoutMs?: number
  whatsappConnected?: () => Promise<boolean | null>
  /** Tests: read the state some other way */
  loadState?: typeof loadHelpState
}

export interface Answered {
  id: string | null
  answer: AskAnswer
  /** What the model was sent, for tests: nothing a customer could be known by */
  prompt: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isConversationId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** What the browser is sent when an answer is finished */
export function doneEvent(id: string | null, answer: AskAnswer): Extract<AskEvent, { t: 'done' }> {
  return { t: 'done', id, outcome: answer.outcome, text: answer.text, actions: askActions(answer, HELP_PAGE_NAMES), rate: id !== null && canBeRated(answer.outcome) }
}

/**
 * Answer one question. `emit` is called with each piece of the answer as it
 * is written (only for an answer in the model's own words). Never throws:
 * any failure, or more than twenty seconds, is the "failed" answer.
 */
export async function answerQuestion(request: AskRequest, deps: AskDeps, emit: (piece: string) => void = () => {}): Promise<Answered> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? ASK_TIMEOUT_MS)
  const page = dashboardPath(request.page)
  const quoteId = quoteIdOfPath(page)
  let customers: CustomerDetails[] = []
  let question = cleanQuestion(request.question)
  let answer: AskAnswer = { outcome: 'failed', text: ASK_COPY.failed, entries: [], pages: [] }
  let prompt: string | null = null
  try {
    const guide = deps.guide ?? helpGuide()
    const [state, quote, history] = await Promise.all([
      (deps.loadState ?? loadHelpState)(deps.supabase as SupabaseClient, request.tenantId, page, deps.whatsappConnected),
      loadQuoteForHelp(deps.supabase, request.tenantId, quoteId),
      conversationTurns(deps.admin, request.tenantId, request.conversationId, ASK_HISTORY_TURNS),
    ])
    customers = quote?.customers ?? []
    question = cleanQuestion(request.question, customers)
    const given = selectEntries(guide, question)
    prompt = buildAskPrompt({ guide: guideText(given, pageNamesFor(guide)), state, estimate: quote?.estimate ?? null, history, question, customers })
    answer = await readAnswer((deps.model ?? realModel)(ASK_SYSTEM_PROMPT, prompt, controller.signal), given, customers, controller, emit)
  } catch (error) {
    console.error(`[Ask] no answer (${controller.signal.aborted ? 'TookTooLong' : error instanceof Error ? error.name : 'error'})`)
    answer = { outcome: 'failed', text: ASK_COPY.failed, entries: [], pages: [] }
  } finally {
    clearTimeout(timer)
  }
  const id = await keepQuestion(deps.admin, request, { question, page, quoteId, answer })
  console.log(`[Ask] ${id ?? 'not kept'}: ${answer.outcome}`)
  return { id, answer, prompt }
}

/**
 * Read the model's answer as it arrives. The first line says what kind of
 * answer it is; nothing is passed on before it is read. For "not sure", the
 * hand-off and the refusal the rest is not read at all: the words are ours.
 */
async function readAnswer(pieces: AsyncIterable<string>, given: readonly HelpEntry[], customers: readonly CustomerDetails[], controller: AbortController, emit: (piece: string) => void): Promise<AskAnswer> {
  let head: AskHead | null = null
  let headDone = false
  let first = ''
  let body = ''
  for await (const piece of pieces) {
    if (controller.signal.aborted) throw new Error('TookTooLong')
    if (!headDone) {
      first += piece
      const at = first.indexOf('\n')
      if (at < 0) continue
      headDone = true
      head = parseAskHead(first.slice(0, at), given)
      if (!head) return finishAnswer(null, '')
      if (FIXED_ANSWERS[head.outcome]) return finishAnswer(head, '')
      const rest = first.slice(at + 1).replace(/^\s+/, '')
      if (rest) {
        body += rest
        emit(rest)
      }
      continue
    }
    body += piece
    emit(piece)
  }
  if (controller.signal.aborted) throw new Error('TookTooLong')
  // an answer that was one line only: a head with nothing after it
  if (!headDone) head = parseAskHead(first, given)
  return finishAnswer(head, body, customers)
}

/** Keep the question and its answer (90 days). Null when it could not be kept: the answer is still shown. */
async function keepQuestion(
  admin: Admin,
  request: AskRequest,
  kept: { question: string; page: string | null; quoteId: string | null; answer: AskAnswer }
): Promise<string | null> {
  try {
    let model: string | null = null
    try {
      model = geminiModelFor('help_answer')
    } catch {
      model = null
    }
    const { data, error } = await admin
      .from('help_questions')
      .insert({
        tenant_id: request.tenantId,
        user_id: request.userId,
        conversation_id: request.conversationId,
        question: kept.question || '(empty)',
        answer: kept.answer.outcome === 'failed' ? null : kept.answer.text,
        outcome: kept.answer.outcome satisfies StoredAskOutcome,
        entries: kept.answer.entries,
        page: kept.page,
        quote_id: kept.quoteId,
        model,
      })
      .select('id')
      .single()
    if (error || !data) {
      // a quote id that is not this business's (or is gone) must not cost the row
      if (kept.quoteId) return keepQuestion(admin, request, { ...kept, quoteId: null })
      return null
    }
    return (data as { id: string }).id
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// "Did this answer it?"
// ---------------------------------------------------------------------------

/** Record a business's own rating. A question of another business is not found. */
export async function rateQuestion(admin: Admin, tenantId: string, questionId: string, rating: AskRating): Promise<boolean> {
  try {
    const { data, error } = await admin.from('help_questions').update({ rating }).eq('id', questionId).eq('tenant_id', tenantId).select('id')
    return !error && (data?.length ?? 0) > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Three questions to start from (no AI)
// ---------------------------------------------------------------------------

export async function suggestionsFor(supabase: Db, tenantId: string, page: unknown, deps: Pick<AskDeps, 'guide' | 'whatsappConnected' | 'loadState'> = {}): Promise<AskSuggestion[]> {
  try {
    const state: HelpState = await (deps.loadState ?? loadHelpState)(supabase as SupabaseClient, tenantId, page, deps.whatsappConnected)
    return suggestedQuestions(state, (deps.guide ?? helpGuide()).entries)
  } catch {
    return []
  }
}
