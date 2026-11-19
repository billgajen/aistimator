/**
 * T-167: every marketing sentence that says what the product reads, measures,
 * notices or works out is written through `says`, naming the rows of
 * `Docs/design/ai-capabilities.md` it rests on.
 *
 *   subline: says(['photo-notes', 'pricing-engine'], 'The AI reads …')
 *
 * `says` returns the sentence unchanged; it only records which capabilities
 * the sentence claims. A unit test (`ai-claims-t167.test.ts`) walks every
 * marketing copy file and fails when:
 *   - a sentence that reads like such a claim was not written through `says`;
 *   - a sentence names a capability the inventory does not list as claimable;
 *   - a trade page claims a capability the inventory does not give that trade.
 *
 * So a claim can only reach the site with a matching entry in the inventory.
 */

/** The ids of the inventory's claimable rows (sections 1 to 3 of ai-capabilities.md; a unit test keeps the two in step) */
export const CAPABILITIES = [
  'label-reading',
  'photo-measurement',
  'second-look',
  'confirm-question',
  'range-and-question',
  'extras-from-description',
  'words-against-answers',
  'also-asked',
  'photo-notes',
  'worth-considering',
  'scope-wording',
  'price-sentence',
  'service-draft',
  'service-match',
  'photo-quality-check',
  'measurement-memory',
  'pricing-engine',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/**
 * Listed in the inventory, but not to be put on a page until it has been seen
 * working in a live check. Empty since T-173: `service-match` was seen working
 * on the local stack on 2026-11-17 (the inventory has the run).
 */
export const NOT_YET_ON_A_PAGE: readonly Capability[] = []

const registry = new Map<string, readonly Capability[]>()

/** Write a claim: the sentence, and the inventory rows it rests on (at least one) */
export function says(capabilities: readonly [Capability, ...Capability[]], text: string): string {
  registry.set(text, capabilities)
  return text
}

/** Every sentence written through `says`, with its capabilities (read by the unit test) */
export function recordedClaims(): ReadonlyMap<string, readonly Capability[]> {
  return registry
}

/**
 * What makes a sentence read like a claim about the product's own working.
 * Deliberately wide: a sentence that matches and is not a claim is listed in
 * the test by name, so the list of exceptions is short and visible.
 */
export const CLAIM_WORDS = /\bAI\b|\bread(s|ing)?\b|\bmeasur\w*|\bwork(s|ed)? out\b|\bnotic\w*|\bdetect\w*|\bidentif\w*|\brecogni[sz]\w*|\blearn\w*|\bsmart\b|\bintelligen\w*/i
