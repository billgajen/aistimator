/**
 * R2-6: keyword addons must not charge on mere mention ("I have logo files").
 * R2-7: mutually-exclusive-looking steps that all priced must be detectable.
 */

import { describe, it, expect } from 'vitest'
import {
  calculatePricingWithTrace,
  findLookalikeUnconditionedSteps,
  type PricingRules,
  type TaxConfig,
} from './rules-engine'
import type { ExtractedSignalsV2, WorkStepConfig } from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

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

const noTax: TaxConfig = { enabled: false, rate: 0, label: 'VAT' }

const logoRules = (): PricingRules => ({
  baseFee: 100,
  minimumCharge: 0,
  addons: [{ id: 'logo_design', label: 'Logo Design', price: 320, triggerKeywords: ['logo'] }],
  multipliers: [],
  workSteps: [],
})

const price = (rules: PricingRules, description: string, aiRan: boolean) =>
  calculatePricingWithTrace(
    rules, signals(), structured(), [], noTax, 'GBP', undefined,
    { projectDescription: description, formAnswers: [] },
    undefined, undefined, 'v1', aiRan
  )

describe('R2-6: keyword addons — mention is not need', () => {
  it('defers entirely to AI detection when it ran (AI declined "I have logo files" -> no charge)', () => {
    const { result } = price(logoRules(), 'I need a website. I have logo files and photos ready to use.', true)
    expect(result.subtotal).toBe(100) // AI ran and did not detect -> keyword must not charge
  })

  it('keyword fallback still works when AI detection did not run', () => {
    const { result } = price(logoRules(), 'I need a website and also want a new logo designed.', false)
    expect(result.subtotal).toBe(420)
  })
})

describe('R2-7: look-alike unconditioned steps', () => {
  const step = (id: string, name: string, extra: Partial<WorkStepConfig> = {}): WorkStepConfig => ({
    id, name, description: '', costType: 'fixed', defaultCost: 400, optional: false, ...extra,
  })

  it('flags the S27 tutoring pair', () => {
    const steps = [
      step('online', 'Online Tutoring (Block of 10 Hours)'),
      step('inhome', 'In-home Tutoring (Block of 10 Hours)'),
    ]
    const pairs = findLookalikeUnconditionedSteps(steps, new Set(['online', 'inhome']))
    expect(pairs).toHaveLength(1)
  })

  it('does not flag when the alternatives are when-bound (correct compile)', () => {
    const steps = [
      step('online', 'Online Tutoring (Block of 10 Hours)', { when: { fieldId: 'mode', operator: 'equals', equals: 'online' } }),
      step('inhome', 'In-home Tutoring (Block of 10 Hours)', { when: { fieldId: 'mode', operator: 'equals', equals: 'in_home' } }),
    ]
    expect(findLookalikeUnconditionedSteps(steps, new Set(['online', 'inhome']))).toHaveLength(0)
  })

  it('does not flag genuinely distinct steps (wall vs floor tiling)', () => {
    const steps = [step('wall', 'Wall tiling'), step('floor', 'Floor tiling')]
    expect(findLookalikeUnconditionedSteps(steps, new Set(['wall', 'floor']))).toHaveLength(0)
  })

  it('flags per-hour alternatives sharing one quantity field (the second S27 evasion)', () => {
    const steps: WorkStepConfig[] = [
      { id: 'online', name: 'Online Tutoring (per hour)', description: '', costType: 'per_hour', defaultCost: 42, optional: true, quantitySource: { type: 'form_field', fieldId: 'num_hours' } },
      { id: 'inhome', name: 'In-home Tutoring (per hour)', description: '', costType: 'per_hour', defaultCost: 55, optional: true, quantitySource: { type: 'form_field', fieldId: 'num_hours' } },
    ]
    expect(findLookalikeUnconditionedSteps(steps, new Set(['online', 'inhome']))).toHaveLength(1)
  })

  it('does not flag tier splits sharing a field via derived formulas', () => {
    const steps: WorkStepConfig[] = [
      { id: 'first', name: 'Slate replacement (first 10)', description: '', costType: 'per_unit', defaultCost: 45, optional: false, quantitySource: { type: 'derived', formula: 'min(num_slates, 10)' } },
      { id: 'beyond', name: 'Slate replacement (beyond first 10)', description: '', costType: 'per_unit', defaultCost: 30, optional: false, quantitySource: { type: 'derived', formula: 'max(0, num_slates - 10)' } },
    ]
    expect(findLookalikeUnconditionedSteps(steps, new Set(['first', 'beyond']))).toHaveLength(0)
  })

  it('does not flag unrelated steps sharing a guest-count field', () => {
    const steps: WorkStepConfig[] = [
      { id: 'menu', name: 'Three-course seated menu', description: '', costType: 'per_unit', defaultCost: 62, optional: false, quantitySource: { type: 'form_field', fieldId: 'num_guests' } },
      { id: 'setup', name: 'Venue chair hire', description: '', costType: 'per_unit', defaultCost: 3, optional: false, quantitySource: { type: 'form_field', fieldId: 'num_guests' } },
    ]
    expect(findLookalikeUnconditionedSteps(steps, new Set(['menu', 'setup']))).toHaveLength(0)
  })

  it('only considers steps that actually priced', () => {
    const steps = [
      step('online', 'Online Tutoring (Block of 10 Hours)'),
      step('inhome', 'In-home Tutoring (Block of 10 Hours)'),
    ]
    expect(findLookalikeUnconditionedSteps(steps, new Set(['online']))).toHaveLength(0)
  })
})
