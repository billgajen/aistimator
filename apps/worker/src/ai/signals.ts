/**
 * AI Signal Extraction
 *
 * Extracts structured signals from images using Gemini 1.5 Flash.
 * Signals are used by the rules engine to compute pricing.
 */

import { GeminiClient } from './gemini'
import type {
  DetectedItem,
  MatchedItem,
  ItemCatalogEntry,
  AddonConfig,
  MeasurementModel,
  ExpectedSignalConfig,
  ExtractedSignal,
  ExtractedSignalsV2,
} from '@estimator/shared'

/**
 * Simplified pricing rules interface for auto-context generation
 * We only need the parts relevant for AI prompt generation
 */
export interface PricingRulesForContext {
  measurementModel?: MeasurementModel
  addons?: Array<AddonConfig & {
    triggerConditions?: string[]
  }>
  multipliers?: Array<{
    when: {
      fieldId: string
      operator?: string
      equals?: string | number | boolean
      value?: string | number
    }
    multiplier: number
    label?: string
  }>
}

/**
 * Service info for auto-context generation
 */
export interface ServiceForContext {
  name: string
  description?: string | null
  scopeIncludes?: string[]
  scopeExcludes?: string[]
}

/**
 * Auto-generate AI prompt context from business configuration
 *
 * This function builds intelligent guidance for the AI based on:
 * 1. Measurement model (what to count/measure)
 * 2. Addon configurations (what conditions to look for)
 * 3. Multiplier conditions (severity/size variations)
 * 4. Service scope boundaries
 *
 * This replaces manual prompt_context entry - businesses configure pricing rules,
 * and AI guidance is derived automatically.
 */
export function autoGeneratePromptContext(
  service: ServiceForContext,
  pricingRules?: PricingRulesForContext
): string | undefined {
  const context: string[] = []

  // 1. Infer from measurement model - tells AI what to count/measure
  if (pricingRules?.measurementModel) {
    const { unit, unitLabel } = pricingRules.measurementModel
    const label = unitLabel || inferUnitLabelFromServiceName(service.name) || 'item'

    if (unit === 'item') {
      context.push(`Count individual ${label}s carefully. Each ${label} should be counted separately.`)
    } else if (unit === 'sqft' || unit === 'sqm') {
      context.push(`Estimate the total ${unit === 'sqft' ? 'square footage' : 'square meters'} of the area.`)
    } else if (unit === 'linear_ft' || unit === 'linear_m') {
      context.push(`Estimate the total linear ${unit === 'linear_ft' ? 'feet' : 'meters'}.`)
    } else if (unit === 'room') {
      context.push('Count the number of rooms that need service.')
    }
  }

  // 2. Infer from addon configurations - what conditions to look for
  if (pricingRules?.addons && pricingRules.addons.length > 0) {
    const conditions = pricingRules.addons
      .flatMap(a => a.triggerConditions || [])
      .filter(Boolean)
      .map(c => c.replace(/_/g, ' '))

    if (conditions.length > 0) {
      // Deduplicate conditions
      const uniqueConditions = [...new Set(conditions)]
      context.push(`Look for these conditions in photos: ${uniqueConditions.join(', ')}.`)
    }
  }

  // 3. Infer from multiplier conditions - severity/size variations
  if (pricingRules?.multipliers && pricingRules.multipliers.length > 0) {
    const severityFields = pricingRules.multipliers
      .map(m => m.when.fieldId)
      .filter(id => {
        const idLower = id.toLowerCase()
        return idLower.includes('size') ||
               idLower.includes('severity') ||
               idLower.includes('condition') ||
               idLower.includes('difficulty')
      })

    if (severityFields.length > 0) {
      context.push('Note severity, size, or condition variations - these affect pricing.')
    }
  }

  // 4. Infer from scope boundaries
  if (service.scopeIncludes && service.scopeIncludes.length > 0) {
    context.push(`Focus on: ${service.scopeIncludes.join(', ')}.`)
  }

  if (service.scopeExcludes && service.scopeExcludes.length > 0) {
    context.push(`Exclude from analysis: ${service.scopeExcludes.join(', ')}.`)
  }

  // Return undefined if no context was generated
  if (context.length === 0) {
    return undefined
  }

  return context.join(' ')
}

/**
 * Standard detectable conditions for addon triggering
 * These can be detected from images and trigger automatic addon recommendations
 */
export type DetectableCondition =
  | 'oil_stains'
  | 'rust_stains'
  | 'weed_growth'
  | 'moss_growth'
  | 'mold_mildew'
  | 'graffiti'
  | 'chewing_gum'
  | 'paint_overspray'
  | 'concrete_damage'
  | 'wood_rot'
  | 'heavy_soiling'
  | 'algae_buildup'
  | 'efflorescence'
  | 'pest_damage'
  | 'water_damage'
  | 'sun_damage'

/**
 * Extracted signals from image analysis
 */
export interface ExtractedSignals {
  /** Overall confidence in the extraction (0-1) */
  confidence: number

  /** Whether a site visit is recommended */
  siteVisitRecommended: boolean

  /** Reason for site visit recommendation */
  siteVisitReason?: string

  /** Detected job category */
  category?: string

  /** Detected materials */
  materials: string[]

  /** Estimated dimensions or area */
  dimensions?: {
    type: 'area' | 'linear' | 'count'
    value: number
    unit: string
    isEstimate: boolean
  }

  /** Condition assessment */
  condition?: {
    rating: 'good' | 'fair' | 'poor' | 'unknown'
    notes?: string
  }

  /** Complexity factors */
  complexity: {
    level: 'low' | 'medium' | 'high' | 'unknown'
    factors: string[]
  }

  /** Access difficulty */
  access?: {
    difficulty: 'easy' | 'moderate' | 'difficult' | 'unknown'
    notes?: string
  }

  /** Raw observations from the images */
  observations: string[]

  /** Any warnings or flags */
  warnings: string[]

  /** Specific conditions detected that may trigger addon recommendations */
  detectedConditions?: DetectableCondition[]

  /** Image-assessed condition (for validation against form answers) */
  assessedCondition?: 'excellent' | 'good' | 'fair' | 'poor'

  /** Detected inventory items from image analysis (for rental/event businesses) */
  detectedItems?: DetectedItem[]

  /** For count-based services: individual items detected with location details */
  countedItems?: Array<{
    itemType: string
    location: string
    details?: string
    confidence: number
  }>

  /** Quantity explicitly stated by customer in their notes (e.g., "I have 12 windows") */
  customerStatedQuantity?: number
}

/**
 * Rich context for signal extraction
 * The measurement model is the key signal that tells AI what to measure
 */
export interface SignalExtractionContext {
  serviceName: string
  serviceDescription?: string
  scopeIncludes?: string[]
  scopeExcludes?: string[]
  jobAddress?: string
  customerNotes?: string
  /** Tells AI what to measure - this is the key context */
  measurementModel?: {
    unit: string
    unitLabel: string
  }
  /** If catalog exists, AI should count these items */
  catalogItems?: string[]
  catalogCategories?: string[]
  /** What questions the business asks (helps AI understand what matters) */
  formFieldLabels?: string[]
  /** Custom AI guidance from business owner (industry-specific rules, counting methodology, etc.) */
  promptContext?: string
  /** Expected signals configuration - what specific signals to extract */
  expectedSignals?: ExpectedSignalConfig[]
}

/**
 * System prompt for signal extraction
 */
const SIGNAL_EXTRACTION_SYSTEM_PROMPT = `You are an expert estimator assistant analyzing photos for a quote request.

Your job is to extract structured signals from the images that will be used to calculate pricing.
You must NOT calculate or suggest prices - only extract observable facts and assessments.

IMPORTANT RULES:
1. Only describe what you can actually see in the images
2. If something is unclear, mark confidence as low and recommend site visit
3. Be conservative with estimates - it's better to flag uncertainty than guess wrong
4. Focus on factors that affect pricing: size, condition, materials, complexity, access
5. For detectedConditions: NEVER report conditions from customer notes - ONLY report what you can visually see in the photos

Return your analysis as a JSON object matching this structure exactly.`

/**
 * Infer unit label from service name when not explicitly configured
 * This helps the AI understand what to count for item-based services
 */
function inferUnitLabelFromServiceName(serviceName: string): string | null {
  const nameLower = serviceName.toLowerCase()

  // Map common service types to their countable units
  const unitPatterns: Array<{ keywords: string[]; unit: string }> = [
    { keywords: ['dent', 'ding'], unit: 'dent' },
    { keywords: ['scratch'], unit: 'scratch' },
    { keywords: ['window'], unit: 'window' },
    { keywords: ['panel'], unit: 'panel' },
    { keywords: ['door'], unit: 'door' },
    { keywords: ['tile'], unit: 'tile' },
    { keywords: ['light', 'fixture'], unit: 'fixture' },
    { keywords: ['tree', 'shrub'], unit: 'tree' },
    { keywords: ['appliance'], unit: 'appliance' },
    { keywords: ['room'], unit: 'room' },
    { keywords: ['chair'], unit: 'chair' },
    { keywords: ['table'], unit: 'table' },
  ]

  for (const pattern of unitPatterns) {
    if (pattern.keywords.some((kw) => nameLower.includes(kw))) {
      return pattern.unit
    }
  }

  return null
}

/**
 * Build dynamic prompt based on context
 * The measurement model is the key signal that tells AI what to measure
 */
function buildDynamicPrompt(context: SignalExtractionContext): string {
  let prompt = `Analyze these photos for a "${context.serviceName}" service quote request.\n`

  // Add service description for context
  if (context.serviceDescription) {
    prompt += `\nService description: ${context.serviceDescription}`
  }

  // Add scope information
  if (context.scopeIncludes?.length) {
    prompt += `\nThis service covers: ${context.scopeIncludes.join(', ')}`
  }
  if (context.scopeExcludes?.length) {
    prompt += `\nThis service does NOT cover: ${context.scopeExcludes.join(', ')}`
  }

  // Add custom AI guidance from business owner (prompt context)
  if (context.promptContext) {
    prompt += `\n\n**BUSINESS-SPECIFIC GUIDANCE**:\n${context.promptContext}`
  }

  // Add location and customer notes
  if (context.jobAddress) {
    prompt += `\nLocation: ${context.jobAddress}`
  }
  if (context.customerNotes) {
    prompt += `\nCustomer notes (USE these to INFER signals that cannot be determined from photos): ${context.customerNotes}`
  }

  // KEY: Tell AI what to measure based on measurement model
  if (context.measurementModel) {
    const { unit } = context.measurementModel
    // Derive unit label: use provided label, or infer from service name, or fallback to "item"
    const unitLabel = context.measurementModel.unitLabel || inferUnitLabelFromServiceName(context.serviceName) || 'item'

    if (unit === 'sqft' || unit === 'sqm') {
      prompt += `\n\n**MEASUREMENT INSTRUCTION**: This service is priced per ${unit === 'sqft' ? 'square foot' : 'square meter'}.`
      prompt += `\nYou MUST estimate the total area in ${unit}. Look at the photos and provide your best area estimate.`
      prompt += `\nSet dimensions.type to "area" and dimensions.unit to "${unit}".`
    } else if (unit === 'linear_ft' || unit === 'linear_m') {
      prompt += `\n\n**MEASUREMENT INSTRUCTION**: This service is priced per linear ${unit === 'linear_ft' ? 'foot' : 'meter'}.`
      prompt += `\nYou MUST estimate the total length. Set dimensions.type to "linear".`
    } else if (unit === 'item') {
      prompt += `\n\n**MEASUREMENT INSTRUCTION**: This service is priced per ${unitLabel}.`
      prompt += `\n\nCOUNTING METHODOLOGY - Follow these steps EXACTLY:`
      prompt += `\n1. SCAN the image systematically from left to right, top to bottom`
      prompt += `\n2. IDENTIFY each distinct ${unitLabel} - look for deformations, shadows, and reflection distortions`
      prompt += `\n3. COUNT each ${unitLabel} separately, even if they overlap or are close together`
      prompt += `\n4. For each ${unitLabel}, note its approximate location on the surface`
      prompt += `\n\nIMPORTANT: Err on the side of counting MORE rather than fewer. If you're unsure whether something is a separate ${unitLabel}, count it separately.`
      prompt += `\n\nProvide a "countedItems" array listing EACH individual ${unitLabel}:`
      prompt += `\n- itemType: severity/size (e.g., "large ${unitLabel}", "small ${unitLabel}", "medium ${unitLabel}")`
      prompt += `\n- location: specific location (e.g., "upper left area", "center near door handle", "lower right corner")`
      prompt += `\n- details: size estimate and any distinguishing features`
      prompt += `\n- confidence: 0-1 how confident you are`
      prompt += `\n\nThe total count in dimensions.value MUST match the number of items in countedItems array.`
      prompt += `\nSet dimensions.type to "count" and dimensions.unit to "${unitLabel}".`
      prompt += `\n\nQUANTITY EXTRACTION FROM CUSTOMER NOTES:`
      prompt += `\nIf the customer mentions a specific quantity in their notes (e.g., "I have 12 windows", "6 dents", "about 5 scratches"), extract that number.`
      prompt += `\nReturn it in the field: "customerStatedQuantity": <number> (or null if no quantity mentioned)`
      prompt += `\nThis is SEPARATE from the dimensions.value which should reflect what you COUNT in the photos.`
    } else if (unit === 'room') {
      prompt += `\n\n**MEASUREMENT INSTRUCTION**: This service is priced per room.`
      prompt += `\nCount the number of rooms visible or mentioned. Set dimensions.type to "count" and dimensions.unit to "room".`
    } else if (unit === 'hour') {
      prompt += `\n\n**MEASUREMENT INSTRUCTION**: This service is priced per hour.`
      prompt += `\nEstimate the approximate hours needed based on scope and complexity.`
    }
  }

  // If catalog exists, tell AI what items to look for
  if (context.catalogItems?.length) {
    prompt += `\n\nLook for these specific items: ${context.catalogItems.slice(0, 15).join(', ')}`
    if (context.catalogItems.length > 15) {
      prompt += ` (and ${context.catalogItems.length - 15} more)`
    }
  }
  if (context.catalogCategories?.length) {
    prompt += `\nItem categories: ${context.catalogCategories.join(', ')}`
  }

  // Include form field labels so AI understands what business cares about
  if (context.formFieldLabels?.length) {
    prompt += `\n\nThe business asks customers about: ${context.formFieldLabels.join(', ')}`
  }

  // Standard extraction instructions
  prompt += `

CRITICAL INSTRUCTION FOR detectedConditions:
- ONLY report conditions you can actually SEE in the photos
- Do NOT include conditions just because the customer mentioned them in their notes
- detectedConditions must be based on VISUAL EVIDENCE only from the images

Extract signals from the images and return a JSON object with this exact structure:

{
  "confidence": 0.0-1.0,
  "siteVisitRecommended": true/false,
  "siteVisitReason": "optional reason string",
  "category": "detected job category",
  "materials": ["list", "of", "detected", "materials"],
  "dimensions": {
    "type": "area|linear|count",
    "value": numeric_value,
    "unit": "sqft|sqm|ft|m|count|items|room",
    "isEstimate": true/false
  },
  "condition": {
    "rating": "good|fair|poor|unknown",
    "notes": "optional notes"
  },
  "complexity": {
    "level": "low|medium|high|unknown",
    "factors": ["list", "of", "complexity", "factors"]
  },
  "access": {
    "difficulty": "easy|moderate|difficult|unknown",
    "notes": "optional notes about access"
  },
  "observations": ["list", "of", "key", "observations"],
  "warnings": ["any", "concerns", "or", "flags"],
  "detectedConditions": ["list of specific conditions from: oil_stains, rust_stains, weed_growth, moss_growth, mold_mildew, graffiti, chewing_gum, paint_overspray, concrete_damage, wood_rot, heavy_soiling, algae_buildup, efflorescence, pest_damage, water_damage, sun_damage"],
  "assessedCondition": "excellent|good|fair|poor",
  "countedItems": [
    {
      "itemType": "specific type",
      "location": "specific location",
      "details": "optional size/severity",
      "confidence": 0.0-1.0
    }
  ],
  "customerStatedQuantity": null or number (if customer mentioned a specific quantity in their notes)
}

IMPORTANT:
- For detectedConditions: ONLY include conditions you can clearly SEE in the photos
- For assessedCondition: Give your honest assessment based ONLY on what you see
- For countedItems: Only include if the service prices per item/unit (when instructed above)

Respond with ONLY the JSON object, no other text.`

  return prompt
}

/**
 * Extract signals from images using Gemini
 *
 * Uses rich context to dynamically build prompts that adapt to any service type.
 * The measurement model is the key signal that tells AI what to measure.
 */
export async function extractSignals(
  client: GeminiClient,
  images: Array<{ mimeType: string; base64: string }>,
  context: SignalExtractionContext
): Promise<ExtractedSignals> {
  // Build dynamic prompt based on rich context
  const prompt = buildDynamicPrompt(context)

  console.log(`[Signals] Extracting signals for "${context.serviceName}"`)
  if (context.measurementModel) {
    console.log(`[Signals] Measurement model: ${context.measurementModel.unit} (${context.measurementModel.unitLabel})`)
  }

  const response = await client.generateWithImages(
    prompt,
    images,
    SIGNAL_EXTRACTION_SYSTEM_PROMPT
  )

  try {
    const signals = GeminiClient.parseJSON<ExtractedSignals>(response)
    return validateSignals(signals)
  } catch (error) {
    console.error('[Signals] Failed to parse Gemini response:', error)
    console.error('[Signals] Raw response:', response)

    // Return a default low-confidence result
    return getDefaultSignals('Failed to parse AI response')
  }
}

/**
 * Build prompt section for expected signals extraction
 */
function buildExpectedSignalsPromptSection(expectedSignals: ExpectedSignalConfig[]): string {
  if (!expectedSignals || expectedSignals.length === 0) {
    return ''
  }

  let section = `\n\n**EXPECTED SIGNALS TO EXTRACT**:
For this service, you MUST extract the following specific signals. Each signal should have a confidence score.
`

  for (const signal of expectedSignals) {
    section += `\n- "${signal.signalKey}" (${signal.type}): ${signal.description}`
    if (signal.type === 'enum' && signal.possibleValues?.length) {
      section += ` [Values: ${signal.possibleValues.join(', ')}]`
    }
  }

  section += `

**SIGNAL EXTRACTION - USE BOTH SOURCES**:
Use BOTH photos AND customer notes together to extract the most accurate signals:
- Photos: Best for visual signals (dimensions, condition, what you can see)
- Customer notes: Best for context, requirements, and details not visible in photos (e.g., "dead zones upstairs", "8 rooms", "router is 5 years old")
- Combine evidence from both sources when available
- Set source: "vision" if from photos, "inferred" if from customer notes, or combine both in evidence
- Examples: customer says "dead zones" → mesh_required: true, customer says "old router" → router_age: "old"
- Don't return "Cannot determine" if either source provides relevant clues

Include these in your response under a "signals" array with this structure:
{
  "signals": [
    {
      "key": "signal_key_from_above",
      "value": <extracted_value>,
      "confidence": 0.0-1.0,
      "source": "vision|form|nlp|inferred",
      "evidence": "brief explanation, photo reference, or quote from customer notes"
    }
  ]
}
`

  return section
}

/**
 * Extract structured signals (V2 format) with per-field confidence
 *
 * This is the new extraction method that returns structured signals
 * matching the service's expectedSignals configuration.
 */
export async function extractStructuredSignals(
  client: GeminiClient,
  images: Array<{ mimeType: string; base64: string }>,
  context: SignalExtractionContext
): Promise<ExtractedSignalsV2> {
  // Build dynamic prompt with expected signals section
  let prompt = buildDynamicPrompt(context)

  // Add expected signals extraction instructions
  if (context.expectedSignals?.length) {
    prompt += buildExpectedSignalsPromptSection(context.expectedSignals)
  }

  console.log(`[Signals] Extracting structured signals for "${context.serviceName}"`)
  if (context.expectedSignals?.length) {
    console.log(`[Signals] Expected signals: ${context.expectedSignals.map(s => s.signalKey).join(', ')}`)
  }

  const response = await client.generateWithImages(
    prompt,
    images,
    SIGNAL_EXTRACTION_SYSTEM_PROMPT
  )

  try {
    const rawSignals = GeminiClient.parseJSON<ExtractedSignals & { signals?: ExtractedSignal[] }>(response)
    const legacySignals = validateSignals(rawSignals)

    // Convert to V2 format
    return convertToSignalsV2(legacySignals, rawSignals.signals, context.expectedSignals)
  } catch (error) {
    console.error('[Signals] Failed to parse Gemini response:', error)
    console.error('[Signals] Raw response:', response)

    // Return a default low-confidence result
    return getDefaultSignalsV2('Failed to parse AI response')
  }
}

/**
 * Convert legacy signals to V2 format with structured signals array
 */
function convertToSignalsV2(
  legacy: ExtractedSignals,
  rawSignals: ExtractedSignal[] | undefined,
  expectedSignals: ExpectedSignalConfig[] | undefined
): ExtractedSignalsV2 {
  const signals: ExtractedSignal[] = []
  const lowConfidenceSignals: string[] = []

  // If AI returned structured signals, validate and use them
  if (rawSignals && Array.isArray(rawSignals)) {
    for (const signal of rawSignals) {
      if (typeof signal.key === 'string' && signal.value !== undefined) {
        const validated: ExtractedSignal = {
          key: signal.key,
          value: signal.value,
          confidence: typeof signal.confidence === 'number' ? Math.min(1, Math.max(0, signal.confidence)) : 0.5,
          source: (['vision', 'form', 'nlp', 'inferred'] as const).includes(signal.source as 'vision' | 'form' | 'nlp' | 'inferred')
            ? signal.source
            : 'inferred',
          evidence: signal.evidence,
        }
        signals.push(validated)

        // Track low confidence signals
        if (validated.confidence < 0.7) {
          lowConfidenceSignals.push(validated.key)
        }
      }
    }
  }

  // Auto-generate signals from legacy fields if not provided by AI
  if (signals.length === 0 || expectedSignals?.length) {
    // Add dimension signal
    if (legacy.dimensions) {
      const dimSignal: ExtractedSignal = {
        key: legacy.dimensions.type === 'count' ? 'item_count' : legacy.dimensions.type === 'area' ? 'surface_area' : 'linear_distance',
        value: legacy.dimensions.value,
        confidence: legacy.dimensions.isEstimate ? 0.6 : 0.8,
        source: 'vision',
        evidence: `${legacy.dimensions.value} ${legacy.dimensions.unit}`,
      }
      if (!signals.find(s => s.key === dimSignal.key)) {
        signals.push(dimSignal)
        if (dimSignal.confidence < 0.7) {
          lowConfidenceSignals.push(dimSignal.key)
        }
      }
    }

    // Add condition signal
    if (legacy.condition) {
      const condSignal: ExtractedSignal = {
        key: 'condition_rating',
        value: legacy.condition.rating,
        confidence: legacy.condition.rating === 'unknown' ? 0.3 : 0.75,
        source: 'vision',
        evidence: legacy.condition.notes,
      }
      if (!signals.find(s => s.key === condSignal.key)) {
        signals.push(condSignal)
        if (condSignal.confidence < 0.7) {
          lowConfidenceSignals.push(condSignal.key)
        }
      }
    }

    // Add complexity signal
    if (legacy.complexity && legacy.complexity.level !== 'unknown') {
      const compSignal: ExtractedSignal = {
        key: 'complexity_level',
        value: legacy.complexity.level,
        confidence: 0.7,
        source: 'vision',
        evidence: legacy.complexity.factors.join(', '),
      }
      if (!signals.find(s => s.key === compSignal.key)) {
        signals.push(compSignal)
      }
    }

    // Add access difficulty signal
    if (legacy.access && legacy.access.difficulty !== 'unknown') {
      const accessSignal: ExtractedSignal = {
        key: 'access_difficulty',
        value: legacy.access.difficulty,
        confidence: 0.7,
        source: 'vision',
        evidence: legacy.access.notes,
      }
      if (!signals.find(s => s.key === accessSignal.key)) {
        signals.push(accessSignal)
      }
    }

    // Add detected conditions as boolean signals
    if (legacy.detectedConditions?.length) {
      for (const condition of legacy.detectedConditions) {
        const condKey = `has_${condition}`
        if (!signals.find(s => s.key === condKey)) {
          signals.push({
            key: condKey,
            value: true,
            confidence: 0.8,
            source: 'vision',
            evidence: `Detected ${condition.replace(/_/g, ' ')} in photos`,
          })
        }
      }
    }
  }

  return {
    extractedAt: new Date().toISOString(),
    overallConfidence: legacy.confidence,
    signals,
    dimensions: legacy.dimensions,
    condition: legacy.condition,
    complexity: legacy.complexity,
    siteVisitRecommended: legacy.siteVisitRecommended,
    siteVisitReason: legacy.siteVisitReason,
    lowConfidenceSignals,
  }
}

/**
 * Get default V2 signals when extraction fails
 */
export function getDefaultSignalsV2(reason: string): ExtractedSignalsV2 {
  return {
    extractedAt: new Date().toISOString(),
    overallConfidence: 0,
    signals: [],
    complexity: { level: 'unknown', factors: [] },
    siteVisitRecommended: true,
    siteVisitReason: reason,
    lowConfidenceSignals: [],
  }
}

/**
 * Get V2 signals without AI (for when no images provided)
 */
export function getSignalsWithoutImagesV2(): ExtractedSignalsV2 {
  return {
    extractedAt: new Date().toISOString(),
    overallConfidence: 0.3,
    signals: [],
    complexity: { level: 'unknown', factors: [] },
    siteVisitRecommended: true,
    siteVisitReason: 'No images provided for assessment',
    lowConfidenceSignals: [],
  }
}

/**
 * Valid detectable conditions
 */
const VALID_CONDITIONS: DetectableCondition[] = [
  'oil_stains',
  'rust_stains',
  'weed_growth',
  'moss_growth',
  'mold_mildew',
  'graffiti',
  'chewing_gum',
  'paint_overspray',
  'concrete_damage',
  'wood_rot',
  'heavy_soiling',
  'algae_buildup',
  'efflorescence',
  'pest_damage',
  'water_damage',
  'sun_damage',
]

/**
 * Validate and normalize extracted signals
 */
function validateSignals(signals: Partial<ExtractedSignals>): ExtractedSignals {
  // Validate detectedConditions - only allow known conditions
  let detectedConditions: DetectableCondition[] | undefined
  if (Array.isArray(signals.detectedConditions)) {
    detectedConditions = signals.detectedConditions.filter(
      (c): c is DetectableCondition => VALID_CONDITIONS.includes(c as DetectableCondition)
    )
    if (detectedConditions.length === 0) {
      detectedConditions = undefined
    }
  }

  // Validate assessedCondition
  const validAssessedConditions = ['excellent', 'good', 'fair', 'poor'] as const
  let assessedCondition: ExtractedSignals['assessedCondition']
  if (signals.assessedCondition && validAssessedConditions.includes(signals.assessedCondition)) {
    assessedCondition = signals.assessedCondition
  }

  // Validate countedItems (for count-based services)
  let countedItems: ExtractedSignals['countedItems']
  if (Array.isArray(signals.countedItems)) {
    countedItems = signals.countedItems
      .filter((item) => {
        return (
          typeof item.itemType === 'string' &&
          item.itemType.length > 0 &&
          typeof item.location === 'string' &&
          item.location.length > 0
        )
      })
      .map((item) => ({
        itemType: item.itemType.trim(),
        location: item.location.trim(),
        details: item.details,
        confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.7,
      }))

    if (countedItems.length === 0) {
      countedItems = undefined
    }
  }

  // Validate customerStatedQuantity
  let customerStatedQuantity: number | undefined
  if (typeof signals.customerStatedQuantity === 'number' && signals.customerStatedQuantity > 0) {
    customerStatedQuantity = Math.round(signals.customerStatedQuantity)
  }

  return {
    confidence: typeof signals.confidence === 'number' ? Math.min(1, Math.max(0, signals.confidence)) : 0.5,
    siteVisitRecommended: signals.siteVisitRecommended ?? false,
    siteVisitReason: signals.siteVisitReason,
    category: signals.category,
    materials: Array.isArray(signals.materials) ? signals.materials : [],
    dimensions: signals.dimensions,
    condition: signals.condition,
    complexity: signals.complexity || { level: 'unknown', factors: [] },
    access: signals.access,
    observations: Array.isArray(signals.observations) ? signals.observations : [],
    warnings: Array.isArray(signals.warnings) ? signals.warnings : [],
    detectedConditions,
    assessedCondition,
    countedItems,
    customerStatedQuantity,
  }
}

/**
 * Get default signals when extraction fails
 */
export function getDefaultSignals(reason: string): ExtractedSignals {
  return {
    confidence: 0,
    siteVisitRecommended: true,
    siteVisitReason: reason,
    materials: [],
    complexity: { level: 'unknown', factors: [] },
    observations: [],
    warnings: [reason],
  }
}

/**
 * Get signals without AI (for when no images provided)
 */
export function getSignalsWithoutImages(): ExtractedSignals {
  return {
    confidence: 0.3,
    siteVisitRecommended: true,
    siteVisitReason: 'No images provided for assessment',
    materials: [],
    complexity: { level: 'unknown', factors: [] },
    observations: ['Quote generated without images'],
    warnings: ['No images provided - pricing based on form inputs only'],
  }
}

/**
 * Add-on definition for AI matching
 */
export interface AddonForMatching {
  id: string
  label: string
  description?: string
}

/**
 * Result of AI add-on detection
 */
export interface AddonDetectionResult {
  addonId: string
  reason: string
  confidence: number
}

/**
 * Detect relevant add-ons from customer description using AI
 *
 * This intelligently analyzes what the customer wrote and matches it
 * against available add-ons, regardless of exact wording.
 */
export async function detectAddonsFromDescription(
  client: GeminiClient,
  serviceName: string,
  customerDescription: string,
  availableAddons: AddonForMatching[]
): Promise<AddonDetectionResult[]> {
  if (!customerDescription || availableAddons.length === 0) {
    return []
  }

  // Build the addon list for the prompt
  const addonList = availableAddons
    .map((a, i) => `${i + 1}. ID: "${a.id}" - ${a.label}${a.description ? ` (${a.description})` : ''}`)
    .join('\n')

  const prompt = `You are analyzing a customer's project description to identify which add-on services they need.

Service: ${serviceName}

Customer's description:
"${customerDescription}"

Available add-ons for this service:
${addonList}

Analyze the customer's description and identify which add-ons are relevant based on what they mentioned.
Be intelligent about matching - the customer may not use exact terms. For example:
- "oil stains" or "greasy marks" → oil stain removal
- "weeds growing" or "grass in cracks" → weed removal
- "looks dirty" or "green stuff" → moss/algae treatment
- "seal it after" or "protect the surface" → sealing

Return a JSON array of matched add-ons. Only include add-ons that are clearly relevant to what the customer described.
If no add-ons match, return an empty array.

Response format:
[
  {
    "addonId": "the exact addon ID from the list",
    "reason": "brief explanation of why this addon is needed based on description",
    "confidence": 0.8
  }
]

Respond with ONLY the JSON array, no other text.`

  try {
    const response = await client.generateText(prompt)
    const results = GeminiClient.parseJSON<AddonDetectionResult[]>(response)

    if (!Array.isArray(results)) {
      console.log('[AddonDetection] Invalid response format, expected array')
      return []
    }

    // Validate and filter results
    const validAddonIds = new Set(availableAddons.map((a) => a.id))
    const validated = results.filter((r) => {
      if (!r.addonId || !validAddonIds.has(r.addonId)) {
        console.log(`[AddonDetection] Skipping invalid addon ID: ${r.addonId}`)
        return false
      }
      return true
    })

    console.log(`[AddonDetection] Detected ${validated.length} add-ons from description`)
    for (const addon of validated) {
      console.log(`[AddonDetection]   - ${addon.addonId}: ${addon.reason}`)
    }

    return validated
  } catch (error) {
    console.error('[AddonDetection] Failed to detect add-ons:', error)
    return []
  }
}

// ============================================================================
// INVENTORY ITEM DETECTION (generic for any industry)
// ============================================================================

/**
 * Context for inventory item extraction
 * Allows AI prompts to adapt to any industry/business type
 */
export interface InventoryDetectionContext {
  /** Service name, e.g., "Interior Fitting", "Event Decoration", "Landscaping" */
  serviceName: string
  /** Optional service description for more context */
  serviceDescription?: string
  /** Categories from the item catalog, e.g., ["lighting", "seating", "counters"] */
  catalogCategories?: string[]
  /** Item names from the catalog, e.g., ["Pendant Light", "Booth Seating", "Bar Counter"] */
  catalogItems?: string[]
  /** Customer notes about what they want */
  customerNotes?: string
}

/**
 * Build dynamic system prompt based on business context
 */
function buildInventorySystemPrompt(context: InventoryDetectionContext): string {
  return `You are an expert at identifying items and elements in photos for a "${context.serviceName}" business.
${context.serviceDescription ? `Business context: ${context.serviceDescription}` : ''}

Your job is to accurately identify and count all items/elements in the photos that would be relevant for pricing a ${context.serviceName} quote.

IMPORTANT RULES:
1. Be specific about item types (e.g., "pendant light" not just "light", "booth seating" not just "seating")
2. Count items carefully - estimate if items are partially visible or obscured
3. Provide confidence based on how clearly you can see and count the items
4. Note relevant details like color, material, size, and style
5. Focus on items that this type of business would typically provide or install`
}

/**
 * Build dynamic user prompt based on business context
 */
function buildInventoryUserPrompt(context: InventoryDetectionContext): string {
  // Build the items/categories hint section
  let itemsHint = ''
  if (context.catalogCategories && context.catalogCategories.length > 0) {
    itemsHint += `\nFocus on these categories: ${context.catalogCategories.join(', ')}`
  }
  if (context.catalogItems && context.catalogItems.length > 0) {
    // Show up to 15 items to keep prompt size manageable
    const sampleItems = context.catalogItems.slice(0, 15)
    itemsHint += `\nKnown items this business offers: ${sampleItems.join(', ')}`
    if (context.catalogItems.length > 15) {
      itemsHint += ` (and ${context.catalogItems.length - 15} more)`
    }
  }

  return `You are analyzing photos for a "${context.serviceName}" business.
${context.customerNotes ? `The customer said: "${context.customerNotes}"` : ''}

Identify all items/elements in these images that would be relevant for a ${context.serviceName} quote.
${itemsHint}

For each item, provide:
- itemType: Specific name (e.g., "pendant light" not just "light", "round table 6ft" not just "table")
- quantity: Count visible items (estimate if partially hidden)
- confidence: 0-1 how sure you are about identification and count
- description: Details like color, material, size, style

Return a JSON object with this exact structure:
{
  "detectedItems": [
    {
      "itemType": "specific item name",
      "quantity": number,
      "confidence": 0.0-1.0,
      "description": "optional details about color, material, style"
    }
  ]
}

If no relevant items are visible, return: { "detectedItems": [] }

Respond with ONLY the JSON object, no other text.`
}

/**
 * Extract inventory items from images using Gemini
 *
 * This works for any industry - event rentals, interior fitting, landscaping, etc.
 * The AI adapts its detection based on the service type and catalog provided.
 */
export async function extractInventoryItems(
  client: GeminiClient,
  images: Array<{ mimeType: string; base64: string }>,
  context: InventoryDetectionContext
): Promise<DetectedItem[]> {
  if (images.length === 0) {
    return []
  }

  // Build dynamic prompts based on business context
  const systemPrompt = buildInventorySystemPrompt(context)
  const userPrompt = buildInventoryUserPrompt(context)

  console.log(`[InventoryDetection] Analyzing images for "${context.serviceName}" service`)
  if (context.catalogCategories?.length) {
    console.log(`[InventoryDetection] Catalog categories: ${context.catalogCategories.join(', ')}`)
  }

  try {
    const response = await client.generateWithImages(
      userPrompt,
      images,
      systemPrompt
    )

    const result = GeminiClient.parseJSON<{ detectedItems: DetectedItem[] }>(response)

    if (!result.detectedItems || !Array.isArray(result.detectedItems)) {
      console.log('[InventoryDetection] No items detected in response')
      return []
    }

    // Validate and normalize the items
    const validatedItems = result.detectedItems
      .filter((item): item is DetectedItem => {
        return (
          typeof item.itemType === 'string' &&
          item.itemType.length > 0 &&
          typeof item.quantity === 'number' &&
          item.quantity > 0
        )
      })
      .map((item) => ({
        itemType: item.itemType.toLowerCase().trim(),
        quantity: Math.max(1, Math.round(item.quantity)),
        confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.7,
        description: item.description,
      }))

    console.log(`[InventoryDetection] Detected ${validatedItems.length} item types`)
    for (const item of validatedItems) {
      console.log(`[InventoryDetection]   - ${item.quantity}× ${item.itemType} (conf: ${item.confidence})`)
    }

    return validatedItems
  } catch (error) {
    console.error('[InventoryDetection] Failed to extract inventory items:', error)
    return []
  }
}

/**
 * System prompt for catalog matching
 */
const CATALOG_MATCHING_SYSTEM_PROMPT = `You are an expert at matching detected event items to a rental catalog.
Your job is to find the best catalog match for each detected item, considering variations in naming.

MATCHING RULES:
1. Match items semantically - "tiffany chair" and "chiavari chair" are the same thing
2. Match size variations - "6ft round table" should match "round table 6ft"
3. Check aliases - some catalog items have alternate names listed
4. If no good match exists, don't force a match - leave it unmatched
5. Be confident about obvious matches, less confident about approximate matches`

/**
 * Match detected items to catalog using AI
 *
 * This intelligently matches items even when naming differs:
 * - "tiffany chair" → "Chiavari Chair"
 * - "highboy table" → "Cocktail Table"
 * - "6 foot round" → "Round Table 6ft"
 */
export async function matchItemsToCatalog(
  client: GeminiClient,
  detectedItems: DetectedItem[],
  catalog: ItemCatalogEntry[]
): Promise<MatchedItem[]> {
  if (detectedItems.length === 0 || catalog.length === 0) {
    return []
  }

  // Build catalog description for the prompt
  const catalogDescription = catalog
    .map((item) => {
      let desc = `- ID: "${item.id}", Name: "${item.name}"`
      if (item.aliases && item.aliases.length > 0) {
        desc += `, Also known as: ${item.aliases.join(', ')}`
      }
      if (item.category) {
        desc += ` [${item.category}]`
      }
      return desc
    })
    .join('\n')

  // Build detected items description
  const detectedDescription = detectedItems
    .map((item, i) => `${i + 1}. "${item.itemType}" (quantity: ${item.quantity})${item.description ? ` - ${item.description}` : ''}`)
    .join('\n')

  const prompt = `Match these detected items to the catalog below.

DETECTED ITEMS:
${detectedDescription}

CATALOG:
${catalogDescription}

For each detected item, find the best matching catalog item (if any).
Consider:
- Exact name matches
- Alias matches
- Semantic equivalents (e.g., "tiffany chair" = "chiavari chair")
- Size/dimension matches

Return a JSON array with matches. Only include items that have a reasonable catalog match.

{
  "matches": [
    {
      "detectedIndex": 0,
      "catalogId": "catalog item id",
      "matchConfidence": 0.95
    }
  ]
}

If an item has no good match, omit it from the results.
Respond with ONLY the JSON object.`

  try {
    const response = await client.generateText(
      prompt,
      CATALOG_MATCHING_SYSTEM_PROMPT
    )

    const result = GeminiClient.parseJSON<{
      matches: Array<{
        detectedIndex: number
        catalogId: string
        matchConfidence: number
      }>
    }>(response)

    if (!result.matches || !Array.isArray(result.matches)) {
      console.log('[CatalogMatching] No matches found in response')
      return []
    }

    // Build catalog lookup
    const catalogMap = new Map(catalog.map((c) => [c.id, c]))

    // Create matched items
    const matchedItems: MatchedItem[] = []

    for (const match of result.matches) {
      const detected = detectedItems[match.detectedIndex]
      const catalogItem = catalogMap.get(match.catalogId)

      if (!detected || !catalogItem) {
        console.log(`[CatalogMatching] Skipping invalid match: index=${match.detectedIndex}, catalogId=${match.catalogId}`)
        continue
      }

      matchedItems.push({
        itemType: detected.itemType,
        quantity: detected.quantity,
        confidence: detected.confidence,
        description: detected.description,
        catalogId: catalogItem.id,
        catalogName: catalogItem.name,
        pricePerUnit: catalogItem.pricePerUnit,
        matchConfidence: typeof match.matchConfidence === 'number'
          ? Math.min(1, Math.max(0, match.matchConfidence))
          : 0.8,
      })
    }

    console.log(`[CatalogMatching] Matched ${matchedItems.length}/${detectedItems.length} items to catalog`)
    for (const item of matchedItems) {
      console.log(`[CatalogMatching]   - "${item.itemType}" → "${item.catalogName}" @ ${item.pricePerUnit}/ea`)
    }

    return matchedItems
  } catch (error) {
    console.error('[CatalogMatching] Failed to match items to catalog:', error)
    return []
  }
}
