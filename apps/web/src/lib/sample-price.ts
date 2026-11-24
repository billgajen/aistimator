/**
 * T-189: the sample price on a service's "Test & Publish" step (pure).
 *
 * The maths was written inside the services page and is moved here unchanged,
 * with one fault put right. A line whose quantity is measured from the
 * customer's photos has no quantity when there are no photos, and the sample
 * used 1: "1 sq ft × $18.00 = $18.00", which read as a broken price.
 *
 * Now such a line is priced one of three ways, in this order:
 *   1. at the size the business typed to try;
 *   2. at a sample size from the service's OWN plausible range for that
 *      measurement (its expected signal's envelope: the middle of the range
 *      per driver, times the driver, kept inside the range's outer bounds);
 *   3. not at all: the line shows its rate, says it is priced from the
 *      customer's photos, and the total says so instead of showing a sum.
 *
 * Nothing here knows a trade or a unit: every number is the service's own.
 * This is a preview on the settings page. A real quote is priced by the
 * worker's rules engine, which this does not touch.
 */
import { minimumTopUp } from '@qolumns/shared'
import type { ExpectedSignalConfig, MultiplierConfig, SuggestedField, WorkStepConfig } from '@qolumns/shared'

export type SampleValues = Record<string, string | number | boolean>

export interface SampleService {
  baseFee: number
  minimumCharge: number
  workSteps: WorkStepConfig[]
  multipliers: MultiplierConfig[]
  suggestedFields: SuggestedField[]
  expectedSignals: ExpectedSignalConfig[]
}

export type SampleSource = 'form_field' | 'constant' | 'photos' | 'missing' | 'multiplier'

export interface SampleLine {
  name: string
  /** Null when the line is priced from the customer's photos and there is no size to show */
  amount: number | null
  calculation: string
  quantitySource?: SampleSource
  /** The quantity is a sample size, not a real job's */
  sample?: boolean
}

export interface SampleResult {
  lineItems: SampleLine[]
  /** The lines that could be priced, added up (the minimum applied when every line could be) */
  subtotal: number
  warnings: string[]
  /** The minimum charge, when the lines came to less and it applied (a note, not a line) */
  minimumCharge: number | null
  /** Lines priced from the photos that have no size here, by name: the total is not a whole price */
  unmeasured: string[]
  /** Lines priced at a sample size, in words: "Exterior walls: 1,100 sq ft" */
  sampled: string[]
}

/** A measured line's own box in the sample values (never a question's id: a field id has no colon) */
export const sampleKey = (signalKey: string): string => `sample:${signalKey}`

const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * A sample size for a quantity the photos measure, from the service's own
 * plausible range. Null when the service gives no range per driver: the outer
 * bounds alone are the edges of what is possible, not a size anyone has.
 */
export function sampleSize(signal: ExpectedSignalConfig | undefined, values: SampleValues): number | null {
  const range = signal?.envelope
  if (!range || typeof range.minPerUnit !== 'number' || typeof range.maxPerUnit !== 'number') return null
  if (!(range.maxPerUnit > 0) || range.maxPerUnit < range.minPerUnit) return null
  const typed = range.driverKey ? numberOf(values[range.driverKey]) : null
  const driver = typed !== null && typed > 0 ? typed : range.defaultDriver && range.defaultDriver > 0 ? range.defaultDriver : 1
  const middle = ((range.minPerUnit + range.maxPerUnit) / 2) * driver
  const inside = Math.min(Math.max(middle, range.absoluteMin), range.absoluteMax)
  if (!Number.isFinite(inside) || inside <= 0) return null
  return inside >= 10 ? Math.round(inside) : Math.round(inside * 10) / 10
}

/** The measured lines of a service, with the box each one has and the size it would be sampled at */
export function measuredLines(service: Pick<SampleService, 'workSteps' | 'expectedSignals'>, values: SampleValues): Array<{ key: string; name: string; unit: string; suggested: number | null }> {
  const seen = new Set<string>()
  const lines: Array<{ key: string; name: string; unit: string; suggested: number | null }> = []
  for (const step of service.workSteps) {
    if (step.costType !== 'per_unit' && step.costType !== 'per_hour') continue
    if (step.quantitySource?.type !== 'ai_signal' || !step.quantitySource.signalKey) continue
    const signalKey = step.quantitySource.signalKey
    if (seen.has(signalKey)) continue
    seen.add(signalKey)
    const signal = service.expectedSignals.find((s) => s.signalKey === signalKey)
    lines.push({ key: sampleKey(signalKey), name: step.name || 'Unnamed', unit: unitOf(step), suggested: sampleSize(signal, values) })
  }
  return lines
}

const unitOf = (step: WorkStepConfig): string => step.unitLabel || (step.costType === 'per_hour' ? 'hours' : 'units')
const count = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

/**
 * Whether an optional step's condition is met by the sample values (as the page has always decided it).
 * T-201: a condition names its question by the question's fact key, and the sample values are kept under
 * the question's answer key. The two differ for most questions, so the sample is read under either.
 */
function triggered(step: WorkStepConfig, values: SampleValues, fields: readonly SuggestedField[] = []): boolean {
  if (!step.optional || !step.triggerSignal) return true
  const asked = fields.find((f) => f.mapsToSignal === step.triggerSignal)
  const value = values[step.triggerSignal] ?? (asked ? values[asked.fieldId] : undefined)
  if (!step.triggerCondition) return Boolean(value)
  const { operator, value: wanted } = step.triggerCondition
  switch (operator) {
    case 'exists':
      return value !== undefined && value !== ''
    case 'not_exists':
      return value === undefined || value === ''
    case 'equals':
      return String(value) === String(wanted)
    case 'gt':
      return Number(value) > Number(wanted)
    case 'gte':
      return Number(value) >= Number(wanted)
    case 'lt':
      return Number(value) < Number(wanted)
    case 'lte':
      return Number(value) <= Number(wanted)
    default:
      return false
  }
}

export function samplePrice(service: SampleService, values: SampleValues, symbol: string): SampleResult {
  const money = (n: number) => `${symbol}${n.toFixed(2)}`
  const lineItems: SampleLine[] = []
  const warnings: string[] = []
  const unmeasured: string[] = []
  const sampled: string[] = []
  let subtotal = 0

  if (service.baseFee > 0) {
    lineItems.push({ name: 'Base Fee', amount: service.baseFee, calculation: `Fixed: ${money(service.baseFee)}`, quantitySource: 'constant' })
    subtotal += service.baseFee
  }

  for (const step of service.workSteps) {
    if (!triggered(step, values, service.suggestedFields)) continue
    const name = step.name || 'Unnamed'

    if (step.costType !== 'per_unit' && step.costType !== 'per_hour') {
      lineItems.push({ name, amount: step.defaultCost, calculation: `Fixed: ${money(step.defaultCost)}` })
      subtotal += step.defaultCost
      continue
    }

    const unit = unitOf(step)
    let quantity: number | null = 1
    let quantitySource: SampleSource | undefined
    let sample = false

    if (!step.quantitySource) {
      warnings.push(`"${step.name}" has no quantity source configured - using quantity 1`)
      quantitySource = 'missing'
    } else if (step.quantitySource.type === 'form_field') {
      const typed = numberOf(values[step.quantitySource.fieldId || ''])
      if (typed !== null) quantity = typed
      quantitySource = 'form_field'
    } else if (step.quantitySource.type === 'constant') {
      quantity = step.quantitySource.value || 1
      quantitySource = 'constant'
    } else if (step.quantitySource.type === 'ai_signal') {
      quantitySource = 'photos'
      const signalKey = step.quantitySource.signalKey || ''
      const typed = numberOf(values[sampleKey(signalKey)])
      if (typed !== null && typed > 0) {
        quantity = typed
      } else {
        quantity = sampleSize(service.expectedSignals.find((s) => s.signalKey === signalKey), values)
      }
      sample = quantity !== null
    }

    if (quantity === null) {
      // No photos and no size to try: the rate is the truth, a sum would not be
      lineItems.push({ name, amount: null, calculation: `${money(step.defaultCost)} per ${singular(unit)}`, quantitySource })
      unmeasured.push(name)
      continue
    }

    const amount = quantity * step.defaultCost
    if (sample) sampled.push(`${name}: ${count(quantity)} ${unit}`)
    lineItems.push({
      name,
      amount,
      calculation: `${count(quantity)} ${unit} × ${money(step.defaultCost)} = ${money(amount)}`,
      quantitySource,
      ...(sample && { sample: true }),
    })
    subtotal += amount
  }

  let adjustment = 0
  for (const mult of service.multipliers) {
    if (!mult.when.fieldId || !mult.when.equals) continue
    if (String(values[mult.when.fieldId]) !== String(mult.when.equals)) continue
    const change = subtotal * (mult.multiplier - 1)
    adjustment += change
    const pct = Math.round((mult.multiplier - 1) * 100)
    const field = service.suggestedFields.find((f) => f.fieldId === mult.when.fieldId)
    lineItems.push({
      name: `${field?.label || mult.when.fieldId} = ${mult.when.equals}`,
      amount: change,
      calculation: pct >= 0 ? `+${pct}% adjustment` : `${pct}% adjustment`,
      quantitySource: 'multiplier',
    })
  }
  subtotal += adjustment

  // T-165: the minimum charge is a floor, not an item. It is only applied when every line could
  // be priced: with a measured line left out, the sum is not the job's price, so there is no
  // "came to less" to act on.
  const minimumApplies = unmeasured.length === 0 && minimumTopUp(subtotal, service.minimumCharge) > 0
  if (minimumApplies) subtotal = service.minimumCharge

  return { lineItems, subtotal, warnings, minimumCharge: minimumApplies ? service.minimumCharge : null, unmeasured, sampled }
}

/** "sq ft" stays "sq ft"; "rooms" → "room"; "hours" → "hour" */
function singular(unit: string): string {
  return /[^s]s$/i.test(unit) && !/\s/.test(unit.trim()) ? unit.slice(0, -1) : unit
}

/** The plain sentence under a sample total, or null when every quantity came from the sample values */
export function sampleNote(result: Pick<SampleResult, 'unmeasured' | 'sampled'>): string | null {
  const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
  if (result.unmeasured.length > 0) {
    const many = result.unmeasured.length > 1
    return `The real price comes from the customer's photos: ${list(result.unmeasured)} ${many ? 'are' : 'is'} measured from them. Type a size above to see a sample price.`
  }
  if (result.sampled.length > 0) {
    return `A sample, not a real job (${result.sampled.join('; ')}). On a real request the size is measured from the customer's photos.`
  }
  return null
}
