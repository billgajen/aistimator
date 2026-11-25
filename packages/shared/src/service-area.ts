/**
 * T-201: is a job inside the places a business works? THE one rule, read by
 * the request form's server, the WhatsApp assistant and on-site quotes.
 *
 * A request is turned away only when we can tell it is outside. Anything we
 * cannot tell is let through: a customer is never refused on a guess.
 *
 *   - "Postcode/ZIP allowlist": the code must start with one of the business's
 *     entries (unchanged since T-133). No code given: not checked.
 *   - "County/State" (until T-201 this was saved and never checked): each
 *     entry is a state ("Texas", "TX") or a place with its state after a
 *     comma ("Harris County, TX"). The customer's ZIP code says which state
 *     the job is in (the region's own table, regions/us-areas.ts):
 *       · a state among the entries: inside;
 *       · every entry names a state and none is the job's: outside;
 *       · an entry with no state we know ("Harris County"): the ZIP code
 *         cannot place a county, so the request is let through, unless the
 *         customer wrote an address that names the entry (then it is inside
 *         for certain).
 *     No ZIP code and no address: not checked. A region with no table of
 *     areas (GB): only an address that names an entry can be matched, so
 *     nothing is turned away there.
 *
 * Pure. No place is named in this file: the states come from the region.
 */
import type { RegionAreas } from './regions/types'

export type ServiceAreaVerdict = 'inside' | 'outside' | 'not_checked'

export interface ServiceAreaInput {
  mode: string | null | undefined
  values: readonly unknown[] | null | undefined
  /** the customer's postal code, as typed */
  postcode?: string | null
  /** the address the customer wrote, when there is one (WhatsApp, an on-site quote) */
  address?: string | null
  /** the business's region's areas (`getRegion(tenant.region).areas`) */
  areas?: RegionAreas | null
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const lower = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim()

/** The area (state) a postal code is in, by the region's table. Null when the table does not say. */
export function areaOfPostalCode(postcode: string | null | undefined, areas: RegionAreas | null | undefined): string | null {
  if (!areas) return null
  const digits = clean(postcode).slice(0, areas.prefixLength)
  if (digits.length !== areas.prefixLength || !/^\d+$/.test(digits)) return null
  const prefix = Number(digits)
  return areas.prefixRanges.find(([from, to]) => prefix >= from && prefix <= to)?.[2] ?? null
}

/** "Texas" or "tx" → "TX". Null when it is not one of the region's areas. */
export function areaCodeOf(text: string, areas: RegionAreas | null | undefined): string | null {
  const wanted = lower(text).replace(/\.$/, '')
  if (!areas || !wanted) return null
  return areas.areas.find((a) => a.code.toLowerCase() === wanted || a.name.toLowerCase() === wanted)?.code ?? null
}

/**
 * One entry of the business's list: the state it is, or is in, when it says.
 * "Texas" → TX; "Harris County, TX" → TX; "Harris County" → no state.
 */
export function readAreaEntry(entry: unknown, areas: RegionAreas | null | undefined): { text: string; area: string | null; whole: boolean } | null {
  const text = clean(entry)
  if (!text) return null
  const whole = areaCodeOf(text, areas)
  if (whole) return { text, area: whole, whole: true }
  const last = text.split(',').pop() ?? ''
  return { text, area: text.includes(',') ? areaCodeOf(last, areas) : null, whole: false }
}

/** Does the address name this entry? Whole words, any case; a two-letter state code only in capitals. */
function addressNames(address: string, entry: { text: string; area: string | null; whole: boolean }, areas: RegionAreas | null | undefined): boolean {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const has = (phrase: string, flags: string) => phrase.length >= 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(phrase)}($|[^\\p{L}\\p{N}])`, `u${flags}`).test(address)
  if (entry.whole && entry.area) {
    const name = areas?.areas.find((a) => a.code === entry.area)?.name
    return has(entry.area, '') || (name ? has(name, 'i') : false)
  }
  // "Harris County, TX": the part before the comma is the place
  const place = entry.text.split(',')[0]?.trim() ?? ''
  return place.length >= 3 && has(place, 'i')
}

export function serviceAreaVerdict(input: ServiceAreaInput): ServiceAreaVerdict {
  const postcode = clean(input.postcode)
  const values = (input.values ?? []).map(clean).filter(Boolean)

  if (input.mode === 'postcode_allowlist') {
    if (!postcode) return 'not_checked'
    const code = postcode.toUpperCase()
    return values.some((prefix) => code.startsWith(prefix.toUpperCase())) ? 'inside' : 'outside'
  }
  if (input.mode !== 'county_state') return 'not_checked'

  const entries = values.map((value) => readAreaEntry(value, input.areas)).filter((e): e is NonNullable<typeof e> => e !== null)
  if (entries.length === 0) return 'not_checked'
  const address = clean(input.address)
  if (address && entries.some((entry) => addressNames(address, entry, input.areas))) return 'inside'

  const area = areaOfPostalCode(postcode, input.areas)
  if (!area) return 'not_checked'
  if (entries.some((entry) => entry.area === area)) return 'inside'
  // Outside only when every entry says which state it is in, and none is this one
  return entries.every((entry) => entry.area !== null) ? 'outside' : 'not_checked'
}

/** May this request go ahead? Everything but a certain "outside". */
export function withinServiceArea(input: ServiceAreaInput): boolean {
  return serviceAreaVerdict(input) !== 'outside'
}

/** The code the form's server answers with when a request is certainly outside the area (lib/quote-intake.ts) */
export const OUTSIDE_SERVICE_AREA_CODE = 'OUTSIDE_SERVICE_AREA'

/** "ZIP code" stays "ZIP code"; "Postcode" reads "postcode" inside a sentence */
function inSentence(label: string): string {
  const text = clean(label) || 'postcode'
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

/**
 * T-204: what the customer reads, beside the ZIP or postcode field, when the
 * business does not cover the place they gave. The form goes straight back to
 * that field with everything else they entered still there, so the line says
 * what to do next and never suggests starting again.
 */
export function outsideAreaLine(input: { businessName?: string | null; postalCodeLabel?: string | null; postcode?: string | null }): string {
  const business = clean(input.businessName) || 'This business'
  const label = inSentence(input.postalCodeLabel ?? '')
  const place = clean(input.postcode)
  return `${business} doesn’t cover ${place || `that ${label}`}. If the ${label} isn’t right, change it and send again. Everything else you entered is still here.`
}

/** The same, said in the chat form: there is no field to go back to, so the customer types the right one */
export function outsideAreaChatLine(input: { businessName?: string | null; postalCodeLabel?: string | null }): string {
  const business = clean(input.businessName) || 'This business'
  const label = inSentence(input.postalCodeLabel ?? '')
  return `Sorry, ${business} doesn’t cover that ${label}. If it isn’t right, tell me the correct one and I’ll send your request again. Everything else you told me is kept.`
}
