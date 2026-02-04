/**
 * Mock AI Signal Responses for Testing
 *
 * Provides deterministic AI signal extraction results for testing
 * the quote processing pipeline without calling the actual Gemini API.
 */

import type { ExtractedSignalsV2, ExtractedSignal } from '@estimator/shared'

/**
 * Creates a mock ExtractedSignalsV2 with specified signals
 */
export function createMockSignalsV2(
  signals: Array<Omit<ExtractedSignal, 'source'> & { source?: ExtractedSignal['source'] }>,
  options: {
    overallConfidence?: number
    siteVisitRecommended?: boolean
    siteVisitReason?: string
    lowConfidenceSignals?: string[]
  } = {}
): ExtractedSignalsV2 {
  const {
    overallConfidence = 0.9,
    siteVisitRecommended = false,
    siteVisitReason,
    lowConfidenceSignals = [],
  } = options

  return {
    extractedAt: new Date().toISOString(),
    overallConfidence,
    signals: signals.map((s) => ({
      ...s,
      source: s.source || 'vision',
    })),
    complexity: { level: 'medium', factors: [] },
    siteVisitRecommended,
    siteVisitReason,
    lowConfidenceSignals,
  }
}

/**
 * Creates form-sourced signals (confidence: 1.0)
 */
export function createFormSignals(
  values: Record<string, number | string | boolean>
): ExtractedSignal[] {
  return Object.entries(values).map(([key, value]) => ({
    key,
    value,
    confidence: 1.0,
    source: 'form' as const,
    evidence: `Customer-provided: ${key}`,
  }))
}

/**
 * Creates AI vision signals with specified confidence
 */
export function createVisionSignals(
  values: Record<string, { value: number | string | boolean; confidence?: number; evidence?: string }>
): ExtractedSignal[] {
  return Object.entries(values).map(([key, { value, confidence = 0.8, evidence }]) => ({
    key,
    value,
    confidence,
    source: 'vision' as const,
    evidence: evidence || `Detected from photos: ${key}`,
  }))
}

// =============================================================================
// SCENARIO-SPECIFIC MOCK SIGNALS
// =============================================================================

/**
 * TEST-E2E-1: Basic cleaning service signals
 */
export const basicCleaningSignals = createMockSignalsV2([
  { key: 'room_count', value: 4, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'bathroom_count', value: 2, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'property_size', value: 'medium', confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'condition_rating', value: 'good', confidence: 0.85, source: 'vision', evidence: 'Photos show clean spaces' },
  { key: 'complexity_level', value: 'medium', confidence: 0.9, source: 'vision', evidence: 'Standard room layouts' },
])

/**
 * TEST-E2E-2: Signals with addon keywords detected
 * Customer mentions fridge and laundry in description
 */
export const addonKeywordSignals = createMockSignalsV2([
  { key: 'room_count', value: 3, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'bathroom_count', value: 1, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'property_size', value: 'medium', confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
])

/**
 * TEST-E2E-3: Signals for cross-service detection
 * Customer mentions painting in their cleaning request
 */
export const crossServiceSignals = createMockSignalsV2([
  { key: 'room_count', value: 3, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'bathroom_count', value: 1, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'walls_need_paint', value: true, confidence: 0.75, source: 'vision', evidence: 'Scuff marks on walls visible in photo 2' },
])

/**
 * TEST-E2E-4: Signals with unused AI detections
 * AI detects things not configured in pricing rules
 */
export const unusedSignalsScenario = createMockSignalsV2([
  { key: 'room_count', value: 4, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'bathroom_count', value: 2, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  // These signals are detected but NOT used by any work step
  { key: 'water_damage', value: true, confidence: 0.82, source: 'vision', evidence: 'Water stains visible near window in photo 3' },
  { key: 'mold_presence', value: 'mild', confidence: 0.65, source: 'vision', evidence: 'Dark spots in bathroom corners' },
  { key: 'pest_evidence', value: false, confidence: 0.9, source: 'vision', evidence: 'No pest evidence detected' },
])

/**
 * TEST-E2E-5: Low confidence signals for fallback testing
 */
export const lowConfidenceSignals = createMockSignalsV2(
  [
    { key: 'room_count', value: 5, confidence: 0.4, source: 'vision', evidence: 'Difficult to count from photos - partial views only' },
    { key: 'bathroom_count', value: 2, confidence: 0.35, source: 'vision', evidence: 'Only glimpses of bathrooms visible' },
    { key: 'property_size', value: 'large', confidence: 0.5, source: 'vision', evidence: 'Estimated from room sizes' },
    { key: 'condition_rating', value: 'fair', confidence: 0.55, source: 'vision', evidence: 'Some areas unclear' },
  ],
  {
    overallConfidence: 0.45,
    siteVisitRecommended: true,
    siteVisitReason: 'Photo quality insufficient for accurate assessment',
    lowConfidenceSignals: ['room_count', 'bathroom_count', 'property_size'],
  }
)

/**
 * TEST-E2E-6: Form override scenario
 * AI detects different values than form provides
 */
export const formOverrideSignals = createMockSignalsV2([
  // Form values (confidence 1.0) should override AI values
  { key: 'room_count', value: 5, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'bathroom_count', value: 3, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'property_size', value: 'large', confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  // Optional work step triggers from form
  { key: 'include_oven', value: true, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  { key: 'carpet_areas', value: 2, confidence: 1.0, source: 'form', evidence: 'Customer-provided' },
  // AI detected values (will be overridden by form)
  { key: 'condition_rating', value: 'good', confidence: 0.75, source: 'vision', evidence: 'AI detected good condition' },
])

// =============================================================================
// LEGACY SIGNAL FORMAT (for backwards compatibility testing)
// =============================================================================

import type { ExtractedSignals, DetectableCondition } from '../../ai/signals'

/**
 * Creates legacy ExtractedSignals format
 */
export function createLegacySignals(options: {
  category?: string
  materials?: string[]
  condition?: 'good' | 'fair' | 'poor' | 'unknown'
  complexity?: 'low' | 'medium' | 'high' | 'unknown'
  access?: 'easy' | 'moderate' | 'difficult' | 'unknown'
  confidence?: number
  siteVisitRecommended?: boolean
  detectedConditions?: DetectableCondition[]
  warnings?: string[]
} = {}): ExtractedSignals {
  return {
    category: options.category || 'cleaning',
    materials: options.materials || [],
    condition: { rating: options.condition || 'good' },
    complexity: { level: options.complexity || 'medium', factors: [] },
    access: { difficulty: options.access || 'easy' },
    observations: [],
    warnings: options.warnings || [],
    confidence: options.confidence ?? 0.9,
    siteVisitRecommended: options.siteVisitRecommended || false,
    detectedConditions: options.detectedConditions,
  }
}

/**
 * Default legacy signals for basic testing
 */
export const defaultLegacySignals = createLegacySignals()

/**
 * Low confidence legacy signals
 */
export const lowConfidenceLegacySignals = createLegacySignals({
  confidence: 0.4,
  siteVisitRecommended: true,
  complexity: 'high',
  warnings: ['Photo quality insufficient for accurate assessment'],
})
