/**
 * Fence Installation & Repair Service Configuration
 *
 * A realistic service template for E2E stress testing of the pricing engine.
 * Tests various scenarios: minimal input, detailed input, price-sensitive,
 * urgent/emergency, and confusing/contradictory customer requests.
 */

import type { WorkStepConfig, AddonConfig, ExpectedSignalConfig } from '@estimator/shared'
import type { PricingRules, TaxConfig, FormAnswer } from '../../pricing/rules-engine'
import type { TestServiceConfig } from './test-services'

// =============================================================================
// FENCE INSTALLATION & REPAIR SERVICE
// =============================================================================

export const fenceWorkSteps: WorkStepConfig[] = [
  {
    id: 'base_fee',
    name: 'Site Assessment & Setup',
    description: 'Initial site visit, measurements, material ordering',
    costType: 'fixed',
    defaultCost: 75.0,
    optional: false,
  },
  {
    id: 'fence_install_new',
    name: 'Fence Installation - New',
    description: 'Supply and install fence panels with posts for new installation',
    costType: 'per_unit',
    defaultCost: 55.0,
    optional: true,
    triggerSignal: 'job_type',
    triggerCondition: { operator: 'equals', value: 'New Installation' },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
    unitLabel: 'linear ft',
  },
  {
    id: 'fence_install_replacement',
    name: 'Fence Installation - Full Replacement',
    description: 'Supply and install fence panels with posts (post cost bundled)',
    costType: 'per_unit',
    defaultCost: 55.0,
    optional: true,
    triggerSignal: 'job_type',
    triggerCondition: { operator: 'equals', value: 'Full Replacement' },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
    unitLabel: 'linear ft',
  },
  {
    id: 'gate_installation',
    name: 'Gate Installation',
    description: 'Supply and install walk-through gates',
    costType: 'per_unit',
    defaultCost: 150.0,
    optional: true,
    triggerSignal: 'gate_count',
    triggerCondition: { operator: 'gt', value: 0 },
    quantitySource: { type: 'form_field', fieldId: 'gate_count' },
    unitLabel: 'gates',
  },
  {
    id: 'height_surcharge',
    name: 'Tall Fence Surcharge (8ft)',
    description: 'Extra materials and labor for 8ft fences',
    costType: 'per_unit',
    defaultCost: 15.0,
    optional: true,
    triggerSignal: 'fence_height_ft',
    triggerCondition: { operator: 'equals', value: '8 ft' },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
    unitLabel: 'linear ft',
  },
  {
    id: 'demolition',
    name: 'Old Fence Removal',
    description: 'Remove and dispose of existing fence',
    costType: 'per_unit',
    defaultCost: 8.0,
    optional: true,
    triggerSignal: 'job_type',
    triggerCondition: { operator: 'equals', value: 'Full Replacement' },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
    unitLabel: 'linear ft',
  },
  {
    id: 'staining',
    name: 'Wood Staining/Sealing',
    description: 'Apply protective stain/sealant (wood only)',
    costType: 'per_unit',
    defaultCost: 6.0,
    optional: true,
    triggerSignal: 'material_is_wood',
    triggerCondition: { operator: 'equals', value: true },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
    unitLabel: 'linear ft',
  },
  {
    id: 'repair_section',
    name: 'Section Repair Labour',
    description: 'Labour for partial repairs (reduced rate vs full install)',
    costType: 'per_unit',
    defaultCost: 25.0,
    optional: true,
    triggerSignal: 'job_type',
    triggerCondition: { operator: 'equals', value: 'Repair/Replace Sections' },
    quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' },
    unitLabel: 'linear ft',
  },
]

export const fenceAddons: AddonConfig[] = [
  {
    id: 'decorative_caps',
    label: 'Decorative Post Caps',
    price: 8.0,
    triggerKeywords: ['decorative', 'post caps', 'finishing touches'],
  },
  {
    id: 'gate_lock',
    label: 'Heavy-Duty Gate Lock',
    price: 45.0,
    triggerKeywords: ['lock', 'security', 'secure gate', 'secure'],
  },
  {
    id: 'lattice_top',
    label: 'Lattice Top Addition',
    price: 25.0,
    triggerKeywords: ['lattice', 'privacy', 'decorative top'],
  },
  {
    id: 'gravel_board',
    label: 'Gravel Boards (rot protection)',
    price: 12.0,
    triggerKeywords: ['gravel board', 'rot protection', 'wet ground'],
  },
  {
    id: 'concrete_spur',
    label: 'Concrete Repair Spurs',
    price: 35.0,
    triggerKeywords: ['concrete spur', 'wobbly post', 'leaning'],
  },
]

export const fencePricingRules: PricingRules = {
  baseFee: 0, // Using base_fee work step instead
  minimumCharge: 150.0,
  workSteps: fenceWorkSteps,
  addons: fenceAddons,
  multipliers: [
    // Material adjustments
    {
      when: { fieldId: 'material_type', operator: 'equals', equals: 'Cedar Wood' },
      multiplier: 1.2,
      label: 'Premium cedar material',
    },
    {
      when: { fieldId: 'material_type', operator: 'equals', equals: 'Composite' },
      multiplier: 1.35,
      label: 'Composite material upgrade',
    },
    // Ground condition adjustments
    {
      when: { fieldId: 'ground_type', operator: 'equals', equals: 'Rocky/Hard' },
      multiplier: 1.15,
      label: 'Difficult ground conditions',
    },
    {
      when: { fieldId: 'ground_type', operator: 'equals', equals: 'Sloped Terrain' },
      multiplier: 1.2,
      label: 'Sloped terrain adjustment',
    },
    // Urgency adjustments
    {
      when: { fieldId: 'urgency', operator: 'equals', equals: 'Urgent (within 3 days)' },
      multiplier: 1.25,
      label: 'Rush job surcharge',
    },
    {
      when: { fieldId: 'urgency', operator: 'equals', equals: 'Soon (within 1 week)' },
      multiplier: 1.1,
      label: 'Priority scheduling',
    },
  ],
}

export const fenceExpectedSignals: ExpectedSignalConfig[] = [
  { signalKey: 'job_type', type: 'enum', possibleValues: ['New Installation', 'Repair/Replace Sections', 'Full Replacement'], description: 'Type of fence work needed' },
  { signalKey: 'fence_length_ft', type: 'number', description: 'Total fence length in linear feet' },
  { signalKey: 'fence_height_ft', type: 'enum', possibleValues: ['4 ft', '6 ft', '8 ft'], description: 'Fence height' },
  { signalKey: 'material_type', type: 'enum', possibleValues: ['Cedar Wood', 'Pine Wood', 'Vinyl', 'Chain-link', 'Composite'], description: 'Fence material type' },
  { signalKey: 'gate_count', type: 'number', description: 'Number of gates needed' },
  { signalKey: 'post_condition', type: 'enum', possibleValues: ['N/A - New Install', 'Good - Reusable', 'Some Damaged', 'All Need Replacement'], description: 'Condition of existing posts' },
  { signalKey: 'ground_type', type: 'enum', possibleValues: ['Normal Soil', 'Rocky/Hard', 'Sloped Terrain'], description: 'Ground conditions at site' },
  { signalKey: 'material_is_wood', type: 'boolean', description: 'Whether material is wood (for staining)' },
]

export const fenceService: TestServiceConfig = {
  id: 'svc_fence',
  name: 'Fence Installation & Repair',
  description: 'Professional fence installation and repair services for residential properties. We install new fences, replace damaged sections, repair posts, and refinish existing fencing. Materials include wood (cedar, pine, redwood), vinyl, chain-link, and composite options.',
  scope_includes: [
    'New fence installation (wood, vinyl, chain-link, composite)',
    'Fence repair and section replacement',
    'Post repair/replacement',
    'Gate installation',
    'Old fence removal and disposal',
    'Wood staining and sealing',
  ],
  scope_excludes: [
    'Electrical work (for automatic gates)',
    'Permits and surveys (customer responsibility)',
    'Tree removal',
    'Major landscaping',
  ],
  default_assumptions: [
    'Standard residential property',
    'Ground conditions accessible by standard post-hole digger',
    'No underground utilities in fence line',
    'Posts spaced 8ft apart (standard)',
  ],
  work_steps: fenceWorkSteps,
  expected_signals: fenceExpectedSignals,
  low_confidence_mode: 'show_range',
  confidence_threshold: 0.7,
  high_value_threshold: 5000,
  media_config: {
    minPhotos: 1,
    maxPhotos: 6,
    photoGuidance: 'Please upload photos showing: (1) Full view of the fence line or area where fence will go, (2) Close-ups of any damaged sections, (3) Existing posts if repair needed, (4) Gate areas if applicable',
  },
}

// =============================================================================
// TAX CONFIGURATION
// =============================================================================

export const ukVat20: TaxConfig = {
  enabled: true,
  label: 'VAT',
  rate: 20,
}

// =============================================================================
// CUSTOMER SCENARIO 1: MINIMAL (Super Vague)
// =============================================================================

/**
 * Customer 1: MINIMAL
 * Description: "need fence fixed asap"
 * Form: Mostly blank, urgent urgency
 * Photos: Blurry, ~20ft visible, pine wood apparent
 *
 * Expected behavior: Use defaults, low confidence, show range
 */
export const minimalScenarioFormAnswers: FormAnswer[] = [
  { fieldId: 'job_type', value: 'Repair/Replace Sections' },
  { fieldId: 'fence_length_ft', value: 20 }, // AI-estimated from blurry photos (simulated as if merged into form)
  // fence_height_ft: (left blank)
  // material_type: (left blank)
  { fieldId: 'gate_count', value: 0 },
  // post_condition: (left blank)
  // ground_type: (left blank)
  { fieldId: 'urgency', value: 'Urgent (within 3 days)' },
  { fieldId: '_project_description', value: 'need fence fixed asap' },
]

// AI-detected signals from blurry photos (simulated)
// Note: In real system, AI-detected fence_length_ft would be merged into form answers
// if form field is blank. Here we simulate that by adding it to form answers above.
export const minimalScenarioAiSignals = {
  fence_height_ft: '6 ft', // Estimated
  material_type: 'Pine Wood', // Detected from close-up
  material_is_wood: true,
}

// =============================================================================
// CUSTOMER SCENARIO 2: DETAILED (Normal Customer)
// =============================================================================

/**
 * Customer 2: DETAILED
 * Description: Full details provided, cedar fence, replacement, two gates, staining
 *
 * Expected behavior: High confidence, accurate pricing
 */
export const detailedScenarioFormAnswers: FormAnswer[] = [
  { fieldId: 'job_type', value: 'Full Replacement' },
  { fieldId: 'fence_length_ft', value: 80 },
  { fieldId: 'fence_height_ft', value: '6 ft' },
  { fieldId: 'material_type', value: 'Cedar Wood' },
  { fieldId: 'gate_count', value: 2 },
  { fieldId: 'post_condition', value: 'N/A - New Install' },
  { fieldId: 'ground_type', value: 'Normal Soil' },
  { fieldId: 'urgency', value: 'Flexible (2+ weeks)' },
  { fieldId: '_project_description', value: "I'd like to replace my old wooden fence with a new cedar fence. The current fence is about 80 feet around the back garden. I need two gates - one for the side passage and one for the back. The ground is normal soil, nothing special. I'd also like it stained to protect the wood. Happy to wait a couple of weeks for scheduling." },
]

// Material type indicates wood - for staining trigger
export const detailedScenarioMaterialIsWood = true

// =============================================================================
// CUSTOMER SCENARIO 3: PRICE-SENSITIVE
// =============================================================================

/**
 * Customer 3: PRICE-SENSITIVE
 * Description: Budget-conscious, repair only, pine, no extras
 * Note mentions "wobbly" posts - should NOT trigger concrete spur addon
 * because they explicitly said "no extras"
 *
 * Expected behavior: Low cost, minimal extras, respect "no extras" request
 */
export const priceSensitiveScenarioFormAnswers: FormAnswer[] = [
  { fieldId: 'job_type', value: 'Repair/Replace Sections' },
  { fieldId: 'fence_length_ft', value: 24 },
  { fieldId: 'fence_height_ft', value: '6 ft' },
  { fieldId: 'material_type', value: 'Pine Wood' },
  { fieldId: 'gate_count', value: 0 },
  { fieldId: 'post_condition', value: 'Some Damaged' },
  { fieldId: 'ground_type', value: 'Normal Soil' },
  { fieldId: 'urgency', value: 'Flexible (2+ weeks)' },
  { fieldId: '_project_description', value: "Looking for quotes on repairing my fence. Only about 3 panels are damaged (roughly 24 feet). The posts seem OK except maybe 2 that are a bit wobbly. I'm on a tight budget so looking for the most economical option - pine is fine. No rush on timing. Please no extras." },
]

// =============================================================================
// CUSTOMER SCENARIO 4: URGENT/EMERGENCY
// =============================================================================

/**
 * Customer 4: URGENT/EMERGENCY
 * Description: Storm damage, dog escaping, needs 8ft fence, security lock
 *
 * Expected behavior: High cost (8ft surcharge, urgency, cedar, lock addon)
 */
export const urgentScenarioFormAnswers: FormAnswer[] = [
  { fieldId: 'job_type', value: 'Full Replacement' },
  { fieldId: 'fence_length_ft', value: 40 },
  { fieldId: 'fence_height_ft', value: '8 ft' },
  { fieldId: 'material_type', value: 'Cedar Wood' },
  { fieldId: 'gate_count', value: 1 },
  { fieldId: 'post_condition', value: 'All Need Replacement' },
  { fieldId: 'ground_type', value: 'Normal Soil' },
  { fieldId: 'urgency', value: 'Urgent (within 3 days)' },
  { fieldId: '_project_description', value: "URGENT!! Storm last night knocked down half my fence and my dog keeps escaping! Need this fixed immediately. The whole left side of the garden is down - about 40 feet. A tree fell on it so some posts are completely snapped. Don't care about cost just need it done NOW. Want it higher this time to keep the dog in - 8 foot if possible. Also need a secure lock on the gate." },
]

// =============================================================================
// CUSTOMER SCENARIO 5: CONFUSING/CONTRADICTORY
// =============================================================================

/**
 * Customer 5: CONFUSING/CONTRADICTORY
 * Description: Mixed fence types, uncertain measurements, multiple gates,
 * mentions slope but says rocky, wants decorative caps
 *
 * Expected behavior: Use form values over description confusion,
 * detect "decorative post caps" keyword, apply rocky ground multiplier
 */
export const confusingScenarioFormAnswers: FormAnswer[] = [
  { fieldId: 'job_type', value: 'Full Replacement' },
  { fieldId: 'fence_length_ft', value: 55 }, // Split the difference from "50-60ft"
  { fieldId: 'fence_height_ft', value: '6 ft' },
  { fieldId: 'material_type', value: 'Vinyl' },
  { fieldId: 'gate_count', value: 3 },
  { fieldId: 'post_condition', value: 'N/A - New Install' },
  { fieldId: 'ground_type', value: 'Rocky/Hard' }, // Rocky mentioned
  { fieldId: 'urgency', value: 'Soon (within 1 week)' },
  { fieldId: '_project_description', value: "Hi, we bought this house 6 months ago and the fence is a mess. Some parts are wood, some parts are chain link??? Previous owners were weird. I want to make it all match but not sure what material. Maybe vinyl? The back is about 60ft but there's a slope. Actually wait, it might be closer to 50ft, I'm not great with measurements. We have 2 gates, no wait, 3 gates I think - one is broken though. The soil in the back is really rocky from when they did construction. Need it done in the next week or so. Oh and if you do decorative post caps that would be nice." },
]
