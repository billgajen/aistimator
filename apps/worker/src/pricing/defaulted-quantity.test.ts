/**
 * T-127: defaulted ×1 quantities feed the clarification gate (hardcore F3 —
 * the £85 "fence" that should have been £1,700, sent Grade A with no
 * question asked), and clarification answers close the pricing loop.
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

describe('T-127: defaulted quantities are visible and clarifiable', () => {
  const fenceRules = (): PricingRules => ({
    baseFee: 0,
    minimumCharge: 0,
    addons: [],
    multipliers: [],
    workSteps: [
      { id: 'fencing', name: 'Closeboard fencing', description: '', costType: 'per_unit', defaultCost: 85, optional: false, unitLabel: 'metres', quantitySource: { type: 'form_field', fieldId: 'fence_length_m' } },
    ],
  })

  it('unanswered form-field quantity prices ×1, flagged legacy_fallback untrusted', () => {
    const { result, trace } = calculatePricingWithTrace(fenceRules(), signals(), structured(), [], noTax, 'GBP')
    expect(result.subtotal).toBe(85)
    const line = trace.trace.find((t) => t.id === 'fencing')
    expect(line?.quantitySource).toBe('legacy_fallback')
    expect(line?.quantityTrusted).toBe(false)
  })

  it('the gate asks about a defaulted quantity (template question, no AI needed)', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: structured(),
        fusionResult: null,
        pricing: { currency: 'GBP', subtotal: 85, taxLabel: 'VAT', taxRate: 0, taxAmount: 0, total: 85, breakdown: [{ label: 'Closeboard fencing', amount: 85 }], notes: [] },
        clarificationCount: 0,
        serviceName: 'Garden Landscaping',
        hasPhotos: true,
        defaultedQuantitySteps: [{ askKey: 'fence_length_m', stepName: 'Closeboard fencing' }],
        workStepsConfigured: 1,
        workStepLinesPriced: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      null
    )
    expect(result.action).toBe('ask_clarification')
    expect(result.questions?.[0]?.targetSignalKey).toBe('fence_length_m')
  })

  it('does NOT ask again after the clarification round (cap at 1)', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: structured(),
        fusionResult: null,
        pricing: { currency: 'GBP', subtotal: 85, taxLabel: 'VAT', taxRate: 0, taxAmount: 0, total: 85, breakdown: [{ label: 'x', amount: 85 }], notes: [] },
        clarificationCount: 1,
        serviceName: 'Garden Landscaping',
        hasPhotos: true,
        defaultedQuantitySteps: [{ askKey: 'fence_length_m', stepName: 'Closeboard fencing' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      null
    )
    expect(result.action).toBe('send')
  })

  it('the clarify answer (merged as a form answer) fixes the price on reprocess', () => {
    const { result, trace } = calculatePricingWithTrace(
      fenceRules(), signals(), structured(),
      [{ fieldId: 'fence_length_m', value: 20 }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(1700)
    expect(trace.trace.find((t) => t.id === 'fencing')?.quantityTrusted).toBe(true)
  })

  it('R3-1: a stated-quantity concern triggers an in-flow confirmation question', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: structured(),
        fusionResult: null,
        pricing: { currency: 'GBP', subtotal: 272, taxLabel: 'VAT', taxRate: 20, taxAmount: 45, total: 272, breakdown: [{ label: 'Hourly cleaning', amount: 56 }], notes: [] },
        clarificationCount: 0,
        serviceName: 'Home Cleaning',
        hasPhotos: true,
        quantityConcern: { reason: 'From your photos, 2 hours may not be enough for a full deep clean — many similar jobs need 3-4 hours.', fieldId: 'hours_required' },
        workStepsConfigured: 1,
        workStepLinesPriced: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      null
    )
    expect(result.action).toBe('ask_clarification')
    expect(result.questions?.[0]?.targetSignalKey).toBe('hours_required')
  })

  it('R3-1 cosmetics: multiplier lines carry human labels with percentages', () => {
    const rules: PricingRules = {
      baseFee: 0, minimumCharge: 0, addons: [],
      multipliers: [
        { when: { fieldId: 'is_deep_clean', operator: 'equals', equals: true }, multiplier: 1.5 },
        { when: { fieldId: 'job_urgency', operator: 'equals', equals: 'emergency' }, multiplier: 1.25 },
      ],
      workSteps: [
        { id: 'clean', name: 'Cleaning', description: '', costType: 'fixed', defaultCost: 100, optional: false },
      ],
    }
    const { result } = calculatePricingWithTrace(
      rules, signals(), structured(),
      [{ fieldId: 'is_deep_clean', value: true }, { fieldId: 'job_urgency', value: 'emergency' }],
      noTax, 'GBP'
    )
    const labels = result.breakdown.map((l) => l.label)
    expect(labels).toContain('Deep clean surcharge (+50%)')
    expect(labels.some((l) => l.includes('Emergency surcharge (+25%)'))).toBe(true)
    expect(labels.some((l) => /: true/.test(l))).toBe(false)
  })

  it('legacy steps (no quantitySource) honour a direct answer keyed by step id', () => {
    const rules: PricingRules = {
      baseFee: 0, minimumCharge: 0, addons: [], multipliers: [],
      workSteps: [
        { id: 'ridge_repointing', name: 'Ridge repointing', description: '', costType: 'per_unit', defaultCost: 60, optional: false, unitLabel: 'metres' },
      ],
    }
    const before = calculatePricingWithTrace(rules, signals(), structured(), [], noTax, 'GBP')
    expect(before.result.subtotal).toBe(60) // ×1 placeholder
    const after = calculatePricingWithTrace(rules, signals(), structured(), [{ fieldId: 'ridge_repointing', value: 2 }], noTax, 'GBP')
    expect(after.result.subtotal).toBe(120)
    expect(after.trace.trace.find((t) => t.id === 'ridge_repointing')?.quantityTrusted).toBe(true)
  })
})
