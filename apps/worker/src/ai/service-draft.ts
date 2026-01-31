/**
 * AI Service Draft Generation
 *
 * Generates complete starter blueprints for services based on
 * service name and description using Gemini.
 *
 * AI generates sensible defaults for:
 * - Scope (included, excluded, assumptions)
 * - Media requirements (photo guidance, angles)
 * - Pricing model (fixed, per-unit, tiered, inspection-first)
 * - Work steps (standard operations with cost rules)
 * - Expected signals (what AI should extract)
 * - Suggested widget fields
 */

import { GeminiClient } from './gemini'
import type {
  ServiceDraftConfig,
  WorkStepConfig,
  ExpectedSignalConfig,
  DocumentType,
} from '@estimator/shared'

/**
 * Request for AI draft generation
 */
export interface ServiceDraftRequest {
  serviceName: string
  description: string
  documentType?: DocumentType
}

/**
 * System prompt for service draft generation
 */
const SERVICE_DRAFT_SYSTEM_PROMPT = `You are an expert business consultant helping service businesses configure their instant estimate system.

Your job is to generate a complete, sensible default configuration for a service based on its name and description.

IMPORTANT PRINCIPLES:
1. Make educated guesses based on common industry practices
2. Be conservative with pricing - it's better to start lower and adjust up
3. Focus on the most common scenarios for this type of service
4. Keep lists concise (max 6 items for scope, max 5 work steps)
5. Work steps should represent distinct billable activities, not sub-tasks
6. Expected signals should be things AI can actually extract from photos
7. Suggested fields should collect critical information for accurate pricing

PRICING MODEL GUIDELINES:
- "fixed": Use for services with predictable scope (e.g., basic car wash, standard lawn mow)
- "per_unit": Use when price scales with quantity (e.g., per sqft, per item, per window)
- "tiered": Use when pricing varies by size/complexity brackets (e.g., small/medium/large room)
- "inspection_first": Use for complex services requiring assessment (e.g., major repairs, renovations)

WORK STEP GUIDELINES:
- Each step should be a distinct operation the business performs
- Use "fixed" cost type for setup/prep steps
- Use "per_unit" cost type for scaling work (e.g., per item, per sqft)
- Use "per_hour" cost type for time-based work
- Optional steps should have trigger signals

SIGNAL GUIDELINES:
- Signals must be extractable from photos or form inputs
- Common signals: item_count, surface_area, condition_rating, complexity_level
- Use enum type for categorical signals (e.g., severity: low/medium/high)
- Use number type for measurements and counts
- Use boolean type for presence/absence conditions`

/**
 * Build the user prompt for draft generation
 */
function buildDraftPrompt(request: ServiceDraftRequest): string {
  return `Generate a complete configuration blueprint for this service:

SERVICE NAME: ${request.serviceName}
DESCRIPTION: ${request.description}
DOCUMENT TYPE: ${request.documentType || 'instant_estimate'}

Return a JSON object with this exact structure:

{
  "scope": {
    "included": ["list of 3-6 things included in this service"],
    "excluded": ["list of 3-6 things NOT included"],
    "assumptions": ["list of 3-6 assumptions for accurate pricing"]
  },
  "media": {
    "minPhotos": 1,
    "maxPhotos": 8,
    "photoGuidance": "Brief guidance on what photos to take",
    "requiredAngles": [
      { "id": "angle_id", "label": "What to photograph", "guidance": "How to take the photo" }
    ]
  },
  "pricing": {
    "pricingModel": "fixed|per_unit|tiered|inspection_first",
    "unitType": "sqft|sqm|room|item|hour|linear_ft|linear_m|null",
    "baseFee": 0,
    "minimumCharge": 50,
    "workSteps": [
      {
        "id": "step_id",
        "name": "Step Name",
        "description": "What this step involves",
        "costType": "fixed|per_unit|per_hour",
        "defaultCost": 25,
        "optional": false,
        "triggerSignal": "signal_key_if_optional",
        "triggerCondition": { "operator": "equals|gt|gte|exists", "value": "value_if_needed" }
      }
    ],
    "addOns": [
      { "name": "Addon Name", "price": 25, "description": "What this addon provides" }
    ],
    "siteVisit": {
      "alwaysRecommend": false,
      "confidenceBelowPct": 60,
      "estimateAbove": 1000
    }
  },
  "expectedSignals": [
    {
      "signalKey": "signal_name",
      "type": "number|enum|boolean|string",
      "possibleValues": ["for", "enum", "types"],
      "description": "What this signal represents"
    }
  ],
  "suggestedFields": [
    {
      "label": "Field Label",
      "fieldId": "field_id",
      "type": "text|textarea|number|dropdown|radio|checkbox|boolean",
      "required": true,
      "options": ["for", "dropdown", "radio"],
      "helpText": "Help text for the field",
      "criticalForPricing": true,
      "mapsToSignal": "signal_key_from_expectedSignals"
    }
  ]
}

IMPORTANT:
- Keep scope lists to max 6 items each
- Keep work steps to max 5
- Keep expected signals to max 6
- Keep suggested fields to max 6
- Use realistic pricing for the industry
- Include at least one required photo angle
- Make the configuration usable out-of-the-box with minimal editing

CRITICAL FOR PRICING TO WORK:
- For fields marked criticalForPricing, you MUST set "mapsToSignal" to the corresponding signalKey from expectedSignals
- Example: If expectedSignals has signalKey "total_area_sqft", the field collecting square footage MUST have mapsToSignal: "total_area_sqft"
- The fieldId can be human-readable (e.g., "room_sizes") but mapsToSignal must match the exact signalKey
- This explicit mapping ensures form inputs are correctly used in pricing calculations

Respond with ONLY the JSON object, no other text.`
}

/**
 * Generate AI draft configuration for a service
 */
export async function generateServiceDraft(
  client: GeminiClient,
  request: ServiceDraftRequest
): Promise<ServiceDraftConfig> {
  console.log(`[ServiceDraft] Generating draft for "${request.serviceName}"`)

  const prompt = buildDraftPrompt(request)
  const response = await client.generateText(prompt, SERVICE_DRAFT_SYSTEM_PROMPT)

  try {
    const draft = GeminiClient.parseJSON<ServiceDraftConfig>(response)
    return validateAndNormalizeDraft(draft, request)
  } catch (error) {
    console.error('[ServiceDraft] Failed to parse AI response:', error)
    console.error('[ServiceDraft] Raw response:', response)
    throw new Error('Failed to generate service draft configuration')
  }
}

/**
 * Validate and normalize the AI-generated draft
 */
function validateAndNormalizeDraft(
  draft: Partial<ServiceDraftConfig>,
  _request: ServiceDraftRequest
): ServiceDraftConfig {
  // Ensure scope
  const scope = {
    included: truncateArray(draft.scope?.included || ['Standard service'], 6),
    excluded: truncateArray(draft.scope?.excluded || ['Additional services'], 6),
    assumptions: truncateArray(draft.scope?.assumptions || ['Standard conditions'], 6),
  }

  // Ensure media
  const media = {
    minPhotos: Math.max(0, Math.min(5, draft.media?.minPhotos || 1)),
    maxPhotos: Math.max(1, Math.min(10, draft.media?.maxPhotos || 8)),
    photoGuidance: draft.media?.photoGuidance || 'Please upload clear photos of the area or items that need service.',
    requiredAngles: truncateArray(draft.media?.requiredAngles || [
      { id: 'overview', label: 'Full view', guidance: 'Stand back and capture the entire area' }
    ], 4),
  }

  // Ensure pricing
  const pricingModel = ['fixed', 'per_unit', 'tiered', 'inspection_first'].includes(draft.pricing?.pricingModel || '')
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

  // Ensure suggested fields and sync with expected signals
  const normalizedFields = normalizeSuggestedFields(draft.suggestedFields || [])
  const suggestedFields = truncateArray(
    syncFieldsWithSignals(normalizedFields, expectedSignals),
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
 * Sync suggestedFields with expectedSignals by setting mapsToSignal
 * This ensures form inputs are correctly mapped to signals for pricing
 * The fieldId stays human-readable, but mapsToSignal provides explicit mapping
 */
function syncFieldsWithSignals(
  fields: ServiceDraftConfig['suggestedFields'],
  signals: ExpectedSignalConfig[]
): ServiceDraftConfig['suggestedFields'] {
  if (signals.length === 0) return fields

  // Build a map of normalized signal keys to actual signal keys
  const signalKeyMap = new Map<string, string>()
  for (const signal of signals) {
    const normalized = signal.signalKey.toLowerCase().replace(/[_\s]/g, '')
    signalKeyMap.set(normalized, signal.signalKey)
  }

  return fields.map(field => {
    // If mapsToSignal is already set by AI, validate it
    if (field.mapsToSignal) {
      const validSignal = signals.find(s => s.signalKey === field.mapsToSignal)
      if (validSignal) {
        console.log(`[ServiceDraft] Field "${field.fieldId}" maps to signal "${field.mapsToSignal}"`)
        return field
      } else {
        console.log(`[ServiceDraft] Invalid mapsToSignal "${field.mapsToSignal}" for field "${field.fieldId}", will attempt to find match`)
      }
    }

    // Only auto-sync fields that are critical for pricing
    if (!field.criticalForPricing) return field

    const normalizedFieldId = field.fieldId.toLowerCase().replace(/[_\s]/g, '')

    // Try exact normalized match first
    if (signalKeyMap.has(normalizedFieldId)) {
      const matchingSignalKey = signalKeyMap.get(normalizedFieldId)!
      console.log(`[ServiceDraft] Auto-mapping field "${field.fieldId}" to signal "${matchingSignalKey}" (exact match)`)
      return { ...field, mapsToSignal: matchingSignalKey }
    }

    // Try semantic matching for common patterns
    const semanticMatches: Record<string, string[]> = {
      'totalareasqft': ['roomsizessqft', 'areasqft', 'squarefootage', 'totalsqft', 'roomsizes', 'area'],
      'totalarea': ['roomsizes', 'area', 'sqft', 'squarefootage', 'size'],
      'hasstairs': ['staircasepresent', 'stairs', 'staircase', 'hasstaircase'],
      'requiresfurnituremoving': ['furnituremovingneeded', 'furnituremovingrequired', 'furnituremoving', 'movefurniture'],
      'itemcount': ['numberofitems', 'quantity', 'count', 'items'],
      'staircount': ['numberofstairs', 'stairs', 'stairscount'],
    }

    // Check if this field matches a known pattern for any signal
    for (const signal of signals) {
      const normalizedSignalKey = signal.signalKey.toLowerCase().replace(/[_\s]/g, '')
      const patterns = semanticMatches[normalizedSignalKey] || []

      if (patterns.includes(normalizedFieldId)) {
        console.log(`[ServiceDraft] Auto-mapping field "${field.fieldId}" to signal "${signal.signalKey}" (semantic match)`)
        return { ...field, mapsToSignal: signal.signalKey }
      }
    }

    console.log(`[ServiceDraft] Warning: Could not find signal mapping for critical field "${field.fieldId}"`)
    return field
  })
}

/**
 * Truncate array to max length
 */
function truncateArray<T>(arr: T[], max: number): T[] {
  return arr.slice(0, max)
}

/**
 * Normalize work steps
 */
function normalizeWorkSteps(steps: Partial<WorkStepConfig>[]): WorkStepConfig[] {
  return steps
    .filter(step => step.name && step.name.length > 0)
    .map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      name: step.name!,
      description: step.description || step.name!,
      costType: (['fixed', 'per_unit', 'per_hour'] as const).includes(step.costType as 'fixed' | 'per_unit' | 'per_hour')
        ? (step.costType as 'fixed' | 'per_unit' | 'per_hour')
        : 'fixed',
      defaultCost: Math.max(0, step.defaultCost || 25),
      optional: step.optional || false,
      triggerSignal: step.optional ? step.triggerSignal : undefined,
      triggerCondition: step.optional && step.triggerCondition ? step.triggerCondition : undefined,
    }))
}

/**
 * Normalize addons
 */
function normalizeAddons(addons: Array<{ name: string; price: number; description?: string }>): Array<{ name: string; price: number; description: string }> {
  return addons
    .filter(addon => addon.name && addon.name.length > 0)
    .map(addon => ({
      name: addon.name,
      price: Math.max(0, addon.price || 0),
      description: addon.description || addon.name,
    }))
}

/**
 * Normalize expected signals
 */
function normalizeExpectedSignals(signals: Partial<ExpectedSignalConfig>[]): ExpectedSignalConfig[] {
  return signals
    .filter(signal => signal.signalKey && signal.signalKey.length > 0)
    .map(signal => ({
      signalKey: signal.signalKey!,
      type: (['number', 'enum', 'boolean', 'string'] as const).includes(signal.type as 'number' | 'enum' | 'boolean' | 'string')
        ? signal.type!
        : 'string',
      possibleValues: signal.type === 'enum' ? signal.possibleValues : undefined,
      description: signal.description || signal.signalKey!,
    }))
}

/**
 * Normalize suggested fields
 */
function normalizeSuggestedFields(fields: ServiceDraftConfig['suggestedFields']): ServiceDraftConfig['suggestedFields'] {
  return fields
    .filter(field => field.label && field.label.length > 0)
    .map((field, index) => ({
      label: field.label,
      fieldId: field.fieldId || `field_${index + 1}`,
      type: (['text', 'textarea', 'number', 'dropdown', 'radio', 'checkbox', 'boolean'] as const)
        .includes(field.type as 'text' | 'textarea' | 'number' | 'dropdown' | 'radio' | 'checkbox' | 'boolean')
        ? field.type
        : 'text',
      required: field.required || false,
      options: ['dropdown', 'radio', 'checkbox'].includes(field.type) ? field.options : undefined,
      helpText: field.helpText,
      criticalForPricing: field.criticalForPricing || false,
      mapsToSignal: field.mapsToSignal, // Preserve AI-generated mapping
    }))
}

/**
 * Get a fallback draft when AI fails
 */
export function getFallbackDraft(request: ServiceDraftRequest): ServiceDraftConfig {
  return {
    scope: {
      included: [`Standard ${request.serviceName.toLowerCase()} service`],
      excluded: ['Additional services not specified'],
      assumptions: ['Standard conditions apply', 'Access is available'],
    },
    media: {
      minPhotos: 1,
      maxPhotos: 8,
      photoGuidance: 'Please upload clear photos of the area or items that need service.',
      requiredAngles: [
        { id: 'overview', label: 'Full view', guidance: 'Capture the entire area' }
      ],
    },
    pricing: {
      pricingModel: 'fixed',
      unitType: null,
      baseFee: 0,
      minimumCharge: 50,
      workSteps: [
        {
          id: 'service_delivery',
          name: 'Service Delivery',
          description: 'Main service work',
          costType: 'fixed',
          defaultCost: 100,
          optional: false,
        }
      ],
      addOns: [],
      siteVisit: {
        alwaysRecommend: false,
        confidenceBelowPct: 60,
        estimateAbove: 1000,
      },
    },
    expectedSignals: [
      {
        signalKey: 'condition_rating',
        type: 'enum',
        possibleValues: ['good', 'fair', 'poor'],
        description: 'Overall condition assessment',
      }
    ],
    suggestedFields: [
      {
        label: 'Project Description',
        fieldId: '_project_description',
        type: 'textarea',
        required: true,
        helpText: 'Please describe what you need done',
        criticalForPricing: true,
      }
    ],
  }
}
