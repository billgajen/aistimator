import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type {
  ServiceDraftConfig,
  AddonConfig,
  MultiplierConfig,
} from '@estimator/shared'
import { validateAndNormalizeDraftBulk, callGemini, parseGeminiJson } from '../shared'

/**
 * POST /api/services/ai-draft/compile (T-104, AD-021/AD-024)
 *
 * Compiles a plain-language pricing description into the deterministic
 * pricing configuration. The AI authors config ONCE at compile time; the
 * review summary shown to the business is rendered deterministically from
 * the compiled output (lib/pricing-describe.ts), never by the AI.
 *
 * Where the description is ambiguous the AI must ASK (ambiguities[]),
 * not invent numbers.
 */

const COMPILE_SYSTEM_PROMPT = `You are an expert pricing engineer. A business owner describes how they charge for a service in plain language (typed text, or pasted from a price list). You compile that description into a structured pricing configuration that a deterministic rules engine executes.

CORE RULES:
1. NEVER invent prices, rates, thresholds, or percentages that the owner did not state. If a number is missing or unclear, omit that item from the config and add a specific question to "ambiguities".
1b. EVERY instruction in the description MUST be either applied or asked about — NEVER silently ignored. When the owner refers to an existing charge colloquially ("the room rate", "my hourly rate", "the per-metre price", "the call-out fee"), map it to the closest matching item in currentConfig by unit and meaning (e.g. "room rate" → the per-room work step; "call-out fee" → baseFee) and apply the change to it. If no confident match exists, add an ambiguity naming the options: "By 'room rate' did you mean 'Walls & ceilings' (£200/room)?"
2. Every chargeable item in the description becomes a work step:
   - Flat charges → costType "fixed" with defaultCost
   - Rates ("£12 per sqm", "$50/hour") → costType "per_unit" (or "per_hour") with defaultCost = the rate and a clear unitLabel
3. QUANTITY SOURCES for per-unit steps, in priority order:
   a. form_field (STRONGLY PREFERRED — deterministic): create a matching question in suggestedFields (type "number", required, criticalForPricing: true) and link via { "type": "form_field", "fieldId": "<fieldId>" }
   b. ai_signal (only when the customer genuinely can't answer, e.g. "amount of moss coverage"): add a matching entry to expectedSignals and link via { "type": "ai_signal", "signalKey": "<key>" }
   c. constant for fixed quantities
4. Conditional charges ("add X when Y", "extra for Z") become either:
   - An optional work step with triggerSignal + triggerCondition (when the condition comes from photos/AI), OR
   - A multiplier (when the condition comes from a customer answer): { "when": { "fieldId": "<fieldId>", "operator": "equals|gt|gte|lt|lte", "equals": <value> }, "multiplier": <number> } — create the customer question in suggestedFields if it doesn't exist. Percentage adjustments become multipliers ("add 20%" → 1.2, "10% discount" → 0.9).
5. Optional extras the CUSTOMER chooses ("rush service +£50") become addons: { "label": ..., "price": ... }. Add triggerKeywords only for phrases a customer would plausibly type.
6. "Minimum charge", "minimum job", "call-out fee": call-out/base fees → baseFee; minimum totals → minimumCharge.
7. Field IDs: short snake_case (e.g. "wall_area_sqm"). Signal keys likewise. Keep IDs stable if currentConfig already defines matching items.
8. Preserve anything in currentConfig that the description doesn't contradict — this may be a partial edit, not a rewrite.
9. suggestedFields must contain every field referenced by a quantitySource or multiplier. expectedSignals must contain every signal referenced by a triggerSignal or ai_signal quantity source.

Return ONLY JSON, exactly in the shape below. Work steps live at updatedConfig.pricing.workSteps (NOT at the top of updatedConfig), each with "name" (not "label"). The "instructions" array comes FIRST and MUST contain one entry
per distinct instruction in the owner's description — this is your accounting: every
instruction is either applied (say exactly where) or asked about in "ambiguities".
An instruction that appears in neither place is a failure.
{
  "instructions": [
    { "instruction": "quoted from the description", "action": "applied", "target": "which config item changed and to what" },
    { "instruction": "...", "action": "ambiguous", "target": "why — with the matching question in ambiguities" }
  ],
  "updatedConfig": {
    "scope": { "included": ["..."], "excluded": ["..."], "assumptions": ["..."] },
    "media": { "minPhotos": 1, "maxPhotos": 8, "photoGuidance": "..." },
    "pricing": {
      "pricingModel": "fixed|per_unit|tiered|inspection_first",
      "baseFee": 0,
      "minimumCharge": 0,
      "workSteps": [ { "id": "snake_case_id", "name": "...", "costType": "fixed|per_unit|per_hour", "defaultCost": 0, "unitLabel": "sqm", "optional": false, "quantitySource": { "type": "form_field", "fieldId": "..." } } ]
    },
    "expectedSignals": [ { "signalKey": "...", "type": "number|enum|boolean|string", "description": "..." } ],
    "suggestedFields": [ { "fieldId": "...", "label": "...", "type": "number|text|dropdown|radio|boolean", "required": true, "criticalForPricing": true, "options": ["only for dropdown/radio"] } ]
  },
  "addons": [ { "label": "...", "price": 0, "triggerKeywords": ["..."] } ],
  "multipliers": [ { "when": { "fieldId": "...", "operator": "equals", "equals": "..." }, "multiplier": 1.2 } ],
  "ambiguities": [ "Specific question about missing/unclear information" ]
}`

interface CompileRequest {
  description: string
  serviceName?: string
  serviceDescription?: string
  currentConfig?: Partial<ServiceDraftConfig>
  currentAddons?: AddonConfig[]
  currentMultipliers?: MultiplierConfig[]
  currency?: string
}

interface CompileAIResponse {
  /** Per-instruction accounting — forces the model to handle every instruction */
  instructions?: Array<{ instruction?: string; action?: string; target?: string }>
  updatedConfig?: Partial<ServiceDraftConfig>
  addons?: Array<{ label?: string; price?: number; triggerKeywords?: string[] }>
  multipliers?: Array<{
    when?: { fieldId?: string; operator?: string; equals?: string | number | boolean; value?: string | number }
    multiplier?: number
  }>
  ambiguities?: string[]
}

function normalizeAddons(addons: CompileAIResponse['addons']): AddonConfig[] {
  return (addons || [])
    .filter((a) => a.label && a.label.trim().length > 0 && typeof a.price === 'number' && a.price >= 0)
    .slice(0, 10)
    .map((a, index) => ({
      id: `addon_${Date.now()}_${index}`,
      label: a.label!.trim(),
      price: a.price!,
      triggerKeywords: a.triggerKeywords?.filter((k) => k && k.trim().length > 0).slice(0, 6),
    }))
}

function normalizeMultipliers(multipliers: CompileAIResponse['multipliers']): MultiplierConfig[] {
  const validOps = ['equals', 'contains', 'gt', 'lt', 'gte', 'lte']
  return (multipliers || [])
    .filter(
      (m) =>
        m.when?.fieldId &&
        typeof m.multiplier === 'number' &&
        m.multiplier > 0 &&
        m.multiplier < 10
    )
    .slice(0, 8)
    .map((m) => ({
      when: {
        fieldId: m.when!.fieldId!,
        operator: validOps.includes(m.when!.operator || '') ? m.when!.operator : 'equals',
        equals: m.when!.equals,
        value: m.when!.value,
      },
      multiplier: m.multiplier!,
    }))
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

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

    const body: CompileRequest = await request.json()

    if (!body.description?.trim()) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'description is required' } },
        { status: 400 }
      )
    }

    if (body.description.length > 20000) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'description is too long (max 20,000 characters)' } },
        { status: 400 }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: { code: 'AI_NOT_CONFIGURED', message: 'AI service not configured' } },
        { status: 503 }
      )
    }

    const contextParts: string[] = []
    if (body.serviceName) {
      contextParts.push(`Service: ${body.serviceName}`)
    }
    if (body.serviceDescription) {
      contextParts.push(`Service description: ${body.serviceDescription}`)
    }
    if (body.currency) {
      contextParts.push(`Currency: ${body.currency}`)
    }
    if (body.currentConfig) {
      // Keys deliberately distinct from the response schema — verification found
      // Gemini mirrors this wrapper shape into updatedConfig when they match
      contextParts.push(
        `Current configuration (preserve anything not contradicted):\n\`\`\`json\n${JSON.stringify(
          {
            currentDraftConfig: body.currentConfig,
            currentAddons: body.currentAddons || [],
            currentMultipliers: body.currentMultipliers || [],
          },
          null,
          2
        )}\n\`\`\``
      )
    }

    const userPrompt = `${contextParts.join('\n')}

The business owner describes their pricing:
"""
${body.description}
"""

Compile this into the pricing configuration. Remember: never invent numbers — ask via "ambiguities" instead.`

    const responseText = await callGemini({
      apiKey,
      systemPrompt: COMPILE_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.2, // compilation should be precise, not creative
      // 2.5-flash thinking tokens count against this budget (same trap as the
      // measurement 4096 truncation) — 16384 leaves headroom for long price lists
      maxOutputTokens: 16384,
    })

    const result = parseGeminiJson<CompileAIResponse>(responseText)
    if (result.instructions?.length) {
      console.log(
        '[Compile] Instruction accounting:',
        result.instructions.map((i) => `"${i.instruction}" -> ${i.action}: ${i.target}`).join(' | ')
      )
    }

    // Defensive unwrap (verification finding): despite the schema, Gemini may nest
    // the draft under updatedConfig.config (mirroring the context wrapper) and/or
    // place addons/multipliers inside updatedConfig instead of at the top level.
    const rawUpdated = result.updatedConfig as
      | (Partial<ServiceDraftConfig> & {
          config?: Partial<ServiceDraftConfig>
          addons?: CompileAIResponse['addons']
          multipliers?: CompileAIResponse['multipliers']
        })
      | undefined
    const updatedDraft = rawUpdated?.config ?? rawUpdated
    const responseAddons = result.addons?.length ? result.addons : rawUpdated?.addons
    const responseMultipliers = result.multipliers?.length ? result.multipliers : rawUpdated?.multipliers

    // Shape-drift tolerance (hardcore-test finding, 2026-07-20): the model
    // sometimes emits workSteps at the draft root instead of under pricing —
    // which used to silently discard the ENTIRE compilation.
    if (updatedDraft) {
      const rootSteps = (updatedDraft as { workSteps?: unknown[] }).workSteps
      if (Array.isArray(rootSteps) && rootSteps.length && !updatedDraft.pricing?.workSteps?.length) {
        updatedDraft.pricing = {
          ...(updatedDraft.pricing ?? {}),
          workSteps: rootSteps,
        } as ServiceDraftConfig['pricing']
      }
    }

    console.log(
      '[Compile] workStep costs:',
      (updatedDraft?.pricing?.workSteps || []).map((s) => `${s.name}=${s.defaultCost}`).join(',')
    )

    // Normalize through the same pipeline every other AI-draft path uses.
    // Start from currentConfig so scope/media survive when the AI omits them.
    const merged: Partial<ServiceDraftConfig> = {
      ...body.currentConfig,
      ...updatedDraft,
    }
    // Bulk limits (10 steps/fields) — pasted price lists often have many lines
    const updatedConfig = validateAndNormalizeDraftBulk(merged)

    return NextResponse.json({
      updatedConfig,
      addons: normalizeAddons(responseAddons),
      multipliers: normalizeMultipliers(responseMultipliers),
      ambiguities: (result.ambiguities || []).filter((a) => a && a.trim().length > 0).slice(0, 8),
    })
  } catch (error) {
    console.error('Compile error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to compile pricing description' } },
      { status: 500 }
    )
  }
}
