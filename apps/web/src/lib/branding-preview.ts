/**
 * T-204: the Branding page's preview shows the business's own look.
 *
 * It used to print a fixed sample: a kitchen job, in dollars, with "VAT (20%)"
 * and a "Prepared with" badge, whatever the business sold, wherever it was and
 * whatever its plan. Now every part of the sketch is the business's own: its
 * currency, its tax name and rate (or no tax line when it charges none), a
 * sample built from one of its own services, and the badge only when its
 * estimates carry one today.
 *
 * Pure. The sample is a sketch of a document, not a price: it uses the
 * service's own lines and rates and says so beside the preview.
 */
import { quantityLineLabel, roundMoney } from '@qolumns/shared'
import type { ExpectedSignalConfig, WorkStepConfig } from '@qolumns/shared'
import { sampleSize } from '@/lib/sample-price'

export interface PreviewServiceRow {
  name: string
  description?: string | null
  scope_includes?: unknown
  scope_excludes?: unknown
  default_assumptions?: unknown
  work_steps?: unknown
  expected_signals?: unknown
  tax_exempt?: boolean | null
  /** The service's pricing rules (`service_pricing_rules.rules_json`) */
  rules?: { baseFee?: number; workSteps?: unknown } | null
}

export interface PreviewLine {
  label: string
  amount: number
}

export interface BrandingSample {
  serviceName: string
  scopeSummary: string
  assumptions: string[]
  exclusions: string[]
  lines: PreviewLine[]
  /** Built from one of the business's own services (false: it has none with a price yet) */
  own: boolean
  /** That service is not taxed, so the sketch shows no tax for it */
  taxExempt: boolean
}

export interface PreviewTax {
  enabled: boolean
  label: string
  /** As a percentage: 8.25 for 8.25% */
  ratePercent: number
}

/** How many of a service's lines the sketch shows */
export const PREVIEW_MAX_LINES = 4

/** A sketch for a business with no priced service yet: no trade, no country, no tax of its own */
export const NEUTRAL_SAMPLE: BrandingSample = {
  serviceName: 'Your service',
  scopeSummary: 'A short summary of the job goes here, written from the customer’s request and your service’s own scope.',
  assumptions: ['What your service takes as given goes here'],
  exclusions: ['What your service leaves out goes here'],
  lines: [
    { label: 'First price line', amount: 400 },
    { label: 'Second price line', amount: 250 },
    { label: 'An add-on', amount: 100 },
  ],
  own: false,
  taxExempt: false,
}

const textList = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, max) : []

const stepsOf = (service: PreviewServiceRow): WorkStepConfig[] => {
  const fromRules = service.rules?.workSteps
  const steps = Array.isArray(fromRules) && fromRules.length > 0 ? fromRules : service.work_steps
  return Array.isArray(steps) ? (steps as WorkStepConfig[]) : []
}

/** One of the service's own price lines, as a line of the sketch; null when it has no amount of its own */
function previewLine(step: WorkStepConfig, signals: ExpectedSignalConfig[], money: (amount: number) => string): PreviewLine | null {
  const rate = Number(step.defaultCost)
  if (!step.name || !(rate > 0)) return null
  if (step.costType === 'percent' || step.costType === 'credit') return null
  if (step.costType !== 'per_unit' && step.costType !== 'per_hour') return { label: step.name, amount: roundMoney(rate) }
  const source = step.quantitySource
  // the size a real request would be measured at is not known here: the service's own sample size, or one unit
  const sampled = source?.type === 'ai_signal' ? sampleSize(signals.find((s) => s.signalKey === source.signalKey), {}) : null
  const quantity = sampled ?? (source?.type === 'constant' && typeof source.value === 'number' && source.value > 0 ? source.value : 1)
  const unit = step.unitLabel || (step.costType === 'per_hour' ? 'hours' : null)
  return { label: quantity === 1 ? step.name : quantityLineLabel(step.name, money(rate), quantity, unit), amount: roundMoney(rate * quantity) }
}

/**
 * The sketch's sample, from the first of the business's services that has a
 * price line of its own (its switched-on services first). Lines that are
 * always charged come before lines that depend on an answer.
 */
export function brandingSample(services: readonly PreviewServiceRow[], money: (amount: number) => string): BrandingSample {
  for (const service of services) {
    const signals = Array.isArray(service.expected_signals) ? (service.expected_signals as ExpectedSignalConfig[]) : []
    const steps = stepsOf(service)
    const always = steps.filter((step) => !step.optional && !step.when)
    const ordered = [...always, ...steps.filter((step) => !always.includes(step))]
    const lines: PreviewLine[] = []
    const baseFee = Number(service.rules?.baseFee)
    if (baseFee > 0) lines.push({ label: 'Base fee', amount: roundMoney(baseFee) })
    for (const step of ordered) {
      if (lines.length >= PREVIEW_MAX_LINES) break
      const line = previewLine(step, signals, money)
      if (line) lines.push(line)
    }
    if (lines.length === 0) continue
    const included = textList(service.scope_includes, 3)
    return {
      serviceName: service.name,
      scopeSummary: service.description?.trim() || (included.length > 0 ? `${service.name}: ${included.join(', ')}.` : service.name),
      assumptions: textList(service.default_assumptions, 3),
      exclusions: textList(service.scope_excludes, 3),
      lines,
      own: true,
      taxExempt: service.tax_exempt === true,
    }
  }
  return NEUTRAL_SAMPLE
}

export interface PreviewTotals {
  subtotal: number
  /** Null when the business charges no tax (or this service is not taxed): no tax line is drawn */
  tax: { label: string; ratePercent: number; amount: number } | null
  total: number
}

/** The sketch's figures: the lines added up, the business's own tax on them, and the total */
export function previewTotals(sample: Pick<BrandingSample, 'lines' | 'taxExempt'>, tax: PreviewTax): PreviewTotals {
  const subtotal = roundMoney(sample.lines.reduce((sum, line) => sum + line.amount, 0))
  if (!tax.enabled || !(tax.ratePercent > 0) || sample.taxExempt) return { subtotal, tax: null, total: subtotal }
  const amount = roundMoney((subtotal * tax.ratePercent) / 100)
  return { subtotal, tax: { label: tax.label, ratePercent: tax.ratePercent, amount }, total: roundMoney(subtotal + amount) }
}

/** "8.25" for 8.25, "20" for 20: a rate as the business typed it */
export function ratePercentText(ratePercent: number): string {
  return String(Math.round(ratePercent * 1000) / 1000)
}
