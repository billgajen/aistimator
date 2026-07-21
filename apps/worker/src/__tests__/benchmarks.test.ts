/**
 * Tests for cross-tenant rate benchmarks (T-115) — packages/shared/src/benchmarks.ts
 *
 * The k-anonymity guard and per-tenant deduplication are privacy-critical:
 * they must hold under adversarial shapes (few tenants, one tenant with many
 * steps, unit-label variants).
 */

import { describe, it, expect } from 'vitest'
import {
  computeBenchmarks,
  normalizeUnitLabel,
  serviceTokens,
  MIN_BENCHMARK_TENANTS,
  type BenchmarkRateInput,
} from '@estimator/shared'

const MY_PAINTING = {
  serviceId: 'svc_1',
  serviceName: 'Exterior Painting',
  steps: [{ unitLabel: 'sqm', rate: 18 }],
}

function otherRate(tenantId: string, rate: number, overrides: Partial<BenchmarkRateInput> = {}): BenchmarkRateInput {
  return { tenantId, serviceName: 'Exterior Painting', unitLabel: 'sqm', rate, ...overrides }
}

describe('normalizeUnitLabel', () => {
  it('unifies square-metre variants', () => {
    expect(normalizeUnitLabel('sqm')).toBe('sqm')
    expect(normalizeUnitLabel('sq m')).toBe('sqm')
    expect(normalizeUnitLabel('Square Metre')).toBe('sqm')
    expect(normalizeUnitLabel('m2')).toBe('sqm')
  })

  it('unifies rooms/hours', () => {
    expect(normalizeUnitLabel('rooms')).toBe('room')
    expect(normalizeUnitLabel('hrs'.replace('s', ''))).toBe('hour')
  })
})

describe('serviceTokens', () => {
  it('drops stopwords and short tokens', () => {
    const tokens = serviceTokens('Full Exterior Painting Service')
    expect(tokens.has('exterior')).toBe(true)
    expect(tokens.has('painting')).toBe(true)
    expect(tokens.has('full')).toBe(false)
    expect(tokens.has('service')).toBe(false)
  })
})

describe('computeBenchmarks', () => {
  it('produces a benchmark when enough distinct tenants share comparable rates', () => {
    const others = [
      otherRate('t1', 15),
      otherRate('t2', 20),
      otherRate('t3', 22),
      otherRate('t4', 17),
    ]
    const result = computeBenchmarks([MY_PAINTING], others)
    expect(result).toHaveLength(1)
    const b = result[0]!
    expect(b.unit).toBe('sqm')
    expect(b.sampleTenants).toBe(4)
    expect(b.yourRate).toBe(18)
    expect(b.p25).toBeGreaterThanOrEqual(15)
    expect(b.p75).toBeLessThanOrEqual(22)
    expect(b.median).toBeGreaterThan(b.p25)
  })

  it('enforces k-anonymity: no benchmark below MIN_BENCHMARK_TENANTS distinct tenants', () => {
    const others = [otherRate('t1', 15), otherRate('t2', 20)]
    expect(others.length).toBeLessThan(MIN_BENCHMARK_TENANTS)
    expect(computeBenchmarks([MY_PAINTING], others)).toHaveLength(0)
  })

  it('counts one tenant once even with many similar steps (no skew, no k-anonymity bypass)', () => {
    const others = [
      otherRate('t1', 15),
      otherRate('t1', 16),
      otherRate('t1', 17),
      otherRate('t2', 20),
    ]
    // Only 2 distinct tenants → below k threshold despite 4 rates
    expect(computeBenchmarks([MY_PAINTING], others)).toHaveLength(0)
  })

  it('matches unit-label variants across tenants', () => {
    const others = [
      otherRate('t1', 15, { unitLabel: 'sq m' }),
      otherRate('t2', 20, { unitLabel: 'square metre' }),
      otherRate('t3', 22, { unitLabel: 'm2' }),
    ]
    expect(computeBenchmarks([MY_PAINTING], others)).toHaveLength(1)
  })

  it('excludes services with no overlapping name tokens', () => {
    const others = [
      otherRate('t1', 15, { serviceName: 'Gutter Cleaning' }),
      otherRate('t2', 20, { serviceName: 'Roof Repairs' }),
      otherRate('t3', 22, { serviceName: 'Window Cleaning' }),
    ]
    expect(computeBenchmarks([MY_PAINTING], others)).toHaveLength(0)
  })

  it('excludes different units even for the same trade', () => {
    const others = [
      otherRate('t1', 200, { unitLabel: 'room' }),
      otherRate('t2', 220, { unitLabel: 'room' }),
      otherRate('t3', 210, { unitLabel: 'room' }),
    ]
    // My step is per sqm; their per-room rates must not benchmark against it
    expect(computeBenchmarks([MY_PAINTING], others)).toHaveLength(0)
  })

  it('ignores zero/negative rates on both sides', () => {
    const mine = { ...MY_PAINTING, steps: [{ unitLabel: 'sqm', rate: 0 }] }
    const others = [otherRate('t1', 15), otherRate('t2', 20), otherRate('t3', 22)]
    expect(computeBenchmarks([mine], others)).toHaveLength(0)

    const withBadOthers = [otherRate('t1', 0), otherRate('t2', -5), otherRate('t3', 22)]
    expect(computeBenchmarks([MY_PAINTING], withBadOthers)).toHaveLength(0)
  })
})
