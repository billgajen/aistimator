/**
 * Tests for estimate grading + VOI (T-120/T-121, Measurement Engine M6+M7)
 * — packages/shared/src/grading.ts
 */

import { describe, it, expect } from 'vitest'
import {
  computeEstimateGrade,
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
