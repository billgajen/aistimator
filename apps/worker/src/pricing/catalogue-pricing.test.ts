/**
 * T-131: catalogue semantics (missingMeansZero), credit lines.
 * Hardcore R2-2/R2-5: £1,940 of furniture quoted to a customer who asked for
 * one armchair; resale credits inexpressible.
 */

import { describe, it, expect } from 'vitest'
import {
  calculatePricingWithTrace,
  type PricingRules,
  type TaxConfig,
} from './rules-engine'
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

// The S23 upholstery catalogue, as the compiler should now emit it
const upholsteryRules = (): PricingRules => ({
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
  workSteps: [
    { id: 'dining_chair', name: 'Dining chair seat', description: '', costType: 'per_unit', defaultCost: 45, optional: false, unitLabel: 'chairs', quantitySource: { type: 'form_field', fieldId: 'num_dining_chairs', missingMeansZero: true } },
    { id: 'armchair', name: 'Armchair reupholstery', description: '', costType: 'per_unit', defaultCost: 420, optional: false, unitLabel: 'armchairs', quantitySource: { type: 'form_field', fieldId: 'num_armchairs', missingMeansZero: true }, costBand: { low: 420, high: 600 } },
    { id: 'sofa', name: 'Two-seat sofa', description: '', costType: 'per_unit', defaultCost: 680, optional: false, unitLabel: 'sofas', quantitySource: { type: 'form_field', fieldId: 'num_sofas', missingMeansZero: true } },
  ],
})

describe('T-131 catalogue semantics (missingMeansZero)', () => {
  it('prices ONLY the requested item — the S23 armchair case', () => {
    const { result, trace } = calculatePricingWithTrace(
      upholsteryRules(), signals(), structured(),
      [{ fieldId: 'num_armchairs', value: 1 }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(420) // NOT 45+420+680
    expect(trace.trace.filter((t) => t.type === 'work_step')).toHaveLength(1)
  })

  it('unanswered catalogue items are trusted non-selections (no T-127 flag)', () => {
    const { trace } = calculatePricingWithTrace(
      upholsteryRules(), signals(), structured(),
      [{ fieldId: 'num_armchairs', value: 1 }],
      noTax, 'GBP'
    )
    expect(trace.trace.some((t) => t.quantitySource === 'legacy_fallback')).toBe(false)
  })

  it('multiple selections still price correctly', () => {
    const { result } = calculatePricingWithTrace(
      upholsteryRules(), signals(), structured(),
      [{ fieldId: 'num_dining_chairs', value: 6 }, { fieldId: 'num_sofas', value: 1 }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(6 * 45 + 680)
  })
})

describe('T-131 derived formulas over catalogue fields', () => {
  it('unanswered missingMeansZero fields resolve to 0 inside formulas (the S23 fabric case)', () => {
    const rules: PricingRules = {
      baseFee: 0, minimumCharge: 0, addons: [], multipliers: [],
      workSteps: [
        { id: 'armchair', name: 'Armchair', description: '', costType: 'per_unit', defaultCost: 420, optional: false, unitLabel: 'armchairs', quantitySource: { type: 'form_field', fieldId: 'num_armchairs', missingMeansZero: true } },
        { id: 'sofa', name: 'Sofa', description: '', costType: 'per_unit', defaultCost: 680, optional: false, unitLabel: 'sofas', quantitySource: { type: 'form_field', fieldId: 'num_sofas', missingMeansZero: true } },
        // fabric: 6m per armchair, 12m per sofa @ £25/m — references BOTH fields
        { id: 'fabric', name: 'Fabric', description: '', costType: 'per_unit', defaultCost: 25, optional: false, unitLabel: 'metres', quantitySource: { type: 'derived', formula: 'num_armchairs * 6 + num_sofas * 12' } },
      ],
    }
    const { result, trace } = calculatePricingWithTrace(
      rules, signals(), structured(),
      [{ fieldId: 'num_armchairs', value: 1 }], // sofa unanswered = not requested
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(420 + 6 * 25) // fabric resolves with sofas=0
    const fabric = trace.trace.find((t) => t.id === 'fabric')
    expect(fabric?.quantitySource).toBe('derived') // resolved, NOT derived_unresolved
    expect(fabric?.quantityTrusted).toBe(true) // zero-default is a trusted non-selection
  })
})

describe('T-131 credit lines (R2-5)', () => {
  it('subtracts a credit and shows it as a negative line', () => {
    const rules: PricingRules = {
      baseFee: 0, minimumCharge: 0, addons: [], multipliers: [],
      workSteps: [
        { id: 'clearance', name: 'Van load clearance', description: '', costType: 'per_unit', defaultCost: 120, optional: false, unitLabel: 'loads', quantitySource: { type: 'form_field', fieldId: 'num_loads' } },
        { id: 'resale_credit', name: 'Resale value credit', description: '', costType: 'credit', defaultCost: 80, optional: true, when: { fieldId: 'has_resaleables', operator: 'equals', equals: true } },
      ],
    }
    const { result, trace } = calculatePricingWithTrace(
      rules, signals(), structured(),
      [{ fieldId: 'num_loads', value: 3 }, { fieldId: 'has_resaleables', value: true }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(3 * 120 - 80)
    expect(trace.trace.find((t) => t.id === 'resale_credit')?.amount).toBe(-80)
  })

  it('credit does not apply when its condition is false', () => {
    const rules: PricingRules = {
      baseFee: 0, minimumCharge: 0, addons: [], multipliers: [],
      workSteps: [
        { id: 'clearance', name: 'Van load clearance', description: '', costType: 'per_unit', defaultCost: 120, optional: false, unitLabel: 'loads', quantitySource: { type: 'form_field', fieldId: 'num_loads' } },
        { id: 'resale_credit', name: 'Resale value credit', description: '', costType: 'credit', defaultCost: 80, optional: true, when: { fieldId: 'has_resaleables', operator: 'equals', equals: true } },
      ],
    }
    const { result } = calculatePricingWithTrace(
      rules, signals(), structured(),
      [{ fieldId: 'num_loads', value: 3 }, { fieldId: 'has_resaleables', value: false }],
      noTax, 'GBP'
    )
    expect(result.subtotal).toBe(360)
  })
})
