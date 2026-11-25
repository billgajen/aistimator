/**
 * T-204: how a service's questions and price lines are linked, in one place.
 *
 * A business describes its prices ("$89 for each additional system", "add $45
 * if the system is in an attic", "refrigerant $95 per pound, only if needed")
 * and the result is price lines that depend on the customer's answers. Three
 * things here keep that honest, all in code and the same for every business:
 *
 *   1. `optionalNumberQuestions`: an optional number question left empty
 *      counts as 0, never 1. The pricing engine uses this for every service.
 *   2. `linkPricing`: after the AI has written a configuration, the links it
 *      left loose are tied where there is exactly one right answer, and
 *      "each additional" lines are made to count the answer minus one.
 *   3. `pricingChecks`: what is still loose is flagged for the business: a
 *      question that changes no price line, and a line whose words say it is
 *      conditional or per unit but which has no condition and no quantity.
 *
 * Pure. No trade, service name or price is known here: only the shape of the
 * configuration and a handful of plain English words ("if", "per", "each").
 */
import { extractFormulaIdentifiers } from './formula'

export interface LinkField {
  fieldId: string
  label?: string | null
  type?: string | null
  required?: boolean | null
  /** A question marked "needed for the price" is asked as a required one on the form */
  criticalForPricing?: boolean | null
  options?: ReadonlyArray<string | { value: string; label?: string | null }> | null
  mapsToSignal?: string | null
}

export interface LinkStep {
  id: string
  name: string
  description?: string | null
  costType?: string | null
  optional?: boolean | null
  triggerSignal?: string | null
  triggerCondition?: { operator?: string; value?: string | number | boolean } | null
  when?: { fieldId?: string; operator?: string; equals?: string | number | boolean; value?: string | number } | null
  quantitySource?: { type?: string; fieldId?: string; signalKey?: string; formula?: string; value?: number; missingMeansZero?: boolean } | null
}

export interface LinkMultiplier {
  when?: { subject?: string; fieldId?: string } | null
}

const isNumberQuestion = (field: LinkField): boolean => field.type === 'number'

/** The keys the photos measure: a number question with the same key is the "if you know it" box, not a count */
function measuredKeys(steps: readonly LinkStep[]): Set<string> {
  return new Set(steps.filter((s) => s.quantitySource?.type === 'ai_signal' && s.quantitySource.signalKey).map((s) => s.quantitySource!.signalKey!))
}

/**
 * The optional number questions whose empty answer means "none": 0, never 1.
 *
 * A number question the customer may leave empty, used as a line's quantity
 * (directly or inside a formula). A question that only repeats a quantity the
 * photos measure ("— if you know it") is not one of them: empty there means
 * "measure it", and the measurement fills it.
 */
export function optionalNumberQuestions(fields: readonly LinkField[] | null | undefined, steps: readonly LinkStep[] | null | undefined): Set<string> {
  const measured = measuredKeys(steps ?? [])
  const out = new Set<string>()
  // The same question can be listed twice (the form's copy and the service's own): it is optional
  // only when no copy says the customer must answer it
  const must = new Set<string>()
  for (const field of fields ?? []) if (field?.fieldId && (field.required === true || field.criticalForPricing === true)) must.add(field.fieldId)
  for (const field of fields ?? []) {
    if (!field?.fieldId || !isNumberQuestion(field) || must.has(field.fieldId)) continue
    if (measured.has(field.fieldId) || (field.mapsToSignal && measured.has(field.mapsToSignal))) continue
    out.add(field.fieldId)
  }
  return out
}

// ───────────────────────────── what a line is linked to ─────────────────────────────

/** The question ids a line reads: its condition, its quantity, the identifiers of its formula */
export function questionsReadBy(step: LinkStep, fields: readonly LinkField[]): Set<string> {
  const ids = new Set<string>()
  const byKey = (key: string | null | undefined) => {
    if (!key) return
    for (const field of fields) if (field.fieldId === key || field.mapsToSignal === key) ids.add(field.fieldId)
  }
  byKey(step.when?.fieldId)
  byKey(step.triggerSignal)
  const source = step.quantitySource
  if (source?.type === 'form_field') byKey(source.fieldId)
  if (source?.type === 'ai_signal') byKey(source.signalKey)
  if (source?.type === 'derived' && source.formula) for (const name of extractFormulaIdentifiers(source.formula) ?? []) byKey(name)
  return ids
}

/** A line has a condition when an answer or a detail from the photos decides whether it is charged */
export function hasCondition(step: LinkStep): boolean {
  if (step.when?.fieldId) return true
  return Boolean(step.optional && step.triggerSignal)
}

/** A line has a quantity source when its amount is multiplied by something other than a bare 1 */
export function hasQuantitySource(step: LinkStep): boolean {
  const source = step.quantitySource
  if (!source?.type) return false
  if (source.type === 'form_field') return Boolean(source.fieldId)
  if (source.type === 'ai_signal') return Boolean(source.signalKey)
  if (source.type === 'derived') return Boolean(source.formula)
  return source.type === 'constant'
}

/**
 * The words that say a line depends on something. Whole words only, so
 * "Repair" is not "per" and "Notification" is not "if".
 */
const DEPENDS_WORDS: ReadonlyArray<{ word: string; pattern: RegExp }> = [
  { word: 'each additional', pattern: /\beach\s+additional\b/i },
  { word: 'only', pattern: /\bonly\b/i },
  { word: 'if', pattern: /\bif\b/i },
  { word: 'per', pattern: /\bper\b/i },
  { word: 'weekend', pattern: /\bweekends?\b/i },
]

/** The first "it depends" word in a line's name or description, or null */
export function dependsWordIn(step: Pick<LinkStep, 'name' | 'description'>): string | null {
  const text = `${step.name ?? ''} \n ${step.description && step.description !== step.name ? step.description : ''}`
  for (const { word, pattern } of DEPENDS_WORDS) if (pattern.test(text)) return word
  return null
}

export type PricingFlag =
  | { kind: 'question_unused'; fieldId: string; label: string; message: string }
  | { kind: 'line_unlinked'; stepId: string; name: string; word: string; message: string }

export const QUESTION_UNUSED_MESSAGE = 'This question does not change the price'
/**
 * The same flag on a service with a line the photos measure: there every answer is also given to
 * the measurement as the job's scope ("which sides?"), so "does not change the price" would not be
 * true. No price line reads it, and that is what is said.
 */
export const QUESTION_UNUSED_MEASURED_MESSAGE = 'No price line reads this question. Its answer is only given to the photo measurement, as part of what the job covers'

/** The kinds of question whose answer can change a price: a choice, a tick or a number */
const PRICE_QUESTION_TYPES = new Set(['number', 'dropdown', 'radio', 'checkbox', 'boolean'])

export interface PricingConfigLike {
  workSteps?: readonly LinkStep[] | null
  fields?: readonly LinkField[] | null
  multipliers?: readonly LinkMultiplier[] | null
}

/**
 * The flags a business sees on the compile result and on "Test & Publish".
 * They never block saving.
 *
 *   question_unused   a choice, tick or number question that no price line,
 *                     quantity, formula or adjustment reads. (A text question
 *                     is for the business to read, so it is never flagged.)
 *   line_unlinked     a line whose name or description says "if", "only",
 *                     "per", "each additional" or "weekend" and which has no
 *                     condition and no quantity source: it is charged, in
 *                     full, on every quote.
 */
export function pricingChecks(config: PricingConfigLike): PricingFlag[] {
  const steps = config.workSteps ?? []
  const fields = config.fields ?? []
  const flags: PricingFlag[] = []

  const measured = measuredKeys(steps).size > 0
  const read = new Set<string>()
  for (const step of steps) for (const id of questionsReadBy(step, fields)) read.add(id)
  for (const multiplier of config.multipliers ?? []) if (multiplier.when?.fieldId) read.add(multiplier.when.fieldId)

  for (const step of steps) {
    if (hasCondition(step) || hasQuantitySource(step)) continue
    const word = dependsWordIn(step)
    if (!word) continue
    flags.push({
      kind: 'line_unlinked',
      stepId: step.id,
      name: step.name,
      word,
      message: `"${step.name}" says "${word}" but is charged on every quote: it has no condition and no quantity from an answer`,
    })
  }

  for (const field of fields) {
    if (!field.fieldId || !PRICE_QUESTION_TYPES.has(field.type ?? '')) continue
    if (read.has(field.fieldId)) continue
    flags.push({ kind: 'question_unused', fieldId: field.fieldId, label: field.label || field.fieldId, message: measured ? QUESTION_UNUSED_MEASURED_MESSAGE : QUESTION_UNUSED_MESSAGE })
  }
  return flags
}

// ───────────────────────────── tying loose links (after the AI's compile) ─────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'our', 'are', 'does', 'will', 'have', 'need', 'needs', 'required', 'require', 'want', 'like', 'would', 'this', 'that', 'there', 'from', 'what', 'which', 'when', 'where', 'how', 'many', 'much', 'any',
  'add', 'adds', 'extra', 'additional', 'surcharge', 'charge', 'fee', 'cost', 'price', 'rate', 'only', 'each', 'per', 'unit', 'units', 'visit', 'visits', 'service', 'job', 'work', 'number', 'system', 'systems', 'item', 'items',
])

/** The words of a label that carry meaning, lower case, plural "s" dropped */
export function keyWordsOf(text: string | null | undefined): Set<string> {
  const words = new Set<string>()
  for (const raw of (text ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue
    const word = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw
    if (!STOP_WORDS.has(word)) words.add(word)
  }
  return words
}

const optionValue = (option: string | { value: string; label?: string | null }): string => (typeof option === 'string' ? option : option.label || option.value)

const containsWholePhrase = (text: string, phrase: string): boolean => {
  const clean = phrase.trim().toLowerCase()
  if (clean.length < 3) return false
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text)
}

export interface LinkRepair {
  stepId: string
  name: string
  /** What was done, in words a business reads on the compile result */
  what: string
}

export interface LinkResult<S extends LinkStep> {
  workSteps: S[]
  repairs: LinkRepair[]
}

/**
 * Tie the links an AI-written configuration left loose. Only where there is
 * exactly one right answer; everything else is left for `pricingChecks` to
 * flag. In order, for each line:
 *
 *   a. "Each additional …": a per-unit line whose words say "each additional"
 *      and whose quantity is a count question takes the answer minus one,
 *      never below 0 (the engine's formula `max(0, answer - 1)`).
 *   b. An optional number: a per-unit line whose quantity is an optional
 *      number question is marked "left empty = 0".
 *   c. A loose line (its words say it depends, and nothing decides it):
 *      - if its words name exactly one option of exactly one choice question,
 *        it is included only when that option is chosen;
 *      - else if its words match exactly one yes/no question no line reads
 *        yet, it is included only when that is ticked.
 */
export function linkPricing<S extends LinkStep>(workSteps: readonly S[], fields: readonly LinkField[]): LinkResult<S> {
  const repairs: LinkRepair[] = []
  const optionalNumbers = optionalNumberQuestions(fields, workSteps)
  const fieldById = new Map(fields.map((f) => [f.fieldId, f]))
  const out: S[] = workSteps.map((step) => ({ ...step }))

  // a and b
  for (const step of out) {
    const source = step.quantitySource
    if (step.costType !== 'per_unit' && step.costType !== 'per_hour') continue
    if (source?.type !== 'form_field' || !source.fieldId) continue
    const field = fieldById.get(source.fieldId)
    if (!field || !isNumberQuestion(field)) continue
    const text = `${step.name} ${step.description ?? ''}`
    // "each additional …" in so many words, or an "Additional …" line beside a "First …" line
    const saysAdditional = /\b(each|every|per)\s+(additional|extra)\b/i.test(text) || (/\badditional\b/i.test(step.name) && out.some((other) => other !== step && /\bfirst\b/i.test(other.name)))
    const questionCountsExtras = /\b(additional|extra|more)\b/i.test(field.label ?? '')
    if (saysAdditional && !questionCountsExtras) {
      step.quantitySource = { type: 'derived', formula: `max(0, ${field.fieldId} - 1)` }
      repairs.push({ stepId: step.id, name: step.name, what: `counts "${field.label || field.fieldId}" minus 1 (never below 0)` })
      continue
    }
    if (optionalNumbers.has(field.fieldId) && source.missingMeansZero !== true) {
      step.quantitySource = { ...source, missingMeansZero: true }
      repairs.push({ stepId: step.id, name: step.name, what: `"${field.label || field.fieldId}" left empty counts as 0` })
    }
  }

  // c
  const readAlready = new Set<string>()
  for (const step of out) for (const id of questionsReadBy(step, fields)) readAlready.add(id)
  for (const step of out) {
    if (hasCondition(step) || hasQuantitySource(step)) continue
    if (step.costType === 'percent') continue
    if (!dependsWordIn(step)) continue
    const text = `${step.name} ${step.description ?? ''}`

    const optionMatches: Array<{ field: LinkField; option: string }> = []
    for (const field of fields) {
      if (!['dropdown', 'radio', 'checkbox'].includes(field.type ?? '')) continue
      const named = (field.options ?? []).map(optionValue).filter((option) => containsWholePhrase(text, option))
      if (named.length === 1) optionMatches.push({ field, option: named[0]! })
      else if (named.length > 1) optionMatches.push({ field, option: '' }, { field, option: '' }) // names several: not one right answer
    }
    if (optionMatches.length === 1) {
      const { field, option } = optionMatches[0]!
      step.when = { fieldId: field.fieldId, operator: 'equals', equals: option }
      step.optional = true
      readAlready.add(field.fieldId)
      repairs.push({ stepId: step.id, name: step.name, what: `only included when "${field.label || field.fieldId}" is "${option}"` })
      continue
    }
    if (optionMatches.length > 1) continue

    const words = keyWordsOf(text)
    const ticks = fields.filter((field) => field.type === 'boolean' && !readAlready.has(field.fieldId)).filter((field) => [...keyWordsOf(field.label)].some((word) => words.has(word)))
    if (ticks.length === 1) {
      const field = ticks[0]!
      step.when = { fieldId: field.fieldId, operator: 'equals', equals: true }
      step.optional = true
      readAlready.add(field.fieldId)
      repairs.push({ stepId: step.id, name: step.name, what: `only included when "${field.label || field.fieldId}" is ticked` })
    }
  }

  return { workSteps: out, repairs }
}

/** In words: what a line's condition and quantity are linked to (for the compile review and the editor) */
export function linkWordsOf(step: LinkStep, fields: readonly LinkField[]): { condition: string | null; quantity: string | null } {
  const label = (key: string | undefined | null) => {
    const field = fields.find((f) => f.fieldId === key || f.mapsToSignal === key)
    return field?.label || key || ''
  }
  let condition: string | null = null
  if (step.when?.fieldId) {
    const wanted = step.when.equals ?? step.when.value
    const operator = step.when.operator || 'equals'
    const sign = operator === 'equals' ? '=' : operator === 'contains' ? 'includes' : operator === 'gt' ? '>' : operator === 'gte' ? '≥' : operator === 'lt' ? '<' : operator === 'lte' ? '≤' : '='
    const shown = wanted === true ? 'Yes' : wanted === false ? 'No' : String(wanted ?? '')
    condition = `Only include when ${label(step.when.fieldId)} ${sign} ${shown}`
  }
  let quantity: string | null = null
  const source = step.quantitySource
  if (source?.type === 'form_field' && source.fieldId) quantity = `Quantity from the answer to "${label(source.fieldId)}"${source.missingMeansZero ? ' (left empty counts as 0)' : ''}`
  else if (source?.type === 'derived' && source.formula) {
    const minusOne = /^\s*max\(\s*0\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*-\s*1\s*\)\s*$/.exec(source.formula)
    // "the first N" of a count: min(answer, N)
    const atMost = /^\s*min\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\s*\)\s*$/.exec(source.formula)
    quantity = minusOne
      ? `Quantity: "${label(minusOne[1])}" minus 1, never below 0`
      : atMost
        ? `Quantity: "${label(atMost[1])}", at most ${atMost[2]}`
        : `Quantity worked out from the answers: ${source.formula}`
  }
  return { condition, quantity }
}
