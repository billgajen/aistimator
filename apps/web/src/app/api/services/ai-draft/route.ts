import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceDraftConfig, DocumentType } from '@estimator/shared'

/**
 * POST /api/services/ai-draft
 * Generate an AI draft configuration for a new service
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-2.0-flash'

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

interface DraftRequest {
  serviceName: string
  description: string
  documentType?: DocumentType
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Parse request body
    const body: DraftRequest = await request.json()

    if (!body.serviceName || body.serviceName.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Service name is required' } },
        { status: 400 }
      )
    }

    if (!body.description || body.description.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Service description is required' } },
        { status: 400 }
      )
    }

    // Check for Gemini API key
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      console.warn('[AI Draft] Gemini API key not configured, returning fallback draft')
      return NextResponse.json({ draft: getFallbackDraft(body) })
    }

    // Generate draft using Gemini
    try {
      const draft = await generateServiceDraft(apiKey, body)
      return NextResponse.json({ draft })
    } catch (aiError) {
      console.error('[AI Draft] AI generation failed:', aiError)
      // Return fallback on AI failure
      return NextResponse.json({ draft: getFallbackDraft(body) })
    }
  } catch (error) {
    console.error('AI Draft error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * Generate service draft using Gemini API
 */
async function generateServiceDraft(
  apiKey: string,
  request: DraftRequest
): Promise<ServiceDraftConfig> {
  const prompt = buildDraftPrompt(request)

  const url = `${GEMINI_API_BASE}/${DEFAULT_MODEL}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: SERVICE_DRAFT_SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
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

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }

  const draft = JSON.parse(jsonMatch[0]) as ServiceDraftConfig
  return validateAndNormalizeDraft(draft, request)
}

/**
 * Build the prompt for draft generation
 */
function buildDraftPrompt(request: DraftRequest): string {
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
        "optional": false
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
      "criticalForPricing": true
    }
  ]
}

IMPORTANT:
- Keep scope lists to max 6 items each
- Keep work steps to max 5
- Keep expected signals to max 6
- Keep suggested fields to max 6
- Use realistic pricing for the industry

Respond with ONLY the JSON object, no other text.`
}

/**
 * Validate and normalize the AI-generated draft
 */
function validateAndNormalizeDraft(
  draft: Partial<ServiceDraftConfig>,
  _request: DraftRequest
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

function truncateArray<T>(arr: T[], max: number): T[] {
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
}

function normalizeWorkSteps(steps: WorkStepInput[]): ServiceDraftConfig['pricing']['workSteps'] {
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
    }))
}

interface AddonInput {
  name?: string
  price?: number
  description?: string
}

function normalizeAddons(addons: AddonInput[]): ServiceDraftConfig['pricing']['addOns'] {
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

function normalizeExpectedSignals(signals: ExpectedSignalInput[]): ServiceDraftConfig['expectedSignals'] {
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

function normalizeSuggestedFields(fields: SuggestedFieldInput[]): ServiceDraftConfig['suggestedFields'] {
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
 * Get a fallback draft when AI fails
 */
function getFallbackDraft(request: DraftRequest): ServiceDraftConfig {
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
