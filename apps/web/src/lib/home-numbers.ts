/**
 * T-152: the four Home numbers for the last 30 days — pure.
 * Setup tests never count; "requests" are customers' requests (not quotes
 * the business made in its own app). Held leads are requests too.
 */
import { BUSINESS_SOURCES } from './setup-checklist'

export interface HomeQuoteRow {
  status: string
  created_at: string
  sent_at: string | null
  accepted_at: string | null
  pricing_json: { total?: number } | null
  is_test?: boolean | null
  source_type?: string | null
}

export interface HomeNumbers {
  requests: number
  sent: number
  accepted: number
  valueAccepted: number
}

export const HOME_WINDOW_DAYS = 30

export function homeNumbers(rows: HomeQuoteRow[] | null | undefined, since: Date): HomeNumbers {
  const after = (iso: string | null | undefined) => Boolean(iso) && new Date(iso as string).getTime() >= since.getTime()
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
