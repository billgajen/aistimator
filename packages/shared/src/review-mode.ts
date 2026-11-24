/**
 * T-147: how a service's quotes reach the customer — pure, no IO.
 *
 * Three modes per service, stored as two booleans (`services.auto_send` from
 * T-146 and `services.hold_until_approved` from T-147):
 *
 * - `show_then_confirm` (default): the customer sees the estimate at once,
 *   marked as an estimate the business will confirm. Accept stays locked until
 *   the business approves.
 * - `hold_until_approved`: the customer sees "being prepared" and no price
 *   until the business approves (the T-146 behaviour).
 * - `auto_send`: the quote goes straight out, no review.
 *
 * Every quote the business must approve is `pending_review`; `quotes.review_hold`
 * records WHY, so the public quote API can tell a normal review (safe to show)
 * from a quote a check held (never shown before approval).
 */

export type ReviewMode = 'show_then_confirm' | 'hold_until_approved' | 'auto_send'

/**
 * Why a quote is waiting for the business:
 * - `shown`: review by default; the customer already sees the estimate
 * - `held`:  review by default; hidden until approved
 * - `check`: a check held it (validation, quality gate, send-guard); hidden
 */
export type ReviewHoldKind = 'shown' | 'held' | 'check'

export const REVIEW_MODES: readonly ReviewMode[] = ['show_then_confirm', 'hold_until_approved', 'auto_send']

/** The service's mode. `auto_send` wins if both flags are somehow set. */
export function reviewModeOf(service: {
  auto_send?: boolean | null
  hold_until_approved?: boolean | null
}): ReviewMode {
  if (service.auto_send === true) return 'auto_send'
  if (service.hold_until_approved === true) return 'hold_until_approved'
  return 'show_then_confirm'
}

/** The two service columns for a mode. */
export function reviewModeColumns(mode: ReviewMode): { auto_send: boolean; hold_until_approved: boolean } {
  return {
    auto_send: mode === 'auto_send',
    hold_until_approved: mode === 'hold_until_approved',
  }
}

export interface ReviewHoldDecision {
  status: 'sent' | 'pending_review'
  /** null when the quote goes straight out */
  reviewHold: ReviewHoldKind | null
}

/**
 * The worker's final step. `statusAfterChecks` is what every check left the
 * quote at: `pending_review` means a check held it, and that is never shown
 * early whatever the service's mode. Only a quote that would otherwise have
 * gone out is subject to the service's mode. A quote the business created
 * itself (its own app) is held as before T-147: there is no customer waiting
 * on a page for it.
 *
 * T-148: banned words in the generated wording are repaired before this
 * runs; wording that could not be repaired arrives here as a check hold
 * (`statusAfterChecks: 'pending_review'`).
 */
export function decideReviewHold(input: {
  statusAfterChecks: 'sent' | 'pending_review'
  mode: ReviewMode
  businessCreated?: boolean
}): ReviewHoldDecision {
  if (input.statusAfterChecks === 'pending_review') return { status: 'pending_review', reviewHold: 'check' }
  if (input.mode === 'auto_send') return { status: 'sent', reviewHold: null }
  if (input.mode === 'hold_until_approved' || input.businessCreated) {
    return { status: 'pending_review', reviewHold: 'held' }
  }
  return { status: 'pending_review', reviewHold: 'shown' }
}

/**
 * Does the customer see this quote's price before the business approves it?
 * Fails closed: anything other than a priced, review-by-default hold recorded
 * as `shown` stays hidden (older rows have no `review_hold`; a lead held at
 * the plan limit has no price).
 */
export function isShownEarly(quote: {
  status: string
  review_hold?: string | null
  total?: number | null
  limitHold?: boolean | null
}): boolean {
  return (
    quote.status === 'pending_review' &&
    quote.review_hold === 'shown' &&
    quote.limitHold !== true &&
    (quote.total ?? 0) > 0
  )
}

/**
 * T-201: is every figure withheld from the customer? A quote that waits for
 * the business and was not shown early ("Hold until I approve", a quote the
 * business made itself, or one a check held): no price, no low and no high,
 * on the page, in the public API's answer and in the PDF, until it is approved.
 */
export function customerSeesNoFigure(quote: { status: string; shownEarly: boolean }): boolean {
  return quote.status === 'pending_review' && !quote.shownEarly
}

/**
 * T-201: may the customer see an estimated range in place of the price? Only
 * while they are confirming a detail (`awaiting_clarification`), and never for
 * a service set to "Hold until I approve": that service promises no price
 * until the business approves, and a range is a price by another name.
 * (Until T-201 a held quote with a measured range showed it.)
 */
export function customerRangeAllowed(quote: { status: string; mode: ReviewMode }): boolean {
  return quote.status === 'awaiting_clarification' && quote.mode !== 'hold_until_approved'
}

/**
 * The price range a customer may see on an unreviewed estimate: only one the
 * engine measured for uncertain quantities, returned without its grade or
 * label. A flat price has none, and none is ever invented around it.
 */
export function customerEstimateRange(
  estimate: { grade?: string; rangeLow?: number; rangeHigh?: number } | null | undefined
): { low: number; high: number } | undefined {
  if (!estimate || estimate.grade === 'A') return undefined
  const { rangeLow, rangeHigh } = estimate
  if (rangeLow === undefined || rangeHigh === undefined || !(rangeHigh > rangeLow)) return undefined
  return { low: rangeLow, high: rangeHigh }
}
