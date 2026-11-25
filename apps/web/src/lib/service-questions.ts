/**
 * T-201: a service's questions, their keys, and what the service editor may save (pure).
 *
 * A question has two keys. `fieldId` names the customer's answer; `mapsToSignal`
 * names the fact that answer gives. Price lines, adjustments and conditions
 * refer to a question by one of these keys and never by its label.
 *
 * Until T-201 both keys were worked out again from the label on every
 * keystroke, so changing a question's wording cut every price line, adjustment
 * and condition loose from it, and any edit on "Customer Questions" replaced
 * the service's whole list of facts (losing what a template had set on them:
 * units, limits, what a room scan fills). Now a key is set once and kept:
 *
 *   - a question saved with the service, or one a price line, an adjustment or
 *     a condition already uses, keeps its keys whatever its label becomes;
 *   - a key that did not come from the label (a template's, a draft's) is kept;
 *   - only a new question nothing uses yet has keys that follow its label,
 *     and no two questions ever share a key.
 *
 * Services saved before T-201 need no change: their keys are the ones they
 * have, and from now on they stay.
 *
 * Relative imports only: scripts load this with tsx.
 */
import type { AddonConfig, ExpectedSignalConfig, MultiplierConfig, ServiceDraftConfig, ServiceMediaConfig, SuggestedField, WorkStepConfig } from '@qolumns/shared'

/** A question's answer key, from its label: "Number of Rooms" → number_of_rooms */
export function deriveFieldId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Derive a canonical signal key from a field label and type
 *
 * This ensures form fields and AI use the SAME signal keys - no matching needed.
 *
 * Examples:
 * - "How many papers?" (number) → paper_count
 * - "Number of Leaks" (number) → leak_count
 * - "Approximate Age of Roof" (number) → roof_age
 * - "Is the leak causing interior damage?" (boolean) → has_interior_damage
 * - "Type of Roofing Material" (dropdown) → roofing_material_type
 * - "Number of Papers" (number) → paper_count
 */
export function deriveSignalKey(label: string, fieldType: string): string {
  // Normalize label: lowercase, remove punctuation
  let normalized = label.toLowerCase()
    .replace(/[?!.,'"]/g, '')
    .trim()

  // Remove common question prefixes/fillers
  const prefixPatterns = [
    /^how many\s+/i,
    /^number of\s+/i,
    /^what is the\s+/i,
    /^what is your\s+/i,
    /^what are the\s+/i,
    /^what\s+/i,
    /^how\s+/i,
    /^is the\s+/i,
    /^is there\s+/i,
    /^do you have\s+/i,
    /^does the\s+/i,
    /^are there\s+/i,
    /^please enter\s+/i,
    /^please provide\s+/i,
    /^approximate\s+/i,
    /^estimated\s+/i,
    /^total\s+/i,
  ]

  for (const pattern of prefixPatterns) {
    normalized = normalized.replace(pattern, '')
  }

  // Split into words and filter stop words
  const words = normalized.split(/\s+/)
  const stopWords = new Set([
    'the', 'a', 'an', 'of', 'is', 'are', 'your', 'do', 'you', 'have',
    'need', 'needed', 'required', 'for', 'to', 'in', 'on', 'at', 'by',
    'this', 'that', 'these', 'those', 'any', 'some'
  ])

  const meaningfulWords = words
    .filter(w => !stopWords.has(w) && w.length > 1)
    .slice(0, 3) // Take up to 3 meaningful words

  if (meaningfulWords.length === 0) {
    // Fallback: just use the first word
    const firstWord = words[0] || 'field'
    return firstWord.replace(/s$/, '') // singularize
  }

  // Singularize common plurals in the core concept
  const singularize = (word: string): string => {
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y'
    if (word.endsWith('es') && !word.endsWith('ss')) return word.slice(0, -2)
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
    return word
  }

  // Build the core concept (first 2 words usually)
  const coreWords = meaningfulWords.slice(0, 2).map(singularize)
  const core = coreWords.join('_')

  // Add appropriate suffix based on field type
  switch (fieldType) {
    case 'number': {
      // Check if it already has a numeric suffix
      const numericSuffixes = ['count', 'quantity', 'number', 'total', 'amount', 'age', 'area', 'sqft', 'size']
      const hasNumericSuffix = numericSuffixes.some(s => core.endsWith(s) || core.includes(`_${s}`))

      // Check for specific patterns
      if (core.includes('age') || normalized.includes('age')) {
        return core.includes('age') ? core : `${core}_age`
      }
      if (core.includes('area') || core.includes('sqft') || normalized.includes('sqft') || normalized.includes('square')) {
        return core.includes('area') ? core : `${core}_area`
      }

      // Default: add _count for numbers
      return hasNumericSuffix ? core : `${core}_count`
    }

    case 'dropdown':
    case 'radio': {
      // Check if it already has a type-like suffix
      const typeSuffixes = ['type', 'kind', 'style', 'category', 'material', 'condition', 'status']
      const hasTypeSuffix = typeSuffixes.some(s => core.endsWith(s) || core.includes(`_${s}`))

      // Check for specific patterns
      if (normalized.includes('condition')) {
        return core.includes('condition') ? core : `${core}_condition`
      }
      if (normalized.includes('material')) {
        return core.includes('material') ? core : `${core}_material`
      }

      // Default: add _type for dropdowns
      return hasTypeSuffix ? core : `${core}_type`
    }

    case 'checkbox': {
      // For checkboxes, check what makes sense
      const boolPrefixes = ['is', 'has', 'can', 'does', 'will', 'should']
      const startsWithBool = boolPrefixes.some(p => core.startsWith(p) || core.startsWith(`${p}_`))

      return startsWithBool ? core : `has_${core}`
    }

    case 'boolean': {
      // For yes/no toggles
      const boolPrefixes = ['is', 'has', 'can', 'does', 'will', 'should']
      const startsWithBool = boolPrefixes.some(p => core.startsWith(p) || core.startsWith(`${p}_`))

      // Check for specific patterns
      if (normalized.includes('damage') || normalized.includes('damaged')) {
        return core.includes('has_') ? core : `has_${core.replace('damage', 'damage')}`
      }
      if (normalized.includes('required') || normalized.includes('needed')) {
        return `${core.replace('_required', '').replace('_needed', '')}_required`
      }

      return startsWithBool ? core : `has_${core}`
    }

    case 'text':
    case 'textarea':
    default:
      // For text fields, just use the core concept
      return core.endsWith('description') ? core : (core.length > 0 ? core : 'description')
  }
}
const SIGNAL_TYPE: Record<SuggestedField['type'], ExpectedSignalConfig['type']> = {
  number: 'number',
  boolean: 'boolean',
  dropdown: 'enum',
  radio: 'enum',
  checkbox: 'enum',
  text: 'string',
  textarea: 'string',
}

/** The fact a question gives, as the editor writes it: named by `signalKey`, described by the question's label */
export function fieldToSignal(field: SuggestedField, signalKey: string = deriveSignalKey(field.label, field.type)): ExpectedSignalConfig {
  return {
    signalKey,
    type: SIGNAL_TYPE[field.type] || 'string',
    description: field.label,
    possibleValues: field.options,
  }
}

interface PricingRefs {
  workSteps?: readonly WorkStepConfig[]
  multipliers?: readonly MultiplierConfig[]
  expectedSignals?: readonly ExpectedSignalConfig[]
}

/**
 * Every key the pricing refers to: a line's quantity, its condition, a formula's
 * names, an adjustment's question, and the fact a measured size is checked
 * against. A formula's function names (ceil, max…) come out too; a key that
 * is kept without need does no harm.
 */
export function referencedKeys({ workSteps = [], multipliers = [], expectedSignals = [] }: PricingRefs): Set<string> {
  const keys = new Set<string>()
  const add = (key: unknown) => {
    if (typeof key === 'string' && key) keys.add(key)
  }
  for (const step of workSteps) {
    add(step.quantitySource?.fieldId)
    add(step.quantitySource?.signalKey)
    for (const name of step.quantitySource?.formula?.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) add(name)
    add(step.when?.fieldId)
    add(step.triggerSignal)
  }
  for (const mult of multipliers) add(mult.when?.fieldId)
  for (const signal of expectedSignals) add(signal.envelope?.driverKey)
  return keys
}

/** `key` is `derived` itself, or `derived` with the number that kept it apart from another question's */
const followed = (key: string | undefined, derived: string): boolean => Boolean(key) && Boolean(derived) && (key === derived || (key!.startsWith(`${derived}_`) && /^\d+$/.test(key!.slice(derived.length + 1))))

export interface QuestionSync {
  /** The questions as the editor hands them back (a label, a type or the order changed; one added or removed) */
  fields: readonly SuggestedField[]
  /** The questions and facts as they were before this change */
  previousFields: readonly SuggestedField[]
  previousSignals: readonly ExpectedSignalConfig[]
  /** The keys of the questions the service was saved with */
  savedFieldIds?: Iterable<string>
  workSteps?: readonly WorkStepConfig[]
  multipliers?: readonly MultiplierConfig[]
}

/**
 * The questions with their keys, and the service's facts, after a change on
 * "Customer Questions". See the top of this file for when a key is kept.
 *
 * Facts: one that no question wrote (a template's or a draft's, with its
 * units, limits and scan setting) is left exactly as it is. One the editor
 * wrote for a question follows that question's label, type and choices and
 * keeps whatever else was set on it; it goes when its question goes, unless a
 * price line still uses it.
 */
export function syncQuestions(input: QuestionSync): { fields: SuggestedField[]; signals: ExpectedSignalConfig[] } {
  const { fields, previousFields, previousSignals } = input
  const refs = referencedKeys({ workSteps: input.workSteps, multipliers: input.multipliers, expectedSignals: previousSignals })
  const saved = new Set(input.savedFieldIds ?? [])
  const before = new Map(previousFields.filter((f) => f.fieldId).map((f) => [f.fieldId, f]))

  const plan = fields.map((field) => {
    const was = field.fieldId ? before.get(field.fieldId) : undefined
    const settled = Boolean(field.fieldId) && (saved.has(field.fieldId) || refs.has(field.fieldId) || (Boolean(field.mapsToSignal) && refs.has(field.mapsToSignal!)))
    const relabelled = Boolean(was) && was!.label !== field.label
    const retyped = Boolean(was) && was!.type !== field.type
    return {
      field,
      keepId: Boolean(field.fieldId) && (settled || !relabelled || !followed(field.fieldId, deriveFieldId(was!.label))),
      keepSignal: Boolean(field.mapsToSignal) && (settled || !(relabelled || retyped) || !followed(field.mapsToSignal, deriveSignalKey(was!.label, was!.type))),
    }
  })

  const usedIds = new Set(plan.filter((p) => p.keepId).map((p) => p.field.fieldId))
  const usedSignals = new Set(plan.filter((p) => p.keepSignal).map((p) => p.field.mapsToSignal!))
  const unique = (base: string, used: Set<string>): string => {
    if (!base) return ''
    let key = base
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`
    used.add(key)
    return key
  }
  const next: SuggestedField[] = plan.map(({ field, keepId, keepSignal }) => ({
    ...field,
    fieldId: keepId ? field.fieldId : unique(deriveFieldId(field.label), usedIds),
    mapsToSignal: keepSignal ? field.mapsToSignal : field.label.trim() ? unique(deriveSignalKey(field.label, field.type), usedSignals) : undefined,
  }))

  const writer = new Map(previousFields.filter((f) => f.mapsToSignal).map((f) => [f.mapsToSignal!, f]))
  /** Written by the editor for a question: it carries that question's label */
  const editorWrote = (signal: ExpectedSignalConfig) => writer.get(signal.signalKey)?.label === signal.description
  const asked = next.filter((f) => f.label.trim() && f.mapsToSignal)
  const askedKeys = new Set(asked.map((f) => f.mapsToSignal!))
  const was = new Map(previousSignals.map((s) => [s.signalKey, s]))

  const signals = previousSignals.filter((signal) => !editorWrote(signal) || (!askedKeys.has(signal.signalKey) && refs.has(signal.signalKey)))
  for (const field of asked) {
    if (signals.some((s) => s.signalKey === field.mapsToSignal)) continue
    signals.push({ ...was.get(field.mapsToSignal!), ...fieldToSignal(field, field.mapsToSignal!) })
  }
  return { fields: next, signals }
}

/**
 * Fixed price lines that can never be charged: ticked "Only include when
 * condition is met" with no question chosen. The pricing engine leaves such a
 * line off every estimate (it has no condition to meet and no quantity to go
 * by), so it is not saved. A "Per Unit" or "Per Hour" line is not listed: one
 * with a quantity is charged whenever that quantity is given, and one without
 * is already stopped by "needs a quantity link".
 */
export function linesNeverCharged<T extends Pick<WorkStepConfig, 'costType' | 'optional' | 'triggerSignal' | 'when' | 'quantitySource'>>(workSteps: readonly T[] | undefined): T[] {
  return (workSteps ?? []).filter((step) => step.costType === 'fixed' && step.optional === true && !step.triggerSignal && !step.when?.fieldId && !step.quantitySource)
}

/** What the editor and the save route say about such a line */
export const lineNeedsQuestion = (step: Pick<WorkStepConfig, 'name'>): string =>
  `"${step.name || 'Unnamed item'}" is set to "Only include when condition is met", but no question is chosen. Choose its question, or untick it.`

/** The first reason these price lines cannot be saved, or null */
export function priceLinesProblem(workSteps: readonly WorkStepConfig[] | undefined): string | null {
  const dead = linesNeverCharged(workSteps)[0]
  return dead ? lineNeedsQuestion(dead) : null
}

/** What the editor holds of a service */
export interface ServiceForm {
  scopeIncludes: string[]
  scopeExcludes: string[]
  defaultAssumptions: string[]
  mediaConfig: ServiceMediaConfig
  workSteps: WorkStepConfig[]
  expectedSignals: ExpectedSignalConfig[]
  suggestedFields: SuggestedField[]
  baseFee: number
  minimumCharge: number
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
}

/** A draft made by hand in the editor, not by a draft, a template or an import */
export const isHandMade = (draft: ServiceDraftConfig | null | undefined): boolean => draft?.source === 'manual'

/** A draft that came from a draft, a template or an import: the "AI Draft" mark and its tools are for these */
export const isAiDraft = (draft: ServiceDraftConfig | null | undefined): draft is ServiceDraftConfig => Boolean(draft) && !isHandMade(draft)

/** The editor's own record of a service it built by hand: what holds its questions */
export function handMadeDraft(form: ServiceForm): ServiceDraftConfig {
  return {
    source: 'manual',
    scope: { included: form.scopeIncludes, excluded: form.scopeExcludes, assumptions: form.defaultAssumptions },
    media: {
      minPhotos: form.mediaConfig.minPhotos,
      maxPhotos: form.mediaConfig.maxPhotos,
      photoGuidance: form.mediaConfig.photoGuidance ?? '',
      ...(form.mediaConfig.requiredAngles && { requiredAngles: form.mediaConfig.requiredAngles }),
    },
    pricing: {
      pricingModel: 'fixed',
      unitType: null,
      baseFee: form.baseFee,
      minimumCharge: form.minimumCharge,
      workSteps: form.workSteps,
      addOns: [],
      siteVisit: { alwaysRecommend: false, confidenceBelowPct: 60, estimateAbove: 1000 },
    },
    expectedSignals: form.expectedSignals,
    suggestedFields: form.suggestedFields,
  }
}

/**
 * The draft saved with a service. A service's questions live in its draft, so
 * a service made by hand (no draft) used to lose every question on save
 * (T-201). Now it gets a draft of its own, marked as made by hand.
 * `current` is the draft the service has: an AI one keeps everything it
 * holds; null with no questions stays null.
 */
export function draftToSave(current: ServiceDraftConfig | null | undefined, form: ServiceForm): ServiceDraftConfig | null {
  if (isAiDraft(current)) return { ...current, suggestedFields: form.suggestedFields }
  if (current || form.suggestedFields.length > 0) return handMadeDraft(form)
  return null
}

/** What "Regenerate" on "Scope & Photos" replaces, with how much of each there is now */
export function regenerateReplaces(form: Pick<ServiceForm, 'suggestedFields' | 'workSteps' | 'addons'>): string[] {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    'What’s included, what’s excluded and your assumptions',
    'The photo settings',
    `Your questions (${count(form.suggestedFields.length, 'question', 'questions')} now)`,
    `Your price lines (${count(form.workSteps.length, 'line', 'lines')} now)`,
    `Your add-ons (${count(form.addons.length, 'add-on', 'add-ons')} now)`,
  ]
}

/** What "Regenerate" leaves alone */
export const REGENERATE_KEEPS = 'Your service name, description, base fee, minimum charge and adjustments stay as they are.'

/**
 * T-202: what "Clear" on "Scope & Photos" empties, with how much of each there
 * is now. It lists what `clearAIDraft` on the services page does, line for
 * line: the three scope lists, the photo settings (back to the defaults, the
 * guidance and any required photos gone), the questions, the price lines and
 * with them what each line measures from the photos.
 */
export function clearEmpties(form: Pick<ServiceForm, 'scopeIncludes' | 'scopeExcludes' | 'defaultAssumptions' | 'mediaConfig' | 'suggestedFields' | 'workSteps'>): string[] {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const required = form.mediaConfig.requiredAngles?.length ?? 0
  const photoParts = [
    `${form.mediaConfig.minPhotos} to ${form.mediaConfig.maxPhotos} photos now`,
    ...(form.mediaConfig.photoGuidance?.trim() ? ['your photo guidance'] : []),
    ...(required > 0 ? [count(required, 'required photo', 'required photos')] : []),
  ]
  return [
    `What’s included (${count(form.scopeIncludes.length, 'item', 'items')} now), what’s excluded (${form.scopeExcludes.length}) and your assumptions (${form.defaultAssumptions.length})`,
    `The photo settings, back to ${CLEARED_MEDIA.minPhotos} to ${CLEARED_MEDIA.maxPhotos} photos with no guidance (${photoParts.join(', ')})`,
    `Your questions (${count(form.suggestedFields.length, 'question', 'questions')} now)`,
    `Your price lines, and what each one measures from the photos (${count(form.workSteps.length, 'line', 'lines')} now)`,
  ]
}

/** The photo settings "Clear" leaves behind (the same as a new, empty service) */
export const CLEARED_MEDIA = { minPhotos: 1, maxPhotos: 8, photoGuidance: null } as const

/** What "Clear" leaves alone */
export const CLEAR_KEEPS = 'Your service name, description, base fee, minimum charge, add-ons and adjustments stay as they are.'

/** Said only when an adjustment or an add-on leans on a question that is about to go */
export function clearLoosens(form: Pick<ServiceForm, 'multipliers' | 'suggestedFields'>): string | null {
  const fieldIds = new Set(form.suggestedFields.map((f) => f.fieldId))
  const using = form.multipliers.filter((m) => m.when?.subject !== 'subtotal' && m.when?.fieldId && fieldIds.has(m.when.fieldId)).length
  if (using === 0) return null
  return `${using === 1 ? 'One adjustment uses' : `${using} adjustments use`} a question that will be removed, so ${using === 1 ? 'it stops' : 'they stop'} applying until you choose a question for ${using === 1 ? 'it' : 'them'} again.`
}

/**
 * Adjustments and conditions that point at a question or fact the service no
 * longer has (it was removed, or the service was saved before T-201 with a
 * renamed question). Each is a line for "Test & Publish": the engine skips
 * them, so the business is told.
 */
export function looseReferences(form: Pick<ServiceForm, 'workSteps' | 'multipliers' | 'suggestedFields' | 'expectedSignals'>): string[] {
  const fieldIds = new Set(form.suggestedFields.map((f) => f.fieldId))
  const signalKeys = new Set([...form.expectedSignals.map((s) => s.signalKey), ...form.suggestedFields.map((f) => f.mapsToSignal).filter(Boolean)])
  const out: string[] = []
  for (const step of form.workSteps) {
    if (step.optional && step.triggerSignal && !signalKeys.has(step.triggerSignal) && !fieldIds.has(step.triggerSignal)) {
      out.push(`"${step.name || 'Unnamed item'}" is only included for a question this service no longer has. Choose its question again.`)
    }
    if (step.when?.fieldId && !fieldIds.has(step.when.fieldId)) {
      out.push(`"${step.name || 'Unnamed item'}" depends on a question this service no longer has, so it is never charged. Remove the line and add it again.`)
    }
  }
  const loose = form.multipliers.filter((m) => m.when?.subject !== 'subtotal' && m.when?.fieldId && !fieldIds.has(m.when.fieldId)).length
  if (loose > 0) out.push(`${loose === 1 ? 'An adjustment uses' : `${loose} adjustments use`} a question this service no longer has. Choose the question again under "Adjustments".`)
  return out
}
