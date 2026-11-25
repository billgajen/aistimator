/**
 * T-204, Part A (pricing): items 1, 2, 3, 4, 5, 7, 20 and the note of item 29.
 *
 * What was wrong (item 1): "Describe your pricing" wrote the right lines for the test business's AC
 * Tune-Up, and the one real request was priced right. The dashboard's "Test Your Pricing" had its
 * own copy of the maths, which ignored a line's condition, a formula and "left empty = 0", and the
 * line editor showed none of those links. So every conditional line looked as if it was always
 * charged. The test price is now the worker's own pipeline; these tests hold the code around it.
 *
 * No model is asked here. The compile is fed recorded answers; the live compile is a script
 * (scripts/hardcore-test/t204/compile-live.mts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PHOTOS_UNREAD_NOTE,
  QUESTION_UNUSED_MEASURED_MESSAGE,
  QUESTION_UNUSED_MESSAGE,
  approvalDetail,
  dependsWordIn,
  linkPricing,
  linkWordsOf,
  optionalNumberQuestions,
  photosUnreadOf,
  photosUnreadReason,
  photosUnreadSentence,
  pricingChecks,
  type LinkField,
  type LinkStep,
} from '@qolumns/shared'
import type { ExtractedSignalsV2, SuggestedField, WorkStepConfig } from '@qolumns/shared'
import { calculatePricingWithTrace, type FormAnswer, type PricingRules } from '../../../worker/src/pricing/rules-engine'
import type { ExtractedSignals } from '../../../worker/src/ai/signals'
import { listPacks } from '@/lib/vertical-packs'
import { waterHeaterPackUS } from '@/lib/vertical-packs/water-heater-us'
import { finishCompile, COMPILE_SYSTEM_PROMPT, compileUserPrompt } from '@/lib/pricing-compile'
import { describePricingRules } from '@/lib/pricing-describe'
import { nameWarnings } from '@/lib/service-name-warnings'
import { MAX_PHOTOS_REQUIRED, photosRequired } from '@/lib/photos-required'
import { answersFromValues, photoDetails, photoKey, previewInput } from '@/lib/pricing-preview'
import { sampleKey } from '@/lib/sample-price'
import { serviceInsertRow } from '@/lib/service-rows'
import { validateAndNormalizeDraft } from '@/app/api/services/ai-draft/shared'
import { COMPILE_STEPS, compileStepAt } from '@/components/services/PricingComposer'
import { AC_TUNE_UP_CASES, AC_TUNE_UP_FIELDS, AC_TUNE_UP_STEPS, AC_TUNE_UP_TEXT } from '../../../../scripts/hardcore-test/t204/ac-tune-up'

const ROOT = join(__dirname, '../../../..')
const src = (path: string) => readFileSync(join(ROOT, 'apps/web/src', path), 'utf8')
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const repo = (path: string) => readFileSync(join(ROOT, path), 'utf8')

// ───────────────────────────── the engine, as the worker runs it ─────────────────────────────

const legacy = (): ExtractedSignals => ({ category: 'test', materials: [], condition: { rating: 'good' }, complexity: { level: 'medium', factors: [] }, access: { difficulty: 'easy' }, observations: [], warnings: [], confidence: 0.9, siteVisitRecommended: false })
const structured = (): ExtractedSignalsV2 => ({ extractedAt: new Date().toISOString(), overallConfidence: 0.95, signals: [], complexity: { level: 'medium', factors: [] }, siteVisitRecommended: false, lowConfidenceSignals: [] })
function price(workSteps: readonly unknown[], fields: readonly unknown[], values: Record<string, string | number | boolean>) {
  const rules = { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps } as unknown as PricingRules
  const answers: FormAnswer[] = Object.entries(values).map(([fieldId, value]) => ({ fieldId, value }))
  return calculatePricingWithTrace(rules, legacy(), structured(), answers, { enabled: false, rate: 0, label: 'Sales tax' }, 'USD', undefined, undefined, undefined, { name: 'Service', fields: fields as never }).result
}

// ───────────────────────────── item 1: the flags ─────────────────────────────

describe('T-204 item 1: the two flags (pricingChecks)', () => {
  it('the AC Tune-Up as compiled: every conditional line is linked, and only the two questions no line reads are flagged', () => {
    const flags = pricingChecks({ workSteps: AC_TUNE_UP_STEPS as unknown as LinkStep[], fields: AC_TUNE_UP_FIELDS as unknown as LinkField[] })
    expect(flags.filter((f) => f.kind === 'line_unlinked')).toEqual([])
    expect(flags.map((f) => (f.kind === 'question_unused' ? f.label : ''))).toEqual(['Is your AC currently cooling?', 'When was the system last serviced?'])
    expect(flags.every((f) => f.message === QUESTION_UNUSED_MESSAGE)).toBe(true)
    expect(QUESTION_UNUSED_MESSAGE).toBe('This question does not change the price')
  })

  it('a question is used when a condition, a quantity, a formula or an adjustment reads it', () => {
    const fields: LinkField[] = [
      { fieldId: 'a', label: 'A', type: 'boolean' },
      { fieldId: 'b', label: 'B', type: 'number' },
      { fieldId: 'c', label: 'C', type: 'number' },
      { fieldId: 'd', label: 'D', type: 'dropdown', options: ['x', 'y'] },
      { fieldId: 'e', label: 'E', type: 'radio', options: ['p', 'q'], mapsToSignal: 'e_fact' },
      { fieldId: 'f', label: 'F', type: 'dropdown', options: ['m', 'n'] },
    ]
    const workSteps: LinkStep[] = [
      { id: '1', name: 'One', costType: 'fixed', when: { fieldId: 'a', operator: 'equals', equals: true } },
      { id: '2', name: 'Two', costType: 'per_unit', quantitySource: { type: 'form_field', fieldId: 'b' } },
      { id: '3', name: 'Three', costType: 'per_unit', quantitySource: { type: 'derived', formula: 'max(0, c - 1)' } },
      { id: '4', name: 'Four', costType: 'fixed', optional: true, triggerSignal: 'e_fact', triggerCondition: { operator: 'equals', value: 'p' } },
    ]
    const flags = pricingChecks({ workSteps, fields, multipliers: [{ when: { fieldId: 'd' } }] })
    expect(flags).toEqual([{ kind: 'question_unused', fieldId: 'f', label: 'F', message: QUESTION_UNUSED_MESSAGE }])
  })

  it('a text question is for the business to read: it is never flagged', () => {
    const flags = pricingChecks({ workSteps: [], fields: [{ fieldId: 'notes', label: 'Anything else?', type: 'text' }, { fieldId: 'more', label: 'Describe it', type: 'textarea' }] })
    expect(flags).toEqual([])
  })

  it('a line whose words say it depends on something, with no condition and no quantity, is flagged, by whole words', () => {
    const line = (name: string, extra: Partial<LinkStep> = {}): LinkStep => ({ id: name, name, costType: 'fixed', ...extra })
    const flagged = (step: LinkStep) => pricingChecks({ workSteps: [step], fields: [] }).filter((f) => f.kind === 'line_unlinked')
    for (const [name, word] of [
      ['Attic surcharge, only if the unit is in the attic', 'only'],
      ['Extra if out of hours', 'if'],
      ['Refrigerant per pound', 'per'],
      ['Each additional system', 'each additional'],
      ['Weekend visit', 'weekend'],
      ['Weekends', 'weekend'],
    ] as const) {
      expect(flagged(line(name)).map((f) => f.kind === 'line_unlinked' && f.word), name).toEqual([word])
    }
    // whole words: none of these says "if", "only", "per" or "weekend"
    for (const name of ['Repair and supervision', 'Lifting gear', 'Notification fee', 'Lonely planet tour', 'Permit paperwork', 'Standard call-out']) expect(flagged(line(name)), name).toEqual([])
    // the description counts too, when it says more than the name
    expect(flagged(line('Top-up', { description: 'Charged only if needed' })).length).toBe(1)
    expect(dependsWordIn({ name: 'Top-up', description: 'Top-up' })).toBeNull()
    // linked lines are not flagged, whatever they are called
    expect(flagged(line('Weekend visit', { when: { fieldId: 'weekend', operator: 'equals', equals: true } }))).toEqual([])
    expect(flagged(line('Refrigerant per pound', { costType: 'per_unit', quantitySource: { type: 'form_field', fieldId: 'lbs' } }))).toEqual([])
    expect(flagged(line('Only for gas', { optional: true, triggerSignal: 'fuel' }))).toEqual([])
    // the message says what happens today: it is charged on every quote
    expect(flagged(line('Weekend visit'))[0]!.message).toBe('"Weekend visit" says "weekend" but is charged on every quote: it has no condition and no quantity from an answer')
  })
})

describe('T-204 item 1: the same check on every template’s own lines', () => {
  const flagsOf = (svc: { draft: { pricing: { workSteps?: unknown[] }; suggestedFields?: unknown[] }; multipliers?: unknown[] }) =>
    pricingChecks({ workSteps: (svc.draft.pricing.workSteps ?? []) as LinkStep[], fields: (svc.draft.suggestedFields ?? []) as LinkField[], multipliers: (svc.multipliers ?? []) as never })

  it('no template has a line whose words say it depends on something while nothing decides it', () => {
    let lines = 0
    for (const pack of listPacks()) {
      for (const svc of pack.services) {
        lines += svc.draft.pricing.workSteps?.length ?? 0
        expect(flagsOf(svc).filter((f) => f.kind === 'line_unlinked'), `${pack.id} / ${svc.name}`).toEqual([])
      }
    }
    expect(lines).toBeGreaterThan(50)
  })

  it('three template questions change no price line; on a photo-measured service the flag says what the answer is still used for', () => {
    const found: string[] = []
    for (const pack of listPacks()) for (const svc of pack.services) for (const flag of flagsOf(svc)) if (flag.kind === 'question_unused') {
      found.push(`${pack.id} / ${svc.name} / ${flag.label}`)
      const measured = (svc.draft.pricing.workSteps ?? []).some((step) => step.quantitySource?.type === 'ai_signal')
      expect(flag.message, flag.label).toBe(measured ? QUESTION_UNUSED_MEASURED_MESSAGE : QUESTION_UNUSED_MESSAGE)
    }
    // A new template question that no line reads shows up here: link it, or add it knowingly.
    expect(found.sort()).toEqual([
      'painting-decorating / Exterior Painting / Which sides need painting?',
      'painting-decorating-us / Exterior Painting / Which sides need painting?',
      'pressure-washing-us / Pressure Washing / Is there an outdoor water tap we can use?',
    ])
  })

  it('no template’s name sets off the name warning', () => {
    for (const pack of listPacks()) for (const svc of pack.services) expect(nameWarnings(svc.name, svc.draft.pricing.workSteps ?? []), `${pack.id} / ${svc.name}`).toEqual([])
  })
})

// ───────────────────────────── item 1: tying loose links, and the compile ─────────────────────────────

/** What a model can answer for the AC text when it leaves every link loose (each fault seen in a compile run) */
const LOOSE_ANSWER = {
  instructions: [],
  updatedConfig: {
    pricing: {
      pricingModel: 'per_unit',
      baseFee: 0,
      minimumCharge: 0,
      workSteps: [
        { id: 'first', name: 'AC tune-up (first system)', costType: 'fixed', defaultCost: 129, optional: false },
        { id: 'additional', name: 'AC tune-up, each additional system', costType: 'per_unit', defaultCost: 89, unitLabel: 'system', optional: false, quantitySource: { type: 'form_field', fieldId: 'system_count' } },
        { id: 'attic', name: 'Attic surcharge', description: 'Add if the system is in an attic', costType: 'fixed', defaultCost: 45, optional: false },
        { id: 'weekend', name: 'Weekend visit surcharge', costType: 'fixed', defaultCost: 60, optional: false },
        { id: 'refrigerant', name: 'Refrigerant top-up', costType: 'per_unit', defaultCost: 95, unitLabel: 'lb', optional: false, quantitySource: { type: 'form_field', fieldId: 'refrigerant_lbs' } },
      ],
    },
    suggestedFields: [
      { fieldId: 'system_count', label: 'Number of AC systems', type: 'number', required: true, criticalForPricing: true },
      { fieldId: 'location', label: 'Where is the indoor unit?', type: 'dropdown', options: ['Basement', 'Attic', 'Garage'], required: true },
      { fieldId: 'weekend_visit', label: 'Do you require a weekend visit?', type: 'boolean', required: true },
      { fieldId: 'refrigerant_lbs', label: 'Pounds of refrigerant, if you know it', type: 'number', required: false },
    ],
    expectedSignals: [],
  },
  addons: [],
  multipliers: [],
  ambiguities: [],
}

describe('T-204 item 1: the code ties what the AI left loose (linkPricing, inside the compile)', () => {
  const compiled = finishCompile(JSON.stringify(LOOSE_ANSWER), { description: AC_TUNE_UP_TEXT, serviceName: 'AC Tune-Up' })
  const steps = compiled.updatedConfig.pricing.workSteps
  const fields = compiled.updatedConfig.suggestedFields
  const step = (id: string) => steps.find((s) => s.id === id)!

  it('"each additional" becomes the answer minus one, never below 0', () => {
    expect(step('additional').quantitySource).toEqual({ type: 'derived', formula: 'max(0, system_count - 1)' })
  })

  it('an optional number is marked "left empty = 0"; a required count is not', () => {
    expect(step('refrigerant').quantitySource).toMatchObject({ type: 'form_field', fieldId: 'refrigerant_lbs', missingMeansZero: true })
    expect([...optionalNumberQuestions(fields, steps)]).toEqual(['refrigerant_lbs'])
  })

  it('a loose line that names one option of one choice question is included only for that option', () => {
    expect(step('attic').when).toEqual({ fieldId: 'location', operator: 'equals', equals: 'Attic' })
  })

  it('a loose line that matches the one unread yes/no question is included only when it is ticked', () => {
    expect(step('weekend').when).toEqual({ fieldId: 'weekend_visit', operator: 'equals', equals: true })
  })

  it('the result says what was tied, and nothing is left to flag', () => {
    expect(compiled.linked.map((r) => r.what)).toEqual([
      'counts "Number of AC systems" minus 1 (never below 0)',
      '"Pounds of refrigerant, if you know it" left empty counts as 0',
      'only included when "Where is the indoor unit?" is "Attic"',
      'only included when "Do you require a weekend visit?" is ticked',
    ])
    expect(compiled.flags).toEqual([])
  })

  it('and it prices as the description says: 129, 263, 323, and no refrigerant when its box is empty', () => {
    const answers = (systems: number, place: string, weekend: boolean) => ({ system_count: systems, location: place, weekend_visit: weekend })
    expect(price(steps, fields, answers(1, 'Basement', false)).subtotal).toBe(129)
    expect(price(steps, fields, answers(2, 'Attic', false)).subtotal).toBe(263)
    expect(price(steps, fields, answers(2, 'Attic', true)).subtotal).toBe(323)
    expect(price(steps, fields, answers(1, 'Basement', false)).breakdown.some((line) => /refrigerant/i.test(line.label))).toBe(false)
    expect(price(steps, fields, { ...answers(1, 'Basement', false), refrigerant_lbs: 2 }).subtotal).toBe(319)
  })

  it('only where there is exactly one right answer: two yes/no questions that both fit, or a line that names two options, are left for the flag', () => {
    const fieldsTwo: LinkField[] = [
      { fieldId: 'weekend_visit', label: 'Weekend visit?', type: 'boolean' },
      { fieldId: 'weekend_delivery', label: 'Weekend delivery?', type: 'boolean' },
      { fieldId: 'place', label: 'Where?', type: 'dropdown', options: ['Attic', 'Basement'] },
    ]
    const loose: LinkStep[] = [
      { id: 'w', name: 'Weekend surcharge', costType: 'fixed' },
      { id: 'p', name: 'Attic or basement access, only if needed', costType: 'fixed' },
    ]
    const result = linkPricing(loose, fieldsTwo)
    expect(result.repairs).toEqual([])
    expect(result.workSteps.every((s) => !s.when)).toBe(true)
    expect(pricingChecks({ workSteps: result.workSteps, fields: fieldsTwo }).filter((f) => f.kind === 'line_unlinked').length).toBe(2)
  })

  it('a line that is not loose is never touched: no words, or already linked', () => {
    const fieldsOne: LinkField[] = [{ fieldId: 'weekend_visit', label: 'Weekend visit?', type: 'boolean' }]
    const steady: LinkStep[] = [
      { id: 'a', name: 'Call-out', costType: 'fixed' },
      { id: 'b', name: 'Weekend surcharge', costType: 'fixed', when: { fieldId: 'weekend_visit', operator: 'equals', equals: false } },
    ]
    expect(linkPricing(steady, fieldsOne)).toEqual({ workSteps: steady, repairs: [] })
  })

  it('"Additional …" beside a "First …" line counts minus one; "Additional rooms" by itself is left as the business wrote it', () => {
    const count: LinkField[] = [{ fieldId: 'rooms', label: 'How many rooms?', type: 'number', required: true }]
    const pair: LinkStep[] = [
      { id: 'first', name: 'First room', costType: 'fixed' },
      { id: 'more', name: 'Additional rooms', costType: 'per_unit', quantitySource: { type: 'form_field', fieldId: 'rooms' } },
    ]
    expect(linkPricing(pair, count).workSteps[1]!.quantitySource).toEqual({ type: 'derived', formula: 'max(0, rooms - 1)' })
    expect(linkPricing([pair[1]!], count).workSteps[0]!.quantitySource).toEqual({ type: 'form_field', fieldId: 'rooms' })
    // a question that already asks for the extra ones is not reduced again
    const extras: LinkField[] = [{ fieldId: 'extra_rooms', label: 'How many additional rooms?', type: 'number', required: true }]
    expect(linkPricing([{ id: 'more', name: 'Each additional room', costType: 'per_unit', quantitySource: { type: 'form_field', fieldId: 'extra_rooms' } }], extras).workSteps[0]!.quantitySource).toEqual({ type: 'form_field', fieldId: 'extra_rooms' })
  })
})

describe('T-204 item 1: the compile itself', () => {
  it('the prompt tells the model to link every condition to its question, in the ticket’s own cases', () => {
    expect(COMPILE_SYSTEM_PROMPT).toContain('4g. LINK EVERY CONDITION TO ITS QUESTION')
    expect(COMPILE_SYSTEM_PROMPT).toContain('"max(0, <count> - 1)"')
    expect(COMPILE_SYSTEM_PROMPT).toContain('Left empty means 0, never 1.')
    expect(COMPILE_SYSTEM_PROMPT).toContain('It is NEVER an add-on, and NEVER a step without "when"')
    // and it still never invents a number
    expect(COMPILE_SYSTEM_PROMPT).toContain('NEVER invent prices, rates, thresholds, or percentages')
    expect(compileUserPrompt({ description: 'x', serviceName: 'AC Tune-Up' }, 'REGION')).toContain('Service: AC Tune-Up')
  })

  it('a right answer goes through untouched: nothing tied, and the flags are the questions no line reads', () => {
    const answer = { updatedConfig: { pricing: { workSteps: AC_TUNE_UP_STEPS }, suggestedFields: AC_TUNE_UP_FIELDS, expectedSignals: [] }, addons: [], multipliers: [], ambiguities: [] }
    const compiled = finishCompile(JSON.stringify(answer), { description: AC_TUNE_UP_TEXT })
    expect(compiled.linked).toEqual([])
    expect(compiled.flags.map((f) => f.kind)).toEqual(['question_unused', 'question_unused'])
    for (const proof of AC_TUNE_UP_CASES) expect(price(compiled.updatedConfig.pricing.workSteps, compiled.updatedConfig.suggestedFields, proof.answers).subtotal, proof.what).toBe(proof.subtotal)
  })

  it('the route is thin: the prompt and everything after the model’s answer are the library the tests run', () => {
    const route = code('app/api/services/ai-draft/compile/route.ts')
    expect(route).toContain("import { COMPILE_SYSTEM_PROMPT, compileUserPrompt, finishCompile, type CompileRequest } from '@/lib/pricing-compile'")
    expect(route).toContain('return NextResponse.json(finishCompile(responseText, body))')
    expect(route).not.toContain('validateAndNormalizeDraftBulk')
  })

  it('the review says a line’s condition and its formula in words (they were not shown at all)', () => {
    const lines = describePricingRules({ baseFee: 0, minimumCharge: 0, workSteps: AC_TUNE_UP_STEPS as unknown as WorkStepConfig[], addons: [], multipliers: [], suggestedFields: AC_TUNE_UP_FIELDS as unknown as SuggestedField[], expectedSignals: [] }, '$').flatMap((s) => s.lines)
    expect(lines).toContain('AC Tune-Up (First System): $129 per system — quantity: "Number of AC Systems", at most 1')
    expect(lines).toContain('AC Tune-Up (Additional Systems): $89 per system — quantity: "Number of AC Systems" minus 1, never below 0')
    expect(lines).toContain('Attic unit surcharge: $45 (fixed). Only include when Indoor Unit Location = Attic')
    expect(lines).toContain('Weekend visit surcharge: $60 (fixed). Only include when Do you require a weekend visit? = Yes')
    expect(lines.find((l) => l.startsWith('Refrigerant top-up'))).toContain('(left empty counts as 0)')
    expect(lines.join('\n')).not.toContain('defaults to 1')
  })

  it('the links in words', () => {
    const fields = AC_TUNE_UP_FIELDS as unknown as LinkField[]
    const step = (id: string) => (AC_TUNE_UP_STEPS as unknown as LinkStep[]).find((s) => s.id === id)!
    expect(linkWordsOf(step('attic_unit_surcharge'), fields)).toEqual({ condition: 'Only include when Indoor Unit Location = Attic', quantity: null })
    expect(linkWordsOf(step('ac_tune_up_additional_systems'), fields).quantity).toBe('Quantity: "Number of AC Systems" minus 1, never below 0')
    expect(linkWordsOf(step('ac_tune_up_first_system'), fields).quantity).toBe('Quantity: "Number of AC Systems", at most 1')
    expect(linkWordsOf({ id: 'x', name: 'X', quantitySource: { type: 'derived', formula: 'ceil(system_count / 2)' } }, fields).quantity).toBe('Quantity worked out from the answers: ceil(system_count / 2)')
    expect(linkWordsOf(step('refrigerant_top_up'), fields).quantity).toBe('Quantity from the answer to "Estimated pounds of refrigerant needed — if you know it" (left empty counts as 0)')
  })
})

// ───────────────────────────── item 5: steps while it works ─────────────────────────────

describe('T-204 item 5: steps while the compile works', () => {
  it('three steps, in the ticket’s words, each shown when it is due', () => {
    expect(COMPILE_STEPS.map((s) => s.label)).toEqual(['Reading your prices…', 'Making questions…', 'Checking…'])
    expect(compileStepAt(0)).toBe(0)
    expect(compileStepAt(8.9)).toBe(0)
    expect(compileStepAt(9)).toBe(1)
    expect(compileStepAt(21)).toBe(1)
    expect(compileStepAt(22)).toBe(2)
    expect(compileStepAt(600)).toBe(2)
  })

  it('the review shows them while it compiles, and the flags before "Apply"', () => {
    const composer = code('components/services/PricingComposer.tsx')
    expect(composer).toContain('data-testid="compile-steps"')
    expect(composer).not.toContain('Turning your words into pricing rules')
    expect(composer).toContain('<PricingFlagsNote')
    expect(code('components/onboarding/OnboardingFlow.tsx')).toContain('flags={compileResult.flags}')
    // no pulse in the dashboard (design system: motion)
    expect(composer).not.toContain('animate-pulse')
  })

  it('the compile model is unchanged: the faster settings did not give the same result (see the CHANGELOG)', () => {
    const registry = JSON.parse(repo('packages/shared/src/ai-models.json')) as { tasks: Record<string, { model: string; thinkingLevel?: string }> }
    expect(registry.tasks.compile).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash' })
    expect(registry.tasks.compile!.thinkingLevel).toBeUndefined()
  })
})

// ───────────────────────────── item 2: the test price ─────────────────────────────

describe('T-204 item 2: "Test Your Pricing" is the worker’s own pipeline, with the details photos give', () => {
  const heater = waterHeaterPackUS.services[0]!
  const service = { workSteps: heater.draft.pricing.workSteps as WorkStepConfig[], expectedSignals: heater.draft.expectedSignals ?? [], suggestedFields: (heater.draft.suggestedFields ?? []) as SuggestedField[] }

  it('a detail the photos give and no question asks is offered to try: the water heater’s tank size and fuel', () => {
    const keys = photoDetails(service).map((s) => s.signalKey)
    expect(keys).toContain('tank_capacity')
    expect(keys).toContain('water_heater_fuel')
    // each has the choices the service itself lists
    for (const signal of photoDetails(service)) if (signal.type === 'enum') expect(signal.possibleValues?.length, signal.signalKey).toBeGreaterThan(1)
  })

  it('a detail a question already asks is not offered twice', () => {
    const asked = { ...service, suggestedFields: [...service.suggestedFields, { fieldId: 'tank_size', label: 'Tank size', type: 'dropdown', required: false, mapsToSignal: 'tank_capacity' } as SuggestedField] }
    expect(photoDetails(asked).map((s) => s.signalKey)).not.toContain('tank_capacity')
  })

  it('the sample values become answers as the form sends them; an empty box is no answer', () => {
    const ac = { suggestedFields: AC_TUNE_UP_FIELDS as unknown as SuggestedField[], expectedSignals: [], workSteps: AC_TUNE_UP_STEPS as unknown as WorkStepConfig[] }
    const { answers } = answersFromValues(ac, { system_count: '2', indoor_location: 'Closet / Interior Room', weekend_visit: true, refrigerant_lbs: '', system_operational: '' })
    expect(answers).toEqual([
      { fieldId: 'system_count', value: 2 },
      { fieldId: 'indoor_location', value: 'closet_/_interior_room' },
      { fieldId: 'weekend_visit', value: true },
    ])
    // a typed 0 is an answer; untouched boxes are not
    expect(answersFromValues(ac, { refrigerant_lbs: '0' }).answers).toEqual([{ fieldId: 'refrigerant_lbs', value: 0 }])
    expect(answersFromValues(ac, {}).answers).toEqual([])
  })

  it('a detail from the photos is sent under its own key, as a customer’s statement of it would be', () => {
    const { answers } = answersFromValues(service, { [photoKey('tank_capacity')]: '50 gal', [photoKey('water_heater_fuel')]: 'Natural gas' })
    expect(answers).toEqual(expect.arrayContaining([{ fieldId: 'tank_capacity', value: '50 gal' }, { fieldId: 'water_heater_fuel', value: 'Natural gas' }]))
  })

  it('a measured line is sent at the size typed, else at a sample from the service’s own range, else not at all', () => {
    const measured = {
      suggestedFields: [] as SuggestedField[],
      workSteps: [
        { id: 'a', name: 'Walls', costType: 'per_unit', defaultCost: 2, optional: false, quantitySource: { type: 'ai_signal', signalKey: 'wall_area' } },
        { id: 'b', name: 'Fence', costType: 'per_unit', defaultCost: 3, optional: false, quantitySource: { type: 'ai_signal', signalKey: 'fence_length' } },
      ] as unknown as WorkStepConfig[],
      expectedSignals: [
        { signalKey: 'wall_area', type: 'number', description: 'walls', envelope: { minPerUnit: 100, maxPerUnit: 300, absoluteMin: 10, absoluteMax: 5000, defaultDriver: 1 } },
        { signalKey: 'fence_length', type: 'number', description: 'fence' },
      ] as never,
    }
    expect(answersFromValues(measured, { [sampleKey('wall_area')]: '40' })).toEqual({ answers: [{ fieldId: 'wall_area', value: 40 }], sampled: [] })
    expect(answersFromValues(measured, {})).toEqual({ answers: [{ fieldId: 'wall_area', value: 200 }], sampled: [{ signalKey: 'wall_area', size: 200 }] })
  })

  it('the worker is sent the service as saving would write it', () => {
    const body = { name: 'AC Tune-Up', workSteps: AC_TUNE_UP_STEPS as never, expectedSignals: [], suggestedFields: AC_TUNE_UP_FIELDS as never, pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: AC_TUNE_UP_STEPS as never } }
    const { input } = previewInput('tnt_1', { service: body, values: { system_count: 2 } })
    expect(input.tenantId).toBe('tnt_1')
    expect(input.service).toMatchObject({ id: 'preview', name: 'AC Tune-Up', work_steps: AC_TUNE_UP_STEPS, tax_exempt: false })
    expect(input.rules.workSteps).toEqual(AC_TUNE_UP_STEPS)
    // the form's own copy of the questions: a choice has a key and a label, and "needed for the price" is required
    expect(input.fields.find((f) => f.fieldId === 'indoor_location')).toMatchObject({ type: 'select', required: true, options: expect.arrayContaining([{ value: 'attic', label: 'Attic' }]) })
    expect(input.fields.find((f) => f.fieldId === 'refrigerant_lbs')).toMatchObject({ type: 'number', required: false })
    expect(input.answers).toEqual([{ fieldId: 'system_count', value: 2 }])
  })

  it('the page adds nothing up: it asks the route, which asks the worker', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('<PricingTest')
    expect(page).not.toContain('samplePrice(')
    const panel = code('components/services/PricingTest.tsx')
    expect(panel).toContain("fetch('/api/services/preview-price'")
    expect(panel).not.toMatch(/reduce\(|\* step\.defaultCost|\+= /)
    expect(panel).toContain('From the customer&apos;s photos')
    const route = code('app/api/services/preview-price/route.ts')
    expect(route).toContain('previewPriceNow(input)')
    expect(route).toContain(".eq('tenant_id', profile.tenant_id)")
    expect(code('lib/pricing-preview.ts')).toContain('`${workerUrl}/preview`')
    // the worker's endpoint runs the pipeline in preview mode and writes nothing
    expect(repo('apps/worker/src/index.ts')).toContain("url.pathname === '/preview' && request.method === 'POST'")
  })
})

// ───────────────────────────── item 3: the name warning ─────────────────────────────

describe('T-204 item 3: the name warning matches whole words and names the word it found', () => {
  const lines = [{ name: 'Drain, removal and haul-away' }, { name: '50 gal gas tank' }]

  it('"Water Heater Replacement" is not told its name includes "Repair"', () => {
    expect(nameWarnings('Water Heater Replacement', lines)).toEqual([])
    expect(nameWarnings('Prefix cabling', lines)).toEqual([])
    expect(nameWarnings('Fixture fitting', lines)).toEqual([])
    expect(nameWarnings('Preparation and painting', lines)).toEqual([])
  })

  it('a name that does promise a repair, with no line that mentions one, is warned in its own word', () => {
    expect(nameWarnings('Fence Repair', lines)).toEqual(['Service name includes "Repair" but no price line mentions it. Customers will expect a price for it.'])
    expect(nameWarnings('Leak fix', lines)).toEqual(['Service name includes "Fix" but no price line mentions it. Customers will expect a price for it.'])
    expect(nameWarnings('Fence repairs', [{ name: 'Section repair labour' }])).toEqual([])
    expect(nameWarnings('Replace a panel', [{ name: 'New 200 A panel, installed' }])).toEqual([])
    // nothing priced yet: the "no pricing" warning says so instead
    expect(nameWarnings('Fence Repair', [])).toEqual([])
  })

  it('the page uses that one rule', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('validationWarnings.push(...nameWarnings(formData.name, formData.workSteps))')
    expect(page).not.toMatch(/\/repair\|fix\|replace\/i/)
  })
})

// ───────────────────────────── item 7: photos required ─────────────────────────────

describe('T-204 item 7: "Photos required" (0 to 8) is shown and kept', () => {
  it('a whole number from 0 to 8; anything else is the fallback', () => {
    expect(MAX_PHOTOS_REQUIRED).toBe(8)
    expect(photosRequired(0)).toBe(0)
    expect(photosRequired(3)).toBe(3)
    expect(photosRequired('2')).toBe(2)
    expect(photosRequired(12)).toBe(8)
    expect(photosRequired(-1)).toBe(0)
    expect(photosRequired(2.9)).toBe(2)
    expect(photosRequired(undefined)).toBe(1)
    expect(photosRequired('', 0)).toBe(0)
  })

  it('a business’s 0 stays 0: on save, and when the pricing is described again (it was turned back into 1)', () => {
    expect(serviceInsertRow('t', { name: 'S', mediaConfig: { minPhotos: 0, maxPhotos: 8, photoGuidance: null } as never }).media_config).toMatchObject({ minPhotos: 0 })
    expect(serviceInsertRow('t', { name: 'S', mediaConfig: { minPhotos: 20, maxPhotos: 8, photoGuidance: null } as never }).media_config).toMatchObject({ minPhotos: 8 })
    expect(serviceInsertRow('t', { name: 'S' }).media_config).toMatchObject({ minPhotos: 1 })
    expect(validateAndNormalizeDraft({ media: { minPhotos: 0 } } as never).media.minPhotos).toBe(0)
    expect(validateAndNormalizeDraft({ media: { minPhotos: 6 } } as never).media.minPhotos).toBe(6)
    expect(validateAndNormalizeDraft({} as never).media.minPhotos).toBe(1)
    expect(code('app/api/services/[id]/route.ts')).toContain('minPhotos: photosRequired((mediaConfig as { minPhotos?: unknown }).minPhotos)')
  })

  it('every template that asks for a photo still asks for the number it did', () => {
    const required = listPacks().flatMap((pack) => pack.services.map((svc) => `${pack.id} / ${svc.name}: ${svc.draft.media?.minPhotos}`))
    for (const line of required.filter((l) => l.startsWith('hvac-us') || l.startsWith('water-heater-us'))) expect(line).toMatch(/: 1$/)
  })

  it('the editor shows it by that name, with what 0 means', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('Photos required')
    expect(page).not.toContain('Minimum Photos Required')
    expect(page).toContain('max={MAX_PHOTOS_REQUIRED}')
    expect(page).toContain('Photos are optional: a customer can send a request without any.')
  })
})

// ───────────────────────────── item 20: switched off ─────────────────────────────

describe('T-204 item 20: a switched-off service stands out, and can be saved and switched on', () => {
  const page = code('app/(dashboard)/app/services/page.tsx')

  it('"Inactive" and the switched-off notes are in the warning colour, with no pale tint', () => {
    expect(page).toContain("'border border-tertiary-line bg-background text-tertiary'")
    expect(page).toContain('border-l-tertiary bg-background p-4" role="status" data-testid="template-added-note"')
    expect(page).toContain('text-sm font-semibold text-tertiary">&quot;{addedOff.name}&quot; was added and is switched off.')
  })

  it('on "Test & Publish" an inactive service has a second button, which saves with `active: true`', () => {
    expect(page).toContain('data-testid="save-switch-on"')
    expect(page).toContain('Save and switch on')
    expect(page).toContain('editingService && !editingService.active ? (')
    expect(page).toContain('body: JSON.stringify(switchOn ? { ...body, active: true } : body),')
    // the plain save never switches it on
    expect(page).toContain('onClick={() => { submitIntentRef.current = true; switchOnRef.current = false }}')
  })
})

// ───────────────────────────── item 4: add to this quote ─────────────────────────────

describe('T-204 item 4: "Add to this quote" beside what the customer also asked for', () => {
  const button = code('components/quotes/AddToQuote.tsx')

  it('it prices the service with the editor’s own call and saves it as a section of the same quote', () => {
    expect(button).toContain('`/api/quotes/${context.quoteId}/sections/price`')
    expect(button).toContain("method: 'PATCH'")
    expect(button).toContain('pricing_json: { ...pricing, sections: [...sections, section] }')
    expect(button).toContain('sendToCustomer: context.alreadySent')
    // one quote: it never makes a new one, and never touches a counter
    expect(button).not.toMatch(/api\/quotes'|usage|claim/)
  })

  it('a quote the customer already has is asked about first: adding it sends them the updated quote', () => {
    expect(button).toContain('if (context.alreadySent) setPriced(section)')
    expect(button).toContain('Add and send the update')
  })

  it('only for a service of the business that is not on the quote yet, and only while the quote can be edited', () => {
    expect(button).toContain("if (!item.serviceId || item.state !== 'offered') return null")
    expect(button).toContain('sections.length >= MAX_ADDED_SECTIONS')
    const page = code('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain('canEditQuote(quote.status) && pricing && content')
    expect(page).toContain('alreadySent: (QUOTE_ALREADY_SENT_STATUSES as readonly string[]).includes(quote.status)')
  })
})

// ───────────────────────────── item 29: the note ─────────────────────────────

describe('T-204 item 29: "Photos could not be read" on a held quote', () => {
  const unread = { steps: [{ step: 'photos' as const, why: 'timeout' as const }], at: '2026-11-25T10:00:00.000Z' }

  it('the note, in the ticket’s words, and one plain sentence of what was not read', () => {
    expect(PHOTOS_UNREAD_NOTE).toBe('Photos could not be read')
    expect(photosUnreadSentence(unread)).toBe('Qolumns could not read the photos (the reading took too long), so this price was worked out without that. The customer has not been sent it. Check it against the photos, change it if you need to, then approve.')
    expect(photosUnreadSentence({ steps: [{ step: 'label', why: 'error' }, { step: 'measurement', why: 'bad_answer' }] })).toContain('the label in the photos (the reading failed) and the sizes in the photos (the reading came back unusable)')
    expect(photosUnreadReason(unread).startsWith('Photos could not be read. ')).toBe(true)
    expect(photosUnreadReason(unread, 'Something else.')).toMatch(/ Also: Something else\.$/)
  })

  it('read back from a quote’s content, and nothing made up when it is not there', () => {
    expect(photosUnreadOf({ photosUnread: unread })).toEqual(unread)
    expect(photosUnreadOf({})).toBeNull()
    expect(photosUnreadOf({ photosUnread: { steps: [{ step: 'made_up', why: 'error' }] } })).toBeNull()
  })

  it('it is the first warning on the approval page, in the review email and in the app', () => {
    const detail = approvalDetail({ pricing: { currency: 'USD', subtotal: 100, taxAmount: 0, total: 100, breakdown: [{ label: 'Line', amount: 100 }] }, content: { photosUnread: unread }, mainServiceName: 'Service', photoCount: 2, currency: 'USD', locale: 'en-US' })
    expect(detail.warnings[0]).toEqual({ kind: 'photos', title: 'Photos could not be read', lines: [photosUnreadSentence(unread)] })
    expect(approvalDetail({ pricing: { currency: 'USD', subtotal: 100, taxAmount: 0, total: 100, breakdown: [{ label: 'Line', amount: 100 }] }, content: {}, mainServiceName: 'Service', photoCount: 2, currency: 'USD', locale: 'en-US' }).warnings).toEqual([])
  })

  it('the dashboard’s quote page says it while the quote is held', () => {
    const page = code('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    expect(page).toContain("quote.status === 'pending_review' && photosUnreadOf(content) && (")
    expect(page).toContain('data-testid="photos-unread"')
  })
})
