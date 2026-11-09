/** T-143: estimate accuracy against final invoices (pure stats). */
import { describe, it, expect } from 'vitest'
import { computeAccuracy, parseMoneyInput, ACCURACY_TARGETS } from '@estimator/shared'

const q = (serviceName: string, quoted: number, invoiced: number, grade: 'A' | 'B' | 'C' | null = null) => ({ serviceName, quoted, invoiced, grade })

describe('computeAccuracy', () => {
  it('median absolute error, share within ±10%, signed bias', () => {
    const r = computeAccuracy([
      q('AC', 1000, 1050, 'A'), // +5%
      q('AC', 1000, 1200, 'B'), // +20%
      q('AC', 1000, 900, 'A'), // −10% (inside the band)
      q('Paint', 2000, 2000, 'B'), // 0
    ])
    expect(r.overall).toMatchObject({ count: 4, medianAbsError: 0.075, withinTenPct: 0.75 })
    expect(r.byService.map((g) => [g.key, g.count, g.medianAbsError, g.medianBias])).toEqual([
      ['AC', 3, 0.1, 0.05],
      ['Paint', 1, 0, 0],
    ])
    expect(r.byGrade.map((g) => g.key)).toEqual(['Grade A', 'Grade B'])
    expect(r.targets).toEqual(ACCURACY_TARGETS)
  })

  it('ignores quotes with no quoted total; empty → no overall', () => {
    expect(computeAccuracy([q('X', 0, 500)]).overall).toBeNull()
    expect(computeAccuracy([]).byService).toEqual([])
  })
})

describe('parseMoneyInput', () => {
  it.each([
    ['2450', 2450],
    ['$2,450.50', 2450.5],
    ['1,234,567', 1234567],
    [10.126, 10.13],
    ['abc', null],
    ['-5', null],
    ['12.345', null],
    [null, null],
  ])('%j → %j', (raw, expected) => {
    expect(parseMoneyInput(raw)).toBe(expected)
  })
})
