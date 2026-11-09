/**
 * Electrical pack — United States (T-141): panel upgrades and EV chargers.
 *
 * PURE DATA. The existing panel's rated amperage is identified from its
 * label or main breaker (AD-029/AD-032) and selects the lines it drives; the
 * EV circuit run length is the customer's estimate (a derived quantity).
 *
 * TODO-OWNER: every rate and the amperage decode rules are placeholders to
 * review before this pack is promoted (OWNER-TODO.md, T-141).
 */

import type { ExpectedSignalConfig } from '@estimator/shared'
import type { VerticalPack } from './types'

const PANEL_RATINGS = ['60 A', '100 A', '125 A', '150 A', '200 A'] as const
const AMPS_MAP: Record<string, string> = { '60': '60 A', '100': '100 A', '125': '125 A', '150': '150 A', '200': '200 A' }

const panelAmps: ExpectedSignalConfig = {
  signalKey: 'panel_amps',
  type: 'enum',
  possibleValues: [...PANEL_RATINGS],
  description: 'rated amperage of the existing electrical panel',
  identify: {
    readFrom: 'the electrical panel\'s label or main breaker',
    transcribe: 'the rating line on the panel label (e.g. "RATED 100 AMPS") or the number printed on the main breaker handle',
    decode: [
      { pattern: '(?:RATED|MAIN|MAX\\.?|SERVICE)\\D{0,15}(60|100|125|150|200)\\s*(?:A\\b|AMPS?)', map: AMPS_MAP, label: 'panel rating' },
      { pattern: '\\b(60|100|125|150|200)\\s*(?:A\\b|AMPS?\\b)', map: AMPS_MAP, label: 'amperage on the label' },
    ],
  },
}

const PANEL_ANGLES = [
  { id: 'rating_plate', label: 'Panel label or main breaker', guidance: 'Open the panel door: close up on the label inside the door, or the main breaker with its number readable' },
  { id: 'panel_open', label: 'The whole panel, door open', guidance: 'Step back so every breaker is in frame (do not remove the cover)' },
]

export const electricalPackUS: VerticalPack = {
  id: 'electrical-us',
  name: 'Electrical (US)',
  description: 'Panel upgrades and Level 2 EV charger installs — priced from the panel label in the customer\'s photo.',
  icon: '⚡',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Electrical Panel Upgrade',
      description: 'Upgrade the main electrical panel and service to 200 A.',
      draft: {
        scope: {
          included: [
            'New 200 A main panel with main breaker',
            'Transfer of existing circuits, with new breakers where needed',
            'Grounding and bonding brought up to current code',
            'Utility disconnect/reconnect coordination and inspection',
          ],
          excluded: [
            'Utility company fees and any work on the utility side of the meter',
            'Rewiring of circuits beyond the panel',
            'Drywall or stucco patching around the panel',
            'Permit fees where the city charges them separately',
          ],
          assumptions: [
            'Panel stays in its current location',
            'The overhead or underground service drop can carry 200 A (confirmed with the utility)',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 5,
          photoGuidance: 'First, a close photo of the label inside the panel door or the main breaker (amperage readable). Then the whole panel with the door open, and the meter outside.',
          requiredAngles: [...PANEL_ANGLES, { id: 'meter', label: 'The electric meter outside', guidance: 'Whole meter and where the wires enter it' }],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'panel_200a',
              name: '200 A panel upgrade',
              description: 'Supply and install a 200 A main panel, transfer circuits, ground and bond',
              costType: 'fixed',
              defaultCost: 2600, // TODO-OWNER: placeholder rate
              optional: false,
            },
            {
              id: 'service_entrance_60a',
              name: 'Service entrance and meter base upgrade',
              description: 'A 60 A service needs a new meter base and service entrance conductors',
              costType: 'fixed',
              defaultCost: 1400, // TODO-OWNER: placeholder rate
              optional: true,
              triggerSignal: 'panel_amps',
              triggerCondition: { operator: 'equals', value: '60 A' },
            },
          ],
          addOns: [
            { name: 'Whole-home surge protector', price: 375, description: 'Type 2 surge protective device at the panel' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 8000 },
        },
        expectedSignals: [panelAmps],
        suggestedFields: [],
      },
      addons: [
        { id: 'addon_surge', label: 'Whole-home surge protector', price: 375, triggerKeywords: ['surge'] }, // TODO-OWNER
      ],
      multipliers: [],
      promptContext: 'Report the panel rating only from its label or main breaker; never estimate it from the panel\'s appearance.',
    },
    {
      name: 'EV Charger Installation',
      description: 'Install a Level 2 (240 V) EV charger on a new dedicated circuit.',
      draft: {
        scope: {
          included: [
            'New dedicated 240 V circuit and breaker from the panel to the charger',
            'Mounting and connecting the charger, with a load calculation',
            'First 25 ft of circuit run',
            'Startup test with your vehicle or a tester',
          ],
          excluded: [
            'Panel upgrades (quoted separately when the panel is too small)',
            'Trenching for detached garages or driveways',
            'Utility EV rebates paperwork',
            'Permit fees where the city charges them separately',
          ],
          assumptions: [
            'Surface-mounted conduit in a garage or on an exterior wall',
            'The panel has room for a two-pole breaker',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 5,
          photoGuidance: 'First, a close photo of the label inside the panel door or the main breaker (amperage readable). Then the whole panel, and the spot where the charger goes.',
          requiredAngles: [...PANEL_ANGLES, { id: 'charger_spot', label: 'Where the charger goes', guidance: 'The wall where you want the charger, with the parking spot' }],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'ev_install',
              name: 'Level 2 charger installation',
              description: 'Dedicated 240 V circuit, breaker, mounting and connection, first 25 ft of run',
              costType: 'fixed',
              defaultCost: 1150, // TODO-OWNER: placeholder rate
              optional: false,
            },
            {
              id: 'ev_extra_run',
              name: 'Additional circuit run',
              description: 'Conduit and wire beyond the first 25 ft',
              costType: 'per_unit',
              defaultCost: 18, // TODO-OWNER: placeholder rate per foot
              optional: false,
              unitLabel: 'ft',
              quantitySource: { type: 'derived', formula: 'max(0, run_length_ft - 25)' },
            },
            {
              id: 'ev_charger_supply',
              name: 'Level 2 charger (supplied)',
              description: 'A 48 A hardwired Level 2 charger',
              costType: 'fixed',
              defaultCost: 650, // TODO-OWNER: placeholder rate
              optional: true,
              when: { fieldId: 'charger_supply', operator: 'equals', equals: 'Please supply one' },
            },
            {
              id: 'ev_load_management',
              name: 'Load management device',
              description: 'A 100 A panel needs load management to add a charger safely',
              costType: 'fixed',
              defaultCost: 450, // TODO-OWNER: placeholder rate
              optional: true,
              triggerSignal: 'panel_amps',
              triggerCondition: { operator: 'equals', value: '100 A' },
            },
            {
              id: 'ev_service_upgrade_60a',
              name: 'Service upgrade allowance',
              description: 'A 60 A service cannot carry a charger; allowance toward a panel and service upgrade',
              costType: 'fixed',
              defaultCost: 2600, // TODO-OWNER: placeholder rate
              optional: true,
              triggerSignal: 'panel_amps',
              triggerCondition: { operator: 'equals', value: '60 A' },
            },
          ],
          addOns: [],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 6000 },
        },
        expectedSignals: [panelAmps],
        suggestedFields: [
          {
            label: 'Roughly how far is the charger spot from the electrical panel (feet)?',
            fieldId: 'run_length_ft',
            type: 'number',
            required: true,
            criticalForPricing: true,
            helpText: 'Follow the walls, not a straight line. A rough number is fine.',
          },
          {
            label: 'Do you already have the charger?',
            fieldId: 'charger_supply',
            type: 'dropdown',
            required: true,
            options: ['Yes, I have it', 'Please supply one'],
          },
        ],
      },
      addons: [],
      multipliers: [],
      promptContext: 'Report the panel rating only from its label or main breaker; never estimate it from the panel\'s appearance.',
    },
  ],
}
