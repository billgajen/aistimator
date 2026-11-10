import type { RegionDefinition } from './types'

/**
 * United Kingdom — existing tenants (backfilled to GB by migration 26).
 * The first nine reference objects are the exact values the measurement
 * engine used before T-133, so GB behaviour is unchanged.
 */
export const GB_REGION: RegionDefinition = {
  code: 'GB',
  name: 'United Kingdom',
  currency: 'GBP',
  locale: 'en-GB',
  unitSystem: 'metric',
  postalCodePattern: '^[A-Z]{1,2}[0-9][0-9A-Z]?\\s?[0-9][A-Z]{2}$',
  callingCode: '44',
  copy: {
    postalCodeLabel: 'Postcode',
    postalCodeNoun: 'postcode',
    postalCodeExample: 'SW1A 1AA',
    postalPrefixExample: 'SW1, SW2, SE1',
    taxLabel: 'VAT',
    phoneExample: '07700 900123',
    phoneHint: 'A mobile or landline number.',
    emailExample: 'hello@yourbusiness.co.uk',
    websiteExample: 'yourbusiness.co.uk',
    languageVariant: 'British English (UK spelling: colour, centre)',
    requestNoun: 'a quote',
  },
  referenceObjects: [
    { id: 'entry_door_height', label: 'standard entry door height', dimension: 'height', metres: 1.98 },
    { id: 'entry_door_width', label: 'standard entry door width', dimension: 'width', metres: 0.76 },
    { id: 'brick_course', label: 'one brick + mortar course', dimension: 'height', metres: 0.075 },
    { id: 'fence_panel_width', label: 'standard fence panel width', dimension: 'width', metres: 1.83 },
    { id: 'fence_panel_height', label: 'standard fence panel height', dimension: 'height', metres: 1.8 },
    { id: 'wheelie_bin', label: 'wheelie bin height', dimension: 'height', metres: 1.07 },
    { id: 'car_length', label: 'typical car length', dimension: 'length', metres: 4.5 },
    { id: 'person_height', label: 'adult person height', dimension: 'height', metres: 1.7 },
    { id: 'window_casement', label: 'typical window casement height', dimension: 'height', metres: 1.05 },
    { id: 'garage_door_single_width', label: 'single garage door width (7 ft)', dimension: 'width', metres: 2.13 },
    { id: 'garage_door_double_width', label: 'double garage door width (14 ft)', dimension: 'width', metres: 4.27 },
    { id: 'garage_door_height', label: 'standard garage door height', dimension: 'height', metres: 1.98 },
  ],
}
