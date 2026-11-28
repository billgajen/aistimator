/**
 * T-211: a service's typical price, said before the caller has given any details.
 *
 * "It depends on …, but we normally charge about X for Y." X comes from the SAME pricing path
 * as an estimate (the worker's `/preview`), run with the smallest valid answers: each required
 * number question at its minimum, and each required choice at the option the engine prices
 * lowest (the one that adds nothing). Nothing is worked out here: every candidate is priced by
 * the engine and the engine's own total is compared.
 *
 * No typical price for a service priced mainly from photos (the engine says a line has no size
 * to price): she says she needs photos for that.
 *
 * Pure but for the `price` it is handed. Nothing about any trade.
 */
import type { ExpectedSignalConfig, WidgetField } from '@qolumns/shared'
import type { WorkerPreview } from '@/lib/pricing-preview'
import type { VoiceService } from './business'

type Answer = { fieldId: string; value: string | number | boolean | string[] }

/** The most engine calls one typical price may take */
export const TYPICAL_PRICE_CALLS = 40

/** The smallest valid value of a required number question: its measurement's own lower bound when it has one, else 1 */
export function minimumOf(field: Pick<WidgetField, 'fieldId' | 'mapsToSignal'>, signals: readonly ExpectedSignalConfig[]): number {
  const signal = signals.find((s) => s.signalKey === (field.mapsToSignal ?? field.fieldId))
  const least = signal?.envelope?.absoluteMin
  return typeof least === 'number' && Number.isFinite(least) && least > 0 ? least : 1
}

export interface TypicalPlan {
  /** Answers that have one smallest value */
  fixed: Answer[]
  /** Required choices: the engine decides which option is the one that adds nothing */
  choices: Array<{ field: WidgetField; options: Answer[] }>
}

/** What the smallest valid job answers: required questions only, each at its least */
export function typicalPlan(service: Pick<VoiceService, 'fields' | 'row'>): TypicalPlan {
  const signals = (service.row.expected_signals as ExpectedSignalConfig[] | null) ?? []
  const plan: TypicalPlan = { fixed: [], choices: [] }
  for (const field of service.fields) {
    if (!field.required) continue
    const options = field.options ?? []
    if (field.type === 'number') plan.fixed.push({ fieldId: field.fieldId, value: minimumOf(field, signals) })
    else if (field.type === 'boolean') plan.choices.push({ field, options: [{ fieldId: field.fieldId, value: false }, { fieldId: field.fieldId, value: true }] })
    else if (field.type === 'select' && options.length > 0) plan.choices.push({ field, options: options.map((o) => ({ fieldId: field.fieldId, value: String(o.value) })) })
    else if (field.type === 'multiselect' && options.length > 0) plan.choices.push({ field, options: options.map((o) => ({ fieldId: field.fieldId, value: [String(o.value)] })) })
    // a required text question does not move a price: it is left for the real estimate
  }
  return plan
}

const labelOf = (field: Pick<WidgetField, 'label' | 'options' | 'type'>, value: Answer['value']): string => {
  const one = (v: unknown) => field.options?.find((o) => String(o.value) === String(v))?.label ?? String(v)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return Array.isArray(value) ? value.map(one).join(', ') : one(value)
}

/** The answers a typical price was worked out from, as she can say them: "Wall area (square feet): 1; Finish: Standard" */
export function basisOf(fields: readonly WidgetField[], answers: readonly Answer[]): string {
  const parts = answers.flatMap((a) => {
    const field = fields.find((f) => f.fieldId === a.fieldId)
    return field ? [`${field.label.replace(/[?:]\s*$/, '')}: ${labelOf(field, a.value)}`] : []
  })
  return parts.length > 0 ? parts.join('; ') : 'the simplest job'
}

export type TypicalPrice =
  | { ok: true; priced: Extract<WorkerPreview, { success: true }>; answers: Answer[]; basis: string; dependsOn: string[] }
  | { ok: false; why: 'needs_photos' | 'no_price' | 'unavailable' }

/**
 * The typical price of one service. `price` is the pricing worker's `/preview`; `input` builds
 * what it is sent from a set of answers.
 */
export async function typicalPrice(service: VoiceService, price: (answers: Answer[]) => Promise<WorkerPreview>): Promise<TypicalPrice> {
  if (!service.rules) return { ok: false, why: 'no_price' }
  const plan = typicalPlan(service)
  const chosen = new Map<string, Answer>(plan.choices.map((c) => [c.field.fieldId, c.options[0]!]))
  const answersNow = () => [...plan.fixed, ...chosen.values()]
  let calls = 0

  // One choice at a time: every option is priced by the engine with the others as they stand, and the lowest total is kept
  for (const choice of plan.choices) {
    if (calls + choice.options.length > TYPICAL_PRICE_CALLS - 1) break
    calls += choice.options.length
    const totals = await Promise.all(
      choice.options.map(async (option) => {
        const result = await price([...plan.fixed, ...[...chosen.values()].map((a) => (a.fieldId === option.fieldId ? option : a))])
        return result.success ? result.total : null
      })
    )
    if (totals.some((t) => t === null)) return { ok: false, why: 'unavailable' }
    let best = 0
    totals.forEach((t, i) => {
      if ((t as number) < (totals[best] as number)) best = i
    })
    chosen.set(choice.field.fieldId, choice.options[best]!)
  }

  const answers = answersNow()
  const priced = await price(answers)
  if (!priced.success) return { ok: false, why: 'unavailable' }
  // A line the engine could not size is priced from the customer's photos: there is no honest "typical" for it
  if (priced.unmeasured.length > 0) return { ok: false, why: 'needs_photos' }
  if (!(priced.total > 0)) return { ok: false, why: 'no_price' }
  return { ok: true, priced, answers, basis: basisOf(service.fields, answers), dependsOn: service.fields.filter((f) => f.required).map((f) => f.label.replace(/[?:]\s*$/, '')) }
}
