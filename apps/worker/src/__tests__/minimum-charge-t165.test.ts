/**
 * T-165 (worker): the minimum charge is a floor, not an item.
 *
 * It applies only when a job's own lines total less than the business's
 * minimum charge. Then the lines stay, and the difference is one entry of
 * the breakdown, marked as the minimum, so lines + entry = subtotal (T-157).
 * At the minimum or above it, nothing about a minimum is produced anywhere.
 *
 * AD-001: no total changes. Every case is checked against the rule written
 * out by hand: subtotal = the larger of the lines and the minimum.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { MINIMUM_ENTRY_KIND, MINIMUM_ENTRY_LABEL, isMinimumNote, roundMoney, splitMinimum } from '@qolumns/shared'
import type { ExtractedSignalsV2, PricingTrace } from '@qolumns/shared'
import {
  calculatePricingWithTrace,
  calculateCrossServicePricing,
  type PricingRules,
  type FormAnswer,
  type TaxConfig,
} from '../pricing/rules-engine'
import * as pricingIndex from '../pricing'
import { buildTakeoff } from '../takeoff'
import type { ExtractedSignals } from '../ai/signals'

afterEach(() => {
  vi.restoreAllMocks()
})

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
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Tax' }
const tax8: TaxConfig = { enabled: true, rate: 8, label: 'Sales tax' }

// "$375 per room, heavy prep adds $250"
const roomStep = {
  id: 'rooms',
  name: 'Rooms',
  description: 'Paint each room',
  costType: 'per_unit' as const,
  defaultCost: 375,
  optional: false,
  unitLabel: 'room',
  quantitySource: { type: 'form_field' as const, fieldId: 'room_count' },
}
const prepStep = {
  id: 'heavy_prep',
  name: 'Heavy prep',
  description: 'Fill and sand',
  costType: 'fixed' as const,
  defaultCost: 250,
  optional: false,
}
const rules = (over: Partial<PricingRules>): PricingRules => ({ baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [roomStep], ...over })
const price = (r: PricingRules, rooms: number, tax: TaxConfig = noTax) => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const answers: FormAnswer[] = [{ fieldId: 'room_count', value: rooms }]
  return calculatePricingWithTrace(r, signals(), structured(), answers, tax, 'USD')
}
const sum = (lines: Array<{ amount: number }>) => roundMoney(lines.reduce((s, l) => s + l.amount, 0))
const saysMinimum = (value: unknown) => /minimum/i.test(JSON.stringify(value))

describe('T-165: the main pricing path treats the minimum charge as a floor', () => {
  it('below the minimum: the job lines stay, and the difference is one entry marked as the minimum', () => {
    const { result, trace } = price(rules({ minimumCharge: 400 }), 1)
    // the real line is still there, with its own amount
    expect(result.breakdown[0]!.amount).toBe(375)
    expect(result.breakdown[0]!.label).toContain('Rooms')
    expect(result.breakdown[0]!.kind).toBeUndefined()
    // one entry, marked, carrying the top-up and the minimum it tops up to
    const marked = result.breakdown.filter((l) => l.kind === MINIMUM_ENTRY_KIND)
    expect(marked).toEqual([{ label: MINIMUM_ENTRY_LABEL, amount: 25, kind: 'minimum', minimumCharge: 400 }])
    // T-157: lines + the minimum entry = subtotal
    expect(sum(result.breakdown)).toBe(400)
    expect(result.subtotal).toBe(400)
    expect(result.total).toBe(400)
    expect(trace.summary.minimumApplied).toBe(true)
    // read back the way every page reads it
    expect(splitMinimum(result.breakdown)).toEqual({
      lines: [result.breakdown[0]],
      minimum: { topUp: 25, minimumCharge: 400 },
    })
    // the sentence is no longer repeated among the notes
    expect(result.notes.some((note) => isMinimumNote(note))).toBe(false)
  })

  it('equal to the minimum: nothing about a minimum, anywhere', () => {
    const { result, trace } = price(rules({ minimumCharge: 375 }), 1)
    expect(result.breakdown.map((l) => l.amount)).toEqual([375])
    expect(result.subtotal).toBe(375)
    expect(result.total).toBe(375)
    expect(trace.summary.minimumApplied).toBe(false)
    expect(trace.trace.some((step) => step.type === 'minimum')).toBe(false)
    expect(saysMinimum(result.breakdown)).toBe(false)
    expect(saysMinimum(result.notes)).toBe(false)
    expect(splitMinimum(result.breakdown).minimum).toBeNull()
  })

  it('above the minimum: nothing about a minimum, anywhere', () => {
    const { result, trace } = price(rules({ minimumCharge: 400, workSteps: [roomStep, prepStep] }), 2)
    expect(result.breakdown.map((l) => l.amount)).toEqual([750, 250])
    expect(result.subtotal).toBe(1000)
    expect(trace.summary.minimumApplied).toBe(false)
    expect(trace.trace.some((step) => step.type === 'minimum')).toBe(false)
    expect(saysMinimum(result.breakdown)).toBe(false)
    expect(saysMinimum(result.notes)).toBe(false)
    expect(splitMinimum(result.breakdown).minimum).toBeNull()
  })

  it('one cent either side of the boundary', () => {
    const justBelow = price(rules({ minimumCharge: 375.01 }), 1).result
    expect(splitMinimum(justBelow.breakdown).minimum).toEqual({ topUp: 0.01, minimumCharge: 375.01 })
    expect(justBelow.subtotal).toBe(375.01)
    const justAbove = price(rules({ minimumCharge: 374.99 }), 1).result
    expect(splitMinimum(justAbove.breakdown).minimum).toBeNull()
    expect(justAbove.subtotal).toBe(375)
  })

  it('AD-001: the subtotal, tax and total are what they always were (the larger of the lines and the minimum)', () => {
    for (const minimumCharge of [0, 100, 374.99, 375, 375.01, 400, 750.5, 2000]) {
      for (const rooms of [1, 2, 3]) {
        for (const tax of [noTax, tax8]) {
          const { result } = price(rules({ minimumCharge, workSteps: [roomStep, prepStep] }), rooms, tax)
          const lines = 375 * rooms + 250
          const subtotal = Math.max(lines, minimumCharge)
          const taxAmount = tax.enabled ? Math.round(subtotal * 0.08 * 100) / 100 : 0
          const at = `minimum ${minimumCharge}, ${rooms} room(s), tax ${tax.enabled}`
          expect(result.subtotal, at).toBe(subtotal)
          expect(result.taxAmount, at).toBe(taxAmount)
          expect(result.total, at).toBe(Math.round((subtotal + taxAmount) * 100) / 100)
          expect(sum(result.breakdown), at).toBe(subtotal)
        }
      }
    }
  })

  it('the takeoff has no row for the minimum: it is not something that was measured', () => {
    const { trace } = price(rules({ minimumCharge: 400 }), 1)
    const takeoff = buildTakeoff({ trace: trace as PricingTrace, structuredSignals: structured(), workSteps: [roomStep] })
    expect(takeoff.length).toBeGreaterThan(0)
    expect(saysMinimum(takeoff)).toBe(false)
  })
})

describe('T-165: the cross-service path behaves the same way', () => {
  const crossRules = (minimumCharge: number): PricingRules => ({
    baseFee: 50,
    minimumCharge,
    addons: [],
    multipliers: [],
    measurementModel: { type: 'per_unit', unit: null, unitLabel: 'windows', pricePerUnit: 20, askCustomerForQuantity: false },
  })
  const estimate = { serviceName: 'Window washing', estimatedQuantity: 10, quantityUnit: 'windows', extractedDetails: [], confidence: 0.9 }
  // the job's own lines come to 50 + 10 x 20 = 250

  it('below the minimum: the lines are kept, then the note; the total is the minimum', () => {
    const result = calculateCrossServicePricing(crossRules(400), estimate, noTax, 'USD')
    expect(result.estimatedTotal).toBe(400)
    expect(result.breakdown).toEqual(['Base fee: $50.00', '10 windows × $20.00', 'Minimum charge of $400.00 applied'])
  })

  it('equal to the minimum: no note', () => {
    const result = calculateCrossServicePricing(crossRules(250), estimate, noTax, 'USD')
    expect(result.estimatedTotal).toBe(250)
    expect(result.breakdown).toEqual(['Base fee: $50.00', '10 windows × $20.00'])
  })

  it('above the minimum: no note', () => {
    const result = calculateCrossServicePricing(crossRules(100), estimate, noTax, 'USD')
    expect(result.estimatedTotal).toBe(250)
    expect(saysMinimum(result.breakdown)).toBe(false)
  })

  it('AD-001: totals are the larger of the lines and the minimum, with tax on top', () => {
    for (const minimumCharge of [0, 249.99, 250, 250.01, 400]) {
      const subtotal = Math.max(250, minimumCharge)
      expect(calculateCrossServicePricing(crossRules(minimumCharge), estimate, noTax, 'USD').estimatedTotal).toBe(subtotal)
      expect(calculateCrossServicePricing(crossRules(minimumCharge), estimate, tax8, 'USD').estimatedTotal).toBe(Math.round(subtotal * 1.08 * 100) / 100)
    }
  })
})

describe('T-165: one way to apply a minimum', () => {
  it('the old calculator that deleted every line is gone', () => {
    expect('calculatePricing' in pricingIndex).toBe(false)
    const engine = readFileSync(join(__dirname, '../pricing/rules-engine.ts'), 'utf8')
    expect(engine).not.toMatch(/export function calculatePricing\(/)
    // the comparison lives in one shared place; the engine never compares to the minimum itself
    expect(engine).not.toMatch(/<\s*rules\.minimumCharge/)
    expect(engine.match(/minimumTopUp\(/g)?.length).toBe(2)
  })
})
