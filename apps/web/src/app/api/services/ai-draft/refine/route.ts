import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceDraftConfig } from '@estimator/shared'
import { validateAndNormalizeDraft, callGemini, parseGeminiJson } from '../shared'

/**
 * POST /api/services/ai-draft/refine
 * Refine a service draft config via natural language chat
 */

const REFINE_SYSTEM_PROMPT = `You are an expert pricing consultant helping a business refine their service configuration.

You receive the current service configuration and a natural language instruction from the business owner.
Your job is to modify the configuration according to their instruction and return the updated config.

RULES:
- Only modify what the user asks for — preserve everything else
- If they say "add a line item", add to workSteps
- If they mention prices, update defaultCost accordingly
- If they mention minimum charges, update minimumCharge
- If they mention discounts or adjustments, consider using multipliers or adjusting prices
- If they mention customer questions, add/modify suggestedFields
- Keep all IDs stable when modifying existing items (don't regenerate IDs)
- Return the COMPLETE updated config, not just changed fields

LINKING WORK STEPS TO QUANTITIES:
When the user wants a work step's cost to depend on a measurement or quantity (e.g., "price per linear foot of gutter", "based on number of bedrooms"):
- Set the work step's costType to "per_unit"
- Add a quantitySource object to the work step using this PRIORITY ORDER:
  1. FIRST CHOICE — form_field: Check if a matching suggestedField already exists (e.g., "Approximate Gutter Length" for gutter-related steps, "Number of Bedrooms" for bedroom-based pricing). If yes, use { "type": "form_field", "fieldId": "<that_field's_fieldId>" }. If no matching field exists, CREATE one in suggestedFields with an appropriate label, type "number", and required: true, then link to it.
  2. LAST RESORT — ai_signal: Only use { "type": "ai_signal", "signalKey": "<signal_key>" } when the quantity truly cannot be asked as a customer question (rare). AI signals are estimated from photos/text and are less reliable.
  3. constant: Use { "type": "constant", "value": <number> } for fixed quantities (e.g., always 1 for a flat item).
- Set unitLabel to describe the unit (e.g., "linear ft", "bedrooms", "sq ft")
- IMPORTANT: form_field is deterministic (customer provides exact value) while ai_signal is an estimate. Always prefer form_field.

Return ONLY a JSON object with the updated ServiceDraftConfig.`

interface RefineRequest {
  message: string
  currentConfig: ServiceDraftConfig
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
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

    const body: RefineRequest = await request.json()

    if (!body.message?.trim()) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'message is required' } },
        { status: 400 }
      )
    }

    if (!body.currentConfig) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'currentConfig is required' } },
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

    // Build conversation context
    const historyContext = (body.conversationHistory || [])
      .slice(-6) // Keep last 6 messages for context
      .map(m => `${m.role === 'user' ? 'Business' : 'Assistant'}: ${m.content}`)
      .join('\n')

    const userPrompt = `Current service configuration:
\`\`\`json
${JSON.stringify(body.currentConfig, null, 2)}
\`\`\`

${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}Business owner says: "${body.message}"

Apply the requested changes and return the COMPLETE updated ServiceDraftConfig as JSON.
Also include a brief "explanation" field describing what you changed.

Return format:
{
  "updatedConfig": { ... complete ServiceDraftConfig ... },
  "explanation": "Brief description of changes made"
}`

    const responseText = await callGemini({
      apiKey,
      systemPrompt: REFINE_SYSTEM_PROMPT,
      userPrompt,
      temperature: 0.5,
      maxOutputTokens: 4096,
    })

    const result = parseGeminiJson<{
      updatedConfig: Partial<ServiceDraftConfig>
      explanation?: string
    }>(responseText)

    const updatedConfig = validateAndNormalizeDraft(result.updatedConfig || body.currentConfig)

    return NextResponse.json({
      updatedConfig,
      explanation: result.explanation || 'Configuration updated.',
      conversationHistory: [
        ...(body.conversationHistory || []),
        { role: 'user' as const, content: body.message },
        { role: 'assistant' as const, content: result.explanation || 'Configuration updated.' },
      ],
    })
  } catch (error) {
    console.error('Refine error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to refine configuration' } },
      { status: 500 }
    )
  }
}
