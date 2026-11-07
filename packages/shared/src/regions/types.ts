/**
 * Region layer (T-133, AD-025).
 *
 * A region is pure DATA: currency, locale, unit system, tax wording, address
 * formats and the physical sizes of everyday reference objects. Engine code
 * reads these through the tenant's region and never hardcodes them.
 */

export type RegionCode = 'US' | 'GB'

export type UnitSystem = 'imperial' | 'metric'

/**
 * A known-size object the measurement engine can anchor against (M2).
 * Sizes are stored in METRES — metric is the canonical internal unit.
 */
export interface ReferenceObject {
  id: string
  label: string
  dimension: 'height' | 'width' | 'length'
  metres: number
}

/** Customer-facing wording that differs by region */
export interface RegionCopy {
  /** Field label, e.g. "ZIP code" / "Postcode" */
  postalCodeLabel: string
  /** Mid-sentence form, e.g. "ZIP code" / "postcode" */
  postalCodeNoun: string
  /** Example shown as a placeholder, e.g. "90210" / "SW1A 1AA" */
  postalCodeExample: string
  /** Example service-area prefixes, e.g. "10001, 10002, 112" / "SW1, SW2, SE1" */
  postalPrefixExample: string
  /** Default label for the tenant's tax line, e.g. "Sales tax" / "VAT" */
  taxLabel: string
  /** Example phone number shown as a placeholder */
  phoneExample: string
  /** Spelling/variant instruction handed to AI wording prompts */
  languageVariant: string
}

export interface RegionDefinition {
  code: RegionCode
  name: string
  /** ISO 4217 default currency (tenants can override) */
  currency: string
  /** BCP 47 locale for Intl formatting */
  locale: string
  /** Default unit system (tenants can override) */
  unitSystem: UnitSystem
  /** Regex source that validates a postal code (case-insensitive) */
  postalCodePattern: string
  copy: RegionCopy
  /** Reference object sizes for anchored measurement (metres) */
  referenceObjects: ReferenceObject[]
}
