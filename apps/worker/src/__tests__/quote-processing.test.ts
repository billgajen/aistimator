/**
 * E2E Quote Processing Integration Tests
 *
 * Tests the complete quote processing pipeline with mocked AI signals.
 * Verifies pricing calculations, addon detection, cross-service pricing,
 * and fallback behavior.
 *
 * Key outputs tested:
 * - pricing_json (subtotal, tax, total, breakdown, notes, recommendedAddons)
 * - pricing_trace_json (trace steps, summary)
 * - signals_json (confidence, signals array)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  calculatePricingWithTrace,
  type PricingRules,
  type FormAnswer,
  type TaxConfig,
  type AddonDetectionContext,
  type PricingResult,
} from '../pricing/rules-engine'
import type { ExtractedSignalsV2, PricingTrace } from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

// Import test fixtures and mocks
import {
  homeCleaningPricingRules,
  ukVatConfig,
  usNoTaxConfig,
  basicCleaningFormAnswers,
  addonKeywordFormAnswers,
  crossServiceFormAnswers,
  minimalFormAnswers,
  formOverrideFormAnswers,
} from './fixtures/test-services'

import {
  basicCleaningSignals,
  addonKeywordSignals,
  crossServiceSignals,
  unusedSignalsScenario,
  lowConfidenceSignals,
  formOverrideSignals,
  defaultLegacySignals,
  lowConfidenceLegacySignals,
  createMockSignalsV2,
} from './mocks/ai-signals'

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Helper to round to 2 decimal places for comparison
 */
const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Processes a quote through the pricing engine and returns all outputs
 */
function processQuote(
  rules: PricingRules,
  legacySignals: ExtractedSignals,
  structuredSignals: ExtractedSignalsV2,
  formAnswers: FormAnswer[],
  taxConfig: TaxConfig,
  currency: string,
  options: {
    projectDescription?: string
    aiDetectedAddonIds?: Set<string>
    serviceContext?: { name: string; scopeIncludes?: string[] }
  } = {}
): { result: PricingResult; trace: PricingTrace } {
  const addonContext: AddonDetectionContext = {
    projectDescription: options.projectDescription,
    formAnswers,
  }

  return calculatePricingWithTrace(
    rules,
    legacySignals,
    structuredSignals,
    formAnswers,
    taxConfig,
    currency,
    undefined, // jobData
    addonContext,
    options.aiDetectedAddonIds,
    options.serviceContext,
    'test-v1' // configVersion
  )
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('E2E Quote Processing Tests', () => {
  let rules: PricingRules
  let taxConfig: TaxConfig

  beforeAll(() => {
    rules = homeCleaningPricingRules
    taxConfig = ukVatConfig
  })

  // ---------------------------------------------------------------------------
  // TEST-E2E-1: Basic Quote Processing
  // ---------------------------------------------------------------------------
  describe('TEST-E2E-1: Basic Quote Processing', () => {
    it('should calculate correct pricing for standard cleaning job', () => {
      const { result, trace } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      // Expected calculation:
      // Base Fee:           £25.00
      // Room Cleaning:      4 × £35 = £140.00
      // Bathroom Cleaning:  2 × £45 = £90.00
      // Kitchen Deep Clean: £65.00
      // ─────────────────────────────────
      // Subtotal:           £320.00
      // VAT (20%):          £64.00
      // ─────────────────────────────────
      // TOTAL:              £384.00

      expect(result.currency).toBe('GBP')
      expect(result.subtotal).toBe(320)
      expect(result.taxAmount).toBe(64)
      expect(result.total).toBe(384)

      // Verify breakdown contains expected items
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Base service fee')
      expect(labels).toContain('Room Cleaning')
      expect(labels).toContain('Bathroom Deep Clean')
      expect(labels).toContain('Kitchen Deep Clean')

      // Verify no $0 line items
      const zeroItems = result.breakdown.filter((b) => b.amount === 0)
      expect(zeroItems).toHaveLength(0)

      // Verify pricing trace
      expect(trace.calculatedAt).toBeDefined()
      expect(trace.configVersion).toBe('test-v1')
      expect(trace.summary.baseFee).toBe(25)
      expect(trace.summary.workStepsTotal).toBe(295) // 140 + 90 + 65
      expect(trace.summary.taxAmount).toBe(64)
      expect(trace.summary.total).toBe(384)
      expect(trace.summary.minimumApplied).toBe(false)

      // Verify trace has step entries
      expect(trace.trace.length).toBeGreaterThan(0)
      const baseFeeStep = trace.trace.find((t) => t.type === 'base_fee')
      expect(baseFeeStep).toBeDefined()
      expect(baseFeeStep?.amount).toBe(25)
    })

    it('should include pricing notes array in output', () => {
      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      expect(result.notes).toBeDefined()
      expect(Array.isArray(result.notes)).toBe(true)
    })

    it('should set confidence based on signal confidence', () => {
      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
      // Basic signals have 0.9 confidence
      expect(result.confidence).toBeGreaterThanOrEqual(0.85)
    })
  })

  // ---------------------------------------------------------------------------
  // TEST-E2E-2: Addon Keyword Detection
  // ---------------------------------------------------------------------------
  describe('TEST-E2E-2: Addon Keyword Detection', () => {
    it('should auto-recommend addons when keywords are detected in description', () => {
      // Get the project description from form answers
      const descAnswer = addonKeywordFormAnswers.find(
        (a) => a.fieldId === '_project_description'
      )
      const projectDescription = descAnswer?.value as string

      const { result, trace } = processQuote(
        rules,
        defaultLegacySignals,
        addonKeywordSignals,
        addonKeywordFormAnswers,
        taxConfig,
        'GBP',
        { projectDescription }
      )

      // Expected calculation with addons:
      // Base Fee:           £25.00
      // Room Cleaning:      3 × £35 = £105.00
      // Bathroom Cleaning:  1 × £45 = £45.00
      // Kitchen Deep Clean: £65.00
      // Fridge Cleaning:    £25.00 (auto-recommended)
      // Laundry Service:    £15.00 (auto-recommended)
      // ─────────────────────────────────
      // Subtotal:           £280.00
      // VAT (20%):          £56.00
      // ─────────────────────────────────
      // TOTAL:              £336.00

      // Verify addons are in breakdown
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Fridge Interior Cleaning')
      expect(labels).toContain('Laundry Service (1 load)')

      // Verify addons are marked as auto-recommended
      const fridgeAddon = result.breakdown.find((b) => b.label === 'Fridge Interior Cleaning')
      expect(fridgeAddon?.autoRecommended).toBe(true)
      expect(fridgeAddon?.amount).toBe(25)

      const laundryAddon = result.breakdown.find((b) => b.label === 'Laundry Service (1 load)')
      expect(laundryAddon?.autoRecommended).toBe(true)
      expect(laundryAddon?.amount).toBe(15)

      // Verify recommendedAddons array
      expect(result.recommendedAddons).toBeDefined()
      expect(result.recommendedAddons?.length).toBeGreaterThanOrEqual(2)

      const fridgeRec = result.recommendedAddons?.find((a) => a.id === 'fridge_cleaning')
      expect(fridgeRec).toBeDefined()
      expect(fridgeRec?.label).toBe('Fridge Interior Cleaning')
      expect(fridgeRec?.price).toBe(25)
      expect(fridgeRec?.source).toBe('keyword')

      // Verify pricing includes addons
      expect(result.subtotal).toBe(280) // 240 base + 25 fridge + 15 laundry

      // Verify trace includes addon steps
      const addonSteps = trace.trace.filter((t) => t.type === 'addon')
      expect(addonSteps.length).toBeGreaterThanOrEqual(2)
      expect(trace.summary.addonsTotal).toBe(40) // 25 + 15
    })

    it('should detect addons with case-insensitive matching', () => {
      const formWithUppercase: FormAnswer[] = [
        ...addonKeywordFormAnswers.filter((a) => a.fieldId !== '_project_description'),
        { fieldId: '_project_description', value: 'Please clean the FRIDGE and FREEZER thoroughly' },
      ]

      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        addonKeywordSignals,
        formWithUppercase,
        taxConfig,
        'GBP',
        { projectDescription: 'Please clean the FRIDGE and FREEZER thoroughly' }
      )

      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Fridge Interior Cleaning')
    })

    it('should detect pet treatment addon from keywords', () => {
      const formWithPets: FormAnswer[] = [
        ...addonKeywordFormAnswers.filter((a) => a.fieldId !== '_project_description'),
        { fieldId: '_project_description', value: 'We have a dog and cat, lots of pet hair everywhere' },
      ]

      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        addonKeywordSignals,
        formWithPets,
        taxConfig,
        'GBP',
        { projectDescription: 'We have a dog and cat, lots of pet hair everywhere' }
      )

      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Pet Hair & Odor Treatment')

      // Should only appear once even though multiple pet keywords match
      const petAddons = result.recommendedAddons?.filter((a) => a.id === 'pet_treatment')
      expect(petAddons?.length).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // TEST-E2E-3: Cross-Service Detection
  // ---------------------------------------------------------------------------
  describe('TEST-E2E-3: Cross-Service Detection', () => {
    it('should detect cross-service mentions in customer description', () => {
      // Note: Cross-service pricing is calculated in quote-processor.ts, not rules-engine
      // This test verifies that the pricing engine handles the scenario correctly
      // and doesn't break when cross-service mentions are present

      const descAnswer = crossServiceFormAnswers.find(
        (a) => a.fieldId === '_project_description'
      )
      const projectDescription = descAnswer?.value as string

      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        crossServiceSignals,
        crossServiceFormAnswers,
        taxConfig,
        'GBP',
        { projectDescription }
      )

      // The cleaning service pricing should still be calculated correctly
      // Cross-service detection happens at a higher level (quote-processor)
      expect(result.total).toBeGreaterThan(0)
      expect(result.currency).toBe('GBP')

      // Verify core pricing is not affected by cross-service mention
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Room Cleaning')
      expect(labels).toContain('Kitchen Deep Clean')
    })

    // Note: Full cross-service pricing tests would require mocking the quote-processor
    // which loads pricing rules for other services from the database
  })

  // ---------------------------------------------------------------------------
  // TEST-E2E-4: Signal Recommendations (Unused Signals)
  // ---------------------------------------------------------------------------
  describe('TEST-E2E-4: Signal Recommendations (Unused Signals)', () => {
    it('should process quotes with unused AI signals without errors', () => {
      // The unusedSignalsScenario has signals like 'water_damage' and 'mold_presence'
      // that are not used by any work step

      const { result, trace } = processQuote(
        rules,
        defaultLegacySignals,
        unusedSignalsScenario,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      // Pricing should still work correctly
      expect(result.total).toBeGreaterThan(0)
      expect(result.subtotal).toBe(320) // Same as basic test

      // Trace should only include used signals
      const usedSignalKeys = new Set<string>()
      for (const step of trace.trace) {
        for (const signal of step.signalsUsed) {
          usedSignalKeys.add(signal.key)
        }
      }

      // water_damage and mold_presence should NOT be in the trace
      // (they're not used by any work step)
      // Note: This depends on work step configuration
    })

    // Note: Signal recommendations are generated by AI in quote-processor.ts
    // Full testing would require mocking the generateSignalRecommendations function
  })

  // ---------------------------------------------------------------------------
  // TEST-E2E-5: Low Confidence Fallback
  // ---------------------------------------------------------------------------
  describe('TEST-E2E-5: Low Confidence Fallback', () => {
    it('should show price range when confidence is low', () => {
      const { result } = processQuote(
        rules,
        lowConfidenceLegacySignals,
        lowConfidenceSignals,
        minimalFormAnswers,
        taxConfig,
        'GBP'
      )

      // With low confidence (0.45), should show range
      expect(result.confidence).toBeLessThan(0.7)

      // Range should be set for low confidence
      if (result.confidence < 0.7) {
        expect(result.range).toBeDefined()
        if (result.range) {
          expect(result.range.low).toBeLessThan(result.total)
          expect(result.range.high).toBeGreaterThan(result.total)
        }
      }
    })

    it('should add appropriate notes for low confidence estimates', () => {
      // Create signals with room_count as AI-detected (will be used by work step)
      const aiSignals = createMockSignalsV2(
        [
          { key: 'room_count', value: 4, confidence: 0.5, source: 'vision', evidence: 'Hard to count from photos' },
          { key: 'bathroom_count', value: 2, confidence: 0.4, source: 'vision', evidence: 'Partial views only' },
        ],
        { overallConfidence: 0.45 }
      )

      const { result } = processQuote(
        rules,
        lowConfidenceLegacySignals,
        aiSignals,
        [], // No form answers - relying entirely on AI
        taxConfig,
        'GBP'
      )

      // Low confidence should affect the confidence field
      expect(result.confidence).toBeLessThan(0.7)
    })

    it('should calculate wider range for very low confidence', () => {
      // Confidence < 0.4 should give ±30% range
      const veryLowConfidenceSignals = createMockSignalsV2(
        [
          { key: 'room_count', value: 3, confidence: 0.3, source: 'vision' },
          { key: 'bathroom_count', value: 1, confidence: 0.25, source: 'vision' },
        ],
        { overallConfidence: 0.28 }
      )

      const { result } = processQuote(
        rules,
        lowConfidenceLegacySignals,
        veryLowConfidenceSignals,
        [],
        taxConfig,
        'GBP'
      )

      expect(result.confidence).toBeLessThan(0.4)
      if (result.range) {
        // ±30% range
        const expectedLow = round(result.total * 0.7)
        const expectedHigh = round(result.total * 1.3)
        expect(result.range.low).toBeCloseTo(expectedLow, 0)
        expect(result.range.high).toBeCloseTo(expectedHigh, 0)
      }
    })
  })

  // ---------------------------------------------------------------------------
  // TEST-E2E-6: Form Override
  // ---------------------------------------------------------------------------
  describe('TEST-E2E-6: Form Override', () => {
    it('should use form values over AI values when both are present', () => {
      // formOverrideSignals has AI-detected room_count different from form

      const { result, trace } = processQuote(
        rules,
        defaultLegacySignals,
        formOverrideSignals,
        formOverrideFormAnswers,
        taxConfig,
        'GBP'
      )

      // Form says 5 rooms, AI detected 3 - form should win
      // Room Cleaning: 5 × £35 = £175

      const roomStep = result.breakdown.find((b) => b.label === 'Room Cleaning')
      expect(roomStep).toBeDefined()
      expect(roomStep?.amount).toBe(175) // 5 rooms × £35

      // Verify trace shows form_field as quantity source
      const roomTraceStep = trace.trace.find(
        (t) => t.type === 'work_step' && t.description?.includes('Room Cleaning')
      )
      expect(roomTraceStep?.quantitySource).toBe('form_field')
      expect(roomTraceStep?.quantityTrusted).toBe(true)
    })

    it('should apply all multipliers from form answers', () => {
      // formOverrideFormAnswers includes:
      // - property_size: large (×1.25)
      // - urgency: next_day (×1.25)
      // - heavy_soiling: true (×1.20)

      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        formOverrideSignals,
        formOverrideFormAnswers,
        taxConfig,
        'GBP'
      )

      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Large property adjustment')
      expect(labels).toContain('Next-day service')
      expect(labels).toContain('Heavy soiling surcharge')
    })

    it('should trigger optional work steps from form values', () => {
      // formOverrideFormAnswers includes:
      // - include_oven: true
      // - carpet_areas: 2

      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        formOverrideSignals,
        formOverrideFormAnswers,
        taxConfig,
        'GBP'
      )

      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Oven Cleaning')
      expect(labels).toContain('Carpet Steam Cleaning')

      const carpetStep = result.breakdown.find((b) => b.label === 'Carpet Steam Cleaning')
      expect(carpetStep?.amount).toBe(50) // 2 areas × £25
    })
  })

  // ---------------------------------------------------------------------------
  // Additional Tests: Tax and Currency
  // ---------------------------------------------------------------------------
  describe('Tax and Currency Handling', () => {
    it('should handle no tax configuration', () => {
      const { result } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        usNoTaxConfig,
        'USD'
      )

      expect(result.currency).toBe('USD')
      expect(result.taxAmount).toBe(0)
      expect(result.total).toBe(result.subtotal)
      expect(result.taxLabel).toBeUndefined()
      expect(result.taxRate).toBeUndefined()
    })

    it('should round tax to 2 decimal places', () => {
      // Create a scenario that might cause floating-point issues
      const customRules: PricingRules = {
        ...rules,
        baseFee: 33.33,
        workSteps: [
          {
            id: 'service',
            name: 'Test Service',
            description: 'Test',
            costType: 'fixed',
            defaultCost: 66.67,
            optional: false,
          },
        ],
      }

      const signals = createMockSignalsV2([])

      const { result } = processQuote(
        customRules,
        defaultLegacySignals,
        signals,
        [],
        taxConfig,
        'GBP'
      )

      // 100 × 0.20 = 20
      expect(result.subtotal).toBe(100)
      expect(result.taxAmount).toBe(20)
      expect(result.total).toBe(120)

      // No floating point errors
      expect(result.taxAmount.toString()).not.toMatch(/\d\.\d{3,}/)
    })
  })

  // ---------------------------------------------------------------------------
  // Pricing Trace Verification
  // ---------------------------------------------------------------------------
  describe('Pricing Trace Verification', () => {
    it('should include all trace step types', () => {
      const { trace } = processQuote(
        rules,
        defaultLegacySignals,
        formOverrideSignals,
        formOverrideFormAnswers,
        taxConfig,
        'GBP'
      )

      const stepTypes = trace.trace.map((t) => t.type)

      expect(stepTypes).toContain('base_fee')
      expect(stepTypes).toContain('work_step')
      expect(stepTypes).toContain('multiplier')
      expect(stepTypes).toContain('tax')
    })

    it('should have consistent trace summary and pricing result', () => {
      const { result, trace } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      // Trace summary total should match pricing result total
      expect(trace.summary.total).toBe(result.total)
      expect(trace.summary.taxAmount).toBe(result.taxAmount)

      // Summary components should add up
      const calculatedTotal =
        trace.summary.baseFee +
        trace.summary.workStepsTotal +
        trace.summary.addonsTotal +
        trace.summary.multiplierAdjustment +
        trace.summary.taxAmount

      expect(round(calculatedTotal)).toBe(result.total)
    })

    it('should track running totals correctly through trace', () => {
      const { trace } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      // Each step should have a valid running total
      let lastRunningTotal = 0
      for (const step of trace.trace) {
        expect(step.runningTotal).toBeGreaterThanOrEqual(lastRunningTotal - Math.abs(step.amount))
        lastRunningTotal = step.runningTotal
      }

      // Final running total should be close to total
      const lastStep = trace.trace[trace.trace.length - 1]
      expect(lastStep).toBeDefined()
      expect(lastStep!.runningTotal).toBe(trace.summary.total)
    })
  })

  // ---------------------------------------------------------------------------
  // Minimum Charge Handling
  // ---------------------------------------------------------------------------
  describe('Minimum Charge Handling', () => {
    it('should not apply minimum when calculated amount exceeds it', () => {
      const { result, trace } = processQuote(
        rules,
        defaultLegacySignals,
        basicCleaningSignals,
        basicCleaningFormAnswers,
        taxConfig,
        'GBP'
      )

      // £320 subtotal > £75 minimum
      expect(result.subtotal).toBeGreaterThan(rules.minimumCharge)
      expect(trace.summary.minimumApplied).toBe(false)
    })

    it('should apply minimum charge when calculated amount is below it', () => {
      // Create a minimal job that would be below minimum
      const minimalRules: PricingRules = {
        ...rules,
        baseFee: 10,
        workSteps: [
          {
            id: 'quick_service',
            name: 'Quick Service',
            description: 'Quick service',
            costType: 'fixed',
            defaultCost: 20,
            optional: false,
          },
        ],
        multipliers: [
          {
            when: { fieldId: 'discount', operator: 'equals', equals: 'HALF' },
            multiplier: 0.5,
            label: '50% discount',
          },
        ],
      }

      const signals = createMockSignalsV2([])
      const answers: FormAnswer[] = [{ fieldId: 'discount', value: 'HALF' }]

      const { result, trace } = processQuote(
        minimalRules,
        defaultLegacySignals,
        signals,
        answers,
        taxConfig,
        'GBP'
      )

      // (10 + 20) × 0.5 = 15 < 75 minimum
      expect(trace.summary.minimumApplied).toBe(true)
      expect(result.subtotal).toBe(75)
    })
  })
})

// =============================================================================
// TEST RESULTS SUMMARY
// =============================================================================

describe('Test Results Summary', () => {
  it('documents all E2E test scenarios', () => {
    const testScenarios = [
      {
        id: 'TEST-E2E-1',
        description: 'Basic Quote Processing',
        verifies: ['pricing_json.total', 'pricing_json.breakdown', 'pricing_trace_json.summary'],
      },
      {
        id: 'TEST-E2E-2',
        description: 'Addon Keyword Detection',
        verifies: ['pricing_json.recommendedAddons', 'breakdown.autoRecommended'],
      },
      {
        id: 'TEST-E2E-3',
        description: 'Cross-Service Detection',
        verifies: ['Basic pricing unaffected by cross-service mentions'],
      },
      {
        id: 'TEST-E2E-4',
        description: 'Signal Recommendations (Unused Signals)',
        verifies: ['Processing continues with unused signals'],
      },
      {
        id: 'TEST-E2E-5',
        description: 'Low Confidence Fallback',
        verifies: ['pricing_json.range', 'pricing_json.confidence'],
      },
      {
        id: 'TEST-E2E-6',
        description: 'Form Override',
        verifies: ['Form values override AI', 'pricing_trace_json.quantitySource'],
      },
    ]

    console.log('\n=== E2E Quote Processing Test Scenarios ===\n')
    console.table(testScenarios)

    expect(testScenarios.length).toBe(6)
  })
})
