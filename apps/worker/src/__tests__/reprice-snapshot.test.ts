import { describe, it, expect } from 'vitest'
import { readRepriceInputs, withRepriceSnapshot, type RepriceSnapshot } from '../reprice-snapshot'
import type { ExtractedSignalsV2 } from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

const structured: ExtractedSignalsV2 = {
  extractedAt: '2026-11-08T00:00:00Z',
  overallConfidence: 0.85,
  signals: [{ key: 'wall_area_sqft', value: 313, confidence: 0.8, source: 'vision', evidence: 'Senior review', basis: 'adjudicated' }],
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
}

const legacy = { category: 'painting', materials: [], confidence: 0.8 } as unknown as ExtractedSignals

const snapshot: RepriceSnapshot = {
  version: 1,
  legacySignals: legacy,
  matchedItems: [],
  aiDetectedAddonIds: ['addon_masonry'],
  aiAddonDetectionRan: true,
  signalRecommendations: [],
  crossServicePricing: [],
  validationRequiresReview: false,
}

const content = { scopeSummary: 'Front elevation', assumptions: [], exclusions: [], notes: [], validityDays: 30, quantityConcern: '313 sq ft looks low' }
const answered = [{ questionId: 'cq_1', answer: '313' }]

describe('reprice snapshot', () => {
  it('round-trips: signals without the snapshot key, snapshot fields, content', () => {
    const inputs = readRepriceInputs({
      signals_json: withRepriceSnapshot(structured, snapshot),
      content_json: content,
      clarification_answers_json: answered,
    })!
    expect(inputs).not.toBeNull()
    expect('_reprice' in inputs.structuredSignals).toBe(false)
    expect(inputs.structuredSignals.signals[0]!.value).toBe(313)
    expect(inputs.aiDetectedAddonIds).toEqual(['addon_masonry'])
    expect(inputs.content.scopeSummary).toBe('Front elevation')
  })

  it("clears the wording's quantity doubt: the customer has answered (Grade B bug)", () => {
    const inputs = readRepriceInputs({
      signals_json: withRepriceSnapshot(structured, snapshot),
      content_json: content,
      clarification_answers_json: answered,
    })!
    expect(inputs.content.quantityConcern).toBeUndefined()
  })

  it('returns copies: the form merge may mutate signals freely', () => {
    const stored = withRepriceSnapshot(structured, snapshot)
    const inputs = readRepriceInputs({ signals_json: stored, content_json: content, clarification_answers_json: answered })!
    inputs.structuredSignals.signals[0]!.value = 999
    expect(stored.signals[0]!.value).toBe(313)
  })

  it('falls back to the full pipeline without answers or without a snapshot', () => {
    expect(readRepriceInputs({ signals_json: withRepriceSnapshot(structured, snapshot), content_json: content, clarification_answers_json: [] })).toBeNull()
    expect(readRepriceInputs({ signals_json: structured, content_json: content, clarification_answers_json: answered })).toBeNull()
    expect(readRepriceInputs({ signals_json: withRepriceSnapshot(structured, snapshot), content_json: null, clarification_answers_json: answered })).toBeNull()
  })
})
