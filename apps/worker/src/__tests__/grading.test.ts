/**
 * Tests for estimate grading + VOI (T-120/T-121, Measurement Engine M6+M7)
 * — packages/shared/src/grading.ts
 */

import { describe, it, expect } from 'vitest'
import {
  computeEstimateGrade,
  capFlatRateGrade,
  priceDependsOnJobFacts,
  isQuestionWorthAsking,
  type QuantityProvenance,
} from '@estimator/shared'

const q = (basis: QuantityProvenance['basis'], confidence: number): QuantityProvenance => ({
  signalKey: 'wall_area_sqm',
  basis,
  confidence,
})

describe('computeEstimateGrade (M6 — the declared precision class)', () => {
  it('no AI quantities at all → Grade A (customer stated every driver)', () => {
    expect(computeEstimateGrade([]).grade).toBe('A')
  })

  it('all drivers confirmed → Grade A, exact price', () => {
    expect(computeEstimateGrade([q('confirmed', 1)]).grade).toBe('A')
  })

  it('well-measured drivers → Grade B', () => {
    expect(computeEstimateGrade([q('measured', 0.8)]).grade).toBe('B')
    expect(computeEstimateGrade([q('adjudicated', 0.65)]).grade).toBe('B')
  })

  it('any envelope-based driver → Grade C, regardless of the others', () => {
    expect(computeEstimateGrade([q('confirmed', 1), q('envelope', 0.4)]).grade).toBe('C')
  })

  it('low measured confidence → Grade C even if nominally "measured"', () => {
    expect(computeEstimateGrade([q('measured', 0.35)]).grade).toBe('C')
  })

  it('grades carry customer-facing labels', () => {
    const result = computeEstimateGrade([q('measured', 0.8)])
    expect(result.label).toBe('Measured')
    expect(result.description).toContain('photos')
  })

  // T-128 (hardcore F6): placeholder ×1 quantities must never claim
  // "this price is exact"
  it('a defaulted quantity caps the grade at C regardless of everything else', () => {
    const result = computeEstimateGrade([q('confirmed', 1), q('defaulted', 0.2)])
    expect(result.grade).toBe('C')
  })

  it('untrusted-but-resolved quantities (AI operands) cap at B', () => {
    const result = computeEstimateGrade([q('confirmed', 1), q('measured', 0.7)])
    expect(result.grade).toBe('B')
  })
})

describe('isQuestionWorthAsking (M7 — ask where the money is)', () => {
  it('asks when the spread clears the absolute bar', () => {
    const voi = isQuestionWorthAsking({ priceAtLow: 1100, priceAtHigh: 1400, bestTotal: 1250 })
    expect(voi.ask).toBe(true)
    expect(voi.spread).toBe(300)
  })

  it('does not ask about pocket change', () => {
    const voi = isQuestionWorthAsking({ priceAtLow: 1240, priceAtHigh: 1280, bestTotal: 1250 })
    expect(voi.ask).toBe(false)
  })

  it('scales the bar with quote size — £200 spread on a £15k job is noise', () => {
    const voi = isQuestionWorthAsking({ priceAtLow: 14900, priceAtHigh: 15100, bestTotal: 15000 })
    expect(voi.ask).toBe(false) // bar = max(75, 1500) = 1500
  })

  it('small jobs still ask when the relative stake is real', () => {
    const voi = isQuestionWorthAsking({ priceAtLow: 160, priceAtHigh: 260, bestTotal: 210 })
    expect(voi.ask).toBe(true) // bar = max(75, 21) = 75; spread 100
  })
})

// Production test 2026-11-09: an AI-drafted AC replacement priced as five
// fixed amounts went out "Grade A, this price is exact" while the assessment
// said a site visit was needed. Grade A requires confirmed price drivers.
describe('flat-rate grade cap', () => {
  const fixed = (id: string) => ({ type: 'work_step', id, signalsUsed: [], quantitySource: 'constant' })
  const A = computeEstimateGrade([])

  it('all-fixed price + site visit recommended → B "Provisional"', () => {
    const trace = [fixed('demo'), fixed('coil'), fixed('condenser')]
    expect(priceDependsOnJobFacts(trace)).toBe(false)
    const r = capFlatRateGrade(A, { priceDependsOnJobFacts: false, siteVisitRecommended: true })
    expect(r.grade).toBe('B')
    expect(r.label).toBe('Provisional')
    expect(r.description).not.toMatch(/exact|measured/i)
  })

  it('all-fixed price with no site visit needed keeps A (flat rate is the price)', () => {
    expect(capFlatRateGrade(A, { priceDependsOnJobFacts: false, siteVisitRecommended: false }).grade).toBe('A')
  })

  it('a price driven by job facts is graded by provenance, not capped here', () => {
    const triggered = { type: 'work_step', id: 'ac_3_ton', signalsUsed: [{ key: 'ac_tonnage' }] }
    expect(priceDependsOnJobFacts([fixed('permit'), triggered])).toBe(true)
    expect(priceDependsOnJobFacts([fixed('permit'), { type: 'multiplier', signalsUsed: [] }])).toBe(true)
    expect(priceDependsOnJobFacts([{ type: 'work_step', quantitySource: 'form_field', signalsUsed: [] }])).toBe(true)
    expect(capFlatRateGrade(A, { priceDependsOnJobFacts: true, siteVisitRecommended: true }).grade).toBe('A')
  })

  it('a step chosen by a form answer or identified value is a job fact (no signals in its trace)', () => {
    const trace = [fixed('door_removal'), fixed('door_single')]
    expect(priceDependsOnJobFacts(trace)).toBe(false)
    expect(priceDependsOnJobFacts(trace, [{ id: 'door_single', when: { fieldId: 'door_size', operator: 'equals', equals: 'Single' } }])).toBe(true)
    expect(priceDependsOnJobFacts(trace, [{ id: 'door_single', triggerSignal: 'door_size' }])).toBe(true)
    expect(priceDependsOnJobFacts(trace, [{ id: 'door_removal' }, { id: 'door_single' }])).toBe(false)
  })

  it('a constant-quantity step tagged "constant" is still a fixed amount', () => {
    expect(priceDependsOnJobFacts([{ type: 'work_step', quantitySource: 'constant', signalsUsed: [{ key: 'constant' }] }])).toBe(false)
  })

  it('never upgrades a lower grade', () => {
    const C = computeEstimateGrade([{ signalKey: 'x', basis: 'envelope', confidence: 0.3 }])
    expect(capFlatRateGrade(C, { priceDependsOnJobFacts: false, siteVisitRecommended: true }).grade).toBe('C')
  })
})
