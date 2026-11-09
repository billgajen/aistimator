/**
 * Plumbing fixtures pack — United States (T-141).
 *
 * PURE DATA. A price list: the customer says how many of each fixture to
 * replace (catalogue semantics, T-131: an unanswered count means none), and
 * whether they supply the fixtures. Counts are customer knowledge, so no
 * vision quantities; photos help the business spot shut-off and access issues.
 *
 * TODO-OWNER: every rate is a placeholder to review before this pack is
 * promoted (OWNER-TODO.md, T-141).
 */

import type { SuggestedField, WorkStepConfig } from '@estimator/shared'
import type { VerticalPack } from './types'

const SUPPLY_FIELD = 'fixture_supply'
const WE_SUPPLY = 'Please supply standard ones'

const ITEMS = [
  { key: 'toilet', label: 'Toilet', plural: 'toilets', labor: 325, supply: 275 },
  { key: 'faucet', label: 'Faucet', plural: 'faucets (kitchen or bathroom)', labor: 275, supply: 175 },
  { key: 'disposal', label: 'Garbage disposal', plural: 'garbage disposals', labor: 225, supply: 200 },
] as const

const steps: WorkStepConfig[] = ITEMS.flatMap((item) => [
  {
    id: `${item.key}_install`,
    name: `${item.label} replacement`,
    description: `Remove the old ${item.label.toLowerCase()} and install the new one, with new supply line`,
    costType: 'per_unit' as const,
    defaultCost: item.labor, // TODO-OWNER: placeholder rate
    optional: false,
    unitLabel: item.key,
    quantitySource: { type: 'form_field' as const, fieldId: `${item.key}_count`, missingMeansZero: true },
  },
  {
    id: `${item.key}_supply`,
    name: `${item.label} (supplied)`,
    description: `A standard ${item.label.toLowerCase()} supplied by us`,
    costType: 'per_unit' as const,
    defaultCost: item.supply, // TODO-OWNER: placeholder rate
    optional: true,
    unitLabel: item.key,
    when: { fieldId: SUPPLY_FIELD, operator: 'equals' as const, equals: WE_SUPPLY },
    quantitySource: { type: 'form_field' as const, fieldId: `${item.key}_count`, missingMeansZero: true },
  },
])

const fields: SuggestedField[] = [
  ...ITEMS.map((item) => ({
    label: `How many ${item.plural} to replace?`,
    fieldId: `${item.key}_count`,
    type: 'number' as const,
    required: false,
    // Not criticalForPricing: the public API REQUIRES critical fields, and a
    // price list must accept "just the toilets" (blank = none, T-131)
    helpText: 'Leave blank for none',
  })),
  {
    label: 'Who supplies the new fixtures?',
    fieldId: SUPPLY_FIELD,
    type: 'dropdown',
    required: true,
    options: ['I will supply them', WE_SUPPLY],
  },
]

export const plumbingPackUS: VerticalPack = {
  id: 'plumbing-fixtures-us',
  name: 'Plumbing fixtures (US)',
  description: 'Toilet, faucet and garbage disposal replacement — a clear per-fixture price list.',
  icon: '🚽',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Fixture Replacement',
      description: 'Replace toilets, faucets and garbage disposals, priced per fixture.',
      draft: {
        scope: {
          included: [
            'Removal and disposal of the old fixtures',
            'Installation of the new fixtures with new supply lines and wax ring (toilets)',
            'Leak test of every connection',
          ],
          excluded: [
            'Replacing shut-off valves that are seized or leaking (quoted on site)',
            'Drain line, flange or subfloor repairs',
            'Cabinet or countertop modifications',
          ],
          assumptions: ['Working shut-off valves at each fixture', 'Standard fixture sizes and connections'],
        },
        media: {
          minPhotos: 0,
          maxPhotos: 6,
          photoGuidance: 'Optional: one photo of each fixture, and of the shut-off valves under the sink or behind the toilet.',
          requiredAngles: [
            { id: 'fixtures', label: 'Each fixture', guidance: 'One photo per fixture you want replaced' },
            { id: 'shut_offs', label: 'Shut-off valves', guidance: 'Under the sink or behind the toilet' },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'fixture',
          baseFee: 95, // TODO-OWNER: placeholder trip charge
          minimumCharge: 250, // TODO-OWNER: placeholder rate
          workSteps: steps,
          addOns: [
            { name: 'Shut-off valve replacement', price: 85, description: 'Per valve, quarter-turn' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 4000 },
        },
        expectedSignals: [],
        suggestedFields: fields,
      },
      addons: [
        { id: 'addon_shutoff', label: 'Shut-off valve replacement', price: 85, triggerKeywords: ['shut-off', 'shutoff', 'valve'] }, // TODO-OWNER
      ],
      multipliers: [],
    },
  ],
}
