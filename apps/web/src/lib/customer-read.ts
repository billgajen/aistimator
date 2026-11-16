/**
 * T-171: what was read or measured for a quote, in the customer's terms.
 *
 * The customer's quote page shows these lines and nothing else of the kind:
 *   "From your tank's rating label: 50 gal, Natural gas"
 *   "From your photos: about 919 sq ft (Exterior walls)"
 * A line appears only when the thing is in the quote: a label reading the
 * customer confirmed (or that was used as it was read), a quantity a priced
 * line took from the photos or from an on-site scan. A reading the customer
 * corrected is not shown, because the quote uses their answer, not the reading.
 *
 * Never an amount, never the words read off the label, never how the reading
 * was made (passes, spread, model numbers): those are the business's
 * (lib/quote-understanding.ts). Never a word a customer must not see
 * (packages/shared/src/customer-language.ts).
 *
 * Pure. Nothing here is logged.
 */
import { findConfidenceLanguage, formatNumber, unitDisplayLabel } from '@qolumns/shared'

/**
 * The audit line the pipeline writes for a label reading
 * (shared/identification.ts): `Read from <where> (photo N): "<words>" → <value> (<rule>)`
 * or, with no transcription, `Read from <where>: <value>`.
 */
const READING = /^Read from (.+?)(?: \(photo (\d+)\))?: (?:"(.*)" → )?(.+)$/

export interface LabelReading {
  /** Where it was read, as the pipeline names it: "the tank's rating label" */
  where: string
  /** What it came to: "50 gal" */
  value: string
}

/** A label reading taken apart, or null when the text is not one */
export function parseReading(evidence: unknown): LabelReading | null {
  if (typeof evidence !== 'string') return null
  const m = READING.exec(evidence.trim())
  if (!m) return null
  const [, where = '', , , rest = ''] = m
  // the rule's name in brackets says how the words became the value; the value is enough
  const value = rest.replace(/ \([^()]*\)$/, '').trim()
  return where && value ? { where, value } : null
}

/** "the tank's rating label" as the customer's own: "your tank's rating label" */
export function yourPlace(where: string): string {
  const w = where.trim()
  return /^the /i.test(w) ? `your ${w.slice(4)}` : w
}

/**
 * The one sentence the customer is asked about a label reading: no label
 * text, no arrow. The marketing screens show the same sentence
 * (lib/marketing/screen-words.ts).
 */
export function readingQuestion(value: string, where: string): string {
  return `We read ${value} from ${yourPlace(where)}. Is that right?`
}

/** Takeoff methods that say a quantity was measured, not given or fixed (apps/worker/src/takeoff.ts) */
const FROM_PHOTOS = 'From your photos'
const FROM_SCAN = 'From the on-site room scan'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

export interface CustomerReadInput {
  signals: unknown
  questions: unknown
  answers: unknown
  takeoff: unknown
  locale: string
}

/** The lines for the customer's quote page; empty when nothing was read or measured */
export function customerReadLines(input: CustomerReadInput): string[] {
  const signals = list(isRecord(input.signals) ? input.signals.signals : null)
  const questions = list(input.questions)
  const answers = list(input.answers)
  const takeoff = list(input.takeoff)

  // ---- label readings, grouped by the label they came from -------------------
  const byPlace = new Map<string, string[]>()
  const seen = new Set<string>()
  const add = (reading: LabelReading | null) => {
    if (!reading) return
    const key = `${reading.where}|${reading.value}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    byPlace.set(reading.where, [...(byPlace.get(reading.where) ?? []), reading.value])
  }
  // a reading the customer was asked about counts only when they said it was right
  const asked = new Set<string>()
  for (const q of questions) {
    const reading = parseReading(q.evidence)
    if (!reading) continue
    const key = text(q.targetSignalKey)
    if (key) asked.add(key)
    const answer = answers.find((a) => a.questionId === q.id)
    if (answer && text(answer.answer) === text(q.aiValue)) add({ where: reading.where, value: text(q.aiValue) || reading.value })
  }
  // a reading that was used as it was read (nobody was asked about it)
  for (const s of signals) {
    if (s.basis !== 'identified' || asked.has(text(s.key))) continue
    add(parseReading(s.evidence))
  }
  const lines: string[] = []
  for (const [where, values] of byPlace) lines.push(`From ${yourPlace(where)}: ${values.join(', ')}`)

  // ---- quantities a priced line took from the photos or a scan ----------------
  for (const row of takeoff) {
    const method = text(row.method)
    const quantity = typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? row.quantity : null
    if (quantity === null || (method !== FROM_PHOTOS && method !== FROM_SCAN)) continue
    const unit = text(row.unit)
    const amount = `${formatNumber(Math.round(quantity * 10) / 10, input.locale)}${unit ? ` ${unitDisplayLabel(unit)}` : ''}`
    const item = text(row.item)
    // a photo measurement is "about"; a scan is the room as it was measured
    lines.push(`${method}: ${method === FROM_PHOTOS ? 'about ' : ''}${amount}${item ? ` (${item})` : ''}`)
  }

  // nothing a customer must not see, and never an amount of money
  return lines.filter((line) => findConfidenceLanguage(line).length === 0 && !/[$£€¥]\s?\d|\d\s?(USD|GBP|EUR)\b/.test(line))
}
