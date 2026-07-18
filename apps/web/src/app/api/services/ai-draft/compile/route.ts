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

Return ONLY JSON:
{
  "updatedConfig": { ...complete ServiceDraftConfig (scope/media copied from currentConfig if provided)... },
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
      contextParts.push(
        `Current configuration (preserve anything not contradicted):\n\`\`\`json\n${JSON.stringify(
          { config: body.currentConfig, addons: body.currentAddons || [], multipliers: body.currentMultipliers || [] },
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
      maxOutputTokens: 8192,
    })

    const result = parseGeminiJson<CompileAIResponse>(responseText)

    // Normalize through the same pipeline every other AI-draft path uses.
    // Start from currentConfig so scope/media survive when the AI omits them.
    const merged: Partial<ServiceDraftConfig> = {
      ...body.currentConfig,
      ...result.updatedConfig,
    }
    // Bulk limits (10 steps/fields) — pasted price lists often have many lines
    const updatedConfig = validateAndNormalizeDraftBulk(merged)

    return NextResponse.json({
      updatedConfig,
      addons: normalizeAddons(result.addons),
      multipliers: normalizeMultipliers(result.multipliers),
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
