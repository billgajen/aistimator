/**
 * T-139: steps selected by an identified value (triggerSignal) match by
 * meaning — "3" equals 3, "natural gas" equals "Natural gas".
 */
import { describe, it, expect } from 'vitest'
import { calculatePricingWithTrace, type PricingRules, type TaxConfig } from './rules-engine'
import type { ExtractedSignalsV2, ExtractedSignal } from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

const legacy = (): ExtractedSignals => ({
  category: 'test', materials: [], condition: { rating: 'good' }, complexity: { level: 'medium', factors: [] },
  access: { difficulty: 'easy' }, observations: [], warnings: [], confidence: 0.9, siteVisitRecommended: false,
})
const structured = (signals: ExtractedSignal[]): ExtractedSignalsV2 => ({
  extractedAt: '', overallConfidence: 0.9, signals, siteVisitRecommended: false, lowConfidenceSignals: [],
})
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Tax' }
const rules = (): PricingRules => ({
  baseFee: 0, minimumCharge: 0, addons: [], multipliers: [],
  workSteps: [
    { id: 'size3', name: 'Size 3 unit', description: '', costType: 'fixed', defaultCost: 3000, optional: true, triggerSignal: 'size', triggerCondition: { operator: 'equals', value: 3 } },
    { id: 'big', name: 'Big unit surcharge', description: '', costType: 'fixed', defaultCost: 400, optional: true, triggerSignal: 'size', triggerCondition: { operator: 'gte', value: 4 } },
    { id: 'gas', name: 'Gas line', description: '', costType: 'fixed', defaultCost: 250, optional: true, triggerSignal: 'fuel', triggerCondition: { operator: 'equals', value: 'Natural gas' } },
  ],
})
const total = (signals: ExtractedSignal[]) =>
  calculatePricingWithTrace(rules(), legacy(), structured(signals), [], noTax, 'USD').result.subtotal

describe('identified triggers', () => {
  it('numeric string equals number; strings match case-insensitively', () => {
    expect(total([
      { key: 'size', value: '3', confidence: 1, source: 'form' },
      { key: 'fuel', value: 'natural gas', confidence: 1, source: 'form' },
    ])).toBe(3250)
  })
  it('numeric comparisons accept numeric strings', () => {
    expect(total([{ key: 'size', value: '5', confidence: 0.9, source: 'vision', basis: 'identified' }])).toBe(400)
  })
  it('non-matching values select nothing', () => {
    expect(total([{ key: 'size', value: 'three', confidence: 0.9, source: 'vision' }, { key: 'fuel', value: 'Propane', confidence: 1, source: 'form' }])).toBe(0)
  })
})
