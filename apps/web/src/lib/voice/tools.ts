/**
 * T-210: her tools. Each one runs here, on our server.
 *
 * The page only passes a call through. The business is the call session's (`runTool` is handed it
 * and never reads one from the arguments), and every argument is checked: a name that is not a
 * tool's, an argument a tool does not take, a service that is not this business's, a question
 * that is not that service's, a value of the wrong kind, a slot that is not on offer, are all
 * turned away with a line she can act on.
 *
 * - get_business_info reads the business's configuration.
 * - get_estimate asks the pricing worker's `/preview`, the path "Test your pricing" uses
 *   (T-204): the real rules engine, no AI, no photos, and nothing written, sent or counted.
 * - get_free_times gives FAKE test slots (slots.ts). No calendar exists yet.
 * - book_time and request_person DO NOTHING. They answer with what would have happened, for the
 *   test page to show.
 *
 * No side effect anywhere in this file: no row is written, no message is sent.
 */
import { formatMoney } from '@qolumns/shared'
import type { WidgetField } from '@qolumns/shared'
import type { WorkerPreview } from '@/lib/pricing-preview'
import type { VoiceBusiness, VoiceService } from './business'
import { isTestSlot, parseCivilDate, testSlots } from './slots'

export const TOOL_NAMES = ['get_business_info', 'get_estimate', 'get_free_times', 'book_time', 'request_person'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

/** The tools as the Live API is told of them. `BLOCKING`: she waits for the answer before she speaks again. */
export function toolDeclarations() {
  const text = { type: 'STRING' }
  return [
    { name: 'get_business_info', behavior: 'BLOCKING', description: "The business's name, time zone, service area, standard terms and services, with each service's description, what is and is not included, and the questions to ask before an estimate. Call once at the start of the call.", parameters: { type: 'OBJECT', properties: {} } },
    {
      name: 'get_estimate',
      behavior: 'BLOCKING',
      description: "An estimate for one service from the customer's answers, worked out by the business's own prices. The only source of a price.",
      parameters: {
        type: 'OBJECT',
        properties: {
          serviceId: { ...text, description: 'The id of the service, from get_business_info.' },
          answers: {
            type: 'ARRAY',
            description: "The customer's answers to that service's questions (and any measurement they gave).",
            items: { type: 'OBJECT', properties: { questionId: { ...text, description: 'The id of the question or measurement.' }, value: { ...text, description: 'The answer. For a choice, one of its listed values. For a number, digits only.' } }, required: ['questionId', 'value'] },
          },
        },
        required: ['serviceId', 'answers'],
      },
    },
    { name: 'get_free_times', behavior: 'BLOCKING', description: 'Times the business is free for a visit.', parameters: { type: 'OBJECT', properties: { fromDate: { ...text, description: 'The first day to look at, as YYYY-MM-DD. Leave out for the next free times.' } } } },
    {
      name: 'book_time',
      behavior: 'BLOCKING',
      description: "Book a visit at one of the free times. Needs the customer's name and a phone number or an email address.",
      parameters: { type: 'OBJECT', properties: { slot: { ...text, description: 'The id of the free time, from get_free_times.' }, name: text, phone: text, email: text }, required: ['slot', 'name'] },
    },
    { name: 'request_person', behavior: 'BLOCKING', description: 'Pass the customer to a person at the business, or alert the business to an urgent problem.', parameters: { type: 'OBJECT', properties: { reason: { ...text, description: 'In a sentence, what the customer needs.' }, urgent: { type: 'BOOLEAN' } }, required: ['reason'] } },
  ]
}

export type ToolErrorCode = 'UNKNOWN_TOOL' | 'INVALID_ARGUMENT' | 'UNKNOWN_SERVICE' | 'MISSING_ANSWERS' | 'NO_PRICE' | 'ESTIMATE_UNAVAILABLE' | 'UNKNOWN_SLOT' | 'MISSING_CONTACT'

export type ToolOutcome =
  | {
      ok: true
      /** What she is given back */
      result: Record<string, unknown>
      /** What the test page shows for a tool that only pretends: "would book …", "would pass to a person …" */
      wouldDo?: string
      /** For get_estimate: the engine's figures, for the page's price check */
      engine?: { currency: string; total: number; subtotal: number; taxAmount: number; lines: number[] }
    }
  | { ok: false; code: ToolErrorCode; message: string }

export interface ToolDeps {
  /** The pricing worker's `/preview` (lib/pricing-preview `previewPriceNow`) */
  price: (input: unknown) => Promise<WorkerPreview>
  now?: () => Date
}

const refuse = (code: ToolErrorCode, message: string): ToolOutcome => ({ ok: false, code, message })
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The arguments as an object holding only the names a tool takes; null when it holds anything else */
function only(args: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  const given = args === undefined || args === null ? {} : args
  if (!isRecord(given)) return null
  return Object.keys(given).every((key) => allowed.includes(key)) ? given : null
}

const shortText = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null)

/** What she is told about the business: its configuration, and nothing the pricing worker needs */
export function businessInfo(b: VoiceBusiness) {
  return {
    name: b.name,
    timeZone: b.timeZone,
    currency: b.currency,
    serviceArea: b.serviceArea.everywhere
      ? { covers: 'The business has not limited the area it covers.' }
      : { covers: `Only the areas listed (each is a ${b.serviceArea.postalCodeLabel}, the start of one, or a named area).`, areas: b.serviceArea.areas },
    standardTerms: b.terms ?? 'None written.',
    services: b.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      included: s.included,
      notIncluded: s.notIncluded,
      assumptions: s.assumptions,
      questions: s.questions.map((q) => ({ id: q.id, ask: q.question, kind: q.type, required: q.required, ...(q.choices.length > 0 && { choices: q.choices }), ...(q.help && { hint: q.help }) })),
      ...(s.measurements.length > 0 && { measurements: s.measurements.map((m) => ({ id: m.id, what: m.what, ...(m.unit && { unit: m.unit }) })) }),
    })),
  }
}

type Answer = { fieldId: string; value: string | number | boolean | string[] }

const YES = new Set(['yes', 'y', 'true', 'yeah', 'yep'])
const NO = new Set(['no', 'n', 'false', 'nope'])

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^\s*-?\d[\d,]*(\.\d+)?\s*$/.test(value)) return null
  const n = Number(value.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** One answer in the form the request form sends it, or a line saying what is wrong with it */
function readAnswer(field: Pick<WidgetField, 'fieldId' | 'type' | 'label' | 'options'>, value: unknown): Answer | string {
  const options = field.options ?? []
  const pick = (given: string) => options.find((o) => String(o.value).toLowerCase() === given.toLowerCase() || String(o.label).toLowerCase() === given.toLowerCase())
  if (field.type === 'number') {
    const n = toNumber(value)
    return n === null || n < 0 || n > 1_000_000 ? `"${field.label}" needs a number.` : { fieldId: field.fieldId, value: n }
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return { fieldId: field.fieldId, value }
    const said = typeof value === 'string' ? value.trim().toLowerCase() : ''
    return YES.has(said) ? { fieldId: field.fieldId, value: true } : NO.has(said) ? { fieldId: field.fieldId, value: false } : `"${field.label}" needs yes or no.`
  }
  if (field.type === 'select' && options.length > 0) {
    const option = typeof value === 'string' ? pick(value.trim()) : undefined
    return option ? { fieldId: field.fieldId, value: String(option.value) } : `"${field.label}" must be one of: ${options.map((o) => o.label).join(', ')}.`
  }
  if (field.type === 'multiselect' && options.length > 0) {
    const given = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
    const picked = given.map((v) => (typeof v === 'string' ? pick(v.trim()) : undefined))
    return picked.length > 0 && picked.every((o) => o !== undefined) ? { fieldId: field.fieldId, value: picked.map((o) => String(o!.value)) } : `"${field.label}" must be one or more of: ${options.map((o) => o.label).join(', ')}.`
  }
  const text = shortText(typeof value === 'number' || typeof value === 'boolean' ? String(value) : value, 300)
  return text === null ? `"${field.label}" needs a short answer.` : { fieldId: field.fieldId, value: text }
}

/** The customer's answers, checked against this service's own questions and measurements */
export function readAnswers(service: VoiceService, given: unknown): { answers: Answer[] } | { error: ToolOutcome } {
  if (!Array.isArray(given) || given.length > 60) return { error: refuse('INVALID_ARGUMENT', 'answers must be a list of { questionId, value }.') }
  const answers = new Map<string, Answer>()
  for (const item of given) {
    const entry = only(item, ['questionId', 'value'])
    const id = entry ? shortText(entry.questionId, 120) : null
    if (!entry || !id) return { error: refuse('INVALID_ARGUMENT', 'Each answer needs a questionId and a value.') }
    const field = service.fields.find((f) => f.fieldId === id)
    const measurement = service.measurements.find((m) => m.id === id)
    if (!field && !measurement) return { error: refuse('INVALID_ARGUMENT', `"${id}" is not one of this service's questions. Use the ids from get_business_info.`) }
    const read = field ? readAnswer(field, entry.value) : readAnswer({ fieldId: id, type: 'number', label: measurement!.what }, entry.value)
    if (typeof read === 'string') return { error: refuse('INVALID_ARGUMENT', read) }
    answers.set(id, read)
  }
  const missing = service.fields.filter((f) => f.required && !answers.has(f.fieldId))
  if (missing.length > 0) return { error: refuse('MISSING_ANSWERS', `Ask the customer first: ${missing.map((f) => f.label).join('; ')}.`) }
  return { answers: [...answers.values()] }
}

async function getEstimate(b: VoiceBusiness, args: unknown, deps: ToolDeps): Promise<ToolOutcome> {
  const given = only(args, ['serviceId', 'answers'])
  if (!given) return refuse('INVALID_ARGUMENT', 'get_estimate takes serviceId and answers only.')
  const serviceId = shortText(given.serviceId, 120)
  // Only a service of the call's own business: the id is looked up in that business's list and nowhere else
  const service = serviceId ? b.services.find((s) => s.id === serviceId) : undefined
  if (!service) return refuse('UNKNOWN_SERVICE', 'That is not one of this business\'s services. Use an id from get_business_info.')
  if (!service.rules) return refuse('NO_PRICE', 'This service has no prices set. Do not give a price: say the business will confirm it.')
  const read = readAnswers(service, given.answers)
  if ('error' in read) return read.error

  const priced = await deps.price({ tenantId: b.id, service: service.row, rules: service.rules, fields: service.fields, answers: read.answers })
  if (!priced.success) return refuse('ESTIMATE_UNAVAILABLE', 'The estimate is not available right now. Do not give a price: say the business will confirm it.')
  const money = (amount: number) => formatMoney(amount, priced.currency, b.locale)
  return {
    ok: true,
    engine: { currency: priced.currency, total: priced.total, subtotal: priced.subtotal, taxAmount: priced.taxAmount, lines: priced.lines.map((l) => l.amount) },
    result: {
      service: service.name,
      currency: priced.currency,
      total: priced.total,
      totalAsText: money(priced.total),
      ...(priced.taxAmount > 0 && { subtotal: priced.subtotal, tax: { label: priced.taxLabel ?? 'Tax', amount: priced.taxAmount } }),
      lines: priced.lines.map((l) => ({ label: l.label, amount: l.amount })),
      ...(priced.unmeasured.length > 0 && { notInThisEstimate: priced.unmeasured.map((u) => u.name), notInThisEstimateWhy: 'These are priced from a size the business measures. They are not in the total.' }),
      status: 'An estimate. The business will confirm it.',
    },
  }
}

function getFreeTimes(b: VoiceBusiness, args: unknown, now: Date): ToolOutcome {
  const given = only(args, ['fromDate'])
  if (!given) return refuse('INVALID_ARGUMENT', 'get_free_times takes fromDate only.')
  if (given.fromDate !== undefined && given.fromDate !== null && given.fromDate !== '' && !parseCivilDate(given.fromDate)) return refuse('INVALID_ARGUMENT', 'fromDate must be a date as YYYY-MM-DD.')
  const free = testSlots({ fromDate: typeof given.fromDate === 'string' ? given.fromDate : null, timeZone: b.timeZone, locale: b.locale, now })
  // TEST DATA: made-up slots (slots.ts). The model is given the times; the page is told they are not real.
  return { ok: true, result: { timeZone: free.timeZone, freeTimes: free.slots.map((s) => ({ id: s.id, when: s.label })) }, wouldDo: `TEST DATA: ${free.slots.length} made-up free times from ${free.slots[0]?.date}` }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function bookTime(b: VoiceBusiness, args: unknown, now: Date): ToolOutcome {
  const given = only(args, ['slot', 'name', 'phone', 'email'])
  if (!given) return refuse('INVALID_ARGUMENT', 'book_time takes slot, name, phone and email only.')
  const slot = isTestSlot(given.slot, { timeZone: b.timeZone, now })
  if (!slot) return refuse('UNKNOWN_SLOT', 'That is not one of the free times. Use an id from get_free_times.')
  const name = shortText(given.name, 120)
  if (!name) return refuse('INVALID_ARGUMENT', "book_time needs the customer's name.")
  const phoneText = shortText(given.phone, 40)
  const phoneDigits = phoneText ? phoneText.replace(/\D/g, '') : ''
  const phone = phoneText && /^[\d\s()+.-]+$/.test(phoneText) && phoneDigits.length >= 7 && phoneDigits.length <= 15 ? phoneText : null
  const emailText = shortText(given.email, 200)
  const email = emailText && EMAIL.test(emailText) ? emailText : null
  if ((given.phone !== undefined && given.phone !== '' && !phone) || (given.email !== undefined && given.email !== '' && !email)) return refuse('INVALID_ARGUMENT', 'That phone number or email address does not look right. Ask the customer to say it again.')
  if (!phone && !email) return refuse('MISSING_CONTACT', "Ask for the customer's phone number or email address first.")
  // Nothing is booked: this is the test. The page shows what would have been.
  return {
    ok: true,
    result: { status: 'noted', tellTheCustomer: `The visit is noted for ${slot.label}. ${b.name} will confirm it.` },
    wouldDo: `would book: ${slot.label} (${b.timeZone}) for ${name}, ${[phone, email].filter(Boolean).join(', ')}`,
  }
}

function requestPerson(b: VoiceBusiness, args: unknown): ToolOutcome {
  const given = only(args, ['reason', 'urgent'])
  if (!given) return refuse('INVALID_ARGUMENT', 'request_person takes reason and urgent only.')
  const reason = shortText(given.reason, 500)
  if (!reason) return refuse('INVALID_ARGUMENT', 'request_person needs the reason, in a sentence.')
  if (given.urgent !== undefined && typeof given.urgent !== 'boolean') return refuse('INVALID_ARGUMENT', 'urgent must be true or false.')
  const urgent = given.urgent === true
  // Nobody is told: this is the test. The page shows what would have been.
  return {
    ok: true,
    result: { status: 'passed on', tellTheCustomer: urgent ? `${b.name} has been alerted and will call back as soon as they can.` : `Someone from ${b.name} will get back to them.` },
    wouldDo: `would pass to a person${urgent ? ' (URGENT)' : ''}: ${reason}`,
  }
}

/**
 * Run one of her tools for the call's business. `business` is the one the call session names,
 * loaded by the route: no argument can change it.
 */
export async function runTool(business: VoiceBusiness, name: unknown, args: unknown, deps: ToolDeps): Promise<ToolOutcome> {
  const now = deps.now?.() ?? new Date()
  switch (name) {
    case 'get_business_info':
      return only(args, []) ? { ok: true, result: businessInfo(business) } : refuse('INVALID_ARGUMENT', 'get_business_info takes no arguments.')
    case 'get_estimate':
      return getEstimate(business, args, deps)
    case 'get_free_times':
      return getFreeTimes(business, args, now)
    case 'book_time':
      return bookTime(business, args, now)
    case 'request_person':
      return requestPerson(business, args)
    default:
      return refuse('UNKNOWN_TOOL', 'There is no such tool.')
  }
}

/** What goes back to her for an outcome: the result, or the error as a line she can act on */
export const toolResponse = (outcome: ToolOutcome): Record<string, unknown> => (outcome.ok ? outcome.result : { error: outcome.message })
