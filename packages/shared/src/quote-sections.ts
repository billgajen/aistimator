/**
 * T-179: one request, several services (AD-061). Pure, no IO.
 *
 * A customer can ask for more than one of a business's services in one
 * request. The service they chose is priced as always. Each other service
 * they explicitly asked for can be added to the same quote as a SECTION:
 * priced by the rules engine from that service's own rules, exactly as if it
 * had been requested alone. One quote, one total, one accept.
 *
 * The shape (no new table or column):
 *
 *   pricing_json.breakdown   the main service's lines, exactly as before
 *   pricing_json.sections    the added services, each with its own lines,
 *                            its own minimum (AD-048) and its subtotal
 *   pricing_json.subtotal    main + every section
 *   pricing_json.taxAmount   worked out ONCE, on the combined taxable amount
 *   pricing_json.total       the one total the customer accepts
 *   content_json.alsoAsked   what else the customer asked for, and where each
 *                            stands: offered, added, or not one of the
 *                            business's services
 *
 * A quote with no `sections` is a single-service quote and nothing about it
 * changes. Every place that shows or saves a combined quote goes through the
 * functions here, so the arithmetic exists once.
 *
 * Nothing here knows a price: sections arrive priced by the worker's rules
 * engine (or edited by the business), and this only adds them up.
 */
import type { QuotePricing } from './database.types'
import { roundMoney } from './money'
import { MINIMUM_ENTRY_KIND, editedBreakdown, minimumEntry, minimumTopUp, splitMinimum, type AppliedMinimum } from './minimum-charge'
import type { ReviewHoldKind, ReviewMode } from './review-mode'

/** At most this many services can be added to one quote */
export const MAX_ADDED_SECTIONS = 2

export type SectionLine = QuotePricing['breakdown'][number]

/** A customer's (or the business's) answer to one of the added service's own questions */
export interface SectionAnswer {
  /** The question's key: a form field id, or the key of a quantity the service prices by */
  key: string
  label: string
  value: string | number | boolean
}

/** One added service on a quote */
export interface QuoteSection {
  serviceId: string
  serviceName: string
  /** That service's lines, with its own minimum top-up entry when its floor applied (AD-048) */
  breakdown: SectionLine[]
  /** The lines and the top-up together, before tax */
  subtotal: number
  /** The service is not taxed (T-133): it is left out of the amount tax is worked out on */
  taxExempt?: boolean
  addedBy: 'customer' | 'business'
  addedAt: string
  /** What was answered to price it */
  answers?: SectionAnswer[]
  /**
   * The business approves this part's price before the customer sees it (its
   * service, or the quote's main service, is set to hold until approved).
   * While the quote waits for approval the customer is shown this part with
   * no price, and it is left out of every figure they see; the rest of the
   * quote stays exactly as they saw it. Once the business approves, it shows.
   */
  awaitingApproval?: boolean
}

export type SectionQuestionType = 'number' | 'text' | 'select' | 'boolean'

/** One of the added service's own questions, as the customer is asked it */
export interface SectionQuestion {
  key: string
  label: string
  type: SectionQuestionType
  options?: Array<{ value: string; label: string }>
  /** For a number: the unit it is counted in */
  unit?: string
  /** What the AI read from the customer's note. Shown for the customer to confirm or change; never used unconfirmed. */
  prefill?: string | number | boolean
}

export type AlsoAskedState = 'offered' | 'added' | 'not_offered'

/** Something else the customer asked for in their note */
export interface AlsoAsked {
  id: string
  /** The customer's own words (a literal part of what they wrote) */
  words: string
  /** The business's service it matches; null when the business offers nothing for it */
  serviceId: string | null
  serviceName?: string
  state: AlsoAskedState
  /** Before tax, when nothing more needs asking. Absent while questions remain. Never present for `not_offered`. */
  price?: number
  questions?: SectionQuestion[]
  /** The business approves this service's price before a customer sees it: the card shows none */
  priceOnApproval?: boolean
}

/** How the combined quote is taxed */
export interface SectionTax {
  /** Whole-number percentage (20 = 20%); 0 or less means no tax */
  ratePercent: number
  label?: string
  /** The main service is taxed (the business charges tax and the service is not exempt) */
  mainTaxable: boolean
}

const sum = (lines: readonly { amount: number }[] | null | undefined) =>
  roundMoney((lines ?? []).reduce((total, line) => total + (Number(line.amount) || 0), 0))

/** The added sections on a quote (an empty list for a single-service quote, or anything malformed) */
export function addedSections(pricing: object | null | undefined): QuoteSection[] {
  const raw = (pricing as { sections?: unknown } | null | undefined)?.sections
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s): s is QuoteSection => Boolean(s) && typeof (s as QuoteSection).serviceId === 'string' && Array.isArray((s as QuoteSection).breakdown)
  )
}

export function hasSections(pricing: object | null | undefined): boolean {
  return addedSections(pricing).length > 0
}

/** The main service's own subtotal: its lines and its minimum top-up (never the added sections) */
export function mainSubtotal(pricing: Pick<QuotePricing, 'breakdown' | 'subtotal'>): number {
  const sections = addedSections(pricing)
  // A single-service quote's subtotal is its own. (Some old quotes' lines do not add up to it; it is left as stored.)
  if (sections.length === 0) return roundMoney(pricing.subtotal)
  return sum(pricing.breakdown)
}

/** A section's subtotal is always its own lines added up: a section's lines can be edited */
export function sectionSubtotal(section: Pick<QuoteSection, 'breakdown'>): number {
  return sum(section.breakdown)
}

export type CombinedPricing = QuotePricing & { sections?: QuoteSection[] }

/**
 * The quote's pricing with these added sections: every subtotal worked out
 * again from its lines, tax worked out once on the combined taxable amount,
 * and one total. With no sections the `sections` key is removed and the
 * figures are the main service's own.
 *
 * `pricing` may already carry sections; they are replaced by `sections`.
 */
export function withSections(pricing: CombinedPricing, sections: readonly QuoteSection[], tax: SectionTax): CombinedPricing {
  const main = mainSubtotal(pricing)
  const next = sections.slice(0, MAX_ADDED_SECTIONS).map((s) => ({ ...s, subtotal: sectionSubtotal(s) }))
  const subtotal = roundMoney(main + next.reduce((total, s) => total + s.subtotal, 0))
  const rate = tax.ratePercent > 0 ? tax.ratePercent : 0
  const taxable = roundMoney((tax.mainTaxable ? main : 0) + next.filter((s) => !s.taxExempt).reduce((total, s) => total + s.subtotal, 0))
  const taxAmount = rate > 0 ? roundMoney((taxable * rate) / 100) : 0
  const total = roundMoney(subtotal + taxAmount)

  // A range the engine measured for the main service moves with what was added or removed, tax included
  const grossBefore = roundMoney(pricing.total)
  const shift = roundMoney(total - grossBefore)
  const estimate =
    pricing.estimate && pricing.estimate.rangeLow !== undefined && pricing.estimate.rangeHigh !== undefined && shift !== 0
      ? { ...pricing.estimate, rangeLow: roundMoney(pricing.estimate.rangeLow + shift), rangeHigh: roundMoney(pricing.estimate.rangeHigh + shift) }
      : pricing.estimate

  const rest: CombinedPricing = { ...pricing }
  delete rest.sections
  return {
    ...rest,
    subtotal,
    ...(rate > 0 && { taxRate: rate, taxLabel: tax.label ?? pricing.taxLabel }),
    taxAmount,
    total,
    ...(estimate && { estimate }),
    ...(next.length > 0 && { sections: next }),
  }
}

/** One service's part of a quote, as it is shown */
export interface DisplaySection {
  /** null for the main service on a quote whose service id is not known to the caller */
  serviceId: string | null
  serviceName: string
  main: boolean
  /** The service's real lines (the minimum top-up is never a line, AD-048) */
  lines: SectionLine[]
  /** That service's own minimum, when it applied */
  minimum: AppliedMinimum | null
  subtotal: number
  addedBy?: 'customer' | 'business'
  /** For the customer only: this part has no price yet (no lines, no subtotal); the business will confirm it */
  awaitingApproval?: boolean
}

/**
 * A combined quote as sections: the main service first, then each added one.
 * Null for a single-service quote, which every renderer shows as it always did.
 */
export function displaySections(
  pricing: Pick<QuotePricing, 'breakdown' | 'subtotal'> | null | undefined,
  main: { serviceId?: string | null; serviceName: string }
): DisplaySection[] | null {
  if (!pricing) return null
  const sections = addedSections(pricing)
  if (sections.length === 0) return null
  const mainSplit = splitMinimum(pricing.breakdown)
  return [
    { serviceId: main.serviceId ?? null, serviceName: main.serviceName, main: true, lines: mainSplit.lines, minimum: mainSplit.minimum, subtotal: mainSubtotal(pricing) },
    ...sections.map((s) => {
      const split = splitMinimum(s.breakdown)
      return { serviceId: s.serviceId, serviceName: s.serviceName, main: false, lines: split.lines, minimum: split.minimum, subtotal: sectionSubtotal(s), addedBy: s.addedBy }
    }),
  ]
}

// ---------------------------------------------------------------------------
// A part the business approves first (its service holds until approved)
// ---------------------------------------------------------------------------

/**
 * Does the customer wait for the business before seeing an added part's
 * price? Only when that part's service, or the quote's main service, is set
 * to hold until approved. The rest of the quote is never hidden again: the
 * customer could only add something because they could already see it.
 */
export function sectionPriceWaits(mainMode: ReviewMode, sectionMode: ReviewMode): boolean {
  return mainMode === 'hold_until_approved' || sectionMode === 'hold_until_approved'
}

/** The added parts whose price the customer does not see yet: marked, on a quote still waiting for the business */
export function sectionsAwaitingApproval(pricing: object | null | undefined, status: string): QuoteSection[] {
  if (status !== 'pending_review') return []
  return addedSections(pricing).filter((s) => s.awaitingApproval === true)
}

/** What the customer reads in place of that part's price */
export function willConfirmLine(businessName: string): string {
  return `${businessName.trim() || 'The business'} will confirm this part`
}

/**
 * The quote's figures as the customer may see them: a part still waiting for
 * the business is left out of the subtotal, the tax and the total, so what
 * they see is the quote as it stood before they added it. `awaiting` lists
 * what was left out. With nothing waiting, the pricing is returned untouched.
 */
export function pricingForCustomer(pricing: CombinedPricing, status: string, tax: SectionTax): { pricing: CombinedPricing; awaiting: QuoteSection[] } {
  const awaiting = sectionsAwaitingApproval(pricing, status)
  if (awaiting.length === 0) return { pricing, awaiting }
  const visible = addedSections(pricing).filter((s) => !awaiting.includes(s))
  return { pricing: withSections(pricing, visible, tax), awaiting }
}

/**
 * The customer's sections: what `pricingForCustomer` left visible, then each
 * waiting part with its name and nothing else (no lines, no subtotal).
 */
export function displaySectionsForCustomer(
  visible: Pick<QuotePricing, 'breakdown' | 'subtotal'>,
  awaiting: readonly QuoteSection[],
  main: { serviceId?: string | null; serviceName: string }
): DisplaySection[] | null {
  const shown = displaySections(visible, main)
  if (awaiting.length === 0) return shown
  const mainSplit = splitMinimum(visible.breakdown)
  const mainOnly: DisplaySection[] = [
    { serviceId: main.serviceId ?? null, serviceName: main.serviceName, main: true, lines: mainSplit.lines, minimum: mainSplit.minimum, subtotal: mainSubtotal(visible) },
  ]
  return [
    ...(shown ?? mainOnly),
    ...awaiting.map((s): DisplaySection => ({ serviceId: s.serviceId, serviceName: s.serviceName, main: false, lines: [], minimum: null, subtotal: 0, addedBy: s.addedBy, awaitingApproval: true })),
  ]
}

/**
 * The lines to store for a section the business saved in the quote editor.
 * AD-048: a section's minimum is a floor on that section. It is never a line
 * the editor can type: while the section's lines total less than its floor,
 * one marked entry tops it up, worked out here from the lines that were sent.
 *
 * - A section already on the quote: the same rule as the main service's lines
 *   (`editedBreakdown`): the stored floor, never the amount the client sent.
 * - A section added in this save: the floor it was priced with (the marked
 *   entry the pricing call returned), with the top-up worked out again.
 */
export function editedSectionBreakdown(before: readonly SectionLine[] | null | undefined, after: readonly SectionLine[]): SectionLine[] {
  if (before) return editedBreakdown(before, after) as SectionLine[]
  const marked = after.find((line) => line.kind === MINIMUM_ENTRY_KIND)
  const lines = after.filter((line) => line.kind !== MINIMUM_ENTRY_KIND)
  const floor = Number(marked?.minimumCharge)
  if (!marked || !(floor > 0)) return lines
  const topUp = minimumTopUp(sum(lines), floor)
  return topUp > 0 ? [...lines, minimumEntry(topUp, floor)] : lines
}

// ---------------------------------------------------------------------------
// What else the customer asked for
// ---------------------------------------------------------------------------

/** Read `content_json.alsoAsked`; anything malformed is left out */
export function alsoAskedOf(content: unknown): AlsoAsked[] {
  const raw = (content as { alsoAsked?: unknown } | null | undefined)?.alsoAsked
  if (!Array.isArray(raw)) return []
  return raw.filter((a): a is AlsoAsked => {
    const item = a as AlsoAsked | null
    return Boolean(item) && typeof item!.id === 'string' && typeof item!.words === 'string' && ['offered', 'added', 'not_offered'].includes(item!.state)
  })
}

/** The list with each offered service's state brought in line with the sections actually on the quote */
export function alsoAskedWithStates(items: readonly AlsoAsked[], sections: readonly Pick<QuoteSection, 'serviceId'>[]): AlsoAsked[] {
  const added = new Set(sections.map((s) => s.serviceId))
  return items.map((item) => {
    if (item.state === 'not_offered' || !item.serviceId) return item
    return { ...item, state: added.has(item.serviceId) ? 'added' : 'offered' }
  })
}

/** What the customer is told about something the business does not offer. Never a price. */
export function notOfferedLine(words: string): string {
  return `We’ll confirm “${words.trim()}” with you separately.`
}

/** The label of a service that needs answers before it can be added */
export function questionsToAddLabel(count: number): string {
  return count === 1 ? 'Answer 1 question to add it' : `Answer ${count} questions to add it`
}

// ---------------------------------------------------------------------------
// Review: the strictest setting among the services on the quote
// ---------------------------------------------------------------------------

const STRICTNESS: Record<ReviewMode, number> = { auto_send: 0, show_then_confirm: 1, hold_until_approved: 2 }

/** A combined quote follows the strictest review setting among its services; it auto-sends only if every one does */
export function strictestReviewMode(modes: readonly ReviewMode[]): ReviewMode {
  return modes.reduce<ReviewMode>((strictest, mode) => (STRICTNESS[mode] > STRICTNESS[strictest] ? mode : strictest), 'auto_send')
}

export interface ReviewState {
  status: string
  reviewHold: ReviewHoldKind | null
  approvedAt: string | null
}

/**
 * What a customer's change (adding a section) does to a quote's review state.
 *
 * - Every service auto-sends: nothing changes.
 * - Otherwise the quote waits for the business, and the customer cannot
 *   accept until it approves. What the customer could already see stays
 *   visible ('shown'): adding something never hides a price they have seen.
 *   A service set to hold until approved hides only its own part
 *   (`sectionPriceWaits`, `awaitingApproval` on the section).
 * - A quote a check already held stays held by that check; 'held' is never
 *   loosened.
 * - A quote the customer has already been sent goes back to waiting: the
 *   business approved a different request. Its earlier state is returned so
 *   it can be restored if the customer removes what they added.
 */
export function reviewAfterAdding(current: ReviewState, modes: readonly ReviewMode[]): { next: ReviewState; changed: boolean } {
  const strictest = strictestReviewMode(modes)
  if (strictest === 'auto_send') return { next: current, changed: false }
  const wanted: ReviewHoldKind = 'shown'
  if (current.status === 'pending_review') {
    // a check's hold is never loosened; 'held' is never loosened to 'shown'
    const keep = current.reviewHold === 'check' || current.reviewHold === 'held'
    const reviewHold = keep ? current.reviewHold : wanted
    return { next: { ...current, reviewHold }, changed: reviewHold !== current.reviewHold }
  }
  return { next: { status: 'pending_review', reviewHold: wanted, approvedAt: null }, changed: true }
}
