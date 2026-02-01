/**
 * AI Signal Recommendations
 *
 * Generates pricing recommendations for signals that were extracted by AI
 * but not used by any configured pricing work step.
 *
 * This allows the system to surface potential additional work to customers
 * even when the business hasn't configured explicit work steps for every signal.
 */

import type { GeminiClient } from './gemini'
import type { SignalRecommendation, WorkStepConfig } from '@estimator/shared'

/**
 * Unused signal detected from extraction
 */
export interface UnusedSignal {
  key: string
  value: string | number | boolean
  source: 'vision' | 'form' | 'nlp' | 'inferred'
  evidence: string
  confidence: number
}

/**
 * Form answer for filtering numeric signals
 */
export interface FormAnswerForFiltering {
  fieldId: string
  value: string | number | boolean | string[]
}

/**
 * Widget field for semantic matching
 */
export interface WidgetFieldForFiltering {
  fieldId: string
  label: string
  mapsToSignal?: string
}

/**
 * Context for generating recommendations
 */
export interface RecommendationContext {
  /** Work steps that ARE configured (for AI to understand pricing patterns) */
  workSteps?: WorkStepConfig[]
  /** Base rates for reference (if available) */
  baseRates?: Record<string, number>
  /** Service description for context */
  serviceDescription?: string
}

/**
 * Prompt template for generating signal recommendations
 *
 * IMPORTANT: All recommendations must use SOFT/CONDITIONAL phrasing because
 * these are AI suggestions, not confirmed requirements.
 *
 * AD-001 COMPLIANCE: AI does NOT set prices. Recommendations describe WHAT
 * might be needed, but actual pricing comes from business configuration.
 */
const SIGNAL_RECOMMENDATIONS_PROMPT = `You are an assistant helping identify POTENTIAL additional work that may be needed.

Service: {{SERVICE_NAME}}
{{SERVICE_DESCRIPTION}}

The customer's quote has been processed, but some signals extracted from their description/photos
weren't used in pricing because no work step is configured for them. These MAY indicate additional work needed.

Existing configured work steps (for reference):
{{WORK_STEPS}}

Unused signals that may need additional work:
{{UNUSED_SIGNALS}}

For each signal that genuinely implies additional work MIGHT be needed, describe what might be required.
Do NOT include any prices or cost estimates - the business will provide pricing separately.

Return JSON only, no explanation:
{
  "recommendations": [
    {
      "signalKey": "the signal key",
      "workDescription": "Brief description (e.g., 'Potential Insulation Removal')",
      "whatItInvolves": "Brief description of work involved (NO PRICES)",
      "reason": "MUST use conditional/soft language - see guidelines below"
    }
  ]
}

===== STRICT CONSTRAINTS (AD-009) =====
1. Return MAXIMUM 3 recommendations (pick most relevant to customer's stated problem)
2. workDescription: 3-5 words ONLY (e.g., "Potential Tile Replacement")
3. reason: ONE sentence, max 20 words
4. whatItInvolves: SHORT phrase describing the work (NO £ amounts or prices)

PRIORITIZATION (if more than 3 signals apply):
1. Items directly addressing customer's stated problem
2. Items with clear visual evidence in photos
3. Items with highest confidence signals

DO NOT include:
- Speculative items only tangentially related
- Items the customer didn't ask about
- Upsells disguised as recommendations
- ANY prices, costs, or £/$ amounts

===== PHRASING GUIDELINES =====
- ALL recommendations MUST use SOFT, CONDITIONAL language
- Use phrases like: "If...", "Should...", "May require...", "Could need...", "In case..."
- NEVER use assertive language like "requires", "needs", "will need", "must have"
- The customer should feel informed, not alarmed

GOOD examples for "reason" field:
- "If damaged, removal may be required."
- "May need additional labor for access."
- "Could require extra material."

GOOD examples for "whatItInvolves" field:
- "Removal and disposal if present"
- "Component inspection and potential replacement"
- "Surface preparation before treatment"

BAD examples (DO NOT USE):
- "£150 for parts" (no prices!)
- "Approximately £200" (no prices!)
- "Labor costs around £80/hour" (no prices!)

Other guidelines:
- Only include signals that genuinely imply additional work MIGHT be needed
- Skip purely informational signals
- workDescription should be short (3-5 words) and start with "Potential" or similar
- If a signal has low confidence (shown in %), be extra cautious in wording
- Return empty recommendations array if no signals warrant recommendations`

/**
 * Generate pricing recommendations for unused signals
 */
export async function generateSignalRecommendations(
  client: GeminiClient,
  unusedSignals: UnusedSignal[],
  serviceName: string,
  context: RecommendationContext
): Promise<SignalRecommendation[]> {
  if (unusedSignals.length === 0) {
    return []
  }

  // Build the prompt with context
  const workStepsText = context.workSteps && context.workSteps.length > 0
    ? context.workSteps.map(ws => `- ${ws.name}: ${ws.costType} @ ${ws.defaultCost}`).join('\n')
    : 'No work steps configured for reference'

  const serviceDescText = context.serviceDescription
    ? `Description: ${context.serviceDescription}`
    : ''

  const unusedSignalsText = unusedSignals.map(s =>
    `- ${s.key} = ${JSON.stringify(s.value)} (confidence: ${(s.confidence * 100).toFixed(0)}%)\n  Evidence: ${s.evidence || 'Not specified'}`
  ).join('\n')

  const prompt = SIGNAL_RECOMMENDATIONS_PROMPT
    .replace('{{SERVICE_NAME}}', serviceName)
    .replace('{{SERVICE_DESCRIPTION}}', serviceDescText)
    .replace('{{WORK_STEPS}}', workStepsText)
    .replace('{{UNUSED_SIGNALS}}', unusedSignalsText)

  try {
    const response = await client.generateText(prompt)
    const recommendations = parseRecommendations(response, unusedSignals)

    console.log(`[SignalRecommendations] Generated ${recommendations.length} recommendations for ${unusedSignals.length} unused signals`)

    return recommendations
  } catch (error) {
    console.error('[SignalRecommendations] Failed to generate recommendations:', error)
    return []
  }
}

/**
 * Parse AI response into typed recommendations
 *
 * AD-001 COMPLIANCE: No prices are extracted - costBreakdown contains
 * description of work involved, not cost estimates.
 */
function parseRecommendations(
  response: string,
  unusedSignals: UnusedSignal[]
): SignalRecommendation[] {
  try {
    // Remove markdown code blocks if present
    let cleaned = response.trim()
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7)
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3)
    }
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned) as {
      recommendations?: Array<{
        signalKey: string
        workDescription: string
        whatItInvolves?: string  // New field (no prices)
        costBreakdown?: string   // Legacy field (may contain prices from old responses)
        estimatedCost?: number   // Legacy field (ignored)
        reason: string
      }>
    }

    if (!Array.isArray(parsed.recommendations)) {
      return []
    }

    // Build a map of unused signals for quick lookup
    const signalMap = new Map(unusedSignals.map(s => [s.key, s]))

    let recommendations = parsed.recommendations
      .filter(rec => rec.signalKey && rec.workDescription)
      .map(rec => {
        const originalSignal = signalMap.get(rec.signalKey)

        // Use whatItInvolves (new, price-free) or fall back to costBreakdown (legacy)
        // Strip any prices from costBreakdown if present (defensive)
        let workInvolved = rec.whatItInvolves || rec.costBreakdown || ''
        workInvolved = stripPricesFromText(workInvolved)

        return {
          signalKey: rec.signalKey,
          signalValue: originalSignal?.value ?? true,
          workDescription: rec.workDescription,
          // estimatedCost intentionally omitted (AD-001)
          costBreakdown: workInvolved,
          confidence: originalSignal?.confidence ?? 0.5,
          evidence: rec.reason || originalSignal?.evidence || '',
          isEstimate: true,
        }
      })

    // AD-009: Hard limit to 3 recommendations maximum
    const MAX_RECOMMENDATIONS = 3
    if (recommendations.length > MAX_RECOMMENDATIONS) {
      recommendations = recommendations
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_RECOMMENDATIONS)
      console.log(`[SignalRecommendations] Trimmed to ${MAX_RECOMMENDATIONS} items (had ${parsed.recommendations.length})`)
    }

    return recommendations
  } catch (error) {
    console.error('[SignalRecommendations] Failed to parse response:', error)
    return []
  }
}

/**
 * Strip any price/cost mentions from text (defensive measure)
 * Removes patterns like "£150", "$200", "~£80", "around £100"
 */
function stripPricesFromText(text: string): string {
  // Remove currency patterns: £123, $456, €789, with optional ~ or "around"
  let cleaned = text.replace(/~?\s*[£$€]\s*\d+(?:[.,]\d+)?/g, '')
  // Remove "around/approximately/about £X" patterns
  cleaned = cleaned.replace(/(?:around|approximately|about|~)\s*[£$€]\s*\d+(?:[.,]\d+)?/gi, '')
  // Remove "X pounds/dollars" patterns
  cleaned = cleaned.replace(/\d+(?:[.,]\d+)?\s*(?:pounds?|dollars?|euros?)/gi, '')
  // Clean up leftover artifacts
  cleaned = cleaned.replace(/\s*:\s*$/g, '') // trailing colons
  cleaned = cleaned.replace(/\s{2,}/g, ' ') // multiple spaces
  return cleaned.trim()
}

/**
 * Keywords that indicate a numeric/measurable signal
 * These signals should be skipped if customer provided equivalent form input
 */
const NUMERIC_SIGNAL_KEYWORDS = [
  'area', 'sqft', 'sqm', 'size', 'count', 'quantity', 'number', 'footage',
  'length', 'width', 'height', 'depth', 'volume', 'rooms', 'units', 'items'
]

/**
 * Semantic patterns to match form fields to signal keys
 * Used to detect if customer already provided input for a numeric signal
 */
const FORM_TO_SIGNAL_PATTERNS: Record<string, string[]> = {
  // Area/size patterns
  'surface_area': ['loft_size', 'room_size', 'area', 'sqft', 'square_footage', 'size'],
  'total_area': ['loft_size', 'room_size', 'area', 'sqft', 'square_footage', 'size'],
  'area_sqft': ['loft_size', 'room_size', 'area', 'sqft', 'square_footage', 'size'],
  // Count patterns
  'item_count': ['count', 'quantity', 'number', 'how_many'],
  'room_count': ['rooms', 'number_of_rooms', 'room_count'],
  'downlight_count': ['downlights', 'number_of_downlights', 'downlight_count'],
  // Depth patterns
  'insulation_depth': ['depth', 'existing_depth', 'insulation_depth', 'current_depth'],
}

/**
 * Check if a signal key represents a numeric/measurable value
 */
function isNumericSignal(signalKey: string): boolean {
  const keyLower = signalKey.toLowerCase()
  return NUMERIC_SIGNAL_KEYWORDS.some(kw => keyLower.includes(kw))
}

/**
 * Check if customer provided a form input that covers this signal
 */
function hasCustomerProvidedInput(
  signalKey: string,
  formAnswers: FormAnswerForFiltering[],
  widgetFields: WidgetFieldForFiltering[]
): boolean {
  if (!formAnswers || formAnswers.length === 0) {
    return false
  }

  const keyLower = signalKey.toLowerCase()

  // Check 1: Direct mapsToSignal match
  for (const field of widgetFields) {
    if (field.mapsToSignal?.toLowerCase() === keyLower) {
      const answer = formAnswers.find(a => a.fieldId === field.fieldId)
      if (answer && answer.value !== undefined && answer.value !== null && answer.value !== '') {
        return true
      }
    }
  }

  // Check 2: Semantic pattern matching
  const patterns = FORM_TO_SIGNAL_PATTERNS[keyLower] || []
  for (const pattern of patterns) {
    const patternLower = pattern.toLowerCase().replace(/[_\s]/g, '')
    for (const answer of formAnswers) {
      const fieldIdLower = answer.fieldId.toLowerCase().replace(/[_\s]/g, '')
      if (fieldIdLower.includes(patternLower) || patternLower.includes(fieldIdLower)) {
        if (answer.value !== undefined && answer.value !== null && answer.value !== '') {
          return true
        }
      }
    }
    // Also check widget field labels
    for (const field of widgetFields) {
      const labelLower = field.label.toLowerCase().replace(/[_\s]/g, '')
      if (labelLower.includes(patternLower) || patternLower.includes(labelLower)) {
        const answer = formAnswers.find(a => a.fieldId === field.fieldId)
        if (answer && answer.value !== undefined && answer.value !== null && answer.value !== '') {
          return true
        }
      }
    }
  }

  // Check 3: Fuzzy match on signal key parts
  const keyParts = keyLower.split('_')
  for (const part of keyParts) {
    if (part.length < 3) continue // Skip short parts
    for (const answer of formAnswers) {
      const fieldIdLower = answer.fieldId.toLowerCase()
      if (fieldIdLower.includes(part)) {
        if (answer.value !== undefined && answer.value !== null && answer.value !== '') {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Find signals that were extracted but not used in pricing
 *
 * FILTERING RULES:
 * 1. Skip signals already used in pricing
 * 2. Skip form-provided signals (customer already told us)
 * 3. For NUMERIC signals (area, count, size): Skip if customer provided equivalent form input
 * 4. For NUMERIC signals: Require HIGH confidence (70%+)
 * 5. For non-numeric signals: Require moderate confidence (50%+)
 * 6. For INFERRED signals: Be lenient if there's actionable evidence
 */
export function findUnusedSignals(
  extractedSignals: Array<{
    key: string
    value: string | number | boolean | null
    confidence: number
    source: 'vision' | 'form' | 'nlp' | 'inferred'
    evidence?: string
  }>,
  pricingTrace: {
    trace: Array<{
      signalsUsed: Array<{ key: string; value: string | number | boolean }>
    }>
  },
  formAnswers?: FormAnswerForFiltering[],
  widgetFields?: WidgetFieldForFiltering[]
): UnusedSignal[] {
  // Get all signal keys used in pricing
  const usedKeys = new Set<string>()
  for (const step of pricingTrace.trace) {
    for (const signal of step.signalsUsed) {
      usedKeys.add(signal.key)
    }
  }

  // Find extracted signals not used in pricing
  return extractedSignals
    .filter(s => !usedKeys.has(s.key))
    .filter(s => s.source === 'inferred' || s.source === 'vision')  // Not form-provided
    .filter(s => {
      // RULE: For NUMERIC signals, check if customer already provided input
      if (isNumericSignal(s.key)) {
        if (hasCustomerProvidedInput(s.key, formAnswers || [], widgetFields || [])) {
          console.log(`[SignalRecommendations] Skipping ${s.key} - customer provided form input`)
          return false
        }

        // RULE: Numeric signals from vision need HIGH confidence (70%+)
        if (s.source === 'vision' && s.confidence < 0.7) {
          console.log(`[SignalRecommendations] Skipping ${s.key} - numeric signal with low confidence (${(s.confidence * 100).toFixed(0)}%)`)
          return false
        }
      }

      // For INFERRED signals: be lenient - include if there's evidence
      if (s.source === 'inferred') {
        // Signal keys that suggest actionable work - include even with poor evidence
        const actionableKeywords = ['required', 'needed', 'upgrade', 'replace', 'repair', 'install']
        const keyLower = s.key.toLowerCase()
        const isActionableKey = actionableKeywords.some(kw => keyLower.includes(kw))

        // If key suggests action (e.g., mesh_required), always include
        if (isActionableKey) {
          return true
        }

        // Otherwise, check for meaningful evidence OR real value
        const evidenceLower = (s.evidence || '').toLowerCase()
        const hasEvidence = s.evidence && s.evidence.length > 10 &&
          !evidenceLower.includes('cannot determine') &&
          !evidenceLower.includes('cannot assess') &&
          !evidenceLower.includes('not visible')
        const hasValue = s.value !== undefined && s.value !== null &&
          s.value !== 0 && s.value !== '' && s.value !== 'unknown'
        return hasEvidence || hasValue
      }

      // For VISION signals: require moderate confidence (50%+) and value
      // (numeric signals already filtered above with higher threshold)
      return s.confidence >= 0.5 &&
        s.value !== undefined && s.value !== null &&
        s.value !== 0 && s.value !== '' && s.value !== 'unknown'
    })
    .map(s => ({
      key: s.key,
      // Default null to true for boolean-style signal keys (e.g., mesh_required)
      value: s.value ?? true,
      source: s.source,
      evidence: s.evidence || '',
      confidence: s.confidence,
    }))
}
