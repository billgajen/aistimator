/**
 * Estimate grading (T-120, Measurement Engine M6) — pure math, no IO.
 *
 * Every quote declares its precision class, the way professional cost
 * engineering does (AACE estimate classes). The grade is computed from how
 * each price-driving quantity was established, and upgrades as evidence
 * improves:
 *
 *   C — Concept:   a driver quantity came from the plausibility envelope or
 *                  carries low measured confidence. Wide honest range.
 *   B — Measured:  all driver quantities measured/adjudicated with acceptable
 *                  agreement, or equipment identified from a nameplate (T-139)
 *                  but not yet confirmed. Tight range.
 *   A — Confirmed: every driver quantity stated or confirmed by a human
 *                  (customer answer or business edit) or scanned on site
 *                  with LiDAR (T-138). Exact price.
 */
import { findConfidenceLanguage } from './customer-language'

export type EstimateGrade = 'A' | 'B' | 'C'

export interface QuantityProvenance {
  signalKey: string
  /**
   * 'defaulted' (T-128, hardcore F6): the quantity fell back to a ×1
   * placeholder (unanswered form field, unresolvable derived formula, legacy
   * fallback) — the line's price is structurally unreliable, not merely
   * uncertain. Caps the grade at C like an envelope-derived quantity.
   */
  /**
   * 'identified' (T-139, AD-029): what the equipment IS was read from a label
   * or nameplate. Ranks like measured (Grade B) until a human confirms it.
   */
  /**
   * T-186: two reasons a price is not confirmed that are not a measurement.
   * 'doubted': a quantity a person typed, which the photos or the description
   * seem to contradict. 'rate': the step's price is a from-price with a
   * stated range. Both rank exactly as 'measured' did in their place (the
   * grade letter is unchanged); they exist so the sentence under the price
   * says what is true.
   */
  basis: 'confirmed' | 'measured' | 'adjudicated' | 'envelope' | 'defaulted' | 'identified' | 'scanned' | 'doubted' | 'rate'
  confidence: number
}

/**
 * T-186: why a price is not confirmed, as the business reads it. Stored with
 * the estimate (`estimate.reasons`), most important first.
 */
export type CertaintyReason =
  /** a typed quantity that the photos or the description seem to contradict */
  | 'doubted'
  /** a quantity nobody gave: the line is priced as one unit for now */
  | 'not_given'
  /** worked out from typical figures, not from this job */
  | 'typical'
  /** measured from the photos, without enough to go on */
  | 'measured_weak'
  /** measured from the photos, and the measurements agree */
  | 'measured'
  /** read from a label or plate in the photos, not confirmed yet */
  | 'label'
  /** a price the business set as a range */
  | 'rate'
  /** a fixed price, with a site visit still recommended */
  | 'site_visit'

const REASON_ORDER: readonly CertaintyReason[] = ['doubted', 'not_given', 'typical', 'measured_weak', 'measured', 'label', 'rate', 'site_visit']

export function isCertaintyReason(value: unknown): value is CertaintyReason {
  return typeof value === 'string' && (REASON_ORDER as readonly string[]).includes(value)
}

/** One plain sentence per reason. None uses a word the customer-language rules ban (a unit test holds each). */
const REASON_SENTENCE: Record<CertaintyReason, string> = {
  doubted: 'A quantity that was typed in does not seem to match the photos or the description. Check it before you send the price.',
  not_given: 'A quantity was not given, so one line is priced as a single unit for now. Give the quantity to set the price.',
  typical: 'This is worked out from typical figures for a property like this one. Confirm the details to narrow the price.',
  measured_weak: 'The photos did not show enough to measure well. Confirm the quantities to narrow the price.',
  measured: 'This price uses quantities measured from the photos, and the measurements agree. Confirm them before work starts.',
  label: 'This price uses what was read from a label in the photos. Confirm it before work starts.',
  rate: 'One of your prices is set as a range, so the final figure can move within it.',
  site_visit: 'Standard price from your rates. A site visit confirms the details before work starts, so the final price may change.',
}

/** The short label beside the grade mark, by the reason that decided it */
const REASON_LABEL: Record<CertaintyReason, string> = {
  doubted: 'To check',
  not_given: 'Quantity missing',
  typical: 'Concept',
  measured_weak: 'Concept',
  measured: 'Measured',
  label: 'Read from a label',
  rate: 'Price range',
  site_visit: 'Provisional',
}

const SENTENCE_GIVEN = 'Every quantity this price depends on was given or confirmed.'
const SENTENCE_GIVEN_OR_SCANNED = 'Every quantity this price depends on was given, confirmed or scanned on site.'
/** For a quote priced before the reasons were stored, when its own lines show nothing was measured */
const SENTENCE_UNCONFIRMED = 'Not every quantity behind this price is confirmed yet. Confirm them before work starts.'

/** The reason one quantity gives, or null when it is confirmed */
function reasonOf(q: QuantityProvenance): CertaintyReason | null {
  if (q.basis === 'confirmed' || q.basis === 'scanned') return null
  if (q.basis === 'doubted') return 'doubted'
  if (q.basis === 'rate') return 'rate'
  if (q.basis === 'defaulted') return 'not_given'
  if (q.basis === 'envelope') return 'typical'
  if (q.confidence < GRADE_B_MIN_CONFIDENCE) return 'measured_weak'
  return q.basis === 'identified' ? 'label' : 'measured'
}

/** Why a price is not confirmed, most important first, each once. Empty when every quantity is confirmed. */
export function certaintyReasons(quantities: QuantityProvenance[]): CertaintyReason[] {
  const found = new Set<CertaintyReason>()
  for (const q of quantities) {
    const reason = reasonOf(q)
    if (reason) found.add(reason)
  }
  return REASON_ORDER.filter((reason) => found.has(reason))
}

export interface EstimateGradeResult {
  grade: EstimateGrade
  label: string
  /** One plain sentence for the business about how sure the price is */
  description: string
  /** T-186: why it is not confirmed, most important first; empty when it is */
  reasons?: CertaintyReason[]
}

/**
 * T-185, T-186: how sure the price is, in one plain sentence for the
 * business. None uses a word the customer-language rules ban ("exact",
 * "firm", "preliminary", "guaranteed"); a unit test holds each against
 * `findConfidenceLanguage`.
 *
 * T-186: the sentence is chosen by what is true of the quantities, not by
 * the grade letter. Before, every Grade B read "measured from the photos",
 * also when nothing was measured: a typed quantity the photos seemed to
 * contradict, or a price set as a range, was graded B by being entered as a
 * measurement. The letter still comes out the same; the reason is now kept.
 */
const GRADE_META: Record<EstimateGrade, { label: string; description: string }> = {
  A: { label: 'Confirmed', description: SENTENCE_GIVEN },
  B: { label: REASON_LABEL.measured, description: REASON_SENTENCE.measured },
  C: { label: REASON_LABEL.typical, description: REASON_SENTENCE.typical },
}

/** The label and sentence for a grade and the reasons behind it */
export function certaintyWords(grade: EstimateGrade, reasons: readonly CertaintyReason[], opts: { scanned?: boolean } = {}): { label: string; description: string } {
  const first = reasons[0]
  if (first) return { label: REASON_LABEL[first], description: REASON_SENTENCE[first] }
  if (grade === 'A') return { label: GRADE_META.A.label, description: opts.scanned ? SENTENCE_GIVEN_OR_SCANNED : SENTENCE_GIVEN }
  return GRADE_META[grade]
}

/** Do the stored words claim a measurement from photos? */
const CLAIMS_PHOTOS = /measured from (the|your) photos/i

/**
 * The sentence shown to the business under a price (the dashboard's quote
 * page and the on-site app), from one place:
 *   1. a quote that carries its reasons (T-186) gets the sentence for them;
 *   2. otherwise the one stored with the quote, unless it uses a banned word
 *      or a dash (written before T-185), or the quote itself proves it wrong:
 *      it says "measured from the photos" and `measuredOnQuote` is false,
 *      meaning no line of the quote was measured. Then the sentence for the
 *      level is shown, without a claim about photos.
 * Null when there is nothing to say.
 */
export function certaintySentence(
  estimate: { grade?: string | null; description?: string | null; reasons?: unknown } | null | undefined,
  opts: { measuredOnQuote?: boolean } = {}
): string | null {
  if (!estimate) return null
  const grade = estimate.grade as EstimateGrade
  if (Array.isArray(estimate.reasons) && GRADE_META[grade]) {
    return certaintyWords(grade, estimate.reasons.filter(isCertaintyReason)).description
  }
  const stored = (estimate.description ?? '').trim()
  const plain = stored !== '' && findConfidenceLanguage(stored).length === 0 && !/[—–]/.test(stored)
  const meta = GRADE_META[grade]
  const sentence = plain ? stored : meta ? meta.description : null
  if (sentence && opts.measuredOnQuote === false && CLAIMS_PHOTOS.test(sentence)) return SENTENCE_UNCONFIRMED
  return sentence
}

/** The short label beside the grade mark, by the same rule as the sentence */
export function certaintyLabel(
  estimate: { grade?: string | null; label?: string | null; reasons?: unknown } | null | undefined,
  opts: { measuredOnQuote?: boolean } = {}
): string | null {
  if (!estimate) return null
  const grade = estimate.grade as EstimateGrade
  if (Array.isArray(estimate.reasons) && GRADE_META[grade]) {
    return certaintyWords(grade, estimate.reasons.filter(isCertaintyReason)).label
  }
  const stored = (estimate.label ?? '').trim()
  if (opts.measuredOnQuote === false && stored === REASON_LABEL.measured) return 'Not confirmed'
  return stored || null
}

/** Minimum measured confidence for a quantity to support Grade B */
export const GRADE_B_MIN_CONFIDENCE = 0.6

/**
 * Compute the declared grade from quantity provenance.
 * No AI-measured quantities at all (fixed/form-driven pricing) → Grade A:
 * the customer stated every driver.
 */
export function computeEstimateGrade(quantities: QuantityProvenance[]): EstimateGradeResult {
  let grade: EstimateGrade = 'A'

  for (const q of quantities) {
    // T-138 (AD-028): a LiDAR scan taken on site is measured ground truth
    if (q.basis === 'confirmed' || q.basis === 'scanned') continue
    if (q.basis === 'envelope' || q.basis === 'defaulted' || q.confidence < GRADE_B_MIN_CONFIDENCE) {
      grade = 'C'
      break
    }
    // measured / adjudicated / identified / doubted / rate with acceptable confidence
    if (grade === 'A') grade = 'B'
  }

  const reasons = certaintyReasons(quantities)
  return { grade, ...certaintyWords(grade, reasons, { scanned: quantities.some((q) => q.basis === 'scanned') }), reasons }
}

/**
 * Does any line of the price depend on a fact about THIS job (a quantity, a
 * triggered step, a selected add-on, a multiplier, a measurement)? False when
 * every line is a fixed amount that would be charged on any job.
 */
export function priceDependsOnJobFacts(
  trace: Array<{ type: string; id?: string; signalsUsed?: Array<{ key: string }>; quantitySource?: string }>,
  /**
   * The service's work steps. A priced step chosen by a form answer (`when`)
   * or an identified value (`triggerSignal`) depends on a job fact even
   * though its trace line carries no signals (live T-146 check: a garage door
   * picked by "Door size").
   */
  workSteps: Array<{ id: string; when?: unknown; triggerSignal?: string }> = []
): boolean {
  const conditional = new Set(workSteps.filter((w) => w.when || w.triggerSignal).map((w) => w.id))
  return trace.some((t) => {
    if (t.type === 'addon' || t.type === 'multiplier' || t.type === 'inventory' || t.type === 'measurement') return true
    if (t.type !== 'work_step') return false
    if (t.id && conditional.has(t.id)) return true
    if (t.quantitySource && t.quantitySource !== 'constant') return true
    return (t.signalsUsed ?? []).some((u) => u.key !== 'constant')
  })
}

/** Grade B shown when a flat-rate price still needs a site visit (not "measured from photos") */
export const FLAT_RATE_SITE_VISIT_GRADE: EstimateGradeResult = {
  grade: 'B',
  label: REASON_LABEL.site_visit,
  description: REASON_SENTENCE.site_visit,
  reasons: ['site_visit'],
}

/**
 * Grade A means the price-driving facts were confirmed. A price made only of
 * fixed amounts confirms nothing about the job, so when the assessment says a
 * site visit is still needed it cannot claim "exact": cap at B. A flat-rate
 * job with no site visit needed keeps A (the price really is the price).
 */
export function capFlatRateGrade(
  current: EstimateGradeResult,
  opts: { priceDependsOnJobFacts: boolean; siteVisitRecommended: boolean }
): EstimateGradeResult {
  if (current.grade !== 'A' || opts.priceDependsOnJobFacts || !opts.siteVisitRecommended) return current
  return FLAT_RATE_SITE_VISIT_GRADE
}

/**
 * T-121 (M7) — value-of-information: is this quantity's uncertainty worth a
 * customer question? Ask when the money at stake clears the bar, not when an
 * abstract confidence threshold trips.
 */
export function isQuestionWorthAsking(opts: {
  /** Total price at the quantity's band low */
  priceAtLow: number
  /** Total price at the quantity's band high */
  priceAtHigh: number
  /** The best-estimate total */
  bestTotal: number
  /** Minimum absolute spread worth a question (currency units) */
  minAbsoluteSpread?: number
  /** Minimum spread as a fraction of the total */
  minRelativeSpread?: number
}): { ask: boolean; spread: number } {
  const spread = Math.abs(opts.priceAtHigh - opts.priceAtLow)
  const minAbsolute = opts.minAbsoluteSpread ?? 75
  const minRelative = opts.minRelativeSpread ?? 0.1
  const bar = Math.max(minAbsolute, opts.bestTotal * minRelative)
  return { ask: spread >= bar, spread: Math.round(spread * 100) / 100 }
}
