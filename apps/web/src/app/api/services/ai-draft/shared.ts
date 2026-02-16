/**
 * Shared utilities for AI draft validation and normalization.
 * Used by: ai-draft/route.ts, extract-services, extract-pricing, refine
 */

import type { ServiceDraftConfig } from '@estimator/shared'

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
    minimumCharge: Math.max(0, draft.pricing?.minimumCharge || 50),
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
  description?: string
  costType?: string
  defaultCost?: number
  cost?: number
  optional?: boolean
  triggerSignal?: string
  triggerCondition?: { operator: string; value?: string | number | boolean }
  quantitySource?: {
    type?: string
    fieldId?: string
    value?: number
    signalKey?: string
  }
  unitLabel?: string
}

function normalizeQuantitySource(qs: WorkStepInput['quantitySource']): ServiceDraftConfig['pricing']['workSteps'][0]['quantitySource'] | undefined {
  if (!qs || !qs.type) return undefined
  const validTypes = ['form_field', 'constant', 'ai_signal'] as const
  if (!validTypes.includes(qs.type as typeof validTypes[number])) return undefined
  return {
    type: qs.type as 'form_field' | 'constant' | 'ai_signal',
    fieldId: qs.fieldId,
    value: qs.value,
    signalKey: qs.signalKey,
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
    .filter(step => step.name && step.name.length > 0)
    .map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      name: step.name!,
      description: step.description || step.name!,
      costType: (['fixed', 'per_unit', 'per_hour'] as const).includes(step.costType as 'fixed' | 'per_unit' | 'per_hour')
        ? (step.costType as 'fixed' | 'per_unit' | 'per_hour')
        : 'fixed',
      defaultCost: Math.max(0, step.defaultCost || step.cost || 25),
      optional: step.optional || false,
      triggerSignal: step.optional ? step.triggerSignal : undefined,
      triggerCondition: step.optional ? normalizeTriggerCondition(step.triggerCondition) : undefined,
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
