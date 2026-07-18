/**
 * Tests for the quantity takeoff builder (T-122) — apps/worker/src/takeoff.ts
 */

import { describe, it, expect } from 'vitest'
import { buildTakeoff, buildReference } from '../takeoff'
import type { PricingTrace, ExtractedSignalsV2, WorkStepConfig } from '@estimator/shared'

const WORK_STEPS: WorkStepConfig[] = [
  {
    id: 'step_walls_sqm',
    name: 'Exterior walls',
    description: 'Per sqm',
    costType: 'per_unit',
    defaultCost: 18,
    optional: false,
    unitLabel: 'sqm',
    quantitySource: { type: 'ai_signal', signalKey: 'wall_area_sqm' },
  },
  {
    id: 'step_access',
    name: 'Access equipment',
    description: 'Towers',
    costType: 'fixed',
    defaultCost: 250,
    optional: true,
  },
]

const SIGNALS: ExtractedSignalsV2 = {
  extractedAt: new Date().toISOString(),
  overallConfidence: 0.8,
  signals: [
    {
      key: 'wall_area_sqm',
      value: 32.5,
      confidence: 0.65,
      source: 'vision',
      evidence: 'Senior review of 2 takeoffs: included the garage elevation (plausible 25-40 sqm)',
    },
  ],
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
}

function trace(steps: PricingTrace['trace']): PricingTrace {
  return {
    calculatedAt: new Date().toISOString(),
    configVersion: 'v1',
    trace: steps,
    summary: {
      baseFee: 100, workStepsTotal: 835, addonsTotal: 0,
      multiplierAdjustment: 0, minimumApplied: false, taxAmount: 187, total: 1122,
    },
  }
}

describe('buildReference', () => {
  it('produces a stable human-facing reference from the quote id', () => {
    expect(buildReference('qte_d325198187f9e3a03e5110bd', 2026)).toBe('EST-2026-5110BD')
  })
})

describe('buildTakeoff', () => {
  it('surfaces the measurement evidence as the method for AI-measured quantities', () => {
    const entries = buildTakeoff({
      trace: trace([
        { type: 'base_fee', description: 'Base service fee', signalsUsed: [], calculation: '', amount: 100, runningTotal: 100 },
        {
          type: 'work_step', id: 'step_walls_sqm', description: 'Exterior walls',
          signalsUsed: [{ key: 'wall_area_sqm', value: 32.5 }],
          calculation: '32.5 sqm × 18/sqm', amount: 585, runningTotal: 685,
          quantitySource: 'ai_signal', quantityTrusted: false,
        },
        {
          type: 'work_step', id: 'step_access', description: 'Access equipment',
          signalsUsed: [], calculation: 'Fixed: 250', amount: 250, runningTotal: 935,
        },
      ]),
      structuredSignals: SIGNALS,
      workSteps: WORK_STEPS,
    })

    expect(entries).toHaveLength(3)
    expect(entries[0]!.method).toContain('Standard charge')

    const walls = entries[1]!
    expect(walls.item).toBe('Exterior walls')
    expect(walls.quantity).toBe(32.5)
    expect(walls.unit).toBe('sqm')
    expect(walls.rate).toBe(18)
    // The senior audit note faces the customer
    expect(walls.method).toContain('Senior review')
    expect(walls.method).toContain('garage')

    expect(entries[2]!.quantity).toBeUndefined() // fixed step — no quantity line
  })

  it('labels customer-provided quantities honestly', () => {
    const entries = buildTakeoff({
      trace: trace([
        {
          type: 'work_step', id: 'step_walls_sqm', description: 'Exterior walls',
          signalsUsed: [{ key: 'wall_area_sqm', value: 60 }],
          calculation: '', amount: 1080, runningTotal: 1080,
          quantitySource: 'form_field', quantityTrusted: true,
        },
      ]),
      structuredSignals: SIGNALS,
      workSteps: WORK_STEPS,
    })
    expect(entries[0]!.method).toBe('Quantity provided by you')
  })

  it('skips zero-amount lines and excludes tax', () => {
    const entries = buildTakeoff({
      trace: trace([
        { type: 'work_step', id: 'step_access', description: 'Access equipment', signalsUsed: [], calculation: '', amount: 0, runningTotal: 100 },
        { type: 'tax', description: 'VAT', signalsUsed: [], calculation: '', amount: 187, runningTotal: 1122 },
      ]),
      structuredSignals: SIGNALS,
      workSteps: WORK_STEPS,
    })
    expect(entries).toHaveLength(0)
  })
})
