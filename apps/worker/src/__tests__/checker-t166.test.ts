/**
 * T-166 (AD-049): the quote checker flags, it never corrects.
 *
 * 1. Its output cannot change what is stored as `pricing_json`: whatever the
 *    model replies, the priced quote it was given is untouched, and nothing it
 *    returns is a price, a line or a note.
 * 2. Before and after: every existing pricing case, through the engine and
 *    then the checker, gives the totals recorded before T-166.
 * 3. What an issue leads to (held for review, or not) is what it was; only
 *    the misleading name `auto_corrected` changed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ValidationAction, ValidationResult, ValidationSettings } from '@qolumns/shared'
import type { AiClient } from '../ai/client'
import * as checker from '../ai/quote-validator'
import * as ai from '../ai'
import { validateQuote, determineValidationOutcome, getDefaultValidationSettings } from '../ai/quote-validator'
import { PRICING_CASES, priceCase, totalsOf, type CaseTotals } from './fixtures/pricing-cases'
import before from './fixtures/t166-totals-before.json'

afterEach(() => {
  vi.restoreAllMocks()
})

const source = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')
const code = (rel: string) => source(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner)
  }
  return value
}

/**
 * The worst reply a model could give: every old instruction to change the
 * quote (add a step, remove an add-on, add and remove notes), and a whole
 * replacement price for good measure.
 */
const hostileReply = (total: number) => ({
  overallStatus: 'FAIL',
  confidenceScore: 0.9,
  issues: [
    {
      id: 'i1', category: 'pricing', severity: 'critical', check: 'CHECK_1b',
      description: 'A work step that should have triggered is missing', found: 'no line', expected: 'a line', autoFixable: true,
      autoFix: { action: 'add_work_step', details: { workStepId: 'heavy_prep', quantity: 3 } },
    },
    {
      id: 'i2', category: 'addons', severity: 'high', check: 'CHECK_5a',
      description: 'An add-on was applied against the customer’s wishes', found: 'a line', expected: 'no line', autoFixable: true,
      autoFix: { action: 'remove_addon', details: { addonId: 'rooms' } },
    },
    {
      id: 'i3', category: 'notes', severity: 'medium', check: 'CHECK_6a',
      description: 'A note is missing', found: '', expected: 'a note', autoFixable: true,
      autoFix: { action: 'add_note', details: { noteText: 'Price reduced by 50%', position: 'start' } },
      correctedPricing: { total: 1 },
    },
    {
      id: 'i4', category: 'notes', severity: 'low', check: 'CHECK_6a',
      description: 'A note is irrelevant', found: 'a note', expected: '', autoFixable: true,
      autoFix: { action: 'remove_note', details: { noteIndex: 0 } },
    },
  ],
  summary: { criticalCount: 1, highCount: 1, mediumCount: 1, lowCount: 1, autoFixableCount: 4, configIssueCount: 0 },
  calculatedExpectedTotal: total * 2,
  actualTotal: total / 2,
  pricingGapPercent: 50,
  correctedPricing: { subtotal: 1, taxAmount: 0, total: 1, breakdown: [{ label: 'Everything', amount: 1 }] },
  pricing: { total: 1 },
})

const fakeAi = (reply: unknown): AiClient =>
  ({
    route: { provider: 'test', model: 'test' },
    generateText: async () => '',
    generateWithImages: async () => '',
    generateWithSchema: async () => structuredClone(reply),
    generateWithImagesAndSchema: async () => structuredClone(reply),
  }) as unknown as AiClient

/** The checker stage, as the worker runs it: the reply, then what it leads to */
async function check(pricing: ReturnType<typeof priceCase>, rules: (typeof PRICING_CASES)[number]['rules'], settings: ValidationSettings) {
  const quote = deepFreeze({ pricing, content: { scopeSummary: 'Paint the rooms.', assumptions: [], exclusions: [], notes: '', validityDays: 30 } })
  const result = await validateQuote(
    fakeAi(hostileReply(pricing.total)),
    quote,
    { formAnswers: [], customerDescription: 'Two rooms please, with heavy prep', photoCount: 0 },
    { serviceName: 'Test service', workSteps: rules.workSteps, addons: rules.addons, multipliers: rules.multipliers }
  )
  return { result, decision: determineValidationOutcome(result, settings, pricing.total) }
}

const settingsWith = (action: ValidationAction): ValidationSettings => ({
  ...getDefaultValidationSettings(),
  onCriticalIssue: action,
  onHighIssue: action,
  onMediumIssue: action,
  onLowIssue: action,
})

describe('T-166: the checker’s output cannot change pricing_json', () => {
  it('a reply full of instructions to change the price leaves the priced quote exactly as it was', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const c = PRICING_CASES.find((x) => x.name === 'rooms / one room step / 1 room(s) / no tax / minimum 400')!
    const pricing = priceCase(c)
    const asStored = JSON.stringify(pricing)
    // the quote is frozen all the way down: any write would throw
    const { result, decision } = await check(pricing, c.rules, getDefaultValidationSettings())
    expect(JSON.stringify(pricing)).toBe(asStored)
    expect(pricing.total).toBe(400)
    // the model did reply with issues: the checker still flags
    expect(result.issues).toHaveLength(4)
    expect(result.summary).toMatchObject({ criticalCount: 1, highCount: 1, mediumCount: 1, lowCount: 1 })
    // ...but nothing it returns is an instruction, a price, a line or a note
    for (const issue of result.issues) {
      expect(Object.keys(issue).sort()).toEqual(['autoFixable', 'category', 'check', 'description', 'expected', 'found', 'id', 'severity'])
    }
    expect(Object.keys(result).sort()).toEqual(['actualTotal', 'calculatedExpectedTotal', 'confidenceScore', 'issues', 'overallStatus', 'pricingGapPercent', 'summary'])
    expect(JSON.stringify(result)).not.toMatch(/autoFix"|correctedPricing|add_work_step|remove_addon|add_note|remove_note|breakdown|subtotal/)
    // the figure it reports as the actual total is the quote's own, not the model's
    expect(result.actualTotal).toBe(400)
    // and what it leads to is a decision about review, nothing else
    expect(Object.keys(decision).sort()).toEqual(['needsReview', 'outcome'])
  })

  it('the checker has no function that returns or takes a corrected quote', () => {
    expect(Object.keys(checker).sort()).toEqual(['determineValidationOutcome', 'getDefaultValidationSettings', 'validateQuote'])
    expect('applyAutoCorrections' in ai).toBe(false)
    const file = code('ai/quote-validator.ts')
    for (const gone of ['applyAutoCorrections', 'AutoCorrectionResult', 'correctedPricing', 'correctedContent', 'appliedFixes', 'add_work_step', 'remove_addon', 'add_note', 'remove_note', 'roundMoney']) {
      expect(file, gone).not.toContain(gone)
    }
    // it never writes to a quote: no assignment to, and no push onto, anything of pricing
    expect(file).not.toMatch(/pricing(\.\w+)+\s*(=(?!=)|\+=|-=)/)
    expect(file).not.toMatch(/\.(breakdown|notes)\.(push|unshift|splice)\(/)
    expect(file).not.toMatch(/\.(subtotal|taxAmount|total)\s*(=(?!=)|\+=|-=)/)
    // the reply format has no place for an instruction
    expect(file).not.toMatch(/\bautoFix\b(?!able)/)
    // nor do the shared types
    const types = readFileSync(join(__dirname, '../../../../packages/shared/src/database.types.ts'), 'utf8')
    for (const gone of ['AutoFixAction', 'AutoFixDetails', 'ValidationCorrections', 'autoFix?:', "'auto_corrected'"]) expect(types, gone).not.toContain(gone)
  })

  it('the worker hands the checker a copy, and takes nothing back from it but the review decision', () => {
    const processor = code('quote-processor.ts')
    const start = processor.indexOf('let validationResult: ValidationResult | undefined')
    const end = processor.indexOf('const wordingRepair = await', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const block = processor.slice(start, end)
    expect(block).toContain('const quoteForValidation: GeneratedQuoteForValidation = structuredClone({')
    expect(block).toContain('determineValidationOutcome(validationResult, validationSettings, pricing.total)')
    // no write to the price, its lines, its notes or the wording anywhere in the checker's block
    expect(block).not.toMatch(/\b(pricing|content)(\.\w+)+\s*(=(?!=)|\+=|-=)/)
    expect(block).not.toMatch(/\b(pricing|content)(\.\w+)*\.(push|unshift|splice)\(/)
    expect(block).not.toMatch(/Object\.assign\(\s*(pricing|content)\b/)
    expect(block).not.toMatch(/\b(signalRecommendations|crossServicePricing)\s*=(?!=)/)
    expect(block).not.toMatch(/crossServicePricing\.(push|splice|length\s*=)/)
    // the only things the block sets are the checker's own result and the review decision
    const assigned = [...block.matchAll(/^\s*([A-Za-z_]\w*)\s*=(?!=)/gm)].map((m) => m[1]).sort()
    expect([...new Set(assigned)]).toEqual(['finalStatus', 'validationOutcome', 'validationRequiresReview', 'validationResult'])
    // and nowhere in the worker is a correction applied
    for (const gone of ['applyAutoCorrections', 'validationAppliedFixes', 'correctionsApplied', 'Object.assign(pricing']) expect(processor, gone).not.toContain(gone)
  })
})

describe('T-166: before and after, no total changed', () => {
  const recorded = before as Record<string, CaseTotals>

  it('the recorded cases are the cases (261 of them, 39 with a minimum applied by a high floor)', () => {
    expect(PRICING_CASES).toHaveLength(261)
    expect(Object.keys(recorded).sort()).toEqual(PRICING_CASES.map((c) => c.name).sort())
    expect(new Set(PRICING_CASES.map((c) => c.name)).size).toBe(261)
  })

  it('engine alone: every case prices as it did', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (const c of PRICING_CASES) expect(totalsOf(priceCase(c)), c.name).toEqual(recorded[c.name])
  })

  it('engine then checker, whatever the checker says and whatever the setting: every case prices as it did', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const actions: ValidationAction[] = ['auto_correct', 'flag_for_review', 'block', 'pass_with_warning', 'ignore']
    let compared = 0
    for (const [index, c] of PRICING_CASES.entries()) {
      const pricing = priceCase(c)
      await check(pricing, c.rules, settingsWith(actions[index % actions.length]!))
      expect(totalsOf(pricing), c.name).toEqual(recorded[c.name])
      compared++
    }
    expect(compared).toBe(261)
  })
})

describe('T-166: what an issue leads to is unchanged; only the name "auto_corrected" is gone', () => {
  const result = (counts: Partial<ValidationResult['summary']>): ValidationResult => ({
    overallStatus: 'REVIEW_NEEDED',
    confidenceScore: 0.9,
    issues: [],
    summary: { criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, autoFixableCount: 0, configIssueCount: 0, ...counts },
    calculatedExpectedTotal: 400,
    actualTotal: 400,
    pricingGapPercent: 0,
  })
  const held = { needsReview: true, statusOverride: 'pending_review' }
  const notHeld = { needsReview: false }

  it('the stored setting "auto_correct": issues are logged and the quote goes on, not held', () => {
    const settings = getDefaultValidationSettings()
    expect(settings).toMatchObject({ onCriticalIssue: 'auto_correct', onHighIssue: 'auto_correct', onMediumIssue: 'auto_correct', onLowIssue: 'pass_with_warning' })
    for (const counts of [{ criticalCount: 1 }, { highCount: 2 }, { mediumCount: 1 }]) {
      expect(determineValidationOutcome(result(counts), settings, 400)).toEqual({ outcome: 'passed_with_issues', ...notHeld })
    }
    expect(determineValidationOutcome(result({ lowCount: 3 }), settings, 400)).toEqual({ outcome: 'passed', ...notHeld })
    expect(determineValidationOutcome(result({}), settings, 400)).toEqual({ outcome: 'passed', ...notHeld })
  })

  it('every other setting leads where it led before', () => {
    const table: Array<[ValidationAction, Partial<ValidationResult['summary']>, object]> = [
      ['flag_for_review', { criticalCount: 1 }, { outcome: 'sent_for_review', ...held }],
      ['block', { criticalCount: 1 }, { outcome: 'blocked', ...held }],
      ['pass_with_warning', { criticalCount: 1 }, { outcome: 'sent_for_review', ...held }],
      ['ignore', { criticalCount: 1 }, { outcome: 'sent_for_review', ...held }],
      ['flag_for_review', { highCount: 1 }, { outcome: 'sent_for_review', ...held }],
      ['block', { highCount: 1 }, { outcome: 'blocked', ...held }],
      ['pass_with_warning', { highCount: 1 }, { outcome: 'passed', ...notHeld }],
      ['ignore', { highCount: 1 }, { outcome: 'passed_with_issues', ...notHeld }],
      ['flag_for_review', { mediumCount: 1 }, { outcome: 'sent_for_review', ...held }],
      ['block', { mediumCount: 1 }, { outcome: 'passed_with_issues', ...notHeld }],
      ['pass_with_warning', { mediumCount: 1 }, { outcome: 'passed', ...notHeld }],
      ['ignore', { mediumCount: 1 }, { outcome: 'passed', ...notHeld }],
      ['flag_for_review', { lowCount: 1 }, { outcome: 'sent_for_review', ...held }],
      ['auto_correct', { lowCount: 1 }, { outcome: 'passed', ...notHeld }],
      ['block', { lowCount: 1 }, { outcome: 'passed', ...notHeld }],
    ]
    for (const [action, counts, expected] of table) {
      expect(determineValidationOutcome(result(counts), settingsWith(action), 400), `${action} ${JSON.stringify(counts)}`).toEqual(expected)
    }
  })

  it('a quote above the review threshold is still held, and a disabled checker still passes everything', () => {
    expect(determineValidationOutcome(result({}), { ...getDefaultValidationSettings(), requireManualReviewAbove: 300 }, 400)).toEqual({ outcome: 'sent_for_review', ...held })
    expect(determineValidationOutcome(result({ criticalCount: 5 }), { ...getDefaultValidationSettings(), enabled: false }, 400)).toEqual({ outcome: 'passed', ...notHeld })
  })

  it('migration 41 renames the old log rows and is the only place the old name is written', () => {
    const migration = readFileSync(join(__dirname, '../../../../supabase/migrations/00000000000041_checker_outcome_label.sql'), 'utf8')
    expect(migration).toMatch(/UPDATE quote_validation_logs\s+SET outcome = 'passed_with_issues'\s+WHERE outcome = 'auto_corrected'/)
    expect(migration).not.toMatch(/\bDROP\b|\bDELETE\b|\bALTER TABLE\b/i)
    expect(code('ai/quote-validator.ts')).not.toContain('auto_corrected')
    expect(code('quote-processor.ts')).not.toContain('auto_corrected')
  })
})
