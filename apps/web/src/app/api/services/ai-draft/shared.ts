/**
 * Shared utilities for AI draft validation and normalization.
 * Used by: ai-draft/route.ts, extract-services, extract-pricing, refine
 */

import type { ServiceDraftConfig } from '@estimator/shared'
import { extractFormulaIdentifiers } from '@estimator/shared'

/**
 * Validate and normalize an AI-generated draft config
 */
export function validateAndNormalizeDraft(
  draft: Partial<ServiceDraftConfig>,
): ServiceDraftConfig {
  // Ensure scope
  const scope = {
    included: truncateArray(draft.scope?.included || ['Standard service'], 6),
    excluded: truncateArray(draft.scope?.excluded || ['Additional services not specified'], 6),
    assumptions: truncateArray(draft.scope?.assumptions || ['Standard conditions apply'], 6),
  }

  // Ensure media
  const media = {
    minPhotos: Math.max(0, Math.min(5, draft.media?.minPhotos || 1)),
    maxPhotos: Math.max(1, Math.min(10, draft.media?.maxPhotos || 8)),
    photoGuidance: draft.media?.photoGuidance || 'Please upload clear photos of the area or items that need service.',
    requiredAngles: truncateArray(draft.media?.requiredAngles || [
      { id: 'overview', label: 'Full view', guidance: 'Capture the entire area' }
    ], 4),
  }

  // Ensure pricing
  const validPricingModels = ['fixed', 'per_unit', 'tiered', 'inspection_first'] as const
  const pricingModel = validPricingModels.includes(draft.pricing?.pricingModel as typeof validPricingModels[number])
    ? draft.pricing!.pricingModel
    : 'fixed'

  const pricing = {
    pricingModel,
    unitType: draft.pricing?.unitType || null,
    baseFee: Math.max(0, draft.pricing?.baseFee || 0),
    // ?? not || — a stated £0 minimum is valid, and an absent one must NOT
    // invent a price (core rule 1: never invent numbers the owner didn't state)
    minimumCharge: Math.max(0, draft.pricing?.minimumCharge ?? 0),
    workSteps: truncateArray(normalizeWorkSteps(draft.pricing?.workSteps || []), 5),
    addOns: truncateArray(normalizeAddons(draft.pricing?.addOns || []), 6),
    siteVisit: {
      alwaysRecommend: draft.pricing?.siteVisit?.alwaysRecommend || false,
      confidenceBelowPct: Math.max(0, Math.min(100, draft.pricing?.siteVisit?.confidenceBelowPct || 60)),
      estimateAbove: Math.max(0, draft.pricing?.siteVisit?.estimateAbove || 1000),
    },
  }

  // Ensure expected signals
  const expectedSignals = truncateArray(
    normalizeExpectedSignals(draft.expectedSignals || []),
    6
  )

  // Ensure suggested fields
  const suggestedFields = truncateArray(
    normalizeSuggestedFields(draft.suggestedFields || []),
    6
  )

  return {
    scope,
    media,
    pricing,
    expectedSignals,
    suggestedFields,
  }
}

/**
 * Validate and normalize with higher limits for bulk extraction
 */
export function validateAndNormalizeDraftBulk(
  draft: Partial<ServiceDraftConfig>,
): ServiceDraftConfig {
  const normalized = validateAndNormalizeDraft(draft)
  // For bulk, allow more work steps and fields since document may contain detailed pricing
  return {
    ...normalized,
    pricing: {
      ...normalized.pricing,
      workSteps: truncateArray(normalizeWorkSteps(draft.pricing?.workSteps || []), 10),
      addOns: truncateArray(normalizeAddons(draft.pricing?.addOns || []), 10),
    },
    suggestedFields: truncateArray(
      normalizeSuggestedFields(draft.suggestedFields || []),
      10
    ),
  }
}

export function truncateArray<T>(arr: T[], max: number): T[] {
  return arr.slice(0, max)
}

interface WorkStepInput {
  id?: string
  name?: string
  /** Model output drift: steps sometimes arrive with `label` instead of `name` */
  label?: string
  description?: string
  costType?: string
  defaultCost?: number
  cost?: number
  /** Model output drift: cost sometimes arrives as `price` */
  price?: number
  optional?: boolean
  triggerSignal?: string
  triggerCondition?: { operator: string; value?: string | number | boolean }
  when?: { fieldId?: string; operator?: string; equals?: string | number | boolean; value?: string | number }
  quantitySource?: {
    type?: string
    fieldId?: string
    value?: number
    signalKey?: string
    formula?: string
    missingMeansZero?: boolean
  }
  unitLabel?: string
  percentOf?: string[] | 'subtotal'
  costBand?: { low?: number; high?: number }
}

function normalizeQuantitySource(qs: WorkStepInput['quantitySource']): ServiceDraftConfig['pricing']['workSteps'][0]['quantitySource'] | undefined {
  if (!qs || !qs.type) return undefined
  const validTypes = ['form_field', 'constant', 'ai_signal', 'derived'] as const
  if (!validTypes.includes(qs.type as typeof validTypes[number])) return undefined
  // T-125: derived formulas must at least parse — an unparsable formula would
  // silently price at quantity 1 downstream
  if (qs.type === 'derived' && (!qs.formula || extractFormulaIdentifiers(qs.formula) === null)) return undefined
  return {
    type: qs.type as 'form_field' | 'constant' | 'ai_signal' | 'derived',
    fieldId: qs.fieldId,
    value: qs.value,
    signalKey: qs.signalKey,
    formula: qs.formula,
    // T-131 (R2-2): catalogue semantics — unanswered field = quantity 0
    missingMeansZero: qs.missingMeansZero === true ? true : undefined,
  }
}

/**
 * T-126: form-bound step condition. Requires BOTH a fieldId and a comparison
 * value — a partial condition would silently drop the step at pricing time
 * (the exact hardcore-F7 failure this exists to prevent).
 */
function normalizeStepWhen(when: WorkStepInput['when']): ServiceDraftConfig['pricing']['workSteps'][0]['when'] | undefined {
  if (!when?.fieldId) return undefined
  const compare = when.equals ?? when.value
  if (compare === undefined || compare === null || compare === '') return undefined
  const validOps = ['equals', 'contains', 'gt', 'lt', 'gte', 'lte'] as const
  return {
    fieldId: when.fieldId,
    operator: validOps.includes(when.operator as typeof validOps[number])
      ? (when.operator as typeof validOps[number])
      : 'equals',
    equals: when.equals,
    value: when.value,
  }
}

function normalizeTriggerCondition(tc: WorkStepInput['triggerCondition']): ServiceDraftConfig['pricing']['workSteps'][0]['triggerCondition'] | undefined {
  if (!tc || !tc.operator) return undefined
  const validOps = ['equals', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'] as const
  if (!validOps.includes(tc.operator as typeof validOps[number])) return undefined
  return {
    operator: tc.operator as 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists',
    value: tc.value,
  }
}

export function normalizeWorkSteps(steps: WorkStepInput[]): ServiceDraftConfig['pricing']['workSteps'] {
  return steps
    .filter(step => (step.name || step.label || '').length > 0)
    .map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      name: (step.name || step.label)!,
      description: step.description || (step.name || step.label)!,
      costType: (['fixed', 'per_unit', 'per_hour', 'percent', 'credit'] as const).includes(step.costType as 'fixed' | 'per_unit' | 'per_hour' | 'percent' | 'credit')
        ? (step.costType as 'fixed' | 'per_unit' | 'per_hour' | 'percent' | 'credit')
        : 'fixed',
      // ?? chain, ending at 0: a missing cost must surface as £0 (visible),
      // never be invented (previously defaulted to 25)
      defaultCost: Math.max(0, step.defaultCost ?? step.cost ?? step.price ?? 0),
      // T-131 (F2b): stated cost band (from-prices/ranges) — never invented
      costBand:
        step.costBand &&
        typeof step.costBand.low === 'number' && typeof step.costBand.high === 'number' &&
        step.costBand.low >= 0 && step.costBand.high > step.costBand.low
          ? { low: step.costBand.low, high: step.costBand.high }
          : undefined,
      // T-125: percent steps carry what the percentage applies to
      percentOf: step.costType === 'percent'
        ? (step.percentOf === 'subtotal' || (Array.isArray(step.percentOf) && step.percentOf.every((s) => typeof s === 'string'))
            ? step.percentOf
            : 'subtotal')
        : undefined,
      optional: step.optional || false,
      triggerSignal: step.optional ? step.triggerSignal : undefined,
      triggerCondition: step.optional ? normalizeTriggerCondition(step.triggerCondition) : undefined,
      when: normalizeStepWhen(step.when),
      quantitySource: normalizeQuantitySource(step.quantitySource),
      unitLabel: step.unitLabel || undefined,
    }))
}

interface AddonInput {
  name?: string
  price?: number
  description?: string
}

export function normalizeAddons(addons: AddonInput[]): ServiceDraftConfig['pricing']['addOns'] {
  return addons
    .filter(addon => addon.name && addon.name.length > 0)
    .map(addon => ({
      name: addon.name!,
      price: Math.max(0, addon.price || 0),
      description: addon.description || addon.name!,
    }))
}

interface ExpectedSignalInput {
  signalKey?: string
  type?: string
  possibleValues?: string[]
  description?: string
}

export function normalizeExpectedSignals(signals: ExpectedSignalInput[]): ServiceDraftConfig['expectedSignals'] {
  return signals
    .filter(signal => signal.signalKey && signal.signalKey.length > 0)
    .map(signal => ({
      signalKey: signal.signalKey!,
      type: (['number', 'enum', 'boolean', 'string'] as const).includes(signal.type as 'number' | 'enum' | 'boolean' | 'string')
        ? (signal.type as 'number' | 'enum' | 'boolean' | 'string')
        : 'string',
      possibleValues: signal.type === 'enum' ? signal.possibleValues : undefined,
      description: signal.description || signal.signalKey!,
    }))
}

interface SuggestedFieldInput {
  label?: string
  fieldId?: string
  type?: string
  required?: boolean
  options?: string[]
  helpText?: string
  criticalForPricing?: boolean
}

export function normalizeSuggestedFields(fields: SuggestedFieldInput[]): ServiceDraftConfig['suggestedFields'] {
  const validTypes = ['text', 'textarea', 'number', 'dropdown', 'radio', 'checkbox', 'boolean'] as const
  return fields
    .filter(field => field.label && field.label.length > 0)
    .map((field, index) => ({
      label: field.label!,
      fieldId: field.fieldId || `field_${index + 1}`,
      type: validTypes.includes(field.type as typeof validTypes[number])
        ? (field.type as typeof validTypes[number])
        : 'text',
      required: field.required || false,
      options: ['dropdown', 'radio', 'checkbox'].includes(field.type || '') ? field.options : undefined,
      helpText: field.helpText,
      criticalForPricing: field.criticalForPricing || false,
    }))
}

/**
 * Parse JSON from Gemini response — strips markdown fences and fixes common issues
 */
export function parseGeminiJson<T>(text: string): T {
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()

  // Extract the outermost JSON object or array
  const jsonMatch = cleaned.match(/[{[][\s\S]*[}\]]/) // match outermost JSON object or array
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }

  let jsonStr = jsonMatch[0]
  // Fix trailing commas before } or ] (common Gemini issue)
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1')

  return JSON.parse(jsonStr) as T
}

/**
 * Gemini API constants
 */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
export const DEFAULT_MODEL = 'gemini-2.5-flash'

/**
 * Call Gemini API with system prompt and user prompt
 */
export async function callGemini(opts: {
  apiKey: string
  systemPrompt: string
  userPrompt: string
  imageParts?: Array<{ inlineData: { mimeType: string; data: string } }>
  temperature?: number
  maxOutputTokens?: number
}): Promise<string> {
  const url = `${GEMINI_API_BASE}/${DEFAULT_MODEL}:generateContent?key=${opts.apiKey}`

  const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = []
  if (opts.imageParts) {
    userParts.push(...opts.imageParts)
  }
  userParts.push({ text: opts.userPrompt })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: userParts,
        },
      ],
      systemInstruction: {
        parts: [{ text: opts.systemPrompt }],
      },
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxOutputTokens ?? 4096,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) {
    throw new Error('No response from Gemini')
  }

  return text
}
