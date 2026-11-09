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
  basis: 'confirmed' | 'measured' | 'adjudicated' | 'envelope' | 'defaulted' | 'identified' | 'scanned'
  confidence: number
}

export interface EstimateGradeResult {
  grade: EstimateGrade
  label: string
  /** One-line customer-facing meaning */
  description: string
}

const GRADE_META: Record<EstimateGrade, { label: string; description: string }> = {
  A: {
    label: 'Confirmed',
    description: 'All price-driving quantities were provided or confirmed — this price is exact.',
  },
  B: {
    label: 'Measured',
    description: 'Quantities were measured from your photos with good agreement — final price confirmed before work starts.',
  },
  C: {
    label: 'Concept',
    description: 'Based on typical figures for a property like yours — confirm the details to tighten this estimate.',
  },
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
    // measured / adjudicated / identified with acceptable confidence
    if (grade === 'A') grade = 'B'
  }

  return { grade, ...GRADE_META[grade] }
}

/**
 * Does any line of the price depend on a fact about THIS job (a quantity, a
 * triggered step, a selected add-on, a multiplier, a measurement)? False when
 * every line is a fixed amount that would be charged on any job.
 */
export function priceDependsOnJobFacts(
  trace: Array<{ type: string; signalsUsed?: Array<{ key: string }>; quantitySource?: string }>
): boolean {
  return trace.some((t) => {
    if (t.type === 'addon' || t.type === 'multiplier' || t.type === 'inventory' || t.type === 'measurement') return true
    if (t.type !== 'work_step') return false
    if (t.quantitySource && t.quantitySource !== 'constant') return true
    return (t.signalsUsed ?? []).some((u) => u.key !== 'constant')
  })
}

/** Grade B shown when a flat-rate price still needs a site visit (not "measured from photos") */
export const FLAT_RATE_SITE_VISIT_GRADE: EstimateGradeResult = {
  grade: 'B',
  label: 'Provisional',
  description:
    'Standard price from the business’s rates. A site visit confirms the details before work starts, so the final price may change.',
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
