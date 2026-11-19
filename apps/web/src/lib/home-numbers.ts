/**
 * T-152: the four Home numbers for the last 30 days — pure.
 * Setup tests never count; "requests" are customers' requests (not quotes
 * the business made in its own app). Held leads are requests too.
 */
import { QUOTE_TURN_COPY } from '@qolumns/shared'
import type { QuoteActivityKind } from '@qolumns/shared'
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
>(rows: T[] | null | undefined, alsoWaiting: (row: T) => boolean = () => false): T[] {
  const approvals = new Set(waitingForApproval(rows))
  return (rows ?? [])
    // T-186: `alsoWaiting` adds the quotes the business made that have its own questions open
    .filter((q) => approvals.has(q) || (!q.is_test && (q.status === 'feedback_received' || q.status === 'failed')) || alsoWaiting(q))
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
// T-169: the same four numbers in steps, for the small line under each
// ---------------------------------------------------------------------------

/** How many days one point of the line covers: 12 points across the two periods */
export const HOME_SERIES_STEP_DAYS = 5

/**
 * Each number in equal steps from `from` to `to`, oldest first. The first
 * half is the period before, the second half the current one, counted by the
 * same rules as `homeNumbers` (so the points of a half add up to its figure).
 */
export function homeSeries(
  rows: HomeQuoteRow[] | null | undefined,
  from: Date,
  to: Date,
  stepDays: number = HOME_SERIES_STEP_DAYS
): Record<keyof HomeNumbers, number[]> {
  const out: Record<keyof HomeNumbers, number[]> = { requests: [], sent: [], accepted: [], valueAccepted: [] }
  const step = stepDays * 24 * 60 * 60 * 1000
  for (let start = from.getTime(); start < to.getTime(); start += step) {
    const n = homeNumbers(rows, new Date(start), new Date(Math.min(start + step, to.getTime())))
    out.requests.push(n.requests)
    out.sent.push(n.sent)
    out.accepted.push(n.accepted)
    out.valueAccepted.push(Math.round(n.valueAccepted))
  }
  return out
}

/** What a screen reader hears instead of the line: both periods' points, in words */
export function seriesSummary(points: number[], days: number, stepDays: number = HOME_SERIES_STEP_DAYS, format: (n: number) => string = String): string {
  const half = Math.floor(points.length / 2)
  const say = (part: number[]) => part.map(format).join(', ')
  return `In ${stepDays}-day steps. The ${days} days before: ${say(points.slice(0, half))}. The last ${days} days: ${say(points.slice(half))}.`
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
