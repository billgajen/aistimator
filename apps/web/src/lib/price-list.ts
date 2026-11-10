/**
 * T-150: a service's pricing as a plain price list, and back — pure.
 *
 * "Check your prices" shows the business every number its pricing uses, in
 * its own words: priced items, add-ons, percentage adjustments ("Attic:
 * +12%"), minimum charge and base fee. Editing a number writes it back into
 * the SAME pricing config the service editor and POST /api/services use
 * (work steps, add-ons, multipliers, base fee, minimum) — AD-001, no second
 * source of truth. Nothing else in the config changes.
 *
 * The wording here never uses engine terms (work step, signal, multiplier).
 */
import type { AddonConfig, MultiplierConfig, ServiceDraftConfig, WorkStepConfig } from '@estimator/shared'

/** The parts of a draft service the price list reads and writes */
export interface PricedService {
  draft: ServiceDraftConfig
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
}

export type PriceUnit = 'each' | 'per_unit' | 'per_hour' | 'percent' | 'credit'

export interface PriceItem {
  /** Stable key back into the config: step:<id>, addon:<id>, adjust:<index> */
  key: string
  name: string
  /** Money amount, or a percentage for 'percent' items */
  amount: number
  unit: PriceUnit
  /** For per_unit: what one unit is, e.g. "sq ft" */
  unitLabel?: string
  /** A low–high range around the amount, when the business set one */
  range?: { low: number; high: number }
  /** Plain-words condition, e.g. 'When the customer picks "Double"' */
  note?: string
}

export interface PriceAdjustment {
  key: string
  /** e.g. "Attic", "Weekend job", "Jobs over $5,000" */
  name: string
  /** Signed percentage: +12 for ×1.12, −10 for ×0.9 */
  percent: number
}

export interface PriceList {
  items: PriceItem[]
  addons: PriceItem[]
  adjustments: PriceAdjustment[]
  minimumCharge: number
  baseFee: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function unitOf(step: WorkStepConfig): PriceUnit {
  switch (step.costType) {
    case 'per_unit':
      return 'per_unit'
    case 'per_hour':
      return 'per_hour'
    case 'percent':
      return 'percent'
    case 'credit':
      return 'credit'
    default:
      return 'each'
  }
}

function fieldLabel(fieldId: string | undefined, draft: ServiceDraftConfig): string {
  if (!fieldId) return ''
  const field = (draft.suggestedFields || []).find((f) => f.fieldId === fieldId)
  if (field?.label) return field.label
  return fieldId.replace(/^_/, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function stepNote(step: WorkStepConfig, draft: ServiceDraftConfig): string | undefined {
  const when = step.when
  if (!when?.fieldId) return undefined
  const value = (when as { equals?: unknown }).equals
  if (typeof value === 'string' && value) return `When the customer picks “${value}”`
  if (value === true) return `When the customer answers yes to “${fieldLabel(when.fieldId, draft)}”`
  return `Depends on “${fieldLabel(when.fieldId, draft)}”`
}

const OPERATOR_WORDS: Record<string, string> = {
  gt: 'over', gte: 'at least', lt: 'under', lte: 'up to', equals: 'is', eq: 'is', contains: 'includes',
}

function adjustmentName(m: MultiplierConfig, draft: ServiceDraftConfig, money: (n: number) => string): string {
  const { when } = m
  if (when.subject === 'subtotal') {
    const v = Number(when.value ?? when.equals)
    const op = OPERATOR_WORDS[when.operator ?? 'gt'] ?? 'over'
    return Number.isFinite(v) ? `Jobs ${op} ${money(v)}` : 'Job total'
  }
  const label = fieldLabel(when.fieldId, draft)
  if (typeof when.equals === 'string' && when.equals) return when.equals
  if (when.equals === true) return label
  if (when.equals === false) return `Not ${label.toLowerCase()}`
  const v = when.value ?? when.equals
  if (v !== undefined) return `${label} ${OPERATOR_WORDS[when.operator ?? 'equals'] ?? 'is'} ${String(v)}`
  return label
}

/** The plain price list for a service. `money` formats amounts in the business's currency. */
export function toPriceList(svc: PricedService, money: (n: number) => string = (n) => String(n)): PriceList {
  const { draft } = svc
  return {
    items: (draft.pricing.workSteps || []).map((step) => ({
      key: `step:${step.id}`,
      name: step.name,
      amount: step.defaultCost,
      unit: unitOf(step),
      ...(step.costType === 'per_unit' && { unitLabel: step.unitLabel || 'unit' }),
      ...(step.costBand && { range: { ...step.costBand } }),
      ...(stepNote(step, draft) && { note: stepNote(step, draft) }),
    })),
    addons: svc.addons.map((a) => ({ key: `addon:${a.id}`, name: a.label, amount: a.price, unit: 'each' as const })),
    adjustments: svc.multipliers.map((m, i) => ({
      key: `adjust:${i}`,
      name: adjustmentName(m, draft, money),
      percent: round2((m.multiplier - 1) * 100),
    })),
    minimumCharge: draft.pricing.minimumCharge,
    baseFee: draft.pricing.baseFee,
  }
}

/** A number the business typed: finite and not negative, else the old value */
function clean(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? round2(value) : fallback
}

/**
 * Write an edited price list back into the service's pricing config. Only the
 * numbers change; the draft's own add-on list is kept in step with the
 * add-ons by name, so the stored draft and the live config agree.
 */
export function applyPriceList(svc: PricedService, list: PriceList): PricedService {
  const byKey = new Map([...list.items, ...list.addons].map((i) => [i.key, i]))
  const adjustByKey = new Map(list.adjustments.map((a) => [a.key, a]))

  const workSteps = (svc.draft.pricing.workSteps || []).map((step) => {
    const edited = byKey.get(`step:${step.id}`)
    if (!edited) return step
    const defaultCost = clean(edited.amount, step.defaultCost)
    const costBand = step.costBand && edited.range
      ? { low: clean(edited.range.low, step.costBand.low), high: clean(edited.range.high, step.costBand.high) }
      : step.costBand
    return { ...step, defaultCost, ...(costBand && { costBand }) }
  })

  const addons = svc.addons.map((a) => {
    const edited = byKey.get(`addon:${a.id}`)
    return edited ? { ...a, price: clean(edited.amount, a.price) } : a
  })
  const priceByName = new Map(addons.map((a) => [a.label.trim().toLowerCase(), a.price]))

  const multipliers = svc.multipliers.map((m, i) => {
    const edited = adjustByKey.get(`adjust:${i}`)
    if (!edited || !Number.isFinite(edited.percent) || edited.percent <= -100) return m
    return { ...m, multiplier: Math.round((1 + edited.percent / 100) * 10000) / 10000 }
  })

  return {
    draft: {
      ...svc.draft,
      pricing: {
        ...svc.draft.pricing,
        workSteps,
        baseFee: clean(list.baseFee, svc.draft.pricing.baseFee),
        minimumCharge: clean(list.minimumCharge, svc.draft.pricing.minimumCharge),
        addOns: (svc.draft.pricing.addOns || []).map((a) => {
          const price = priceByName.get(a.name.trim().toLowerCase())
          return price === undefined ? a : { ...a, price }
        }),
      },
    },
    addons,
    multipliers,
  }
}

/** Plain unit words for the screen */
export function unitWords(item: PriceItem): string {
  switch (item.unit) {
    case 'per_unit':
      return `per ${item.unitLabel || 'unit'}`
    case 'per_hour':
      return 'per hour'
    case 'percent':
      return '% of the job'
    case 'credit':
      return 'off'
    default:
      return ''
  }
}
