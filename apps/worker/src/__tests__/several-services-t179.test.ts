/**
 * T-179: one request, several services. The worker's side:
 *   - finding what else the customer asked for, with every check made in code;
 *   - the prompt built from the business's configuration, with no trade in it;
 *   - what an added service still needs to be asked before its price stands;
 *   - pre-filled answers are suggestions, shaped to their question.
 * Fixture names are generic on purpose.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildDetectionPrompt, validateDetection, declinedOrOnlyAsked, coveredByMainService, sentenceAround, keyWords, detectServicesFromDescription, DETECTION_MIN_CONFIDENCE } from '../ai/service-detection'
import type { MainServiceContext, ServiceForMatching } from '../ai/service-detection'
import { buildPrefillPrompt, readPrefill, prefillSectionAnswers } from '../ai/cross-service'
import { fieldsForService, cleanAnswers, questionsFor, quantityKeysOf, labelledAnswers, withoutMentionsOf } from '../section-pricing'
import type { SectionRun } from '../quote-processor'
import type { SectionQuestion, WidgetField } from '@qolumns/shared'
import type { AiClient } from '../ai/client'

afterEach(() => vi.restoreAllMocks())

const MAIN: MainServiceContext = { name: 'Service Alpha', description: 'The alpha visit', scopeIncludes: ['One alpha visit', 'Alpha inspection'], scopeExcludes: ['Gamma units'], addons: ['Alpha polish'] }
const BETA: ServiceForMatching = { id: 'svc_beta', name: 'Service Beta', description: 'The beta job', scopeIncludes: ['One beta job'], scopeExcludes: [] }
const GAMMA: ServiceForMatching = { id: 'svc_gamma', name: 'Service Gamma', description: 'Gamma units fitted', scopeIncludes: ['Fitting gamma units'] }
const OTHERS = [BETA, GAMMA]
const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined)
const request = (over: Record<string, unknown>) => ({ serviceId: 'svc_beta', serviceName: 'Service Beta', confidence: 0.95, reason: 'Asks for it.', matchedPhrase: 'I also need service beta done', ...over })

describe('the detection prompt comes from the business’s configuration', () => {
  const note = 'An alpha visit please. I also need service beta done.'
  const prompt = buildDetectionPrompt(MAIN, note, OTHERS)

  it('carries the chosen service’s description, includes, add-ons and excludes, and the other services’ scope', () => {
    expect(prompt).toContain('name: Service Alpha')
    expect(prompt).toContain('includes: One alpha visit; Alpha inspection')
    expect(prompt).toContain('options and add-ons: Alpha polish')
    expect(prompt).toContain('does NOT include: Gamma units')
    expect(prompt).toContain('- id: svc_beta\n  name: Service Beta\n  about: The beta job\n  includes: One beta job')
    expect(prompt).toContain('- id: svc_gamma')
  })

  it('fences the note as data', () => {
    expect(prompt).toMatch(/<<<NOTE\nAn alpha visit please\. I also need service beta done\.\nNOTE>>>/)
  })

  it('has no trade, service name or keyword list of its own: the fixed text is the same for any business', () => {
    const strip = (p: string, main: MainServiceContext, others: ServiceForMatching[], words: string) => {
      let text = p.replace(words, '<note>')
      const block = (lead: string, s: { name: string; description?: string | null; scopeIncludes?: string[] | null }) =>
        `${lead}\n  name: ${s.name}\n  about: ${s.description}\n  includes: ${(s.scopeIncludes ?? []).join('; ')}`
      text = text.replace(block('-', main), '<main>')
      for (const s of others) text = text.replace(block(`- id: ${s.id}`, s), '<other>')
      return text
    }
    const m1: MainServiceContext = { name: 'First Thing', description: 'the first thing', scopeIncludes: ['a'] }
    const o1: ServiceForMatching[] = [{ id: 'svc_1', name: 'Second Thing', description: 'the second thing', scopeIncludes: ['b'] }]
    const m2: MainServiceContext = { name: 'Third Thing', description: 'the third thing', scopeIncludes: ['c'] }
    const o2: ServiceForMatching[] = [{ id: 'svc_2', name: 'Fourth Thing', description: 'the fourth thing', scopeIncludes: ['d'] }]
    const a = strip(buildDetectionPrompt(m1, 'first words here', o1), m1, o1, 'first words here')
    const b = strip(buildDetectionPrompt(m2, 'other words here', o2), m2, o2, 'other words here')
    expect(a).toBe(b)
    expect(a).not.toMatch(/Thing|svc_/)
    // the trade examples the old prompt carried are gone
    expect(a).not.toMatch(/carpet|painting|window|gutter|fence|smart home|door bars|underlay/i)
    expect(a).not.toMatch(/\bIT\b/)
  })
})

describe('every answer of the model is checked in code', () => {
  const note = 'An alpha visit please. I also need service beta done while you are here.'
  const check = (requests: unknown[], text = note) => {
    quiet()
    return validateDetection({ requests }, MAIN, text, OTHERS)
  }

  it('an explicit request for another offered service is kept, under the business’s own name for it', () => {
    const result = check([request({ serviceName: 'Something the model made up' })])
    expect(result.services).toEqual([{ serviceId: 'svc_beta', serviceName: 'Service Beta', confidence: 0.95, reason: 'Asks for it.', matchedPhrase: 'I also need service beta done' }])
    expect(result.notOffered).toEqual([])
  })

  it('AD-008: a phrase that is not literally in the note is dropped; so is low confidence, and a phrase too short to mean anything', () => {
    expect(check([request({ matchedPhrase: 'would like the beta job as well' })]).services).toEqual([])
    expect(check([request({ confidence: DETECTION_MIN_CONFIDENCE - 0.01 })]).services).toEqual([])
    expect(check([request({ matchedPhrase: 'beta' })]).services).toEqual([])
  })

  it('AD-010: the matched service’s name must share a key word with what was asked for', () => {
    const text = 'An alpha visit please. I also need the gamma units fitted.'
    expect(check([request({ matchedPhrase: 'I also need the gamma units fitted' })], text).services).toEqual([])
    expect(check([request({ serviceId: 'svc_gamma', matchedPhrase: 'I also need the gamma units fitted' })], text).services.map((s) => s.serviceId)).toEqual(['svc_gamma'])
  })

  it('"I don’t need X" is not a request, whatever the model says', () => {
    for (const text of ['An alpha visit please. I don’t need service beta this time.', "An alpha visit. I don't need service beta.", 'An alpha visit, no need for service beta.', 'An alpha visit without service beta please.']) {
      expect(check([request({ matchedPhrase: 'service beta', confidence: 0.99 })], text).services, text).toEqual([])
    }
  })

  it('a question about what is included is not a request', () => {
    for (const text of ['An alpha visit please. Is service beta included in the price?', 'An alpha visit. Please confirm if service beta is included.', 'Does the visit come with service beta?']) {
      expect(check([request({ matchedPhrase: 'service beta', confidence: 0.99 })], text).services, text).toEqual([])
    }
    // … but asking for it with a question mark is still asking for it
    expect(check([request({ matchedPhrase: 'can you also do service beta' })], 'An alpha visit, and can you also do service beta?').services).toHaveLength(1)
  })

  it('something the chosen service already covers (its includes, its add-ons) is not another service, and not "not offered"', () => {
    const text = 'An alpha visit please. I also need the alpha inspection and the alpha polish.'
    expect(check([request({ serviceId: null, matchedPhrase: 'I also need the alpha inspection' })], text)).toEqual({ services: [], notOffered: [] })
    expect(check([request({ serviceId: null, matchedPhrase: 'the alpha polish' })], text)).toEqual({ services: [], notOffered: [] })
    expect(coveredByMainService('I also need the alpha inspection', MAIN)).toBe(true)
    expect(coveredByMainService('I also need service beta done', MAIN)).toBe(false)
  })

  it('something no service covers is kept as "not offered", with the customer’s words and nothing else', () => {
    const text = 'An alpha visit please, and can you also repaint my boat?'
    const result = check([request({ serviceId: null, serviceName: null, matchedPhrase: 'can you also repaint my boat' })], text)
    expect(result).toEqual({ services: [], notOffered: [{ words: 'can you also repaint my boat' }] })
    // a "not offered" phrase that names one of the business's services after all is dropped rather than guessed at
    expect(check([request({ serviceId: null, matchedPhrase: 'I also need service beta done' })]).notOffered).toEqual([])
    // an id that is not one of the business's is not "not offered" either
    expect(check([request({ serviceId: 'svc_made_up' })])).toEqual({ services: [], notOffered: [] })
  })

  it('the old array answer is still read; junk is nothing', () => {
    quiet()
    expect(validateDetection([request({})], MAIN, note, OTHERS).services).toHaveLength(1)
    expect(validateDetection('nonsense', MAIN, note, OTHERS)).toEqual({ services: [], notOffered: [] })
    expect(validateDetection(null, MAIN, note, OTHERS)).toEqual({ services: [], notOffered: [] })
  })

  it('a failing model means "nothing else", never an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { generateText: async () => { throw new Error('down') } } as unknown as AiClient
    expect(await detectServicesFromDescription(broken, MAIN, note, OTHERS)).toEqual({ services: [], notOffered: [] })
    const never = { generateText: vi.fn() } as unknown as AiClient
    expect(await detectServicesFromDescription(never, MAIN, 'short', OTHERS)).toEqual({ services: [], notOffered: [] })
  })

  it('the plain-language helpers', () => {
    expect(sentenceAround('First thing. I also need service beta done. Thanks.', 'service beta')).toBe('I also need service beta done.')
    expect(keyWords('I also need the gamma units fitted')).toEqual(['gamma', 'units', 'fitted'])
    expect(declinedOrOnlyAsked('I need service beta. I do not need service gamma.', 'service beta')).toBe(false)
    expect(declinedOrOnlyAsked('I need service beta. I do not need service gamma.', 'service gamma')).toBe(true)
  })
})

describe('an added service’s own questions', () => {
  const rows = [
    { service_id: null, config_json: { fields: [{ fieldId: 'when', type: 'text', label: 'When?', required: true }, { fieldId: 'beta_only', type: 'text', label: 'Beta only', required: true, serviceId: 'svc_beta' }, { fieldId: '_project_description', type: 'text', label: 'Anything else', required: false }] } },
    { service_id: 'svc_gamma', config_json: { fields: [{ fieldId: 'gamma_count', type: 'number', label: 'How many gamma units?', required: true }, { fieldId: 'gamma_size', type: 'select', label: 'Which size?', required: true, options: [{ value: 'Small', label: 'Small' }, { value: 'Large', label: 'Large' }] }, { fieldId: 'gamma_note', type: 'text', label: 'Anything to know?', required: false }] } },
    { service_id: 'svc_beta', config_json: { fields: [{ fieldId: 'gamma_count', type: 'number', label: 'Wrong service', required: true }] } },
  ] as Parameters<typeof fieldsForService>[0]
  const fields = fieldsForService(rows, 'svc_gamma')

  it('are the service’s own row plus the business-wide ones that apply to it', () => {
    expect(fields.map((f) => [f.fieldId, f.shared])).toEqual([['gamma_count', false], ['gamma_size', false], ['gamma_note', false], ['when', true]])
    expect(fields.find((f) => f.fieldId === 'gamma_count')?.label).toBe('How many gamma units?')
  })

  it('answers are shaped to their question: a number, one of the options, or not an answer at all', () => {
    const cleaned = cleanAnswers(
      [
        { fieldId: 'gamma_count', value: '1,200' },
        { fieldId: 'gamma_size', value: 'large' },
        { fieldId: 'gamma_note', value: '  side   gate  ' },
        { fieldId: 'not_a_question', value: 'x' },
        { fieldId: 'measured_area', value: '42' },
      ],
      fields,
      new Set(['measured_area'])
    )
    expect(cleaned).toEqual([
      { fieldId: 'gamma_count', value: 1200 },
      { fieldId: 'gamma_size', value: 'Large' },
      { fieldId: 'gamma_note', value: 'side gate' },
      { fieldId: 'measured_area', value: 42 },
    ])
    expect(cleanAnswers([{ fieldId: 'gamma_size', value: 'Enormous' }, { fieldId: 'gamma_count', value: 'lots' }, { fieldId: 'measured_area', value: 0 }], fields, new Set(['measured_area']))).toEqual([])
  })

  const run = (over: Partial<SectionRun>): SectionRun =>
    ({
      service: { name: 'Service Gamma', expected_signals: [{ signalKey: 'measured_area', type: 'number', description: 'Area to cover', unit: 'sq ft' }] },
      widgetFields: [],
      rules: { workSteps: [] },
      answers: [],
      pricing: { subtotal: 0, breakdown: [] },
      pricingTrace: { trace: [] },
      missingQuantitySignals: [],
      ...over,
    }) as unknown as SectionRun

  it('asks only what is required or price-critical and not yet answered', () => {
    expect(questionsFor(run({}), fields, []).map((q) => q.key)).toEqual(['gamma_count', 'gamma_size', 'when'])
    expect(questionsFor(run({}), fields, [{ fieldId: 'gamma_count', value: 3 }, { fieldId: 'when', value: 'Monday' }]).map((q) => q.key)).toEqual(['gamma_size'])
    const size = questionsFor(run({}), fields, []).find((q) => q.key === 'gamma_size')!
    expect(size).toEqual({ key: 'gamma_size', label: 'Which size?', type: 'select', options: [{ value: 'Small', label: 'Small' }, { value: 'Large', label: 'Large' }] })
  })

  it('a quantity it would have measured from photos is asked of the customer, in the business’s own description and unit', () => {
    const answered = [{ fieldId: 'gamma_count', value: 3 }, { fieldId: 'gamma_size', value: 'Small' }, { fieldId: 'when', value: 'Monday' }]
    const asked = questionsFor(run({ missingQuantitySignals: [{ signalKey: 'measured_area', stepName: 'Covering' }] }), fields, answered)
    expect(asked).toEqual([{ key: 'measured_area', label: 'Area to cover', type: 'number', unit: 'sq ft' }])
    expect(questionsFor(run({ missingQuantitySignals: [{ signalKey: 'measured_area', stepName: 'Covering' }] }), fields, [...answered, { fieldId: 'measured_area', value: 42 }])).toEqual([])
  })

  it('a line the engine could only price with a placeholder quantity is asked for; so is "how many" for a per-unit price', () => {
    const answered = [{ fieldId: 'gamma_count', value: 3 }, { fieldId: 'gamma_size', value: 'Small' }, { fieldId: 'when', value: 'Monday' }]
    const placeholder = run({
      rules: { workSteps: [{ id: 'extra', name: 'Extra lengths', costType: 'per_unit', defaultCost: 5, optional: false, quantitySource: { type: 'form_field', fieldId: 'extra_count' } }] } as never,
      pricingTrace: { trace: [{ type: 'work_step', id: 'extra', quantitySource: 'legacy_fallback' }] } as never,
    })
    expect(questionsFor(placeholder, fields, answered)).toEqual([{ key: 'extra_count', label: 'Extra lengths', type: 'number' }])
    const perUnit = run({ rules: { workSteps: [], measurementModel: { type: 'per_unit', pricePerUnit: 4, unit: 'sqft', unitLabel: 'square feet' } } as never })
    expect(questionsFor(perUnit, fields, answered)).toEqual([{ key: '_quantity', label: 'How many square feet?', type: 'number', unit: 'square feet' }])
    expect(questionsFor(perUnit, fields, [...answered, { fieldId: '_quantity', value: 120 }])).toEqual([])
    expect([...quantityKeysOf(placeholder)]).toEqual(['_quantity', 'extra_count'])
  })

  it('the stored answers carry the question’s wording', () => {
    const known: SectionQuestion[] = [{ key: 'measured_area', label: 'Area to cover', type: 'number' }]
    expect(labelledAnswers([{ fieldId: 'gamma_count', value: 3 }, { fieldId: 'measured_area', value: 42 }, { fieldId: 'unknown', value: ['a', 'b'] }], fields as WidgetField[], known)).toEqual([
      { key: 'gamma_count', label: 'How many gamma units?', value: 3 },
      { key: 'measured_area', label: 'Area to cover', value: 42 },
      { key: 'unknown', label: 'unknown', value: 'a, b' },
    ])
  })
})

describe('answers read from the note are only suggestions, shaped to their question', () => {
  const questions: SectionQuestion[] = [
    { key: 'gamma_count', label: 'How many gamma units?', type: 'number' },
    { key: 'gamma_size', label: 'Which size?', type: 'select', options: [{ value: 'Small', label: 'Small' }, { value: 'Large', label: 'Large' }] },
    { key: 'ground_floor', label: 'Is it on the ground floor?', type: 'boolean' },
    { key: 'access', label: 'How do we get in?', type: 'text' },
  ]

  it('the prompt is the business’s questions and the note, nothing about a trade', () => {
    const prompt = buildPrefillPrompt('Service Gamma', questions, 'three gamma units, large ones')
    expect(prompt).toContain('- key: gamma_size\n  question: Which size?\n  answer is: one of: "Small", "Large"')
    expect(prompt).toMatch(/<<<NOTE\nthree gamma units, large ones\nNOTE>>>/)
    expect(prompt).toContain('give null')
  })

  it('keeps a number, an option exactly as the business wrote it, true or false, and a few words; drops everything else', () => {
    expect(readPrefill({ answers: { gamma_count: '3', gamma_size: 'large', ground_floor: true, access: ' side  gate ' } }, questions)).toEqual({ gamma_count: 3, gamma_size: 'Large', ground_floor: true, access: 'side gate' })
    expect(readPrefill({ answers: { gamma_count: 'a few', gamma_size: 'Huge', ground_floor: 'maybe', access: null, not_asked: 5 } }, questions)).toEqual({})
    expect(readPrefill(null, questions)).toEqual({})
    expect(readPrefill({ answers: 'x' }, questions)).toEqual({})
  })

  it('a failing model means "no suggestions": the customer is simply asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { generateText: async () => { throw new Error('down') } } as unknown as AiClient
    expect(await prefillSectionAnswers(broken, 'Service Gamma', questions, 'three gamma units please')).toEqual({})
    const never = { generateText: vi.fn() } as unknown as AiClient
    expect(await prefillSectionAnswers(never, 'Service Gamma', [], 'three gamma units please')).toEqual({})
    expect((never.generateText as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})

describe('the main service’s wording never calls an addable service "not included"', () => {
  it('drops an exclusion and a sentence of the notes that name it, and nothing else', () => {
    const content = {
      scopeSummary: 'An alpha visit.',
      exclusions: ['Service Beta work', 'Anything outside the visit'],
      notes: 'Bring a ladder. Additional services like Service Beta can be quoted separately. Thank you!',
    }
    expect(withoutMentionsOf(content, ['Service Beta'])).toEqual({
      scopeSummary: 'An alpha visit.',
      exclusions: ['Anything outside the visit'],
      notes: 'Bring a ladder. Thank you!',
    })
    expect(withoutMentionsOf(content, [])).toBe(content)
    expect(withoutMentionsOf({ notes: 'All about Service Beta.' }, ['service beta'])).toEqual({ notes: '' })
  })
})
