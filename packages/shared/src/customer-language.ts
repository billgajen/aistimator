/**
 * T-146: customer-facing language guard — pure, no IO.
 *
 * Grades and confidence are business-only. Nothing a customer sees (quote
 * page, widget, emails, the public quote API) may carry a grade, a grade
 * label, or words that claim or deny certainty about the price. The customer
 * sees exactly two states: an Estimate (not yet reviewed) and a Quote
 * (reviewed and confirmed by the business).
 *
 * Used by the gauntlet (every public quote payload) and by unit tests over the
 * customer-facing source files.
 */

/** Words that describe price certainty — never shown to a customer */
export const CUSTOMER_BANNED_WORDS = ['exact', 'firm', 'preliminary', 'guaranteed', 'guarantee'] as const

/** Grade labels (shared/grading.ts) — never shown to a customer */
export const CUSTOMER_BANNED_LABELS = ['Confirmed', 'Measured', 'Concept', 'Provisional'] as const

const WORD_RE = new RegExp(`\\b(${CUSTOMER_BANNED_WORDS.join('|')})\\b`, 'i')
const GRADE_RE = /\bgrade\s*[ABC]\b|\bconfidence\b/i

/** Problems in one piece of customer-facing text (empty = clean). */
export function findConfidenceLanguage(text: string): string[] {
  const problems: string[] = []
  const word = WORD_RE.exec(text)
  if (word) problems.push(`"${word[1]}" in: ${snippet(text, word.index)}`)
  const grade = GRADE_RE.exec(text)
  if (grade) problems.push(`"${grade[0]}" in: ${snippet(text, grade.index)}`)
  return problems
}

/**
 * Walk a customer-facing payload (e.g. the public quote API response): every
 * string value is checked, a `grade` key or a value that IS a grade label is
 * a problem. Keys are not text the customer reads, so only `grade` matters.
 */
export function findConfidenceLanguageInPayload(payload: unknown, path = '$'): string[] {
  if (typeof payload === 'string') {
    const problems = findConfidenceLanguage(payload).map((p) => `${path}: ${p}`)
    if ((CUSTOMER_BANNED_LABELS as readonly string[]).includes(payload.trim())) problems.push(`${path}: grade label "${payload}"`)
    return problems
  }
  if (Array.isArray(payload)) return payload.flatMap((v, i) => findConfidenceLanguageInPayload(v, `${path}[${i}]`))
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === 'grade' ? [`${path}.grade: grade present`] : []),
      ...findConfidenceLanguageInPayload(v, `${path}.${k}`),
    ])
  }
  return []
}

function snippet(text: string, at: number): string {
  const start = Math.max(0, at - 30)
  return `…${text.slice(start, at + 40).replace(/\s+/g, ' ')}…`
}
