/**
 * Tests for the Triage Agent
 *
 * Tests all 3 classifications (simple/standard/complex),
 * photo strategy, cross-service check, and returning customer detection.
 */

import { describe, it, expect } from 'vitest'
import { classify } from '../agents/triage'
import type { TriageInput } from '../agents/types'

function makeInput(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    photoCount: 0,
    description: '',
    customerEmail: 'test@example.com',
    tenantId: 'tenant-1',
    tenantServiceCount: 1,
    hasOtherServices: false,
    aiSignalWorkStepCount: 0,
    ...overrides,
  }
}

describe('TriageAgent.classify', () => {
  describe('Simple classification', () => {
    it('should classify as simple: 0 photos, short description, single service', () => {
      const result = classify(makeInput({ description: 'Fix door' }), 0)
      expect(result.classification).toBe('simple')
      expect(result.photoStrategy.skipVision).toBe(true)
      expect(result.photoStrategy.maxPhotos).toBe(0)
    })

    it('should classify as simple: empty description', () => {
      const result = classify(makeInput(), 0)
      expect(result.classification).toBe('simple')
    })

    it('should NOT be simple if tenant has multiple services', () => {
      const result = classify(makeInput({ tenantServiceCount: 3 }), 0)
      expect(result.classification).toBe('standard')
    })

    it('should NOT be simple if there are photos', () => {
      const result = classify(makeInput({ photoCount: 1 }), 0)
      expect(result.classification).toBe('standard')
    })

    it('should NOT be simple if description is long', () => {
      const result = classify(makeInput({ description: 'a'.repeat(101) }), 0)
      expect(result.classification).toBe('standard')
    })
  })

  describe('Complex classification', () => {
    it('should classify as complex: 3+ photos', () => {
      const result = classify(makeInput({ photoCount: 3 }), 0)
      expect(result.classification).toBe('complex')
    })

    it('should classify as complex: 5 photos', () => {
      const result = classify(makeInput({ photoCount: 5 }), 0)
      expect(result.classification).toBe('complex')
      expect(result.photoStrategy.maxPhotos).toBe(5)
    })

    it('should classify as complex: long description (>500 chars)', () => {
      const result = classify(makeInput({ description: 'a'.repeat(501) }), 0)
      expect(result.classification).toBe('complex')
    })

    it('should classify as complex: 2+ AI signal work steps', () => {
      const result = classify(makeInput({ aiSignalWorkStepCount: 2 }), 0)
      expect(result.classification).toBe('complex')
    })

    it('should cap photos at 5 for complex requests', () => {
      const result = classify(makeInput({ photoCount: 10 }), 0)
      expect(result.classification).toBe('complex')
      expect(result.photoStrategy.maxPhotos).toBe(5)
    })
  })

  describe('Standard classification', () => {
    it('should classify as standard: 1 photo, multi-service tenant', () => {
      const result = classify(makeInput({ photoCount: 1, tenantServiceCount: 2 }), 0)
      expect(result.classification).toBe('standard')
    })

    it('should classify as standard: 2 photos, medium description', () => {
      const result = classify(makeInput({ photoCount: 2, description: 'a'.repeat(200) }), 0)
      expect(result.classification).toBe('standard')
    })

    it('should analyze all photos when 1-2', () => {
      const result = classify(makeInput({ photoCount: 2, tenantServiceCount: 2 }), 0)
      expect(result.photoStrategy.skipVision).toBe(false)
      expect(result.photoStrategy.maxPhotos).toBe(2)
    })
  })

  describe('Photo strategy', () => {
    it('should skip vision for 0 photos', () => {
      const result = classify(makeInput({ photoCount: 0 }), 0)
      expect(result.photoStrategy.skipVision).toBe(true)
      expect(result.photoStrategy.maxPhotos).toBe(0)
    })

    it('should analyze 1 photo', () => {
      const result = classify(makeInput({ photoCount: 1, tenantServiceCount: 2 }), 0)
      expect(result.photoStrategy.skipVision).toBe(false)
      expect(result.photoStrategy.maxPhotos).toBe(1)
    })

    it('should analyze 2 photos', () => {
      const result = classify(makeInput({ photoCount: 2, tenantServiceCount: 2 }), 0)
      expect(result.photoStrategy.skipVision).toBe(false)
      expect(result.photoStrategy.maxPhotos).toBe(2)
    })

    it('should cap at 5 photos for complex', () => {
      const result = classify(makeInput({ photoCount: 8 }), 0)
      expect(result.photoStrategy.maxPhotos).toBe(5)
    })
  })

  describe('Cross-service check', () => {
    it('should skip cross-service check if no other services', () => {
      const result = classify(makeInput({ hasOtherServices: false, description: 'some work' }), 0)
      expect(result.crossServiceCheck).toBe(false)
    })

    it('should skip cross-service check if description is empty', () => {
      const result = classify(makeInput({ hasOtherServices: true, description: '' }), 0)
      expect(result.crossServiceCheck).toBe(false)
    })

    it('should enable cross-service check if other services + description', () => {
      const result = classify(
        makeInput({ hasOtherServices: true, description: 'Also need window cleaning' }),
        0
      )
      expect(result.crossServiceCheck).toBe(true)
    })
  })

  describe('Returning customer detection', () => {
    it('should detect returning customer (previousQuoteCount > 0)', () => {
      const result = classify(makeInput(), 3)
      expect(result.returningCustomer).toBe(true)
      expect(result.previousQuoteCount).toBe(3)
    })

    it('should detect new customer (previousQuoteCount = 0)', () => {
      const result = classify(makeInput(), 0)
      expect(result.returningCustomer).toBe(false)
      expect(result.previousQuoteCount).toBe(0)
    })
  })

  describe('Reasons logging', () => {
    it('should include reasons for classification', () => {
      const result = classify(makeInput({ photoCount: 5 }), 0)
      expect(result.reasons.length).toBeGreaterThan(0)
      expect(result.reasons.some(r => r.includes('Complex'))).toBe(true)
    })

    it('should include reasons for simple', () => {
      const result = classify(makeInput(), 0)
      expect(result.reasons.some(r => r.includes('Simple'))).toBe(true)
    })
  })
})
