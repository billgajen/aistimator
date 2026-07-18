/**
 * Tests for outcome calibration (T-110) — packages/shared/src/calibration.ts
 *
 * The suggestion rules are the "moat" math: they must only fire on real,
 * consistent patterns and never on noise.
 */

import { describe, it, expect } from 'vitest'
import {
  calibrateService,
  computeCalibration,
  type CalibrationQuoteInput,
  type CalibrationAmendmentInput,
} from '@estimator/shared'

const SVC = 'svc_1'

function quotes(statuses: string[], total = 500): CalibrationQuoteInput[] {
  return statuses.map((status) => ({ serviceId: SVC, status, total }))
}

function amendments(deltasPct: number[], base = 1000): CalibrationAmendmentInput[] {
  return deltasPct.map((d) => ({
    serviceId: SVC,
    beforeTotal: base,
    afterTotal: base * (1 + d / 100),
  }))
}

describe('calibrateService', () => {
  it('suggests raising rates on consistent upward amendments', () => {
    const result = calibrateService(SVC, 'Interior Painting', [], amendments([15, 12, 18, 14]))
    expect(result.medianDeltaPct).toBeCloseTo(14.5, 1)
    const suggestion = result.suggestions.find((s) => s.type === 'raise_rates')
    expect(suggestion).toBeDefined()
    expect(suggestion!.suggestedAction).toContain('Increase all my rates')
    expect(suggestion!.suggestedAction).toContain('Interior Painting')
  })

  it('suggests lowering rates on consistent downward amendments', () => {
    const result = calibrateService(SVC, 'Painting', [], amendments([-10, -8, -12]))
    expect(result.suggestions.some((s) => s.type === 'lower_rates')).toBe(true)
  })

  it('stays silent below the minimum amendment count', () => {
    const result = calibrateService(SVC, 'Painting', [], amendments([20, 25]))
    expect(result.medianDeltaPct).toBeNull()
    expect(result.suggestions).toHaveLength(0)
  })

  it('stays silent when direction is inconsistent', () => {
    const result = calibrateService(SVC, 'Painting', [], amendments([15, -12, 18, -14]))
    expect(result.suggestions.some((s) => s.type === 'raise_rates' || s.type === 'lower_rates')).toBe(false)
  })

  it('stays silent when the median delta is noise (<5%)', () => {
    const result = calibrateService(SVC, 'Painting', [], amendments([2, 3, 2, 4]))
    expect(result.suggestions).toHaveLength(0)
  })

  it('ignores amendments with zero beforeTotal', () => {
    const broken: CalibrationAmendmentInput[] = [
      { serviceId: SVC, beforeTotal: 0, afterTotal: 500 },
      { serviceId: SVC, beforeTotal: 0, afterTotal: 300 },
      { serviceId: SVC, beforeTotal: 0, afterTotal: 200 },
    ]
    const result = calibrateService(SVC, 'Painting', [], broken)
    expect(result.amendedCount).toBe(0)
    expect(result.suggestions).toHaveLength(0)
  })

  it('flags low acceptance when enough quotes were sent', () => {
    const result = calibrateService(
      SVC,
      'Painting',
      quotes(['sent', 'sent', 'viewed', 'sent', 'viewed', 'accepted']),
      []
    )
    expect(result.acceptanceRatePct).toBe(17)
    expect(result.suggestions.some((s) => s.type === 'price_check')).toBe(true)
  })

  it('does not double-flag price when rates already suggested lower', () => {
    const result = calibrateService(
      SVC,
      'Painting',
      quotes(['sent', 'sent', 'sent', 'sent', 'viewed', 'accepted']),
      amendments([-10, -9, -11])
    )
    expect(result.suggestions.some((s) => s.type === 'lower_rates')).toBe(true)
    expect(result.suggestions.some((s) => s.type === 'price_check')).toBe(false)
  })

  it('withholds acceptance rate below the minimum sample', () => {
    const result = calibrateService(SVC, 'Painting', quotes(['sent', 'viewed']), [])
    expect(result.acceptanceRatePct).toBeNull()
    expect(result.suggestions.some((s) => s.type === 'price_check')).toBe(false)
  })

  it('flags heavy review burden', () => {
    const result = calibrateService(
      SVC,
      'Painting',
      quotes(['pending_review', 'pending_review', 'pending_review', 'sent', 'sent', 'pending_review']),
      []
    )
    expect(result.suggestions.some((s) => s.type === 'review_burden')).toBe(true)
  })
})

describe('computeCalibration', () => {
  it('sorts services with suggestions first and isolates per-service data', () => {
    const services = [
      { id: 'svc_quiet', name: 'Quiet Service' },
      { id: 'svc_busy', name: 'Busy Service' },
    ]
    const amendmentData: CalibrationAmendmentInput[] = [
      { serviceId: 'svc_busy', beforeTotal: 100, afterTotal: 120 },
      { serviceId: 'svc_busy', beforeTotal: 100, afterTotal: 115 },
      { serviceId: 'svc_busy', beforeTotal: 100, afterTotal: 125 },
    ]
    const result = computeCalibration(services, [], amendmentData)
    expect(result[0]!.serviceId).toBe('svc_busy')
    expect(result[0]!.suggestions.length).toBeGreaterThan(0)
    expect(result[1]!.serviceId).toBe('svc_quiet')
    expect(result[1]!.amendedCount).toBe(0)
  })
})
