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
  /** T-151: one short format hint under the phone field */
  phoneHint: string
  /** T-152: example business email and website shown as placeholders */
  emailExample: string
  websiteExample: string
  /** Spelling/variant instruction handed to AI wording prompts */
  languageVariant: string
  /** T-149: what customers ask a trade for, with its article: "an estimate" / "a quote" */
  requestNoun: string
}

/**
 * T-201: the named areas of a region (the states of the US), and which one a
 * postal code is in. Data only; the rule that reads it is service-area.ts.
 */
export interface RegionAreas {
  /** what one area is called, mid-sentence: "state" */
  noun: string
  areas: Array<{ code: string; name: string }>
  /** how many leading characters of a postal code name its area */
  prefixLength: number
  /** [first prefix, last prefix, area code], as numbers; the first range that holds a prefix wins */
  prefixRanges: Array<[number, number, string]>
}

export interface RegionDefinition {
  code: RegionCode
  name: string
  /** ISO 4217 default currency (tenants can override) */
  currency: string
  /** BCP 47 locale for Intl formatting */
  locale: string
  /** T-196: the time zone a month is counted in until the business's own is known (tenants.time_zone) */
  timeZone: string
  /** T-211: the BCP 47 tag of the language a call is held in ("en-US"): given to the voice model as the language to expect */
  speechLanguage: string
  /** T-210: the number to call when someone may be in danger */
  emergencyNumber: string
  /** Default unit system (tenants can override) */
  unitSystem: UnitSystem
  /** Regex source that validates a postal code (case-insensitive) */
  postalCodePattern: string
  /** International calling code without "+", e.g. "1" / "44" (T-136 phone normalisation) */
  callingCode: string
  copy: RegionCopy
  /** Reference object sizes for anchored measurement (metres) */
  referenceObjects: ReferenceObject[]
  /** T-201: named areas a postal code can be placed in (US: states). Absent where no such table exists. */
  areas?: RegionAreas
}
