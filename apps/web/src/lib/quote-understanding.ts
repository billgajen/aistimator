/**
 * T-169: "What Qolumns understood" on the dashboard quote page.
 *
 * Pure. It reads only what the pipeline stored for this quote and words it
 * plainly for the business. Nothing is made up and nothing is padded: a quote
 * the AI produced nothing for gets an empty result, and the page shows no
 * panel (Docs/design/ai-capabilities.md is the list of what can appear).
 *
 *   photos     a label it read (the words it read them from), a quantity it
 *              measured from the photos, a note about condition or access
 *   words      an extra it picked up from the customer's own words, which the
 *              pricing engine added at the business's price (AD-001)
 *   alsoNoted  work the customer may also need, with no price
 *   asked      the question the customer was asked, and their answer
 *   checks     the quote checker's findings, as "Worth checking". The checker
 *              changes nothing on a quote (AD-049); these are notes. One
 *              kind is left out because the quote itself proves it wrong
 *              (see `contradictedByTheQuote`). SWITCHED OFF today: see
 *              `SHOW_WORTH_CHECKING`
 *
 * No customer contact detail is read here, and nothing here is logged.
 */

import { splitMinimum } from '@qolumns/shared'
import type { QuoteUnderstanding, UnderstoodItem, UnderstoodQuestion } from '@qolumns/shared'

export type { QuoteUnderstanding, UnderstoodItem, UnderstoodQuestion }

/**
 * The "Worth checking" group is off (owner's decision, T-169).
 *
 * The quote checker is not told the business's minimum charge, base fee, tax
 * or currency, so some of its findings are wrong, and a warning that is
 * sometimes wrong teaches a business to ignore the panel. While this is
 * false no finding is built, sent to the page or shown, and the checker's log
 * is not read for the quote page. The checker itself runs and logs as before.
 *
 * Switch it on only after the worker tells the checker those four things
 * (OWNER-TODO.md, T-169).
 */
export const SHOW_WORTH_CHECKING = false as boolean

export interface UnderstandingInput {
  /** How many photos the customer sent. Notes "from the photos" need at least one. */
  photoCount: number
  signals: unknown
  content: unknown
  pricing: unknown
  questions: unknown
  answers: unknown
  /** The service's expected signals, for a measured quantity's plain name */
  expectedSignals: unknown
  /** The newest quote checker run for this quote, if it found anything */
  checker: { issues: unknown; checkedTotal: unknown } | null
}

/** Every word the panel shows that is not the pipeline's own */
export const UNDERSTOOD_COPY = {
  title: 'What Qolumns understood',
  intro: 'What the AI read for this request. Every price is from your price list.',
  photosTitle: 'From the photos',
  wordsTitle: 'From what the customer wrote',
  alsoNotedTitle: 'May also be needed (no price added)',
  askedTitle: 'Asked the customer',
  checksTitle: 'Worth checking',
  checksNote: 'An automatic check noted these. It changed nothing on the quote.',
  checksBeforeChange: 'These were noted on the first price. The quote has changed since.',
  noAnswer: 'No answer yet',
  answered: 'They answered',
  photoStripTitle: 'Photos from the customer',
  reading: (from: string, value: string) => `From ${from}: ${value}`,
  readingWords: (words: string, photo: string | null) => `It read “${words}”${photo ? ` in photo ${photo}` : ''}.`,
  measured: (value: string, name: string | null) => `From the photos: about ${value}${name ? ` (${name})` : ''}`,
  noted: (note: string) => `Noted from the photos: ${note}`,
  extra: (label: string) => `Picked up from their words: ${label}. Added at your price.`,
  extraFromPhotos: (label: string) => `Picked up from the photos: ${label}. Added at your price.`,
} as const

/** The most notes of one kind the panel lists: it is a summary, not the trace */
const MAX_NOTES = 4

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function sentence(s: string): string {
  const t = s.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/** "919.1", "1,250", "50 gal": a stored value as the business reads it */
function valueWords(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return (Math.round(v * 10) / 10).toLocaleString('en-US')
  return text(v)
}

/**
 * The audit line the pipeline writes for a label reading
 * (shared/identification.ts): `Read from <where> (photo N): "<words>" → <value> (<rule>)`
 * or, with no transcription, `Read from <where>: <value>`.
 */
const READING = /^Read from (.+?)(?: \(photo (\d+)\))?: (?:"(.*)" → )?(.+)$/
const isReading = (evidence: string) => evidence.startsWith('Read from ')
const isMeasurement = (evidence: string) => evidence.startsWith('Measured across ') || evidence.startsWith('Senior review of ')

function readingItem(evidence: string): UnderstoodItem {
  const m = READING.exec(evidence)
  if (!m) return { text: evidence }
  const [, from = '', photo, words, rest = ''] = m
  // The rule's name in brackets says how the words became the value; the value is enough here
  const value = rest.replace(/ \([^()]*\)$/, '').trim()
  return {
    text: UNDERSTOOD_COPY.reading(from, value),
    ...(words ? { detail: UNDERSTOOD_COPY.readingWords(words, photo ?? null) } : {}),
  }
}

/** The first sentence of an expected signal's description, as a short name */
function signalName(expectedSignals: unknown, key: string): string | null {
  const spec = list(expectedSignals).find((s) => s.signalKey === key)
  const description = text(spec?.description)
  if (!description) return null
  const first = description.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, '').trim()
  if (!first) return null
  return first.charAt(0).toLowerCase() + first.slice(1)
}

/**
 * A finding the quote itself proves wrong is not shown.
 *
 * The checker is given the service's work steps, extras and adjustments, but
 * not the business's minimum charge. So on a quote where the pricing engine
 * applied that minimum, it reports "an unconfigured minimum charge was
 * added" or "an invented fee". The breakdown carries the engine's own marked
 * minimum entry (shared/minimum-charge.ts), which is the business's setting:
 * the code knows the finding is false, and a false warning would teach the
 * business to ignore the panel. Nothing else is filtered, and the checker and
 * its log are untouched (the root fix is to tell the checker the minimum).
 */
function contradictedByTheQuote(issue: Record<string, unknown>, minimumApplied: boolean): boolean {
  if (!minimumApplied) return false
  return /\bminimum\b/i.test(text(issue.description)) || /invented fee/i.test(text(issue.check))
}

export function quoteUnderstanding(
  input: UnderstandingInput,
  /** `worthChecking` overrides the flag: the unit tests hold the group's rules while it is off */
  options: { worthChecking?: boolean } = {}
): QuoteUnderstanding {
  const worthChecking = options.worthChecking ?? SHOW_WORTH_CHECKING
  const signals = list(isRecord(input.signals) ? input.signals.signals : null)
  const questions = list(input.questions)
  const answers = list(input.answers)
  const content = isRecord(input.content) ? input.content : {}
  const pricing = isRecord(input.pricing) ? input.pricing : {}

  // ---- From the photos ------------------------------------------------------
  const photos: UnderstoodItem[] = []
  const seen = new Set<string>()
  const addPhoto = (key: string, item: UnderstoodItem) => {
    if (seen.has(key)) return
    seen.add(key)
    photos.push(item)
  }

  // Label readings. After the customer confirms one, the signal holds their
  // answer, so the reading itself is taken from the question and the takeoff too.
  const readings = [
    ...signals.filter((s) => s.basis === 'identified').map((s) => text(s.evidence)),
    ...questions.map((q) => text(q.evidence)),
    ...list(content.takeoff).map((t) => text(t.evidence)),
  ].filter(isReading)
  for (const evidence of readings) addPhoto(evidence, readingItem(evidence))

  // Quantities measured from the photos (one per signal: the stored signal, or
  // the confirm question that showed it to the customer)
  const measured = new Map<string, { value: unknown; evidence: string }>()
  for (const s of signals) {
    const key = text(s.key)
    if (key && (s.basis === 'measured' || s.basis === 'adjudicated') && isMeasurement(text(s.evidence))) {
      measured.set(key, { value: s.value, evidence: text(s.evidence) })
    }
  }
  for (const q of questions) {
    const key = text(q.targetSignalKey)
    if (key && !measured.has(key) && isMeasurement(text(q.evidence)) && q.aiValue !== undefined) {
      measured.set(key, { value: q.aiValue, evidence: text(q.evidence) })
    }
  }
  for (const [key, m] of measured) {
    const value = valueWords(m.value)
    if (!value) continue
    addPhoto(`measured:${key}`, { text: UNDERSTOOD_COPY.measured(value, signalName(input.expectedSignals, key)), detail: `${sentence(m.evidence)}.` })
  }

  // Notes about what the photos show. Only with photos, only what the photo
  // reading wrote in words (a bare "12 sqm" or "3 items" is not a note).
  if (input.photoCount > 0) {
    let notes = 0
    for (const s of signals) {
      if (notes >= MAX_NOTES) break
      if (s.source !== 'vision' || s.basis) continue
      const evidence = text(s.evidence)
      if (evidence.split(/\s+/).length < 4 || isReading(evidence) || isMeasurement(evidence)) continue
      const before = photos.length
      addPhoto(`note:${evidence.toLowerCase()}`, { text: UNDERSTOOD_COPY.noted(sentence(evidence).replace(/\.$/, '')) })
      if (photos.length > before) notes++
    }
  }

  // ---- From the customer's words ---------------------------------------------
  // An extra the pricing engine added because the customer's own words (or
  // photos) asked for it. Its amount is the business's price; none is shown here.
  const words: UnderstoodItem[] = []
  for (const line of list(pricing.breakdown)) {
    if (line.autoRecommended !== true) continue
    const label = text(line.label)
    if (!label) continue
    const fromPhotos = /photo/i.test(text(line.recommendationReason)) && !/description/i.test(text(line.recommendationReason))
    if (fromPhotos) addPhoto(`extra:${label}`, { text: UNDERSTOOD_COPY.extraFromPhotos(label) })
    else words.push({ text: UNDERSTOOD_COPY.extra(label) })
  }

  // ---- Work the customer may also need (never a price) ------------------------
  const alsoNoted: UnderstoodItem[] = []
  for (const rec of list(content.signalRecommendations).slice(0, MAX_NOTES)) {
    const work = text(rec.workDescription)
    if (!work) continue
    const why = text(rec.evidence)
    alsoNoted.push({ text: sentence(work), ...(why ? { detail: sentence(why) } : {}) })
  }

  // ---- The question and the answer --------------------------------------------
  const asked: UnderstoodQuestion[] = []
  for (const q of questions) {
    const question = text(q.question)
    if (!question) continue
    const answer = answers.find((a) => a.questionId === q.id)
    const said = answer ? valueWords(answer.answer) : ''
    asked.push({ question, answer: said || null })
  }

  // ---- The quote checker's findings (AD-049: notes only) ----------------------
  const checks: UnderstoodItem[] = []
  const seenChecks = new Set<string>()
  const minimumApplied =
    splitMinimum(list(pricing.breakdown).map((line) => ({ ...line, label: text(line.label), amount: Number(line.amount) || 0 }))).minimum !== null
  for (const issue of worthChecking ? list(input.checker?.issues) : []) {
    const description = text(issue.description)
    if (!description || seenChecks.has(description)) continue
    if (contradictedByTheQuote(issue, minimumApplied)) continue
    seenChecks.add(description)
    checks.push({ text: sentence(description) })
  }
  const checkedTotal = input.checker?.checkedTotal
  const total = pricing.total
  const checksBeforeChange =
    checks.length > 0 && typeof checkedTotal === 'number' && typeof total === 'number' && Math.abs(checkedTotal - total) >= 0.005

  return { photos, words, alsoNoted, asked, checks, checksBeforeChange }
}

/** True when the AI produced nothing for this quote: the page then shows no panel (the customer's photos still show) */
export function understoodNothing(u: QuoteUnderstanding): boolean {
  return u.photos.length + u.words.length + u.alsoNoted.length + u.asked.length + u.checks.length === 0
}
