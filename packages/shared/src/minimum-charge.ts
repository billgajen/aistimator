/**
 * T-165: the minimum charge is a floor, not an item.
 *
 * A business's minimum charge applies only when a job's own lines total less
 * than it. Then the lines stay as they are, and the difference is stored as
 * ONE entry of the breakdown, marked as the minimum, so the lines plus that
 * entry still add up to the subtotal (the T-157 rule). Nothing renders that
 * entry as a line: every place that shows a breakdown shows the job's real
 * lines and then one note, "Minimum charge of $400 applied".
 *
 * This file is the one place for the marker, the wording and the arithmetic.
 * The pricing engine (worker), the save route, the quote editor and every
 * renderer (customer quote page, PDF, dashboard, pricing trace) use it.
 *
 * Quotes stored before this change carry the top-up as an ordinary line
 * labelled "Minimum charge applied" (or, from an older engine path, one line
 * "Minimum charge" replacing every other line). They are read as the same
 * entry, so they render as the note with no data migration.
 */

export const MINIMUM_ENTRY_KIND = 'minimum' as const

/** The stored label of the entry. Unchanged from before, so old and new entries read alike. */
export const MINIMUM_ENTRY_LABEL = 'Minimum charge applied'

const STORED_LABELS = new Set(['minimum charge applied', 'minimum charge'])

export interface BreakdownLike {
  label: string
  amount: number
  /** 'minimum' on the one entry that tops the job up to the business's minimum charge */
  kind?: string
  /** On that entry: the business's minimum charge when the quote was priced */
  minimumCharge?: number
}

const cents = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Is this breakdown entry the minimum top-up (marked, or stored before the marker existed)? */
export function isMinimumEntry(item: { label?: unknown; kind?: unknown } | null | undefined): boolean {
  if (!item) return false
  if (item.kind === MINIMUM_ENTRY_KIND) return true
  if (item.kind !== undefined && item.kind !== null) return false
  return typeof item.label === 'string' && STORED_LABELS.has(item.label.trim().toLowerCase())
}

/** The entry to store: the top-up, marked, with the minimum it tops up to */
export interface MinimumEntry {
  label: string
  amount: number
  kind: typeof MINIMUM_ENTRY_KIND
  minimumCharge: number
}

export function minimumEntry(topUp: number, minimumCharge: number): MinimumEntry {
  return { label: MINIMUM_ENTRY_LABEL, amount: cents(topUp), kind: MINIMUM_ENTRY_KIND, minimumCharge: cents(minimumCharge) }
}

/**
 * How much a minimum charge adds to lines that total `linesTotal`: the
 * difference when they total less, nothing when they total the same or more.
 */
export function minimumTopUp(linesTotal: number, minimumCharge: number): number {
  const floor = cents(minimumCharge)
  const sum = cents(linesTotal)
  return floor > 0 && sum < floor ? cents(floor - sum) : 0
}

export interface AppliedMinimum {
  /** What was added to reach the minimum */
  topUp: number
  /** The business's minimum charge (the subtotal it tops up to) */
  minimumCharge: number
}

/**
 * A breakdown as it should be shown: the job's real lines, and the minimum
 * that was applied, if one was. The minimum is null when none was applied
 * (or its top-up is nothing), so nothing about a minimum can be shown then.
 */
export function splitMinimum<T extends BreakdownLike>(breakdown: readonly T[] | null | undefined): { lines: T[]; minimum: AppliedMinimum | null } {
  const all = breakdown ?? []
  const lines = all.filter((item) => !isMinimumEntry(item))
  const entries = all.filter((item) => isMinimumEntry(item))
  const topUp = cents(entries.reduce((sum, item) => sum + (Number(item.amount) || 0), 0))
  if (entries.length === 0 || topUp <= 0) return { lines, minimum: null }
  const stated = entries.find((item) => typeof item.minimumCharge === 'number' && item.minimumCharge > 0)?.minimumCharge
  // An entry stored before the marker has no stated minimum: it is what the lines and the top-up add up to
  const minimumCharge = cents(stated ?? lines.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) + topUp)
  return { lines, minimum: { topUp, minimumCharge } }
}

/** The one sentence. `amount` is the minimum charge, already formatted in the quote's currency. */
export function minimumChargeNote(amount: string): string {
  return `Minimum charge of ${amount} applied`
}

/**
 * The engine used to put that sentence among a quote's notes as well, where it
 * showed a second time ("Worth knowing"). Stored quotes still have it there.
 */
export function isMinimumNote(note: unknown): boolean {
  return typeof note === 'string' && /^minimum charge of .+ applied\.?$/i.test(note.trim())
}

/** A quote's notes without the minimum sentence (it is shown once, above the total) */
export function withoutMinimumNote<T>(notes: readonly T[] | null | undefined): T[] {
  return (notes ?? []).filter((note) => !isMinimumNote(note))
}

/**
 * Cross-service suggestions keep their breakdown as plain sentences. A stored
 * one may read "Minimum charge: $400.00" (it replaced every line): show it as
 * the same note.
 */
export function crossServiceLine(line: string): string {
  const stored = /^minimum charge:\s*(.+)$/i.exec(line.trim())
  return stored ? minimumChargeNote(stored[1]!) : line
}

/**
 * The breakdown to store when the business saves an edited quote.
 *
 * `before` is what the quote holds; `after` is what the editor sent. The
 * editor sends the job's lines and, while the minimum still applies, one
 * entry marked as the minimum. This decides what is stored, so a quote's
 * floor can never be invented or mis-added by a client:
 *
 * - Only a quote that already carries a minimum can have one. A marked entry
 *   sent for a quote without one is dropped.
 * - The minimum charge is the stored one, never the amount the client sent.
 *   The top-up is worked out again from the lines that were sent, so the
 *   lines plus the entry always equal the minimum.
 * - No entry when the lines now total the minimum or more.
 * - No marked entry sent means the business removed the minimum from this
 *   quote (or the lines reached it): none is stored, and because the stored
 *   quote then carries none, it stays removed on later edits.
 *
 * In `after` only the marker counts, not the label: a line the business typed
 * is theirs, whatever it says. (A client from before this change sends the
 * old line unmarked; it is stored as it was.)
 */
export function editedBreakdown<T extends BreakdownLike>(
  before: readonly BreakdownLike[] | null | undefined,
  after: readonly T[]
): Array<T | MinimumEntry> {
  const marked = after.some((item) => item.kind === MINIMUM_ENTRY_KIND)
  if (!marked) return [...after]
  const lines = after.filter((item) => item.kind !== MINIMUM_ENTRY_KIND)
  const stored = splitMinimum(before).minimum
  if (!stored) return lines
  const topUp = minimumTopUp(lines.reduce((sum, item) => sum + cents(item.amount), 0), stored.minimumCharge)
  return topUp > 0 ? [...lines, minimumEntry(topUp, stored.minimumCharge)] : lines
}
