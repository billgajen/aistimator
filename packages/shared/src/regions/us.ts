import type { RegionDefinition } from './types'

const IN = 0.0254
const FT = 0.3048

/** United States — the launch market (AD-025). */
export const US_REGION: RegionDefinition = {
  code: 'US',
  name: 'United States',
  currency: 'USD',
  locale: 'en-US',
  unitSystem: 'imperial',
  postalCodePattern: '^\\d{5}(-\\d{4})?$',
  copy: {
    postalCodeLabel: 'ZIP code',
    postalCodeNoun: 'ZIP code',
    postalCodeExample: '90210',
    postalPrefixExample: '10001, 10002, 112',
    taxLabel: 'Sales tax',
    phoneExample: '(555) 123-4567',
    languageVariant: 'US English (US spelling: color, center; say "estimate" and "ZIP code")',
  },
  referenceObjects: [
    { id: 'entry_door_height', label: 'standard entry door height (80 in)', dimension: 'height', metres: round(80 * IN) },
    { id: 'entry_door_width', label: 'standard entry door width (36 in)', dimension: 'width', metres: round(36 * IN) },
    { id: 'interior_door_width', label: 'standard interior door width (32 in)', dimension: 'width', metres: round(32 * IN) },
    // US modular brick: 3 courses per 8 in
    { id: 'brick_course', label: 'one brick + mortar course (2⅔ in)', dimension: 'height', metres: round((8 / 3) * IN, 4) },
    { id: 'siding_course', label: 'one lap-siding course (4 in exposure)', dimension: 'height', metres: round(4 * IN, 4) },
    { id: 'fence_panel_width', label: 'standard fence panel width (8 ft)', dimension: 'width', metres: round(8 * FT) },
    { id: 'fence_panel_height', label: 'standard privacy fence height (6 ft)', dimension: 'height', metres: round(6 * FT) },
    { id: 'garage_door_single_width', label: 'single garage door width (8 ft)', dimension: 'width', metres: round(8 * FT) },
    { id: 'garage_door_double_width', label: 'double garage door width (16 ft)', dimension: 'width', metres: round(16 * FT) },
    { id: 'garage_door_height', label: 'standard garage door height (7 ft)', dimension: 'height', metres: round(7 * FT) },
    { id: 'outlet_cover_height', label: 'electrical outlet cover plate height (4.5 in)', dimension: 'height', metres: round(4.5 * IN, 4) },
    { id: 'trash_cart', label: 'curbside trash cart height (46 in)', dimension: 'height', metres: round(46 * IN) },
    { id: 'car_length', label: 'typical car length', dimension: 'length', metres: 4.8 },
    { id: 'person_height', label: 'adult person height', dimension: 'height', metres: 1.7 },
    { id: 'window_casement', label: 'typical double-hung window height (48 in)', dimension: 'height', metres: round(48 * IN) },
  ],
}

function round(value: number, places = 3): number {
  const f = 10 ** places
  return Math.round(value * f) / f
}
