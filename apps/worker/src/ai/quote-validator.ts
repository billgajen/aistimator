/**
 * Quote Validator
 *
 * Comprehensive validation system for generated quotes.
 * Catches issues before quotes reach customers and logs them.
 *
 * T-166 (AD-049): the checker FLAGS, it never corrects. It reads the priced
 * quote and returns issues; nothing here returns or changes a price, a line,
 * a note or any wording. What an issue leads to is decided by
 * `determineValidationOutcome`: the quote is held for the business to review,
 * or it goes on as priced. (Until T-166 this file also held code that could
 * add a work step or remove an add-on. It had been unreachable since the reply
 * format lost its `autoFix` field in February 2026, and is removed.)
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

import type { AiClient } from './client'
import type {
  ValidationResult,
  ValidationIssue,
  WorkStepConfig,
  AddonConfig,
  MultiplierConfig,
  SignalRecommendation,
  CrossServicePricing,
  ExtractedSignal,
} from '@qolumns/shared'
import { formatMoney } from '@qolumns/shared'
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
  /** T-172: the business's money settings, as the pricing engine was given them */
  pricingSettings?: PricingSettingsForValidation
}

/**
 * T-172: the settings that explain money the work steps do not. Without them
 * the checker read a base fee as an invented line, a minimum charge as an
 * overcharge and tax as an unexplained gap, and wrote every amount in pounds.
 * Every value is the business's own configuration; none is a default of ours.
 */
export interface PricingSettingsForValidation {
  /** The currency the business prices in (ISO code), and the locale its amounts are written in */
  currency: string
  locale?: string
  /** Charged once on every quote; 0 when the business has none */
  baseFee: number
  /** A floor, not an item; 0 when the business has none */
  minimumCharge: number
  tax: {
    /** False when the business charges no tax, or this service is exempt */
    enabled: boolean
    label?: string
    /** Whole number: 20 means 20% */
    ratePercent: number
  }
}

/**
 * Generated quote data for validation
 */
export interface GeneratedQuoteForValidation {
  /** Read only: the checker is given a copy and never returns pricing (T-166) */
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
export function buildValidationPrompt(
  customerRequest: CustomerRequestContext,
  serviceConfig: ServiceConfigForValidation,
  quote: GeneratedQuoteForValidation,
  _widgetFields?: WidgetField[]
): string {
  // T-172: every amount is written in the business's own currency (it was a
  // hardcoded pound sign, whatever the business priced in)
  const settings = serviceConfig.pricingSettings
  const currency = settings?.currency || quote.pricing.currency
  const money = (amount: number) => formatMoney(amount, currency, settings?.locale)

  const formAnswersText = customerRequest.formAnswers
    .map(a => `  - ${a.fieldId}: ${JSON.stringify(a.value)}`)
    .join('\n')

  const workStepsText = (serviceConfig.workSteps || [])
    .map(ws => `  - [ID: ${ws.id}] ${ws.name}: ${money(ws.defaultCost)}/${ws.costType === 'fixed' ? 'fixed' : ws.unitLabel || 'unit'} (${ws.optional ? `optional, trigger: ${ws.triggerSignal}` : 'mandatory'})`)
    .join('\n')

  const addonsText = (serviceConfig.addons || [])
    .map(a => `  - ${a.label}: ${money(a.price)} (keywords: ${(a.triggerKeywords || []).join(', ')})`)
    .join('\n')

  const multipliersText = (serviceConfig.multipliers || [])
    .map(m => `  - When ${m.when.fieldId} ${m.when.operator || 'equals'} ${m.when.value || m.when.equals} → ${m.multiplier}x`)
    .join('\n')

  const breakdownText = quote.pricing.breakdown
    .map(b => `  - ${b.label}: ${money(b.amount)}${b.kind === 'minimum' ? ' [this line tops the job up to the business\'s minimum charge]' : ''}`)
    .join('\n')

  const potentialWorkText = (quote.signalRecommendations || [])
    .map((r, i) => `  ${i + 1}. ${r.workDescription}: ${r.costBreakdown}`)
    .join('\n')

  const crossServicesText = (quote.crossServicePricing || [])
    .map(cs => `  - ${cs.serviceName}: ${money(cs.estimatedTotal)} (reason: ${cs.reason})`)
    .join('\n')

  // The business's money settings, in words. A setting that is off is said to
  // be off, so its absence from the quote is not read as a mistake either.
  const taxLabel = settings?.tax.label || quote.pricing.taxLabel || 'Tax'
  const settingsText = settings
    ? [
        `- Currency: ${currency}. Every amount in the configuration and in the quote is in ${currency}.`,
        settings.baseFee > 0
          ? `- Base fee: ${money(settings.baseFee)}, charged once on every quote. It appears in the breakdown as its own line.`
          : '- Base fee: none.',
        settings.minimumCharge > 0
          ? `- Minimum charge: ${money(settings.minimumCharge)}. It is a floor, not an item: when the priced work comes to less, one line in the breakdown tops the job up to exactly ${money(settings.minimumCharge)}. When the work comes to more, it does not appear.`
          : '- Minimum charge: none.',
        settings.tax.enabled
          ? `- Tax: ${taxLabel} at ${settings.tax.ratePercent}%, added to the subtotal. It is not a line in the breakdown.`
          : '- Tax: not charged on this service.',
      ].join('\n')
    : '- (not provided)'

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

### THE BUSINESS'S MONEY SETTINGS (configured by the business; never an error in themselves)
${settingsText}

### GENERATED QUOTE
- Pricing Breakdown (before tax):
${breakdownText || '  (none)'}
- Subtotal: ${money(quote.pricing.subtotal)}
- ${taxLabel}: ${money(quote.pricing.taxAmount)}${quote.pricing.taxRate ? ` (${quote.pricing.taxRate}%)` : ''}
- Total: ${money(quote.pricing.total)}
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
   - Calculate what the total SHOULD be: the base fee (if the business has one), plus the configured work
     steps and addons that apply, with any multiplier that applies. If that comes to less than the
     minimum charge, the subtotal is the minimum charge. Then add tax at the configured rate, if tax
     is charged.
   - Compare to the actual total
   - If actual < expected by >20% → ISSUE (underpriced)
   - The base fee, the minimum charge and tax are the business's own settings. A total that differs from
     the sum of the work steps only because of them is CORRECT and is never an issue.

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
   - If any item states a specific price → ISSUE

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
   - Each suggested service must have a price above zero
   - ISSUE if the price is zero or missing

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
   - Every line item must trace back to the configured work steps, addons or multipliers, or to the
     business's money settings: the base fee line, and the line that tops the job up to the minimum charge
   - Tax at the configured rate is never an invented fee
   - ISSUE if a line item is found in none of these

### CHECK 8: LOGICAL CONSISTENCY
a) FORM/DESCRIPTION CONFLICTS
   - Flag if form says "urgent" but description says "3-4 weeks"
   - This is a NOTE, not a hard ISSUE

---

## IMPORTANT RULES

1. BASE ALL CHECKS ON SERVICE CONFIGURATION - not arbitrary market rates
2. FORM DATA IS TRUTH - if form says X, that's what the customer wants
3. WHEN IN DOUBT, FLAG IT - better to review than to send broken quote
4. DISTINGUISH CONFIG ISSUES FROM PROCESSING ISSUES - config issues need business action
5. EVERY ISSUE MUST HAVE EVIDENCE - quote the specific text/value that's wrong
6. Be conservative - only flag real issues, not theoretical problems
7. The actualTotal for this quote is ${quote.pricing.total}
8. The base fee, the minimum charge, tax and the currency are set by the business. Never flag a quote for applying them as configured.`
}

// ============================================================================
// VALIDATION EXECUTION
// ============================================================================

/**
 * Validate a generated quote using Gemini
 */
/**
 * JSON Schema for Gemini structured output — guarantees valid JSON response.
 */
const VALIDATION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    overallStatus: { type: 'string', enum: ['PASS', 'FAIL', 'REVIEW_NEEDED'] },
    confidenceScore: { type: 'number' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: ['pricing', 'scope', 'potential_work', 'cross_service', 'addons', 'notes', 'discounts', 'logic'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          check: { type: 'string' },
          description: { type: 'string' },
          found: { type: 'string' },
          expected: { type: 'string' },
          autoFixable: { type: 'boolean' },
          suggestedConfigFix: { type: 'string' },
        },
        required: ['id', 'category', 'severity', 'check', 'description', 'found', 'expected', 'autoFixable'],
      },
    },
    summary: {
      type: 'object',
      properties: {
        criticalCount: { type: 'number' },
        highCount: { type: 'number' },
        mediumCount: { type: 'number' },
        lowCount: { type: 'number' },
        autoFixableCount: { type: 'number' },
        configIssueCount: { type: 'number' },
      },
      required: ['criticalCount', 'highCount', 'mediumCount', 'lowCount', 'autoFixableCount', 'configIssueCount'],
    },
    calculatedExpectedTotal: { type: 'number' },
    actualTotal: { type: 'number' },
    pricingGapPercent: { type: 'number' },
  },
  required: ['overallStatus', 'confidenceScore', 'issues', 'summary', 'calculatedExpectedTotal', 'actualTotal', 'pricingGapPercent'],
}

export async function validateQuote(
  gemini: AiClient,
  quote: GeneratedQuoteForValidation,
  customerRequest: CustomerRequestContext,
  serviceConfig: ServiceConfigForValidation,
  _widgetFields?: WidgetField[]
): Promise<ValidationResult> {
  const prompt = buildValidationPrompt(customerRequest, serviceConfig, quote, _widgetFields)

  try {
    const result = await gemini.generateWithSchema<ValidationResult>(
      prompt,
      VALIDATION_RESULT_SCHEMA
    )

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
 * One issue, rebuilt from the fields the checker may return. Anything else in
 * the model's reply is dropped here, so no instruction to change the quote
 * (the old `autoFix`) can travel past this point (T-166).
 */
function issueFromReply(issue: ValidationIssue): ValidationIssue {
  return {
    id: issue.id,
    category: issue.category,
    severity: issue.severity,
    check: issue.check,
    description: issue.description,
    found: issue.found,
    expected: issue.expected,
    autoFixable: issue.autoFixable === true,
    ...(typeof issue.suggestedConfigFix === 'string' && issue.suggestedConfigFix ? { suggestedConfigFix: issue.suggestedConfigFix } : {}),
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
    issues: Array.isArray(result.issues) ? result.issues.map(issueFromReply) : [],
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
// VALIDATION DECISION HELPER
// ============================================================================

import type { ValidationSettings, ValidationOutcome } from '@qolumns/shared'

/**
 * Determine the validation outcome based on settings and issues.
 *
 * It decides one thing: is the quote held for the business to review
 * (`sent_for_review`, `blocked`) or does it go on as priced (`passed`,
 * `passed_with_issues`). It never changes the quote.
 *
 * `auto_correct` is the name stored in every business's settings (the
 * database default since migration 12). Nothing is corrected (AD-049): it
 * means "log the issues and let the quote go on", and its outcome is
 * `passed_with_issues` (called `auto_corrected` before T-166, when 203 local
 * and 4 production runs carried that label with no fix applied).
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
        return { outcome: 'passed_with_issues', needsReview: false }
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
        return { outcome: 'passed_with_issues', needsReview: false }
      case 'pass_with_warning':
        return { outcome: 'passed', needsReview: false }
      default:
        return { outcome: 'passed_with_issues', needsReview: false }
    }
  }

  // Check for medium severity issues
  if (result.summary.mediumCount > 0) {
    switch (settings.onMediumIssue) {
      case 'flag_for_review':
        return { outcome: 'sent_for_review', needsReview: true, statusOverride: 'pending_review' }
      case 'auto_correct':
        return { outcome: 'passed_with_issues', needsReview: false }
      case 'pass_with_warning':
      case 'ignore':
        return { outcome: 'passed', needsReview: false }
      default:
        return { outcome: 'passed_with_issues', needsReview: false }
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
