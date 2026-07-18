/**
 * Tests for Quality Gate Agent
 *
 * Tests send/ask_clarification/require_review decisions,
 * max 2 questions constraint, and re-processing skip after 1 round.
 */

import { describe, it, expect } from 'vitest'
import { evaluateQualityGate } from '../agents/quality-gate'
import type { ExtractedSignalsV2 } from '@estimator/shared'
import type { PricingResult } from '../pricing/rules-engine'
import type { FusedSignals } from '../agents/types'

function makeSignals(overrides: Partial<ExtractedSignalsV2> = {}): ExtractedSignalsV2 {
  return {
    extractedAt: new Date().toISOString(),
    overallConfidence: 0.8,
    signals: [
      { key: 'item_count', value: 5, confidence: 0.9, source: 'form' },
      { key: 'condition_rating', value: 'good', confidence: 0.85, source: 'vision' },
    ],
    complexity: { level: 'medium', factors: ['Standard'] },
    siteVisitRecommended: false,
    lowConfidenceSignals: [],
    ...overrides,
  }
}

function makePricing(overrides: Partial<PricingResult> = {}): PricingResult {
  return {
    currency: 'GBP',
    subtotal: 250,
    taxLabel: 'VAT',
    taxRate: 0.2,
    taxAmount: 50,
    total: 300,
    breakdown: [{ label: 'Service', amount: 250 }],
    confidence: 0.8,
    notes: [],
    ...overrides,
  }
}

function makeFusion(conflicts: FusedSignals['conflicts'] = []): FusedSignals {
  return {
    signals: [],
    conflicts,
  }
}

describe('evaluateQualityGate', () => {
  describe('send: high confidence signals', () => {
    it('should return send for high confidence signals', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals(),
          fusionResult: makeFusion(),
          pricing: makePricing(),
          clarificationCount: 0,
          serviceName: 'Window Cleaning',
          hasPhotos: true,
        },
        null // No gemini — template questions fallback
      )
      expect(result.action).toBe('send')
    })
  })

  describe('require_review: critical issues', () => {
    it('should flag for review when confidence is very low', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals({ overallConfidence: 0.2 }),
          fusionResult: makeFusion(),
          pricing: makePricing(),
          clarificationCount: 0,
          serviceName: 'Window Cleaning',
          hasPhotos: true,
        },
        null
      )
      expect(result.action).toBe('require_review')
      expect(result.reason).toBeDefined()
      expect(result.reason).toContain('confidence')
    })

    it('should flag for review when pricing is zero with work steps', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals(),
          fusionResult: makeFusion(),
          pricing: makePricing({ total: 0, breakdown: [{ label: 'Step', amount: 0 }] }),
          clarificationCount: 0,
          serviceName: 'Window Cleaning',
          hasPhotos: true,
        },
        null
      )
      expect(result.action).toBe('require_review')
    })
  })

  describe('ask_clarification: low-confidence signals', () => {
    it('should request clarification for low-confidence signals', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals({
            lowConfidenceSignals: ['item_count'],
            signals: [
              { key: 'item_count', value: 5, confidence: 0.3, source: 'vision' },
            ],
          }),
          fusionResult: makeFusion(),
          pricing: makePricing(),
          clarificationCount: 0,
          serviceName: 'Window Cleaning',
          hasPhotos: true,
        },
        null // Falls back to template questions
      )
      expect(result.action).toBe('ask_clarification')
      expect(result.questions).toBeDefined()
      expect(result.questions!.length).toBeGreaterThan(0)
      expect(result.questions!.length).toBeLessThanOrEqual(2)
    })

    it('should generate max 2 questions', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals({
            lowConfidenceSignals: ['item_count', 'condition_rating', 'surface_area'],
            signals: [
              { key: 'item_count', value: 5, confidence: 0.3, source: 'vision' },
              { key: 'condition_rating', value: 'fair', confidence: 0.4, source: 'vision' },
              { key: 'surface_area', value: 100, confidence: 0.2, source: 'vision' },
            ],
          }),
          fusionResult: makeFusion(),
          pricing: makePricing(),
          clarificationCount: 0,
          serviceName: 'Driveway Cleaning',
          hasPhotos: true,
        },
        null
      )

      if (result.action === 'ask_clarification') {
        expect(result.questions!.length).toBeLessThanOrEqual(2)
      }
    })
  })

  describe('Re-processing: skip after 1 round', () => {
    it('should skip gate and send when clarificationCount >= 1', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals({
            overallConfidence: 0.2, // Would normally trigger review
            lowConfidenceSignals: ['item_count'],
            signals: [
              { key: 'item_count', value: 5, confidence: 0.3, source: 'vision' },
            ],
          }),
          fusionResult: makeFusion(),
          pricing: makePricing(),
          clarificationCount: 1, // Already had 1 round
          serviceName: 'Window Cleaning',
          hasPhotos: true,
        },
        null
      )
      expect(result.action).toBe('send')
    })
  })

  describe('No photos scenario', () => {
    it('should not flag for review when no photos and low confidence', async () => {
      const result = await evaluateQualityGate(
        {
          structuredSignals: makeSignals({ overallConfidence: 0.2 }),
          fusionResult: makeFusion(),
          pricing: makePricing(),
          clarificationCount: 0,
          serviceName: 'Window Cleaning',
          hasPhotos: false, // No photos — low confidence is expected
        },
        null
      )
      // Should NOT require review when no photos (low confidence is normal)
      expect(result.action).not.toBe('require_review')
    })
  })
})

describe('T-108: confirm_value questions', () => {
  it('should build a deterministic confirm_value question when the AI extracted a value', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: makeSignals({
          signals: [
            {
              key: 'room_count',
              value: 4,
              confidence: 0.4,
              source: 'vision',
              evidence: 'Counted 4 distinct rooms across the photos',
            },
          ],
          lowConfidenceSignals: ['room_count'],
        }),
        fusionResult: makeFusion(),
        pricing: makePricing(),
        clarificationCount: 0,
        serviceName: 'Interior Painting',
        hasPhotos: true,
      },
      null // no Gemini — confirm questions must not need AI
    )

    expect(result.action).toBe('ask_clarification')
    const question = result.questions?.[0]
    expect(question?.type).toBe('confirm_value')
    expect(question?.targetSignalKey).toBe('room_count')
    expect(question?.aiValue).toBe(4)
    expect(question?.evidence).toContain('4 distinct rooms')
    // Question text is code-generated from the value (AD-024), not AI-generated
    expect(question?.question).toContain('room count')
    expect(question?.question).toContain('4')
  })

  it('should fall back to a text question when the signal has no value', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: makeSignals({
          signals: [
            { key: 'access_difficulty', value: '', confidence: 0.3, source: 'vision' },
          ],
          lowConfidenceSignals: ['access_difficulty'],
        }),
        fusionResult: makeFusion(),
        pricing: makePricing(),
        clarificationCount: 0,
        serviceName: 'Interior Painting',
        hasPhotos: true,
      },
      null
    )

    expect(result.action).toBe('ask_clarification')
    const question = result.questions?.[0]
    expect(question?.type).not.toBe('confirm_value')
    expect(question?.targetSignalKey).toBe('access_difficulty')
  })
})

describe('Bug #10: missing quantity signals (found live — 1 sqm exterior quote)', () => {
  it('asks for clarification when an ai_signal quantity is missing, even at high confidence', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: makeSignals({ overallConfidence: 0.83 }), // high — gate would otherwise send
        fusionResult: makeFusion(),
        pricing: makePricing(),
        clarificationCount: 0,
        serviceName: 'Exterior Painting',
        hasPhotos: true,
        missingQuantitySignals: [{ signalKey: 'wall_area_sqm', stepName: 'Exterior walls' }],
      },
      null // must work without Gemini (template question fallback)
    )

    expect(result.action).toBe('ask_clarification')
    const question = result.questions?.find((q) => q.targetSignalKey === 'wall_area_sqm')
    expect(question).toBeDefined()
    // Missing signal has no value — must be a text question, never confirm_value
    expect(question?.type).not.toBe('confirm_value')
  })

  it('does not ask when the quantity signal exists with a usable value', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: makeSignals(),
        fusionResult: makeFusion(),
        pricing: makePricing(),
        clarificationCount: 0,
        serviceName: 'Exterior Painting',
        hasPhotos: true,
        missingQuantitySignals: [], // processor found the signal usable
      },
      null
    )
    expect(result.action).toBe('send')
  })

  it('still respects the one-round clarification cap', async () => {
    const result = await evaluateQualityGate(
      {
        structuredSignals: makeSignals(),
        fusionResult: makeFusion(),
        pricing: makePricing(),
        clarificationCount: 1,
        serviceName: 'Exterior Painting',
        hasPhotos: true,
        missingQuantitySignals: [{ signalKey: 'wall_area_sqm', stepName: 'Exterior walls' }],
      },
      null
    )
    expect(result.action).toBe('send')
  })
})
