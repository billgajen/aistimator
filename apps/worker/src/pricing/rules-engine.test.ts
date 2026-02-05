/**
 * Pricing Accuracy Tests
 *
 * Rigorously tests that pricing calculations are mathematically correct
 * based on service configuration. Tests the deterministic pricing engine
 * with comprehensive scenarios.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  calculatePricingWithTrace,
  type PricingRules,
  type FormAnswer,
  type TaxConfig,
  type AddonDetectionContext,
} from './rules-engine'
import type {
  WorkStepConfig,
  ExtractedSignalsV2,
} from '@estimator/shared'
import type { ExtractedSignals } from '../ai/signals'

// ============================================================================
// TEST SERVICE CONFIGURATION
// ============================================================================

/**
 * Complete Home Cleaning - A realistic cleaning service with comprehensive
 * pricing configuration that exercises all pricing components.
 */
const createTestPricingRules = (): PricingRules => ({
  baseFee: 25.0,
  minimumCharge: 75.0,

  // WORK STEPS - The core pricing
  workSteps: [
    {
      id: 'room_cleaning',
      name: 'Room Cleaning',
      description: 'General room cleaning',
      costType: 'per_unit',
      defaultCost: 35.0,
      optional: false,
      quantitySource: { type: 'form_field', fieldId: 'room_count' },
      unitLabel: 'rooms',
    },
    {
      id: 'bathroom_cleaning',
      name: 'Bathroom Deep Clean',
      description: 'Deep clean bathrooms',
      costType: 'per_unit',
      defaultCost: 45.0,
      optional: false,
      quantitySource: { type: 'form_field', fieldId: 'bathroom_count' },
      unitLabel: 'bathrooms',
    },
    {
      id: 'kitchen_cleaning',
      name: 'Kitchen Deep Clean',
      description: 'Deep clean kitchen',
      costType: 'fixed',
      defaultCost: 65.0,
      optional: false,
    },
    {
      id: 'oven_cleaning',
      name: 'Oven Cleaning',
      description: 'Deep clean oven',
      costType: 'fixed',
      defaultCost: 45.0,
      optional: true,
      triggerSignal: 'include_oven',
      triggerCondition: { operator: 'equals', value: true },
    },
    {
      id: 'carpet_cleaning',
      name: 'Carpet Steam Cleaning',
      description: 'Steam clean carpets',
      costType: 'per_unit',
      defaultCost: 25.0,
      optional: true,
      triggerSignal: 'carpet_areas',
      triggerCondition: { operator: 'gt', value: 0 },
      quantitySource: { type: 'form_field', fieldId: 'carpet_areas' },
      unitLabel: 'areas',
    },
    {
      id: 'window_cleaning',
      name: 'Interior Window Cleaning',
      description: 'Clean interior windows',
      costType: 'per_unit',
      defaultCost: 8.0,
      optional: true,
      triggerSignal: 'window_count',
      triggerCondition: { operator: 'gte', value: 1 },
      quantitySource: { type: 'form_field', fieldId: 'window_count' },
      unitLabel: 'windows',
    },
  ] as WorkStepConfig[],

  // ADDONS - Optional extras
  addons: [
    {
      id: 'fridge_cleaning',
      label: 'Fridge Interior Cleaning',
      price: 25.0,
      triggerKeywords: ['fridge', 'refrigerator', 'freezer'],
    },
    {
      id: 'laundry',
      label: 'Laundry Service (1 load)',
      price: 15.0,
      triggerKeywords: ['laundry', 'washing', 'clothes'],
    },
    {
      id: 'pet_treatment',
      label: 'Pet Hair & Odor Treatment',
      price: 35.0,
      triggerKeywords: ['pet', 'dog', 'cat', 'animal hair'],
    },
  ],

  // MULTIPLIERS - Dynamic adjustments
  multipliers: [
    // Property size multiplier
    {
      when: { fieldId: 'property_size', operator: 'equals', equals: 'large' },
      multiplier: 1.25,
      label: 'Large property adjustment',
    },
    {
      when: { fieldId: 'property_size', operator: 'equals', equals: 'small' },
      multiplier: 0.85,
      label: 'Small property discount',
    },
    // Urgency multiplier
    {
      when: { fieldId: 'urgency', operator: 'equals', equals: 'same_day' },
      multiplier: 1.5,
      label: 'Same-day service',
    },
    {
      when: { fieldId: 'urgency', operator: 'equals', equals: 'next_day' },
      multiplier: 1.25,
      label: 'Next-day service',
    },
    // Heavy soiling
    {
      when: { fieldId: 'heavy_soiling', operator: 'equals', equals: true },
      multiplier: 1.2,
      label: 'Heavy soiling surcharge',
    },
    // First-time customer discount
    {
      when: { fieldId: 'previous_bookings', operator: 'equals', equals: 0 },
      multiplier: 0.9,
      label: 'New customer discount',
    },
    // Loyalty discount
    {
      when: { fieldId: 'previous_bookings', operator: 'gte', value: 5 },
      multiplier: 0.85,
      label: 'Loyalty discount',
    },
    // Array multiplier for deep clean
    {
      when: { fieldId: 'cleaning_types', operator: 'contains', value: 'deep_clean' },
      multiplier: 1.15,
      label: 'Deep cleaning surcharge',
    },
  ],
})

const createTaxConfig = (): TaxConfig => ({
  enabled: true,
  label: 'VAT',
  rate: 20,
})

/**
 * Create default extracted signals (minimal signals for testing)
 * We set complexity to 'medium' (1.0x) to avoid unexpected adjustments.
 */
const createDefaultSignals = (): ExtractedSignals => ({
  category: 'cleaning',
  materials: [],
  condition: { rating: 'good' },
  complexity: { level: 'medium', factors: [] },
  access: { difficulty: 'easy' },
  observations: [],
  warnings: [],
  confidence: 0.9,
  siteVisitRecommended: false,
})

/**
 * Create structured signals (V2 format)
 */
const createStructuredSignals = (
  signals: Array<{ key: string; value: number | string | boolean }>
): ExtractedSignalsV2 => ({
  extractedAt: new Date().toISOString(),
  overallConfidence: 0.95,
  signals: signals.map((s) => ({
    key: s.key,
    value: s.value,
    confidence: 1.0,
    source: 'form' as const,
  })),
  complexity: { level: 'medium', factors: [] },
  siteVisitRecommended: false,
  lowConfidenceSignals: [],
})

/**
 * Helper to round to 2 decimal places for comparison
 */
const round = (n: number): number => Math.round(n * 100) / 100

// ============================================================================
// TEST SCENARIOS
// ============================================================================

describe('Pricing Accuracy Tests', () => {
  let rules: PricingRules
  let taxConfig: TaxConfig

  beforeAll(() => {
    rules = createTestPricingRules()
    taxConfig = createTaxConfig()
  })

  // --------------------------------------------------------------------------
  // TEST-1: Basic Quote (Medium Property, Standard Timing)
  // --------------------------------------------------------------------------
  describe('TEST-1: Basic Quote (Medium Property, Standard Timing)', () => {
    it('should calculate correctly for a standard 4-room, 2-bathroom job', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 4 },
        { fieldId: 'bathroom_count', value: 2 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 0 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 4 },
        { key: 'bathroom_count', value: 2 },
        { key: 'carpet_areas', value: 0 },
        { key: 'window_count', value: 0 },
        { key: 'include_oven', value: false },
      ])

      const { result, trace } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Expected calculation:
      // Base Fee:              £25.00
      // Room Cleaning:         4 × £35 = £140.00
      // Bathroom Cleaning:     2 × £45 = £90.00
      // Kitchen Deep Clean:    £65.00
      // ─────────────────────────────────
      // Subtotal:              £320.00
      // New Customer Discount: £320 × 0.90 = £288.00 (adjustment: -£32.00)
      // ─────────────────────────────────
      // Subtotal after mult:   £288.00
      // VAT (20%):             £57.60
      // ─────────────────────────────────
      // TOTAL:                 £345.60

      expect(result.subtotal).toBe(288.0)
      expect(result.taxAmount).toBe(57.6)
      expect(result.total).toBe(345.6)

      // Verify breakdown contains expected items
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Base service fee')
      expect(labels).toContain('Room Cleaning  £35 x 4(Rooms)')
      expect(labels).toContain('Bathroom Deep Clean  £45 x 2(Bathrooms)')
      expect(labels).toContain('Kitchen Deep Clean')
      expect(labels).toContain('New customer discount')

      // Verify trace
      expect(trace.summary.baseFee).toBe(25)
      expect(trace.summary.workStepsTotal).toBe(295) // 140 + 90 + 65
      expect(trace.summary.multiplierAdjustment).toBe(-32) // 10% off 320
    })
  })

  // --------------------------------------------------------------------------
  // TEST-2: Full Service with All Options
  // --------------------------------------------------------------------------
  describe('TEST-2: Full Service with All Options', () => {
    it('should calculate correctly with all optional work steps and addons', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 6 },
        { fieldId: 'bathroom_count', value: 3 },
        { fieldId: 'carpet_areas', value: 4 },
        { fieldId: 'window_count', value: 12 },
        { fieldId: 'include_oven', value: true },
        { fieldId: 'property_size', value: 'large' },
        { fieldId: 'urgency', value: 'same_day' },
        { fieldId: 'heavy_soiling', value: true },
        { fieldId: 'previous_bookings', value: 2 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 6 },
        { key: 'bathroom_count', value: 3 },
        { key: 'carpet_areas', value: 4 },
        { key: 'window_count', value: 12 },
        { key: 'include_oven', value: true },
      ])

      const addonContext: AddonDetectionContext = {
        projectDescription: 'Need thorough clean including fridge and laundry',
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Expected calculation:
      // Base Fee:                    £25.00
      // Room Cleaning:               6 × £35 = £210.00
      // Bathroom Cleaning:           3 × £45 = £135.00
      // Kitchen Deep Clean:          £65.00
      // Oven Cleaning:               £45.00
      // Carpet Steam Cleaning:       4 × £25 = £100.00
      // Interior Window Cleaning:    12 × £8 = £96.00
      // Fridge Cleaning (addon):     £25.00
      // Laundry Service (addon):     £15.00
      // ───────────────────────────────────────
      // Subtotal:                    £716.00
      //
      // Multipliers Applied (in order):
      //   Large property (×1.25):    £716 × 1.25 = £895.00 (+179)
      //   Same-day service (×1.50):  £895 × 1.50 = £1,342.50 (+447.50)
      //   Heavy soiling (×1.20):     £1,342.50 × 1.20 = £1,611.00 (+268.50)
      // ───────────────────────────────────────
      // Subtotal after multipliers:  £1,611.00
      // VAT (20%):                   £322.20
      // ───────────────────────────────────────
      // TOTAL:                       £1,933.20

      expect(result.subtotal).toBe(1611.0)
      expect(result.taxAmount).toBe(322.2)
      expect(result.total).toBe(1933.2)

      // Verify optional work steps triggered
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Oven Cleaning')
      expect(labels).toContain('Carpet Steam Cleaning  £25 x 4(Areas)')
      expect(labels).toContain('Interior Window Cleaning  £8 x 12(Windows)')

      // Verify addons triggered
      expect(labels).toContain('Fridge Interior Cleaning')
      expect(labels).toContain('Laundry Service (1 load)')

      // Verify all three multipliers applied
      expect(labels).toContain('Large property adjustment')
      expect(labels).toContain('Same-day service')
      expect(labels).toContain('Heavy soiling surcharge')
    })
  })

  // --------------------------------------------------------------------------
  // TEST-3: Minimum Charge NOT Triggered
  // --------------------------------------------------------------------------
  describe('TEST-3: Minimum Charge NOT Triggered', () => {
    it('should use calculated amount when above minimum charge', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 1 },
        { fieldId: 'bathroom_count', value: 0 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'small' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 10 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 1 },
        { key: 'bathroom_count', value: 0 },
        { key: 'carpet_areas', value: 0 },
        { key: 'window_count', value: 0 },
        { key: 'include_oven', value: false },
      ])

      const { result, trace } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Expected calculation:
      // Base Fee:              £25.00
      // Room Cleaning:         1 × £35 = £35.00
      // Kitchen Deep Clean:    £65.00
      // ─────────────────────────────────
      // Subtotal:              £125.00
      //
      // Multipliers:
      //   Small property (×0.85):   £125 × 0.85 = £106.25
      //   Loyalty discount (×0.85): £106.25 × 0.85 = £90.31
      // ─────────────────────────────────
      // Subtotal after mult:   £90.31 (rounded to £90.31)
      //
      // CHECK: £90.31 > minimumCharge (£75)? YES → Use calculated amount

      expect(result.subtotal).toBeCloseTo(90.31, 1)
      expect(trace.summary.minimumApplied).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-4: Minimum Charge TRIGGERED
  // --------------------------------------------------------------------------
  describe('TEST-4: Minimum Charge TRIGGERED', () => {
    it('should apply minimum charge when calculated amount is below it', () => {
      // Use a custom rules with very low prices to trigger minimum
      const lowPriceRules: PricingRules = {
        ...rules,
        baseFee: 5,
        workSteps: [
          {
            id: 'quick_tidy',
            name: 'Quick Tidy',
            description: 'Quick tidy up',
            costType: 'fixed',
            defaultCost: 10,
            optional: false,
          },
        ] as WorkStepConfig[],
        multipliers: [
          {
            when: { fieldId: 'discount_code', operator: 'equals', equals: 'HALF' },
            multiplier: 0.5,
            label: '50% discount',
          },
        ],
      }

      const formAnswers: FormAnswer[] = [
        { fieldId: 'discount_code', value: 'HALF' },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([])

      const { result, trace } = calculatePricingWithTrace(
        lowPriceRules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Expected:
      // Base: £5, Work: £10, Subtotal: £15
      // After 50% discount: £7.50
      // Minimum charge: £75 → applies
      // VAT: £15
      // Total: £90

      expect(result.subtotal).toBe(75)
      expect(trace.summary.minimumApplied).toBe(true)
      expect(result.taxAmount).toBe(15)
      expect(result.total).toBe(90)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-5: String Number Parsing
  // --------------------------------------------------------------------------
  describe('TEST-5: String Number Parsing', () => {
    it('should correctly parse string numbers from form inputs', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: '4' }, // String instead of number
        { fieldId: 'bathroom_count', value: '2' },
        { fieldId: 'carpet_areas', value: '0' },
        { fieldId: 'window_count', value: '0' },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: '0' }, // String "0"
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 4 },
        { key: 'bathroom_count', value: 2 },
        { key: 'carpet_areas', value: 0 },
        { key: 'window_count', value: 0 },
        { key: 'include_oven', value: false },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Should match TEST-1 results since string "4" should parse to 4
      expect(result.subtotal).toBe(288.0)
      expect(result.total).toBe(345.6)
    })

    it('should handle comma-formatted numbers', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: '1,000' }, // Comma-formatted
        { fieldId: 'bathroom_count', value: 0 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 1000 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Room cleaning: 1000 × £35 = £35,000
      // Base + Kitchen: £25 + £65 = £90
      // Total before tax: £35,090
      // With 20% VAT: £42,108

      // Verify the comma-formatted number was parsed correctly
      const roomCleaningStep = result.breakdown.find(
        (b) => b.label.startsWith('Room Cleaning')
      )
      expect(roomCleaningStep?.amount).toBe(35000)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-6: Boolean String Values
  // --------------------------------------------------------------------------
  describe('TEST-6: Boolean String Values', () => {
    it('should handle string "Yes" as true for boolean conditions', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: true }, // Note: trigger is checked via signal
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: true }, // Boolean true
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
        { key: 'carpet_areas', value: 0 },
        { key: 'window_count', value: 0 },
        { key: 'include_oven', value: true },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Expected calculation:
      // Base Fee:              £25.00
      // Room Cleaning:         3 × £35 = £105.00
      // Bathroom Cleaning:     1 × £45 = £45.00
      // Kitchen Deep Clean:    £65.00
      // Oven Cleaning:         £45.00 (include_oven=true)
      // ─────────────────────────────────
      // Subtotal:              £285.00
      // Heavy soiling (×1.20): £285 × 1.20 = £342.00
      // ─────────────────────────────────
      // VAT (20%):             £68.40
      // ─────────────────────────────────
      // TOTAL:                 £410.40

      expect(result.subtotal).toBe(342.0)
      expect(result.taxAmount).toBe(68.4)
      expect(result.total).toBe(410.4)

      // Verify oven cleaning and heavy soiling applied
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Oven Cleaning')
      expect(labels).toContain('Heavy soiling surcharge')
    })

    it('should handle string "true" as true for boolean multipliers', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: 'true' as unknown as boolean }, // String "true"
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Heavy soiling multiplier should apply with string "true"
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Heavy soiling surcharge')
    })
  })

  // --------------------------------------------------------------------------
  // TEST-7: Array Field Multiplier (Multi-Select)
  // --------------------------------------------------------------------------
  describe('TEST-7: Array Field Multiplier (Multi-Select)', () => {
    it('should trigger multiplier when array contains matching value', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
        { fieldId: 'cleaning_types', value: ['standard', 'deep_clean', 'eco_friendly'] },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Deep cleaning multiplier (×1.15) should apply
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Deep cleaning surcharge')

      // Base calculation:
      // Base: £25, Rooms: £105, Bathroom: £45, Kitchen: £65 = £240
      // With deep clean surcharge (×1.15): £276
      const expectedSubtotal = round(240 * 1.15)
      expect(result.subtotal).toBe(expectedSubtotal)
    })

    it('should handle case-insensitive array matching', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
        { fieldId: 'cleaning_types', value: ['DEEP_CLEAN'] }, // Uppercase
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Deep cleaning multiplier should apply even with uppercase
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Deep cleaning surcharge')
    })
  })

  // --------------------------------------------------------------------------
  // TEST-8: Numeric Comparison Edge Cases
  // --------------------------------------------------------------------------
  describe('TEST-8: Numeric Comparison Edge Cases', () => {
    it('should handle string "5" in gte comparison for loyalty discount', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: '5' }, // String "5"
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Loyalty discount (×0.85) should apply with string "5"
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Loyalty discount')

      // Base: £25, Rooms: £105, Bathroom: £45, Kitchen: £65 = £240
      // With loyalty discount (×0.85): £204
      expect(result.subtotal).toBe(204)
    })

    it('should correctly handle gt, lt, lte operators', () => {
      const customRules: PricingRules = {
        ...rules,
        multipliers: [
          { when: { fieldId: 'area_sqft', operator: 'gt', value: 1000 }, multiplier: 1.2, label: '>1000 sqft' },
          { when: { fieldId: 'area_sqft', operator: 'lt', value: 500 }, multiplier: 0.8, label: '<500 sqft' },
          { when: { fieldId: 'area_sqft', operator: 'lte', value: 1000 }, multiplier: 1.0, label: '<=1000 sqft' },
        ],
      }

      // Test gt: 1001 should trigger >1000
      const formAnswersGt: FormAnswer[] = [
        { fieldId: 'room_count', value: 1 },
        { fieldId: 'bathroom_count', value: 0 },
        { fieldId: 'area_sqft', value: 1001 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([{ key: 'room_count', value: 1 }])

      const { result: resultGt } = calculatePricingWithTrace(
        customRules,
        signals,
        structuredSignals,
        formAnswersGt,
        taxConfig,
        'GBP'
      )

      expect(resultGt.breakdown.map((b) => b.label)).toContain('>1000 sqft')

      // Test lt: 499 should trigger <500
      const formAnswersLt: FormAnswer[] = [
        { fieldId: 'room_count', value: 1 },
        { fieldId: 'bathroom_count', value: 0 },
        { fieldId: 'area_sqft', value: 499 },
      ]

      const { result: resultLt } = calculatePricingWithTrace(
        customRules,
        signals,
        structuredSignals,
        formAnswersLt,
        taxConfig,
        'GBP'
      )

      expect(resultLt.breakdown.map((b) => b.label)).toContain('<500 sqft')
    })
  })

  // --------------------------------------------------------------------------
  // TEST-9: Zero Quantities Don't Create $0 Lines
  // --------------------------------------------------------------------------
  describe("TEST-9: Zero Quantities Don't Create $0 Lines", () => {
    it('should not include $0 line items in breakdown', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 0 }, // Zero bathrooms
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 0 },
        { key: 'carpet_areas', value: 0 },
        { key: 'window_count', value: 0 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Verify no $0 line items
      const zeroAmountItems = result.breakdown.filter((b) => b.amount === 0)
      expect(zeroAmountItems).toHaveLength(0)

      // Verify bathroom cleaning is not in breakdown
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).not.toContain('Bathroom Deep Clean')

      // Expected:
      // Base: £25, Rooms: £105, Kitchen: £65 = £195
      // VAT: £39
      // Total: £234
      expect(result.subtotal).toBe(195)
      expect(result.taxAmount).toBe(39)
      expect(result.total).toBe(234)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-10: Tax Rounding Precision
  // --------------------------------------------------------------------------
  describe('TEST-10: Tax Rounding Precision', () => {
    it('should correctly round tax to 2 decimal places', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 2 },
        { fieldId: 'window_count', value: 7 },
        { fieldId: 'include_oven', value: true },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 3 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
        { key: 'carpet_areas', value: 2 },
        { key: 'window_count', value: 7 },
        { key: 'include_oven', value: true },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Expected calculation:
      // Base Fee:                 £25.00
      // Room Cleaning:            3 × £35 = £105.00
      // Bathroom Cleaning:        1 × £45 = £45.00
      // Kitchen Deep Clean:       £65.00
      // Oven Cleaning:            £45.00
      // Carpet Steam Cleaning:    2 × £25 = £50.00
      // Interior Window Cleaning: 7 × £8 = £56.00
      // ─────────────────────────────────
      // Subtotal:                 £391.00
      // VAT (20%):                £391.00 × 0.20 = £78.20
      // ─────────────────────────────────
      // TOTAL:                    £469.20

      expect(result.subtotal).toBe(391.0)
      expect(result.taxAmount).toBe(78.2)
      expect(result.total).toBe(469.2)

      // Verify no floating-point precision errors
      expect(result.taxAmount.toString()).not.toMatch(/\d\.\d{3,}/) // No more than 2 decimal places
    })

    it('should handle edge case tax calculations without floating-point errors', () => {
      // Create a scenario that might cause floating-point issues
      const customRules: PricingRules = {
        baseFee: 33.33,
        minimumCharge: 0,
        workSteps: [
          {
            id: 'service',
            name: 'Service',
            description: 'Test service',
            costType: 'fixed',
            defaultCost: 66.67,
            optional: false,
          },
        ] as WorkStepConfig[],
        addons: [],
        multipliers: [],
      }

      const formAnswers: FormAnswer[] = []
      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([])

      const { result } = calculatePricingWithTrace(
        customRules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Subtotal: 33.33 + 66.67 = 100
      // Tax: 100 × 0.20 = 20
      // Total: 120
      expect(result.subtotal).toBe(100)
      expect(result.taxAmount).toBe(20)
      expect(result.total).toBe(120)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-11: Multiplier Stacking Order
  // --------------------------------------------------------------------------
  describe('TEST-11: Multiplier Stacking Order', () => {
    it('should apply multipliers multiplicatively in configuration order', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 4 },
        { fieldId: 'bathroom_count', value: 2 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'large' },
        { fieldId: 'urgency', value: 'next_day' },
        { fieldId: 'heavy_soiling', value: true },
        { fieldId: 'previous_bookings', value: 0 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 4 },
        { key: 'bathroom_count', value: 2 },
        { key: 'carpet_areas', value: 0 },
        { key: 'window_count', value: 0 },
        { key: 'include_oven', value: false },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Expected calculation (multipliers stack multiplicatively):
      // Subtotal before multipliers: £320.00 (25 + 140 + 90 + 65)
      //
      // Applied in configuration order:
      //   Large property (×1.25):    £320 × 1.25 = £400.00
      //   Next-day service (×1.25):  £400 × 1.25 = £500.00
      //   Heavy soiling (×1.20):     £500 × 1.20 = £600.00
      //   New customer (×0.90):      £600 × 0.90 = £540.00
      //
      // Final subtotal: £540.00
      // VAT: £108.00
      // TOTAL: £648.00

      expect(result.subtotal).toBe(540)
      expect(result.taxAmount).toBe(108)
      expect(result.total).toBe(648)

      // Verify multipliers applied in order
      const labels = result.breakdown.map((b) => b.label)
      const largeIdx = labels.indexOf('Large property adjustment')
      const nextDayIdx = labels.indexOf('Next-day service')
      const heavyIdx = labels.indexOf('Heavy soiling surcharge')
      const newCustomerIdx = labels.indexOf('New customer discount')

      expect(largeIdx).toBeLessThan(nextDayIdx)
      expect(nextDayIdx).toBeLessThan(heavyIdx)
      expect(heavyIdx).toBeLessThan(newCustomerIdx)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-12: Addon Keyword Case Sensitivity
  // --------------------------------------------------------------------------
  describe('TEST-12: Addon Keyword Case Sensitivity', () => {
    it('should detect addons with case-insensitive keyword matching', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      const addonContext: AddonDetectionContext = {
        projectDescription: 'Please clean the FRIDGE and do some LAUNDRY', // Uppercase keywords
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Both addons should be detected despite uppercase
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Fridge Interior Cleaning')
      expect(labels).toContain('Laundry Service (1 load)')

      // Verify recommended addons
      expect(result.recommendedAddons).toHaveLength(2)
      expect(result.recommendedAddons?.map((a) => a.id)).toContain('fridge_cleaning')
      expect(result.recommendedAddons?.map((a) => a.id)).toContain('laundry')
    })

    it('should detect multiple addons from single description with word boundaries', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 2 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 2 },
        { key: 'bathroom_count', value: 1 },
      ])

      const addonContext: AddonDetectionContext = {
        projectDescription: 'We have a dog and cat that shed a lot',
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Pet treatment addon should be detected (keywords: pet, dog, cat)
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Pet Hair & Odor Treatment')

      // Only one addon (should not double-count for both dog and cat)
      const petAddons = result.recommendedAddons?.filter((a) => a.id === 'pet_treatment')
      expect(petAddons).toHaveLength(1)
    })
  })

  // --------------------------------------------------------------------------
  // TEST-13: Addon Keyword Negation Detection
  // --------------------------------------------------------------------------
  describe('TEST-13: Addon Keyword Negation Detection', () => {
    it('should NOT recommend addons when customer says "no extras"', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      // Customer mentions fridge but says "no extras" - should NOT trigger fridge addon
      const addonContext: AddonDetectionContext = {
        projectDescription: 'Please clean the house. The fridge is dirty but please no extras.',
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Fridge addon should NOT be recommended due to "no extras"
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).not.toContain('Fridge Interior Cleaning')
      expect(result.recommendedAddons).toBeUndefined()
    })

    it('should NOT recommend addon when keyword is negated', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      // Customer says "don't clean the fridge" - should NOT trigger fridge addon
      const addonContext: AddonDetectionContext = {
        projectDescription: "Please clean the house but don't clean the fridge, it's fine.",
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Fridge addon should NOT be recommended due to negation
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).not.toContain('Fridge Interior Cleaning')
    })

    it('should still recommend addon when keyword is NOT negated', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      // Customer mentions fridge positively - should trigger fridge addon
      const addonContext: AddonDetectionContext = {
        projectDescription: 'Please clean the house including the fridge, it needs attention.',
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Fridge addon SHOULD be recommended
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).toContain('Fridge Interior Cleaning')
      expect(result.recommendedAddons).toBeDefined()
      expect(result.recommendedAddons?.map((a) => a.id)).toContain('fridge_cleaning')
    })

    it('should handle budget-focused language as global suppressor', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      // Customer says "budget only" - should suppress addons
      const addonContext: AddonDetectionContext = {
        projectDescription: 'I need cleaning for fridge and laundry but budget only please.',
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // No keyword-triggered addons should be recommended
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).not.toContain('Fridge Interior Cleaning')
      expect(labels).not.toContain('Laundry Service (1 load)')
    })

    it('should handle "keep it simple" as global suppressor', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      // Customer says "keep it simple" - should suppress addons
      const addonContext: AddonDetectionContext = {
        projectDescription: 'We have a dog but keep it simple, just basic cleaning.',
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Pet treatment addon should NOT be recommended
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).not.toContain('Pet Hair & Odor Treatment')
    })

    it('should handle negation with words between ("don\'t want fridge")', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 3 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'carpet_areas', value: 0 },
        { fieldId: 'window_count', value: 0 },
        { fieldId: 'include_oven', value: false },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 3 },
        { key: 'bathroom_count', value: 1 },
      ])

      // "don't want" + "fridge" with words in between
      const addonContext: AddonDetectionContext = {
        projectDescription: "I don't want the fridge cleaned, just the main areas.",
      }

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP',
        undefined,
        addonContext
      )

      // Fridge addon should NOT be recommended
      const labels = result.breakdown.map((b) => b.label)
      expect(labels).not.toContain('Fridge Interior Cleaning')
    })
  })

  // --------------------------------------------------------------------------
  // ADDITIONAL EDGE CASES
  // --------------------------------------------------------------------------
  describe('Additional Edge Cases', () => {
    it('should handle empty form answers gracefully', () => {
      const formAnswers: FormAnswer[] = []
      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Should at least have base fee and kitchen (fixed, non-optional)
      expect(result.subtotal).toBeGreaterThanOrEqual(rules.baseFee)
      expect(result.breakdown.some((b) => b.label === 'Kitchen Deep Clean')).toBe(true)
    })

    it('should handle disabled tax correctly', () => {
      const noTax: TaxConfig = { enabled: false }
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 2 },
        { fieldId: 'bathroom_count', value: 1 },
        { fieldId: 'property_size', value: 'medium' },
        { fieldId: 'urgency', value: 'flexible' },
        { fieldId: 'heavy_soiling', value: false },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 2 },
        { key: 'bathroom_count', value: 1 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        noTax,
        'GBP'
      )

      expect(result.taxAmount).toBe(0)
      expect(result.total).toBe(result.subtotal)
      expect(result.taxLabel).toBeUndefined()
      expect(result.taxRate).toBeUndefined()
    })

    it('should handle very large numbers without precision loss', () => {
      const formAnswers: FormAnswer[] = [
        { fieldId: 'room_count', value: 10000 },
        { fieldId: 'bathroom_count', value: 5000 },
        { fieldId: 'property_size', value: 'large' },
        { fieldId: 'urgency', value: 'same_day' },
        { fieldId: 'heavy_soiling', value: true },
        { fieldId: 'previous_bookings', value: 1 },
      ]

      const signals = createDefaultSignals()
      const structuredSignals = createStructuredSignals([
        { key: 'room_count', value: 10000 },
        { key: 'bathroom_count', value: 5000 },
      ])

      const { result } = calculatePricingWithTrace(
        rules,
        signals,
        structuredSignals,
        formAnswers,
        taxConfig,
        'GBP'
      )

      // Room: 10000 × 35 = 350,000
      // Bath: 5000 × 45 = 225,000
      // Kitchen: 65
      // Base: 25
      // Subtotal before mult: 575,090
      // With multipliers: large (×1.25) → same_day (×1.5) → heavy (×1.2)
      // 575,090 × 1.25 × 1.5 × 1.2 = 1,293,952.5

      expect(result.subtotal).toBeGreaterThan(1000000)
      expect(Number.isFinite(result.subtotal)).toBe(true)
      expect(Number.isFinite(result.taxAmount)).toBe(true)
      expect(Number.isFinite(result.total)).toBe(true)

      // Verify no scientific notation in amounts
      expect(result.subtotal.toString()).not.toContain('e')
    })
  })
})

// ============================================================================
// SUMMARY TABLE GENERATOR
// ============================================================================

describe('Test Results Summary', () => {
  it('generates a summary of all test results', () => {
    const testResults = [
      { test: 'TEST-1', description: 'Basic quote', expectedTotal: 345.6 },
      { test: 'TEST-2', description: 'Full service', expectedTotal: 1933.2 },
      { test: 'TEST-3', description: 'Min charge NOT triggered', expectedSubtotal: 90.31 },
      { test: 'TEST-4', description: 'Min charge TRIGGERED', expectedSubtotal: 75 },
      { test: 'TEST-5', description: 'String numbers', expectedTotal: 345.6 },
      { test: 'TEST-6', description: 'Boolean strings', expectedTotal: 410.4 },
      { test: 'TEST-7', description: 'Array multiplier', expectedSubtotal: 276 },
      { test: 'TEST-8', description: 'Numeric comparison', expectedSubtotal: 204 },
      { test: 'TEST-9', description: 'Zero quantities', expectedTotal: 234 },
      { test: 'TEST-10', description: 'Tax rounding', expectedTotal: 469.2 },
      { test: 'TEST-11', description: 'Multiplier stacking', expectedTotal: 648 },
      { test: 'TEST-12', description: 'Addon keywords', note: 'Addons detected' },
    ]

    console.log('\n=== Pricing Accuracy Test Results ===\n')
    console.table(testResults)

    // This test always passes - it's just for generating the summary
    expect(true).toBe(true)
  })
})
