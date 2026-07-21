/**
 * Outcome calibration (T-110) — the closed loop from quote outcomes
 * (amendments, acceptances, review load) to per-service pricing suggestions.
 *
 * Everything here is DETERMINISTIC math over stored outcomes. Suggestions are
 * surfaced to the business for approval — nothing auto-changes prices (AD-001).
 * The suggestedAction strings are written to be pasted straight into the
 * plain-language pricing composer (AD-021/AD-024).
 */

export interface CalibrationQuoteInput {
  serviceId: string
  status: string
  total: number
}

export interface CalibrationAmendmentInput {
  serviceId: string
  beforeTotal: number
  afterTotal: number
}

export interface CalibrationSuggestion {
  type: 'raise_rates' | 'lower_rates' | 'price_check' | 'review_burden'
  headline: string
  detail: string
  /** Plain-language instruction the business can use in the pricing composer */
  suggestedAction: string
}

export interface ServiceCalibration {
  serviceId: string
  serviceName: string
  quotesSent: number
  accepted: number
  /** null when below MIN_QUOTES_FOR_RATE */
  acceptanceRatePct: number | null
  amendedCount: number
  /** Median % change business applies before sending; null when below MIN_AMENDMENTS */
  medianDeltaPct: number | null
  suggestions: CalibrationSuggestion[]
}

/** Minimum amendments before a rate-adjustment pattern is trusted */
export const MIN_AMENDMENTS = 3
/** Share of amendments that must move the same direction */
export const MIN_DIRECTION_CONSISTENCY = 0.7
/** Median delta below this is noise, not a pattern */
export const MIN_DELTA_PCT = 5
/** Minimum sent quotes before acceptance-rate signals are trusted */
export const MIN_QUOTES_FOR_RATE = 5
/** Acceptance below this suggests a pricing/scope problem */
export const LOW_ACCEPTANCE_PCT = 30
/** Share of quotes stuck in review that suggests a confidence problem */
export const HIGH_REVIEW_SHARE = 0.5

const SENT_STATUSES = new Set(['sent', 'viewed', 'accepted', 'paid', 'revised'])
const ACCEPTED_STATUSES = new Set(['accepted', 'paid'])
const PROCESSED_STATUSES = new Set([
  'sent',
  'viewed',
  'accepted',
  'paid',
  'revised',
  'pending_review',
])

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

/**
 * Compute calibration stats + suggestions for one service.
 */
export function calibrateService(
  serviceId: string,
  serviceName: string,
  quotes: CalibrationQuoteInput[],
  amendments: CalibrationAmendmentInput[]
): ServiceCalibration {
  const serviceQuotes = quotes.filter((q) => q.serviceId === serviceId)
  const serviceAmendments = amendments.filter(
    (a) => a.serviceId === serviceId && a.beforeTotal > 0
  )

  const sent = serviceQuotes.filter((q) => SENT_STATUSES.has(q.status))
  const accepted = serviceQuotes.filter((q) => ACCEPTED_STATUSES.has(q.status))
  const processed = serviceQuotes.filter((q) => PROCESSED_STATUSES.has(q.status))
  const inReview = serviceQuotes.filter((q) => q.status === 'pending_review')

  const acceptanceRatePct =
    sent.length >= MIN_QUOTES_FOR_RATE
      ? Math.round((accepted.length / sent.length) * 100)
      : null

  const deltas = serviceAmendments.map(
    (a) => ((a.afterTotal - a.beforeTotal) / a.beforeTotal) * 100
  )
  const medianDeltaPct =
    deltas.length >= MIN_AMENDMENTS ? Math.round(median(deltas) * 10) / 10 : null

  const suggestions: CalibrationSuggestion[] = []

  // Rate-adjustment pattern: consistent amendment direction with a real magnitude
  if (medianDeltaPct !== null && Math.abs(medianDeltaPct) >= MIN_DELTA_PCT) {
    const increases = deltas.filter((d) => d > 0).length
    const decreases = deltas.filter((d) => d < 0).length
    const magnitude = Math.abs(Math.round(medianDeltaPct))

    if (increases / deltas.length >= MIN_DIRECTION_CONSISTENCY) {
      suggestions.push({
        type: 'raise_rates',
        headline: `${serviceName} quotes are usually raised ~${magnitude}% before sending`,
        detail: `You adjusted ${increases} of your last ${deltas.length} ${serviceName} quotes upward (median +${magnitude}%). Your configured rates look ~${magnitude}% below what you actually charge.`,
        suggestedAction: `Increase all my rates for ${serviceName} by about ${magnitude}%`,
      })
    } else if (decreases / deltas.length >= MIN_DIRECTION_CONSISTENCY) {
      suggestions.push({
        type: 'lower_rates',
        headline: `${serviceName} quotes are usually reduced ~${magnitude}% before sending`,
        detail: `You adjusted ${decreases} of your last ${deltas.length} ${serviceName} quotes downward (median -${magnitude}%). Your configured rates look ~${magnitude}% above what you actually charge.`,
        suggestedAction: `Decrease all my rates for ${serviceName} by about ${magnitude}%`,
      })
    }
  }

  // Low acceptance without a "rates too high" pattern: worth a price/scope check
  if (
    acceptanceRatePct !== null &&
    acceptanceRatePct < LOW_ACCEPTANCE_PCT &&
    !suggestions.some((s) => s.type === 'lower_rates')
  ) {
    suggestions.push({
      type: 'price_check',
      headline: `Only ${acceptanceRatePct}% of ${serviceName} quotes are accepted`,
      detail: `${accepted.length} of ${sent.length} recent ${serviceName} quotes were accepted. That may mean pricing is above market, or the quote scope isn't convincing customers.`,
      suggestedAction: `Review your ${serviceName} pricing and scope wording — compare a few lost quotes against what competitors charge`,
    })
  }

  // Heavy review load: quotes rarely go out instantly → confidence problem
  if (
    processed.length >= MIN_QUOTES_FOR_RATE &&
    inReview.length / processed.length >= HIGH_REVIEW_SHARE
  ) {
    suggestions.push({
      type: 'review_burden',
      headline: `${Math.round((inReview.length / processed.length) * 100)}% of ${serviceName} quotes need manual review`,
      detail: `Most ${serviceName} quotes are pausing for your review instead of sending instantly — usually a sign the AI lacks reliable inputs.`,
      suggestedAction: `Add required photos or a couple of required customer questions for ${serviceName} so quotes can send instantly`,
    })
  }

  return {
    serviceId,
    serviceName,
    quotesSent: sent.length,
    accepted: accepted.length,
    acceptanceRatePct,
    amendedCount: deltas.length,
    medianDeltaPct,
    suggestions,
  }
}

/**
 * Compute calibration for every service; services with suggestions sort first.
 */
export function computeCalibration(
  services: Array<{ id: string; name: string }>,
  quotes: CalibrationQuoteInput[],
  amendments: CalibrationAmendmentInput[]
): ServiceCalibration[] {
  return services
    .map((s) => calibrateService(s.id, s.name, quotes, amendments))
    .sort((a, b) => b.suggestions.length - a.suggestions.length)
}
