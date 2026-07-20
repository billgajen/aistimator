/**
 * T-126: form-bound work-step conditions + structural send-guard.
 *
 * Covers hardcore F7: "SUV +£25" / "weekend +£20" charges silently dropped
 * (empty trigger conditions), and the £0 piano-move quote that auto-sent.
 */

import { describe, it, expect } from 'vitest'
import {
  calculatePricingWithTrace,
  type PricingRules,
  type TaxConfig,
} from './rules-engine'
import { evaluateQualityGate } from '../agents/quality-gate'
import type { ExtractedSignalsV2 } from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

const signals = (): ExtractedSignals => ({
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

const structured = (): ExtractedSignalsV2 => ({
  extractedAt: new Date().toISOString(),
  overallConfidence: 0.95,
  signals: [],
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})

const noTax: TaxConfig = { enabled: false, rate: 0, label: 'VAT' }

// The S04 valeting config, as the compiler should now emit it
const valetRules = (): PricingRules => ({
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
  workSteps: [
    { id: 'full_valet', name: 'Full valet (small car)', description: '', costType: 'fixed', defaultCost: 70, optional: false },
    { id: 'suv_surcharge', name: 'SUV/7-seater surcharge', description: '', costType: 'fixed', defaultCost: 25, optional: true, when: { fieldId: 'car_size', operator: 'equals', equals: 'suv_or_7-seater' } },
    { id: 'weekend', name: 'Weekend surcharge', description: '', costType: 'fixed', defaultCost: 20, optional: true, when: { fieldId: 'is_weekend', operator: 'equals', equals: true } },
  ],
})

describe('form-bound step conditions (when)', () => {
  it('applies conditional surcharges when answers match (S04: £95 not £70)', () => {
    const { result } = calculatePricingWithTrace(
      valetRules(), signals(), structured(),
      [{ fieldId: 'car_size', value: 'suv_or_7-seater' }, { fieldId: 'is_weekend', value: true }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(70 + 25 + 20)
  })

  it('skips conditional surcharges when answers do not match', () => {
    const { result } = calculatePricingWithTrace(
      valetRules(), signals(), structured(),
      [{ fieldId: 'car_size', value: 'small_car' }, { fieldId: 'is_weekend', value: false }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(70)
  })

  it('skips a when-conditioned step when its field is unanswered', () => {
    const { result } = calculatePricingWithTrace(valetRules(), signals(), structured(), [], noTax, 'GBP')
    expect(result.subtotal).toBe(70)
  })

  it('matches with the same normalization as multipliers (case/format tolerant)', () => {
    const { result } = calculatePricingWithTrace(
      valetRules(), signals(), structured(),
      [{ fieldId: 'car_size', value: 'SUV or 7-seater' }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(95)
  })

  it('when-condition governs non-optional steps too', () => {
    const rules: PricingRules = {
      baseFee: 0, minimumCharge: 0, addons: [], multipliers: [],
      workSteps: [
        { id: 'piano', name: 'Baby grand move', description: '', costType: 'fixed', defaultCost: 420, optional: false, when: { fieldId: 'item', operator: 'contains', equals: 'piano' } },
        { id: 'clock', name: 'Clock move', description: '', costType: 'fixed', defaultCost: 180, optional: false, when: { fieldId: 'item', operator: 'contains', equals: 'clock' } },
      ],
    }
    const { result } = calculatePricingWithTrace(
      rules, signals(), structured(),
      [{ fieldId: 'item', value: 'Baby grand piano and a longcase clock' }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(600)
  })
})

describe('structural send-guard (quality gate)', () => {
  const gateInput = (overrides: Record<string, unknown>) => ({
    structuredSignals: structured(),
    fusionResult: null,
    pricing: { currency: 'GBP', subtotal: 100, taxLabel: 'VAT', taxRate: 0, taxAmount: 0, total: 100, breakdown: [{ label: 'Work', amount: 100 }], notes: [] },
    clarificationCount: 0,
    serviceName: 'Test Service',
    hasPhotos: false,
    ...overrides,
  })

  it('routes a £0 quote with an EMPTY breakdown to review (the S09 bug)', async () => {
    const result = await evaluateQualityGate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gateInput({ pricing: { currency: 'GBP', subtotal: 0, taxLabel: 'VAT', taxRate: 0, taxAmount: 0, total: 0, breakdown: [], notes: [] } }) as any,
      null
    )
    expect(result.action).toBe('require_review')
    expect(result.reason).toContain('£0')
  })

  it('routes to review when configured steps all failed to bind', async () => {
    const result = await evaluateQualityGate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gateInput({ workStepsConfigured: 3, workStepLinesPriced: 0 }) as any,
      null
    )
    expect(result.action).toBe('require_review')
    expect(result.reason).toContain('work steps')
  })

  it('sends a healthy quote', async () => {
    const result = await evaluateQualityGate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      gateInput({ workStepsConfigured: 3, workStepLinesPriced: 2 }) as any,
      null
    )
    expect(result.action).toBe('send')
  })
})
