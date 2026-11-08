/**
 * Reprice snapshot: the first pass's AI outputs, saved when the quote stops to
 * ask the customer a question, so the reprice after their answer is
 * deterministic (no photos re-read, no AI calls).
 *
 * Stored inside `quotes.signals_json` under `_reprice` (no migration needed).
 * The structured signals themselves are the rest of `signals_json`; the
 * wording is the provisional `content_json` shown with the range.
 */

import type {
  AiUsageSummary,
  CrossServicePricing,
  ExtractedSignalsV2,
  MatchedItem,
  SignalRecommendation,
} from '@estimator/shared'
import type { ExtractedSignals } from './ai/signals'
import type { QuoteContent } from './ai/wording'
import type { StageTimings } from './stage-timer'

export interface RepriceSnapshot {
  version: 1
  legacySignals: ExtractedSignals
  matchedItems: MatchedItem[]
  /** Add-ons the AI applied from the description/photos (auto-recommended) */
  aiDetectedAddonIds: string[]
  aiAddonDetectionRan: boolean
  signalRecommendations: SignalRecommendation[]
  crossServicePricing: CrossServicePricing[]
  /** First-pass validation demanded business review — the reprice honours it */
  validationRequiresReview: boolean
  /** The first pass's AI spend and timings: the reprice adds none, and the
   * quote's AI cost record must survive it */
  firstPass?: { aiUsage: AiUsageSummary; timings: StageTimings }
}

export interface RepriceInputs extends RepriceSnapshot {
  structuredSignals: ExtractedSignalsV2
  content: QuoteContent
}

type SignalsWithSnapshot = ExtractedSignalsV2 & { _reprice?: RepriceSnapshot }

/** signals_json to store: the structured signals plus the snapshot. */
export function withRepriceSnapshot(
  structuredSignals: ExtractedSignalsV2,
  snapshot: RepriceSnapshot
): SignalsWithSnapshot {
  return { ...structuredSignals, _reprice: snapshot }
}

/**
 * Reprice inputs for a quote, or null when the quote must run the full
 * pipeline: no clarification answers yet, or a quote saved before snapshots
 * existed.
 */
export function readRepriceInputs(quote: {
  signals_json?: unknown
  content_json?: unknown
  clarification_answers_json?: unknown[] | null
}): RepriceInputs | null {
  if (!quote.clarification_answers_json?.length) return null
  const stored = quote.signals_json as SignalsWithSnapshot | null | undefined
  const snapshot = stored?._reprice
  const content = quote.content_json as QuoteContent | null | undefined
  if (!stored || snapshot?.version !== 1 || !content || !Array.isArray(stored.signals)) return null

  const structuredSignals: SignalsWithSnapshot = { ...stored }
  delete structuredSignals._reprice
  return {
    ...snapshot,
    // Fresh copies: the processor mutates signals during the form merge
    structuredSignals: structuredClone(structuredSignals) as ExtractedSignalsV2,
    legacySignals: structuredClone(snapshot.legacySignals),
    // The customer has answered: a doubt about a stated quantity is resolved
    content: { ...structuredClone(content), quantityConcern: undefined, quantityConcernFieldId: undefined },
  }
}
