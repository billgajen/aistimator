/**
 * T-198: the owner's side of "Ask Qolumns" (server only, platform admin
 * only): every question, its answer, the guide entries the answer used, the
 * business's rating, and the owner's own mark and note.
 *
 * It reads every business's questions, so every route that calls it checks
 * `verifyAdmin()` first; a business never reaches it. Nothing here throws
 * into the inbox: questions that cannot be read are an empty list and a
 * count of zero, and the rest of the inbox still loads.
 */
import { ASK_REVIEWS, needsAttention, routeOf, type AskRating, type AskReview, type StoredAskOutcome } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { helpGuide } from '@/lib/help/guide'
import { one, plansOf } from '@/lib/support'

type Admin = ReturnType<typeof createAdminClient>

export interface QuestionRow {
  id: string
  tenantId: string
  business: string
  question: string
  outcome: StoredAskOutcome
  rating: AskRating | null
  review: AskReview
  needsAttention: boolean
  createdAt: string
}

export interface QuestionDetail extends QuestionRow {
  answer: string | null
  /** The guide entries the answer rested on; one that is no longer in the guide keeps its id */
  entries: Array<{ id: string; question: string | null; page: string | null; file: string | null }>
  page: string | null
  quoteId: string | null
  reportId: string | null
  plan: string | null
  ownerNote: string
  /** The other questions of the same sitting, oldest first */
  conversation: Array<{ id: string; question: string; outcome: StoredAskOutcome; createdAt: string }>
}

const COLUMNS = 'id, tenant_id, question, outcome, rating, review, created_at, tenant:tenants!tenant_id (name)'

interface Row {
  id: string
  tenant_id: string
  question: string
  outcome: StoredAskOutcome
  rating: AskRating | null
  review: AskReview
  created_at: string
  tenant: unknown
}

function rowOf(row: Row): QuestionRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    business: one(row.tenant as { name?: string } | null)?.name ?? 'A business',
    question: row.question,
    outcome: row.outcome,
    rating: row.rating,
    review: row.review,
    needsAttention: needsAttention(row),
    createdAt: row.created_at,
  }
}

/** Every question, newest first (the last 90 days are all there is) */
export async function listQuestions(admin: Admin, limit = 500): Promise<QuestionRow[]> {
  try {
    const { data, error } = await admin.from('help_questions').select(COLUMNS).order('created_at', { ascending: false }).limit(limit)
    if (error) return []
    return ((data ?? []) as unknown as Row[]).map(rowOf)
  } catch {
    return []
  }
}

/** Questions the owner has not dealt with: a "not sure" answer, or one the business said did not help */
export async function questionsToLookAt(admin: Admin): Promise<number> {
  try {
    const { count, error } = await admin.from('help_questions').select('id', { count: 'exact', head: true }).eq('review', 'open').or('outcome.eq.not_sure,rating.eq.no')
    return error ? 0 : (count ?? 0)
  } catch {
    return 0
  }
}

export async function questionDetail(admin: Admin, id: string): Promise<QuestionDetail | null> {
  const { data } = await admin.from('help_questions').select(`${COLUMNS}, answer, entries, page, quote_id, report_id, owner_note, conversation_id`).eq('id', id).maybeSingle()
  if (!data) return null
  const row = data as unknown as Row & { answer: string | null; entries: string[] | null; page: string | null; quote_id: string | null; report_id: string | null; owner_note: string | null; conversation_id: string }
  const guide = helpGuide()
  const { data: others } = await admin
    .from('help_questions')
    .select('id, question, outcome, created_at')
    .eq('tenant_id', row.tenant_id)
    .eq('conversation_id', row.conversation_id)
    .order('created_at', { ascending: true })
    .limit(50)
  const plans = await plansOf(admin, [row.tenant_id])
  return {
    ...rowOf(row),
    answer: row.answer,
    entries: (row.entries ?? []).map((entryId) => {
      const entry = guide.entries.find((e) => e.id === entryId)
      return { id: entryId, question: entry?.question ?? null, page: entry ? routeOf(entry.page) : null, file: entry ? entry.area : null }
    }),
    page: row.page,
    quoteId: row.quote_id,
    reportId: row.report_id,
    plan: plans.get(row.tenant_id)?.plan ?? null,
    ownerNote: row.owner_note ?? '',
    conversation: ((others ?? []) as Array<{ id: string; question: string; outcome: StoredAskOutcome; created_at: string }>).map((o) => ({ id: o.id, question: o.question, outcome: o.outcome, createdAt: o.created_at })),
  }
}

/** The owner's mark ("Guide updated", "Nothing to do", or back to open) and private note */
export async function reviewQuestion(admin: Admin, id: string, change: { review?: unknown; note?: unknown }): Promise<boolean> {
  const update: Record<string, unknown> = {}
  if (typeof change.review === 'string' && (ASK_REVIEWS as readonly string[]).includes(change.review)) update.review = change.review
  if (typeof change.note === 'string') update.owner_note = change.note.trim().slice(0, 4000) || null
  if (Object.keys(update).length === 0) return false
  const { data, error } = await admin.from('help_questions').update(update).eq('id', id).select('id')
  return !error && (data?.length ?? 0) > 0
}
