/**
 * Garage doors pack — United States (T-141).
 *
 * PURE DATA. Door size and style are things the customer knows, so they are
 * form answers that select the price (T-126 `when` conditions); photos let
 * the business check the opening and the hardware.
 *
 * TODO-OWNER: every rate is a placeholder to review before this pack is
 * promoted (OWNER-TODO.md, T-141).
 */

import type { VerticalPack } from './types'

const SINGLE = 'Single (8 or 9 ft wide, 7 ft tall)'
const DOUBLE = 'Double (16 ft wide, 7 ft tall)'
const INSULATED = 'Steel, insulated'
const COMPOSITE = 'Wood-look composite'

export const garageDoorsPackUS: VerticalPack = {
  id: 'garage-doors-us',
  name: 'Garage doors (US)',
  description: 'Garage door replacement and torsion spring repair — priced from size, style and spring count.',
  icon: '🚪',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Garage Door Replacement',
      description: 'Replace a sectional garage door, including tracks, springs and weather seal.',
      draft: {
        scope: {
          included: [
            'New sectional door with tracks, torsion springs, cables and rollers',
            'New bottom seal and perimeter weather stripping',
            'Removal and disposal of the old door',
            'Balance and safety-reverse test with your opener',
          ],
          excluded: [
            'Framing or header repairs to the opening',
            'Opener replacement (optional extra)',
            'Custom sizes, windows or decorative hardware beyond standard',
          ],
          assumptions: ['Standard opening sizes', 'Existing opener works and is compatible'],
        },
        media: {
          minPhotos: 0, // price comes from the form; photos help the business check the opening
          maxPhotos: 4,
          photoGuidance: 'A photo of the door from outside, and one from inside showing the springs and tracks.',
          requiredAngles: [
            { id: 'outside', label: 'The door from outside', guidance: 'The whole door, straight on' },
            { id: 'inside', label: 'Inside, above the door', guidance: 'Springs, tracks and the opener in frame' },
          ],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'door_removal',
              name: 'Removal and disposal',
              description: 'Remove and dispose of the old door and hardware',
              costType: 'fixed',
              defaultCost: 150, // TODO-OWNER: placeholder rate
              optional: false,
            },
            {
              id: 'door_single',
              name: 'Single garage door',
              description: 'Supply and install a single sectional door, steel, non-insulated',
              costType: 'fixed',
              defaultCost: 1250, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'door_size', operator: 'equals', equals: SINGLE },
            },
            {
              id: 'door_double',
              name: 'Double garage door',
              description: 'Supply and install a double sectional door, steel, non-insulated',
              costType: 'fixed',
              defaultCost: 1950, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'door_size', operator: 'equals', equals: DOUBLE },
            },
          ],
          addOns: [
            { name: 'New belt-drive opener', price: 575, description: 'Quiet belt-drive opener with two remotes and keypad' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 6000 },
        },
        expectedSignals: [],
        suggestedFields: [
          { label: 'Door size', fieldId: 'door_size', type: 'dropdown', required: true, criticalForPricing: true, options: [SINGLE, DOUBLE] },
          { label: 'Door style', fieldId: 'door_style', type: 'dropdown', required: true, criticalForPricing: true, options: ['Steel, non-insulated', INSULATED, COMPOSITE] },
        ],
      },
      addons: [
        { id: 'addon_opener', label: 'New belt-drive opener', price: 575, triggerKeywords: ['opener', 'belt drive', 'belt-drive'] }, // TODO-OWNER
      ],
      multipliers: [
        { when: { fieldId: 'door_style', operator: 'equals', equals: INSULATED }, multiplier: 1.2 }, // TODO-OWNER
        { when: { fieldId: 'door_style', operator: 'equals', equals: COMPOSITE }, multiplier: 1.6 }, // TODO-OWNER
      ],
    },
    {
      name: 'Garage Door Spring Replacement',
      description: 'Replace broken torsion springs, with a cable, roller and balance tune-up.',
      draft: {
        scope: {
          included: [
            'New torsion spring(s) matched to the door\'s weight',
            'Inspection and adjustment of cables, drums and rollers',
            'Lubrication, balance and safety-reverse test',
          ],
          excluded: ['Replacing bent tracks, sections or the opener', 'Extension-spring conversions'],
          assumptions: ['A standard residential sectional door with torsion springs above the opening'],
        },
        media: {
          minPhotos: 0, // price comes from the form; photos help the business check the opening
          maxPhotos: 3,
          photoGuidance: 'A photo from inside of the spring bar above the door (shows how many springs, and the broken one).',
          requiredAngles: [{ id: 'springs', label: 'The springs above the door', guidance: 'From inside, the whole bar above the door' }],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'spring_one',
              name: 'Torsion spring replacement (one spring)',
              description: 'Replace the single torsion spring and tune up the door',
              costType: 'fixed',
              defaultCost: 275, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'spring_count', operator: 'equals', equals: 'One' },
            },
            {
              id: 'spring_two',
              name: 'Torsion spring replacement (pair)',
              description: 'Replace both torsion springs as a matched pair and tune up the door',
              costType: 'fixed',
              defaultCost: 375, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'spring_count', operator: 'equals', equals: 'Two' },
            },
          ],
          addOns: [
            { name: 'New cables', price: 85, description: 'Replace both lift cables' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 2000 },
        },
        expectedSignals: [],
        suggestedFields: [
          {
            label: 'How many springs are on the bar above the door?',
            fieldId: 'spring_count',
            type: 'dropdown',
            required: true,
            criticalForPricing: true,
            options: ['One', 'Two'],
            helpText: 'Look at the metal bar above the door from inside the garage',
          },
        ],
      },
      addons: [
        { id: 'addon_cables', label: 'New cables', price: 85, triggerKeywords: ['cable', 'cables'] }, // TODO-OWNER
      ],
      multipliers: [],
    },
  ],
}
