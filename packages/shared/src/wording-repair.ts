/**
 * T-148: repair banned customer words in generated wording — pure, no IO.
 *
 * The wording prompt asks the model not to describe price certainty, but a
 * prompt is not a guarantee. This runs the customer language guard
 * (`customer-language.ts`) over every piece of AI-generated text a customer
 * can read and repairs it in a fixed order:
 *
 *   a. rewrite: the offending sentences go to a rewriter (one model call,
 *      supplied by the caller); a rewrite is kept only if it passes the guard,
 *      is not empty and adds no numbers the sentence did not have (AD-001:
 *      wording only, never a price);
 *   b. remove: any sentence that still trips is removed;
 *   c. unresolved: what removal cannot fix (the scope summary would be left
 *      empty). The caller holds the quote for the business.
 *
 * Text the business typed itself (service description, scope, assumptions,
 * add-on and step names) is never rewritten or removed: those phrases are
 * masked before the guard runs, so a sentence that trips only because it
 * quotes the business is left alone.
 */

import { findConfidenceLanguage } from './customer-language'

/** The generated wording a customer can read. Every field is optional. */
export interface CustomerWording {
  scopeSummary?: string
  assumptions?: string[]
  exclusions?: string[]
  notes?: string
  signalRecommendations?: Array<{ workDescription?: string; costBreakdown?: string; evidence?: string }>
  crossServicePricing?: Array<{ reason?: string; note?: string; extractedDetails?: string[] }>
}

/** One sentence that trips the guard. `id` is stable within one repair run. */
export interface OffendingSentence {
  id: string
  field: string
  sentence: string
  problems: string[]
}

/** Where the repair ran: first pass (may rewrite), reprice or approval (remove only). */
export type WordingRepairPath = 'generation' | 'reprice' | 'approval'

/** Business-only record, kept in `pricing_trace_json.wordingRepair`. */
export interface WordingRepairRecord {
  path: WordingRepairPath
  checkedAt: string
  /** The offending sentences found (before any repair) */
  found: number
  /** Whether a rewrite model call was made */
  rewriteCalled: boolean
  /** Why the rewrite call was not usable, when it failed */
  rewriteError?: string
  rewritten: Array<{ field: string; before: string; after: string }>
  removed: Array<{ field: string; text: string }>
  /** Problems left after removal; non-empty means the quote is held */
  unresolved: string[]
}

/** Rewrites keyed by `OffendingSentence.id`. Missing ids = no rewrite. */
export type SentenceRewriter = (sentences: OffendingSentence[]) => Promise<Record<string, string>>

export interface WordingRepairResult<T extends CustomerWording> {
  wording: T
  record: WordingRepairRecord
  /** Same as record.unresolved: non-empty means hold for the business */
  unresolved: string[]
}

// ---------- business text ----------

/**
 * Phrases the business typed, from its service configuration. Short phrases
 * (under 3 characters) are ignored so a stray letter can't mask anything.
 */
export function businessPhrasesFrom(source: {
  serviceName?: string | null
  serviceDescription?: string | null
  scopeIncludes?: readonly string[] | null
  scopeExcludes?: readonly string[] | null
  defaultAssumptions?: readonly string[] | null
  addonLabels?: readonly string[] | null
  workStepNames?: readonly string[] | null
}): string[] {
  const all = [
    source.serviceName,
    source.serviceDescription,
    ...(source.scopeIncludes ?? []),
    ...(source.scopeExcludes ?? []),
    ...(source.defaultAssumptions ?? []),
    ...(source.addonLabels ?? []),
    ...(source.workStepNames ?? []),
  ]
  const phrases = new Set<string>()
  for (const raw of all) {
    if (typeof raw !== 'string') continue
    const whole = raw.trim()
    if (whole.length >= 3) phrases.add(whole)
    // The wording often quotes one sentence of a longer business text
    for (const sentence of splitSentences(whole)) if (sentence.length >= 3) phrases.add(sentence)
  }
  // Longest first, so a long phrase masks before a shorter one inside it
  return [...phrases].sort((a, b) => b.length - a.length)
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Replace business phrases (case-insensitive, flexible whitespace) with a neutral token. */
export function maskBusinessText(text: string, businessPhrases: readonly string[]): string {
  let masked = text
  for (const phrase of businessPhrases) {
    const pattern = escapeRegExp(phrase.replace(/[.!?]+$/, '')).replace(/\s+/g, '\\s+')
    masked = masked.replace(new RegExp(pattern, 'gi'), ' BIZTEXT ')
  }
  return masked
}

/** Guard problems in generated text, ignoring what the business wrote itself. */
export function generatedTextProblems(text: string, businessPhrases: readonly string[]): string[] {
  return findConfidenceLanguage(maskBusinessText(text, businessPhrases))
}

// ---------- sentences ----------

/** Split prose into sentences (keeps the end punctuation). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const joinSentences = (sentences: string[]) => sentences.join(' ').trim()

/** Numbers in a text (digits, ignoring separators), for the "adds no numbers" rule. */
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]+$/, '').replace(/,/g, ''))
}

/**
 * Is a rewrite usable? It must pass the guard, be non-empty, stay roughly the
 * same length, and contain no number the original sentence did not have.
 */
export function isAcceptableRewrite(original: string, rewrite: string | undefined, businessPhrases: readonly string[]): boolean {
  if (typeof rewrite !== 'string') return false
  const text = rewrite.trim()
  if (!text || text.length > original.length * 2 + 40) return false
  if (generatedTextProblems(text, businessPhrases).length > 0) return false
  const allowed = new Set(numbersIn(original))
  return numbersIn(text).every((n) => allowed.has(n))
}

// ---------- the text slots of a CustomerWording ----------

interface Slot {
  field: string
  get: () => string | undefined
  set: (value: string | undefined) => void
  /** Removing all of it is not allowed (the quote would have no scope) */
  required?: boolean
}

function slotsOf(w: CustomerWording): Slot[] {
  const slots: Slot[] = []
  const scalar = (field: string, key: 'scopeSummary' | 'notes', required = false) => {
    if (typeof w[key] !== 'string') return
    slots.push({ field, get: () => w[key], set: (v) => { w[key] = v ?? '' }, required })
  }
  const list = (field: string, arr: string[] | undefined) => {
    if (!Array.isArray(arr)) return
    arr.forEach((_, i) => {
      if (typeof arr[i] !== 'string') return
      slots.push({ field: `${field}[${i}]`, get: () => arr[i], set: (v) => { arr[i] = v ?? '' } })
    })
  }
  scalar('scopeSummary', 'scopeSummary', true)
  list('assumptions', w.assumptions)
  list('exclusions', w.exclusions)
  scalar('notes', 'notes')
  w.signalRecommendations?.forEach((rec, i) => {
    for (const key of ['workDescription', 'costBreakdown', 'evidence'] as const) {
      if (typeof rec[key] !== 'string') continue
      slots.push({ field: `signalRecommendations[${i}].${key}`, get: () => rec[key], set: (v) => { rec[key] = v ?? '' } })
    }
  })
  w.crossServicePricing?.forEach((cs, i) => {
    for (const key of ['reason', 'note'] as const) {
      if (typeof cs[key] !== 'string') continue
      slots.push({ field: `crossServicePricing[${i}].${key}`, get: () => cs[key], set: (v) => { cs[key] = v ?? '' } })
    }
    list(`crossServicePricing[${i}].extractedDetails`, cs.extractedDetails)
  })
  return slots
}

/** Every offending sentence in the generated wording (business phrases masked). */
export function findOffendingSentences(wording: CustomerWording, businessPhrases: readonly string[]): OffendingSentence[] {
  const out: OffendingSentence[] = []
  for (const slot of slotsOf(wording)) {
    const text = slot.get()
    if (!text) continue
    splitSentences(text).forEach((sentence, i) => {
      const problems = generatedTextProblems(sentence, businessPhrases)
      if (problems.length > 0) out.push({ id: `${slot.field}#${i}`, field: slot.field, sentence, problems })
    })
  }
  return out
}

/** Drop empty list items and recommendations left with no description. */
function compact(w: CustomerWording): void {
  if (w.assumptions) w.assumptions = w.assumptions.filter((s) => s.trim())
  if (w.exclusions) w.exclusions = w.exclusions.filter((s) => s.trim())
  if (w.signalRecommendations) w.signalRecommendations = w.signalRecommendations.filter((r) => (r.workDescription ?? '').trim())
  w.crossServicePricing?.forEach((cs) => {
    if (cs.extractedDetails) cs.extractedDetails = cs.extractedDetails.filter((s) => s.trim())
  })
}

/**
 * Repair the generated wording. Pass `rewrite` only on the first pass: the
 * reprice and approval paths run no AI, so they go straight to removal. The
 * input is not mutated; the repaired copy is returned.
 */
export async function repairCustomerWording<T extends CustomerWording>(
  input: T,
  opts: {
    businessPhrases: readonly string[]
    path: WordingRepairPath
    rewrite?: SentenceRewriter
    now?: () => Date
  }
): Promise<WordingRepairResult<T>> {
  // Plain JSON data (stored in content_json), so a JSON round-trip is a full copy
  const wording = JSON.parse(JSON.stringify(input)) as T
  const { businessPhrases } = opts
  const record: WordingRepairRecord = {
    path: opts.path,
    checkedAt: (opts.now?.() ?? new Date()).toISOString(),
    found: 0,
    rewriteCalled: false,
    rewritten: [],
    removed: [],
    unresolved: [],
  }

  const offending = findOffendingSentences(wording, businessPhrases)
  record.found = offending.length
  if (offending.length === 0) return { wording, record, unresolved: [] }

  // a. one rewrite call for all offending sentences
  let rewrites: Record<string, string> = {}
  if (opts.rewrite) {
    record.rewriteCalled = true
    try {
      rewrites = await opts.rewrite(offending)
    } catch (error) {
      record.rewriteError = error instanceof Error ? error.message : String(error)
    }
  }

  // Apply rewrites (a) and removals (b) slot by slot
  const bySlot = new Map<string, OffendingSentence[]>()
  for (const o of offending) bySlot.set(o.field, [...(bySlot.get(o.field) ?? []), o])
  for (const slot of slotsOf(wording)) {
    const hits = bySlot.get(slot.field)
    if (!hits) continue
    const sentences = splitSentences(slot.get() ?? '')
    const kept: string[] = []
    sentences.forEach((sentence, i) => {
      const hit = hits.find((h) => h.id === `${slot.field}#${i}`)
      if (!hit) return kept.push(sentence)
      const rewrite = rewrites[hit.id]
      if (isAcceptableRewrite(sentence, rewrite, businessPhrases)) {
        const after = rewrite!.trim()
        record.rewritten.push({ field: slot.field, before: sentence, after })
        kept.push(after)
      } else {
        record.removed.push({ field: slot.field, text: sentence })
      }
    })
    const next = joinSentences(kept)
    if (!next && slot.required) {
      // c. removal would leave no scope: keep the text, hold for the business
      record.removed = record.removed.filter((r) => r.field !== slot.field)
      record.unresolved.push(...hits.flatMap((h) => h.problems.map((p) => `${slot.field}: ${p}`)))
      continue
    }
    slot.set(next)
  }
  compact(wording)

  // Re-check: anything still tripping is unresolved
  for (const o of findOffendingSentences(wording, businessPhrases)) {
    const line = `${o.field}: ${o.problems[0]}`
    if (!record.unresolved.includes(line)) record.unresolved.push(line)
  }
  return { wording, record, unresolved: record.unresolved }
}
