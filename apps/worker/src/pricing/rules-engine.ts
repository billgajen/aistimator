/**
 * Rules Engine
 *
 * Computes deterministic pricing from:
 * - Tenant pricing configuration (base fee, addons, multipliers)
 * - Extracted AI signals
 * - Customer form answers
 *
 * IMPORTANT: AI does NOT set prices. All pricing is computed from rules.
 */

import type { ExtractedSignals } from '../ai/signals'
import type {
  MeasurementModel,
  SiteVisitRules,
  AddonConfig,
  ItemCatalogEntry,
  MatchedItem,
  WorkStepConfig,
  PricingTrace,
  PricingTraceStep,
  ExtractedSignalsV2,
  ExtractedSignal,
} from '@estimator/shared'
import type { CrossServiceEstimate } from '../ai/cross-service'

/**
 * Pricing rules from tenant configuration
 */
export interface PricingRules {
  baseFee: number
  minimumCharge: number
  addons: Array<AddonConfig & {
    /** Optional: only apply if signal matches (legacy) */
    signalMatch?: {
      field: 'category' | 'materials' | 'complexity' | 'condition'
      contains?: string
      equals?: string
    }
  }>
  multipliers: Array<{
    when: {
      fieldId: string
      operator?: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte'
      equals?: string | number | boolean
      value?: string | number
    }
    multiplier: number
    label?: string
  }>
  /** Measurement model for per-unit pricing */
  measurementModel?: MeasurementModel
  /** Site visit recommendation rules */
  siteVisitRules?: SiteVisitRules
  /** Item catalog for inventory-based pricing (rentals, events, etc.) */
  itemCatalog?: ItemCatalogEntry[]
  /** Work steps for the new work-step pricing model */
  workSteps?: WorkStepConfig[]
  /** @deprecated Use measurementModel instead. Per-unit pricing (e.g., per sqft) */
  unitPricing?: {
    pricePerUnit: number
    unit: string
  }
}

/**
 * Form answer from customer
 */
export interface FormAnswer {
  fieldId: string
  value: string | number | boolean | string[]
}

/**
 * Customer-provided job data
 */
export interface JobData {
  /** Customer-provided quantity (for per-unit pricing) */
  quantity?: number
  /** Matched inventory items (from AI detection + catalog matching) */
  matchedItems?: MatchedItem[]
}

/**
 * Recommended addon with reason
 */
export interface RecommendedAddon {
  id: string
  label: string
  price: number
  reason: string
  source: 'keyword' | 'image_signal' | 'signal_match'
}

/**
 * Pricing calculation result
 */
export interface PricingResult {
  currency: string
  subtotal: number
  taxLabel?: string
  taxRate?: number
  taxAmount: number
  total: number
  breakdown: Array<{
    label: string
    amount: number
    /** Whether this addon was auto-recommended */
    autoRecommended?: boolean
    /** Reason for auto-recommendation */
    recommendationReason?: string
  }>
  /** Confidence level (0-1), affects whether range is shown */
  confidence: number
  /** If confidence is low, show a range */
  range?: {
    low: number
    high: number
  }
  /** Notes about the calculation */
  notes: string[]
  /** Addons that were auto-recommended based on keywords/signals */
  recommendedAddons?: RecommendedAddon[]
}

/**
 * Tenant tax configuration
 */
export interface TaxConfig {
  enabled: boolean
  label?: string
  rate?: number
}

/**
 * Context for keyword-based addon detection
 */
export interface AddonDetectionContext {
  /** Customer's project description */
  projectDescription?: string
  /** Form answers that may contain description */
  formAnswers?: FormAnswer[]
}

/**
 * Service context for addon filtering
 * Used to filter out addons that are already covered by the core service
 */
export interface ServiceContext {
  /** Service name (e.g., "Car Dent Repair and Paintwork") */
  name: string
  /** What's included in the service scope */
  scopeIncludes?: string[]
}

/**
 * Calculate pricing from rules, signals, and answers
 */
export function calculatePricing(
  rules: PricingRules,
  signals: ExtractedSignals,
  answers: FormAnswer[],
  taxConfig: TaxConfig,
  currency: string,
  jobData?: JobData,
  addonContext?: AddonDetectionContext,
  aiDetectedAddonIds?: Set<string>,
  serviceContext?: ServiceContext
): PricingResult {
  const breakdown: PricingResult['breakdown'] = []
  const notes: string[] = []
  let subtotal = 0

  // 1. Start with base fee
  if (rules.baseFee > 0) {
    breakdown.push({ label: 'Base fee', amount: rules.baseFee })
    subtotal += rules.baseFee
  }

  // 1.5 Process matched inventory items (for rental/event businesses)
  if (jobData?.matchedItems && jobData.matchedItems.length > 0) {
    for (const item of jobData.matchedItems) {
      const lineAmount = item.quantity * item.pricePerUnit
      const label = `${item.quantity} × ${item.catalogName} @ ${formatCurrency(item.pricePerUnit, currency)}`
      breakdown.push({
        label,
        amount: lineAmount,
        autoRecommended: true,
        recommendationReason: item.description
          ? `Detected: ${item.description}`
          : `Detected in photos: ${item.itemType}`,
      })
      subtotal += lineAmount
    }

    // Add note about AI-detected items
    if (jobData.matchedItems.some((item) => item.confidence < 0.8)) {
      notes.push('Some item quantities are estimated from photos')
    }
  }

  // 2. Apply measurement model (per-unit pricing)
  const measurementModel = rules.measurementModel
  if (measurementModel?.type === 'per_unit' && measurementModel.pricePerUnit > 0) {
    // Determine quantity with priority: customer-stated (from notes) > form-input > AI-detected
    let quantity: number | undefined
    let quantitySource: 'customer_notes' | 'form' | 'ai' | undefined

    if (signals.customerStatedQuantity && signals.customerStatedQuantity > 0) {
      // Customer explicitly mentioned a number in their description
      quantity = signals.customerStatedQuantity
      quantitySource = 'customer_notes'
    } else if (jobData?.quantity && jobData.quantity > 0) {
      // Customer entered quantity in form field
      quantity = jobData.quantity
      quantitySource = 'form'
    } else if (signals.dimensions?.value) {
      // AI detected from photos
      quantity = signals.dimensions.value
      quantitySource = 'ai'
    }

    // Flag discrepancy if customer stated differs from AI detected
    if (signals.customerStatedQuantity && signals.dimensions?.value) {
      const customerQty = signals.customerStatedQuantity
      const aiQty = signals.dimensions.value
      if (customerQty !== aiQty) {
        notes.push(`Customer mentioned ${customerQty} items, photos show ${aiQty} - using customer's count`)
      }
    }

    if (quantity) {
      const unitAmount = quantity * measurementModel.pricePerUnit
      const unitLabel = measurementModel.unitLabel || getDefaultUnitLabel(measurementModel.unit)
      const label = `${quantity} ${unitLabel} × ${formatCurrency(measurementModel.pricePerUnit, currency)}`
      breakdown.push({ label, amount: unitAmount })
      subtotal += unitAmount

      if (quantitySource === 'ai' && signals.dimensions?.isEstimate) {
        notes.push('Quantity is estimated from photos')
      }
    } else {
      notes.push('Per-unit pricing requires quantity - using base fee only')
    }
  }

  // Legacy unit pricing support (deprecated)
  if (!measurementModel && rules.unitPricing && signals.dimensions) {
    const unitAmount = signals.dimensions.value * rules.unitPricing.pricePerUnit
    const label = `${signals.dimensions.value} ${signals.dimensions.unit} × ${formatCurrency(rules.unitPricing.pricePerUnit, currency)}/${rules.unitPricing.unit}`
    breakdown.push({ label, amount: unitAmount })
    subtotal += unitAmount

    if (signals.dimensions.isEstimate) {
      notes.push('Area is estimated from photos')
    }
  }

  // 3. Apply addons based on signals, answers, and keyword matching
  const recommendedAddons: RecommendedAddon[] = []

  // Build searchable text from project description and form answers
  const searchableText = buildSearchableText(addonContext)

  for (const addon of rules.addons) {
    const addonMatch = shouldApplyAddon(addon, signals, answers, searchableText, aiDetectedAddonIds, serviceContext)
    if (addonMatch.apply) {
      breakdown.push({
        label: addon.label,
        amount: addon.price,
        autoRecommended: addonMatch.autoRecommended,
        recommendationReason: addonMatch.reason,
      })
      subtotal += addon.price

      // Track recommended addons for display
      if (addonMatch.autoRecommended) {
        recommendedAddons.push({
          id: addon.id,
          label: addon.label,
          price: addon.price,
          reason: addonMatch.reason || 'Recommended based on project details',
          source: addonMatch.source || 'keyword',
        })
      }
    }
  }

  // 4. Apply multipliers from form answers - show each as separate line item
  let runningSubtotal = subtotal

  for (const mult of rules.multipliers) {
    if (shouldApplyMultiplier(mult, answers)) {
      const adjustmentAmount = runningSubtotal * (mult.multiplier - 1)
      if (adjustmentAmount !== 0) {
        // Generate descriptive label from the condition if none provided
        const label = mult.label || generateMultiplierLabel(mult, answers)
        breakdown.push({ label, amount: Math.round(adjustmentAmount * 100) / 100 })
        runningSubtotal = runningSubtotal * mult.multiplier
      }
    }
  }

  // Apply complexity multiplier from signals
  const complexityMultiplier = getComplexityMultiplier(signals.complexity.level)
  if (complexityMultiplier !== 1.0) {
    const adjustmentAmount = runningSubtotal * (complexityMultiplier - 1)
    const label = signals.complexity.level === 'low'
      ? 'Simple job discount'
      : `${signals.complexity.level.charAt(0).toUpperCase() + signals.complexity.level.slice(1)} complexity`
    breakdown.push({ label, amount: Math.round(adjustmentAmount * 100) / 100 })
    runningSubtotal = runningSubtotal * complexityMultiplier
  }

  // Note: Automatic access difficulty multiplier was removed.
  // Businesses can configure access-based pricing as work steps with trigger conditions if needed.

  // Update subtotal with all multipliers applied
  subtotal = runningSubtotal

  // 5. Apply minimum charge
  if (rules.minimumCharge > 0 && subtotal < rules.minimumCharge) {
    notes.push(`Minimum charge of ${formatCurrency(rules.minimumCharge, currency)} applied`)
    subtotal = rules.minimumCharge
    // Replace breakdown with minimum charge
    breakdown.length = 0
    breakdown.push({ label: 'Minimum charge', amount: rules.minimumCharge })
  }

  // Round subtotal
  subtotal = Math.round(subtotal * 100) / 100

  // 6. Calculate tax
  // ISSUE-8 FIX: Use proper rounding to avoid penny discrepancies
  // First calculate actual tax amount (rate is stored as percentage, e.g., 20 for 20%)
  // Then round to 2 decimal places
  let taxAmount = 0
  if (taxConfig.enabled && taxConfig.rate) {
    const rawTax = subtotal * (taxConfig.rate / 100)
    taxAmount = Math.round(rawTax * 100) / 100
  }

  // 7. Calculate total
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  // 8. Calculate confidence and range
  const confidence = signals.confidence
  let range: PricingResult['range'] | undefined

  if (confidence < 0.7) {
    // Low confidence - show a range
    const variancePercent = confidence < 0.4 ? 0.3 : 0.15
    range = {
      low: Math.round(total * (1 - variancePercent) * 100) / 100,
      high: Math.round(total * (1 + variancePercent) * 100) / 100,
    }
    notes.push('Price shown as range due to limited information')
  }

  // 9. Add site visit note based on rules or signals
  const shouldRecommendSiteVisit = evaluateSiteVisitRules(
    rules.siteVisitRules,
    signals,
    total
  )

  if (shouldRecommendSiteVisit || signals.siteVisitRecommended) {
    notes.push(signals.siteVisitReason || 'Site visit recommended for accurate quote')
  }

  // Add any warnings from signals
  for (const warning of signals.warnings) {
    notes.push(warning)
  }

  return {
    currency,
    subtotal,
    taxLabel: taxConfig.enabled ? taxConfig.label : undefined,
    taxRate: taxConfig.enabled ? taxConfig.rate : undefined,
    taxAmount,
    total,
    breakdown,
    confidence,
    range,
    notes,
    recommendedAddons: recommendedAddons.length > 0 ? recommendedAddons : undefined,
  }
}

/**
 * Result of addon matching check
 */
interface AddonMatchResult {
  apply: boolean
  autoRecommended?: boolean
  reason?: string
  source?: 'keyword' | 'image_signal' | 'signal_match'
}

/**
 * Build searchable text from addon detection context
 */
function buildSearchableText(context?: AddonDetectionContext): string {
  if (!context) return ''

  const parts: string[] = []

  if (context.projectDescription) {
    parts.push(context.projectDescription)
  }

  if (context.formAnswers) {
    for (const answer of context.formAnswers) {
      // Look for description-like fields
      const isDescriptionField =
        answer.fieldId.includes('description') ||
        answer.fieldId.includes('notes') ||
        answer.fieldId.includes('details') ||
        answer.fieldId === '_project_description'

      if (isDescriptionField && typeof answer.value === 'string') {
        parts.push(answer.value)
      }
    }
  }

  return parts.join(' ').toLowerCase()
}

/**
 * Check if text contains any of the trigger keywords
 * Returns the matched keyword if found
 *
 * IMPORTANT: This function now checks for negation context.
 * If a keyword appears after negation words (e.g., "no polish", "don't want extras"),
 * it will be skipped and not returned as a match.
 */
function findMatchingKeyword(text: string, keywords: string[]): string | null {
  const textLower = text.toLowerCase()

  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase().trim()
    if (!keywordLower) continue

    // Check for word boundary matching to avoid false positives
    // e.g., "oil" shouldn't match "boiling"
    const regex = new RegExp(`\\b${escapeRegExp(keywordLower)}\\b`, 'i')
    if (regex.test(textLower)) {
      // Check if keyword is negated (e.g., "no polish", "don't want staining")
      if (isKeywordNegated(text, keyword)) {
        console.log(`[Pricing] Keyword "${keyword}" found but negated in context, skipping`)
        continue  // Skip this keyword, try next one
      }
      return keyword
    }
  }

  return null
}

/**
 * Escape special regex characters
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================================
// KEYWORD NEGATION DETECTION
// ============================================================================

/**
 * Global phrases that suppress ALL addon recommendations
 * These indicate the customer explicitly doesn't want extras
 */
const GLOBAL_ADDON_SUPPRESSORS = [
  /\b(no extras?)\b/i,
  /\b(please no extras?)\b/i,
  /\b(don'?t (want|need|add) (any )?extras?)\b/i,
  /\b(budget (only|focused|conscious))\b/i,
  /\b(keep it (simple|basic|minimal))\b/i,
  /\b(nothing extra)\b/i,
  /\b(just the basics?)\b/i,
  /\b(no add[- ]?ons?)\b/i,
  /\b(no additional)\b/i,
]

/**
 * Check if text contains global addon suppressor phrases
 * When detected, ALL keyword-triggered addons should be suppressed
 */
function hasGlobalAddonSuppressor(text: string): boolean {
  return GLOBAL_ADDON_SUPPRESSORS.some(pattern => pattern.test(text))
}

/**
 * Check if a keyword appears in a negation context
 * e.g., "no polish" or "don't want staining" should return true
 *
 * Checks if a negation word appears within 3 words before the keyword
 */
function isKeywordNegated(text: string, keyword: string): boolean {
  const textLower = text.toLowerCase()
  const keywordLower = keyword.toLowerCase()

  // Negation words to check for
  const negationWords = ['no', "don't", 'dont', "won't", 'wont', 'not', 'without', 'skip', 'avoid', 'exclude', 'never']

  // Build pattern: negation word, then 0-2 words, then the keyword
  // e.g., "no concrete", "don't want polish", "without the spur"
  const negationPattern = new RegExp(
    `\\b(${negationWords.join('|')})\\s+(\\w+\\s+){0,2}${escapeRegExp(keywordLower)}\\b`,
    'i'
  )

  return negationPattern.test(textLower)
}

/**
 * Extract main keyword from addon ID for scope matching
 * e.g., "paint_blending" → "paint", "deep_scratch_repair" → "scratch"
 */
function getAddonKeyword(addonId: string): string {
  const keywords = ['paint', 'scratch', 'dent', 'rust', 'polish', 'wax', 'seal', 'buff', 'clear', 'coat']
  const idLower = addonId.toLowerCase()
  return keywords.find(kw => idLower.includes(kw)) || ''
}

/**
 * Check if an addon's functionality is already part of the core service
 * Returns true if the addon should be filtered out (not recommended)
 */
function isAddonCoveredByService(
  addonId: string,
  serviceName: string,
  scopeIncludes: string[] = []
): boolean {
  const addonKeyword = getAddonKeyword(addonId)
  if (!addonKeyword) return false

  const serviceNameLower = serviceName.toLowerCase()
  const scopeText = scopeIncludes.join(' ').toLowerCase()

  // Check if the addon's core functionality is already in the service name or scope
  return serviceNameLower.includes(addonKeyword) || scopeText.includes(addonKeyword)
}

/**
 * Check if an addon should be applied
 */
function shouldApplyAddon(
  addon: PricingRules['addons'][0],
  signals: ExtractedSignals,
  answers: FormAnswer[],
  searchableText: string,
  aiDetectedAddonIds?: Set<string>,
  serviceContext?: ServiceContext
): AddonMatchResult {
  // 1. Check if addon is explicitly selected in form answers
  const answer = answers.find((a) => a.fieldId === addon.id)
  if (answer?.value === true || answer?.value === addon.id) {
    // Check if this was AI-detected (added to formAnswers by quote-processor)
    const wasAiDetected = aiDetectedAddonIds?.has(addon.id) ?? false
    if (wasAiDetected) {
      return {
        apply: true,
        autoRecommended: true,
        reason: 'Detected from your description',
        source: 'keyword',
      }
    }
    return { apply: true, autoRecommended: false }
  }

  // 2. Check keyword triggers in project description
  if (addon.triggerKeywords && addon.triggerKeywords.length > 0 && searchableText) {
    // Check for global addon suppressor phrases first (e.g., "no extras", "budget only")
    // If customer explicitly says they don't want extras, skip all keyword-based addons
    if (hasGlobalAddonSuppressor(searchableText)) {
      console.log(`[Pricing] Addon "${addon.id}" skipped - global suppressor phrase detected in: "${searchableText.substring(0, 100)}..."`)
      return { apply: false }
    }

    const matchedKeyword = findMatchingKeyword(searchableText, addon.triggerKeywords)
    if (matchedKeyword) {
      // Filter out if addon is already covered by the core service
      if (serviceContext && isAddonCoveredByService(addon.id, serviceContext.name, serviceContext.scopeIncludes)) {
        // Skip this addon - it's already part of the core service
        return { apply: false }
      }
      return {
        apply: true,
        autoRecommended: true,
        reason: `Recommended based on "${matchedKeyword}" in your description`,
        source: 'keyword',
      }
    }
  }

  // 3. Check image condition triggers
  if (addon.triggerConditions && addon.triggerConditions.length > 0) {
    // Check against detected conditions from image analysis
    const detectedConditions: string[] = signals.detectedConditions || []
    for (const condition of addon.triggerConditions) {
      if (detectedConditions.includes(condition)) {
        // Filter out if addon is already covered by the core service
        if (serviceContext && isAddonCoveredByService(addon.id, serviceContext.name, serviceContext.scopeIncludes)) {
          // Skip this addon - it's already part of the core service
          continue
        }
        return {
          apply: true,
          autoRecommended: true,
          reason: `Detected in photos: ${formatConditionName(condition)}`,
          source: 'image_signal',
        }
      }
    }

    // Also check against observations (for backward compatibility)
    for (const condition of addon.triggerConditions) {
      const conditionLower = condition.toLowerCase().replace(/_/g, ' ')
      const matchInObservations = signals.observations.some((obs) =>
        obs.toLowerCase().includes(conditionLower)
      )
      if (matchInObservations) {
        // Filter out if addon is already covered by the core service
        if (serviceContext && isAddonCoveredByService(addon.id, serviceContext.name, serviceContext.scopeIncludes)) {
          // Skip this addon - it's already part of the core service
          continue
        }
        return {
          apply: true,
          autoRecommended: true,
          reason: `Observed in photos: ${formatConditionName(condition)}`,
          source: 'image_signal',
        }
      }
    }
  }

  // 4. Legacy signal match (for backward compatibility)
  if (addon.signalMatch) {
    const { field, contains, equals } = addon.signalMatch

    let matched = false
    switch (field) {
      case 'category':
        if (equals && signals.category) {
          matched = signals.category.toLowerCase() === equals.toLowerCase()
        } else if (contains && signals.category) {
          matched = signals.category.toLowerCase().includes(contains.toLowerCase())
        }
        break

      case 'materials':
        if (contains) {
          matched = signals.materials.some((m) =>
            m.toLowerCase().includes(contains.toLowerCase())
          )
        }
        break

      case 'complexity':
        if (equals) {
          matched = signals.complexity.level === equals
        }
        break

      case 'condition':
        if (equals && signals.condition) {
          matched = signals.condition.rating === equals
        }
        break
    }

    if (matched) {
      // Filter out if addon is already covered by the core service
      if (serviceContext && isAddonCoveredByService(addon.id, serviceContext.name, serviceContext.scopeIncludes)) {
        // Skip this addon - it's already part of the core service
        return { apply: false }
      }
      return {
        apply: true,
        autoRecommended: true,
        reason: `Based on ${field} analysis`,
        source: 'signal_match',
      }
    }
  }

  return { apply: false }
}

/**
 * Format condition name for display
 */
function formatConditionName(condition: string): string {
  return condition
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Check if a multiplier should be applied
 */
function shouldApplyMultiplier(
  mult: PricingRules['multipliers'][0],
  answers: FormAnswer[]
): boolean {
  const answer = answers.find((a) => a.fieldId === mult.when.fieldId)
  if (!answer) return false

  const operator = mult.when.operator || 'equals'
  const compareValue = mult.when.equals ?? mult.when.value

  switch (operator) {
    case 'equals':
      // Type-aware comparison to handle form data types vs config value types
      // E.g., checkbox submits true (boolean) but config may have "Yes" (string)

      // ISSUE-7 FIX: Handle array fields - check if array CONTAINS the compare value
      // This allows multipliers to work with multi-select form fields
      if (Array.isArray(answer.value) && typeof compareValue === 'string') {
        const compareValueLower = compareValue.toLowerCase()
        const hasMatch = answer.value.some(v =>
          typeof v === 'string' && v.toLowerCase() === compareValueLower
        )
        if (hasMatch) {
          console.log(`[Pricing] Multiplier array match: field "${mult.when.fieldId}" contains "${compareValue}"`)
        }
        return hasMatch
      }

      // Handle boolean answer value → string compareValue
      if (typeof answer.value === 'boolean') {
        // Normalize compareValue to boolean for comparison
        const compareAsBool =
          compareValue === true ||
          compareValue === 'true' ||
          compareValue === 'True' ||
          compareValue === 'TRUE' ||
          compareValue === 'Yes' ||
          compareValue === 'yes' ||
          compareValue === 'YES' ||
          compareValue === '1' ||
          compareValue === 1
        return answer.value === compareAsBool
      }

      // Handle string answer value that represents a boolean → boolean compareValue
      // E.g., form sends "true" string but config has boolean true
      if (typeof answer.value === 'string' && typeof compareValue === 'boolean') {
        const answerAsBool =
          answer.value === 'true' ||
          answer.value === 'True' ||
          answer.value === 'TRUE' ||
          answer.value === 'Yes' ||
          answer.value === 'yes' ||
          answer.value === 'YES' ||
          answer.value === '1'
        return answerAsBool === compareValue
      }

      // Handle number answer value → string compareValue (or vice versa)
      if (typeof answer.value === 'number' || typeof compareValue === 'number') {
        const answerNum = Number(answer.value)
        const compareNum = Number(compareValue)
        // Only compare as numbers if both can be parsed as numbers
        if (!isNaN(answerNum) && !isNaN(compareNum)) {
          return answerNum === compareNum
        }
      }

      // FIX-3: Handle string comparisons with format normalization
      if (typeof answer.value === 'string' && typeof compareValue === 'string') {
        // First try case-insensitive exact match
        if (answer.value.toLowerCase() === compareValue.toLowerCase()) {
          return true
        }

        // FIX-3: Normalize common format variations (underscores, parentheses, spaces)
        const normalize = (s: string): string => s
          .toLowerCase()
          .replace(/_/g, ' ')           // underscores to spaces
          .replace(/[()<>]/g, '')       // remove brackets and comparison symbols
          .replace(/\s+/g, ' ')         // multiple spaces to single
          .trim()

        const normalizedAnswer = normalize(answer.value)
        const normalizedCompare = normalize(compareValue)

        if (normalizedAnswer === normalizedCompare) {
          console.log(`[Pricing] Multiplier match via normalization: "${answer.value}" ≈ "${compareValue}"`)
          return true
        }

        return false
      }

      // Fallback to strict equality
      return answer.value === compareValue
    case 'contains':
      if (typeof answer.value === 'string' && typeof compareValue === 'string') {
        return answer.value.toLowerCase().includes(compareValue.toLowerCase())
      }
      // ISSUE-4 FIX: Array contains with case-insensitive matching
      if (Array.isArray(answer.value) && typeof compareValue === 'string') {
        const compareValueLower = compareValue.toLowerCase()
        return answer.value.some(v =>
          typeof v === 'string' && v.toLowerCase() === compareValueLower
        )
      }
      return false
    // ISSUE-1 FIX: Numeric comparison operators now handle string values
    // Form inputs often come as strings (e.g., "30" instead of 30)
    case 'gt': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum > compareNum
    }
    case 'lt': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum < compareNum
    }
    case 'gte': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum >= compareNum
    }
    case 'lte': {
      const answerNum = coerceToNumber(answer.value)
      const compareNum = coerceToNumber(compareValue)
      if (answerNum === null || compareNum === null) return false
      return answerNum <= compareNum
    }
    default:
      return false
  }
}

/**
 * ISSUE-1 & ISSUE-2 FIX: Coerce a value to number with comma handling
 * Handles:
 * - Numbers (passthrough)
 * - String numbers ("30" → 30)
 * - Comma-formatted numbers ("2,400" → 2400)
 * - Empty/null/undefined → null
 */
function coerceToNumber(value: unknown): number | null {
  if (typeof value === 'number' && !isNaN(value)) {
    return value
  }
  if (typeof value === 'string') {
    // ISSUE-2 FIX: Strip commas from formatted numbers (e.g., "2,400" → "2400")
    const cleaned = value.replace(/,/g, '').trim()
    if (!cleaned) return null
    const parsed = parseFloat(cleaned)
    return isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * Generate a descriptive label for a multiplier based on its condition
 * e.g., fieldId: "dent_size", equals: "large" → "Large dent size"
 */
function generateMultiplierLabel(
  mult: PricingRules['multipliers'][0],
  _answers: FormAnswer[]
): string {
  const { fieldId, equals, value } = mult.when
  const matchedValue = equals ?? value

  // Format the field ID into a readable label
  // e.g., "dent_size" → "Dent size", "paint_damage" → "Paint damage"
  const fieldLabel = fieldId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  // Format the value
  const valueLabel = typeof matchedValue === 'string'
    ? matchedValue.charAt(0).toUpperCase() + matchedValue.slice(1).replace(/_/g, ' ')
    : String(matchedValue)

  // Determine if this is an increase or decrease
  const isIncrease = mult.multiplier > 1

  // Generate descriptive label
  if (isIncrease) {
    return `${valueLabel} ${fieldLabel.toLowerCase()}`
  } else {
    return `${valueLabel} ${fieldLabel.toLowerCase()} discount`
  }
}

/**
 * Get multiplier for complexity level
 */
function getComplexityMultiplier(level: string): number {
  switch (level) {
    case 'low':
      return 0.9
    case 'medium':
      return 1.0
    case 'high':
      return 1.25
    default:
      return 1.0
  }
}

// Note: getAccessMultiplier() was removed - automatic global access multiplier is no longer applied.
// If a business wants access-based pricing, they can configure it as a work step with trigger conditions.

/**
 * Format currency for display
 */
function formatCurrency(amount: number, currency: string): string {
  const symbol = getCurrencySymbol(currency)
  return `${symbol}${amount.toFixed(2)}`
}

/**
 * Get currency symbol
 */
function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '£',
    USD: '$',
    EUR: '€',
    AUD: 'A$',
    CAD: 'C$',
  }
  return symbols[currency] || currency + ' '
}

/**
 * Get default unit label for measurement model
 */
function getDefaultUnitLabel(unit: string | null): string {
  const labels: Record<string, string> = {
    sqft: 'sqft',
    sqm: 'sqm',
    room: 'rooms',
    item: 'items',
    hour: 'hours',
    linear_ft: 'linear ft',
    linear_m: 'linear m',
  }
  return unit ? (labels[unit] || unit) : 'units'
}

/**
 * Evaluate site visit rules to determine if a site visit should be recommended
 */
function evaluateSiteVisitRules(
  rules: SiteVisitRules | undefined,
  signals: ExtractedSignals,
  totalEstimate: number
): boolean {
  if (!rules) return false

  // Always recommend if configured
  if (rules.alwaysRecommend) {
    return true
  }

  // Recommend if confidence is below threshold
  if (
    rules.recommendWhenConfidenceBelow !== null &&
    rules.recommendWhenConfidenceBelow !== undefined &&
    signals.confidence < rules.recommendWhenConfidenceBelow
  ) {
    return true
  }

  // Recommend if estimate exceeds threshold
  if (
    rules.recommendWhenEstimateAbove !== null &&
    rules.recommendWhenEstimateAbove !== undefined &&
    totalEstimate > rules.recommendWhenEstimateAbove
  ) {
    return true
  }

  return false
}

/**
 * Get default pricing rules
 */
export function getDefaultPricingRules(): PricingRules {
  return {
    baseFee: 0,
    minimumCharge: 0,
    addons: [],
    multipliers: [],
  }
}

// ============================================================================
// WORK-STEP PRICING WITH TRACE
// ============================================================================

/**
 * Extended pricing result with trace
 */
export interface PricingResultWithTrace {
  result: PricingResult
  trace: PricingTrace
}

/**
 * Get signal value from structured signals or legacy signals
 */
function getSignalValue(
  signalKey: string,
  structuredSignals: ExtractedSignal[] | undefined,
  legacySignals: ExtractedSignals
): { value: string | number | boolean | undefined; confidence: number } {
  // First check structured signals
  if (structuredSignals) {
    const signal = structuredSignals.find(s => s.key === signalKey)
    if (signal) {
      return { value: signal.value, confidence: signal.confidence }
    }
  }

  // Fall back to legacy signals mapping
  switch (signalKey) {
    case 'item_count':
    case 'surface_area':
    case 'linear_distance':
      if (legacySignals.dimensions) {
        return {
          value: legacySignals.dimensions.value,
          confidence: legacySignals.dimensions.isEstimate ? 0.6 : 0.8
        }
      }
      break
    case 'condition_rating':
      if (legacySignals.condition) {
        return {
          value: legacySignals.condition.rating,
          confidence: legacySignals.condition.rating === 'unknown' ? 0.3 : 0.75
        }
      }
      break
    case 'complexity_level':
      if (legacySignals.complexity) {
        return {
          value: legacySignals.complexity.level,
          confidence: legacySignals.complexity.level === 'unknown' ? 0.3 : 0.7
        }
      }
      break
    case 'access_difficulty':
      if (legacySignals.access) {
        return {
          value: legacySignals.access.difficulty,
          confidence: legacySignals.access.difficulty === 'unknown' ? 0.3 : 0.7
        }
      }
      break
  }

  // Check for boolean condition signals (has_oil_stains, has_rust_stains, etc.)
  if (signalKey.startsWith('has_')) {
    const condition = signalKey.replace('has_', '')
    if (legacySignals.detectedConditions?.includes(condition as never)) {
      return { value: true, confidence: 0.8 }
    }
    return { value: false, confidence: 0.8 }
  }

  return { value: undefined, confidence: 0 }
}

/**
 * Evaluate if a work step should be triggered based on signals
 */
function shouldTriggerWorkStep(
  step: WorkStepConfig,
  structuredSignals: ExtractedSignal[] | undefined,
  legacySignals: ExtractedSignals,
  formAnswers?: FormAnswer[]
): { trigger: boolean; signalValue?: string | number | boolean } {
  // Non-optional steps always trigger
  if (!step.optional) {
    return { trigger: true }
  }

  // If explicit trigger signal is configured, use that
  if (step.triggerSignal) {
    const { value } = getSignalValue(step.triggerSignal, structuredSignals, legacySignals)

    if (value === undefined) {
      return { trigger: false }
    }

    // If no condition specified, trigger if signal exists and is truthy
    if (!step.triggerCondition) {
      return {
        trigger: Boolean(value),
        signalValue: value
      }
    }

    const { operator, value: conditionValue } = step.triggerCondition
    const conditionResult = evaluateTriggerCondition(operator, value, conditionValue)
    return { trigger: conditionResult, signalValue: value }
  }

  // SMART DEFAULT: If no triggerSignal but has quantitySource, trigger when quantity > 0
  // This handles the common case where business configures "Tile Installation uses bathroom_size"
  // but forgets to set a trigger - we infer they want it when bathroom_size is provided
  if (step.quantitySource) {
    const quantity = getQuantityFromSource(step.quantitySource, structuredSignals, legacySignals, formAnswers)
    if (quantity > 0) {
      console.log(`[Pricing] Work step "${step.name}": no triggerSignal but quantitySource has value ${quantity} - triggering`)
      return { trigger: true, signalValue: quantity }
    }
  }

  // No trigger signal and no valid quantity source - don't trigger
  console.log(`[Pricing] Work step "${step.name}": optional with no trigger configuration - skipping`)
  return { trigger: false }
}

/**
 * Evaluate a trigger condition
 */
function evaluateTriggerCondition(
  operator: string | undefined,
  value: string | number | boolean,
  conditionValue: string | number | boolean | undefined
): boolean {
  switch (operator) {
    case 'exists':
      return value !== undefined && value !== null
    case 'not_exists':
      return value === undefined || value === null
    case 'equals':
      return value === conditionValue
    case 'not_equals':
      return value !== conditionValue
    case 'gt':
      return typeof value === 'number' && typeof conditionValue === 'number' && value > conditionValue
    case 'gte':
      return typeof value === 'number' && typeof conditionValue === 'number' && value >= conditionValue
    case 'lt':
      return typeof value === 'number' && typeof conditionValue === 'number' && value < conditionValue
    case 'lte':
      return typeof value === 'number' && typeof conditionValue === 'number' && value <= conditionValue
    case 'contains':
      return typeof value === 'string' && typeof conditionValue === 'string' && value.toLowerCase().includes(conditionValue.toLowerCase())
    default:
      return Boolean(value)
  }
}

/**
 * Get quantity from a configured source
 */
function getQuantityFromSource(
  source: WorkStepConfig['quantitySource'],
  structuredSignals: ExtractedSignal[] | undefined,
  legacySignals: ExtractedSignals,
  formAnswers?: FormAnswer[]
): number {
  if (!source) return 0

  switch (source.type) {
    case 'constant':
      return source.value || 1

    case 'form_field': {
      // Try form answers first (most trusted)
      if (formAnswers && source.fieldId) {
        const answer = formAnswers.find(a => a.fieldId === source.fieldId)
        if (answer && typeof answer.value === 'number') {
          return answer.value
        }
      }
      // Fall back to signals
      const { value } = getSignalValue(source.fieldId || '', structuredSignals, legacySignals)
      return typeof value === 'number' ? value : 0
    }

    case 'ai_signal': {
      const { value } = getSignalValue(source.signalKey || '', structuredSignals, legacySignals)
      return typeof value === 'number' ? value : 0
    }

    default:
      return 0
  }
}


/**
 * Result of work step cost calculation with explicit source tracking
 */
interface WorkStepCostResult {
  cost: number
  calculation: string
  signalsUsed: Array<{ key: string; value: string | number | boolean }>
  quantitySource: 'form_field' | 'constant' | 'ai_signal' | 'legacy_fallback'
  quantityTrusted: boolean
}

/**
 * Calculate work step cost based on cost type and explicit quantity sources
 *
 * IMPORTANT: This function now uses explicit quantitySource (AD-005).
 * Form data (100% confidence) is always preferred over AI guesses (60% confidence).
 */
function calculateWorkStepCost(
  step: WorkStepConfig,
  structuredSignals: ExtractedSignal[] | undefined,
  legacySignals: ExtractedSignals,
  formAnswers: FormAnswer[]
): WorkStepCostResult {
  const signalsUsed: Array<{ key: string; value: string | number | boolean }> = []
  const unitLabel = step.unitLabel || 'units'

  switch (step.costType) {
    case 'fixed':
      return {
        cost: step.defaultCost,
        calculation: `Fixed: ${step.defaultCost}`,
        signalsUsed,
        quantitySource: 'constant',
        quantityTrusted: true,
      }

    case 'per_unit': {
      let quantity = 1
      let quantitySource: WorkStepCostResult['quantitySource'] = 'legacy_fallback'
      let quantityTrusted = false

      // 1. EXPLICIT SOURCE (new, preferred - AD-005)
      if (step.quantitySource) {
        switch (step.quantitySource.type) {
          case 'form_field': {
            // Get value from customer's form answer
            const formAnswer = formAnswers.find(a => a.fieldId === step.quantitySource!.fieldId)
            if (formAnswer?.value != null && typeof formAnswer.value === 'number') {
              quantity = formAnswer.value
              quantitySource = 'form_field'
              quantityTrusted = true  // Form = 100% trusted
              signalsUsed.push({ key: step.quantitySource.fieldId || 'form_field', value: quantity })
            } else if (formAnswer?.value != null && typeof formAnswer.value === 'string') {
              // ISSUE-2 FIX: Use coerceToNumber to handle comma-separated numbers (e.g., "2,400" → 2400)
              const parsed = coerceToNumber(formAnswer.value)
              if (parsed !== null && parsed > 0) {
                quantity = parsed
                quantitySource = 'form_field'
                quantityTrusted = true
                signalsUsed.push({ key: step.quantitySource.fieldId || 'form_field', value: quantity })
              } else {
                console.warn(`[Pricing] "${step.name}": Form field "${step.quantitySource.fieldId}" has non-numeric value: ${formAnswer.value}`)
              }
            } else {
              console.warn(`[Pricing] "${step.name}": Form field "${step.quantitySource.fieldId}" not answered, using default quantity 1`)
            }
            break
          }

          case 'constant': {
            // Use the configured fixed quantity
            quantity = step.quantitySource.value || 1
            quantitySource = 'constant'
            quantityTrusted = true  // Explicit = trusted
            signalsUsed.push({ key: 'constant', value: quantity })
            break
          }

          case 'ai_signal': {
            // Use AI-extracted signal value (lower trust)
            const signal = getSignalValue(step.quantitySource.signalKey || '', structuredSignals, legacySignals)
            if (typeof signal.value === 'number' && signal.value > 0) {
              quantity = signal.value
              quantitySource = 'ai_signal'
              quantityTrusted = false  // AI = lower trust, mark in trace
              signalsUsed.push({ key: step.quantitySource.signalKey || 'ai_signal', value: quantity })
            } else {
              console.warn(`[Pricing] "${step.name}": AI signal "${step.quantitySource.signalKey}" not found or invalid, using default quantity 1`)
            }
            break
          }
        }
      }
      // 2. LEGACY FALLBACK (deprecated, for backward compatibility only)
      else {
        console.warn(`[Pricing] "${step.name}": No quantitySource configured, using legacy fallback (DEPRECATED - please configure explicit quantitySource)`)

        // Try triggerSignal first (if set)
        if (step.triggerSignal) {
          const triggerValue = getSignalValue(step.triggerSignal, structuredSignals, legacySignals)
          if (typeof triggerValue.value === 'number' && triggerValue.value > 0) {
            quantity = triggerValue.value
            signalsUsed.push({ key: step.triggerSignal, value: quantity })
          }
        }

        // If still default, try to find any numeric signal that looks like a quantity
        if (quantity === 1 && structuredSignals) {
          const quantitySignals = ['sqft', 'area', 'count', 'quantity', 'size', 'footage']
          for (const signal of structuredSignals) {
            if (typeof signal.value === 'number' && signal.value > 0) {
              const keyLower = signal.key.toLowerCase()
              if (quantitySignals.some(q => keyLower.includes(q))) {
                quantity = signal.value
                signalsUsed.push({ key: signal.key, value: quantity })
                break
              }
            }
          }
        }

        // Final fallback to item_count
        if (quantity === 1) {
          const itemCountSignal = getSignalValue('item_count', structuredSignals, legacySignals)
          if (typeof itemCountSignal.value === 'number' && itemCountSignal.value > 0) {
            quantity = itemCountSignal.value
            signalsUsed.push({ key: 'item_count', value: quantity })
          }
        }

        quantitySource = 'legacy_fallback'
        quantityTrusted = false
      }

      const cost = quantity * step.defaultCost
      return {
        cost,
        calculation: `${quantity} ${unitLabel} × ${step.defaultCost}/${unitLabel.replace(/s$/, '')} = ${cost}`,
        signalsUsed,
        quantitySource,
        quantityTrusted,
      }
    }

    case 'per_hour': {
      let hours = 1
      let quantitySource: WorkStepCostResult['quantitySource'] = 'legacy_fallback'
      let quantityTrusted = false

      // 1. EXPLICIT SOURCE (AD-005)
      if (step.quantitySource) {
        switch (step.quantitySource.type) {
          case 'form_field': {
            const formAnswer = formAnswers.find(a => a.fieldId === step.quantitySource!.fieldId)
            if (formAnswer?.value != null && typeof formAnswer.value === 'number') {
              hours = formAnswer.value
              quantitySource = 'form_field'
              quantityTrusted = true
              signalsUsed.push({ key: step.quantitySource.fieldId || 'form_field', value: hours })
            }
            break
          }

          case 'constant': {
            hours = step.quantitySource.value || 1
            quantitySource = 'constant'
            quantityTrusted = true
            signalsUsed.push({ key: 'constant', value: hours })
            break
          }

          case 'ai_signal': {
            const signal = getSignalValue(step.quantitySource.signalKey || '', structuredSignals, legacySignals)
            if (typeof signal.value === 'number' && signal.value > 0) {
              hours = signal.value
              quantitySource = 'ai_signal'
              quantityTrusted = false
              signalsUsed.push({ key: step.quantitySource.signalKey || 'ai_signal', value: hours })
            }
            break
          }
        }
      }
      // 2. LEGACY FALLBACK - estimate hours based on complexity
      else {
        console.warn(`[Pricing] "${step.name}": No quantitySource for per_hour, using complexity-based estimation (DEPRECATED)`)
        const complexitySignal = getSignalValue('complexity_level', structuredSignals, legacySignals)

        if (complexitySignal.value === 'low') hours = 0.5
        else if (complexitySignal.value === 'medium') hours = 1
        else if (complexitySignal.value === 'high') hours = 2

        if (complexitySignal.value !== undefined) {
          signalsUsed.push({ key: 'complexity_level', value: complexitySignal.value })
        }

        quantitySource = 'legacy_fallback'
        quantityTrusted = false
      }

      const cost = hours * step.defaultCost
      return {
        cost,
        calculation: `${hours} hours × ${step.defaultCost}/hour = ${cost}`,
        signalsUsed,
        quantitySource,
        quantityTrusted,
      }
    }

    default:
      return {
        cost: step.defaultCost,
        calculation: `Default: ${step.defaultCost}`,
        signalsUsed,
        quantitySource: 'constant',
        quantityTrusted: true,
      }
  }
}

/**
 * Calculate pricing with full trace for transparency
 *
 * This is the new pricing function that supports work-step model
 * and returns a complete trace of the calculation.
 */
export function calculatePricingWithTrace(
  rules: PricingRules,
  signals: ExtractedSignals,
  structuredSignals: ExtractedSignalsV2 | null,
  answers: FormAnswer[],
  taxConfig: TaxConfig,
  currency: string,
  jobData?: JobData,
  addonContext?: AddonDetectionContext,
  aiDetectedAddonIds?: Set<string>,
  serviceContext?: ServiceContext,
  configVersion?: string
): PricingResultWithTrace {
  const traceSteps: PricingTraceStep[] = []
  const notes: string[] = []
  let runningTotal = 0

  // Summary accumulators
  let workStepsTotal = 0
  let addonsTotal = 0
  let inventoryTotal = 0
  let measurementTotal = 0
  let multiplierAdjustment = 0
  let minimumApplied = false

  // 1. Base fee
  if (rules.baseFee > 0) {
    runningTotal += rules.baseFee
    traceSteps.push({
      type: 'base_fee',
      description: 'Base service fee',
      signalsUsed: [],
      calculation: `Base fee: ${rules.baseFee}`,
      amount: rules.baseFee,
      runningTotal,
    })
  }

  // 2. Work steps (new model with explicit quantity sources - AD-005)
  if (rules.workSteps && rules.workSteps.length > 0) {
    const signalsArray = structuredSignals?.signals

    for (const step of rules.workSteps) {
      const { trigger, signalValue } = shouldTriggerWorkStep(step, signalsArray, signals, answers)

      console.log(`[Pricing] Work step "${step.name}": optional=${step.optional}, triggerSignal=${step.triggerSignal}, trigger=${trigger}, signalValue=${signalValue}`)

      if (!trigger) {
        console.log(`[Pricing] Skipping work step "${step.name}" - trigger not satisfied`)
        continue
      }

      const stepResult = calculateWorkStepCost(step, signalsArray, signals, answers)

      // ISSUE-3 FIX: Skip zero-cost line items (e.g., "0 sockets × £25 = £0")
      // This prevents unprofessional-looking quotes with $0 line items
      if (stepResult.cost === 0) {
        console.log(`[Pricing] Skipping work step "${step.name}" - zero cost`)
        continue
      }

      // Add trigger signal to signalsUsed if different
      if (step.triggerSignal && signalValue !== undefined && !stepResult.signalsUsed.find(s => s.key === step.triggerSignal)) {
        stepResult.signalsUsed.unshift({ key: step.triggerSignal, value: signalValue })
      }

      runningTotal += stepResult.cost
      workStepsTotal += stepResult.cost

      traceSteps.push({
        type: 'work_step',
        id: step.id,
        description: step.name,
        signalsUsed: stepResult.signalsUsed,
        calculation: stepResult.calculation,
        amount: stepResult.cost,
        runningTotal,
        quantitySource: stepResult.quantitySource,
        quantityTrusted: stepResult.quantityTrusted,
      })

      // Add note if using legacy fallback (no explicit quantitySource)
      if (stepResult.quantitySource === 'legacy_fallback') {
        notes.push(`"${step.name}" uses legacy quantity estimation - consider configuring explicit quantity source`)
      } else if (stepResult.quantitySource === 'ai_signal' && !stepResult.quantityTrusted) {
        notes.push(`"${step.name}" quantity from AI signal (lower confidence)`)
      }
    }
  }

  // 3. Inventory items (for rental/event businesses)
  if (jobData?.matchedItems && jobData.matchedItems.length > 0) {
    for (const item of jobData.matchedItems) {
      const lineAmount = item.quantity * item.pricePerUnit
      runningTotal += lineAmount
      inventoryTotal += lineAmount

      traceSteps.push({
        type: 'inventory',
        id: item.catalogId,
        description: `${item.quantity} × ${item.catalogName}`,
        signalsUsed: [
          { key: 'detected_item', value: item.itemType },
          { key: 'quantity', value: item.quantity }
        ],
        calculation: `${item.quantity} × ${item.pricePerUnit} = ${lineAmount}`,
        amount: lineAmount,
        runningTotal,
      })
    }

    if (jobData.matchedItems.some((item) => item.confidence < 0.8)) {
      notes.push('Some item quantities are estimated from photos')
    }
  }

  // 4. Measurement model (per-unit pricing)
  const measurementModel = rules.measurementModel
  if (measurementModel?.type === 'per_unit' && measurementModel.pricePerUnit > 0) {
    let quantity: number | undefined
    let quantitySource: string | undefined

    if (signals.customerStatedQuantity && signals.customerStatedQuantity > 0) {
      quantity = signals.customerStatedQuantity
      quantitySource = 'customer_notes'
    } else if (jobData?.quantity && jobData.quantity > 0) {
      quantity = jobData.quantity
      quantitySource = 'form'
    } else if (signals.dimensions?.value) {
      quantity = signals.dimensions.value
      quantitySource = 'ai'
    }

    if (signals.customerStatedQuantity && signals.dimensions?.value) {
      if (signals.customerStatedQuantity !== signals.dimensions.value) {
        notes.push(`Customer mentioned ${signals.customerStatedQuantity} items, photos show ${signals.dimensions.value} - using customer's count`)
      }
    }

    if (quantity) {
      const unitAmount = quantity * measurementModel.pricePerUnit
      runningTotal += unitAmount
      measurementTotal += unitAmount

      const unitLabel = measurementModel.unitLabel || getDefaultUnitLabel(measurementModel.unit)

      traceSteps.push({
        type: 'measurement',
        description: `${unitLabel} pricing`,
        signalsUsed: [
          { key: 'quantity', value: quantity },
          { key: 'source', value: quantitySource || 'unknown' }
        ],
        calculation: `${quantity} ${unitLabel} × ${measurementModel.pricePerUnit} = ${unitAmount}`,
        amount: unitAmount,
        runningTotal,
      })

      if (quantitySource === 'ai' && signals.dimensions?.isEstimate) {
        notes.push('Quantity is estimated from photos')
      }
    } else {
      notes.push('Per-unit pricing requires quantity - using base fee only')
    }
  }

  // 5. Addons
  const recommendedAddons: RecommendedAddon[] = []
  const searchableText = buildSearchableText(addonContext)

  for (const addon of rules.addons) {
    const addonMatch = shouldApplyAddon(addon, signals, answers, searchableText, aiDetectedAddonIds, serviceContext)
    if (addonMatch.apply) {
      runningTotal += addon.price
      addonsTotal += addon.price

      traceSteps.push({
        type: 'addon',
        id: addon.id,
        description: addon.label,
        signalsUsed: addonMatch.source === 'keyword'
          ? [{ key: 'matched_keyword', value: addonMatch.reason || '' }]
          : addonMatch.source === 'image_signal'
            ? [{ key: 'detected_condition', value: addonMatch.reason || '' }]
            : [],
        calculation: `Addon: ${addon.price}`,
        amount: addon.price,
        runningTotal,
      })

      if (addonMatch.autoRecommended) {
        recommendedAddons.push({
          id: addon.id,
          label: addon.label,
          price: addon.price,
          reason: addonMatch.reason || 'Recommended based on project details',
          source: addonMatch.source || 'keyword',
        })
      }
    }
  }

  // 6. Multipliers
  const subtotalBeforeMultipliers = runningTotal

  for (const mult of rules.multipliers) {
    if (shouldApplyMultiplier(mult, answers)) {
      const adjustmentAmount = runningTotal * (mult.multiplier - 1)
      if (adjustmentAmount !== 0) {
        const label = mult.label || generateMultiplierLabel(mult, answers)
        runningTotal = runningTotal * mult.multiplier
        multiplierAdjustment += adjustmentAmount

        traceSteps.push({
          type: 'multiplier',
          id: mult.when.fieldId,
          description: label,
          signalsUsed: [{ key: mult.when.fieldId, value: mult.when.equals ?? mult.when.value ?? '' }],
          calculation: `${subtotalBeforeMultipliers} × ${mult.multiplier} = ${runningTotal}`,
          amount: Math.round(adjustmentAmount * 100) / 100,
          runningTotal: Math.round(runningTotal * 100) / 100,
        })
      }
    }
  }

  // Complexity multiplier
  const complexityMultiplier = getComplexityMultiplier(signals.complexity.level)
  if (complexityMultiplier !== 1.0) {
    const adjustmentAmount = runningTotal * (complexityMultiplier - 1)
    const prevTotal = runningTotal
    runningTotal = runningTotal * complexityMultiplier
    multiplierAdjustment += adjustmentAmount

    traceSteps.push({
      type: 'multiplier',
      id: 'complexity',
      description: signals.complexity.level === 'low' ? 'Simple job discount' : `${signals.complexity.level} complexity`,
      signalsUsed: [{ key: 'complexity_level', value: signals.complexity.level }],
      calculation: `${prevTotal} × ${complexityMultiplier} = ${runningTotal}`,
      amount: Math.round(adjustmentAmount * 100) / 100,
      runningTotal: Math.round(runningTotal * 100) / 100,
    })
  }

  // Note: Automatic access difficulty multiplier was removed.
  // Businesses can configure access-based pricing as work steps with trigger conditions if needed.

  // 7. Minimum charge
  let subtotal = Math.round(runningTotal * 100) / 100
  if (rules.minimumCharge > 0 && subtotal < rules.minimumCharge) {
    notes.push(`Minimum charge of ${formatCurrency(rules.minimumCharge, currency)} applied`)
    minimumApplied = true

    traceSteps.push({
      type: 'minimum',
      description: 'Minimum charge applied',
      signalsUsed: [],
      calculation: `Subtotal ${subtotal} < minimum ${rules.minimumCharge}`,
      amount: rules.minimumCharge - subtotal,
      runningTotal: rules.minimumCharge,
    })

    subtotal = rules.minimumCharge
    runningTotal = rules.minimumCharge
  }

  // 8. Tax
  // ISSUE-8 FIX: Use proper rounding to avoid penny discrepancies
  let taxAmount = 0
  if (taxConfig.enabled && taxConfig.rate) {
    const rawTax = subtotal * (taxConfig.rate / 100)
    taxAmount = Math.round(rawTax * 100) / 100

    traceSteps.push({
      type: 'tax',
      description: taxConfig.label || 'Tax',
      signalsUsed: [],
      calculation: `${subtotal} × ${taxConfig.rate}% = ${taxAmount}`,
      amount: taxAmount,
      runningTotal: Math.round((subtotal + taxAmount) * 100) / 100,
    })
  }

  // 9. Final total
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  // 10. Confidence and range
  // FIX-1: Use structuredSignals.overallConfidence when available
  // This reflects accurate confidence after form signals are merged (1.0 for form data)
  // Legacy signals.confidence defaults to 0.5 when no images, which incorrectly triggers range mode
  const confidence = structuredSignals?.overallConfidence ?? signals.confidence
  let range: PricingResult['range'] | undefined

  if (confidence < 0.7) {
    const variancePercent = confidence < 0.4 ? 0.3 : 0.15
    range = {
      low: Math.round(total * (1 - variancePercent) * 100) / 100,
      high: Math.round(total * (1 + variancePercent) * 100) / 100,
    }
    notes.push('Price shown as range due to limited information')
  }

  // 11. Site visit recommendation
  const shouldRecommendSiteVisit = evaluateSiteVisitRules(rules.siteVisitRules, signals, total)
  if (shouldRecommendSiteVisit || signals.siteVisitRecommended) {
    notes.push(signals.siteVisitReason || 'Site visit recommended for accurate quote')
  }

  // Add warnings from signals
  for (const warning of signals.warnings) {
    notes.push(warning)
  }

  // Build breakdown from trace steps (for backwards compatibility)
  const breakdown: PricingResult['breakdown'] = traceSteps
    .filter(step => step.type !== 'tax')
    .map(step => {
      const addon = recommendedAddons.find(a => a.id === step.id)
      return {
        label: step.description,
        amount: step.amount,
        autoRecommended: addon ? true : undefined,
        recommendationReason: addon?.reason,
      }
    })

  // Build the result
  const result: PricingResult = {
    currency,
    subtotal,
    taxLabel: taxConfig.enabled ? taxConfig.label : undefined,
    taxRate: taxConfig.enabled ? taxConfig.rate : undefined,
    taxAmount,
    total,
    breakdown,
    confidence,
    range,
    notes,
    recommendedAddons: recommendedAddons.length > 0 ? recommendedAddons : undefined,
  }

  // ISSUE-2 FIX: Detect form fields that were provided but not used in pricing
  // This helps identify service configuration issues (e.g., bathroom_size provided but no per-sqft work steps)
  if (rules.workSteps && rules.workSteps.length > 0) {
    const usedFormFields = new Set(
      rules.workSteps
        .filter(s => s.quantitySource?.type === 'form_field' && s.quantitySource.fieldId)
        .map(s => s.quantitySource!.fieldId!)
    )

    // Also track fields used in multipliers
    for (const mult of rules.multipliers) {
      usedFormFields.add(mult.when.fieldId)
    }

    // Find numeric form fields that were provided but not used
    const unusedNumericFields = answers.filter(a => {
      // Only check numeric fields
      const value = typeof a.value === 'number' ? a.value :
        (typeof a.value === 'string' ? coerceToNumber(a.value) : null)

      if (value === null || value <= 0) return false

      // Skip internal fields
      if (a.fieldId.startsWith('_')) return false

      // Check if field is used
      return !usedFormFields.has(a.fieldId)
    })

    if (unusedNumericFields.length > 0) {
      const unusedFieldList = unusedNumericFields.map(f => `${f.fieldId}=${f.value}`).join(', ')
      console.warn(`[Pricing] Numeric form fields provided but unused in pricing: ${unusedFieldList}`)
      // Note: We log but don't add to customer-facing notes as this is a configuration issue for business owners
    }
  }

  // Build the trace
  const trace: PricingTrace = {
    calculatedAt: new Date().toISOString(),
    configVersion: configVersion || 'v1',
    trace: traceSteps,
    summary: {
      baseFee: rules.baseFee,
      workStepsTotal: Math.round(workStepsTotal * 100) / 100,
      addonsTotal: Math.round(addonsTotal * 100) / 100,
      inventoryTotal: inventoryTotal > 0 ? Math.round(inventoryTotal * 100) / 100 : undefined,
      measurementTotal: measurementTotal > 0 ? Math.round(measurementTotal * 100) / 100 : undefined,
      multiplierAdjustment: Math.round(multiplierAdjustment * 100) / 100,
      minimumApplied,
      taxAmount,
      total,
    },
  }

  return { result, trace }
}

/**
 * Cross-service pricing result (internal)
 */
export interface CrossServicePricingResult {
  baseFee: number
  estimatedTotal: number
  breakdown: string[]
  isEstimate: boolean
  note: string
}

/**
 * Calculate pricing for a cross-service using AI-extracted signals
 */
export function calculateCrossServicePricing(
  rules: PricingRules,
  crossServiceEstimate: CrossServiceEstimate,
  taxConfig: TaxConfig,
  currency: string
): CrossServicePricingResult {
  let subtotal = rules.baseFee
  const breakdown: string[] = []

  // Add base fee to breakdown
  if (rules.baseFee > 0) {
    breakdown.push(`Base fee: ${formatCurrency(rules.baseFee, currency)}`)
  }

  // Apply per-unit pricing if we have quantity estimate and measurement model is configured
  const measurementModel = rules.measurementModel
  if (
    crossServiceEstimate.estimatedQuantity &&
    crossServiceEstimate.estimatedQuantity > 0 &&
    measurementModel?.type === 'per_unit' &&
    measurementModel.pricePerUnit > 0
  ) {
    const unitAmount = crossServiceEstimate.estimatedQuantity * measurementModel.pricePerUnit
    subtotal += unitAmount

    const unitLabel = measurementModel.unitLabel || getDefaultUnitLabel(measurementModel.unit)
    breakdown.push(
      `${crossServiceEstimate.estimatedQuantity} ${unitLabel} × ${formatCurrency(measurementModel.pricePerUnit, currency)}`
    )
  }

  // Apply minimum charge if subtotal is below it
  if (rules.minimumCharge > 0 && subtotal < rules.minimumCharge) {
    subtotal = rules.minimumCharge
    breakdown.length = 0
    breakdown.push(`Minimum charge: ${formatCurrency(rules.minimumCharge, currency)}`)
  }

  // Round subtotal
  subtotal = Math.round(subtotal * 100) / 100

  // Calculate tax (ISSUE-8 FIX: proper rounding)
  let taxAmount = 0
  if (taxConfig.enabled && taxConfig.rate) {
    const rawTax = subtotal * (taxConfig.rate / 100)
    taxAmount = Math.round(rawTax * 100) / 100
    if (taxAmount > 0) {
      breakdown.push(`${taxConfig.label || 'Tax'} (${taxConfig.rate}%): ${formatCurrency(taxAmount, currency)}`)
    }
  }

  // Calculate total
  const total = Math.round((subtotal + taxAmount) * 100) / 100

  // Determine if this is an estimate (low confidence)
  const isEstimate = crossServiceEstimate.confidence < 0.8

  // Build contextual note
  const note = isEstimate
    ? 'Estimate based on your description. Final price confirmed after assessment.'
    : 'Based on details provided.'

  return {
    baseFee: rules.baseFee,
    estimatedTotal: total,
    breakdown,
    isEstimate,
    note,
  }
}
