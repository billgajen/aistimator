/**
 * Tests for the Measurement Engine M2+M3 (T-117 ensemble, T-118 anchored takeoff)
 * — apps/worker/src/ai/measurement.ts
 */

import { describe, it, expect } from 'vitest'
import {
  computeAnchoredValue,
  computeEnsembleStats,
  measureQuantities,
  decideAdjudication,
  adjudicateMeasurement,
  computeCalibrationFactor,
  buildMeasurementSystemPrompt,
  type PassMeasurement,
} from '../ai/measurement'
import { US_REGION } from '@estimator/shared'

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
      earlyStopCov: 0, // force the full ensemble
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

  it('runs passes in parallel and cancels the third when the first two agree', async () => {
    const started: number[] = []
    let thirdAborted = false
    const delays = [10, 20, 500]
    const values = [60, 61, 200]
    const t0 = Date.now()
    const timings: number[] = []
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [TARGET],
      passes: 3,
      passTimingsMs: timings,
      runPass: (i, signal) => {
        started.push(i)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve([pass({ directValue: values[i] })]), delays[i])
          signal?.addEventListener('abort', () => {
            if (i === 2) thirdAborted = true
            clearTimeout(timer)
            reject(new Error('aborted'))
          })
        })
      },
    })
    expect(started).toEqual([0, 1, 2]) // all launched before any finished
    expect(Date.now() - t0).toBeLessThan(400) // did not wait for the slow third
    expect(thirdAborted).toBe(true)
    expect(results[0]!.passesUsed).toBe(2)
    expect(results[0]!.value).toBe(60.5)
    expect(timings).toHaveLength(2)
  })

  it('waits for the third pass when the first two disagree', async () => {
    const values = [40, 80, 62]
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [TARGET],
      passes: 3,
      runPass: (i) => new Promise((resolve) => setTimeout(() => resolve([pass({ directValue: values[i] })]), [5, 10, 30][i])),
    })
    expect(results[0]!.passesUsed).toBe(3)
    expect(results[0]!.value).toBe(62)
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

describe('T-119: stakes-based adjudication routing', () => {
  const base = { cov: 0.05, passesUsed: 3, provisionalValue: 400 }

  it('does not escalate tight, cheap, well-evidenced measurements', () => {
    expect(decideAdjudication(base).shouldAdjudicate).toBe(false)
  })

  it('escalates high variance', () => {
    const d = decideAdjudication({ ...base, cov: 0.25 })
    expect(d).toEqual({ shouldAdjudicate: true, reason: 'high_variance' })
  })

  it('escalates single-pass evidence', () => {
    const d = decideAdjudication({ ...base, passesUsed: 1 })
    expect(d).toEqual({ shouldAdjudicate: true, reason: 'single_pass' })
  })

  it('escalates when real money rides on the number', () => {
    const d = decideAdjudication({ ...base, provisionalValue: 3000 })
    expect(d).toEqual({ shouldAdjudicate: true, reason: 'high_stakes' })
  })

  it('does not escalate agreeing passes on a typical-value line (speed, 2026-11-08)', () => {
    expect(decideAdjudication({ ...base, provisionalValue: 1500 })).toEqual({ shouldAdjudicate: false })
    // …but disagreement still escalates at any value
    expect(decideAdjudication({ ...base, cov: 0.3, provisionalValue: 200 }).reason).toBe('high_variance')
  })
})

describe('T-119: adjudicateMeasurement', () => {
  const measured = {
    signalKey: 'wall_area_sqm',
    value: 21.8,
    confidence: 0.8,
    cov: 0.08,
    passesUsed: 2,
    evidence: 'Measured across 2 independent passes',
    band: { low: 20, high: 23.6 },
    basis: 'measured' as const,
    rawPasses: [
      { value: 21.5, entry: { targetKey: 'wall_area_sqm', feasible: true, reasoning: 'measured left elevation only' } },
      { value: 22.1, entry: { targetKey: 'wall_area_sqm', feasible: true, reasoning: 'rendered section only' } },
    ],
  }

  it('replaces the ensemble value with the senior resolution and band-derived confidence', async () => {
    const result = await adjudicateMeasurement({
      adjudicator: null,
      images: IMAGES,
      target: TARGET,
      measured,
      run: async () => ({
        finalValue: 58,
        lowValue: 52,
        highValue: 64,
        scopeResolution: 'Juniors measured only the rendered section; target includes both visible elevations',
      }),
    })
    expect(result).not.toBeNull()
    expect(result!.value).toBe(58)
    expect(result!.confidence).toBeGreaterThanOrEqual(0.65) // ±10% band
    expect(result!.evidence).toContain('Senior review')
    expect(result!.evidence).toContain('both visible elevations')
    expect(result!.evidence).toContain('52-64')
  })

  it('returns null on failure — the ensemble value stands, never blocks', async () => {
    const result = await adjudicateMeasurement({
      adjudicator: null,
      images: IMAGES,
      target: TARGET,
      measured,
      run: async () => {
        throw new Error('model unavailable')
      },
    })
    expect(result).toBeNull()
  })

  it('rejects nonsense adjudications (zero/negative)', async () => {
    const result = await adjudicateMeasurement({
      adjudicator: null,
      images: IMAGES,
      target: TARGET,
      measured,
      run: async () => ({ finalValue: 0, lowValue: 0, highValue: 0, scopeResolution: 'n/a' }),
    })
    expect(result).toBeNull()
  })
})

describe('T-123: measurement memory calibration', () => {
  const ex = (measured: number, confirmed: number) => ({ measured, confirmed })

  it('learns a consistent under-measurement bias from confirmed jobs', () => {
    // AI consistently measures ~20% low
    const result = computeCalibrationFactor([ex(50, 60), ex(40, 49), ex(33, 40), ex(55, 65)])
    expect(result).not.toBeNull()
    expect(result!.factor).toBeGreaterThan(1.15)
    expect(result!.factor).toBeLessThan(1.3)
    expect(result!.sample).toBe(4)
  })

  it('requires at least 3 confirmed examples', () => {
    expect(computeCalibrationFactor([ex(50, 60), ex(40, 50)])).toBeNull()
  })

  it('treats near-1.0 factors as noise — no correction', () => {
    expect(computeCalibrationFactor([ex(50, 51), ex(40, 40), ex(60, 59)])).toBeNull()
  })

  it('clamps extreme factors for safety', () => {
    const result = computeCalibrationFactor([ex(10, 100), ex(10, 90), ex(10, 110)])
    expect(result!.factor).toBe(2) // clamped, never 10x
  })

  it('ignores junk examples (zero/negative)', () => {
    expect(computeCalibrationFactor([ex(0, 60), ex(-5, 50), ex(50, 60)])).toBeNull()
  })
})

describe('T-133 region-driven measurement', () => {
  it('converts the anchored metric area into a sqft target', () => {
    // 4×4 US door heights (2.032 m): 8.128 m × 8.128 m = 66.06 sqm = 711.1 sq ft
    const value = computeAnchoredValue('sqft', pass({
      referenceObject: 'entry_door_height',
      referenceDimensionM: 2.032,
      widthInRefUnits: 4,
      heightInRefUnits: 4,
    }))
    expect(value).toBe(711.1)
  })

  it('uses the region table size, not the size the model reported', async () => {
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [{ signalKey: 'wall_area_sqft', description: 'Paintable wall area', unit: 'sqft' }],
      passes: 1,
      referenceObjects: US_REGION.referenceObjects,
      runPass: async () => [
        {
          targetKey: 'wall_area_sqft',
          feasible: true,
          referenceObject: 'entry_door_height',
          referenceDimensionM: 1.98, // model quoted the UK size — code must ignore it
          widthInRefUnits: 4,
          heightInRefUnits: 4,
        },
      ],
    })
    expect(results[0]?.value).toBe(711.1)
  })

  it('keeps the legacy GB table when no region table is passed', async () => {
    const results = await measureQuantities({
      gemini: null,
      images: IMAGES,
      targets: [TARGET],
      passes: 1,
      runPass: async () => [
        pass({ referenceObject: 'entry_door_height', referenceDimensionM: 2.5, widthInRefUnits: 4, heightInRefUnits: 4 }),
      ],
    })
    expect(results[0]?.value).toBe(62.7) // 1.98 m GB door, as before T-133
  })

  it('puts the region reference table into the system prompt', () => {
    const prompt = buildMeasurementSystemPrompt(US_REGION.referenceObjects)
    expect(prompt).toContain('80 in')
    expect(prompt).toContain('garage_door_height')
  })
})
