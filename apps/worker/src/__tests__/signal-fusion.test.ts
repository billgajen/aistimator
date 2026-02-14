/**
 * Tests for Signal Fusion with Provenance
 *
 * Tests provenance tracking, conflict recording, form overrides (AD-007),
 * access overrides from description (FIX-8), and no-photo scenarios.
 */

import { describe, it, expect } from 'vitest'
import { createSignalFusionRecorder, initializeFusionFromStructuredSignals } from '../agents/signal-fusion'
import type { ExtractedSignalsV2 } from '@estimator/shared'

describe('SignalFusionRecorder', () => {
  describe('recordVisionSignals', () => {
    it('should capture initial vision signals with provenance', () => {
      const recorder = createSignalFusionRecorder()
      recorder.recordVisionSignals([
        { key: 'item_count', value: 5, confidence: 0.8, source: 'vision', evidence: 'Counted 5 items' },
        { key: 'condition_rating', value: 'fair', confidence: 0.7, source: 'vision' },
      ])

      const result = recorder.finalize()
      expect(result.signals).toHaveLength(2)
      expect(result.conflicts).toHaveLength(0)

      const itemCount = result.signals.find(s => s.key === 'item_count')
      expect(itemCount).toBeDefined()
      expect(itemCount!.value).toBe(5)
      expect(itemCount!.confidence).toBe(0.8)
      expect(itemCount!.source).toBe('vision')
      expect(itemCount!.evidence).toBe('Counted 5 items')
    })
  })

  describe('Form override (AD-007)', () => {
    it('should record conflict when form overrides vision', () => {
      const recorder = createSignalFusionRecorder()
      recorder.recordVisionSignals([
        { key: 'item_count', value: 5, confidence: 0.8, source: 'vision', evidence: 'Counted 5 items' },
      ])

      recorder.recordFormOverride(
        'item_count',
        3,
        'Customer-provided: Number of items',
        { key: 'item_count', value: 5, confidence: 0.8, source: 'vision', evidence: 'Counted 5 items' }
      )

      const result = recorder.finalize()

      // Signal should now be from form
      const itemCount = result.signals.find(s => s.key === 'item_count')
      expect(itemCount!.value).toBe(3)
      expect(itemCount!.confidence).toBe(1.0)
      expect(itemCount!.source).toBe('form')
      expect(itemCount!.overrideReason).toContain('vision')
      expect(itemCount!.overrideReason).toContain('5')

      // Conflict should be recorded
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.key).toBe('item_count')
      expect(result.conflicts[0]!.formValue).toBe(3)
      expect(result.conflicts[0]!.visionValue).toBe(5)
      expect(result.conflicts[0]!.resolvedSource).toBe('form')
      expect(result.conflicts[0]!.resolution).toContain('AD-007')
    })

    it('should not record conflict when overriding another form signal', () => {
      const recorder = createSignalFusionRecorder()
      recorder.recordFormOverride(
        'item_count',
        3,
        'Customer-provided: Number of items',
        { key: 'item_count', value: 2, confidence: 1.0, source: 'form', evidence: 'Old form input' }
      )

      const result = recorder.finalize()
      expect(result.conflicts).toHaveLength(0) // No conflict: form→form isn't a source disagreement
    })
  })

  describe('New form signal (no prior AI signal)', () => {
    it('should record new form signal without conflict', () => {
      const recorder = createSignalFusionRecorder()
      recorder.recordNewFormSignal('property_type', 'detached', 'Customer-provided: Property Type')

      const result = recorder.finalize()
      expect(result.signals).toHaveLength(1)
      expect(result.conflicts).toHaveLength(0)

      const signal = result.signals[0]!
      expect(signal.key).toBe('property_type')
      expect(signal.value).toBe('detached')
      expect(signal.confidence).toBe(1.0)
      expect(signal.source).toBe('form')
    })
  })

  describe('Text override (FIX-8: access override from description)', () => {
    it('should record conflict when text overrides vision', () => {
      const recorder = createSignalFusionRecorder()
      recorder.recordVisionSignals([
        { key: 'access_difficulty', value: 'difficult', confidence: 0.7, source: 'vision' },
      ])

      recorder.recordTextOverride(
        'access_difficulty',
        'easy',
        'easy access to front of property',
        { key: 'access_difficulty', value: 'difficult', confidence: 0.7, source: 'vision' }
      )

      const result = recorder.finalize()

      const signal = result.signals.find(s => s.key === 'access_difficulty')
      expect(signal!.value).toBe('easy')
      expect(signal!.source).toBe('text')
      expect(signal!.confidence).toBe(1.0)
      expect(signal!.overrideReason).toContain('vision')

      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0]!.resolvedSource).toBe('text')
      expect(result.conflicts[0]!.resolution).toContain('FIX-8')
    })
  })

  describe('No-photo scenario', () => {
    it('should handle all signals from form (no vision signals)', () => {
      const recorder = createSignalFusionRecorder()
      // No vision signals recorded — starts empty
      recorder.recordNewFormSignal('property_type', 'flat', 'Customer-provided: Property Type')
      recorder.recordNewFormSignal('bedrooms', 2, 'Customer-provided: Number of bedrooms')

      const result = recorder.finalize()
      expect(result.signals).toHaveLength(2)
      expect(result.conflicts).toHaveLength(0)
      expect(result.signals.every(s => s.source === 'form')).toBe(true)
    })
  })

  describe('initializeFusionFromStructuredSignals', () => {
    it('should initialize from ExtractedSignalsV2', () => {
      const structuredSignals: ExtractedSignalsV2 = {
        extractedAt: new Date().toISOString(),
        overallConfidence: 0.75,
        signals: [
          { key: 'item_count', value: 5, confidence: 0.8, source: 'vision', evidence: 'Counted 5 items' },
          { key: 'condition_rating', value: 'good', confidence: 0.9, source: 'vision' },
        ],
        complexity: { level: 'medium', factors: ['Multiple items'] },
        siteVisitRecommended: false,
        lowConfidenceSignals: [],
      }

      const recorder = initializeFusionFromStructuredSignals(structuredSignals)
      const result = recorder.finalize()

      expect(result.signals).toHaveLength(2)
      expect(result.signals.find(s => s.key === 'item_count')!.source).toBe('vision')
      expect(result.signals.find(s => s.key === 'condition_rating')!.source).toBe('vision')
    })
  })

  describe('Multiple conflicts', () => {
    it('should record multiple conflicts from different sources', () => {
      const recorder = createSignalFusionRecorder()
      recorder.recordVisionSignals([
        { key: 'item_count', value: 5, confidence: 0.8, source: 'vision' },
        { key: 'condition_rating', value: 'poor', confidence: 0.6, source: 'vision' },
        { key: 'access_difficulty', value: 'difficult', confidence: 0.7, source: 'vision' },
      ])

      // Form overrides item_count
      recorder.recordFormOverride('item_count', 3, 'Customer says 3', {
        key: 'item_count', value: 5, confidence: 0.8, source: 'vision',
      })

      // Form overrides condition
      recorder.recordFormOverride('condition_rating', 'good', 'Customer says good', {
        key: 'condition_rating', value: 'poor', confidence: 0.6, source: 'vision',
      })

      // Text overrides access
      recorder.recordTextOverride('access_difficulty', 'easy', 'easy access', {
        key: 'access_difficulty', value: 'difficult', confidence: 0.7, source: 'vision',
      })

      const result = recorder.finalize()
      expect(result.conflicts).toHaveLength(3)
      expect(result.signals.find(s => s.key === 'item_count')!.value).toBe(3)
      expect(result.signals.find(s => s.key === 'condition_rating')!.value).toBe('good')
      expect(result.signals.find(s => s.key === 'access_difficulty')!.value).toBe('easy')
    })
  })
})
