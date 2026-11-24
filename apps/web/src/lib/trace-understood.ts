/**
 * T-201: "What Qolumns understood" on the pricing trace page, as lines a
 * business can read. Until T-201 the page printed the stored record as it is
 * kept ("Extracted Signals", a block of JSON).
 *
 * Pure. It reads only what the pipeline stored for this quote
 * (`quotes.signals_json`) and words it plainly: what each thing is, its
 * value, where it came from and, when there is one, the note the pipeline
 * kept about it. Nothing is added, nothing is guessed, and no customer
 * contact detail is in the record it reads. The quote page's own panel of the
 * same name (lib/quote-understanding.ts) is the summary; this is every item.
 */

export interface UnderstoodLine {
  /** What it is: "Wall area" */
  name: string
  /** "919.1", "Yes", "Two storey" */
  value: string
  /** Where it came from: "Measured from the photos" */
  from: string
  /** The pipeline's own note about it, when it kept one */
  note?: string
  /** "Likely between 800 and 1,000" for a quantity with a band */
  range?: string
  /** The pipeline marked it as one it was less sure of */
  unsure?: boolean
}

export interface UnderstoodTrace {
  lines: UnderstoodLine[]
  /** Short sentences about the job as a whole: its condition, what makes it harder, a visit */
  notes: string[]
}

export const TRACE_UNDERSTOOD_COPY = {
  title: 'What Qolumns understood',
  intro: 'What was read from the photos, the form and the customer’s words for this quote.',
  nothing: 'Nothing was read for this quote.',
  unsure: 'Less sure of this one',
  range: (low: string, high: string) => `Likely between ${low} and ${high}`,
} as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const number = (n: number): string => (Math.round(n * 100) / 100).toLocaleString('en-US')

/** A stored value as words: a number with commas, yes or no, the text itself */
export function valueWords(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return number(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  const words = text(v)
  if (!words) return ''
  // a stored choice such as "two_storey" or "needs-repair" reads as words; a sentence is left as it is
  return /^[a-z0-9]+([_-][a-z0-9]+)+$/i.test(words) ? sentenceCase(words.replace(/[_-]+/g, ' ')) : words
}

function sentenceCase(s: string): string {
  const t = s.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/** "wall_area_sqft" → "Wall area sqft": the stored key as words, when the service has no name for it */
export function keyWords(key: string): string {
  return sentenceCase(
    key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
  )
}

/** The service's own name for a signal: the first sentence of its description, else the key as words */
function nameOf(key: string, expectedSignals: unknown): string {
  const spec = list(expectedSignals).find((s) => s.signalKey === key)
  const description = text(spec?.description)
  const first = description.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, '').trim() ?? ''
  // a long description is a sentence, not a name
  return first && first.length <= 60 ? sentenceCase(first) : keyWords(key)
}

/** Where a value came from, in the business's words. `basis` says how a quantity was settled and wins over `source`. */
export function fromWords(source: unknown, basis: unknown): string {
  switch (basis) {
    case 'confirmed':
      return 'Confirmed by the customer'
    case 'measured':
      return 'Measured from the photos'
    case 'adjudicated':
      return 'Measured from the photos, then checked a second time'
    case 'identified':
      return 'Read from a label in a photo'
    case 'scanned':
      return 'Measured by the room scan'
    case 'envelope':
      return 'A typical size for this kind of job (not measured)'
  }
  switch (source) {
    case 'form':
      return 'From the form'
    case 'vision':
      return 'From the photos'
    case 'nlp':
    case 'text':
      return 'From what the customer wrote'
    case 'inferred':
      return 'Worked out from the other details'
    default:
      return 'From the request'
  }
}

/** Every stored item as a line, then what was noted about the job as a whole */
export function understoodTrace(signalsJson: unknown, expectedSignals?: unknown): UnderstoodTrace {
  const stored = isRecord(signalsJson) ? signalsJson : {}
  const unsureKeys = new Set(Array.isArray(stored.lowConfidenceSignals) ? stored.lowConfidenceSignals.filter((k): k is string => typeof k === 'string') : [])

  const lines: UnderstoodLine[] = []
  for (const signal of list(stored.signals)) {
    const key = text(signal.key)
    const value = valueWords(signal.value)
    if (!key || !value) continue
    const band = isRecord(signal.quantityBand) ? signal.quantityBand : null
    const low = band && typeof band.low === 'number' ? band.low : null
    const high = band && typeof band.high === 'number' ? band.high : null
    const note = text(signal.evidence)
    lines.push({
      name: nameOf(key, expectedSignals),
      value,
      from: fromWords(signal.source, signal.basis),
      ...(note && { note: sentenceCase(note) }),
      ...(low !== null && high !== null && high > low && { range: TRACE_UNDERSTOOD_COPY.range(number(low), number(high)) }),
      ...(unsureKeys.has(key) && { unsure: true }),
    })
  }

  // The older, looser parts of the record: only what they actually say
  const notes: string[] = []
  const dimensions = isRecord(stored.dimensions) ? stored.dimensions : null
  if (dimensions && typeof dimensions.value === 'number' && lines.length === 0) {
    const unit = text(dimensions.unit)
    notes.push(`Size: ${dimensions.isEstimate === true ? 'about ' : ''}${number(dimensions.value)}${unit ? ` ${unit}` : ''}`)
  }
  const condition = isRecord(stored.condition) ? stored.condition : null
  const rating = text(condition?.rating)
  if (condition && rating && rating !== 'unknown') {
    const detail = text(condition.notes)
    notes.push(`Condition: ${rating}${detail ? `. ${sentenceCase(detail)}` : ''}`)
  }
  const complexity = isRecord(stored.complexity) ? stored.complexity : null
  const level = text(complexity?.level)
  const factors = Array.isArray(complexity?.factors) ? complexity.factors.map(text).filter(Boolean) : []
  if (complexity && ((level && level !== 'unknown') || factors.length > 0)) {
    const difficulty = level && level !== 'unknown' ? `How hard the job looks: ${level}` : 'What could make the job harder'
    notes.push(factors.length > 0 ? `${difficulty} (${factors.join('; ')})` : difficulty)
  }
  if (stored.siteVisitRecommended === true) {
    const why = text(stored.siteVisitReason)
    notes.push(`A visit before the job is suggested${why ? `: ${why}` : ''}`)
  }

  return { lines, notes }
}

/** True when the record holds nothing a line can be made from: the page then says so in one sentence */
export function understoodTraceEmpty(trace: UnderstoodTrace): boolean {
  return trace.lines.length === 0 && trace.notes.length === 0
}
