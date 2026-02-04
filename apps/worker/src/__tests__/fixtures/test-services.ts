/**
 * Test Service Configurations
 *
 * Realistic service configurations for testing the quote processing pipeline.
 * These match the structure used in production.
 */

import type { WorkStepConfig, AddonConfig, ExpectedSignalConfig } from '@estimator/shared'
import type { PricingRules, TaxConfig, FormAnswer } from '../../pricing/rules-engine'

// =============================================================================
// HOME CLEANING SERVICE
// =============================================================================

export const homeCleaningWorkSteps: WorkStepConfig[] = [
  {
    id: 'room_cleaning',
    name: 'Room Cleaning',
    description: 'General room cleaning (dusting, vacuuming, mopping)',
    costType: 'per_unit',
    defaultCost: 35.0,
    optional: false,
    quantitySource: { type: 'form_field', fieldId: 'room_count' },
    unitLabel: 'rooms',
  },
  {
    id: 'bathroom_cleaning',
    name: 'Bathroom Deep Clean',
    description: 'Deep clean bathrooms including tiles, fixtures, mirrors',
    costType: 'per_unit',
    defaultCost: 45.0,
    optional: false,
    quantitySource: { type: 'form_field', fieldId: 'bathroom_count' },
    unitLabel: 'bathrooms',
  },
  {
    id: 'kitchen_cleaning',
    name: 'Kitchen Deep Clean',
    description: 'Deep clean kitchen surfaces, appliances, floors',
    costType: 'fixed',
    defaultCost: 65.0,
    optional: false,
  },
  {
    id: 'oven_cleaning',
    name: 'Oven Cleaning',
    description: 'Deep clean oven interior and racks',
    costType: 'fixed',
    defaultCost: 45.0,
    optional: true,
    triggerSignal: 'include_oven',
    triggerCondition: { operator: 'equals', value: true },
  },
  {
    id: 'carpet_cleaning',
    name: 'Carpet Steam Cleaning',
    description: 'Professional steam clean for carpeted areas',
    costType: 'per_unit',
    defaultCost: 25.0,
    optional: true,
    triggerSignal: 'carpet_areas',
    triggerCondition: { operator: 'gt', value: 0 },
    quantitySource: { type: 'form_field', fieldId: 'carpet_areas' },
    unitLabel: 'areas',
  },
]

export const homeCleaningAddons: AddonConfig[] = [
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
    triggerConditions: ['pet_hair', 'animal_odor'],
  },
  {
    id: 'window_interior',
    label: 'Interior Window Cleaning',
    price: 40.0,
    triggerKeywords: ['window', 'windows', 'glass'],
  },
]

export const homeCleaningPricingRules: PricingRules = {
  baseFee: 25.0,
  minimumCharge: 75.0,
  workSteps: homeCleaningWorkSteps,
  addons: homeCleaningAddons,
  multipliers: [
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
    {
      when: { fieldId: 'heavy_soiling', operator: 'equals', equals: true },
      multiplier: 1.2,
      label: 'Heavy soiling surcharge',
    },
  ],
}

export const homeCleaningExpectedSignals: ExpectedSignalConfig[] = [
  { signalKey: 'room_count', type: 'number', description: 'Number of rooms to clean' },
  { signalKey: 'bathroom_count', type: 'number', description: 'Number of bathrooms' },
  { signalKey: 'property_size', type: 'enum', possibleValues: ['small', 'medium', 'large'], description: 'Property size category' },
  { signalKey: 'condition_rating', type: 'enum', possibleValues: ['good', 'fair', 'poor'], description: 'Current cleanliness condition' },
  { signalKey: 'carpet_areas', type: 'number', description: 'Number of carpeted areas' },
  { signalKey: 'include_oven', type: 'boolean', description: 'Whether to include oven cleaning' },
]

// =============================================================================
// PAINTING SERVICE (for cross-service testing)
// =============================================================================

export const paintingWorkSteps: WorkStepConfig[] = [
  {
    id: 'wall_prep',
    name: 'Wall Preparation',
    description: 'Cleaning, filling holes, sanding',
    costType: 'per_unit',
    defaultCost: 15.0,
    optional: false,
    quantitySource: { type: 'form_field', fieldId: 'wall_count' },
    unitLabel: 'walls',
  },
  {
    id: 'painting',
    name: 'Painting (2 coats)',
    description: 'Two coats of premium paint',
    costType: 'per_unit',
    defaultCost: 45.0,
    optional: false,
    quantitySource: { type: 'form_field', fieldId: 'wall_count' },
    unitLabel: 'walls',
  },
  {
    id: 'ceiling_painting',
    name: 'Ceiling Painting',
    description: 'Paint ceiling (optional)',
    costType: 'fixed',
    defaultCost: 85.0,
    optional: true,
    triggerSignal: 'include_ceiling',
    triggerCondition: { operator: 'equals', value: true },
  },
]

export const paintingPricingRules: PricingRules = {
  baseFee: 50.0,
  minimumCharge: 150.0,
  workSteps: paintingWorkSteps,
  addons: [
    {
      id: 'primer',
      label: 'Primer Coat',
      price: 30.0,
      triggerKeywords: ['primer', 'dark walls', 'stained'],
    },
    {
      id: 'trim_painting',
      label: 'Trim/Skirting Painting',
      price: 60.0,
      triggerKeywords: ['trim', 'skirting', 'baseboards', 'molding'],
    },
  ],
  multipliers: [
    {
      when: { fieldId: 'high_ceilings', operator: 'equals', equals: true },
      multiplier: 1.3,
      label: 'High ceiling surcharge',
    },
  ],
}

// =============================================================================
// TEST TAX CONFIGURATIONS
// =============================================================================

export const ukVatConfig: TaxConfig = {
  enabled: true,
  label: 'VAT',
  rate: 20,
}

export const usNoTaxConfig: TaxConfig = {
  enabled: false,
}

export const usSalesTaxConfig: TaxConfig = {
  enabled: true,
  label: 'Sales Tax',
  rate: 8.25,
}

// =============================================================================
// TEST FORM ANSWER SCENARIOS
// =============================================================================

/**
 * TEST-E2E-1: Basic cleaning form answers
 */
export const basicCleaningFormAnswers: FormAnswer[] = [
  { fieldId: 'room_count', value: 4 },
  { fieldId: 'bathroom_count', value: 2 },
  { fieldId: 'property_size', value: 'medium' },
  { fieldId: 'urgency', value: 'flexible' },
  { fieldId: 'heavy_soiling', value: false },
  { fieldId: 'carpet_areas', value: 0 },
  { fieldId: 'include_oven', value: false },
]

/**
 * TEST-E2E-2: Form answers with addon keywords in description
 */
export const addonKeywordFormAnswers: FormAnswer[] = [
  { fieldId: 'room_count', value: 3 },
  { fieldId: 'bathroom_count', value: 1 },
  { fieldId: 'property_size', value: 'medium' },
  { fieldId: 'urgency', value: 'flexible' },
  { fieldId: 'heavy_soiling', value: false },
  { fieldId: 'carpet_areas', value: 0 },
  { fieldId: 'include_oven', value: false },
  { fieldId: '_project_description', value: 'Need a thorough clean. Please also clean the fridge and do one load of laundry.' },
]

/**
 * TEST-E2E-3: Form answers with cross-service mention
 */
export const crossServiceFormAnswers: FormAnswer[] = [
  { fieldId: 'room_count', value: 3 },
  { fieldId: 'bathroom_count', value: 1 },
  { fieldId: 'property_size', value: 'medium' },
  { fieldId: 'urgency', value: 'flexible' },
  { fieldId: 'heavy_soiling', value: false },
  { fieldId: 'carpet_areas', value: 0 },
  { fieldId: 'include_oven', value: false },
  { fieldId: '_project_description', value: 'Regular cleaning needed. Also, the living room walls need painting - lots of scuff marks.' },
]

/**
 * TEST-E2E-5: Low confidence scenario - minimal form input
 */
export const minimalFormAnswers: FormAnswer[] = [
  { fieldId: 'property_size', value: 'unknown' },
  // Room count and bathroom count not provided - will rely on AI
]

/**
 * TEST-E2E-6: Form override scenario - form has explicit values
 */
export const formOverrideFormAnswers: FormAnswer[] = [
  { fieldId: 'room_count', value: 5 }, // Form says 5 rooms
  { fieldId: 'bathroom_count', value: 3 },
  { fieldId: 'property_size', value: 'large' },
  { fieldId: 'urgency', value: 'next_day' },
  { fieldId: 'heavy_soiling', value: true },
  { fieldId: 'carpet_areas', value: 2 },
  { fieldId: 'include_oven', value: true },
]

// =============================================================================
// OTHER SERVICES (for cross-service detection)
// =============================================================================

export const otherServices = [
  {
    id: 'svc_painting',
    name: 'Interior Painting',
    description: 'Professional interior painting service',
    detection_keywords: ['paint', 'painting', 'walls need painting', 'repaint', 'touch up'],
  },
  {
    id: 'svc_carpet',
    name: 'Professional Carpet Cleaning',
    description: 'Deep carpet cleaning and stain removal',
    detection_keywords: ['carpet cleaning', 'deep clean carpet', 'carpet stains'],
  },
  {
    id: 'svc_window',
    name: 'Window Cleaning',
    description: 'Interior and exterior window cleaning',
    detection_keywords: ['window cleaning', 'clean windows', 'window wash'],
  },
]

// =============================================================================
// SERVICE CONFIGURATIONS
// =============================================================================

export interface TestServiceConfig {
  id: string
  name: string
  description: string
  scope_includes: string[]
  scope_excludes: string[]
  default_assumptions: string[]
  work_steps: WorkStepConfig[]
  expected_signals: ExpectedSignalConfig[]
  low_confidence_mode: 'show_range' | 'require_review' | 'recommend_site_visit'
  confidence_threshold: number
  high_value_threshold?: number
  media_config: {
    minPhotos: number
    maxPhotos: number
    photoGuidance: string | null
  }
}

export const homeCleaningService: TestServiceConfig = {
  id: 'svc_cleaning',
  name: 'Home Cleaning',
  description: 'Professional home cleaning service',
  scope_includes: [
    'Dusting all surfaces',
    'Vacuuming carpets and floors',
    'Mopping hard floors',
    'Bathroom cleaning',
    'Kitchen cleaning',
  ],
  scope_excludes: [
    'Exterior windows',
    'Deep carpet shampooing',
    'Mold remediation',
  ],
  default_assumptions: [
    'Customer will provide cleaning supplies unless arranged otherwise',
    'Access to running water and electricity',
    'Standard residential property',
  ],
  work_steps: homeCleaningWorkSteps,
  expected_signals: homeCleaningExpectedSignals,
  low_confidence_mode: 'show_range',
  confidence_threshold: 0.7,
  high_value_threshold: 1000,
  media_config: {
    minPhotos: 1,
    maxPhotos: 5,
    photoGuidance: 'Please upload photos of the areas to be cleaned',
  },
}

export const paintingService: TestServiceConfig = {
  id: 'svc_painting',
  name: 'Interior Painting',
  description: 'Professional interior painting service',
  scope_includes: [
    'Wall preparation (filling, sanding)',
    'Two coats of paint',
    'Furniture covering',
    'Edge cutting and trim masking',
  ],
  scope_excludes: [
    'Wallpaper removal',
    'Major wall repairs',
    'Exterior painting',
  ],
  default_assumptions: [
    'Standard ceiling height (8-10 ft)',
    'Paint will be provided or sourced',
    'Minor surface preparation only',
  ],
  work_steps: paintingWorkSteps,
  expected_signals: [
    { signalKey: 'wall_count', type: 'number', description: 'Number of walls to paint' },
    { signalKey: 'room_sqft', type: 'number', description: 'Total square footage' },
    { signalKey: 'include_ceiling', type: 'boolean', description: 'Whether to paint ceiling' },
    { signalKey: 'high_ceilings', type: 'boolean', description: 'Whether ceilings are high (>10ft)' },
  ],
  low_confidence_mode: 'recommend_site_visit',
  confidence_threshold: 0.7,
  media_config: {
    minPhotos: 2,
    maxPhotos: 10,
    photoGuidance: 'Please upload photos of all walls to be painted',
  },
}
