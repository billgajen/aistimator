/**
 * T-188: questions with choices, worded for who answers; the note that goes
 * with an answer; and where a line the product added came from.
 *
 * The rules are pure (agents/question-choices.ts, takeoff.ts, the shared
 * question and source rules) and the quality gate is called with no model.
 * No trade, service or question text is known to the code under test: every
 * name below is the fixture's own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ANSWER_NOTE_MAX,
  answerNote,
  askedQuestion,
  businessSources,
  isAddedByProduct,
  questionChoices,
  sourceForBusiness,
  type ClarificationQuestion,
  type ExtractedSignalsV2,
  type WorkStepConfig,
} from '@qolumns/shared'
import { evaluateQualityGate, type QualityGateInput } from '../agents/quality-gate'
import { doubtChoices, lineOf, missingChoices, numberOf, suggestedNumber, type ChoiceContext } from '../agents/question-choices'
import { calculatePricingWithTrace, type PricingRules, type TaxConfig } from '../pricing/rules-engine'
import { addedBecause, buildTakeoff, withLineSources } from '../takeoff'
import type { ExtractedSignals } from '../ai/signals'

const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

// A made-up service: a per-room step sized by an answer, a removal step switched on by a yes/no
// answer, a prep step switched on by something read from the job, and one extra.
const STEPS: WorkStepConfig[] = [
  { id: 'rooms', name: 'Rooms', description: '', costType: 'per_unit', defaultCost: 375, optional: false, unitLabel: 'Room', quantitySource: { type: 'form_field', fieldId: 'room_count' } },
  { id: 'removal', name: 'Covering removal', description: '', costType: 'fixed', defaultCost: 180, optional: true, when: { fieldId: 'has_covering', equals: true } },
  { id: 'prep', name: 'Heavy prep', description: '', costType: 'fixed', defaultCost: 250, optional: true, triggerSignal: 'needs_prep', triggerCondition: { operator: 'equals', value: true } },
]
const FIELDS = [
  { fieldId: 'room_count', label: 'How many rooms?', type: 'number' },
  { fieldId: 'has_covering', label: 'Is there a covering to remove?', type: 'boolean' },
  { fieldId: 'finish', label: 'Which finish?', type: 'dropdown', options: [{ value: 'matt', label: 'Matt' }, { value: 'silk', label: 'Silk' }] },
  { fieldId: 'notes_extra', label: 'Anything else?', type: 'textarea' },
]
const ADDONS = [{ id: 'addon_trim', label: 'Trim and doors' }]
const context = (answers: ChoiceContext['answers'], audience: ChoiceContext['audience'] = 'business'): ChoiceContext => ({ fields: FIELDS, workSteps: STEPS, addons: ADDONS, answers, audience })

// ---------------------------------------------------------------------------
// 1. The choices
// ---------------------------------------------------------------------------

describe('T-188: a doubt is answered by pressing a choice built from the business’s own rules', () => {
  it('the owner’s case: a yes/no answer that switches a line on → keep that line, or not', () => {
    const built = doubtChoices('has_covering', '', context([{ fieldId: 'has_covering', value: true }]))!
    expect(built.choices).toEqual([
      { label: 'Keep Covering removal', value: 'true' },
      { label: 'No Covering removal', value: 'No' },
    ])
    expect(built.closed).toBe(true)
    expect(built.ask).toBe('Keep Covering removal?')
  })

  it('the line is off and the evidence says it is needed → add it, or not', () => {
    const built = doubtChoices('has_covering', '', context([{ fieldId: 'has_covering', value: false }]))!
    expect(built.choices.map((c) => c.label)).toEqual(['Add Covering removal', 'No Covering removal'])
    expect(built.ask).toBe('Add Covering removal?')
  })

  it('an extra is switched by its own id', () => {
    const built = doubtChoices('addon_trim', '', context([{ fieldId: 'addon_trim', value: true }]))!
    expect(built.choices).toEqual([
      { label: 'Keep Trim and doors', value: 'addon_trim' },
      { label: 'No Trim and doors', value: 'No' },
    ])
  })

  it('a step that applies when the answer is "no" is switched the other way round', () => {
    const steps: WorkStepConfig[] = [{ id: 'haul', name: 'Haul-away', description: '', costType: 'fixed', defaultCost: 90, optional: true, when: { fieldId: 'keeps_old', equals: false } }]
    const built = doubtChoices('keeps_old', '', { fields: [{ fieldId: 'keeps_old', type: 'boolean' }], workSteps: steps, addons: [], answers: [{ fieldId: 'keeps_old', value: false }], audience: 'business' })!
    expect(built.choices).toEqual([
      { label: 'Keep Haul-away', value: 'No' },
      { label: 'No Haul-away', value: 'Yes' },
    ])
  })

  it('a number → the one given, the one the evidence points to, and room for another', () => {
    const built = doubtChoices('room_count', '3', context([{ fieldId: 'room_count', value: 1 }]))!
    expect(built.choices).toEqual([
      { label: 'Keep 1 room', value: '1' },
      { label: '3 rooms', value: '3' },
    ])
    expect(built.closed).toBe(false)
    expect(built.answerKind).toBe('number')
    // the unit is the business's own word for the step, made plural after a number
    expect(doubtChoices('room_count', 'about 12 rooms', context([{ fieldId: 'room_count', value: '2' }]))!.choices.map((c) => c.label)).toEqual(['Keep 2 rooms', '12 rooms'])
    // the evidence says none: the choice is the line itself
    expect(doubtChoices('room_count', '0', context([{ fieldId: 'room_count', value: 2 }]))!.choices[1]).toEqual({ label: 'No Rooms', value: '0' })
    // no figure to suggest, or the same figure: only the one given, and "Other"
    for (const hint of ['', 'more than that', '2']) expect(doubtChoices('room_count', hint, context([{ fieldId: 'room_count', value: 2 }]))!.choices).toEqual([{ label: 'Keep 2 rooms', value: '2' }])
  })

  it('an answer with options → its own options, as the business wrote them, and nothing else', () => {
    const built = doubtChoices('finish', 'Silk', context([{ fieldId: 'finish', value: 'matt' }]))!
    expect(built.choices).toEqual([{ label: 'Matt', value: 'matt' }, { label: 'Silk', value: 'silk' }])
    expect(built.closed).toBe(true)
    expect(built.ask).toBe('Which is right?')
  })

  it('a doubt tied to no answer, to an unknown one, or to a written one has no choices: it is not asked', () => {
    expect(doubtChoices(undefined, '3', context([]))).toBeNull()
    expect(doubtChoices('not_a_field', '3', context([]))).toBeNull()
    expect(doubtChoices('notes_extra', '', context([{ fieldId: 'notes_extra', value: 'some words' }]))).toBeNull()
  })

  it('who answers changes the words, never the choices', () => {
    const answers = [{ fieldId: 'has_covering', value: true }]
    const business = doubtChoices('has_covering', '', context(answers, 'business'))!
    const customer = doubtChoices('has_covering', '', context(answers, 'customer'))!
    expect(customer.choices).toEqual(business.choices)
    expect(business.ask).toBe('Keep Covering removal?')
    expect(customer.ask).toBe('Which is right?')
  })

  it('a question about something nobody gave: the field’s options, the service’s allowed values, or a number', () => {
    expect(missingChoices('finish', { fields: FIELDS, workSteps: STEPS }, false)).toEqual({ choices: [{ label: 'Matt', value: 'matt' }, { label: 'Silk', value: 'silk' }], closed: true })
    expect(missingChoices('fuel', { fields: FIELDS, workSteps: STEPS, allowedValues: { fuel: ['Gas', 'Electric'] } }, false)).toEqual({ choices: [{ label: 'Gas', value: 'Gas' }, { label: 'Electric', value: 'Electric' }], closed: true })
    expect(missingChoices('wall_area', { fields: FIELDS, workSteps: STEPS }, true)).toEqual({ choices: [], closed: false, answerKind: 'number' })
    expect(missingChoices('room_count', { fields: FIELDS, workSteps: STEPS }, false)).toEqual({ choices: [], closed: false, answerKind: 'number' })
    expect(missingChoices('something_else', { fields: FIELDS, workSteps: STEPS }, false)).toBeNull()
  })

  it('the helpers', () => {
    expect([numberOf('1,500'), numberOf(' 3 '), numberOf(2.5), numberOf('three'), numberOf('')]).toEqual([1500, 3, 2.5, null, null])
    expect([suggestedNumber('3'), suggestedNumber('about 3 rooms'), suggestedNumber('3-4 hours'), suggestedNumber('more'), suggestedNumber(undefined)]).toEqual([3, 3, 3, null, null])
    expect(lineOf('room_count', { workSteps: STEPS, addons: ADDONS })).toMatchObject({ name: 'Rooms', unit: 'Room', switched: false })
    expect(lineOf('has_covering', { workSteps: STEPS, addons: ADDONS })).toMatchObject({ name: 'Covering removal', switched: true })
    expect(lineOf('nothing', { workSteps: STEPS, addons: ADDONS })).toBeNull()
  })

  it('no trade, service or question is written into the rule: three plain words of ours, and the business’s own names', () => {
    const rule = src('agents/question-choices.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    expect(rule).not.toMatch(/wallpaper|sticker|paint|removal|prep|room|gallon|hour/i)
    expect((rule.match(/'Keep'|'Add'|`No \$\{/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// 2. The quality gate
// ---------------------------------------------------------------------------

const structured = (signals: ExtractedSignalsV2['signals'] = []): ExtractedSignalsV2 => ({
  extractedAt: '2026-01-01T00:00:00.000Z',
  overallConfidence: 0.9,
  signals,
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: signals.filter((s) => s.confidence < 0.5).map((s) => s.key),
})
const gateInput = (over: Partial<QualityGateInput>): QualityGateInput =>
  ({
    structuredSignals: structured(),
    fusionResult: null,
    pricing: { currency: 'USD', subtotal: 555, taxLabel: 'Tax', taxRate: 0, taxAmount: 0, total: 555, breakdown: [{ label: 'Rooms', amount: 375 }], notes: [], confidence: 0.9 },
    clarificationCount: 0,
    serviceName: 'Service A',
    hasPhotos: true,
    workStepsConfigured: 3,
    workStepLinesPriced: 2,
    choiceContext: { fields: FIELDS, workSteps: STEPS, addons: ADDONS, answers: [{ fieldId: 'has_covering', value: true }, { fieldId: 'room_count', value: 1 }] },
    ...over,
  }) as QualityGateInput

describe('T-188: the gate asks with choices, in words for who answers', () => {
  it('on a quote the business made: the doubt, then "Keep <the line>?", with the two choices', async () => {
    const result = await evaluateQualityGate(gateInput({ audience: 'business', quantityConcern: { reason: 'The photos show stickers, not a covering.', fieldId: 'has_covering' } }), null)
    expect(result.action).toBe('ask_clarification')
    expect(result.questions).toHaveLength(1)
    const asked = result.questions![0]!
    expect(asked.question).toBe('The photos show stickers, not a covering. Keep Covering removal?')
    expect(asked.choices).toEqual([{ label: 'Keep Covering removal', value: 'true' }, { label: 'No Covering removal', value: 'No' }])
    expect(asked.closed).toBe(true)
    expect(asked.targetSignalKey).toBe('has_covering')
  })

  it('on a customer’s request: the same choices, asked as "Which is right?"', async () => {
    const result = await evaluateQualityGate(gateInput({ quantityConcern: { reason: 'The photos show stickers, not a covering.', fieldId: 'has_covering' } }), null)
    expect(result.questions![0]!.question).toBe('The photos show stickers, not a covering. Which is right?')
    expect(result.questions![0]!.choices!.map((c) => c.label)).toEqual(['Keep Covering removal', 'No Covering removal'])
  })

  it('a number: what was given, what the evidence points to, and "Other" for another figure', async () => {
    const result = await evaluateQualityGate(gateInput({ audience: 'business', quantityConcern: { reason: 'The notes mention three bedrooms.', fieldId: 'room_count', suggested: '3' } }), null)
    const asked = result.questions![0]!
    expect(asked.choices).toEqual([{ label: 'Keep 1 room', value: '1' }, { label: '3 rooms', value: '3' }])
    expect(asked.answerKind).toBe('number')
    const drawn = questionChoices(askedQuestion(asked))
    expect(drawn.choices.map((c) => c.label)).toEqual(['Keep 1 room', '3 rooms'])
    expect([drawn.otherLabel, drawn.numeric]).toEqual(['Other', true])
  })

  it('the open question is gone from the worker', async () => {
    // (in the code: the comments say what it replaced)
    const code = (file: string) => src(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    for (const file of ['agents/quality-gate.ts', 'agents/question-choices.ts', 'quote-processor.ts', 'ai/wording.ts', 'ai/schemas.ts']) expect(code(file), file).not.toMatch(/What should we allow for/)
    const result = await evaluateQualityGate(gateInput({ quantityConcern: { reason: 'The notes mention three bedrooms.', fieldId: 'room_count', suggested: '3' } }), null)
    expect(JSON.stringify(result)).not.toMatch(/What should we allow for/)
  })

  it('a doubt tied to no answer is not asked of anyone: the quote is held, with the doubt, for the business', async () => {
    for (const fieldId of [undefined, 'not_a_field', 'notes_extra']) {
      const result = await evaluateQualityGate(gateInput({ quantityConcern: { reason: 'The photos suggest a larger job than described.', fieldId } }), null)
      expect(result.action, String(fieldId)).toBe('require_review')
      expect(result.reason).toBe('The photos suggest a larger job than described.')
      expect(result.questions).toBeUndefined()
    }
  })

  it('a value read from the job is confirmed in words for who answers, with one press for "yes"', async () => {
    const signals = structured([{ key: 'ceiling_height', value: 9, confidence: 0.4, source: 'vision', evidence: 'Seen in photo 2' }])
    const forBusiness = await evaluateQualityGate(gateInput({ audience: 'business', structuredSignals: signals }), null)
    const forCustomer = await evaluateQualityGate(gateInput({ structuredSignals: signals }), null)
    expect(forBusiness.questions![0]!.question).toBe('From the photos and details, ceiling height was estimated at 9. Is that right?')
    expect(forBusiness.questions![0]!.question).not.toMatch(/\byour\b|\bwe\b/i)
    expect(forCustomer.questions![0]!.question).toBe('From your photos and details, we estimated ceiling height: 9. Is that right?')
    expect(questionChoices(askedQuestion(forBusiness.questions![0]!)).choices).toEqual([{ label: 'Yes, 9', value: '9' }])
  })

  it('a quantity nobody gave is asked for as a number, in words for who answers; a model’s own options are never used', async () => {
    const missing = [{ signalKey: 'wall_area', stepName: 'Walls' }]
    const forBusiness = await evaluateQualityGate(gateInput({ audience: 'business', missingQuantitySignals: missing }), null)
    const forCustomer = await evaluateQualityGate(gateInput({ missingQuantitySignals: missing }), null)
    expect(forBusiness.questions![0]).toMatchObject({ targetSignalKey: 'wall_area', answerKind: 'number', question: 'What is "wall area" for this Service A job?' })
    expect(forCustomer.questions![0]!.question).toBe('Could you provide more details about "wall area" for your Service A quote?')
    expect(forBusiness.questions![0]!.options).toBeUndefined()
    // with a model: whatever options it offers are dropped
    const model = { generateWithSchema: async () => ({ questions: [{ targetSignalKey: 'wall_area', question: 'How much wall is there?', options: ['A little', 'A lot'] }] }) }
    const asked = (await evaluateQualityGate(gateInput({ audience: 'business', missingQuantitySignals: missing }), model as never)).questions![0]!
    expect(asked.question).toBe('How much wall is there?')
    expect(asked.options).toBeUndefined()
    expect(asked.answerKind).toBe('number')
    const gate = src('agents/quality-gate.ts')
    expect(gate).toContain('Do not offer answer options: the answers to choose from are added separately')
    expect(gate).toContain('Never say "your quote", "your request" or "your photos"')
  })

  it('the wording layer states the doubt as an observation that addresses nobody, and says what the evidence points to', () => {
    const wording = src('ai/wording.ts')
    expect(wording).toContain('Do not address anyone in it: no "you" and no "your"')
    expect(wording).toContain('"quantityConcernSuggestedValue"')
    // found in the full run: one photo of a two-room job was read as a doubt about the room count
    expect(wording).toContain('How many photos were sent, or')
    expect(wording).toContain('is NOT evidence that a')
    expect(wording).not.toMatch(/ONE friendly customer-facing sentence/)
    expect(src('ai/schemas.ts')).toContain('quantityConcernSuggestedValue')
    // the processor tells the gate who answers, by the one shared rule, and hands it the business's own configuration
    const processor = src('quote-processor.ts')
    expect(processor).toContain("audience: isMadeByBusiness(quoteRequest.source_json) ? 'business' : 'customer',")
    expect(processor).toContain('workSteps: rulesWithWorkSteps.workSteps || [],')
    // a reprice clears the suggestion with the doubt
    expect(src('reprice-snapshot.ts')).toContain('quantityConcernSuggestedValue: undefined')
  })
})

// ---------------------------------------------------------------------------
// 3. The note
// ---------------------------------------------------------------------------

describe('T-188: "Why (for your records)" is the business’s own record', () => {
  it('a note is trimmed and cut to its limit; nothing is not a note', () => {
    expect(answerNote('  the customer   showed me\nthe wall ')).toBe('the customer showed me the wall')
    expect(answerNote('x'.repeat(ANSWER_NOTE_MAX + 50))).toHaveLength(ANSWER_NOTE_MAX)
    for (const nothing of ['', '   ', null, undefined, 12, {}]) expect(answerNote(nothing)).toBeNull()
  })

  it('the worker never reads it: no price rule and no prompt is given an answer’s note', () => {
    const files = ['quote-processor.ts', 'agents/quality-gate.ts', 'agents/question-choices.ts', 'ai/wording.ts', 'ai/signals.ts', 'ai/quote-validator.ts', 'pricing/rules-engine.ts', 'reprice-snapshot.ts', 'takeoff.ts', 'section-pricing.ts']
    // (one other thing in the worker is called a note: the line the processor adds when the photos and the
    // answers disagree about condition, `conditionDiscrepancy.note`; it is not an answer's)
    for (const file of files) expect(src(file).replace(/conditionDiscrepancy\.note/g, ''), file).not.toMatch(/\.note\b(?!s)|answer\.note|['"]note['"]/)
    // an answer is read as its question and its value, nothing more
    const processor = src('quote-processor.ts')
    expect(processor).toContain('clarification_answers_json?: Array<{ questionId: string; answer: string }> | null')
    expect(processor).toContain("const raw = String(answer.answer ?? '').trim()")
  })
})

// ---------------------------------------------------------------------------
// 4. Where a line came from
// ---------------------------------------------------------------------------

const legacy = (): ExtractedSignals => ({
  category: 'general',
  materials: [],
  condition: { rating: 'good' },
  complexity: { level: 'medium', factors: [] },
  access: { difficulty: 'easy' },
  observations: [],
  warnings: [],
  confidence: 0.9,
  siteVisitRecommended: false,
})
const noTax: TaxConfig = { enabled: false, rate: 0, label: 'Tax' }
const RULES = (): PricingRules => ({ baseFee: 0, minimumCharge: 0, addons: [{ id: 'addon_trim', label: 'Trim and doors', price: 200 }], multipliers: [], workSteps: STEPS })
const ANSWERS = [{ fieldId: 'room_count', value: 2 }, { fieldId: 'has_covering', value: false }]

describe('T-188: a line the product added says where it came from, never "Your fixed price"', () => {
  const priced = (signal: ExtractedSignalsV2['signals'][number], extra: { answers?: typeof ANSWERS; aiAddons?: Set<string>; photoAddons?: Set<string> } = {}) => {
    const signals = structured([signal])
    const answers = [...(extra.answers ?? ANSWERS), ...[...(extra.aiAddons ?? [])].map((id) => ({ fieldId: id, value: true as unknown as number }))]
    const { result, trace } = calculatePricingWithTrace(RULES(), legacy(), signals, answers, noTax, 'USD', undefined, undefined, extra.aiAddons)
    const takeoff = buildTakeoff({ trace, structuredSignals: signals, workSteps: STEPS, ...(extra.photoAddons && { photoAddonIds: extra.photoAddons }) })
    return { lines: withLineSources(result.breakdown, takeoff), takeoff, result }
  }
  const sourceOf = (lines: Array<{ label: string; source?: unknown }>, name: string) => lines.find((l) => l.label.startsWith(name))?.source

  it('heavy prep switched on by what the photos show: "From the photos"', () => {
    const { lines, result } = priced({ key: 'needs_prep', value: true, confidence: 0.8, source: 'vision', evidence: 'A crack in photo 2' })
    expect(sourceOf(lines, 'Heavy prep')).toBe('seen')
    expect(businessSources(lines.map((l) => ({ label: l.label, amount: l.amount, source: l.source })))).toEqual(["The customer's answer", 'From the photos'])
    // on a quote the business made: its own answer, and still "From the photos"
    expect(businessSources(lines.map((l) => ({ label: l.label, amount: l.amount, source: l.source })), undefined, { madeByBusiness: true })).toEqual(['Your answer', 'From the photos'])
    // no amount moved: the line is the business's own price
    expect(result.breakdown.find((l) => l.label.startsWith('Heavy prep'))!.amount).toBe(250)
    expect(result.total).toBe(1000)
  })

  it('switched on by what was written: "From the notes"', () => {
    const { lines } = priced({ key: 'needs_prep', value: true, confidence: 0.8, source: 'nlp', evidence: 'They wrote that the wall is cracked' })
    expect(sourceOf(lines, 'Heavy prep')).toBe('words')
    expect(sourceForBusiness({ source: 'words' })).toBe('From the notes')
    expect(sourceForBusiness({ source: 'words' }, { madeByBusiness: true })).toBe('From the notes')
  })

  it('switched on by an answer, or confirmed: the answer, as before', () => {
    expect(sourceOf(priced({ key: 'needs_prep', value: true, confidence: 1, source: 'form' }).lines, 'Heavy prep')).toBe('answer')
    expect(addedBecause({ key: 'k', value: true, confidence: 0.6, source: 'inferred' })).toBe('details')
  })

  it('an extra the product added: from the photos when the photos called for it, otherwise from the notes', () => {
    const none = { key: 'needs_prep', value: false, confidence: 0.9, source: 'vision' as const }
    const fromNotes = priced(none, { aiAddons: new Set(['addon_trim']) })
    // it read "The customer's choice" until T-188: the takeoff looked for a mark the engine never writes
    expect(fromNotes.takeoff.find((row) => row.item === 'Trim and doors')?.source).toBe('words')
    expect(sourceOf(fromNotes.lines, 'Trim and doors')).toBe('words')
    expect(sourceForBusiness({ source: sourceOf(fromNotes.lines, 'Trim and doors') })).toBe('From the notes')
    const fromPhotos = priced(none, { aiAddons: new Set(['addon_trim']), photoAddons: new Set(['addon_trim']) })
    expect(sourceOf(fromPhotos.lines, 'Trim and doors')).toBe('seen')
    expect(fromPhotos.result.total).toBe(fromNotes.result.total)
    // an extra the customer chose is still their choice
    const chosen = priced(none, { answers: [...ANSWERS, { fieldId: 'addon_trim', value: true as unknown as number }] })
    expect(sourceOf(chosen.lines, 'Trim and doors')).toBe('choice')
  })

  it('a step the price list always charges, and one an answer sizes, read as before', () => {
    const { lines } = priced({ key: 'needs_prep', value: false, confidence: 0.9, source: 'vision' })
    expect(lines.map((l) => l.source)).toEqual(['answer'])
    expect(sourceForBusiness({ source: 'fixed' })).toBe('Your fixed price')
    expect([isAddedByProduct('seen'), isAddedByProduct('words'), isAddedByProduct('fixed'), isAddedByProduct('answer')]).toEqual([true, true, false, false])
  })

  it('the processor remembers which extras the photos called for, and keeps it through a reprice', () => {
    const processor = src('quote-processor.ts')
    expect(processor).toContain('photoAddonIds.add(detected.addonId)')
    expect(processor).toContain("(pricing.recommendedAddons ?? []).filter((a) => a.source === 'image_signal')")
    expect(processor).toContain('photoAddonIds: [...photoAddonIds],')
    expect(processor).toContain('for (const addonId of reprice.photoAddonIds ?? []) photoAddonIds.add(addonId)')
  })
})

// a question as it travels to whoever answers it
describe('T-188: what a question carries to the screen', () => {
  it('its words and its choices; never the key it fills', () => {
    const stored: ClarificationQuestion = { id: 'cq_1', targetSignalKey: 'has_covering', question: 'Q?', choices: [{ label: 'Keep X', value: 'true' }, { label: 'No X', value: 'No' }], closed: true }
    expect(askedQuestion(stored)).toEqual({ id: 'cq_1', question: 'Q?', choices: [{ label: 'Keep X', value: 'true' }, { label: 'No X', value: 'No' }], closed: true })
    const drawn = questionChoices(askedQuestion(stored))
    expect(drawn.choices).toEqual([{ label: 'Keep X', value: 'true' }, { label: 'No X', value: 'No' }])
    // every possible answer is there, so no "Other"
    expect(drawn.otherLabel).toBeNull()
  })
})
