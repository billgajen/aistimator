/**
 * Production smoke test (2026-11-08): the customer confirmed the measured
 * wall area in the clarification round, yet the quote stayed Grade B. The
 * ai_signal step was always marked untrusted, so the T-128 trace check
 * re-added it to the grade provenance as 'measured'. A customer-stated or
 * confirmed quantity is trusted, whichever step source reads it.
 */

import { describe, it, expect } from 'vitest'
import { calculatePricingWithTrace, type PricingRules, type TaxConfig } from './rules-engine'
import type { ExtractedSignalsV2 } from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

const legacy = (): ExtractedSignals => ({
  category: 'test',
  materials: [],
  condition: { rating: 'good' },
  complexity: { level: 'medium', factors: [] },
  access: { difficulty: 'easy' },
  observations: [],
  warnings: [],
  confidence: 0.9,
  siteVisitRecommended: false,
})

const withArea = (source: 'form' | 'vision', confidence: number): ExtractedSignalsV2 => ({
  extractedAt: new Date().toISOString(),
  overallConfidence: 0.9,
  signals: [{ key: 'wall_area_sqm', value: 31.5, confidence, source, evidence: 'test' }],
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})

const rules = (): PricingRules => ({
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
  workSteps: [
    { id: 'walls', name: 'Exterior walls', description: '', costType: 'per_unit', defaultCost: 18, optional: false, unitLabel: 'sqm', quantitySource: { type: 'ai_signal', signalKey: 'wall_area_sqm' } },
  ],
})

const noTax: TaxConfig = { enabled: false, rate: 0, label: 'VAT' }

describe('confirmed quantities are trusted', () => {
  it('a customer-confirmed ai_signal quantity is trusted (no Grade B cap)', () => {
    const { result, trace } = calculatePricingWithTrace(rules(), legacy(), withArea('form', 1), [], noTax, 'GBP')
    const line = trace.trace.find((t) => t.id === 'walls')
    expect(result.subtotal).toBe(567)
    expect(line?.quantitySource).toBe('ai_signal')
    expect(line?.quantityTrusted).toBe(true)
    expect(result.notes.some((n) => n.includes('lower confidence'))).toBe(false)
  })

  it('a photo-measured quantity stays untrusted', () => {
    const { trace } = calculatePricingWithTrace(rules(), legacy(), withArea('vision', 0.6), [], noTax, 'GBP')
    expect(trace.trace.find((t) => t.id === 'walls')?.quantityTrusted).toBe(false)
  })
})
