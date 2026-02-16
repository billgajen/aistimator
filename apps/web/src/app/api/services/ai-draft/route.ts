import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceDraftConfig, DocumentType } from '@estimator/shared'
import { validateAndNormalizeDraft, parseGeminiJson, GEMINI_API_BASE, DEFAULT_MODEL } from './shared'

/**
 * POST /api/services/ai-draft
 * Generate an AI draft configuration for a new service
 */

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

  const draft = parseGeminiJson<ServiceDraftConfig>(text)
  return validateAndNormalizeDraft(draft)
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
