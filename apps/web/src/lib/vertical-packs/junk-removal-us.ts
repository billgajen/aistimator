/**
 * Junk removal pack — United States (T-195).
 *
 * PURE DATA. Priced only from the customer's answers: how much there is (in
 * truck loads), where it is, and how many mattresses and big appliances. The
 * photos are for the business to check; nothing is read or measured from them.
 *
 * TODO-OWNER: every rate is a placeholder to review before this pack is
 * promoted (OWNER-TODO.md, T-195).
 */

import type { VerticalPack } from './types'

const LOADS = [
  { key: 'few', answer: 'A few items', name: 'A few items', cost: 95 },
  { key: 'quarter', answer: 'Quarter truck', name: 'Quarter truck load', cost: 150 },
  { key: 'half', answer: 'Half truck', name: 'Half truck load', cost: 280 },
  { key: 'three_quarter', answer: 'Three-quarter truck', name: 'Three-quarter truck load', cost: 400 },
  { key: 'full', answer: 'Full truck', name: 'Full truck load', cost: 520 },
] as const

const OUTSIDE = 'Outside or in the garage'
const INSIDE = 'Inside, ground floor'
const UPSTAIRS = 'Upstairs or basement'

export const junkRemovalPackUS: VerticalPack = {
  id: 'junk-removal-us',
  name: 'Junk removal (US)',
  description: 'Junk and furniture haul-away, priced by how much of a truck it fills and where it is.',
  icon: '🚛',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Junk Removal',
      description: 'Load, haul away and dispose of junk, furniture and appliances.',
      draft: {
        scope: {
          included: ['Loading', 'Haul-away', 'Disposal fees', 'A sweep-up where the junk was'],
          excluded: ['Hazardous waste', 'Paint', 'Chemicals', 'Asbestos'],
          assumptions: ['The truck can park within 50 ft of the junk'],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 6,
          photoGuidance: 'The whole pile first, then anything heavy or awkward.',
          requiredAngles: [
            { id: 'pile', label: 'The whole pile', guidance: 'Step back so everything to go is in frame' },
            { id: 'heavy', label: 'Anything heavy or awkward', guidance: 'A close photo of each big or heavy item' },
          ],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 95, // TODO-OWNER: placeholder rate
          workSteps: [
            ...LOADS.map((load) => ({
              id: `junk_${load.key}`,
              name: load.name,
              description: 'Loading, haul-away and disposal',
              costType: 'fixed' as const,
              defaultCost: load.cost, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'junk_amount', operator: 'equals' as const, equals: load.answer },
            })),
            {
              id: 'junk_inside',
              name: 'Carry out from inside',
              description: 'Carrying it out from the ground floor',
              costType: 'fixed',
              defaultCost: 30, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'junk_where', operator: 'equals', equals: INSIDE },
            },
            {
              id: 'junk_stairs',
              name: 'Carry down or up stairs',
              description: 'Carrying it from upstairs or the basement',
              costType: 'fixed',
              defaultCost: 60, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'junk_where', operator: 'equals', equals: UPSTAIRS },
            },
            {
              id: 'junk_mattress',
              name: 'Mattress disposal',
              description: 'Each mattress or box spring',
              costType: 'per_unit',
              defaultCost: 40, // TODO-OWNER: placeholder rate
              optional: false,
              unitLabel: 'item',
              quantitySource: { type: 'form_field', fieldId: 'junk_mattresses', missingMeansZero: true },
            },
            {
              id: 'junk_appliance',
              name: 'Fridge, freezer or AC unit disposal',
              description: 'Each appliance with refrigerant, recovered and disposed of',
              costType: 'per_unit',
              defaultCost: 60, // TODO-OWNER: placeholder rate
              optional: false,
              unitLabel: 'appliance',
              quantitySource: { type: 'form_field', fieldId: 'junk_appliances', missingMeansZero: true },
            },
          ],
          addOns: [],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 2000 },
        },
        expectedSignals: [],
        suggestedFields: [
          {
            label: 'How much is there?',
            fieldId: 'junk_amount',
            type: 'dropdown',
            required: true,
            criticalForPricing: true,
            options: LOADS.map((l) => l.answer),
            helpText: 'A full truck is about a one-car garage full.',
          },
          { label: 'Where is it?', fieldId: 'junk_where', type: 'dropdown', required: true, criticalForPricing: true, options: [OUTSIDE, INSIDE, UPSTAIRS] },
          { label: 'How many mattresses?', fieldId: 'junk_mattresses', type: 'number', required: false, helpText: 'Leave blank for none.' },
          { label: 'How many fridges, freezers or AC units?', fieldId: 'junk_appliances', type: 'number', required: false, helpText: 'Leave blank for none.' },
        ],
      },
      addons: [],
      multipliers: [],
      promptContext: 'The price comes from the customer\'s answers. Describe what the photos show; never estimate the amount from a photo.',
    },
  ],
}
