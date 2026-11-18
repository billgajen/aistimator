/**
 * T-179 (AD-061): price another of the business's services as a SECTION of
 * an existing quote.
 *
 * The price comes from the rules engine and that service's full rules (work
 * steps, add-ons, its own minimum), through the same pipeline a request for
 * that service alone goes through, run in section mode: no AI call, no
 * photos, nothing written. What it needs that it does not have is turned
 * into questions for the customer:
 *
 *   - the service's own required or price-critical questions, from its
 *     configuration, that have no answer yet;
 *   - one number question for each quantity the service prices by that it
 *     would normally have measured from photos (the no-photo path: ask);
 *   - a quantity the engine could only fill with a placeholder.
 *
 * With no questions left, the result is the section: its lines, its
 * subtotal before tax, and the review setting of its service. Tax and the
 * quote's totals are worked out by the web app, once, for the whole quote
 * (packages/shared/src/quote-sections.ts).
 *
 * The AI never appears here. Pre-filled answers (read from the customer's
 * note on the first pass) are only ever suggestions on a question; a value
 * prices the section only after the customer sent it back as their answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractFormulaIdentifiers, reviewModeOf, roundMoney } from '@qolumns/shared'
import type { QuoteSection, ReviewMode, SectionAnswer, SectionQuestion, WidgetField } from '@qolumns/shared'
import { processQuote, SECTION_QUANTITY_KEY } from './quote-processor'
import type { SectionRun } from './quote-processor'
import { snapToOption } from './answer-options'
import type { Env } from './index'

type AnswerValue = string | number | boolean | string[]
export interface RawAnswer {
  fieldId: string
  value: AnswerValue
}

export interface SectionField extends WidgetField {
  /** A question the business asks for every service: the customer's answer on the main request carries over */
  shared: boolean
}

/** The description box and other fields the app adds for itself are never a service's question */
const isOwnField = (fieldId: string) => !fieldId.startsWith('_')

const answered = (value: unknown) =>
  value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)

/**
 * The questions that apply to a service, by the rule the request form uses:
 * the service's own row, plus the business-wide row's questions that are
 * unscoped (asked for every service) or scoped to this service. Pure.
 */
export function fieldsForService(
  rows: Array<{ service_id: string | null; config_json: { fields?: Array<WidgetField & { serviceId?: string | null }> } | null }> | null | undefined,
  serviceId: string
): SectionField[] {
  const out: SectionField[] = []
  const seen = new Set<string>()
  // the service's own questions first, so they win over a business-wide one with the same id
  const ordered = [...(rows ?? [])].sort((a, b) => Number(a.service_id === null) - Number(b.service_id === null))
  for (const row of ordered) {
    for (const field of row.config_json?.fields ?? []) {
      if (!field?.fieldId || seen.has(field.fieldId) || !isOwnField(field.fieldId)) continue
      const applies = row.service_id === null ? !field.serviceId || field.serviceId === serviceId : row.service_id === serviceId
      if (!applies) continue
      seen.add(field.fieldId)
      out.push({ ...field, shared: row.service_id === null && !field.serviceId })
    }
  }
  return out
}

const questionType = (field: Pick<WidgetField, 'type' | 'options'>): SectionQuestion['type'] =>
  field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : (field.type === 'select' || field.type === 'multiselect') && field.options?.length ? 'select' : 'text'

const fieldQuestion = (field: WidgetField): SectionQuestion => ({
  key: field.fieldId,
  label: field.label,
  type: questionType(field),
  ...(questionType(field) === 'select' && { options: (field.options ?? []).map((o) => ({ value: o.value, label: o.label || o.value })) }),
})

/**
 * Make the answers the engine reads from what was sent: unknown keys are
 * dropped, a choice must be one of the question's options, a number must be
 * a number. Anything that does not pass is simply not an answer (the question
 * is asked again). Pure.
 */
export function cleanAnswers(raw: readonly RawAnswer[] | null | undefined, fields: readonly WidgetField[], quantityKeys: ReadonlySet<string>): RawAnswer[] {
  const byId = new Map(fields.map((f) => [f.fieldId, f]))
  const out = new Map<string, RawAnswer>()
  for (const answer of raw ?? []) {
    if (!answer || typeof answer.fieldId !== 'string' || !answered(answer.value)) continue
    const field = byId.get(answer.fieldId)
    if (field) {
      if (field.type === 'number') {
        const n = Number(String(answer.value).replace(/,(?=\d{3}\b)/g, ''))
        if (Number.isFinite(n) && n >= 0) out.set(field.fieldId, { fieldId: field.fieldId, value: n })
      } else if (field.type === 'boolean') {
        const v = answer.value
        if (v === true || v === false) out.set(field.fieldId, { fieldId: field.fieldId, value: v })
        else if (/^(yes|true)$/i.test(String(v))) out.set(field.fieldId, { fieldId: field.fieldId, value: true })
        else if (/^(no|false)$/i.test(String(v))) out.set(field.fieldId, { fieldId: field.fieldId, value: false })
      } else if (field.type === 'select' && field.options?.length) {
        const snapped = snapToOption(answer.value, field.options.map((o) => ({ value: o.value, label: o.label || o.value })))
        if (snapped !== null) out.set(field.fieldId, { fieldId: field.fieldId, value: snapped })
      } else if (field.type === 'multiselect' && field.options?.length) {
        const options = field.options.map((o) => ({ value: o.value, label: o.label || o.value }))
        const picked = (Array.isArray(answer.value) ? answer.value : [answer.value])
          .map((v) => snapToOption(v, options))
          .filter((v): v is string => v !== null)
        if (picked.length) out.set(field.fieldId, { fieldId: field.fieldId, value: picked })
      } else {
        out.set(field.fieldId, { fieldId: field.fieldId, value: String(answer.value).replace(/\s+/g, ' ').trim().slice(0, 500) })
      }
    } else if (quantityKeys.has(answer.fieldId)) {
      // a quantity the service prices by: a positive number, nothing else
      const n = Number(String(answer.value).replace(/,(?=\d{3}\b)/g, ''))
      if (Number.isFinite(n) && n > 0) out.set(answer.fieldId, { fieldId: answer.fieldId, value: n })
    }
  }
  return [...out.values()]
}

/** Every key that can carry a quantity for this service: the quantities it prices by, and "how many" for a per-unit price. Pure. */
export function quantityKeysOf(run: Pick<SectionRun, 'rules' | 'service'>): Set<string> {
  const keys = new Set<string>([SECTION_QUANTITY_KEY])
  for (const step of run.rules.workSteps ?? []) {
    const source = step.quantitySource
    if (source?.type === 'ai_signal' && source.signalKey) keys.add(source.signalKey)
    if (source?.type === 'form_field' && source.fieldId) keys.add(source.fieldId)
    if (source?.type === 'derived' && source.formula) for (const id of extractFormulaIdentifiers(source.formula) ?? []) keys.add(id)
    if (!source) keys.add(step.id)
  }
  return keys
}

/**
 * What still has to be asked before this run's price can stand. Pure.
 * `fields` are the service's applicable questions; `have` the answers the run was priced from.
 */
export function questionsFor(run: SectionRun, fields: readonly WidgetField[], have: readonly RawAnswer[]): SectionQuestion[] {
  const has = (key: string) => have.some((a) => a.fieldId === key && answered(a.value))
  const byId = new Map(fields.map((f) => [f.fieldId, f]))
  const questions: SectionQuestion[] = []
  const add = (q: SectionQuestion) => {
    if (!questions.some((x) => x.key === q.key)) questions.push(q)
  }

  // 1. The service's own required or price-critical questions
  for (const field of fields) {
    if ((field.required || field.criticalForPricing) && !has(field.fieldId)) add(fieldQuestion(field))
  }

  // 2. Quantities it would have measured from photos: ask the customer (the no-photo path)
  const expected = run.service.expected_signals ?? []
  for (const missing of run.missingQuantitySignals) {
    if (has(missing.signalKey)) continue
    const field = byId.get(missing.signalKey) ?? fields.find((f) => f.mapsToSignal === missing.signalKey)
    if (field) {
      if (!has(field.fieldId)) add(fieldQuestion(field))
      continue
    }
    const signal = expected.find((es) => es.signalKey === missing.signalKey)
    add({ key: missing.signalKey, label: signal?.description?.trim() || missing.stepName, type: 'number', ...(signal?.unit && { unit: signal.unit }) })
  }

  // 3. A line the engine could only price with a placeholder quantity
  for (const traced of run.pricingTrace.trace) {
    if (traced.type !== 'work_step') continue
    if (traced.quantitySource !== 'legacy_fallback' && traced.quantitySource !== 'derived_unresolved') continue
    const step = run.rules.workSteps?.find((ws) => ws.id === traced.id)
    if (!step) continue
    let key: string | undefined
    if (step.quantitySource?.type === 'form_field') key = step.quantitySource.fieldId
    else if (step.quantitySource?.type === 'derived' && step.quantitySource.formula) {
      const ids = extractFormulaIdentifiers(step.quantitySource.formula) ?? []
      key = ids.find((id) => !has(id)) ?? ids[0]
    } else key = step.id
    if (!key || has(key)) continue
    const field = byId.get(key)
    add(field ? { ...fieldQuestion(field), type: 'number' } : { key, label: step.name, type: 'number' })
  }

  // 4. A per-unit price with no "how many"
  const model = run.rules.measurementModel
  if (model?.type === 'per_unit' && model.pricePerUnit > 0 && !has(SECTION_QUANTITY_KEY)) {
    add({ key: SECTION_QUANTITY_KEY, label: `How many ${model.unitLabel || model.unit || 'units'}?`, type: 'number', ...(model.unit && { unit: model.unitLabel || model.unit }) })
  }
  return questions
}

/** The answers as the business reads them on the quote: each under its question's wording. Pure. */
export function labelledAnswers(answers: readonly RawAnswer[], fields: readonly WidgetField[], questions: readonly SectionQuestion[] = []): SectionAnswer[] {
  const label = (key: string) => fields.find((f) => f.fieldId === key)?.label ?? questions.find((q) => q.key === key)?.label ?? key
  return answers.map((a) => ({ key: a.fieldId, label: label(a.fieldId), value: Array.isArray(a.value) ? a.value.join(', ') : a.value }))
}

export type SectionPriceResult =
  | { ok: false; reason: 'not_a_service' | 'no_price' | 'failed' }
  | { ok: true; ready: false; serviceName: string; questions: SectionQuestion[]; reviewMode: ReviewMode }
  | { ok: true; ready: true; serviceName: string; section: Omit<QuoteSection, 'addedBy' | 'addedAt'>; reviewMode: ReviewMode }

export interface PriceSectionInput {
  quoteId: string
  serviceId: string
  /** The customer's (or the business's) answers to the service's own questions */
  answers?: RawAnswer[]
  /** Labels for quantity questions that are not form fields (kept from the first pass), for the stored answers */
  knownQuestions?: SectionQuestion[]
}

/**
 * Price `serviceId` as a section of `quoteId`. Reads only; the caller stores
 * the result. Never throws.
 */
export async function priceSection(supabase: SupabaseClient, env: Env, input: PriceSectionInput): Promise<SectionPriceResult> {
  try {
    const { data: quote } = await supabase.from('quotes').select('tenant_id, service_id, quote_request_id').eq('id', input.quoteId).single()
    const row = quote as { tenant_id?: string; service_id?: string; quote_request_id?: string } | null
    if (!row?.tenant_id || row.service_id === input.serviceId) return { ok: false, reason: 'not_a_service' }

    const [{ data: configRows }, { data: rules }, { data: request }] = await Promise.all([
      supabase.from('widget_configs').select('service_id, config_json').eq('tenant_id', row.tenant_id),
      supabase.from('service_pricing_rules').select('service_id').eq('service_id', input.serviceId).maybeSingle(),
      supabase.from('quote_requests').select('job_answers').eq('id', row.quote_request_id).single(),
    ])
    // KC-002: a service with no pricing configured is never offered
    if (!rules) return { ok: false, reason: 'no_price' }

    const fields = fieldsForService(configRows as Parameters<typeof fieldsForService>[0], input.serviceId)
    // What the customer already answered for a question the business asks of every service carries over
    const sharedIds = new Set(fields.filter((f) => f.shared).map((f) => f.fieldId))
    const mainAnswers = ((request as { job_answers?: RawAnswer[] } | null)?.job_answers ?? []).filter((a) => sharedIds.has(a.fieldId))

    // First run with what is known, to learn which quantities this service prices by
    const price = async (answers: RawAnswer[]) => {
      const result = await processQuote(input.quoteId, '', supabase, env, undefined, { section: { serviceId: input.serviceId, answers } })
      return result.success ? result.sectionRun ?? null : null
    }
    const probe = await price(cleanAnswers(mainAnswers, fields, new Set()))
    if (!probe) return { ok: false, reason: 'not_a_service' }
    const quantityKeys = quantityKeysOf(probe)
    const carried = cleanAnswers(mainAnswers, fields, quantityKeys)
    const given = cleanAnswers(input.answers, fields, quantityKeys)
    const all = [...carried.filter((c) => !given.some((g) => g.fieldId === c.fieldId)), ...given]

    const run = given.length > 0 ? await price(all) : probe
    if (!run) return { ok: false, reason: 'failed' }

    const questions = questionsFor(run, fields, all)
    if (questions.length > 0) return { ok: true, ready: false, serviceName: run.service.name, questions, reviewMode: reviewModeOf(run.service) }

    const subtotal = roundMoney(run.pricing.subtotal)
    // KC-002: nothing is offered at no price
    if (!(subtotal > 0)) return { ok: false, reason: 'no_price' }
    return {
      ok: true,
      ready: true,
      serviceName: run.service.name,
      reviewMode: reviewModeOf(run.service),
      section: {
        serviceId: input.serviceId,
        serviceName: run.service.name,
        breakdown: run.pricing.breakdown.map((line) => ({ ...line, amount: roundMoney(line.amount) })),
        subtotal,
        ...(run.service.tax_exempt === true && { taxExempt: true }),
        ...(given.length > 0 && { answers: labelledAnswers(given, fields, input.knownQuestions) }),
      },
    }
  } catch (error) {
    console.error(`[Section] Could not price a section for ${input.quoteId}: ${error instanceof Error ? error.name : 'unknown error'}`)
    return { ok: false, reason: 'failed' }
  }
}

/**
 * T-179: take any mention of an offered other service out of the main
 * service's wording. The wording model is told not to mention work the
 * customer can add to this quote (ai/wording.ts); this is the check in code
 * behind that instruction. An exclusion that names the service is dropped,
 * and so is a sentence of the notes that names it: "Service B is not
 * included" must not sit on a quote that carries Service B as a section.
 * Only whole items and whole sentences are removed; nothing is rewritten.
 * Pure. The names are the business's own service names.
 */
export function withoutMentionsOf<T extends { exclusions?: string[]; notes?: string }>(content: T, serviceNames: readonly string[]): T {
  const names = serviceNames.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3)
  if (names.length === 0) return content
  const mentions = (text: string) => names.some((n) => text.toLowerCase().includes(n))
  const exclusions = content.exclusions?.filter((item) => !mentions(item))
  const notes =
    typeof content.notes === 'string'
      ? (content.notes.match(/[^.!?]+[.!?]*\s*/g) ?? [content.notes])
          .filter((sentence) => !mentions(sentence))
          .join('')
          .trim()
      : content.notes
  return { ...content, ...(exclusions && { exclusions }), ...(typeof notes === 'string' && { notes }) }
}

