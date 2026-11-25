/**
 * T-204 item 8: the question a customer is asked is plain and short, and speaks to them.
 *
 * The live test showed one that read like a report about the customer ("The project description
 * specifies…, but the form answer selects…. Which is right?"). The wording model now also writes
 * the doubt as one short question to the customer, the question gate checks it in code before a
 * customer reads it, and a text that fails is replaced by a question built from the business's
 * own question. No model is asked here: the gate is called with none, or with a scripted one.
 *
 * Every name below is the fixture's own: nothing in the code under test knows a trade.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { ExtractedSignalsV2, WorkStepConfig } from '@qolumns/shared'
import { CUSTOMER_QUESTION_MAX_CHARS, doubtQuestionFromLabel, evaluateQualityGate, plainCustomerQuestion, type QualityGateInput } from '../agents/quality-gate'
import { WORDING_PROMPT, generateWording, type WordingContext } from '../ai/wording'

const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const STEPS: WorkStepConfig[] = [
  { id: 'units', name: 'Units fitted', description: '', costType: 'per_unit', defaultCost: 300, optional: false, unitLabel: 'unit', quantitySource: { type: 'form_field', fieldId: 'unit_count' } },
  { id: 'access', name: 'Awkward access', description: '', costType: 'fixed', defaultCost: 90, optional: true, when: { fieldId: 'awkward_access', equals: true } },
]
const FIELDS = [
  { fieldId: 'unit_count', label: 'How many units do you need', type: 'number' },
  { fieldId: 'awkward_access', label: 'Is access awkward?', type: 'boolean' },
]
const structured = (): ExtractedSignalsV2 => ({
  extractedAt: '2026-01-01T00:00:00.000Z',
  overallConfidence: 0.9,
  signals: [],
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})
const gateInput = (over: Partial<QualityGateInput>): QualityGateInput =>
  ({
    structuredSignals: structured(),
    fusionResult: null,
    pricing: { currency: 'USD', subtotal: 900, taxLabel: 'Tax', taxRate: 0, taxAmount: 0, total: 900, breakdown: [{ label: 'Units fitted', amount: 900 }], notes: [], confidence: 0.9 },
    clarificationCount: 0,
    serviceName: 'Service A',
    hasPhotos: true,
    workStepsConfigured: 2,
    workStepLinesPriced: 1,
    choiceContext: { fields: FIELDS, workSteps: STEPS, addons: [], answers: [{ fieldId: 'unit_count', value: 3 }, { fieldId: 'awkward_access', value: false }] },
    ...over,
  }) as QualityGateInput

const REPORT = 'The project description specifies the workshop and possibly one more room, but the form answer selects 3 units.'
const PLAIN = 'You mentioned the workshop and maybe one more room, but picked 3 units. How many units do you need?'

describe('T-204 item 8: the check in code that a customer’s question is plain and short', () => {
  it('a plain, short question passes untouched (spaces tidied)', () => {
    expect(plainCustomerQuestion(PLAIN)).toBe(PLAIN)
    expect(plainCustomerQuestion('  How many   units do you need? ')).toBe('How many units do you need?')
    expect(plainCustomerQuestion('The photos show two doors, not one. Which is right?')).toBe('The photos show two doors, not one. Which is right?')
  })

  it('a report about the customer is refused: the live example, and its relatives', () => {
    for (const text of [
      `${REPORT} Which is right?`,
      'The customer selected 3 units but the notes mention one. Which is right?',
      'The form says 3 units. Is that right?',
      'The description mentions a workshop. How many units?',
      'The customer’s notes mention one room. How many units?',
      'The form answer is 3. Is that correct?',
      'The photos indicate a larger job. How many units?',
      'Low confidence for the count. How many units?',
      'What is the unit_count for this job?',
    ]) expect(plainCustomerQuestion(text), text).toBeNull()
  })

  it('…as is anything that is not a question, is empty, or is long', () => {
    expect(plainCustomerQuestion('You picked 3 units.')).toBeNull()
    expect(plainCustomerQuestion('')).toBeNull()
    expect(plainCustomerQuestion(undefined)).toBeNull()
    const long = `You mentioned ${'a room and '.repeat(30)}another. How many?`
    expect(long.length).toBeGreaterThan(CUSTOMER_QUESTION_MAX_CHARS)
    expect(plainCustomerQuestion(long)).toBeNull()
  })

  it('the check knows how a sentence talks, never what the job is: no trade word is in it', () => {
    const gate = code('agents/quality-gate.ts')
    const patterns = gate.slice(gate.indexOf('const REPORT_STYLE'), gate.indexOf('export function plainCustomerQuestion'))
    expect(patterns).not.toMatch(/room|garage|bedroom|cool|paint|heater|door|gallon|hour|unit/i)
  })
})

describe('T-204 item 8: a doubt about the customer’s own answer, as the customer is asked it', () => {
  const concern = (over: Partial<NonNullable<QualityGateInput['quantityConcern']>> = {}) => ({ reason: REPORT, fieldId: 'unit_count', suggested: '2', ...over })

  it('the wording layer’s plain question is what the customer reads, with the same choices as before', async () => {
    const result = await evaluateQualityGate(gateInput({ quantityConcern: concern({ customerQuestion: PLAIN }) }), null)
    expect(result.action).toBe('ask_clarification')
    const asked = result.questions![0]!
    expect(asked.question).toBe(PLAIN)
    expect(asked.question).not.toMatch(/project description|specifies|form answer|Which is right/)
    expect(asked.choices).toEqual([{ label: 'Keep 3 units', value: '3' }, { label: '2 units', value: '2' }])
    expect(asked.answerKind).toBe('number')
    expect(asked.targetSignalKey).toBe('unit_count')
  })

  it('when that question is itself a report, or missing, and the observation is one too: a question built from the business’s own', async () => {
    const built = 'You answered “3” to “How many units do you need?” Is that right?'
    for (const customerQuestion of [undefined, '', `${REPORT} How many?`, 'You picked 3 units.']) {
      const result = await evaluateQualityGate(gateInput({ quantityConcern: concern({ customerQuestion }) }), null)
      expect(result.questions![0]!.question, String(customerQuestion)).toBe(built)
      expect(result.questions![0]!.choices!.map((c) => c.label)).toEqual(['Keep 3 units', '2 units'])
    }
    expect(doubtQuestionFromLabel('unit_count', { fields: FIELDS, answers: [{ fieldId: 'unit_count', value: 3 }] })).toBe(built)
    expect(doubtQuestionFromLabel('awkward_access', { fields: FIELDS, answers: [{ fieldId: 'awkward_access', value: false }] })).toBe('You answered “No” to “Is access awkward?” Is that right?')
    // nothing to build from: no label, or no answer
    expect(doubtQuestionFromLabel('unit_count', { fields: [], answers: [{ fieldId: 'unit_count', value: 3 }] })).toBeNull()
    expect(doubtQuestionFromLabel('unit_count', { fields: FIELDS, answers: [] })).toBeNull()
    expect(doubtQuestionFromLabel(undefined, { fields: FIELDS, answers: [] })).toBeNull()
  })

  it('an observation that already reads plainly is asked as before (T-188), when no question was written', async () => {
    const result = await evaluateQualityGate(gateInput({ quantityConcern: { reason: 'The photos show two units, not three.', fieldId: 'unit_count', suggested: '2' } }), null)
    expect(result.questions![0]!.question).toBe('The photos show two units, not three. Which is right?')
  })

  it('a quote the business made is still asked in the business’s words: the customer’s question is never used there', async () => {
    const result = await evaluateQualityGate(gateInput({ audience: 'business', quantityConcern: concern({ customerQuestion: PLAIN }) }), null)
    expect(result.questions![0]!.question).toBe(`${REPORT} Which is right?`)
    expect(result.questions![0]!.question).not.toContain('You mentioned')
  })

  it('a doubt nobody can answer is still not asked: the business gets the observation, never the customer’s wording', async () => {
    const result = await evaluateQualityGate(gateInput({ quantityConcern: { reason: 'The photos suggest a larger job than described.', fieldId: 'not_a_field', customerQuestion: PLAIN } }), null)
    expect(result.action).toBe('require_review')
    expect(result.reason).toBe('The photos suggest a larger job than described.')
  })
})

describe('T-204 item 8: a value nobody gave, asked plainly', () => {
  const missing = [{ signalKey: 'unit_count', stepName: 'Units fitted' }]
  const noAnswer = { fields: FIELDS, workSteps: STEPS, addons: [], answers: [] }

  it('with no model: the business’s own question for that value, with a question mark; never "Could you provide more details about…"', async () => {
    const result = await evaluateQualityGate(gateInput({ missingQuantitySignals: missing, choiceContext: noAnswer }), null)
    expect(result.questions![0]).toMatchObject({ targetSignalKey: 'unit_count', question: 'How many units do you need?', answerKind: 'number' })
    const other = await evaluateQualityGate(gateInput({ missingQuantitySignals: [{ signalKey: 'floor_area', stepName: 'Floor' }], choiceContext: noAnswer }), null)
    expect(other.questions![0]!.question).toBe('What is the floor area for this job?')
    expect(code('agents/quality-gate.ts')).not.toContain('Could you provide more details')
  })

  it('a model’s plain question is used; a report from the model is replaced by the business’s own question', async () => {
    const scripted = (question: string) => ({ generateWithSchema: async () => ({ questions: [{ targetSignalKey: 'unit_count', question }] }) })
    const plain = await evaluateQualityGate(gateInput({ missingQuantitySignals: missing, choiceContext: noAnswer }), scripted('You mentioned a workshop. How many units should we fit?') as never)
    expect(plain.questions![0]!.question).toBe('You mentioned a workshop. How many units should we fit?')
    const report = await evaluateQualityGate(gateInput({ missingQuantitySignals: missing, choiceContext: noAnswer }), scripted('The project description specifies a workshop, but unit_count could not be measured. Could you provide it?') as never)
    expect(report.questions![0]!.question).toBe('How many units do you need?')
  })

  it('the model is asked for a short, plain question spoken to the customer, and is never handed a trade example', async () => {
    let prompt = ''
    let system = ''
    const model = {
      generateWithSchema: async (p: string, _schema: unknown, s: string) => {
        prompt = p
        system = s
        return { questions: [{ targetSignalKey: 'unit_count', question: 'How many units do you need?' }] }
      },
    }
    await evaluateQualityGate(gateInput({ missingQuantitySignals: missing, choiceContext: noAnswer }), model as never)
    expect(prompt).toContain('Speak to the customer as "you"')
    expect(prompt).toContain('At most 30 words')
    expect(prompt).toMatch(/Never write like a report/)
    expect(prompt).not.toMatch(/garage|bedroom|cooling|paint|heater/i)
    expect(system).toMatch(/customer/i)
  })
})

describe('T-204 item 8: the wording model writes the doubt twice: as a note for the business, and as a question for the customer', () => {
  // the wording model, scripted: it answers with whatever the test gives it
  const written = (answer: Record<string, unknown>) =>
    generateWording(
      { generateWithSchema: async () => ({ scopeSummary: 'Three units fitted in the workshop.', assumptions: ['Clear access'], exclusions: ['Making good'], notes: 'Nothing further.', validityDays: 30, serviceMismatch: false, ...answer }) } as never,
      {
        businessName: 'Harlow Fitting',
        serviceName: 'Service A',
        customerName: 'Dana Pryce',
        signals: { observations: [], materials: [], siteVisitRecommended: false, complexity: { level: 'medium', factors: [] } },
        pricing: { currency: 'USD', subtotal: 900, taxLabel: 'Tax', taxRate: 0, taxAmount: 0, total: 900, breakdown: [{ label: 'Units fitted', amount: 900 }], notes: [], confidence: 0.9 },
      } as unknown as WordingContext
    )

  it('the prompt asks for the plain question, by shape and never by a trade’s example', () => {
    const prompt = WORDING_PROMPT
    expect(prompt).toContain('"quantityConcernQuestion": ""')
    expect(prompt).toContain('spoken to them as "you"')
    expect(prompt).toContain('You mentioned <what they wrote>, but')
    expect(prompt).toContain('Leave all four as empty strings')
    const rule = prompt.slice(prompt.indexOf('Also set "quantityConcernQuestion"'), prompt.indexOf('Do NOT bury the doubt'))
    expect(rule).not.toMatch(/garage|bedroom|cooling|rooms? need/i)
    // the observation keeps its own rule: it addresses nobody (it is also the business's note)
    expect(prompt).toContain('Do not address anyone in it')
  })

  it('the answer’s question is kept when the model gives one, and the schema names it', async () => {
    expect(await written({ quantityConcern: REPORT, quantityConcernFieldId: 'unit_count', quantityConcernSuggestedValue: '2', quantityConcernQuestion: ` ${PLAIN} ` })).toMatchObject({ quantityConcern: REPORT, quantityConcernFieldId: 'unit_count', quantityConcernQuestion: PLAIN })
    expect((await written({ quantityConcern: '', quantityConcernQuestion: '' })).quantityConcernQuestion).toBeUndefined()
    expect(src('ai/schemas.ts')).toContain('quantityConcernQuestion: {')
  })

  it('the processor hands it to the gate, and it is cleared with the doubt once the customer has answered', () => {
    expect(src('quote-processor.ts')).toContain("customerQuestion: (content.quantityConcernQuestion || '').trim() || undefined")
    expect(src('reprice-snapshot.ts')).toContain('quantityConcernQuestion: undefined')
  })
})
