/**
 * T-174: cleaner quote links — pure, no IO.
 *
 * A business whose name was taken (or reserved, or too short) got a link that
 * ends in four generated characters: alex-hvac-3f9a. This module says when a
 * link still ends that way, and builds cleaner candidates from the business's
 * own stored details: its service area, its trade, its website name, its
 * region. Nothing here is a list of towns or trades; every word comes from the
 * tenant's record. Whether a candidate is free is the server's check
 * (lib/clean-slug-server.ts).
 */
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, slugify, slugProblem } from './tenant-slug'

/** How many clean links are offered at most */
export const CLEAN_SLUG_OFFERS = 3
/** How many candidates are built for the server to check */
export const CLEAN_SLUG_CANDIDATES = 12

/** The generated ending: a dash and four characters of an md5 (migration 32, generate_tenant_slug) */
const GENERATED_ENDING = /-[0-9a-f]{4}$/

/**
 * Does this link end in generated characters? True when it ends "-xxxx" and is
 * not simply the business's own name (a business called "Studio 2024" has the
 * plain link studio-2024). Whether it has already been replaced is a database
 * fact, checked on the server.
 */
export function endsInGeneratedCharacters(slug: string, businessName: string): boolean {
  return GENERATED_ENDING.test(slug) && slug !== slugify(businessName)
}

/** The business's stored details a clean link can be built from */
export interface CleanSlugDetails {
  name: string
  /** the link it has now */
  slug: string
  /** setup's trade answer: a template id, or 'other' with `tradeOther` */
  trade?: string | null
  tradeOther?: string | null
  /** what the business entered as its service area (postal codes, prefixes, counties or states) */
  serviceAreaValues?: readonly string[] | null
  /** the website shown on its quotes */
  website?: string | null
  region?: string | null
}

const tokens = (slug: string) => slug.split('-').filter(Boolean)

/** A stored value as one short link word: at most `maxWords` words, never longer than 20 characters */
function word(value: string | null | undefined, maxWords = 2): string {
  return tokens(slugify(value ?? '')).slice(0, maxWords).join('-').slice(0, 20).replace(/-+$/, '')
}

/** "https://www.alexhvac.com/contact" → "alexhvac" */
function websiteName(website: string | null | undefined): string {
  const host = (website ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0] ?? ''
  const labels = host.split('.').filter(Boolean)
  // a bare word is not a web address
  return labels.length >= 2 ? slugify(labels[0] ?? '') : ''
}

/** base + "-" + ending, with the base cut so the whole fits; '' when nothing sensible is left */
function join(base: string, ending: string): string {
  if (!ending) return ''
  const room = SLUG_MAX_LENGTH - ending.length - 1
  const cut = base.slice(0, Math.max(room, 0)).replace(/-+$/, '')
  return cut ? `${cut}-${ending}` : ''
}

/**
 * Clean links for this business, best first. Each is well formed and not a
 * reserved word; none is the link it has now. The server keeps the ones that
 * are free.
 */
export function cleanSlugCandidates(details: CleanSlugDetails): string[] {
  // What the link already starts with (the name as it was when the link was made), else the name today
  const fromLink = details.slug.replace(GENERATED_ENDING, '')
  const base = (endsInGeneratedCharacters(details.slug, details.name) ? fromLink : '') || slugify(details.name)
  const baseTokens = new Set(tokens(base))
  /** drop what the name already says ("alex-hvac" + "hvac-replacement" → "replacement"); '' when nothing is left */
  const fresh = (w: string) => tokens(w).filter((t) => !baseTokens.has(t)).join('-')
  const words = (values: readonly string[]) => [...new Set(values.map(fresh).filter(Boolean))]

  const regionWord = word(details.region, 1)
  // A template's id ends with its region ("water-heater-us"): the region is its own word, so it is cut from the trade
  const tradeId = tokens(slugify(details.trade && details.trade !== 'other' ? details.trade : ''))
  if (regionWord && tradeId.at(-1) === regionWord) tradeId.pop()
  const areas = words((details.serviceAreaValues ?? []).map((v) => word(v))).slice(0, 2)
  const trade = words([tradeId.length > 0 ? word(tradeId.join('-')) : word(details.tradeOther)])
  const site = websiteName(details.website)
  const region = words([regionWord])

  const out: string[] = []
  const add = (candidate: string) => {
    if (!candidate || candidate === details.slug || out.includes(candidate)) return
    if (candidate.length < SLUG_MIN_LENGTH || slugProblem(candidate) !== null) return
    out.push(candidate)
  }

  // A place written as a name ("austin", "travis-county") reads better than a
  // trade; a postal code or prefix ("78701", "bs9") reads worse. So: named
  // places, then the trade, then codes, then pairs, then the region.
  const named = areas.filter((a) => !/\d/.test(a))
  const coded = areas.filter((a) => /\d/.test(a))
  const [area] = areas
  if (base) {
    for (const a of named) add(join(base, a))
    for (const t of trade) add(join(base, t))
    for (const a of coded) add(join(base, a))
    for (const t of trade) if (area) add(join(base, `${t}-${area}`))
    for (const r of region) add(join(base, r))
    for (const r of region) if (area) add(join(base, `${area}-${r}`))
    for (const r of region) for (const t of trade) add(join(base, `${t}-${r}`))
  }
  // the name of its own website, when that is not just the business name again
  if (site && site !== base) add(site)
  return out.slice(0, CLEAN_SLUG_CANDIDATES)
}
