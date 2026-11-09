/**
 * HVAC replacement pack — United States (T-140, AD-029/AD-032).
 *
 * PURE DATA. Identify-and-replace pricing: the price depends on WHAT the
 * existing equipment is (cooling tonnage, furnace input rating), read from its
 * rating plate and decoded by the rules below. The engine stays generic.
 *
 * TODO-OWNER: every rate is a PLACEHOLDER for the business to review at
 * onboarding — not researched price data (OWNER-TODO.md, T-140).
 * TODO-OWNER: the decode rules cover the common patterns (a printed nominal
 * tonnage, a three-digit BTU code such as "036" in the model number, or the
 * ICP/Carrier/Rheem form where the size follows a series digit, "NAC236") and
 * must be checked against real plates before this pack is promoted. When no
 * rule matches, the model's reading is used only if it is an allowed value,
 * and the customer is asked to confirm whenever the size moves the price.
 *
 * Design notes:
 * - The rating-plate photo is the FIRST guided angle: triage reads at most
 *   2–5 photos, and the plate is the one that sets the price.
 * - One optional fixed-price step per size, selected by the identified value
 *   (`triggerSignal`). Like-for-like replacement; upsizing is a site visit.
 */

import type { ExpectedSignalConfig, WorkStepConfig } from '@estimator/shared'
import type { VerticalPack } from './types'

/** Nominal cooling sizes; the "024"…"060" BTU/hr ÷ 1000 codes map onto them */
const TONNAGES = ['1.5 ton', '2 ton', '2.5 ton', '3 ton', '3.5 ton', '4 ton', '5 ton'] as const
const BTU_CODE_TO_TONNAGE: Record<string, string> = {
  '18': '1.5 ton',
  '24': '2 ton',
  '30': '2.5 ton',
  '36': '3 ton',
  '42': '3.5 ton',
  '48': '4 ton',
  '60': '5 ton',
}
const PRINTED_TONS: Record<string, string> = {
  '1.5': '1.5 ton', '2': '2 ton', '2.0': '2 ton', '2.5': '2.5 ton', '3': '3 ton', '3.0': '3 ton',
  '3.5': '3.5 ton', '4': '4 ton', '4.0': '4 ton', '5': '5 ton', '5.0': '5 ton',
}

function tonnageSignal(signalKey: string, unit: string): ExpectedSignalConfig {
  return {
    signalKey,
    type: 'enum',
    possibleValues: [...TONNAGES],
    description: `cooling size of the existing ${unit}`,
    identify: {
      readFrom: `the ${unit}'s rating plate`,
      transcribe: 'the model number (M/N or MODEL) exactly, plus any line that states a nominal tonnage (the plate is the data label on the side of the outdoor unit)',
      decode: [
        { pattern: '(\\d(?:\\.\\d)?)\\s*-?\\s*TONS?\\b', map: PRINTED_TONS, label: 'nominal tonnage printed on the plate' },
        // Size codes are read only inside a model-number-shaped token (2+ letters,
        // then letters/digits), never a serial such as "L0018 65769" (→ 1.5 ton).
        // Goodman/Trane/Lennox style: "GSX140361", "4TTR4036", "XC21-036"
        { pattern: '[A-Z]{2}[A-Z0-9-]*?0(18|24|30|36|42|48|60)', map: BTU_CODE_TO_TONNAGE, label: 'BTU code in the model number' },
        // ICP/Carrier/Rheem style, size after a series or SEER digit: "NAC236AKA1", "24ACC636A003", "RA1436AJ1NA"
        { pattern: '[A-Z]{2,}\\d{1,2}(18|24|30|36|42|48|60)[A-Z]', map: BTU_CODE_TO_TONNAGE, label: 'size code in the model number' },
      ],
    },
  }
}

/** One fixed-price step per size, selected by the identified (or confirmed) size */
function sizeSteps(prefix: string, signalKey: string, label: string, prices: number[]): WorkStepConfig[] {
  return TONNAGES.map((size, i) => ({
    id: `${prefix}_${size.replace(/\D+/g, '_').replace(/_+$/, '')}`,
    name: `${size} ${label}`,
    description: `Supply and install a ${size} ${label}, like for like`,
    costType: 'fixed' as const,
    defaultCost: prices[i]!, // TODO-OWNER: placeholder rate
    optional: true,
    triggerSignal: signalKey,
    triggerCondition: { operator: 'equals' as const, value: size },
  }))
}

const LOCATION_FIELD = {
  label: 'Where is the indoor unit?',
  fieldId: 'indoor_location',
  type: 'dropdown' as const,
  required: false,
  options: ['Basement', 'Garage', 'Closet or utility room', 'Attic', 'Crawl space'],
}

const HARD_ACCESS_MULTIPLIERS = [
  { when: { fieldId: 'indoor_location', operator: 'equals', equals: 'Attic' }, multiplier: 1.12 }, // TODO-OWNER
  { when: { fieldId: 'indoor_location', operator: 'equals', equals: 'Crawl space' }, multiplier: 1.15 }, // TODO-OWNER
]

export const hvacPackUS: VerticalPack = {
  id: 'hvac-replacement-us',
  name: 'HVAC replacement (US)',
  description:
    'Central AC, heat pump and gas furnace replacement — priced from the size on the rating plate in the customer\'s photo.',
  icon: '❄️',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    // ────────────────────────────────────────────────────────────────────
    // Central AC (split system condenser + matching coil)
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Central AC Replacement',
      description:
        'Replace a split-system central air conditioner (outdoor condenser and matching indoor coil), like for like.',
      draft: {
        scope: {
          included: [
            'New outdoor condenser and matching indoor evaporator coil, same size as the existing system',
            'New refrigerant line set flush or replacement where reusable lines fail inspection',
            'New pad, disconnect and whip where needed',
            'Refrigerant charge, startup and system test',
            'Removal and disposal of the old equipment, refrigerant recovered to EPA rules',
          ],
          excluded: [
            'Ductwork changes or repairs',
            'Upsizing or downsizing the system (needs a load calculation on site)',
            'Electrical panel upgrades',
            'Permit fees where the city charges them separately',
          ],
          assumptions: [
            'Like-for-like replacement at the size shown on the existing rating plate',
            'Existing electrical circuit is adequate for the new unit',
            'Clear access to the outdoor unit and the indoor coil',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 6,
          photoGuidance:
            'First, a close, sharp photo of the data label on the side of the outdoor unit (model number readable). Then the whole outdoor unit, and the indoor unit if you can reach it.',
          requiredAngles: [
            { id: 'rating_plate', label: 'Outdoor unit rating plate', guidance: 'Close up, in focus, no glare — the model number must be readable' },
            { id: 'outdoor_unit', label: 'The whole outdoor unit', guidance: 'Step back so the unit and its pad are in frame' },
            { id: 'indoor_unit', label: 'Indoor unit (furnace or air handler)', guidance: 'Skip if you can\'t reach it' },
          ],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'ac_removal',
              name: 'Removal, recovery and disposal',
              description: 'Recover refrigerant, remove and dispose of the old condenser and coil',
              costType: 'fixed',
              defaultCost: 450, // TODO-OWNER: placeholder rate
              optional: false,
            },
            ...sizeSteps('ac', 'ac_tonnage', 'AC system', [3900, 4200, 4600, 5000, 5500, 6000, 6900]),
          ],
          addOns: [
            { name: 'New line set', price: 650, description: 'Replace the refrigerant lines between the indoor and outdoor units' }, // TODO-OWNER
            { name: 'Smart thermostat', price: 325, description: 'Supply and install a Wi-Fi thermostat' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 12000 },
        },
        expectedSignals: [tonnageSignal('ac_tonnage', 'air conditioner')],
        suggestedFields: [LOCATION_FIELD],
      },
      addons: [
        { id: 'addon_line_set', label: 'New line set', price: 650, triggerKeywords: ['line set', 'lineset', 'refrigerant lines'] }, // TODO-OWNER
        { id: 'addon_thermostat', label: 'Smart thermostat', price: 325, triggerKeywords: ['thermostat', 'nest', 'ecobee'] }, // TODO-OWNER
      ],
      multipliers: HARD_ACCESS_MULTIPLIERS,
      promptContext:
        'The price is set by the size on the outdoor unit\'s rating plate. Report what the plate shows; never estimate the size from the unit\'s appearance.',
    },

    // ────────────────────────────────────────────────────────────────────
    // Heat pump (split system)
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Heat Pump Replacement',
      description: 'Replace a split-system heat pump (outdoor unit and matching indoor coil or air handler), like for like.',
      draft: {
        scope: {
          included: [
            'New outdoor heat pump and matching indoor coil or air handler, same size as the existing system',
            'Refrigerant charge, startup, heating and cooling test',
            'New pad, disconnect and whip where needed',
            'Removal and disposal of the old equipment, refrigerant recovered to EPA rules',
          ],
          excluded: [
            'Ductwork changes or repairs',
            'Upsizing or downsizing the system (needs a load calculation on site)',
            'Electrical panel upgrades',
            'Permit fees where the city charges them separately',
          ],
          assumptions: [
            'Like-for-like replacement at the size shown on the existing rating plate',
            'Existing electrical circuit is adequate for the new unit',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 6,
          photoGuidance:
            'First, a close, sharp photo of the data label on the side of the outdoor unit (model number readable). Then the whole outdoor unit and the indoor unit.',
          requiredAngles: [
            { id: 'rating_plate', label: 'Outdoor unit rating plate', guidance: 'Close up, in focus, no glare — the model number must be readable' },
            { id: 'outdoor_unit', label: 'The whole outdoor unit', guidance: 'Step back so the unit and its pad are in frame' },
            { id: 'indoor_unit', label: 'Indoor unit (air handler)', guidance: 'Skip if you can\'t reach it' },
          ],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'hp_removal',
              name: 'Removal, recovery and disposal',
              description: 'Recover refrigerant, remove and dispose of the old heat pump and coil',
              costType: 'fixed',
              defaultCost: 450, // TODO-OWNER: placeholder rate
              optional: false,
            },
            ...sizeSteps('hp', 'heat_pump_tonnage', 'heat pump system', [4900, 5300, 5800, 6300, 6900, 7500, 8600]),
          ],
          addOns: [
            { name: 'Smart thermostat', price: 325, description: 'Supply and install a heat-pump-compatible Wi-Fi thermostat' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 14000 },
        },
        expectedSignals: [tonnageSignal('heat_pump_tonnage', 'heat pump')],
        suggestedFields: [LOCATION_FIELD],
      },
      addons: [
        { id: 'addon_thermostat', label: 'Smart thermostat', price: 325, triggerKeywords: ['thermostat', 'nest', 'ecobee'] }, // TODO-OWNER
      ],
      multipliers: HARD_ACCESS_MULTIPLIERS,
      promptContext:
        'The price is set by the size on the outdoor unit\'s rating plate. Report what the plate shows; never estimate the size from the unit\'s appearance.',
    },

    // ────────────────────────────────────────────────────────────────────
    // Gas furnace
    // ────────────────────────────────────────────────────────────────────
    {
      name: 'Gas Furnace Replacement',
      description: 'Replace a natural-gas or propane furnace, like for like on input rating.',
      draft: {
        scope: {
          included: [
            'New gas furnace at the same input rating as the existing one',
            'Connection to the existing gas line, venting and ductwork plenum',
            'Startup, combustion check and safety test',
            'Removal and disposal of the old furnace',
          ],
          excluded: [
            'Ductwork changes or repairs',
            'New gas line runs or venting conversions (e.g. to PVC for high-efficiency)',
            'Permit fees where the city charges them separately',
          ],
          assumptions: [
            'Like-for-like replacement at the input rating on the existing rating plate',
            'Existing venting suits the new furnace',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 6,
          photoGuidance:
            'First, a close, sharp photo of the rating plate (usually inside the front panel door; the INPUT BTU/HR line must be readable). Then the whole furnace with its vent pipe.',
          requiredAngles: [
            { id: 'rating_plate', label: 'Furnace rating plate', guidance: 'Inside the front door — close up, in focus, INPUT BTU/HR readable' },
            { id: 'furnace', label: 'The whole furnace and vent pipe', guidance: 'Step back so the furnace and where the vent leaves it are in frame' },
          ],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'furnace_removal',
              name: 'Removal and disposal',
              description: 'Disconnect, remove and dispose of the old furnace',
              costType: 'fixed',
              defaultCost: 300, // TODO-OWNER: placeholder rate
              optional: false,
            },
            ...(['40,000', '60,000', '80,000', '100,000', '120,000'] as const).map((btu, i) => ({
              id: `furnace_${btu.replace(/,000$/, 'k')}`,
              name: `${btu} BTU/hr furnace`,
              description: `Supply and install a ${btu} BTU/hr input gas furnace`,
              costType: 'fixed' as const,
              defaultCost: [3000, 3300, 3600, 4000, 4400][i]!, // TODO-OWNER: placeholder rate
              optional: true,
              triggerSignal: 'furnace_input_btu',
              triggerCondition: { operator: 'equals' as const, value: btu },
            })),
          ],
          addOns: [
            { name: 'Smart thermostat', price: 325, description: 'Supply and install a Wi-Fi thermostat' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 10000 },
        },
        expectedSignals: [
          {
            signalKey: 'furnace_input_btu',
            type: 'enum',
            possibleValues: ['40,000', '60,000', '80,000', '100,000', '120,000'],
            description: 'input rating of the existing furnace (BTU/hr)',
            identify: {
              readFrom: 'the furnace\'s rating plate',
              transcribe: 'the INPUT BTU/HR line exactly, not the output line (the plate is usually inside the front panel door)',
              decode: [
                {
                  pattern: '(40|60|80|100|120)[,. ]?000',
                  map: { '40': '40,000', '60': '60,000', '80': '80,000', '100': '100,000', '120': '120,000' },
                  label: 'input rating on the plate',
                },
              ],
            },
          },
        ],
        suggestedFields: [LOCATION_FIELD],
      },
      addons: [
        { id: 'addon_thermostat', label: 'Smart thermostat', price: 325, triggerKeywords: ['thermostat', 'nest', 'ecobee'] }, // TODO-OWNER
      ],
      multipliers: HARD_ACCESS_MULTIPLIERS,
      promptContext:
        'The price is set by the INPUT rating on the furnace\'s rating plate. Report what the plate shows; never estimate it from the furnace\'s appearance.',
    },
  ],
}
