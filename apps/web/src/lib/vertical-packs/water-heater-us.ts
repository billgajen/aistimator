/**
 * Water heater replacement pack — United States (T-140, AD-029/AD-032).
 *
 * PURE DATA. Identify-and-replace pricing: tank size and fuel are read from
 * the rating label on the tank and decoded by the rules below.
 *
 * TODO-OWNER: every rate is a PLACEHOLDER for the business to review at
 * onboarding — not researched price data (OWNER-TODO.md, T-140).
 * TODO-OWNER: decode rules match the printed capacity line ("50 GAL") and
 * the fuel wording ("NATURAL GAS", "PROPANE"/"LP", 240 V / element wattage
 * for electric). Check them against real labels before this pack is promoted.
 *
 * Design notes:
 * - The label photo is the FIRST guided angle (triage reads 2–5 photos).
 * - Price = tank by size + connection by fuel; both steps are selected by
 *   identified (or confirmed) values. Tankless conversion is out of scope.
 */

import type { WorkStepConfig } from '@estimator/shared'
import type { VerticalPack } from './types'

const CAPACITIES = ['30 gal', '40 gal', '50 gal', '75 gal'] as const
const FUELS = ['Natural gas', 'Propane', 'Electric'] as const

const tankSteps: WorkStepConfig[] = CAPACITIES.map((capacity, i) => ({
  id: `tank_${capacity.replace(/\D+/g, '')}`,
  name: `${capacity} tank water heater`,
  description: `Supply a ${capacity} tank water heater, same fuel as the existing one`,
  costType: 'fixed',
  defaultCost: [1100, 1250, 1450, 2400][i]!, // TODO-OWNER: placeholder rate
  optional: true,
  triggerSignal: 'tank_capacity',
  triggerCondition: { operator: 'equals', value: capacity },
}))

const connectionSteps: WorkStepConfig[] = FUELS.map((fuel, i) => ({
  id: `connect_${fuel.toLowerCase().replace(/\s+/g, '_')}`,
  name: `${fuel} connection${fuel === 'Electric' ? '' : ' and venting'}`,
  description:
    fuel === 'Electric'
      ? 'Connect to the existing 240 V circuit'
      : `Connect to the existing ${fuel.toLowerCase()} line and vent, leak and draft test`,
  costType: 'fixed',
  defaultCost: [450, 500, 300][i]!, // TODO-OWNER: placeholder rate
  optional: true,
  triggerSignal: 'water_heater_fuel',
  triggerCondition: { operator: 'equals', value: fuel },
}))

export const waterHeaterPackUS: VerticalPack = {
  id: 'water-heater-us',
  name: 'Water heaters (US)',
  description:
    'Tank water heater replacement — priced from the size and fuel on the rating label in the customer\'s photo.',
  icon: '🚿',
  rateCurrency: 'USD',
  region: 'US',
  services: [
    {
      name: 'Water Heater Replacement',
      description: 'Replace a tank water heater (gas, propane or electric), like for like on size and fuel.',
      draft: {
        scope: {
          included: [
            'New tank water heater, same size and fuel as the existing one',
            'New supply connectors, shut-off valve and temperature/pressure relief valve',
            'Gas, propane or electric connection to the existing service, with venting for gas units',
            'Fill, startup and leak test',
            'Drain, removal and haul-away of the old heater',
          ],
          excluded: [
            'Conversion to tankless or to a different fuel',
            'New gas line runs, new circuits or panel work',
            'Moving the heater to a new location',
            'Permit fees where the city charges them separately',
          ],
          assumptions: [
            'Like-for-like replacement at the size and fuel on the existing label',
            'Existing gas line, venting or circuit is in serviceable condition',
            'Clear access to the heater',
          ],
        },
        media: {
          minPhotos: 1,
          maxPhotos: 5,
          photoGuidance:
            'First, a close, sharp photo of the rating label on the side of the tank (capacity and fuel lines readable). Then the whole heater with the pipes on top.',
          requiredAngles: [
            { id: 'rating_label', label: 'Tank rating label', guidance: 'Close up, in focus, no glare — the capacity (gallons) and fuel lines must be readable' },
            { id: 'whole_heater', label: 'The whole water heater', guidance: 'Step back so the tank and the pipes on top are in frame' },
          ],
        },
        pricing: {
          pricingModel: 'fixed',
          unitType: null,
          baseFee: 0,
          minimumCharge: 0,
          workSteps: [
            {
              id: 'wh_removal',
              name: 'Drain, removal and haul-away',
              description: 'Drain and remove the old heater and dispose of it',
              costType: 'fixed',
              defaultCost: 250, // TODO-OWNER: placeholder rate
              optional: false,
            },
            ...tankSteps,
            ...connectionSteps,
          ],
          addOns: [
            { name: 'Expansion tank', price: 225, description: 'Thermal expansion tank, often required by code on closed systems' }, // TODO-OWNER
            { name: 'Drain pan', price: 95, description: 'Overflow pan with drain line' }, // TODO-OWNER
            { name: 'Seismic straps', price: 120, description: 'Earthquake strapping where local code requires it' }, // TODO-OWNER
          ],
          siteVisit: { alwaysRecommend: false, confidenceBelowPct: 50, estimateAbove: 6000 },
        },
        expectedSignals: [
          {
            signalKey: 'tank_capacity',
            type: 'enum',
            possibleValues: [...CAPACITIES],
            description: 'capacity of the existing water heater tank',
            identify: {
              readFrom: 'the tank\'s rating label',
              transcribe: 'the capacity line (gallons) exactly, and the model number',
              decode: [
                {
                  pattern: '\\b(30|40|50|75)\\s*(?:U\\.?S\\.?\\s*)?GAL',
                  map: { '30': '30 gal', '40': '40 gal', '50': '50 gal', '75': '75 gal' },
                  label: 'capacity printed on the label',
                },
              ],
            },
          },
          {
            signalKey: 'water_heater_fuel',
            type: 'enum',
            possibleValues: [...FUELS],
            description: 'fuel of the existing water heater',
            identify: {
              readFrom: 'the tank\'s rating label',
              transcribe: 'the gas type line (e.g. NATURAL GAS, PROPANE) or the voltage/wattage line exactly',
              decode: [
                { pattern: 'NAT(?:URAL)?\\.?\\s*GAS|\\bNG\\b', value: 'Natural gas', label: 'gas type on the label' },
                { pattern: 'PROPANE|\\bL\\.?P\\.?G?\\b', value: 'Propane', label: 'gas type on the label' },
                { pattern: '\\b(?:208|240)\\s*V|\\bVOLTS?\\s*(?:208|240)\\b|\\b\\d{4}\\s*W(?:ATTS?)?\\b|\\bWATTS?\\s*\\d{4}\\b', value: 'Electric', label: 'voltage/element rating on the label' },
              ],
            },
          },
        ],
        suggestedFields: [
          {
            label: 'Where is the water heater?',
            fieldId: 'heater_location',
            type: 'dropdown',
            required: false,
            options: ['Garage', 'Basement', 'Closet or utility room', 'Attic'],
          },
        ],
      },
      addons: [
        { id: 'addon_expansion_tank', label: 'Expansion tank', price: 225, triggerKeywords: ['expansion tank'] }, // TODO-OWNER
        { id: 'addon_drain_pan', label: 'Drain pan', price: 95, triggerKeywords: ['drain pan', 'overflow pan'] }, // TODO-OWNER
        { id: 'addon_seismic_straps', label: 'Seismic straps', price: 120, triggerKeywords: ['seismic', 'earthquake strap', 'strapping'] }, // TODO-OWNER
      ],
      multipliers: [
        { when: { fieldId: 'heater_location', operator: 'equals', equals: 'Attic' }, multiplier: 1.2 }, // TODO-OWNER
      ],
      promptContext:
        'The price is set by the capacity and fuel on the tank\'s rating label. Report what the label shows; never estimate the size from the tank\'s appearance.',
    },
  ],
}
