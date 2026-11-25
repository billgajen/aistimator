/**
 * T-201, the service editor (items 5 to 10 and 12).
 *
 *   5.  a service made by hand keeps its questions (they live in the draft, and it had none);
 *   6.  a question keeps its keys when its label changes, so price lines, adjustments and
 *       conditions stay attached; the facts a template set are left alone;
 *   7.  "Regenerate" asks first and names what it replaces;
 *   8.  "Describe your pricing" names what did not fit;
 *   9.  amount boxes show the business's currency symbol;
 *   10. a fixed line ticked "Only include when…" with no question cannot be saved;
 *   12. a template's service is added switched off.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ExpectedSignalConfig, MultiplierConfig, ServiceDraftConfig, SuggestedField, WorkStepConfig } from '@qolumns/shared'
import {
  deriveFieldId,
  deriveSignalKey,
  draftToSave,
  handMadeDraft,
  isAiDraft,
  isHandMade,
  lineNeedsQuestion,
  linesNeverCharged,
  looseReferences,
  priceLinesProblem,
  referencedKeys,
  regenerateReplaces,
  syncQuestions,
  type ServiceForm,
} from '@/lib/service-questions'
import { COMPILE_KEEPS, hasLeftOut, leftOutLines, leftOutOf } from '@/lib/pricing-left-out'
import { samplePrice } from '@/lib/sample-price'
import { serviceInsertRow } from '@/lib/service-rows'
import { servicePayload } from '@/lib/onboarding-service'
import { templateGroups, templatePayload } from '@/lib/service-templates'
import { listPacks } from '@/lib/vertical-packs'
import { validateAndNormalizeDraft, validateAndNormalizeDraftBulk } from '@/app/api/services/ai-draft/shared'

const ROOT = join(__dirname, '../../../..')
const src = (path: string) => readFileSync(join(ROOT, 'apps/web/src', path), 'utf8')
/** A source file without its comments, so a rule about the code is not met or broken by a note */
const code = (path: string) => src(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const question = (over: Partial<SuggestedField> = {}): SuggestedField => ({ label: '', fieldId: '', type: 'text', required: false, ...over })
const line = (over: Partial<WorkStepConfig> = {}): WorkStepConfig => ({ id: 'step_1', name: 'Line', description: '', costType: 'fixed', defaultCost: 40, optional: false, ...over })
const form = (over: Partial<ServiceForm> = {}): ServiceForm => ({
  scopeIncludes: ['Labour'],
  scopeExcludes: [],
  defaultAssumptions: [],
  mediaConfig: { minPhotos: 1, maxPhotos: 8, photoGuidance: null },
  workSteps: [],
  expectedSignals: [],
  suggestedFields: [],
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
  ...over,
})

/** The editor's own loop: type a label one change at a time, as the page does on each keystroke */
function edit(
  state: { fields: SuggestedField[]; signals: ExpectedSignalConfig[] },
  change: (fields: SuggestedField[]) => SuggestedField[],
  rest: { saved?: string[]; workSteps?: WorkStepConfig[]; multipliers?: MultiplierConfig[] } = {}
) {
  return syncQuestions({
    fields: change(state.fields.map((f) => ({ ...f }))),
    previousFields: state.fields,
    previousSignals: state.signals,
    savedFieldIds: rest.saved,
    workSteps: rest.workSteps,
    multipliers: rest.multipliers,
  })
}
const typed = (state: { fields: SuggestedField[]; signals: ExpectedSignalConfig[] }, index: number, label: string, rest: Parameters<typeof edit>[2] = {}) => {
  let now = state
  for (let n = 1; n <= label.length; n++) now = edit(now, (fields) => fields.map((f, i) => (i === index ? { ...f, label: label.slice(0, n) } : f)), rest)
  return now
}

// ---------------------------------------------------------------------------------------------
describe('T-201 item 5: a service made by hand keeps its questions', () => {
  const asked = [question({ label: 'How many rooms?', fieldId: 'how_many_rooms', type: 'number', mapsToSignal: 'room_count' })]

  it('with no draft and questions, the editor writes a draft of its own, marked as made by hand', () => {
    const saved = draftToSave(null, form({ suggestedFields: asked, workSteps: [line()], baseFee: 20 }))
    expect(saved).not.toBeNull()
    expect(saved!.source).toBe('manual')
    expect(saved!.suggestedFields).toEqual(asked)
    expect(saved!.pricing.workSteps).toHaveLength(1)
    expect(saved!.pricing.baseFee).toBe(20)
    expect(isHandMade(saved)).toBe(true)
    expect(isAiDraft(saved)).toBe(false)
  })

  it('with no draft and no questions, nothing is written (as before)', () => {
    expect(draftToSave(null, form())).toBeNull()
    expect(draftToSave(undefined, form())).toBeNull()
  })

  it('a hand-made service whose last question is removed is saved with none, not left with the old ones', () => {
    const before = handMadeDraft(form({ suggestedFields: asked }))
    const after = draftToSave(before, form())
    expect(after!.source).toBe('manual')
    expect(after!.suggestedFields).toEqual([])
  })

  it('an AI draft keeps everything it holds and only takes the questions from the editor', () => {
    const pack = listPacks('US').find((p) => p.region === 'US')!.services[0]!
    const saved = draftToSave(pack.draft, form({ suggestedFields: asked }))!
    expect(saved.source).toBeUndefined()
    expect(saved.suggestedFields).toEqual(asked)
    expect(saved.scope).toEqual(pack.draft.scope)
    expect(saved.media).toEqual(pack.draft.media)
    expect(saved.pricing).toEqual(pack.draft.pricing)
    expect(isAiDraft(saved)).toBe(true)
  })

  it('the page saves through that rule in both "Create Service" and "Save Changes", and marks only AI drafts', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('const draftConfig = draftToSave(')
    // T-204: one body (`serviceBody`) is built once and sent by both, and by the test price
    expect(page.match(/draftConfig,\n/g)?.length).toBe(1)
    expect(page).toContain('body: JSON.stringify(body),')
    expect(page).toContain('body: JSON.stringify(switchOn ? { ...body, active: true } : body),')
    expect(page).not.toContain('? { ...aiDraft, suggestedFields: formData.suggestedFields }')
    expect(page).toContain('{isAiDraft(service.draft_config) && <AIDraftBadge compact />}')
    expect(page).toContain('setAiDraft(isAiDraft(service.draft_config) ? service.draft_config : null)')
  })

  it('the save route takes the questions off the form too when the last one is removed', () => {
    const route = code('app/api/services/[id]/route.ts')
    expect(route).toContain('if (draftConfig !== undefined) {')
    expect(route).toContain('(draftConfig?.suggestedFields ?? []).map(')
    expect(route).toContain('} else if (widgetFields.length > 0) {')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 6: a question keeps its keys when its label changes', () => {
  it('a new question nothing uses yet follows its label, one keystroke at a time', () => {
    let state = { fields: [question({ type: 'number' })], signals: [] as ExpectedSignalConfig[] }
    state = typed(state, 0, 'Number of rooms')
    expect(state.fields[0]!.fieldId).toBe('number_of_rooms')
    expect(state.fields[0]!.mapsToSignal).toBe(deriveSignalKey('Number of rooms', 'number'))
    expect(state.signals).toEqual([{ signalKey: state.fields[0]!.mapsToSignal, type: 'number', description: 'Number of rooms', possibleValues: undefined }])
  })

  it('once a price line multiplies by it, renaming it changes the wording and nothing else', () => {
    let state = { fields: [question({ type: 'number' })], signals: [] as ExpectedSignalConfig[] }
    state = typed(state, 0, 'Rooms')
    const id = state.fields[0]!.fieldId
    const signal = state.fields[0]!.mapsToSignal!
    const workSteps = [line({ costType: 'per_unit', quantitySource: { type: 'form_field', fieldId: id } })]
    state = edit(state, (fields) => fields.map((f) => ({ ...f, label: '' })), { workSteps })
    state = typed(state, 0, 'How many rooms need painting?', { workSteps })
    expect(state.fields[0]!.fieldId).toBe(id)
    expect(state.fields[0]!.mapsToSignal).toBe(signal)
    expect(state.fields[0]!.label).toBe('How many rooms need painting?')
    // the fact the editor wrote for it follows the new wording, under the same key
    expect(state.signals).toEqual([{ signalKey: signal, type: 'number', description: 'How many rooms need painting?', possibleValues: undefined }])
  })

  it('the same holds for an adjustment, for a condition, and for a formula that names it', () => {
    const start = { fields: [question({ label: 'Ceiling height', fieldId: 'ceiling_height', type: 'dropdown', options: ['Standard', 'High'], mapsToSignal: 'ceiling_height_type' })], signals: [] as ExpectedSignalConfig[] }
    const byAdjustment = typed(start, 0, 'Ceilings', { multipliers: [{ when: { fieldId: 'ceiling_height', equals: 'High' }, multiplier: 1.2 }] })
    expect(byAdjustment.fields[0]!.fieldId).toBe('ceiling_height')
    const byCondition = typed(start, 0, 'Ceilings', { workSteps: [line({ optional: true, triggerSignal: 'ceiling_height_type', triggerCondition: { operator: 'equals', value: 'High' } })] })
    expect(byCondition.fields[0]!).toMatchObject({ fieldId: 'ceiling_height', mapsToSignal: 'ceiling_height_type' })
    const byFormula = typed(start, 0, 'Ceilings', { workSteps: [line({ costType: 'per_unit', quantitySource: { type: 'derived', formula: 'max(0, ceiling_height - 2)' } })] })
    expect(byFormula.fields[0]!.fieldId).toBe('ceiling_height')
    expect(referencedKeys({ workSteps: [line({ when: { fieldId: 'q1', equals: 'yes' } })] }).has('q1')).toBe(true)
  })

  it('a question saved with the service keeps its keys even when nothing uses it yet', () => {
    const start = { fields: [question({ label: 'Parking', fieldId: 'parking', mapsToSignal: 'parking' })], signals: [{ signalKey: 'parking', type: 'string' as const, description: 'Parking' }] }
    const state = typed(start, 0, 'Where can we park?', { saved: ['parking'] })
    expect(state.fields[0]!).toMatchObject({ fieldId: 'parking', mapsToSignal: 'parking', label: 'Where can we park?' })
    // and without that, a question that is new in this window still follows its label
    expect(typed(start, 0, 'Where can we park?').fields[0]!.fieldId).toBe('where_can_we_park')
  })

  it('a key that did not come from the label (a template’s, a draft’s) is never rewritten', () => {
    const start = { fields: [question({ label: 'How many stories is the house?', fieldId: 'stories', type: 'number', mapsToSignal: 'stories' })], signals: [] as ExpectedSignalConfig[] }
    const state = typed(start, 0, 'Floors')
    expect(state.fields[0]!).toMatchObject({ fieldId: 'stories', mapsToSignal: 'stories' })
  })

  it('no two questions ever share a key', () => {
    let state = { fields: [question({ label: 'Rooms', fieldId: 'rooms', type: 'number', mapsToSignal: 'room_count' })], signals: [] as ExpectedSignalConfig[] }
    // the first is renamed and keeps "rooms"; a new question is then called "Rooms"
    state = typed(state, 0, 'Bedrooms', { saved: ['rooms'] })
    state = edit(state, (fields) => [...fields, question({ type: 'number' })], { saved: ['rooms'] })
    state = typed(state, 1, 'Rooms', { saved: ['rooms'] })
    expect(state.fields.map((f) => f.fieldId)).toEqual(['rooms', 'rooms_2'])
    expect(new Set(state.fields.map((f) => f.mapsToSignal)).size).toBe(2)
    // and the second keeps its own key through a later, unrelated change
    state = edit(state, (fields) => fields.map((f, i) => (i === 0 ? { ...f, required: true } : f)), { saved: ['rooms'] })
    expect(state.fields[1]!.fieldId).toBe('rooms_2')
  })

  it('changing a used question’s type keeps its keys and updates the fact’s type', () => {
    const start = { fields: [question({ label: 'Pets', fieldId: 'pets', type: 'text', mapsToSignal: 'pet' })], signals: [{ signalKey: 'pet', type: 'string' as const, description: 'Pets' }] }
    const state = edit(start, (fields) => fields.map((f) => ({ ...f, type: 'boolean' as const })), { saved: ['pets'] })
    expect(state.fields[0]!).toMatchObject({ fieldId: 'pets', mapsToSignal: 'pet' })
    expect(state.signals[0]).toMatchObject({ signalKey: 'pet', type: 'boolean', description: 'Pets' })
  })

  it('removing a question removes the fact the editor wrote for it, unless a price line still uses it', () => {
    const start = {
      fields: [question({ label: 'Pets', fieldId: 'pets', type: 'boolean', mapsToSignal: 'has_pet' }), question({ label: 'Stairs', fieldId: 'stairs', type: 'boolean', mapsToSignal: 'has_stair' })],
      signals: [
        { signalKey: 'has_pet', type: 'boolean' as const, description: 'Pets' },
        { signalKey: 'has_stair', type: 'boolean' as const, description: 'Stairs' },
      ],
    }
    expect(edit(start, (fields) => fields.slice(1)).signals.map((s) => s.signalKey)).toEqual(['has_stair'])
    const used = [line({ optional: true, triggerSignal: 'has_pet' })]
    expect(edit(start, (fields) => fields.slice(1), { workSteps: used }).signals.map((s) => s.signalKey).sort()).toEqual(['has_pet', 'has_stair'])
  })

  it('the question editor no longer writes keys, and the page gives them', () => {
    const editor = code('components/SuggestedFieldEditor.tsx')
    expect(editor).not.toContain('generateFieldId')
    expect(editor).toContain('onChange={(e) => updateField(index, { label: e.target.value })}')
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('syncQuestions({')
    expect(page).toContain('savedFieldIds: savedFieldIds.current')
    expect(page).not.toContain('expectedSignals: autoSignals')
    expect(deriveFieldId('Number of Rooms')).toBe('number_of_rooms')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 6, on real services: every template, a label renamed', () => {
  const services = listPacks().flatMap((pack) => pack.services.map((svc) => ({ pack: pack.id, svc })))

  it('there are templates to test with', () => {
    expect(services.length).toBeGreaterThan(10)
  })

  for (const { pack, svc } of services) {
    it(`${pack} / ${svc.name}: renaming every question changes no key, no fact and no sample price`, () => {
      const draft: ServiceDraftConfig = svc.draft
      const multipliers = svc.multipliers || []
      const workSteps = draft.pricing.workSteps
      let state = { fields: draft.suggestedFields, signals: draft.expectedSignals }
      // as saved: every question's key is one the service was saved with
      const saved = draft.suggestedFields.map((f) => f.fieldId)
      draft.suggestedFields.forEach((_, i) => {
        state = edit(state, (fields) => fields.map((f, at) => (at === i ? { ...f, label: `Renamed question ${i + 1}` } : f)), { saved, workSteps, multipliers })
      })

      expect(state.fields.map((f) => f.fieldId)).toEqual(draft.suggestedFields.map((f) => f.fieldId))
      // a key the template set is the same; a question the template gave no fact gets one of its own
      draft.suggestedFields.forEach((before, i) => {
        if (before.mapsToSignal) expect(state.fields[i]!.mapsToSignal).toBe(before.mapsToSignal)
      })
      // every fact the template wrote is still there, exactly as written (units, limits, what a scan fills)
      for (const signal of draft.expectedSignals) expect(state.signals.find((s) => s.signalKey === signal.signalKey)).toEqual(signal)
      // nothing the pricing refers to has gone
      const keys = new Set([...state.fields.map((f) => f.fieldId), ...state.signals.map((s) => s.signalKey)])
      for (const step of workSteps) {
        if (step.quantitySource?.type === 'form_field') expect(keys.has(step.quantitySource.fieldId!)).toBe(true)
        if (step.quantitySource?.type === 'ai_signal') expect(keys.has(step.quantitySource.signalKey!)).toBe(true)
        if (step.when?.fieldId) expect(keys.has(step.when.fieldId)).toBe(true)
      }
      for (const mult of multipliers) if (mult.when.fieldId) expect(keys.has(mult.when.fieldId)).toBe(true)
      expect(looseReferences({ workSteps, multipliers, suggestedFields: state.fields, expectedSignals: state.signals })).toEqual([])

      // the sample price on "Test & Publish", with an answer to every question, before and after
      const values: Record<string, string | number | boolean> = {}
      for (const f of draft.suggestedFields) values[f.fieldId] = f.type === 'number' ? 3 : f.type === 'boolean' ? true : (f.options?.[f.options.length - 1] ?? 'yes')
      const service = { baseFee: draft.pricing.baseFee, minimumCharge: draft.pricing.minimumCharge, workSteps, multipliers }
      const before = samplePrice({ ...service, suggestedFields: draft.suggestedFields, expectedSignals: draft.expectedSignals }, values, '$')
      const after = samplePrice({ ...service, suggestedFields: state.fields, expectedSignals: state.signals }, values, '$')
      expect(after.subtotal).toBe(before.subtotal)
      // line for line the same amounts (an adjustment's line is named after its question, so its wording follows the new label)
      expect(after.lineItems.map((l) => l.amount)).toEqual(before.lineItems.map((l) => l.amount))
    })
  }
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 7: "Regenerate" asks first', () => {
  it('names exactly what it replaces, with how much of each there is', () => {
    const lines = regenerateReplaces({
      suggestedFields: [question({ label: 'A' }), question({ label: 'B' })],
      workSteps: [line()],
      addons: [],
    })
    expect(lines).toEqual([
      'What’s included, what’s excluded and your assumptions',
      'The photo settings',
      'Your questions (2 questions now)',
      'Your price lines (1 line now)',
      'Your add-ons (0 add-ons now)',
    ])
  })

  it('the link opens the question; only "Replace with a new draft" writes a draft, and "Cancel" only closes it', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    // the link itself no longer generates
    const link = page.slice(page.indexOf('data-testid="regenerate"') - 400, page.indexOf('data-testid="regenerate"'))
    // T-202: it also closes the "Clear" question, so one is asked at a time
    expect(link).toMatch(/onClick=\{\(\) => \{\s*setConfirmClear\(false\)\s*setConfirmRegenerate\(true\)\s*\}\}/)
    expect(link).not.toContain('generateAIDraft')
    const yes = page.slice(page.indexOf('data-testid="regenerate-yes"') - 500, page.indexOf('data-testid="regenerate-yes"'))
    expect(yes).toContain('void generateAIDraft()')
    const cancel = page.slice(page.indexOf('data-testid="regenerate-cancel"') - 300, page.indexOf('data-testid="regenerate-cancel"'))
    expect(cancel).toContain('onClick={() => setConfirmRegenerate(false)}')
    expect(cancel).not.toContain('setFormData')
    expect(cancel).not.toContain('generateAIDraft')
    expect(page).toContain('{regenerateReplaces(formData).map(')
    expect(page).toContain('{REGENERATE_KEEPS}')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 8: "Describe your pricing" says what it left out', () => {
  const names = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`)

  it('the limits are the ones there were', () => {
    expect(COMPILE_KEEPS).toEqual({ lines: 10, questions: 10, addons: 10, adjustments: 8 })
  })

  it('nothing is reported when everything fitted', () => {
    expect(leftOutOf({ lines: names(10, 'Line'), questions: names(10, 'Question'), addons: names(10, 'Extra'), adjustments: 8 })).toBeNull()
    expect(hasLeftOut(undefined)).toBe(false)
    expect(hasLeftOut(null)).toBe(false)
  })

  it('what is past the limit is named, in order', () => {
    const out = leftOutOf({ lines: names(12, 'Line'), questions: names(11, 'Question'), addons: [], adjustments: 9 })!
    expect(out.lines).toEqual(['Line 11', 'Line 12'])
    expect(out.questions).toEqual(['Question 11'])
    expect(out.addons).toEqual([])
    expect(out.adjustments).toBe(1)
    expect(hasLeftOut(out)).toBe(true)
    expect(leftOutLines(out)).toEqual([
      { title: '2 price lines left out (a service keeps 10)', names: ['Line 11', 'Line 12'] },
      { title: '1 question left out (a service keeps 10)', names: ['Question 11'] },
      { title: '1 adjustment left out (a service keeps 8)', names: [] },
    ])
  })

  it('the route names them from what the compiler wrote, and both reviews show them before "Apply"', () => {
    // T-204: what is done to the compiler's answer moved to lib/pricing-compile.ts (the route calls it)
    expect(code('app/api/services/ai-draft/compile/route.ts')).toContain('return NextResponse.json(finishCompile(responseText, body))')
    const route = code('lib/pricing-compile.ts')
    expect(route).toContain('const leftOut = leftOutOf({')
    expect(route).toContain('...(leftOut && { leftOut }),')
    expect(route).toContain('.slice(0, COMPILE_KEEPS.addons)')
    expect(route).toContain('.slice(0, COMPILE_KEEPS.adjustments)')
    expect(code('components/services/PricingComposer.tsx')).toContain('<LeftOutNote leftOut={result.leftOut} />')
    expect(code('components/onboarding/OnboardingFlow.tsx')).toContain('<LeftOutNote leftOut={compileResult.leftOut} />')
  })

  it('the bulk limit the compiler is cut to is still ten lines and ten questions', () => {
    const steps = names(14, 'Line').map((name, i) => ({ id: `s${i}`, name, costType: 'fixed', defaultCost: 10 }))
    const fields = names(13, 'Question').map((label, i) => ({ label, fieldId: `q${i}`, type: 'number' }))
    const draft = validateAndNormalizeDraftBulk({ pricing: { workSteps: steps }, suggestedFields: fields } as unknown as Partial<ServiceDraftConfig>)
    expect(draft.pricing.workSteps).toHaveLength(COMPILE_KEEPS.lines)
    expect(draft.suggestedFields).toHaveLength(COMPILE_KEEPS.questions)
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 9: amount boxes show the business’s currency symbol', () => {
  it('no amount box in the service editor has a typed "$"', () => {
    for (const file of ['app/(dashboard)/app/services/page.tsx', 'components/WorkStepEditor.tsx']) {
      const text = code(file)
      expect(text, file).not.toMatch(/>\$<\/span>/)
      expect(text, file).not.toMatch(/`\$\$\{/)
      expect(text, file).toContain('<AmountSymbol symbol={currencySymbol} />')
      expect(text, file).toContain('amountBoxPadding(currencySymbol)')
    }
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page.match(/<AmountSymbol symbol=\{currencySymbol\} \/>/g)?.length).toBe(3)
    expect(page).toContain('currencySymbol={currencySymbol}')
    expect(page).not.toContain("quotes will be $0'")
    // the symbol is the shared helper's, from the business's currency and region
    expect(page).toContain('setCurrencySymbol(sharedCurrencySymbol(currency, getRegion(data?.tenant?.region).locale))')
  })

  it('the example in "Describe your pricing" is in that currency too', () => {
    const composer = code('components/services/PricingComposer.tsx')
    expect(composer).not.toContain('£')
    expect(composer).toContain('placeholder={placeholder(currencySymbol)}')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 10: a fixed line ticked "Only include when…" with no question', () => {
  const dead = line({ name: 'Disposal fee', optional: true })

  it('is found, and the message says which line and what is missing', () => {
    expect(linesNeverCharged([dead, line()])).toEqual([dead])
    expect(priceLinesProblem([line(), dead])).toBe(lineNeedsQuestion(dead))
    expect(lineNeedsQuestion(dead)).toBe('"Disposal fee" is set to "Only include when condition is met", but no question is chosen. Choose its question, or untick it.')
    expect(lineNeedsQuestion({ name: '' })).toContain('"Unnamed item"')
  })

  it('a line with a question, a form condition, or no tick is fine; so is a per-unit line with a quantity', () => {
    expect(priceLinesProblem([line({ optional: true, triggerSignal: 'has_pet' })])).toBeNull()
    expect(priceLinesProblem([line({ optional: true, when: { fieldId: 'vehicle', equals: 'SUV' } })])).toBeNull()
    expect(priceLinesProblem([line()])).toBeNull()
    expect(priceLinesProblem([line({ optional: true, costType: 'per_unit', quantitySource: { type: 'form_field', fieldId: 'rooms' } })])).toBeNull()
    expect(priceLinesProblem(undefined)).toBeNull()
    expect(priceLinesProblem([])).toBeNull()
  })

  it('no template has such a line (a template’s service must always be addable)', () => {
    for (const pack of listPacks()) for (const svc of pack.services) expect(linesNeverCharged(svc.draft.pricing.workSteps), `${pack.id} / ${svc.name}`).toEqual([])
  })

  it('the editor stops the save and both routes refuse it', () => {
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('linesNeverCharged(formData.workSteps).forEach((step) => validationErrors.push(lineNeedsQuestion(step)))')
    expect(page).toContain('disabled={saving || !formData.name.trim() || !canPublish}')
    expect(code('components/WorkStepEditor.tsx')).toContain('data-testid="step-needs-question"')
    for (const route of ['app/api/services/route.ts', 'app/api/services/[id]/route.ts']) {
      const text = code(route)
      expect(text, route).toContain('const linesProblem = priceLinesProblem(pricingRules?.workSteps ?? workSteps)')
      expect(text, route).toContain("{ error: { code: 'INVALID_INPUT', message: linesProblem } }, { status: 400 }")
    }
  })

  it('a draft that holds one gets an add-on instead: the same extra, at the same price, that can be charged', () => {
    const draft = validateAndNormalizeDraft({
      pricing: {
        workSteps: [
          { id: 'a', name: 'Callout', costType: 'fixed', defaultCost: 80, optional: false },
          { id: 'b', name: 'Disposal fee', description: 'Taking the old unit away', costType: 'fixed', defaultCost: 45, optional: true },
          { id: 'c', name: 'Stairs', costType: 'fixed', defaultCost: 30, optional: true, triggerSignal: 'has_stairs' },
        ],
        addOns: [{ name: 'Weekend visit', price: 60, description: 'Saturday or Sunday' }],
      },
    } as unknown as Partial<ServiceDraftConfig>)
    expect(draft.pricing.workSteps.map((s) => s.name)).toEqual(['Callout', 'Stairs'])
    expect(draft.pricing.addOns).toEqual([
      { name: 'Weekend visit', price: 60, description: 'Saturday or Sunday' },
      { name: 'Disposal fee', price: 45, description: 'Taking the old unit away' },
    ])
    expect(priceLinesProblem(draft.pricing.workSteps)).toBeNull()
  })

  it('an adjustment or a condition that points at a question the service no longer has is said on "Test & Publish"', () => {
    const fields = [question({ label: 'Rooms', fieldId: 'rooms', type: 'number', mapsToSignal: 'room_count' })]
    const signals: ExpectedSignalConfig[] = [{ signalKey: 'room_count', type: 'number', description: 'Rooms' }]
    expect(looseReferences({ workSteps: [line({ optional: true, triggerSignal: 'room_count' })], multipliers: [{ when: { fieldId: 'rooms', equals: 3 }, multiplier: 1.1 }], suggestedFields: fields, expectedSignals: signals })).toEqual([])
    const loose = looseReferences({
      workSteps: [line({ name: 'Stairs', optional: true, triggerSignal: 'has_stairs' })],
      multipliers: [{ when: { fieldId: 'old_question', equals: 'yes' }, multiplier: 1.1 }, { when: { subject: 'subtotal', operator: 'gt', value: 500 }, multiplier: 0.9 }],
      suggestedFields: fields,
      expectedSignals: signals,
    })
    expect(loose).toHaveLength(2)
    expect(loose[0]).toContain('"Stairs"')
    expect(loose[1]).toContain('An adjustment uses a question this service no longer has')
  })
})

// ---------------------------------------------------------------------------------------------
describe('T-201 item 12: a template’s service is added switched off', () => {
  const pack = listPacks('US').filter((p) => p.region === 'US')[0]!
  const money = (n: number) => `$${n}`

  it('the request that adds it says so, and the row is created off', () => {
    const key = templateGroups('US', [], money)[0]!.services[0]!.key
    const payload = templatePayload('US', key, [])!
    expect(payload.active).toBe(false)
    expect(serviceInsertRow('tnt_test', payload).active).toBe(false)
  })

  it('every other way of creating a service still creates it on (setup, the editor, an import)', () => {
    const svc = pack.services[0]!
    const fromSetup = servicePayload({ name: svc.name, description: svc.description, draft: svc.draft, addons: svc.addons || [], multipliers: svc.multipliers || [] })
    expect('active' in fromSetup).toBe(false)
    expect(serviceInsertRow('tnt_test', fromSetup).active).toBe(true)
    expect(serviceInsertRow('tnt_test', { name: 'Gutter cleaning' }).active).toBe(true)
    expect(serviceInsertRow('tnt_test', { name: 'Gutter cleaning', active: true }).active).toBe(true)
  })

  it('the picker says it before, and the page says it after, until the service is switched on', () => {
    const picker = code('components/services/TemplatePicker.tsx')
    expect(picker).toContain('A service you add starts switched off.')
    const page = code('app/(dashboard)/app/services/page.tsx')
    expect(page).toContain('setAddedOff({ id: service.id, name: service.name })')
    expect(page).toContain('data-testid="template-added-note"')
    expect(page).toContain('Its prices are examples, not yours.')
    expect(page).toContain('data-testid="template-prices-note"')
    expect(page).toContain('if (data.service?.active) setAddedOff((note) => (note?.id === service.id ? null : note))')
  })
})
