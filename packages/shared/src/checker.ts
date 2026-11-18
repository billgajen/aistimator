import { splitMinimum } from './minimum-charge'

/**
 * T-172: how a row of the quote checker's log (`quote_validation_logs`) is
 * marked, in `input_snapshot.serviceConfigVersion`.
 *
 * Until T-172 the checker was not told the business's minimum charge, base
 * fee, tax or currency, so it could flag a correct quote. Those rows are
 * marked 'v1'. From T-172 the worker tells it, and writes this marker; the
 * dashboard shows a checker finding only from a row that carries it.
 */
export const CHECKER_SETTINGS_VERSION = 'v2'


const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * A finding the quote itself proves wrong is not shown.
 *
 * On a quote where the pricing engine applied the business's minimum charge,
 * the checker has reported "an unconfigured minimum charge was added" or "an
 * invented fee". The breakdown carries the engine's own marked minimum entry
 * (minimum-charge.ts), which is the business's setting: the code knows the
 * finding is false, and a false warning teaches a business to ignore the
 * rest. Nothing else is filtered, and the checker and its log are untouched.
 */
function contradictedByTheQuote(issue: Record<string, unknown>, minimumApplied: boolean): boolean {
  if (!minimumApplied) return false
  return /\bminimum\b/i.test(text(issue.description)) || /invented fee/i.test(text(issue.check))
}

/**
 * T-169, shared since T-183: the quote checker's findings as the business
 * reads them, on the dashboard, the approval page and the review email. One
 * sentence each, no repeats, and none the quote proves wrong. The checker
 * changes nothing on a quote (AD-049); these are notes.
 *
 * `issues` is the checker's own list (`validation_result.issues`);
 * `breakdown` the quote's price lines. Pure.
 */
export function checkerFindings(issues: unknown, breakdown: unknown): string[] {
  const lines = (Array.isArray(breakdown) ? breakdown.filter(isRecord) : []).map((line) => ({
    ...line,
    label: text(line.label),
    amount: Number(line.amount) || 0,
  }))
  const minimumApplied = splitMinimum(lines).minimum !== null
  const out: string[] = []
  const seen = new Set<string>()
  for (const issue of Array.isArray(issues) ? issues.filter(isRecord) : []) {
    const description = text(issue.description)
    if (!description || seen.has(description)) continue
    if (contradictedByTheQuote(issue, minimumApplied)) continue
    seen.add(description)
    out.push(description.charAt(0).toUpperCase() + description.slice(1))
  }
  return out
}
