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
