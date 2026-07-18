/**
 * Tests for the Measurement Engine M2+M3 (T-117 ensemble, T-118 anchored takeoff)
 * — apps/worker/src/ai/measurement.ts
 */

import { describe, it, expect } from 'vitest'
import {
  computeAnchoredValue,
  computeEnsembleStats,
  measureQuantities,
  type PassMeasurement,
} from '../ai/measurement'

const TARGET = { signalKey: 'wall_area_sqm', description: 'Paintable wall area', unit: 'sqm' }
const IMAGES = [{ mimeType: 'image/jpeg', base64: 'x' }]

function pass(overrides: Partial<PassMeasurement>): PassMeasurement {
  return { targetKey: 'wall_area_sqm', feasible: true, ...overrides }
}

describe('computeAnchoredValue (M2 geometry — code computes, AI compares)', () => {
  it('computes area from reference-unit components: 4×4 door-heights = 62.7 sqm', () => {
    const value = computeAnchoredValue('sqm', pass({
      referenceObject: 'entry_door_height',
      referenceDimensionM: 1.98,
      widthInRefUnits: 4,
      heightInRefUnits: 4,
    }))
    expect(value).toBe(62.7) // (4×1.98) × (4×1.98) = 7.92 × 7.92
  })

  it('prefers the anchored computation over the model direct value', () => {
    const value = computeAnchoredValue('sqm', pass({
      referenceDimensionM: 1.98,
      widthInRefUnits: 4,
      heightInRefUnits: 4,
      directValue: 200, // model's absolute guess — ignored when components exist
    }))
    expect(value).toBe(62.7)
  })

  it('falls back to directValue for counts and when components are missing', () => {
    expect(computeAnchoredValue('item', pass({ directValue: 12 }))).toBe(12)
    expect(computeAnchoredValue('sqm', pass({ directValue: 55 }))).toBe(55)
  })

  it('returns null when nothing usable was produced', () => {
    expect(computeAnchoredValue('sqm', pass({}))).toBeNull()
    expect(computeAnchoredValue('sqm', pass({ directValue: 0 }))).toBeNull()
  })
})

describe('computeEnsembleStats (M3 — variance IS the confidence)', () => {
  it('tight agreement → high measured confidence', () => {
    const stats = computeEnsembleStats([58, 60, 62])
    expect(stats.median).toBe(60)
    expect(stats.confidence).toBeGreaterThanOrEqual(0.8)
    expect(stats.spreadPct).toBeLessThanOrEqual(8)
  })

  it('wide disagreement → low measured confidence, regardless of what the model claims', () => {
    const stats = computeEnsembleStats([30, 60, 95])
    expect(stats.confidence).toBeLessThanOrEqual(0.6)
    expect(stats.cov).toBeGreaterThan(0.3)
  })

  it('a single usable pass is weak evidence', () => {
    const stats = computeEnsembleStats([60])
    expect(stats.confidence).toBe(0.5)
  })
})

describe('measureQuantities (full ensemble with injected passes)', () => {
  it('produces the median with measured confidence and anchored evidence', async () => {
    const passResults: PassMeasurement[][] = [
      [pass({ referenceObject: 'entry_door_height', referenceDimensionM: 1.98, widthInRefUnits: 4, heightInRefUnits: 4 })], // 62.7
      [pass({ referenceObject: 'entry_door_height', referenceDimensionM: 1.98, widthInRefUnits: 3.8, heightInRefUnits: 4 })], // 59.6
      [pass({ directValue: 58 })],
    ]
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [TARGET],
      passes: 3,
      runPass: async (i) => passResults[i]!,
    })

    expect(results).toHaveLength(1)
    const m = results[0]!
    expect(m.value).toBeGreaterThan(58)
    expect(m.value).toBeLessThan(63)
    expect(m.passesUsed).toBe(3)
    expect(m.confidence).toBeGreaterThanOrEqual(0.8) // tight spread
    expect(m.evidence).toContain('anchored to entry door height')
    expect(m.evidence).toContain('3 independent passes')
  })

  it('returns nothing for a target no pass could measure — envelope fallback takes over', async () => {
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [TARGET],
      passes: 3,
      runPass: async () => [pass({ feasible: false })],
    })
    expect(results).toHaveLength(0)
  })

  it('survives individual pass failures', async () => {
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [TARGET],
      passes: 3,
      runPass: async (i) => {
        if (i === 1) throw new Error('rate limited')
        return [pass({ directValue: 60 })]
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.passesUsed).toBe(2)
  })

  it('does nothing when there are no targets (no cost for most quotes)', async () => {
    let called = 0
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [],
      runPass: async () => {
        called++
        return []
      },
    })
    expect(results).toHaveLength(0)
    expect(called).toBe(0)
  })
})
