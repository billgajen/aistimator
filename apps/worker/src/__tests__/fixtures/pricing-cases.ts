/**
 * T-166: the existing pricing cases, as one list.
 *
 * Every pricing fixture the unit tests already use (home cleaning, painting,
 * the fence service, the per-room example from T-165), each with its form
 * answers, each tax setting, and three minimum charges: the configured one,
 * none, and one high enough to apply. `priceCase` runs a case through the
 * pricing engine. The before-and-after test compares what the code makes of
 * each case with the totals recorded before T-166
 * (`t166-totals-before.json`).
 */
import {
  calculatePricingWithTrace,
  type PricingRules,
  type PricingResult,
  type FormAnswer,
  type TaxConfig,
} from '../../pricing/rules-engine'
import type { ExtractedSignalsV2 } from '@qolumns/shared'
import {
  homeCleaningPricingRules,
  paintingPricingRules,
  ukVatConfig,
  usNoTaxConfig,
  usSalesTaxConfig,
  basicCleaningFormAnswers,
  addonKeywordFormAnswers,
  crossServiceFormAnswers,
  minimalFormAnswers,
  formOverrideFormAnswers,
} from './test-services'
import {
  fencePricingRules,
  minimalScenarioFormAnswers,
  detailedScenarioFormAnswers,
  priceSensitiveScenarioFormAnswers,
  urgentScenarioFormAnswers,
  confusingScenarioFormAnswers,
} from './fence-service'
import {
  basicCleaningSignals,
  addonKeywordSignals,
  crossServiceSignals,
  formOverrideSignals,
  defaultLegacySignals,
  createMockSignalsV2,
} from '../mocks/ai-signals'

export interface PricingCase {
  name: string
  rules: PricingRules
  answers: FormAnswer[]
  signals: ExtractedSignalsV2
  tax: TaxConfig
  currency: string
}

/** What is compared before and after: the money, and each line's amount */
export interface CaseTotals {
  subtotal: number
  taxAmount: number
  total: number
  lines: number[]
}

export const totalsOf = (pricing: Pick<PricingResult, 'subtotal' | 'taxAmount' | 'total' | 'breakdown'>): CaseTotals => ({
  subtotal: pricing.subtotal,
  taxAmount: pricing.taxAmount,
  total: pricing.total,
  lines: pricing.breakdown.map((line) => line.amount),
})

const TAXES: Array<[string, TaxConfig]> = [
  ['uk vat', ukVatConfig],
  ['no tax', usNoTaxConfig],
  ['us sales tax', usSalesTaxConfig],
]
const noSignals = () => createMockSignalsV2([])

// "$375 per room, heavy prep adds $250" (T-165)
const roomRules: PricingRules = {
  baseFee: 0,
  minimumCharge: 0,
  addons: [],
  multipliers: [],
  workSteps: [
    { id: 'rooms', name: 'Rooms', description: 'Paint each room', costType: 'per_unit', defaultCost: 375, optional: false, unitLabel: 'room', quantitySource: { type: 'form_field', fieldId: 'room_count' } },
    { id: 'heavy_prep', name: 'Heavy prep', description: 'Fill and sand', costType: 'fixed', defaultCost: 250, optional: false },
  ],
}
const oneRoomRules: PricingRules = { ...roomRules, workSteps: roomRules.workSteps!.slice(0, 1) }

function buildCases(): PricingCase[] {
  const cases: PricingCase[] = []
  const services: Array<[string, PricingRules, Array<[string, FormAnswer[], ExtractedSignalsV2]>]> = [
    ['home cleaning', homeCleaningPricingRules, [
      ['basic', basicCleaningFormAnswers, basicCleaningSignals],
      ['add-on keywords', addonKeywordFormAnswers, addonKeywordSignals],
      ['cross-service', crossServiceFormAnswers, crossServiceSignals],
      ['minimal', minimalFormAnswers, noSignals()],
      ['form override', formOverrideFormAnswers, formOverrideSignals],
    ]],
    ['painting', paintingPricingRules, [
      ['basic', basicCleaningFormAnswers, basicCleaningSignals],
      ['minimal', minimalFormAnswers, noSignals()],
      ['no answers', [], noSignals()],
    ]],
    ['fence', fencePricingRules, [
      ['minimal', minimalScenarioFormAnswers, noSignals()],
      ['detailed', detailedScenarioFormAnswers, noSignals()],
      ['price sensitive', priceSensitiveScenarioFormAnswers, noSignals()],
      ['urgent', urgentScenarioFormAnswers, noSignals()],
      ['confusing', confusingScenarioFormAnswers, noSignals()],
    ]],
  ]
  for (const [service, rules, scenarios] of services) {
    for (const [scenario, answers, signals] of scenarios) {
      for (const [taxName, tax] of TAXES) {
        for (const minimumCharge of [rules.minimumCharge, 0, 50_000]) {
          cases.push({ name: `${service} / ${scenario} / ${taxName} / minimum ${minimumCharge}`, rules: { ...rules, minimumCharge }, answers, signals, tax, currency: 'GBP' })
        }
      }
    }
  }
  for (const [label, rules] of [['one room step', oneRoomRules], ['room and prep', roomRules]] as const) {
    for (const minimumCharge of [0, 100, 374.99, 375, 375.01, 400, 750.5, 2000]) {
      for (const rooms of [1, 2, 3]) {
        for (const [taxName, tax] of TAXES) {
          cases.push({
            name: `rooms / ${label} / ${rooms} room(s) / ${taxName} / minimum ${minimumCharge}`,
            rules: { ...rules, minimumCharge },
            answers: [{ fieldId: 'room_count', value: rooms }],
            signals: noSignals(),
            tax,
            currency: 'USD',
          })
        }
      }
    }
  }
  return cases
}

export const PRICING_CASES: PricingCase[] = buildCases()

/** One case through the pricing engine, as the worker runs it */
export function priceCase(c: PricingCase): PricingResult {
  return calculatePricingWithTrace(
    c.rules,
    structuredClone(defaultLegacySignals),
    structuredClone(c.signals),
    c.answers,
    c.tax,
    c.currency,
    undefined,
    { formAnswers: c.answers }
  ).result
}
