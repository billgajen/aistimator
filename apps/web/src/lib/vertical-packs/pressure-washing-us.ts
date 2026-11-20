/**
 * Pressure washing pack — United States (T-195).
 *
 * PURE DATA. Priced only from the customer's answers: which surfaces, and how
 * big each is, in plain sizes ("2-car", "Two story"). "None" is the first
 * choice of each, and a surface left blank is not priced. The photos are for
 * the business to check; nothing is measured from them.
 *
 * TODO-OWNER: every rate is a placeholder to review before this pack is
 * promoted (OWNER-TODO.md, T-195).
 */

import type { WorkStepConfig } from '@qolumns/shared'
import type { VerticalPack } from './types'

const NONE = 'None'

const SURFACES: Array<{ fieldId: string; label: string; line: string; sizes: Array<[string, number]> }> = [
  { fieldId: 'pw_driveway', label: 'Driveway', line: 'Driveway', sizes: [['1-car', 120], ['2-car', 180], ['3-car or larger', 260]] },
  { fieldId: 'pw_patio', label: 'Patio or deck', line: 'Patio or deck', sizes: [['Small', 90], ['Medium', 140], ['Large', 200]] },
  { fieldId: 'pw_siding', label: 'House siding', line: 'House siding', sizes: [['One story', 320], ['Two story', 520]] },
  { fieldId: 'pw_walkways', label: 'Walkways or front steps', line: 'Walkways or front steps', sizes: [['Yes', 60]] },
]

const steps: WorkStepConfig[] = SURFACES.flatMap((surface) =>
  surface.sizes.map(([size, cost]) => ({
    id: `${surface.fieldId}_${size.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    name: size === 'Yes' ? surface.line : `${surface.line}, ${size.toLowerCase()}`,
    description: 'Pre-treat, wash and rinse',
    costType: 'fixed' as const,
    defaultCost: cost, // TODO-OWNER: placeholder rate
    optional: true,
    when: { fieldId: surface.fieldId, operator: 'equals' as const, equals: size },
  }))
)

export const pressureWashingPackUS: VerticalPack = {
  id: 'pressure-washing-us',
  name: 'Pressure washing (US)',
  description: 'Driveways, patios, decks, siding and walkways, priced by what is cleaned and how big it is.',
  icon: '💦',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Pressure Washing',
      description: 'Pressure wash driveways, patios and decks, siding and walkways.',
      draft: {
        scope: {
          included: ['Pre-treat', 'Wash', 'Rinse'],
          excluded: ['Roof cleaning', 'Paint or stain removal', 'Sealing'],
          assumptions: ['Water is available on site'],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 8,
          photoGuidance: 'One photo of each surface to be cleaned.',
          requiredAngles: [{ id: 'surfaces', label: 'Each surface to be cleaned', guidance: 'One photo per surface, the whole of it in frame' }],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 150, // TODO-OWNER: placeholder rate
          workSteps: steps,
          addOns: [
            { name: 'Deck or driveway sealing prep', price: 80, description: 'Getting a deck or driveway ready to be sealed' }, // TODO-OWNER
            { name: 'Gutter face brightening', price: 90, description: 'Cleaning the outside face of the gutters' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 2500 },
        },
        expectedSignals: [],
        suggestedFields: [
          ...SURFACES.map((surface) => ({
            label: surface.label,
            fieldId: surface.fieldId,
            type: 'dropdown' as const,
            required: false,
            options: [NONE, ...surface.sizes.map(([size]) => size)],
          })),
          {
            label: 'Is there an outdoor water tap we can use?',
            fieldId: 'pw_water',
            type: 'dropdown',
            required: true,
            options: ['Yes', 'No', 'Not sure'],
          },
        ],
      },
      addons: [
        { id: 'addon_sealing_prep', label: 'Deck or driveway sealing prep', price: 80, triggerKeywords: ['seal', 'sealing'] }, // TODO-OWNER
        { id: 'addon_gutter_brightening', label: 'Gutter face brightening', price: 90, triggerKeywords: ['gutter'] }, // TODO-OWNER
      ],
      multipliers: [],
      promptContext: 'The price comes from the customer\'s answers. Describe what the photos show; never estimate a surface\'s size from a photo.',
    },
  ],
}
