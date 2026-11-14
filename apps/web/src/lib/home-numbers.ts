/**
 * T-152: the four Home numbers for the last 30 days — pure.
 * Setup tests never count; "requests" are customers' requests (not quotes
 * the business made in its own app). Held leads are requests too.
 */
import { QUOTE_TURN_COPY } from '@estimator/shared'
import type { QuoteActivityKind } from '@estimator/shared'
import { BUSINESS_SOURCES } from './setup-checklist'

export interface HomeQuoteRow {
  status: string
  created_at: string
  sent_at: string | null
  accepted_at: string | null
  pricing_json: { total?: number } | null
  is_test?: boolean | null
  source_type?: string | null
  /** T-160: for the latest activity */
  id?: string
  customer_name?: string | null
  approved_at?: string | null
  viewed_at?: string | null
  declined_at?: string | null
}

export interface HomeNumbers {
  requests: number
  sent: number
  accepted: number
  valueAccepted: number
}

export const HOME_WINDOW_DAYS = 30

/**
 * The numbers for one period: from `since` up to (not including) `until`.
 * Without `until` the period runs to now. T-160 uses `until` for the 30 days
 * before, so the two periods never share a quote.
 */
export function homeNumbers(rows: HomeQuoteRow[] | null | undefined, since: Date, until?: Date): HomeNumbers {
  const after = (iso: string | null | undefined) => {
    if (!iso) return false
    const at = new Date(iso).getTime()
    return at >= since.getTime() && (until === undefined || at < until.getTime())
  }
  const out: HomeNumbers = { requests: 0, sent: 0, accepted: 0, valueAccepted: 0 }
  for (const q of rows ?? []) {
    if (q.is_test) continue
    if (after(q.created_at) && !(BUSINESS_SOURCES as readonly string[]).includes(q.source_type ?? '')) out.requests++
    if (after(q.sent_at)) out.sent++
    if (after(q.accepted_at) && ['accepted', 'paid'].includes(q.status)) {
      out.accepted++
      const total = q.pricing_json?.total
      if (typeof total === 'number' && Number.isFinite(total)) out.valueAccepted += total
    }
  }
  return out
}

/** Pure: which pending quotes the owner can approve from Home (newest first). */
export function waitingForApproval<
  T extends { status: string; created_at: string; pricing_json: { total?: number } | null; content_json: { limitHold?: boolean } | null; is_test?: boolean | null },
>(rows: T[] | null | undefined): T[] {
  return (rows ?? [])
    .filter((q) => q.status === 'pending_review' && !q.is_test && !q.content_json?.limitHold && (q.pricing_json?.total ?? 0) > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** T-158: the statuses Home's "Waiting for you" reads (the "Needs you" group) */
export const WAITING_FOR_YOU_STATUSES = ['pending_review', 'feedback_received', 'failed'] as const

/**
 * Pure (T-158): everything on Home that waits for the owner, newest first —
 * quotes to approve (the rule above), customer questions, and requests that
 * could not be priced. Setup tests and requests held by the plan limit stay
 * out, as before: the plan banner covers the held ones.
 */
export function waitingForYou<
  T extends { status: string; created_at: string; pricing_json: { total?: number } | null; content_json: { limitHold?: boolean } | null; is_test?: boolean | null },
>(rows: T[] | null | undefined): T[] {
  const approvals = new Set(waitingForApproval(rows))
  return (rows ?? [])
    .filter((q) => approvals.has(q) || (!q.is_test && (q.status === 'feedback_received' || q.status === 'failed')))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ---------------------------------------------------------------------------
// T-160: this period against the one before
// ---------------------------------------------------------------------------

export interface NumberChange {
  direction: 'up' | 'down' | 'same'
  /** How much it moved, never negative */
  by: number
}

export function numberChange(current: number, previous: number): NumberChange {
  const diff = current - previous
  return { direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same', by: Math.abs(diff) }
}

/**
 * Each of the four numbers against the period before. `null` when there is
 * nothing in either period: a brand-new business sees plain numbers, not four
 * "same" lines. Money is compared in whole units, the way Home shows it.
 */
export function compareHomeNumbers(current: HomeNumbers, previous: HomeNumbers): Record<keyof HomeNumbers, NumberChange> | null {
  const keys: Array<keyof HomeNumbers> = ['requests', 'sent', 'accepted', 'valueAccepted']
  if (keys.every((k) => current[k] === 0 && previous[k] === 0)) return null
  return {
    requests: numberChange(current.requests, previous.requests),
    sent: numberChange(current.sent, previous.sent),
    accepted: numberChange(current.accepted, previous.accepted),
    valueAccepted: numberChange(Math.round(current.valueAccepted), Math.round(previous.valueAccepted)),
  }
}

/** "up 3", "down 1", "same" (the caller formats the amount: a count or money) */
export function changeWords(change: NumberChange, format: (by: number) => string = String): string {
  const W = QUOTE_TURN_COPY.home.numbers
  if (change.direction === 'same') return W.same
  return change.direction === 'up' ? W.up(format(change.by)) : W.down(format(change.by))
}

// ---------------------------------------------------------------------------
// T-160: latest activity, from timestamps the quotes already carry
// ---------------------------------------------------------------------------

export interface HomeActivityEvent {
  kind: QuoteActivityKind
  quoteId: string
  customerName: string | null
  at: string
}

export interface HomeQuestionRow {
  quote_id: string
  created_at: string
  customer_name?: string | null
  is_test?: boolean | null
}

export const HOME_ACTIVITY_LIMIT = 6

/**
 * Pure: the newest things that happened to the business's quotes, newest
 * first. Every event is a timestamp already on a quote (or on a customer's
 * question); there is no activity table.
 *
 * - request received  quotes.created_at  (a customer's request, not a quote
 *                                         the business made in its own app)
 * - you approved      quotes.approved_at
 * - customer opened   quotes.viewed_at   (the first time they opened it)
 * - customer asked    quote_feedback.created_at
 * - customer accepted quotes.accepted_at (while the quote is accepted or paid)
 * - customer declined quotes.declined_at (while the quote is declined)
 *
 * Setup tests never show. Events before `since` are left out.
 */
export function buildHomeActivity(
  rows: HomeQuoteRow[] | null | undefined,
  questions: HomeQuestionRow[] | null | undefined,
  since: Date,
  limit: number = HOME_ACTIVITY_LIMIT
): HomeActivityEvent[] {
  const events: HomeActivityEvent[] = []
  const add = (kind: QuoteActivityKind, quoteId: string | undefined, customerName: string | null | undefined, at: string | null | undefined) => {
    if (!quoteId || !at) return
    const time = new Date(at).getTime()
    if (Number.isNaN(time) || time < since.getTime()) return
    events.push({ kind, quoteId, customerName: customerName?.trim() || null, at })
  }
  for (const q of rows ?? []) {
    if (q.is_test) continue
    if (!(BUSINESS_SOURCES as readonly string[]).includes(q.source_type ?? '')) add('request', q.id, q.customer_name, q.created_at)
    add('approved', q.id, q.customer_name, q.approved_at)
    add('opened', q.id, q.customer_name, q.viewed_at)
    if (q.status === 'accepted' || q.status === 'paid') add('accepted', q.id, q.customer_name, q.accepted_at)
    if (q.status === 'declined') add('declined', q.id, q.customer_name, q.declined_at)
  }
  for (const f of questions ?? []) {
    if (f.is_test) continue
    add('question', f.quote_id, f.customer_name, f.created_at)
  }
  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit)
}
