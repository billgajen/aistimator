/**
 * Tests for plausibility envelopes (T-116, Measurement Engine M5)
 * — packages/shared/src/envelopes.ts
 *
 * The envelope is the deterministic sanity brain: it must have caught the
 * live £480 quote (1 sqm for a 3-storey front elevation) three ways.
 */

import { describe, it, expect } from 'vitest'
import {
  computeEnvelope,
  enforceEnvelope,
  coerceQuantity,
  type QuantityEnvelopeRule,
} from '@estimator/shared'

// The painting pack's exterior wall envelope: per storey, [4m×2.3m .. 12m×3.0m]
const WALL_RULE: QuantityEnvelopeRule = {
  driverKey: 'storeys',
  minPerUnit: 9,
  maxPerUnit: 36,
  defaultDriver: 2,
  absoluteMin: 8,
  absoluteMax: 500,
}

const knownStoreys = (n: number) => (key: string) => (key === 'storeys' ? n : undefined)

describe('coerceQuantity', () => {
  it('accepts numbers, numeric strings, and comma-separated strings', () => {
    expect(coerceQuantity(50)).toBe(50)
    expect(coerceQuantity('50')).toBe(50)
    expect(coerceQuantity('1,500')).toBe(1500)
  })
  it('rejects zero, negatives, and junk', () => {
    expect(coerceQuantity(0)).toBeNull()
    expect(coerceQuantity(-5)).toBeNull()
    expect(coerceQuantity('unknown')).toBeNull()
    expect(coerceQuantity(undefined)).toBeNull()
  })
})

describe('computeEnvelope', () => {
  it('scales bounds by the driver: 3 storeys → 27–108 sqm', () => {
    const env = computeEnvelope(WALL_RULE, knownStoreys(3))
    expect(env.min).toBe(27)
    expect(env.max).toBe(108)
    expect(env.mid).toBeGreaterThan(env.min)
    expect(env.mid).toBeLessThan(env.max)
  })

  it('uses defaultDriver when the driver is unknown', () => {
    const env = computeEnvelope(WALL_RULE, () => undefined)
    expect(env.min).toBe(18) // 2 storeys × 9
    expect(env.max).toBe(72)
  })

  it('respects absolute bounds', () => {
    const env = computeEnvelope(WALL_RULE, knownStoreys(100))
    expect(env.max).toBe(500) // capped by absoluteMax
  })
})

describe('enforceEnvelope — the £480 quote dies three ways', () => {
  const env3storeys = computeEnvelope(WALL_RULE, knownStoreys(3))

  it('way 1: quantity 1 (the live bug) is clamped as implausible', () => {
    const finding = enforceEnvelope('wall_area_sqm', 1, env3storeys)
    expect(finding.action).toBe('clamped')
    expect(finding.effectiveValue).toBe(27) // clamped to plausible floor
  })

  it('way 2: a MISSING measurement gets the envelope midpoint, never nothing', () => {
    const finding = enforceEnvelope('wall_area_sqm', undefined, env3storeys)
    expect(finding.action).toBe('fallback_injected')
    expect(finding.effectiveValue).toBeGreaterThanOrEqual(env3storeys.min)
    expect(finding.effectiveValue).toBeLessThanOrEqual(env3storeys.max)
  })

  it('way 3: an absurd high reading (photo of the wrong thing) is clamped', () => {
    const finding = enforceEnvelope('wall_area_sqm', 2000, env3storeys)
    expect(finding.action).toBe('clamped')
    expect(finding.effectiveValue).toBe(108)
  })

  it('a plausible measurement passes through untouched', () => {
    const finding = enforceEnvelope('wall_area_sqm', 60, env3storeys)
    expect(finding.action).toBe('accepted')
    expect(finding.effectiveValue).toBe(60)
  })

  it('string-typed measurements are coerced before evaluation', () => {
    const finding = enforceEnvelope('wall_area_sqm', '60', env3storeys)
    expect(finding.action).toBe('accepted')
    expect(finding.effectiveValue).toBe(60)
  })
})
