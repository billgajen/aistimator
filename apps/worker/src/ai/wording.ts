/**
 * AI Wording Generator
 *
 * Uses Gemini 1.5 Flash to generate professional quote wording:
 * - Scope summary describing the work
 * - Assumptions and exclusions
 * - Additional notes
 *
 * IMPORTANT: This generates WORDING only, not pricing.
 */

import { GeminiClient } from './gemini'
import type { ExtractedSignals } from './signals'
import type { PricingResult } from '../pricing/rules-engine'

/**
 * Generated quote content
 */
export interface QuoteContent {
  scopeSummary: string
  assumptions: string[]
  exclusions: string[]
  notes: string
  validityDays: number
}

/**
 * Form answer with field metadata for conditional logic
 */
export interface FormAnswerWithMeta {
  question: string
  answer: string
  fieldId: string
  value: string | number | boolean | string[]
}

/**
 * Document type for tone/style selection
 */
export type DocumentTone = 'instant_estimate' | 'formal_quote' | 'proposal' | 'sow'

/**
 * Context for wording generation
 */
export interface WordingContext {
  businessName: string
  serviceName: string
  serviceDescription?: string
  scopeIncludes?: string[]
  scopeExcludes?: string[]
  defaultAssumptions?: string[]
  customerName: string
  jobAddress?: string
  signals: ExtractedSignals
  pricing: PricingResult
  formAnswers?: FormAnswerWithMeta[]
  /** Customer's project description from the widget form */
  projectDescription?: string
  /** Document type for tone selection */
  documentType?: DocumentTone
  /** Error code reported by customer (e.g., boiler error code "EA", "F1") */
  errorCode?: string
}

/**
 * System prompt for wording generation - base prompt
 */
const WORDING_SYSTEM_PROMPT_BASE = `You are a professional business quote writer.

Your job is to write clear, professional, and friendly quote content for small businesses.

IMPORTANT RULES:
1. Be professional but approachable - not stiff corporate language
2. Be specific about the work based on the provided signals and context
3. Include relevant assumptions and exclusions
4. Keep it concise - business owners and customers are busy
5. Never mention or reference AI, automation, or that this was generated
6. Write as if you ARE the business writing to the customer`

/**
 * Document type specific tone instructions
 */
const DOCUMENT_TYPE_TONES: Record<DocumentTone, string> = {
  instant_estimate: `
TONE: Casual and Quick
- Use a friendly, conversational tone
- Keep it brief and to the point
- Use phrases like "Here's a quick estimate", "Based on what you've shared"
- This is a ballpark figure, so communicate that it's approximate
- Focus on speed and convenience`,

  formal_quote: `
TONE: Professional and Clear
- Use standard business language
- Be thorough but not verbose
- Use phrases like "Please find our quotation", "We are pleased to provide"
- This is a binding quote, so be precise
- Maintain professional courtesy throughout`,

  proposal: `
TONE: Persuasive and Value-Focused
- Emphasize the value and benefits of choosing this service
- Use confident, solution-oriented language
- Use phrases like "We propose", "Our solution includes", "The benefits of working with us"
- Include reasons why the customer should choose this business
- Be professional but slightly more sales-oriented`,

  sow: `
TONE: Technical and Detailed
- Use precise, technical language appropriate for the industry
- Be very specific about scope, deliverables, and responsibilities
- Use phrases like "The scope of work includes", "Deliverables", "Project specifications"
- Include clear boundaries of what is and isn't included
- This is a formal document, maintain a technical/legal tone`,
}

/**
 * Get system prompt based on document type
 */
function getSystemPrompt(documentType?: DocumentTone): string {
  const toneInstructions = documentType ? DOCUMENT_TYPE_TONES[documentType] : DOCUMENT_TYPE_TONES.formal_quote
  return `${WORDING_SYSTEM_PROMPT_BASE}
${toneInstructions}`
}

/**
 * Prompt template for wording generation
 */
const WORDING_PROMPT = `Write quote content for the following job request.

Business: {{BUSINESS_NAME}}
Service: {{SERVICE_NAME}}
{{#if SERVICE_DESCRIPTION}}About this service: {{SERVICE_DESCRIPTION}}{{/if}}
Customer: {{CUSTOMER_NAME}}
{{#if JOB_ADDRESS}}Location: {{JOB_ADDRESS}}{{/if}}

{{#if PROJECT_DESCRIPTION}}
Customer's project description:
{{PROJECT_DESCRIPTION}}
{{/if}}

{{#if ERROR_CODE}}
Error code reported: {{ERROR_CODE}}
(If you recognize this error code, briefly mention what it typically indicates in the notes section)
{{/if}}

{{#if SCOPE_INCLUDES}}
What this service typically includes:
{{SCOPE_INCLUDES}}
{{/if}}

{{#if SCOPE_EXCLUDES}}
What this service typically excludes:
{{SCOPE_EXCLUDES}}
{{/if}}

{{#if DEFAULT_ASSUMPTIONS}}
Standard assumptions for this service:
{{DEFAULT_ASSUMPTIONS}}
{{/if}}

Observations from site photos:
{{OBSERVATIONS}}

{{#if FORM_ANSWERS}}
Customer provided information:
{{FORM_ANSWERS}}
{{/if}}

Pricing notes:
{{PRICING_NOTES}}

Write the quote content as a JSON object with this exact structure:

{
  "scopeSummary": "2-4 sentences describing what work is included",
  "assumptions": ["list", "of", "assumptions", "we're making"],
  "exclusions": ["list", "of", "what's NOT included"],
  "notes": "Any additional notes or recommendations (optional, can be empty string)",
  "validityDays": 30
}

Guidelines:
- scopeSummary should clearly describe the work in plain English, referencing what's included if provided
- For assumptions, PREFER using the standard assumptions provided above. Only add custom items if photos suggest something unusual.
- For exclusions, PREFER using the standard exclusions provided above. Only add custom items if relevant to this specific job.
- IMPORTANT: Do NOT include assumptions that contradict the customer's answers. For example:
  - If customer selected "Poor" or "Bad" condition, don't assume "surfaces in reasonable condition"
  - If customer specified a large area, don't assume "standard room size"
  - If customer indicated special requirements, acknowledge them rather than assuming standard work
- notes can include recommendations, next steps, or things to consider
- validityDays is typically 30 for most quotes

===== CRITICAL - SCOPE MUST MATCH CUSTOMER INTENT =====
Read the customer's project description carefully for keywords indicating their intent:

REPAIR/FIX INTENT - If customer uses words like:
- "repair", "fix", "replace", "resolve", "stop", "prevent", "permanent"
Then the scopeSummary MUST include repair/fix language. Do NOT undersell with just "inspection".

INSPECTION INTENT - If customer uses words like:
- "inspect", "check", "assess", "evaluate", "diagnose", "survey"
Then inspection-focused scope is appropriate.

EXAMPLES:
- Customer says "carry out a repair" → Scope MUST mention repair, not just inspection
- Customer says "permanent fix, not just sealant" → Acknowledge they want real repair work
- Customer says "inspect and advise" → Inspection-focused scope is OK

If the pricing only covers Phase 1 (inspection) but customer wants repair:
- Clearly state in scopeSummary: "This quote covers inspection and diagnosis. A detailed repair quote will follow once we assess the extent of work required."
- Do NOT imply the quote covers repair when it only covers inspection

===== CRITICAL - SCOPE BOUNDARIES ARE ABSOLUTE =====
The scope_includes list (if provided) defines the ONLY services this quote can offer.

RULES:
1. You MUST NOT mention, promise, or include ANY service not listed in scope_includes
2. If customer requests something outside scope_includes, acknowledge it in notes with:
   "Additional services like [X] can be quoted separately upon request."
3. NEVER say a service is "included" unless it appears in scope_includes
4. When in doubt, mention LESS not MORE - only describe what's explicitly configured

EXAMPLES:
- scope_includes: ["Leak inspection", "Pressure testing"]
- Customer asks: "can you also service the boiler?"
- WRONG: "This quote includes boiler servicing"
- RIGHT: Scope mentions only leak inspection and pressure testing
         Notes: "Boiler servicing can be quoted separately if needed."

The business configured what they offer. AI must not expand this.

Respond with ONLY the JSON object, no other text.`

/**
 * Generate quote wording using Gemini
 */
export async function generateWording(
  client: GeminiClient,
  context: WordingContext
): Promise<QuoteContent> {
  // Build the prompt with context
  let prompt = WORDING_PROMPT
    .replace('{{BUSINESS_NAME}}', context.businessName)
    .replace('{{SERVICE_NAME}}', context.serviceName)
    .replace('{{CUSTOMER_NAME}}', context.customerName)

  // Service description
  if (context.serviceDescription) {
    prompt = prompt.replace(/{{#if SERVICE_DESCRIPTION}}(.*?){{\/if}}/gs, '$1')
    prompt = prompt.replace('{{SERVICE_DESCRIPTION}}', context.serviceDescription)
  } else {
    prompt = prompt.replace(/{{#if SERVICE_DESCRIPTION}}[\s\S]*?{{\/if}}/g, '')
  }

  // Job address
  if (context.jobAddress) {
    prompt = prompt.replace(/{{#if JOB_ADDRESS}}(.*?){{\/if}}/gs, '$1')
    prompt = prompt.replace('{{JOB_ADDRESS}}', context.jobAddress)
  } else {
    prompt = prompt.replace(/{{#if JOB_ADDRESS}}[\s\S]*?{{\/if}}/g, '')
  }

  // Project description (customer's detailed requirements)
  if (context.projectDescription) {
    prompt = prompt.replace(/{{#if PROJECT_DESCRIPTION}}([\s\S]*?){{\/if}}/g, '$1')
    prompt = prompt.replace('{{PROJECT_DESCRIPTION}}', context.projectDescription)
  } else {
    prompt = prompt.replace(/{{#if PROJECT_DESCRIPTION}}[\s\S]*?{{\/if}}/g, '')
  }

  // FIX-6: Error code from customer (e.g., boiler error codes)
  if (context.errorCode) {
    prompt = prompt.replace(/{{#if ERROR_CODE}}([\s\S]*?){{\/if}}/g, '$1')
    prompt = prompt.replace('{{ERROR_CODE}}', context.errorCode)
  } else {
    prompt = prompt.replace(/{{#if ERROR_CODE}}[\s\S]*?{{\/if}}/g, '')
  }

  // Scope includes
  if (context.scopeIncludes && context.scopeIncludes.length > 0) {
    const includesText = context.scopeIncludes.map((i) => `- ${i}`).join('\n')
    prompt = prompt.replace(/{{#if SCOPE_INCLUDES}}([\s\S]*?){{\/if}}/g, '$1')
    prompt = prompt.replace('{{SCOPE_INCLUDES}}', includesText)
  } else {
    prompt = prompt.replace(/{{#if SCOPE_INCLUDES}}[\s\S]*?{{\/if}}/g, '')
  }

  // Scope excludes
  if (context.scopeExcludes && context.scopeExcludes.length > 0) {
    const excludesText = context.scopeExcludes.map((e) => `- ${e}`).join('\n')
    prompt = prompt.replace(/{{#if SCOPE_EXCLUDES}}([\s\S]*?){{\/if}}/g, '$1')
    prompt = prompt.replace('{{SCOPE_EXCLUDES}}', excludesText)
  } else {
    prompt = prompt.replace(/{{#if SCOPE_EXCLUDES}}[\s\S]*?{{\/if}}/g, '')
  }

  // Default assumptions
  if (context.defaultAssumptions && context.defaultAssumptions.length > 0) {
    const assumptionsText = context.defaultAssumptions.map((a) => `- ${a}`).join('\n')
    prompt = prompt.replace(/{{#if DEFAULT_ASSUMPTIONS}}([\s\S]*?){{\/if}}/g, '$1')
    prompt = prompt.replace('{{DEFAULT_ASSUMPTIONS}}', assumptionsText)
  } else {
    prompt = prompt.replace(/{{#if DEFAULT_ASSUMPTIONS}}[\s\S]*?{{\/if}}/g, '')
  }

  // Format observations
  const observations = context.signals.observations.length > 0
    ? context.signals.observations.map((o) => `- ${o}`).join('\n')
    : '- No specific observations from photos'
  prompt = prompt.replace('{{OBSERVATIONS}}', observations)

  // Format form answers if available
  if (context.formAnswers && context.formAnswers.length > 0) {
    const formAnswersText = context.formAnswers
      .map((a) => `- ${a.question}: ${a.answer}`)
      .join('\n')
    prompt = prompt.replace(/{{#if FORM_ANSWERS}}([\s\S]*?){{\/if}}/g, '$1')
    prompt = prompt.replace('{{FORM_ANSWERS}}', formAnswersText)
  } else {
    prompt = prompt.replace(/{{#if FORM_ANSWERS}}[\s\S]*?{{\/if}}/g, '')
  }

  // Format pricing notes
  const pricingNotes = context.pricing.notes.length > 0
    ? context.pricing.notes.map((n) => `- ${n}`).join('\n')
    : '- Standard pricing applied'
  prompt = prompt.replace('{{PRICING_NOTES}}', pricingNotes)

  // FIX-4: Instruct AI not to repeat pricing notes verbatim in content notes
  if (context.pricing.notes.length > 0) {
    prompt += `\n\nIMPORTANT: The pricing notes above are already shown separately on the quote. Do NOT repeat them verbatim in the "notes" field. Instead, synthesize any relevant information into a cohesive customer-facing note, or leave "notes" as an empty string if there's nothing additional to say.`
  }

  const response = await client.generateText(prompt, getSystemPrompt(context.documentType))

  try {
    const content = GeminiClient.parseJSON<QuoteContent>(response)
    return validateContent(content, context)
  } catch (error) {
    console.error('[Wording] Failed to parse Gemini response:', error)
    console.error('[Wording] Raw response:', response)

    // Return default content
    return getDefaultContent(context)
  }
}

/**
 * Validate and normalize generated content
 */
function validateContent(content: Partial<QuoteContent>, context: WordingContext): QuoteContent {
  // Filter assumptions that contradict form answers (even for AI-generated content)
  let assumptions: string[]
  if (Array.isArray(content.assumptions) && content.assumptions.length > 0) {
    assumptions = filterContradictingAssumptions(content.assumptions, context.formAnswers).slice(0, 5)
    // If all assumptions were filtered out, use defaults
    if (assumptions.length === 0) {
      assumptions = getDefaultAssumptions(context)
    }
  } else {
    assumptions = getDefaultAssumptions(context)
  }

  // Generate notes if AI returned empty - use context-aware defaults
  let notes = typeof content.notes === 'string' ? content.notes : ''
  if (!notes) {
    notes = getDefaultNotes(context)
  }

  // ISSUE-5 FIX: Validate that scope doesn't promise unpaid work
  // Check if scope text mentions work that isn't in the pricing breakdown
  const scopeSummary = content.scopeSummary || getDefaultScopeSummary(context)
  const scopeValidation = validateScopeAgainstPricing(
    scopeSummary,
    context.pricing.breakdown,
    context.scopeIncludes
  )
  if (!scopeValidation.valid) {
    // Log warnings for visibility (these don't block the quote but help diagnose issues)
    for (const warning of scopeValidation.warnings) {
      console.warn(`[Wording] Scope validation warning: ${warning}`)
    }
    // Note: We don't add these warnings to customer-facing notes
    // They're for business/developer awareness during debugging
  }

  return {
    scopeSummary,
    assumptions,
    exclusions: Array.isArray(content.exclusions) && content.exclusions.length > 0
      ? content.exclusions.slice(0, 5)
      : getDefaultExclusions(context),
    notes,
    validityDays: typeof content.validityDays === 'number' ? content.validityDays : 30,
  }
}

/**
 * Generate default notes based on context
 */
function getDefaultNotes(context: WordingContext): string {
  const noteParts: string[] = []

  // Add site visit recommendation if applicable
  if (context.signals.siteVisitRecommended) {
    noteParts.push(context.signals.siteVisitReason || 'A site visit is recommended for a more accurate quote.')
  }

  // Add note about condition if form indicates poor condition
  if (context.formAnswers) {
    for (const answer of context.formAnswers) {
      const answerLower = typeof answer.value === 'string' ? answer.value.toLowerCase() : answer.answer.toLowerCase()
      const questionLower = answer.question.toLowerCase()

      if (
        (questionLower.includes('condition') || questionLower.includes('state')) &&
        ['poor', 'bad', 'damaged'].some((ind) => answerLower.includes(ind))
      ) {
        noteParts.push('Additional work may be required due to existing conditions.')
        break
      }
    }
  }

  // Add note about high complexity
  if (context.signals.complexity.level === 'high' && context.signals.complexity.factors.length > 0) {
    noteParts.push(`This job involves additional complexity: ${context.signals.complexity.factors.slice(0, 2).join(', ')}.`)
  }

  return noteParts.join(' ')
}

/**
 * Get default content when AI generation fails
 */
export function getDefaultContent(context: WordingContext): QuoteContent {
  return {
    scopeSummary: getDefaultScopeSummary(context),
    assumptions: getDefaultAssumptions(context),
    exclusions: getDefaultExclusions(context),
    notes: context.signals.siteVisitRecommended
      ? 'We recommend a site visit to provide a more accurate quote.'
      : '',
    validityDays: 30,
  }
}

/**
 * Default scope summary
 */
function getDefaultScopeSummary(context: WordingContext): string {
  // Use service description if available
  if (context.serviceDescription) {
    let summary = context.serviceDescription
    if (context.jobAddress) {
      summary += ` Work to be completed at ${context.jobAddress}.`
    }
    return summary
  }

  // Include scope items if available
  if (context.scopeIncludes && context.scopeIncludes.length > 0) {
    const includesList = context.scopeIncludes.slice(0, 3).join(', ')
    let summary = `${context.serviceName} services including: ${includesList}.`
    if (context.jobAddress) {
      summary += ` Work to be completed at ${context.jobAddress}.`
    }
    return summary
  }

  const base = `${context.serviceName} services as requested`
  if (context.jobAddress) {
    return `${base} at ${context.jobAddress}.`
  }
  return `${base}.`
}

/**
 * Check if an assumption contradicts form answers
 */
function assumptionContradictsAnswers(
  assumption: string,
  formAnswers?: FormAnswerWithMeta[]
): boolean {
  if (!formAnswers || formAnswers.length === 0) return false

  const assumptionLower = assumption.toLowerCase()

  // Check for condition-related assumptions
  const conditionKeywords = ['reasonable condition', 'good condition', 'standard condition', 'normal condition']
  const hasConditionAssumption = conditionKeywords.some((kw) => assumptionLower.includes(kw))

  if (hasConditionAssumption) {
    // Look for condition-related form answers that indicate poor/bad condition
    const poorConditionIndicators = ['poor', 'bad', 'damaged', 'deteriorated', 'needs repair', 'worn']
    for (const answer of formAnswers) {
      const answerLower = typeof answer.value === 'string' ? answer.value.toLowerCase() : answer.answer.toLowerCase()
      const questionLower = answer.question.toLowerCase()

      // Check if this is a condition-related question with a negative answer
      if (
        questionLower.includes('condition') ||
        questionLower.includes('state') ||
        questionLower.includes('quality')
      ) {
        if (poorConditionIndicators.some((ind) => answerLower.includes(ind))) {
          return true // This assumption contradicts the form answer
        }
      }
    }
  }

  // Check for size-related assumptions
  const sizeKeywords = ['standard size', 'typical size', 'normal size', 'average size']
  const hasSizeAssumption = sizeKeywords.some((kw) => assumptionLower.includes(kw))

  if (hasSizeAssumption) {
    // Check if customer indicated large/extra-large size
    const largeSizeIndicators = ['large', 'extra large', 'xl', 'oversized', 'big']
    for (const answer of formAnswers) {
      const answerLower = typeof answer.value === 'string' ? answer.value.toLowerCase() : answer.answer.toLowerCase()
      if (largeSizeIndicators.some((ind) => answerLower.includes(ind))) {
        return true
      }
    }
  }

  return false
}

/**
 * Filter assumptions that contradict form answers
 */
function filterContradictingAssumptions(
  assumptions: string[],
  formAnswers?: FormAnswerWithMeta[]
): string[] {
  if (!formAnswers || formAnswers.length === 0) return assumptions

  return assumptions.filter((assumption) => !assumptionContradictsAnswers(assumption, formAnswers))
}

/**
 * Default assumptions - prefers service's default assumptions if available
 * Filters out assumptions that contradict form answers
 */
function getDefaultAssumptions(context?: WordingContext): string[] {
  let baseAssumptions: string[]

  // Use service's default assumptions if available
  if (context?.defaultAssumptions && context.defaultAssumptions.length > 0) {
    baseAssumptions = context.defaultAssumptions.slice(0, 5)
  } else {
    baseAssumptions = [
      'Clear access to the work area',
      'Work to be completed during normal business hours',
      'All necessary permits (if required) to be arranged by customer',
    ]
  }

  // Filter out assumptions that contradict form answers
  return filterContradictingAssumptions(baseAssumptions, context?.formAnswers)
}

/**
 * Default exclusions - prefers service's scope_excludes if available
 */
function getDefaultExclusions(context?: WordingContext): string[] {
  // Use service's default exclusions if available
  if (context?.scopeExcludes && context.scopeExcludes.length > 0) {
    return context.scopeExcludes.slice(0, 5)
  }

  return [
    'Disposal of hazardous materials',
    'Work outside the described scope',
    'Repair of any pre-existing damage',
  ]
}

/**
 * Generate wording without AI (fallback)
 */
export function generateWordingFallback(context: WordingContext): QuoteContent {
  const observations = context.signals.observations
  let scopeSummary = getDefaultScopeSummary(context)

  // Enhance with observations if available and no service description
  if (observations.length > 0 && !context.serviceDescription) {
    scopeSummary = `${context.serviceName} services including: ${observations.slice(0, 3).join(', ')}. `
    if (context.jobAddress) {
      scopeSummary += `Work to be completed at ${context.jobAddress}.`
    }
  }

  // Start with service defaults if available, otherwise use generic defaults
  // These are already filtered for contradicting form answers in getDefaultAssumptions
  const assumptions = [...getDefaultAssumptions(context)]
  const exclusions = [...getDefaultExclusions(context)]

  // Add complexity note if high (only if not already in defaults)
  if (context.signals.complexity.level === 'high') {
    const complexityNote = 'Additional time allocated for complexity'
    if (!assumptions.includes(complexityNote)) {
      assumptions.push(complexityNote)
    }
  }

  // Add access note if difficult
  if (context.signals.access?.difficulty === 'difficult') {
    const accessNote = 'Appropriate equipment for difficult access areas'
    if (!assumptions.includes(accessNote)) {
      assumptions.push(accessNote)
    }
  }

  // Add materials to scope if detected
  if (context.signals.materials.length > 0) {
    exclusions.push(`Materials other than: ${context.signals.materials.join(', ')}`)
  }

  let notes = ''
  if (context.signals.siteVisitRecommended) {
    notes = context.signals.siteVisitReason || 'A site visit is recommended for a more accurate quote.'
  }

  // Add note about form-indicated conditions if poor
  if (context.formAnswers) {
    for (const answer of context.formAnswers) {
      const answerLower = typeof answer.value === 'string' ? answer.value.toLowerCase() : answer.answer.toLowerCase()
      const questionLower = answer.question.toLowerCase()

      if (
        (questionLower.includes('condition') || questionLower.includes('state')) &&
        ['poor', 'bad', 'damaged'].some((ind) => answerLower.includes(ind))
      ) {
        if (!notes) {
          notes = 'Additional work may be required due to existing conditions.'
        }
        break
      }
    }
  }

  return {
    scopeSummary,
    assumptions: assumptions.slice(0, 5),
    exclusions: exclusions.slice(0, 5),
    notes,
    validityDays: 30,
  }
}

/**
 * ISSUE-5 FIX: Validate that scope text doesn't promise work not included in pricing
 *
 * Checks for keywords in scope text that imply work items, then verifies
 * those items exist in the pricing breakdown. Returns warnings for mismatches.
 *
 * Example: Scope says "re-sealing around the shower" but no sealing line item exists
 */
interface ScopeValidationResult {
  valid: boolean
  warnings: string[]
}

export function validateScopeAgainstPricing(
  scopeText: string,
  pricingBreakdown: Array<{ label: string }>,
  scopeIncludes?: string[]
): ScopeValidationResult {
  const warnings: string[] = []

  // Keywords that imply work items - must be matched in pricing OR scopeIncludes
  const workKeywordChecks = [
    { pattern: /\bre-?seal/i, expectedLabels: ['seal', 'silicone', 'sealant'] },
    { pattern: /\bgrout/i, expectedLabels: ['grout'] },
    { pattern: /\bclean/i, expectedLabels: ['clean', 'cleaning'] },
    { pattern: /\brepair/i, expectedLabels: ['repair', 'fix'] },
    { pattern: /\btil(e|ing)/i, expectedLabels: ['tile', 'tiling'] },
    { pattern: /\bpaint/i, expectedLabels: ['paint', 'painting'] },
    { pattern: /\bremov(e|al|ing)/i, expectedLabels: ['remov', 'disposal', 'strip'] },
    { pattern: /\binstall/i, expectedLabels: ['install', 'installation', 'fitting'] },
    { pattern: /\breplace/i, expectedLabels: ['replace', 'replacement'] },
    { pattern: /\bplumb/i, expectedLabels: ['plumb', 'pipe', 'tap'] },
    { pattern: /\belectr/i, expectedLabels: ['electr', 'wiring', 'socket'] },
  ]

  // Build lowercase versions for searching
  const breakdownLabelsLower = pricingBreakdown.map(b => b.label.toLowerCase())
  const scopeIncludesLower = (scopeIncludes || []).map(s => s.toLowerCase())

  for (const { pattern, expectedLabels } of workKeywordChecks) {
    if (pattern.test(scopeText)) {
      // Check if any expected label appears in breakdown OR scopeIncludes
      const hasMatchingLine = expectedLabels.some(label =>
        breakdownLabelsLower.some(bl => bl.includes(label))
      )
      const hasMatchingScope = expectedLabels.some(label =>
        scopeIncludesLower.some(si => si.includes(label))
      )

      if (!hasMatchingLine && !hasMatchingScope) {
        // Extract the matched word from scope text for clearer warning
        const match = scopeText.match(pattern)
        const matchedWord = match ? match[0] : pattern.source
        warnings.push(
          `Scope mentions "${matchedWord}" but no matching line item in pricing. Consider adding to exclusions or pricing.`
        )
      }
    }
  }

  return { valid: warnings.length === 0, warnings }
}
