/**
 * T-210, T-211: her tools. Each one runs here, on our server.
 *
 * The page only passes a call through. The business and the caller's details are the call
 * session's (`runTool` is handed them and never reads either from the arguments), and every
 * argument is checked: a name that is not a tool's, an argument a tool does not take, a service
 * that is not this business's, a question that is not that service's, a value of the wrong kind,
 * a slot that is not on offer, are all turned away with a line she can act on.
 *
 * - get_typical_price and get_estimate ask the pricing worker's `/preview`, the path "Test your
 *   pricing" uses (T-204): the real rules engine, no AI, no photos, nothing written or counted.
 *   One service a call: the preview prices one service, so several services are several answers,
 *   and no total of them is made here or by her (the written estimate has it).
 * - get_free_times gives FAKE test slots (slots.ts). No calendar exists yet.
 * - book_time, send_estimate and request_person DO NOTHING. They answer with what
 *   would have happened, for the test page to show.
 * - update_contact changes the caller's details in the call session, and nowhere else.
 * - end_call says why she is ending the call. The route keeps a strike for an off-topic or
 *   abusive ending (guard.ts); this file does not.
 *
 * No side effect anywhere in this file: no row is written, no message is sent.
 */
import { formatMoney } from '@qolumns/shared'
import type { WidgetField } from '@qolumns/shared'
import { checkContact } from '../contact-rules'
import type { WorkerPreview } from '@/lib/pricing-preview'
import type { VoiceBusiness, VoiceService } from './business'
import { END_REASONS, type EndReason } from './guard-config'
import { moneyWords } from './money-words'
import type { CallContact, CallNotes, CallSession } from './session'
import { isTestSlot, parseCivilDate, testSlots } from './slots'
import { typicalPrice } from './typical'

export const TOOL_NAMES = ['get_typical_price', 'get_estimate', 'get_free_times', 'book_time', 'send_estimate', 'update_contact', 'request_person', 'end_call'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

interface ToolSpec {
  name: ToolName
  description: string
  /** JSON Schema, lower-case types */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

const text = { type: 'string' }

/** The tools, once, in plain JSON Schema. Each engine is told of them in its own spelling. */
export const TOOLS: readonly ToolSpec[] = [
  { name: 'get_typical_price', description: 'What we normally charge for a service, before the caller has given details.', parameters: { type: 'object', properties: { serviceId: { ...text, description: 'Service id.' } }, required: ['serviceId'] } },
  {
    name: 'get_estimate',
    description: "An estimate for one service from the caller's answers. One service a call.",
    parameters: {
      type: 'object',
      properties: {
        serviceId: { ...text, description: 'Service id.' },
        answers: {
          type: 'array',
          description: "The caller's answers.",
          items: { type: 'object', properties: { questionId: { ...text, description: 'Question or measurement id.' }, value: { ...text, description: 'For a choice, one of its values. For a number, digits only.' } }, required: ['questionId', 'value'] },
        },
      },
      required: ['serviceId', 'answers'],
    },
  },
  { name: 'get_free_times', description: 'Times we are free for a visit.', parameters: { type: 'object', properties: { fromDate: { ...text, description: 'First day to look at, YYYY-MM-DD. Optional.' } } } },
  { name: 'book_time', description: 'Book a visit at one of the free times.', parameters: { type: 'object', properties: { slot: { ...text, description: 'The free time\'s id.' } }, required: ['slot'] } },
  { name: 'send_estimate', description: 'Email the caller the estimate just given.', parameters: { type: 'object', properties: {} } },
  { name: 'update_contact', description: 'Correct a detail the caller says is wrong.', parameters: { type: 'object', properties: { field: { type: 'string', enum: ['name', 'email', 'phone'] }, value: { ...text, description: 'The corrected value.' } }, required: ['field', 'value'] } },
  { name: 'request_person', description: 'Pass the caller to a person, or alert the team to an urgent problem.', parameters: { type: 'object', properties: { reason: { ...text, description: 'What the caller needs.' }, urgent: { type: 'boolean' } }, required: ['reason'] } },
  { name: 'end_call', description: 'End the call, after your goodbye.', parameters: { type: 'object', properties: { reason: { type: 'string', enum: [...END_REASONS], description: 'Why.' } }, required: ['reason'] } },
]

const upper = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(upper)
  if (typeof schema !== 'object' || schema === null) return schema
  return Object.fromEntries(Object.entries(schema as Record<string, unknown>).map(([key, value]) => [key, key === 'type' && typeof value === 'string' ? value.toUpperCase() : key === 'enum' ? value : upper(value)]))
}

/** The tools as the Gemini Live API is told of them. `BLOCKING`: she waits for the answer before she speaks again. */
export function toolDeclarations() {
  return TOOLS.map((tool) => ({ name: tool.name, behavior: 'BLOCKING', description: tool.description, parameters: upper(tool.parameters) as Record<string, unknown> }))
}

/** The same tools as function tools (JSON Schema), for an engine that takes them that way */
export function functionTools() {
  return TOOLS.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters }))
}

export type ToolErrorCode = 'UNKNOWN_TOOL' | 'INVALID_ARGUMENT' | 'UNKNOWN_SERVICE' | 'MISSING_ANSWERS' | 'NO_PRICE' | 'ESTIMATE_UNAVAILABLE' | 'UNKNOWN_SLOT' | 'MISSING_CONTACT' | 'NOTHING_TO_SEND'

export interface EngineFiguresOut {
  currency: string
  total: number
  subtotal: number
  taxAmount: number
  lines: number[]
}

export type ToolOutcome =
  | {
      ok: true
      /** What she is given back */
      result: Record<string, unknown>
      /** What the test page shows for a tool that only pretends: "would book …", "would email …" */
      wouldDo?: string
      /** For get_estimate: the engine's figures, for the page's price check */
      engine?: EngineFiguresOut
      /** For get_typical_price: the engine's typical total, valid for her to say */
      typical?: { service: string; currency: string; total: number; lines: number[] }
      /** The caller's details after update_contact */
      contact?: CallContact
      /** end_call: why */
      end?: EndReason
      /** What changed in the call session (the route signs the new one) */
      change?: { contact?: CallContact; notes?: CallNotes }
    }
  | { ok: false; code: ToolErrorCode; message: string }

export interface ToolDeps {
  /** The pricing worker's `/preview` (lib/pricing-preview `previewPriceNow`) */
  price: (input: unknown) => Promise<WorkerPreview>
  now?: () => Date
}

/** Whose call it is: the business and the session, both from the server */
export interface ToolCall {
  business: VoiceBusiness
  session: Pick<CallSession, 'contact' | 'notes'>
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
const keep = <T,>(list: readonly T[], item: T, most: number): T[] => [...list, item].slice(-most)

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
    return n === null || n < 0 || n > 1_000_000 ? `"${field.label}" needs a number. If the caller was vague, ask them for a number.` : { fieldId: field.fieldId, value: n }
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
  const said = shortText(typeof value === 'number' || typeof value === 'boolean' ? String(value) : value, 300)
  return said === null ? `"${field.label}" needs a short answer.` : { fieldId: field.fieldId, value: said }
}

/** The caller's answers, checked against this service's own questions and measurements */
export function readAnswers(service: VoiceService, given: unknown): { answers: Answer[] } | { error: ToolOutcome } {
  if (!Array.isArray(given) || given.length > 60) return { error: refuse('INVALID_ARGUMENT', 'answers must be a list of { questionId, value }.') }
  const answers = new Map<string, Answer>()
  for (const item of given) {
    const entry = only(item, ['questionId', 'value'])
    const id = entry ? shortText(entry.questionId, 120) : null
    if (!entry || !id) return { error: refuse('INVALID_ARGUMENT', 'Each answer needs a questionId and a value.') }
    const field = service.fields.find((f) => f.fieldId === id)
    const measurement = service.measurements.find((m) => m.id === id)
    if (!field && !measurement) return { error: refuse('INVALID_ARGUMENT', `"${id}" is not one of this service's questions. Use the ids in your instructions.`) }
    const read = field ? readAnswer(field, entry.value) : readAnswer({ fieldId: id, type: 'number', label: measurement!.what }, entry.value)
    if (typeof read === 'string') return { error: refuse('INVALID_ARGUMENT', read) }
    answers.set(id, read)
  }
  const missing = service.fields.filter((f) => f.required && !answers.has(f.fieldId))
  if (missing.length > 0) return { error: refuse('MISSING_ANSWERS', `Ask the caller first: ${missing.map((f) => f.label).join('; ')}.`) }
  return { answers: [...answers.values()] }
}

/** A price as she is given it: the figure, and the words to say */
const priceOut = (amount: number, currency: string, locale: string) => ({ amount, say: moneyWords(amount, currency) ?? formatMoney(amount, currency, locale) })

const serviceOf = (b: VoiceBusiness, id: unknown): VoiceService | undefined => {
  const serviceId = shortText(id, 120)
  // Only a service of the call's own business: the id is looked up in that business's list and nowhere else
  return serviceId ? b.services.find((s) => s.id === serviceId) : undefined
}

async function getEstimate({ business: b, session }: ToolCall, args: unknown, deps: ToolDeps): Promise<ToolOutcome> {
  const given = only(args, ['serviceId', 'answers'])
  if (!given) return refuse('INVALID_ARGUMENT', 'get_estimate takes serviceId and answers only.')
  const service = serviceOf(b, given.serviceId)
  if (!service) return refuse('UNKNOWN_SERVICE', "That is not one of our services. Use an id from your instructions.")
  if (!service.rules) return refuse('NO_PRICE', 'This service has no prices set. Do not give a price: say the team will confirm it.')
  const read = readAnswers(service, given.answers)
  if ('error' in read) return read.error

  const priced = await deps.price({ tenantId: b.id, service: service.row, rules: service.rules, fields: service.fields, answers: read.answers })
  if (!priced.success) return refuse('ESTIMATE_UNAVAILABLE', 'The estimate is not available right now. Do not give a price: say the team will confirm it.')
  const total = priceOut(priced.total, priced.currency, b.locale)
  return {
    ok: true,
    engine: { currency: priced.currency, total: priced.total, subtotal: priced.subtotal, taxAmount: priced.taxAmount, lines: priced.lines.map((l) => l.amount) },
    change: { notes: { ...session.notes, estimates: keep(session.notes.estimates, { service: service.name, total: priced.total, say: total.say }, 6) } },
    result: {
      service: service.name,
      total: priced.total,
      sayTotal: total.say,
      ...(priced.taxAmount > 0 && { beforeTax: priceOut(priced.subtotal, priced.currency, b.locale), tax: { label: priced.taxLabel ?? 'Tax', ...priceOut(priced.taxAmount, priced.currency, b.locale) } }),
      lines: priced.lines.map((l) => ({ label: l.label, ...priceOut(l.amount, priced.currency, b.locale) })),
      ...(priced.unmeasured.length > 0 && { notInThisEstimate: priced.unmeasured.map((u) => u.name), notInThisEstimateWhy: 'These are priced from a size we measure. They are not in the total.' }),
      status: 'An estimate. We will confirm it.',
    },
  }
}

async function getTypicalPrice({ business: b, session }: ToolCall, args: unknown, deps: ToolDeps): Promise<ToolOutcome> {
  const given = only(args, ['serviceId'])
  if (!given) return refuse('INVALID_ARGUMENT', 'get_typical_price takes serviceId only.')
  const service = serviceOf(b, given.serviceId)
  if (!service) return refuse('UNKNOWN_SERVICE', 'That is not one of our services. Use an id from your instructions.')
  // The same path as an estimate: the worker's /preview, with the smallest valid answers
  const found = await typicalPrice(service, (answers) => deps.price({ tenantId: b.id, service: service.row, rules: service.rules, fields: service.fields, answers }))
  if (!found.ok) {
    if (found.why === 'needs_photos') return { ok: true, result: { service: service.name, noTypicalPrice: true, tellTheCaller: 'We price that one from photos, so we need photos before we can say what it costs.' } }
    return found.why === 'no_price'
      ? refuse('NO_PRICE', 'There is no typical price for this service. Do not give one: ask the questions for an estimate, or say the team will confirm.')
      : refuse('ESTIMATE_UNAVAILABLE', 'The typical price is not available right now. Do not give a price: ask the questions for an estimate.')
  }
  const total = priceOut(found.priced.total, found.priced.currency, b.locale)
  return {
    ok: true,
    typical: { service: service.name, currency: found.priced.currency, total: found.priced.total, lines: found.priced.lines.map((l) => l.amount) },
    change: { notes: { ...session.notes, typical: keep(session.notes.typical.filter((t) => t.service !== service.name), { service: service.name, total: found.priced.total, say: total.say }, 6) } },
    result: { service: service.name, typicalTotal: found.priced.total, sayTotal: total.say, forAJobOf: found.basis, dependsOn: found.dependsOn, note: 'Not an estimate for their job.' },
  }
}

/** How many of the free times she is given at once */
export const FREE_TIMES_GIVEN = 8

function getFreeTimes({ business: b }: ToolCall, args: unknown, now: Date): ToolOutcome {
  const given = only(args, ['fromDate'])
  if (!given) return refuse('INVALID_ARGUMENT', 'get_free_times takes fromDate only.')
  if (given.fromDate !== undefined && given.fromDate !== null && given.fromDate !== '' && !parseCivilDate(given.fromDate)) return refuse('INVALID_ARGUMENT', 'fromDate must be a date as YYYY-MM-DD.')
  const free = testSlots({ fromDate: typeof given.fromDate === 'string' ? given.fromDate : null, timeZone: b.timeZone, locale: b.locale, now })
  // TEST DATA: made-up slots (slots.ts). The model is given the times; the page is told they are not real.
  // She offers two or three, so she is given the first few: a long list is read again on every later turn
  return { ok: true, result: { timeZone: free.timeZone, freeTimes: free.slots.slice(0, FREE_TIMES_GIVEN).map((s) => ({ id: s.id, when: s.label })), later: 'For later days, call again with fromDate.' }, wouldDo: `TEST DATA: ${free.slots.length} made-up free times from ${free.slots[0]?.date}` }
}

function bookTime({ business: b, session }: ToolCall, args: unknown, now: Date): ToolOutcome {
  const given = only(args, ['slot'])
  if (!given) return refuse('INVALID_ARGUMENT', "book_time takes slot only. The caller's details are on file: do not ask for them.")
  const slot = isTestSlot(given.slot, { timeZone: b.timeZone, now })
  if (!slot) return refuse('UNKNOWN_SLOT', 'That is not one of the free times. Use an id from get_free_times.')
  // The details are the form's (or a correction made in this call): never an argument
  const { name, phone, email } = session.contact
  if (!name || (!phone && !email)) return refuse('MISSING_CONTACT', 'There are no contact details on file for this caller. Say the team will be in touch to arrange it.')
  // Nothing is booked: this is the test. The page shows what would have been.
  return {
    ok: true,
    change: { notes: { ...session.notes, visit: slot.label } },
    result: { status: 'noted', when: slot.label, tellTheCaller: `The visit is noted for ${slot.label}. We will confirm it.` },
    wouldDo: `would book: ${slot.label} (${b.timeZone}) for ${name}, ${[phone, email].filter(Boolean).join(', ')}`,
  }
}

function sendEstimate({ session }: ToolCall, args: unknown): ToolOutcome {
  if (!only(args, [])) return refuse('INVALID_ARGUMENT', 'send_estimate takes no arguments. The email address is on file.')
  if (session.notes.estimates.length === 0) return refuse('NOTHING_TO_SEND', 'No estimate has been given in this call yet. Give one first.')
  const sent = session.notes.estimates.map((e) => `${e.service} ${e.total.toFixed(2)}`).join('; ')
  // Nothing is sent: this is the test. The page shows what would have been.
  if (!session.contact.email) return { ok: true, change: { notes: { ...session.notes, estimateSent: true } }, result: { status: 'passed to the team', tellTheCaller: "We'll send that over to you." }, wouldDo: `would pass the estimate to the team to send (no email address on file): ${sent}` }
  return { ok: true, change: { notes: { ...session.notes, estimateSent: true } }, result: { status: 'sent', tellTheCaller: "I've emailed that to you." }, wouldDo: `would email the estimate to ${session.contact.email}: ${sent}` }
}

function updateContact({ business: b, session }: ToolCall, args: unknown): ToolOutcome {
  const given = only(args, ['field', 'value'])
  const field = given?.field
  if (!given || (field !== 'name' && field !== 'email' && field !== 'phone')) return refuse('INVALID_ARGUMENT', 'update_contact takes field (name, email or phone) and value.')
  const value = shortText(given.value, 254)
  if (!value) return refuse('INVALID_ARGUMENT', 'update_contact needs the corrected value.')
  // The request form's own rules decide whether the new value will do
  const checked = checkContact({ ...session.contact, [field]: field === 'email' ? value.replace(/\s+/g, '') : value }, b.contactRequirement)
  if (checked.errors[field]) return refuse('INVALID_ARGUMENT', `That ${field} does not look right. Ask the caller to say it again.`)
  const contact: CallContact = { name: checked.clean.name, email: checked.clean.email, phone: checked.clean.phone }
  return {
    ok: true,
    contact,
    change: { contact, notes: { ...session.notes, contactChanged: [...new Set<'name' | 'email' | 'phone'>([...session.notes.contactChanged, field])] } },
    result: { status: 'updated', tellTheCaller: "Thanks, I've updated that.", doNot: 'Do not say the new value back.' },
    wouldDo: `contact corrected: ${field} is now ${contact[field] ?? ''}`,
  }
}

function requestPerson(args: unknown): ToolOutcome {
  const given = only(args, ['reason', 'urgent'])
  if (!given) return refuse('INVALID_ARGUMENT', 'request_person takes reason and urgent only.')
  const reason = shortText(given.reason, 500)
  if (!reason) return refuse('INVALID_ARGUMENT', 'request_person needs the reason, in a sentence.')
  if (given.urgent !== undefined && typeof given.urgent !== 'boolean') return refuse('INVALID_ARGUMENT', 'urgent must be true or false.')
  const urgent = given.urgent === true
  // Nobody is told: this is the test. The page shows what would have been.
  return { ok: true, result: { status: 'passed on', tellTheCaller: urgent ? 'The team has been alerted and will call back as soon as they can.' : 'Someone from the team will get back to them.' }, wouldDo: `would pass to a person${urgent ? ' (URGENT)' : ''}: ${reason}` }
}

function endCall(args: unknown): ToolOutcome {
  const given = only(args, ['reason'])
  const reason = given?.reason
  if (!given || typeof reason !== 'string' || !(END_REASONS as readonly string[]).includes(reason)) return refuse('INVALID_ARGUMENT', `end_call needs a reason: ${END_REASONS.join(', ')}.`)
  // Nothing she could read out: whatever she says after this is not played (call-client.ts)
  return { ok: true, end: reason as EndReason, result: { ended: true } }
}

/** What she has been told by her tools so far, given back with every answer so that it outlives the call's memory being trimmed */
export function notesForHer(notes: CallNotes): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (notes.estimates.length > 0) out.estimatesGiven = notes.estimates.map((e) => ({ service: e.service, sayTotal: e.say }))
  if (notes.typical.length > 0) out.typicalPricesGiven = notes.typical.map((t) => ({ service: t.service, sayTotal: t.say }))
  if (notes.visit) out.visitNoted = notes.visit
  if (notes.estimateSent) out.estimateEmailed = true
  if (notes.contactChanged.length > 0) out.detailsCorrected = notes.contactChanged
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Run one of her tools for the call. `call` is the business the session names and the session's
 * own state, both loaded by the route: no argument can change either.
 */
export async function runTool(call: ToolCall, name: unknown, args: unknown, deps: ToolDeps): Promise<ToolOutcome> {
  const now = deps.now?.() ?? new Date()
  switch (name) {
    case 'get_typical_price':
      return getTypicalPrice(call, args, deps)
    case 'get_estimate':
      return getEstimate(call, args, deps)
    case 'get_free_times':
      return getFreeTimes(call, args, now)
    case 'book_time':
      return bookTime(call, args, now)
    case 'send_estimate':
      return sendEstimate(call, args)
    case 'update_contact':
      return updateContact(call, args)
    case 'request_person':
      return requestPerson(args)
    case 'end_call':
      return endCall(args)
    default:
      return refuse('UNKNOWN_TOOL', 'There is no such tool.')
  }
}

/** What goes back to her for an outcome: the result with the call's notes so far, or the error as a line she can act on */
export function toolResponse(outcome: ToolOutcome, notes: CallNotes): Record<string, unknown> {
  if (!outcome.ok) return { error: outcome.message }
  const soFar = notesForHer(notes)
  return soFar ? { ...outcome.result, callSoFar: soFar } : outcome.result
}
