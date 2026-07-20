/**
 * T-125: Derived quantities, percent steps, subtotal multipliers.
 *
 * Covers the hardcore-test F2 failure modes:
 * - transaction tiering (S05: 2,400 tx must price 3 tiers, not 2,400 units)
 * - threshold distance (S09: 250 miles must price 225 excess miles)
 * - staff ratio (S06: 128 guests → 9 staff)
 * - percentage service charge on named lines (S06)
 * - order-value discount only above threshold (S03: £5,000 boundary)
 */

import { describe, it, expect } from 'vitest'
import { evaluateFormula, extractFormulaIdentifiers } from '@estimator/shared'
import {
  calculatePricingWithTrace,
  type PricingRules,
  type FormAnswer,
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

const structured = (
  entries: Array<{ key: string; value: number | string | boolean }> = []
): ExtractedSignalsV2 => ({
  extractedAt: new Date().toISOString(),
  overallConfidence: 0.95,
  signals: entries.map((s) => ({ key: s.key, value: s.value, confidence: 1.0, source: 'form' as const })),
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})

const noTax: TaxConfig = { enabled: false, rate: 0, label: 'VAT' }

const baseRules = (overrides: Partial<PricingRules>): PricingRules => ({
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
  ...overrides,
})

// ============================================================================
// Formula evaluator
// ============================================================================

describe('evaluateFormula', () => {
  const env = (vars: Record<string, number>) => (name: string) => vars[name]

  it('handles arithmetic and precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', env({}))).toEqual({ ok: true, value: 14 })
    expect(evaluateFormula('(2 + 3) * 4', env({}))).toEqual({ ok: true, value: 20 })
    expect(evaluateFormula('-3 + 10', env({}))).toEqual({ ok: true, value: 7 })
  })

  it('computes the S05 transaction tier formula', () => {
    const f = 'ceil(max(0, num_transactions - 1000) / 500)'
    expect(evaluateFormula(f, env({ num_transactions: 2400 }))).toEqual({ ok: true, value: 3 })
    expect(evaluateFormula(f, env({ num_transactions: 1000 }))).toEqual({ ok: true, value: 0 })
    expect(evaluateFormula(f, env({ num_transactions: 1001 }))).toEqual({ ok: true, value: 1 })
  })

  it('computes threshold and ratio formulas', () => {
    expect(evaluateFormula('max(0, miles - 25)', env({ miles: 250 }))).toEqual({ ok: true, value: 225 })
    expect(evaluateFormula('max(0, miles - 25)', env({ miles: 20 }))).toEqual({ ok: true, value: 0 })
    expect(evaluateFormula('ceil((adults + kids) / 15)', env({ adults: 120, kids: 8 }))).toEqual({ ok: true, value: 9 })
    expect(evaluateFormula('min(slates, 10)', env({ slates: 7 }))).toEqual({ ok: true, value: 7 })
    expect(evaluateFormula('max(0, slates - 10)', env({ slates: 7 }))).toEqual({ ok: true, value: 0 })
  })

  it('fails on unknown identifiers, bad syntax, and abuse', () => {
    expect(evaluateFormula('nope + 1', env({})).ok).toBe(false)
    expect(evaluateFormula('1 +', env({})).ok).toBe(false)
    expect(evaluateFormula('foo(1)', env({})).ok).toBe(false)
    expect(evaluateFormula('1 / 0', env({})).ok).toBe(false)
    expect(evaluateFormula('a'.repeat(400), env({})).ok).toBe(false)
    expect(evaluateFormula('process.exit(1)', env({})).ok).toBe(false)
  })

  it('extracts identifiers for compile-time validation', () => {
    expect(extractFormulaIdentifiers('ceil(max(0, a - 1000) / b)')?.sort()).toEqual(['a', 'b'])
    expect(extractFormulaIdentifiers('1 +')).toBeNull()
  })
})

// ============================================================================
// Engine: derived quantity steps
// ============================================================================

describe('derived quantity work steps', () => {
  it('prices the S05 tier scenario correctly (the £361k bug)', () => {
    const rules = baseRules({
      workSteps: [
        {
          id: 'year_end', name: 'Year-end accounts', description: '', costType: 'fixed',
          defaultCost: 850, optional: false,
        },
        {
          id: 'extra_tx', name: 'Extra transactions', description: '', costType: 'per_unit',
          defaultCost: 150, optional: false, unitLabel: '500 transactions',
          quantitySource: { type: 'derived', formula: 'ceil(max(0, num_transactions - 1000) / 500)' },
        },
      ],
    })
    const answers: FormAnswer[] = [{ fieldId: 'num_transactions', value: 2400 }]
    const { result, trace } = calculatePricingWithTrace(rules, signals(), structured(), answers, noTax, 'GBP')

    expect(result.subtotal).toBe(850 + 3 * 150) // NOT 850 + 2400×150
    const step = trace.trace.find((t) => t.id === 'extra_tx')
    expect(step?.quantitySource).toBe('derived')
    expect(step?.quantityTrusted).toBe(true)
  })

  it('clamps threshold formulas at zero (S09 distance under 25 miles)', () => {
    const rules = baseRules({
      workSteps: [
        {
          id: 'distance', name: 'Distance beyond 25 miles', description: '', costType: 'per_unit',
          defaultCost: 2.1, optional: false, unitLabel: 'miles',
          quantitySource: { type: 'derived', formula: 'max(0, total_miles - 25)' },
        },
      ],
    })
    const far = calculatePricingWithTrace(rules, signals(), structured(), [{ fieldId: 'total_miles', value: 250 }], noTax, 'GBP')
    expect(far.result.subtotal).toBe(225 * 2.1)

    const near = calculatePricingWithTrace(rules, signals(), structured(), [{ fieldId: 'total_miles', value: 20 }], noTax, 'GBP')
    expect(near.result.subtotal).toBe(0) // zero-quantity line dropped entirely
  })

  it('marks unresolved formulas untrusted and falls back to quantity 1', () => {
    const rules = baseRules({
      workSteps: [
        {
          id: 'broken', name: 'Broken step', description: '', costType: 'per_unit',
          defaultCost: 100, optional: false,
          quantitySource: { type: 'derived', formula: 'missing_field * 2' },
        },
      ],
    })
    const { result, trace } = calculatePricingWithTrace(rules, signals(), structured(), [], noTax, 'GBP')
    expect(result.subtotal).toBe(100)
    const step = trace.trace.find((t) => t.id === 'broken')
    expect(step?.quantitySource).toBe('derived_unresolved')
    expect(step?.quantityTrusted).toBe(false)
  })

  it('marks formulas resolved from AI signals as untrusted', () => {
    const rules = baseRules({
      workSteps: [
        {
          id: 'area', name: 'Area step', description: '', costType: 'per_unit',
          defaultCost: 10, optional: false,
          quantitySource: { type: 'derived', formula: 'wall_area * 2' },
        },
      ],
    })
    const { trace } = calculatePricingWithTrace(
      rules, signals(), structured([{ key: 'wall_area', value: 40 }]), [], noTax, 'GBP'
    )
    const step = trace.trace.find((t) => t.id === 'area')
    expect(step?.amount).toBe(800)
    expect(step?.quantityTrusted).toBe(false)
  })
})

// ============================================================================
// Engine: percent steps
// ============================================================================

describe('percent work steps', () => {
  it('applies a service charge to named lines only (S06)', () => {
    const rules = baseRules({
      workSteps: [
        { id: 'menu', name: 'Menu', description: '', costType: 'per_unit', defaultCost: 62, optional: false, unitLabel: 'heads', quantitySource: { type: 'form_field', fieldId: 'guests' } },
        { id: 'staff', name: 'Staff', description: '', costType: 'per_unit', defaultCost: 140, optional: false, unitLabel: 'staff', quantitySource: { type: 'derived', formula: 'ceil(guests / 15)' } },
        { id: 'service', name: 'Service charge', description: '', costType: 'percent', defaultCost: 10, optional: false, percentOf: ['menu'] },
      ],
    })
    const { result, trace } = calculatePricingWithTrace(rules, signals(), structured(), [{ fieldId: 'guests', value: 120 }], noTax, 'GBP')

    const menu = 120 * 62 // 7440
    const staff = 8 * 140 // ceil(120/15)=8 → 1120
    const service = menu * 0.1 // 744 — staff NOT included
    expect(result.subtotal).toBe(menu + staff + service)
    expect(trace.trace.find((t) => t.id === 'service')?.amount).toBe(744)
  })

  it('supports percent of subtotal', () => {
    const rules = baseRules({
      baseFee: 100,
      workSteps: [
        { id: 'fee', name: 'Admin fee', description: '', costType: 'percent', defaultCost: 5, optional: false, percentOf: 'subtotal' },
      ],
    })
    const { result } = calculatePricingWithTrace(rules, signals(), structured(), [], noTax, 'GBP')
    expect(result.subtotal).toBe(105)
  })
})

// ============================================================================
// Engine: subtotal-conditional multipliers
// ============================================================================

describe('subtotal multipliers', () => {
  const discountRules = (stepCost: number): PricingRules => baseRules({
    workSteps: [
      { id: 'work', name: 'Work', description: '', costType: 'fixed', defaultCost: stepCost, optional: false },
    ],
    multipliers: [
      { when: { subject: 'subtotal', operator: 'gt', value: 5000 }, multiplier: 0.9, label: '10% discount over £5,000' },
    ],
  })

  it('applies the discount above the threshold', () => {
    const { result } = calculatePricingWithTrace(discountRules(6000), signals(), structured(), [], noTax, 'GBP')
    expect(result.subtotal).toBe(5400)
  })

  it('does NOT apply the discount at or below the threshold (S03 near-miss)', () => {
    const at = calculatePricingWithTrace(discountRules(5000), signals(), structured(), [], noTax, 'GBP')
    expect(at.result.subtotal).toBe(5000)
    const under = calculatePricingWithTrace(discountRules(4430), signals(), structured(), [], noTax, 'GBP')
    expect(under.result.subtotal).toBe(4430)
  })
})
