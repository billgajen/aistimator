/**
 * T-204, item 1: a line a business made conditional follows the customer's answers.
 *
 * The first block is the ticket's proof: the AC Tune-Up service exactly as "Describe your pricing"
 * compiled it for the test business, priced by the rules engine. The live compile was right and so
 * was the one live quote; what showed every line as charged was the dashboard's own copy of the
 * maths on "Test & Publish", which now asks this engine instead (preview-pricing.ts).
 *
 * The second block is the rule that is new in the engine: an optional number question left empty
 * counts as 0, never 1, and neither does a typed 0.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compareAnswerValue, coerceToNumber, optionalNumberQuestions } from '@qolumns/shared'
import type { ExtractedSignalsV2 } from '@qolumns/shared'
import { calculatePricingWithTrace, type FormAnswer, type PricingRules, type TaxConfig } from '../pricing/rules-engine'
import type { ExtractedSignals } from '../ai/signals'
import { evaluateQualityGate } from '../agents/quality-gate'
import { AC_TUNE_UP_CASES, AC_TUNE_UP_FIELDS, AC_TUNE_UP_STEPS } from '../../../../scripts/hardcore-test/t204/ac-tune-up'

const root = resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

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
const structured = (): ExtractedSignalsV2 => ({ extractedAt: new Date().toISOString(), overallConfidence: 0.95, signals: [], complexity: { level: 'medium', factors: [] }, siteVisitRecommended: false, lowConfidenceSignals: [] })
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Sales tax' }
type Step = NonNullable<PricingRules['workSteps']>[number]
const rulesOf = (workSteps: readonly unknown[]): PricingRules => ({ baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: workSteps as Step[] })
const answersOf = (values: Record<string, string | number | boolean>): FormAnswer[] => Object.entries(values).map(([fieldId, value]) => ({ fieldId, value }))

type Field = { fieldId: string; type: string; required?: boolean; criticalForPricing?: boolean; label?: string }
function price(workSteps: readonly unknown[], values: Record<string, string | number | boolean>, fields: readonly Field[] = []) {
  const { result, trace } = calculatePricingWithTrace(rulesOf(workSteps), signals(), structured(), answersOf(values), noTax, 'USD', undefined, undefined, undefined, { name: 'Service under test', fields: fields as never })
  return { subtotal: result.subtotal, labels: result.breakdown.map((line) => line.label), amounts: result.breakdown.map((line) => line.amount), trace: trace.trace, unanswered: result.unansweredOptional ?? [] }
}

describe('T-204 item 1: AC Tune-Up, as compiled for the test business, priced by the engine', () => {
  for (const proof of AC_TUNE_UP_CASES) {
    it(`${proof.what}: $${proof.subtotal}`, () => {
      expect(price(AC_TUNE_UP_STEPS, proof.answers, AC_TUNE_UP_FIELDS).subtotal).toBe(proof.subtotal)
    })
  }

  it('the answers as the customer’s form sends them (a choice by its key, lower case) price the same', () => {
    // the one live request: 2 systems, attic, weekend
    const live = price(AC_TUNE_UP_STEPS, { system_count: 2, system_operational: 'no,_it_is_not_cooling_/_broken', indoor_location: 'attic', weekend_visit: true }, AC_TUNE_UP_FIELDS)
    expect(live.subtotal).toBe(323)
    expect(live.amounts).toEqual([129, 89, 45, 60])
  })

  it('weekend is not charged when the box is not ticked, and not when the question was never answered', () => {
    expect(price(AC_TUNE_UP_STEPS, { system_count: 1, indoor_location: 'Basement', weekend_visit: false }, AC_TUNE_UP_FIELDS).labels.join()).not.toMatch(/Weekend/)
    expect(price(AC_TUNE_UP_STEPS, { system_count: 1, indoor_location: 'Basement' }, AC_TUNE_UP_FIELDS).labels.join()).not.toMatch(/Weekend/)
  })

  it('the attic line follows the location: Basement, Garage and Crawlspace do not pay it', () => {
    for (const place of ['Basement', 'Garage', 'Crawlspace', 'Closet / Interior Room']) {
      expect(price(AC_TUNE_UP_STEPS, { system_count: 1, indoor_location: place, weekend_visit: false }, AC_TUNE_UP_FIELDS).subtotal, place).toBe(129)
    }
    expect(price(AC_TUNE_UP_STEPS, { system_count: 1, indoor_location: 'Attic', weekend_visit: false }, AC_TUNE_UP_FIELDS).subtotal).toBe(174)
  })

  it('"each additional system" is the answer minus one, never below 0', () => {
    const additional = (count: number) => price(AC_TUNE_UP_STEPS, { system_count: count, indoor_location: 'Basement', weekend_visit: false }, AC_TUNE_UP_FIELDS).subtotal - 129
    expect(additional(1)).toBe(0)
    expect(additional(2)).toBe(89)
    expect(additional(3)).toBe(178)
    expect(additional(5)).toBe(356)
    // 0 systems: no first system either, and nothing negative
    expect(price(AC_TUNE_UP_STEPS, { system_count: 0, indoor_location: 'Basement', weekend_visit: false }, AC_TUNE_UP_FIELDS).subtotal).toBe(0)
  })

  it('refrigerant: empty is 0 lb, "0" is 0 lb, 3 is 3 lb', () => {
    const base = { system_count: 1, indoor_location: 'Basement', weekend_visit: false }
    expect(price(AC_TUNE_UP_STEPS, base, AC_TUNE_UP_FIELDS).labels.join()).not.toMatch(/Refrigerant/)
    expect(price(AC_TUNE_UP_STEPS, { ...base, refrigerant_lbs: '' }, AC_TUNE_UP_FIELDS).subtotal).toBe(129)
    expect(price(AC_TUNE_UP_STEPS, { ...base, refrigerant_lbs: '0' }, AC_TUNE_UP_FIELDS).subtotal).toBe(129)
    expect(price(AC_TUNE_UP_STEPS, { ...base, refrigerant_lbs: 3 }, AC_TUNE_UP_FIELDS).subtotal).toBe(129 + 285)
  })
})

describe('T-204 item 1: an optional number left empty counts as 0, never 1', () => {
  const perUnit = (source: Record<string, unknown>, extra: Record<string, unknown> = {}) => [{ id: 'line', name: 'Extra', description: 'Extra', costType: 'per_unit', defaultCost: 50, unitLabel: 'item', optional: false, quantitySource: source, ...extra }]
  const optional: Field = { fieldId: 'how_many', type: 'number', required: false, label: 'How many?' }
  const required: Field = { fieldId: 'how_many', type: 'number', required: true, label: 'How many?' }

  it('an optional number question left empty: the line is not charged, with no "empty = 0" mark on the line', () => {
    const result = price(perUnit({ type: 'form_field', fieldId: 'how_many' }), {}, [optional])
    expect(result.subtotal).toBe(0)
    expect(result.labels).toEqual([])
  })

  it('the same question answered: charged at the answer; typed 0, "0" and a negative number: not charged', () => {
    const line = perUnit({ type: 'form_field', fieldId: 'how_many' })
    expect(price(line, { how_many: 4 }, [optional]).subtotal).toBe(200)
    expect(price(line, { how_many: '4' }, [optional]).subtotal).toBe(200)
    expect(price(line, { how_many: 0 }, [optional]).subtotal).toBe(0)
    expect(price(line, { how_many: '0' }, [optional]).subtotal).toBe(0)
    expect(price(line, { how_many: -2 }, [optional]).subtotal).toBe(0)
    // also for a required question: a typed 0 is 0, it is not turned into 1
    expect(price(line, { how_many: '0' }, [required]).subtotal).toBe(0)
  })

  it('a question the customer must answer keeps the old placeholder when it somehow has no answer (it is asked about, T-127)', () => {
    const result = price(perUnit({ type: 'form_field', fieldId: 'how_many' }), {}, [required])
    expect(result.subtotal).toBe(50)
    expect(result.trace.find((step) => step.id === 'line')?.quantityTrusted).toBe(false)
    // "needed for the price" makes a question required on the form, so it is not optional either
    expect(price(perUnit({ type: 'form_field', fieldId: 'how_many' }), {}, [{ ...optional, criticalForPricing: true }]).subtotal).toBe(50)
    // listed twice (the form's copy says required): not optional
    expect(price(perUnit({ type: 'form_field', fieldId: 'how_many' }), {}, [required, optional]).subtotal).toBe(50)
  })

  it('in a formula too: an empty optional number is 0', () => {
    const line = perUnit({ type: 'derived', formula: 'max(0, how_many - 1)' })
    expect(price(line, {}, [optional]).subtotal).toBe(0)
    expect(price(line, { how_many: 3 }, [optional]).subtotal).toBe(100)
  })

  it('a line left out this way is reported, so the pipeline can still ask the customer for the number (T-127); "empty means none" is not', () => {
    // merely optional: 0 in the price, and reported with the question to ask
    const implicit = price(perUnit({ type: 'form_field', fieldId: 'how_many' }), {}, [optional])
    expect(implicit.subtotal).toBe(0)
    expect(implicit.unanswered).toEqual([{ stepId: 'line', stepName: 'Extra', fieldId: 'how_many' }])
    // marked "empty means none" on the line (what the compiler writes for "only if needed"): a plain 0
    expect(price(perUnit({ type: 'form_field', fieldId: 'how_many', missingMeansZero: true }), {}, [optional]).unanswered).toEqual([])
    // answered, even with 0: nothing to ask
    expect(price(perUnit({ type: 'form_field', fieldId: 'how_many' }), { how_many: 0 }, [optional]).unanswered).toEqual([])
    // in a formula too
    expect(price(perUnit({ type: 'derived', formula: 'max(0, how_many - 1)' }), {}, [optional]).unanswered).toEqual([{ stepId: 'line', stepName: 'Extra', fieldId: 'how_many' }])
    // the AC Tune-Up's refrigerant line is marked on the line: left empty, nothing is asked
    expect(price(AC_TUNE_UP_STEPS, { system_count: 1, indoor_location: 'Basement', weekend_visit: false }, AC_TUNE_UP_FIELDS).unanswered).toEqual([])
  })

  it('the pipeline asks about such a line on the terms a placeholder was asked about, and so does a service added to a quote', () => {
    const processor = read('apps/worker/src/quote-processor.ts')
    expect(processor).toContain('for (const unanswered of pricing.unansweredOptional ?? []) {')
    expect(processor).toContain('if (ask) defaultedQuantitySteps.push({ askKey: unanswered.fieldId, stepName: step.name, leftOut: true })')
    expect(read('apps/worker/src/section-pricing.ts')).toContain('for (const unanswered of run.pricing.unansweredOptional ?? []) {')
    expect(read('apps/worker/src/agents/quality-gate.ts')).toContain('the line is left out of the price for now; ask the customer for the actual value')
  })

  it('the question comes before the £0 hold: a price that is only missing that number asks for it', async () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const nothing = { currency: 'USD', subtotal: 0, taxAmount: 0, total: 0, breakdown: [], notes: [], confidence: 1 }
    const input = (extra: Record<string, unknown>) => ({ structuredSignals: structured(), fusionResult: null, pricing: nothing, clarificationCount: 0, serviceName: 'Fencing', hasPhotos: false, workStepsConfigured: 1, workStepLinesPriced: 0, ...extra })
    // the customer left the optional length empty: asked, not held
    const asked = await evaluateQualityGate(input({ defaultedQuantitySteps: [{ askKey: 'fence_length_ft', stepName: 'Closeboard fencing', leftOut: true }], choiceContext: { fields: [{ fieldId: 'fence_length_ft', label: 'Fence length in feet (if known)', type: 'number' }], workSteps: [], addons: [], answers: [] } }) as never, null)
    expect(asked.action).toBe('ask_clarification')
    expect(asked.questions?.map((q) => q.targetSignalKey)).toEqual(['fence_length_ft'])
    // nothing to ask: a price of nothing is still held, as before (T-126)
    const held = await evaluateQualityGate(input({}) as never, null)
    expect(held.action).toBe('require_review')
    expect(held.reason).toContain('£0')
    // and after the one round of questions the gate sends on; the processor's own send-guard then holds a £0 quote
    expect((await evaluateQualityGate(input({ clarificationCount: 1, defaultedQuantitySteps: [{ askKey: 'fence_length_ft', stepName: 'Closeboard fencing', leftOut: true }] }) as never, null)).action).toBe('send')
    quiet.mockRestore()
  })

  it('per hour as well: empty is 0 hours, and a number typed as text is read', () => {
    const hourly = [{ id: 'h', name: 'Labour', description: 'Labour', costType: 'per_hour', defaultCost: 80, optional: false, quantitySource: { type: 'form_field', fieldId: 'how_many' } }]
    expect(price(hourly, {}, [optional]).subtotal).toBe(0)
    expect(price(hourly, { how_many: '2' }, [optional]).subtotal).toBe(160)
  })

  it('the box beside a quantity the photos measure ("if you know it") is not such a question', () => {
    const steps = [{ id: 'm', name: 'Area', costType: 'per_unit', defaultCost: 2, quantitySource: { type: 'ai_signal', signalKey: 'wall_area' } }]
    expect([...optionalNumberQuestions([{ fieldId: 'wall_area', type: 'number', required: false }, { fieldId: 'spare', type: 'number', required: false }], steps)]).toEqual(['spare'])
  })
})

describe('T-204: the engine and the dashboard read an answer with the same code', () => {
  it('the comparison lives in the shared package and the engine imports it', () => {
    const engine = read('apps/worker/src/pricing/rules-engine.ts')
    expect(engine).toMatch(/import \{[^}]*compareAnswerValue[^}]*coerceToNumber[^}]*\} from '@qolumns\/shared'/)
    expect(engine).not.toMatch(/^function compareAnswerValue\(/m)
    expect(engine).not.toMatch(/^function coerceToNumber\(/m)
  })

  it('a tick, a choice and a number compare as they always did', () => {
    expect(compareAnswerValue(true, 'equals', true)).toBe(true)
    expect(compareAnswerValue(false, 'equals', true)).toBe(false)
    expect(compareAnswerValue(true, 'equals', 'Yes')).toBe(true)
    expect(compareAnswerValue('attic', 'equals', 'Attic')).toBe(true)
    expect(compareAnswerValue('closet_/_interior_room', 'equals', 'Closet / Interior Room')).toBe(true)
    expect(compareAnswerValue('Basement', 'equals', 'Attic')).toBe(false)
    expect(compareAnswerValue('3', 'gt', 2)).toBe(true)
    expect(compareAnswerValue(['a', 'B'], 'equals', 'b')).toBe(true)
    expect(coerceToNumber('2,400')).toBe(2400)
    expect(coerceToNumber('')).toBeNull()
  })

  it('the preview is the pipeline itself: it runs processQuote in preview mode and writes nothing of its own', () => {
    const preview = read('apps/worker/src/preview-pricing.ts')
    expect(preview).toContain("processQuote('preview', '', supabase, env, undefined, { preview: { data } })")
    expect(preview).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    const processor = read('apps/worker/src/quote-processor.ts')
    // a preview is a section run: every AI client off, and the run returns straight after the engine
    expect(processor).toContain('const section = options.section ?? (options.preview ?')
    expect(processor).toContain('const gemini = section ? null :')
    expect(processor).toContain('const textAi = section ? null :')
  })
})
