/**
 * Fence installation pack — United States (T-195).
 *
 * PURE DATA. Priced only from the customer's answers: the length (their rough
 * figure in feet), material, height, gates, an old fence, and the slope. Each
 * material is a per-foot line chosen by the answer; a 4 ft fence is 15% less
 * and sloped ground adds 10%, both as percent lines on the fence run (T-125).
 * The photos are for the business to check; nothing is measured from them.
 *
 * TODO-OWNER: every rate is a placeholder to review before this pack is
 * promoted (OWNER-TODO.md, T-195).
 */

import type { WorkStepConfig } from '@qolumns/shared'
import type { VerticalPack } from './types'

const MATERIALS: Array<{ key: string; answer: string; cost: number }> = [
  { key: 'wood', answer: 'Wood', cost: 32 },
  { key: 'vinyl', answer: 'Vinyl', cost: 42 },
  { key: 'chain_link', answer: 'Chain link', cost: 22 },
]
const RUN_STEPS = MATERIALS.map((m) => `fence_${m.key}`)

const steps: WorkStepConfig[] = [
  ...MATERIALS.map((m) => ({
    id: `fence_${m.key}`,
    name: `${m.answer} fence`,
    description: 'Posts set in concrete, panels or pickets, and hardware, per foot',
    costType: 'per_unit' as const,
    defaultCost: m.cost, // TODO-OWNER: placeholder rate per foot, 6 ft tall
    optional: true,
    unitLabel: 'ft',
    when: { fieldId: 'fence_material', operator: 'equals' as const, equals: m.answer },
    quantitySource: { type: 'form_field' as const, fieldId: 'fence_length_ft' },
  })),
  {
    id: 'fence_4ft',
    name: '4 ft height',
    description: 'A 4 ft fence is less than the 6 ft price',
    costType: 'percent',
    defaultCost: -15, // TODO-OWNER: placeholder percentage
    percentOf: RUN_STEPS,
    optional: true,
    when: { fieldId: 'fence_height', operator: 'equals', equals: '4 ft' },
  },
  {
    id: 'fence_slope',
    name: 'Sloped ground',
    description: 'Stepping or racking the fence on a slope',
    costType: 'percent',
    defaultCost: 10, // TODO-OWNER: placeholder percentage
    percentOf: RUN_STEPS,
    optional: true,
    when: { fieldId: 'fence_ground', operator: 'equals', equals: 'Sloped' },
  },
  {
    id: 'fence_gate',
    name: 'Gate',
    description: 'A walk gate with hinges and a latch',
    costType: 'per_unit',
    defaultCost: 350, // TODO-OWNER: placeholder rate per gate
    optional: false,
    unitLabel: 'gate',
    quantitySource: { type: 'form_field', fieldId: 'fence_gates', missingMeansZero: true },
  },
  {
    id: 'fence_removal',
    name: 'Old fence removal',
    description: 'Taking down and hauling away the old fence, per foot',
    costType: 'per_unit',
    defaultCost: 5, // TODO-OWNER: placeholder rate per foot
    optional: true,
    unitLabel: 'ft',
    when: { fieldId: 'fence_old', operator: 'equals', equals: 'Yes' },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
  },
]

export const fencingPackUS: VerticalPack = {
  id: 'fencing-us',
  name: 'Fence installation (US)',
  description: 'Wood, vinyl and chain link fences, priced per foot from the customer\'s length, height and material.',
  icon: '🪵',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Fence Installation',
      description: 'Install a wood, vinyl or chain link fence, with gates.',
      draft: {
        scope: {
          included: ['Posts set in concrete', 'Panels or pickets', 'Hardware', 'Clean-up'],
          excluded: ['Permits', 'A property survey', 'Tree or stump removal', 'Rock drilling'],
          assumptions: ['The property line is known and marked', 'Clear access along the fence line'],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 8,
          photoGuidance: 'Along the fence line from each end, and any old fence.',
          requiredAngles: [
            { id: 'line_end_a', label: 'Along the fence line, from one end', guidance: 'Stand at one end and look along where the fence goes' },
            { id: 'line_end_b', label: 'From the other end', guidance: 'The same, from the other end' },
            { id: 'old_fence', label: 'Any old fence', guidance: 'Only if there is a fence to take down' },
          ],
        },
        pricing: {
          pricingModel: 'per_unit',
          unitType: 'ft',
          baseFee: 0,
          minimumCharge: 0,
          workSteps: steps,
          addOns: [],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 8000 },
        },
        expectedSignals: [],
        suggestedFields: [
          {
            label: 'Roughly how long is the fence (feet)?',
            fieldId: 'fence_length_ft',
            type: 'number',
            required: true,
            criticalForPricing: true,
            helpText: 'One big step is about 3 feet. A rough number is fine.',
          },
          { label: 'What material?', fieldId: 'fence_material', type: 'dropdown', required: true, criticalForPricing: true, options: MATERIALS.map((m) => m.answer) },
          { label: 'How tall?', fieldId: 'fence_height', type: 'dropdown', required: true, criticalForPricing: true, options: ['4 ft', '6 ft'] },
          { label: 'How many gates?', fieldId: 'fence_gates', type: 'number', required: false, helpText: 'Leave blank for none.' },
          { label: 'Is there an old fence to take down?', fieldId: 'fence_old', type: 'dropdown', required: true, criticalForPricing: true, options: ['No', 'Yes'] },
          { label: 'Is the ground flat?', fieldId: 'fence_ground', type: 'dropdown', required: true, criticalForPricing: true, options: ['Mostly flat', 'Sloped', 'Not sure'] },
        ],
      },
      addons: [],
      multipliers: [],
      promptContext: 'The price comes from the customer\'s answers. Describe what the photos show; never estimate the fence length from a photo.',
    },
  ],
}
