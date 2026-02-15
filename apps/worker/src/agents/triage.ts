/**
 * Triage Agent
 *
 * Classifies quote requests by complexity using heuristics (no AI call).
 * Optimizes downstream processing by skipping unnecessary steps.
 *
 * Classifications:
 * - simple:   0 photos AND short description AND single-service tenant
 * - complex:  3+ photos OR long description OR multiple AI signal work steps
 * - standard: everything else
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TriageDecision, TriageInput, PhotoStrategy } from './types'

const SIMPLE_DESCRIPTION_MAX = 100
const COMPLEX_DESCRIPTION_MIN = 500
const MAX_PHOTOS_TO_ANALYZE = 5

/**
 * Classify a quote request and determine processing strategy.
 * This is purely heuristic — no AI call, near-zero latency.
 */
export function classify(input: TriageInput, previousQuoteCount: number): TriageDecision {
  const reasons: string[] = []

  // Determine classification
  const classification = determineClassification(input, reasons)

  // Determine photo strategy
  const photoStrategy = determinePhotoStrategy(input.photoCount, classification)

  // Cross-service check: skip if tenant has no other services
  const crossServiceCheck = input.hasOtherServices && input.description.length > 0

  if (!crossServiceCheck) {
    reasons.push('Cross-service check skipped: no other services or empty description')
  }

  return {
    classification,
    photoStrategy,
    crossServiceCheck,
    returningCustomer: previousQuoteCount > 0,
    previousQuoteCount,
    reasons,
  }
}

/**
 * Determine complexity classification.
 */
function determineClassification(
  input: TriageInput,
  reasons: string[]
): TriageDecision['classification'] {
  // Complex indicators
  const complexIndicators: string[] = []

  if (input.photoCount >= 3) {
    complexIndicators.push(`${input.photoCount} photos (>=3)`)
  }
  if (input.description.length > COMPLEX_DESCRIPTION_MIN) {
    complexIndicators.push(`description ${input.description.length} chars (>${COMPLEX_DESCRIPTION_MIN})`)
  }
  if (input.aiSignalWorkStepCount >= 2) {
    complexIndicators.push(`${input.aiSignalWorkStepCount} AI signal work steps (>=2)`)
  }

  if (complexIndicators.length > 0) {
    reasons.push(`Complex: ${complexIndicators.join(', ')}`)
    return 'complex'
  }

  // Simple indicators: ALL must be true
  const isSimple =
    input.photoCount === 0 &&
    input.description.length < SIMPLE_DESCRIPTION_MAX &&
    input.tenantServiceCount <= 1

  if (isSimple) {
    reasons.push('Simple: no photos, short description, single-service tenant')
    return 'simple'
  }

  reasons.push('Standard: does not meet simple or complex thresholds')
  return 'standard'
}

/**
 * Determine how many photos to analyze.
 */
function determinePhotoStrategy(
  photoCount: number,
  classification: TriageDecision['classification']
): PhotoStrategy {
  if (photoCount === 0) {
    return { skipVision: true, maxPhotos: 0 }
  }

  if (classification === 'simple') {
    // Simple requests shouldn't have photos, but if they do, analyze minimally
    return { skipVision: false, maxPhotos: Math.min(photoCount, 2) }
  }

  if (photoCount <= 2) {
    return { skipVision: false, maxPhotos: photoCount }
  }

  // 3+ photos: cap at MAX_PHOTOS_TO_ANALYZE
  return { skipVision: false, maxPhotos: Math.min(photoCount, MAX_PHOTOS_TO_ANALYZE) }
}

/**
 * Query previous quote count for returning customer detection.
 * Returns 0 if the query fails (non-blocking).
 */
export async function queryPreviousQuoteCount(
  supabase: SupabaseClient,
  customerEmail: string,
  tenantId: string
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('quote_requests')
      .select('id', { count: 'exact', head: true })
      .eq('customer_email', customerEmail)
      .eq('tenant_id', tenantId)

    if (error) {
      console.warn('[Triage] Failed to query previous quotes:', error.message)
      return 0
    }

    return count ?? 0
  } catch (err) {
    console.warn('[Triage] Previous quote query failed:', err)
    return 0
  }
}
