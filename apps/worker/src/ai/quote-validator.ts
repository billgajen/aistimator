/**
 * Quote Validator
 *
 * Comprehensive validation system for generated quotes.
 * Catches issues before quotes reach customers, provides auto-correction,
 * and logs for continuous improvement.
 *
 * Validation Categories:
 * 1. Pricing Completeness - Form fields used, work steps triggered, expected total
 * 2. Scope Validation - Promises match paid work, matches customer intent
 * 3. Potential Work - No contradictions, no AI prices, relevance
 * 4. Cross-Service - Service/request match, context match, negation
 * 5. Addons - Negation respected, no conflicts with excludes
 * 6. Notes - Relevance, error codes included
 * 7. Discounts - No unauthorized changes
 * 8. Logic - Form/description consistency
 */

import type { GeminiClient } from './gemini'
import type {
  ValidationResult,
  ValidationIssue,
  WorkStepConfig,
  AddonConfig,
  MultiplierConfig,
  SignalRecommendation,
  CrossServicePricing,
  ExtractedSignal,
} from '@estimator/shared'
import type { PricingResult } from '../pricing/rules-engine'
import type { QuoteContent } from './wording'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Customer request context for validation
 */
export interface CustomerRequestContext {
  formAnswers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
  customerDescription?: string
  photoCount: number
}

/**
 * Service configuration for validation
 */
export interface ServiceConfigForValidation {
  serviceName: string
  serviceDescription?: string
  scopeIncludes?: string[]
  scopeExcludes?: string[]
  defaultAssumptions?: string[]
  workSteps?: WorkStepConfig[]
  addons?: AddonConfig[]
  multipliers?: MultiplierConfig[]
}

/**
 * Generated quote data for validation
 */
export interface GeneratedQuoteForValidation {
  pricing: PricingResult
  content: QuoteContent
  signalRecommendations?: SignalRecommendation[]
  crossServicePricing?: CrossServicePricing[]
  structuredSignals?: { signals: ExtractedSignal[] }
}

/**
 * Widget field for signal mapping
 */
interface WidgetField {
  fieldId: string
  type: string
  label: string
  mapsToSignal?: string
}

// ============================================================================
// VALIDATION PROMPT
// ============================================================================

/**
 * Build the comprehensive validation prompt
 */
function buildValidationPrompt(
  customerRequest: CustomerRequestContext,
  serviceConfig: ServiceConfigForValidation,
  quote: GeneratedQuoteForValidation,
  _widgetFields?: WidgetField[]
): string {
  const formAnswersText = customerRequest.formAnswers
    .map(a => `  - ${a.fieldId}: ${JSON.stringify(a.value)}`)
    .join('\n')

  const workStepsText = (serviceConfig.workSteps || [])
    .map(ws => `  - [ID: ${ws.id}] ${ws.name}: £${ws.defaultCost}/${ws.costType === 'fixed' ? 'fixed' : ws.unitLabel || 'unit'} (${ws.optional ? `optional, trigger: ${ws.triggerSignal}` : 'mandatory'})`)
    .join('\n')

  const addonsText = (serviceConfig.addons || [])
    .map(a => `  - ${a.label}: £${a.price} (keywords: ${(a.triggerKeywords || []).join(', ')})`)
    .join('\n')

  const multipliersText = (serviceConfig.multipliers || [])
    .map(m => `  - When ${m.when.fieldId} ${m.when.operator || 'equals'} ${m.when.value || m.when.equals} → ${m.multiplier}x`)
    .join('\n')

  const breakdownText = quote.pricing.breakdown
    .map(b => `  - ${b.label}: £${b.amount}`)
    .join('\n')

  const potentialWorkText = (quote.signalRecommendations || [])
    .map((r, i) => `  ${i + 1}. ${r.workDescription}: ${r.costBreakdown}`)
    .join('\n')

  const crossServicesText = (quote.crossServicePricing || [])
    .map(cs => `  - ${cs.serviceName}: £${cs.estimatedTotal} (reason: ${cs.reason})`)
    .join('\n')

  return `You are a senior quote reviewer. Your job is to catch ALL issues before a quote reaches the customer.

## INPUTS PROVIDED

### CUSTOMER REQUEST
- Form Answers:
${formAnswersText || '  (none)'}
- Description: "${customerRequest.customerDescription || ''}"
- Photos Analyzed: ${customerRequest.photoCount}

### SERVICE CONFIGURATION (Business's Rules)
- Service Name: ${serviceConfig.serviceName}
- Description: ${serviceConfig.serviceDescription || 'N/A'}
- Scope Includes: ${(serviceConfig.scopeIncludes || []).join(', ') || 'N/A'}
- Scope Excludes: ${(serviceConfig.scopeExcludes || []).join(', ') || 'N/A'}
- Default Assumptions: ${(serviceConfig.defaultAssumptions || []).join(', ') || 'N/A'}
- Work Steps Available:
${workStepsText || '  (none configured)'}
- Addons Available:
${addonsText || '  (none configured)'}
- Multipliers:
${multipliersText || '  (none configured)'}

### GENERATED QUOTE
- Pricing Breakdown:
${breakdownText || '  (none)'}
- Total: £${quote.pricing.total}
- Scope Text: "${quote.content.scopeSummary || ''}"
- Assumptions: ${JSON.stringify(quote.content.assumptions || [])}
- Exclusions: ${JSON.stringify(quote.content.exclusions || [])}
- Notes: "${quote.content.notes || ''}"
- Potential Additional Work:
${potentialWorkText || '  (none)'}
- Additional Services Suggested:
${crossServicesText || '  (none)'}

---

## VALIDATION CHECKS

### CHECK 1: PRICING COMPLETENESS
For each form answer, verify corresponding pricing exists:

a) NUMERIC FORM FIELDS USED IN PRICING
   - If form has a numeric field (e.g., bathroom_size=85), is there a line item using that value?
   - If a numeric form field exists but no line item uses it → ISSUE

b) WORK STEPS THAT SHOULD TRIGGER
   - Look at each optional work step's trigger condition
   - Check if form/signals satisfy the trigger
   - If trigger should fire but work step is missing → ISSUE

c) EXPECTED TOTAL CALCULATION
   - Calculate what total SHOULD be based on configured work steps
   - Compare to actual total
   - If actual < expected by >20% → ISSUE (underpriced)

d) MULTIPLIERS APPLIED
   - For each multiplier, check if condition is met
   - If condition met but multiplier not visible in breakdown → ISSUE

### CHECK 2: SCOPE TEXT VALIDATION
a) SCOPE ONLY PROMISES PAID WORK
   - For each work keyword in scope (tiling, cleaning, repair, seal, grout, etc.)
   - Verify matching line item exists in pricing OR item is in scope_includes
   - If scope mentions work not priced → ISSUE

b) SCOPE MATCHES CUSTOMER INTENT
   - If customer said "repair/fix/replace" → scope should NOT say "inspect/assess"
   - If customer wants permanent solution → scope should NOT minimize to "temporary"
   - ISSUE if scope action contradicts customer's stated intent

c) SCOPE WITHIN CONFIGURED BOUNDARIES
   - Every service mentioned in scope must exist in scope_includes
   - If scope mentions service not in scope_includes → ISSUE

### CHECK 3: POTENTIAL ADDITIONAL WORK
a) NO CONTRADICTIONS WITH FORM
   - If form says waste_removal=Yes → should NOT be in "potential work"
   - ISSUE if potential work suggests something the form already addresses

b) NO AI-INVENTED PRICES
   - Potential work should NOT show specific costs (AD-001 compliance)
   - If any item has a specific price like "£180" → ISSUE

c) RELEVANCE CHECK
   - Each suggested item should relate to the service and customer description
   - ISSUE if item is irrelevant

d) LIMIT CHECK
   - Maximum 3 items, each description ≤ 20 words
   - ISSUE if too many or too verbose

### CHECK 4: ADDITIONAL SERVICES (CROSS-SERVICE)
a) SERVICE MATCHES REQUEST
   - If customer mentioned "gutter cleaning" → suggested service should contain "gutter"
   - ISSUE if suggested service doesn't match what customer mentioned

b) CONTEXT MATCH (B2B vs B2C)
   - Business service should not suggest residential service
   - ISSUE if context mismatch

c) NEGATION RESPECTED
   - If customer said "not for this quote", "maybe later", "just mentioning"
   - That service should NOT be recommended
   - ISSUE if negated service is still recommended

d) VALID PRICING
   - Each suggested service must have price > £0
   - ISSUE if price is £0 or missing

### CHECK 5: ADDONS
a) NEGATION RESPECTED
   - "no extras", "keep it simple", "budget only" → NO keyword-triggered addons
   - ISSUE if addon triggered despite negation

b) NOT CONFLICTING WITH EXCLUDES
   - If addon label matches something in scope_excludes → should not recommend
   - ISSUE if addon conflicts with exclusion

c) EXPLICIT REQUEST NOT SYMPTOM
   - "radiators lukewarm" → NOT a request for powerflush
   - "want to add powerflush" → IS a request
   - ISSUE if addon triggered by symptom not explicit request

### CHECK 6: NOTES
a) RELEVANT TO THIS QUOTE
   - Notes about "no images" should only appear if photos expected but none provided
   - ISSUE if note is irrelevant

b) ERROR CODES USED
   - If customer mentioned error code → should appear in notes
   - ISSUE if error code extracted but not mentioned

### CHECK 7: DISCOUNTS/UNAUTHORIZED CHANGES
a) NO UNAUTHORIZED DISCOUNTS
   - Pricing should ONLY apply multipliers configured by business
   - ISSUE if unexpected discount appears

b) NO INVENTED FEES
   - Every line item must trace back to configured work steps/addons/multipliers
   - ISSUE if line item not found in config

### CHECK 8: LOGICAL CONSISTENCY
a) FORM/DESCRIPTION CONFLICTS
   - Flag if form says "urgent" but description says "3-4 weeks"
   - This is a NOTE, not a hard ISSUE

---

## OUTPUT FORMAT

Return a JSON object with this exact structure:

{
  "overallStatus": "PASS" | "FAIL" | "REVIEW_NEEDED",
  "confidenceScore": 0.0-1.0,
  "issues": [
    {
      "id": "unique-id",
      "category": "pricing|scope|potential_work|cross_service|addons|notes|discounts|logic",
      "severity": "critical|high|medium|low",
      "check": "CHECK_1a",
      "description": "Human readable description",
      "found": "What was found in the quote",
      "expected": "What was expected based on config/request",
      "autoFixable": true|false,
      "autoFix": {
        "action": "add_work_step|remove_scope_text|remove_potential_work|remove_cross_service|remove_addon|add_note|flag_only",
        "details": {
          // For add_work_step: { "workStepId": "the-exact-id-from-config", "quantity": number }
          // For remove_scope_text: { "pattern": "text to remove", "replacement": "optional replacement" }
          // For remove_potential_work: { "itemIndex": 0 }
          // For remove_cross_service: { "serviceId": "service-id" }
          // For remove_addon: { "addonId": "addon-label-text" }
          // For add_note: { "text": "note text", "position": "start|end" }
        }
      },
      "suggestedConfigFix": "Optional config suggestion"
    }
  ],
  "summary": {
    "criticalCount": 0,
    "highCount": 0,
    "mediumCount": 0,
    "lowCount": 0,
    "autoFixableCount": 0,
    "configIssueCount": 0
  },
  "calculatedExpectedTotal": 0,
  "actualTotal": ${quote.pricing.total},
  "pricingGapPercent": 0
}

## IMPORTANT RULES

1. BASE ALL CHECKS ON SERVICE CONFIGURATION - not arbitrary market rates
2. FORM DATA IS TRUTH - if form says X, that's what the customer wants
3. WHEN IN DOUBT, FLAG IT - better to review than to send broken quote
4. DISTINGUISH CONFIG ISSUES FROM PROCESSING ISSUES - config issues need business action
5. EVERY ISSUE MUST HAVE EVIDENCE - quote the specific text/value that's wrong
6. Be conservative - only flag real issues, not theoretical problems
7. Return ONLY valid JSON, no markdown formatting or explanation outside the JSON`
}

// ============================================================================
// VALIDATION EXECUTION
// ============================================================================

/**
 * Validate a generated quote using Gemini
 */
export async function validateQuote(
  gemini: GeminiClient,
  quote: GeneratedQuoteForValidation,
  customerRequest: CustomerRequestContext,
  serviceConfig: ServiceConfigForValidation,
  _widgetFields?: WidgetField[]
): Promise<ValidationResult> {
  const prompt = buildValidationPrompt(customerRequest, serviceConfig, quote, _widgetFields)

  try {
    const responseText = await gemini.generateText(prompt)

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      console.error('[Validator] No JSON found in response:', responseText.substring(0, 200))
      return getDefaultValidationResult(quote.pricing.total)
    }

    const result = JSON.parse(jsonMatch[0]) as ValidationResult

    // Validate and normalize the result
    return normalizeValidationResult(result, quote.pricing.total)
  } catch (error) {
    console.error('[Validator] Validation failed:', error)
    return getDefaultValidationResult(quote.pricing.total)
  }
}

/**
 * Get default validation result (pass with no issues)
 */
function getDefaultValidationResult(actualTotal: number): ValidationResult {
  return {
    overallStatus: 'PASS',
    confidenceScore: 0.5,
    issues: [],
    summary: {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      autoFixableCount: 0,
      configIssueCount: 0,
    },
    calculatedExpectedTotal: actualTotal,
    actualTotal,
    pricingGapPercent: 0,
  }
}

/**
 * Normalize and validate the result from Gemini
 */
function normalizeValidationResult(result: ValidationResult, actualTotal: number): ValidationResult {
  // Ensure all required fields exist
  const normalized: ValidationResult = {
    overallStatus: result.overallStatus || 'PASS',
    confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0.5,
    issues: Array.isArray(result.issues) ? result.issues : [],
    summary: result.summary || {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      autoFixableCount: 0,
      configIssueCount: 0,
    },
    calculatedExpectedTotal: result.calculatedExpectedTotal || actualTotal,
    actualTotal,
    pricingGapPercent: result.pricingGapPercent || 0,
  }

  // Recalculate summary from issues
  normalized.summary = {
    criticalCount: normalized.issues.filter(i => i.severity === 'critical').length,
    highCount: normalized.issues.filter(i => i.severity === 'high').length,
    mediumCount: normalized.issues.filter(i => i.severity === 'medium').length,
    lowCount: normalized.issues.filter(i => i.severity === 'low').length,
    autoFixableCount: normalized.issues.filter(i => i.autoFixable).length,
    configIssueCount: normalized.issues.filter(i => i.suggestedConfigFix).length,
  }

  // Determine overall status based on issues
  if (normalized.summary.criticalCount > 0) {
    normalized.overallStatus = 'FAIL'
  } else if (normalized.summary.highCount > 0) {
    normalized.overallStatus = 'REVIEW_NEEDED'
  } else if (normalized.summary.mediumCount > 0) {
    normalized.overallStatus = 'REVIEW_NEEDED'
  } else {
    normalized.overallStatus = 'PASS'
  }

  return normalized
}

// ============================================================================
// AUTO-CORRECTION
// ============================================================================

/**
 * Result of applying auto-corrections
 */
export interface AutoCorrectionResult {
  correctedPricing: PricingResult
  correctedContent: QuoteContent
  correctedRecommendations?: SignalRecommendation[]
  correctedCrossServices?: CrossServicePricing[]
  appliedFixes: string[]
}

/**
 * Apply auto-corrections to the quote based on validation issues
 */
export function applyAutoCorrections(
  quote: GeneratedQuoteForValidation,
  issues: ValidationIssue[],
  serviceConfig: ServiceConfigForValidation
): AutoCorrectionResult {
  const appliedFixes: string[] = []

  // Deep clone the quote data
  const correctedPricing: PricingResult = JSON.parse(JSON.stringify(quote.pricing))
  const correctedContent: QuoteContent = JSON.parse(JSON.stringify(quote.content))
  const correctedRecommendations = quote.signalRecommendations
    ? JSON.parse(JSON.stringify(quote.signalRecommendations)) as SignalRecommendation[]
    : undefined
  let correctedCrossServices = quote.crossServicePricing
    ? JSON.parse(JSON.stringify(quote.crossServicePricing)) as CrossServicePricing[]
    : undefined

  for (const issue of issues) {
    if (!issue.autoFixable || !issue.autoFix) continue

    switch (issue.autoFix.action) {
      case 'add_work_step': {
        const { workStepId, quantity } = issue.autoFix.details
        if (!workStepId) continue

        const workStep = (serviceConfig.workSteps || []).find(ws => ws.id === workStepId)
        if (!workStep) {
          console.log(`[Validator] Cannot auto-fix: work step ${workStepId} not found in config`)
          continue
        }

        const qty = quantity || 1
        const amount = workStep.defaultCost * qty
        correctedPricing.breakdown.push({
          label: workStep.name,
          amount,
        })
        correctedPricing.subtotal += amount

        // Recalculate tax if applicable
        if (correctedPricing.taxRate) {
          const rawTax = correctedPricing.subtotal * (correctedPricing.taxRate / 100)
          correctedPricing.taxAmount = Math.round(rawTax * 100) / 100
        }

        correctedPricing.total = correctedPricing.subtotal + correctedPricing.taxAmount

        appliedFixes.push(`Added ${workStep.name}: £${amount}`)
        break
      }

      case 'remove_scope_text': {
        const { pattern, replacement } = issue.autoFix.details
        if (!pattern || !correctedContent.scopeSummary) continue

        const before = correctedContent.scopeSummary
        correctedContent.scopeSummary = correctedContent.scopeSummary.replace(
          new RegExp(pattern, 'gi'),
          replacement || ''
        )

        if (before !== correctedContent.scopeSummary) {
          appliedFixes.push(`Removed "${pattern}" from scope`)
        }
        break
      }

      case 'add_scope_exclusion': {
        const { text } = issue.autoFix.details
        if (!text) continue

        if (!correctedContent.exclusions) {
          correctedContent.exclusions = []
        }

        if (!correctedContent.exclusions.includes(text)) {
          correctedContent.exclusions.push(text)
          appliedFixes.push(`Added exclusion: "${text}"`)
        }
        break
      }

      case 'remove_potential_work': {
        const { itemIndex } = issue.autoFix.details
        if (typeof itemIndex !== 'number' || !correctedRecommendations) continue

        if (itemIndex >= 0 && itemIndex < correctedRecommendations.length) {
          const removed = correctedRecommendations.splice(itemIndex, 1)
          appliedFixes.push(`Removed potential work: "${removed[0]?.workDescription}"`)
        }
        break
      }

      case 'remove_cross_service': {
        const { serviceId } = issue.autoFix.details
        if (!serviceId || !correctedCrossServices) continue

        const before = correctedCrossServices.length
        correctedCrossServices = correctedCrossServices.filter(cs => cs.serviceId !== serviceId)

        if (correctedCrossServices.length < before) {
          appliedFixes.push(`Removed cross-service suggestion: ${serviceId}`)
        }
        break
      }

      case 'remove_addon': {
        const { addonId } = issue.autoFix.details
        if (!addonId) continue

        const removedItems = correctedPricing.breakdown.filter(b =>
          b.label.toLowerCase().includes(addonId.toLowerCase())
        )

        if (removedItems.length > 0) {
          correctedPricing.breakdown = correctedPricing.breakdown.filter(b =>
            !b.label.toLowerCase().includes(addonId.toLowerCase())
          )

          // Recalculate totals
          const removedAmount = removedItems.reduce((sum, item) => sum + item.amount, 0)
          correctedPricing.subtotal -= removedAmount

          if (correctedPricing.taxRate) {
            const rawTax = correctedPricing.subtotal * (correctedPricing.taxRate / 100)
            correctedPricing.taxAmount = Math.round(rawTax * 100) / 100
          }

          correctedPricing.total = correctedPricing.subtotal + correctedPricing.taxAmount

          appliedFixes.push(`Removed addon: ${addonId}`)
        }
        break
      }

      case 'remove_note': {
        const { noteIndex } = issue.autoFix.details
        if (typeof noteIndex !== 'number') continue

        if (correctedPricing.notes && noteIndex >= 0 && noteIndex < correctedPricing.notes.length) {
          const removed = correctedPricing.notes.splice(noteIndex, 1)
          appliedFixes.push(`Removed note: "${removed[0]?.substring(0, 50)}..."`)
        }
        break
      }

      case 'add_note': {
        const { noteText, position } = issue.autoFix.details
        if (!noteText) continue

        if (!correctedPricing.notes) {
          correctedPricing.notes = []
        }

        if (position === 'start') {
          correctedPricing.notes.unshift(noteText)
        } else {
          correctedPricing.notes.push(noteText)
        }

        appliedFixes.push(`Added note: "${noteText.substring(0, 50)}..."`)
        break
      }

      case 'flag_only': {
        // Just log, don't modify
        appliedFixes.push(`Flagged for review: ${issue.description}`)
        break
      }
    }
  }

  return {
    correctedPricing,
    correctedContent,
    correctedRecommendations,
    correctedCrossServices,
    appliedFixes,
  }
}

// ============================================================================
// VALIDATION DECISION HELPER
// ============================================================================

import type { ValidationSettings, ValidationOutcome } from '@estimator/shared'

/**
 * Determine the validation outcome based on settings and issues
 */
export function determineValidationOutcome(
  result: ValidationResult,
  settings: ValidationSettings,
  quoteTotal: number
): { outcome: ValidationOutcome; needsReview: boolean; statusOverride?: 'pending_review' | 'sent' } {
  // If validation is disabled, always pass
  if (!settings.enabled) {
    return { outcome: 'passed', needsReview: false }
  }

  // Check if manual review required due to high value
  // Only applies if requireManualReviewAbove > 0 (0 = feature disabled)
  if (settings.requireManualReviewAbove > 0 && quoteTotal > settings.requireManualReviewAbove) {
    return {
      outcome: 'sent_for_review',
      needsReview: true,
      statusOverride: 'pending_review',
    }
  }

  // Check for critical issues
  if (result.summary.criticalCount > 0) {
    switch (settings.onCriticalIssue) {
      case 'block':
        return { outcome: 'blocked', needsReview: true, statusOverride: 'pending_review' }
      case 'flag_for_review':
        return { outcome: 'sent_for_review', needsReview: true, statusOverride: 'pending_review' }
      case 'auto_correct':
        return { outcome: 'auto_corrected', needsReview: false }
      default:
        return { outcome: 'sent_for_review', needsReview: true, statusOverride: 'pending_review' }
    }
  }

  // Check for high severity issues
  if (result.summary.highCount > 0) {
    switch (settings.onHighIssue) {
      case 'block':
        return { outcome: 'blocked', needsReview: true, statusOverride: 'pending_review' }
      case 'flag_for_review':
        return { outcome: 'sent_for_review', needsReview: true, statusOverride: 'pending_review' }
      case 'auto_correct':
        return { outcome: 'auto_corrected', needsReview: false }
      case 'pass_with_warning':
        return { outcome: 'passed', needsReview: false }
      default:
        return { outcome: 'auto_corrected', needsReview: false }
    }
  }

  // Check for medium severity issues
  if (result.summary.mediumCount > 0) {
    switch (settings.onMediumIssue) {
      case 'flag_for_review':
        return { outcome: 'sent_for_review', needsReview: true, statusOverride: 'pending_review' }
      case 'auto_correct':
        return { outcome: 'auto_corrected', needsReview: false }
      case 'pass_with_warning':
      case 'ignore':
        return { outcome: 'passed', needsReview: false }
      default:
        return { outcome: 'auto_corrected', needsReview: false }
    }
  }

  // Check for low severity issues
  if (result.summary.lowCount > 0) {
    switch (settings.onLowIssue) {
      case 'flag_for_review':
        return { outcome: 'sent_for_review', needsReview: true, statusOverride: 'pending_review' }
      case 'pass_with_warning':
      case 'ignore':
        return { outcome: 'passed', needsReview: false }
      default:
        return { outcome: 'passed', needsReview: false }
    }
  }

  // No issues
  return { outcome: 'passed', needsReview: false }
}

/**
 * Get default validation settings
 * Note: Manual review is DISABLED by default - business must enable it in settings
 */
export function getDefaultValidationSettings(): ValidationSettings {
  return {
    enabled: true,
    onCriticalIssue: 'auto_correct',
    onHighIssue: 'auto_correct',
    onMediumIssue: 'auto_correct',
    onLowIssue: 'pass_with_warning',
    pricingGapThresholdPercent: 20,
    requireManualReviewAbove: 0, // 0 = disabled, business must enable and set threshold
    enabledChecks: {
      pricingCompleteness: true,
      scopeValidation: true,
      potentialWorkValidation: true,
      crossServiceValidation: true,
      addonValidation: true,
      notesValidation: true,
      discountValidation: true,
      logicValidation: true,
    },
  }
}
