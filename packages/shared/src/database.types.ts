/**
 * Database types for the Estimator platform
 * These types correspond to the Supabase schema
 */

// ============================================================================
// ENUMS
// ============================================================================

export type ServiceAreaMode = 'none' | 'postcode_allowlist' | 'county_state'
export type DocumentType = 'instant_estimate' | 'formal_quote' | 'proposal' | 'sow'
export type QuoteStatus =
  | 'queued'
  | 'generating'
  | 'pending_review'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'paid'
  | 'expired'
  | 'failed'
export type AssetType = 'image' | 'document' | 'pdf'
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing'

// ============================================================================
// TABLE TYPES
// ============================================================================

export interface TenantBranding {
  logoAssetId: string | null
  primaryColor: string
  footerNotes: string | null
}

export interface TenantTemplate {
  showLineItems: boolean
  includeAssumptions: boolean
  includeExclusions: boolean
  validityDays: number
}

export interface Tenant {
  id: string
  name: string
  currency: string
  tax_enabled: boolean
  tax_label: string | null
  tax_rate: number
  service_area_mode: ServiceAreaMode
  service_area_values: string[]
  branding_json: TenantBranding
  template_json: TenantTemplate
  notification_email: string | null
  default_terms_text: string | null
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string // UUID from auth.users
  tenant_id: string
  role: string
  display_name: string | null
  created_at: string
  updated_at: string
}

export interface TenantSite {
  id: string
  tenant_id: string
  domain: string
  tenant_key: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ServiceMediaConfig {
  minPhotos: number
  maxPhotos: number
  photoGuidance: string | null
  /** Required photo angles with guidance (e.g., "full view", "close-up of damage") */
  requiredAngles?: Array<{
    id: string
    label: string
    guidance?: string
  }>
}

// ============================================================================
// WORK-STEP PRICING MODEL TYPES
// ============================================================================

/**
 * Quantity source for per-unit/per-hour pricing
 * Explicitly declares where the quantity comes from for deterministic pricing
 */
export interface QuantitySource {
  /** Source type for the quantity */
  type: 'form_field' | 'constant' | 'ai_signal'
  /** For form_field: which question provides the quantity */
  fieldId?: string
  /** For constant: fixed quantity (e.g., 1 for "Kitchen" which is always 1 per house) */
  value?: number
  /** For ai_signal: which AI signal to use (use with caution - lower trust) */
  signalKey?: string
}

/**
 * Work step configuration - a standard operation with cost rules
 */
export interface WorkStepConfig {
  id: string
  name: string
  description: string
  costType: 'fixed' | 'per_unit' | 'per_hour'
  /** Default cost (fixed amount, or per-unit/hour rate) - used as starting point, can be overridden */
  defaultCost: number
  /** Optional steps only apply when trigger condition is met */
  optional: boolean
  /** Signal key that determines if this step is needed */
  triggerSignal?: string
  /** Condition for triggering this step */
  triggerCondition?: {
    operator: 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists'
    value?: string | number | boolean
  }
  /**
   * Explicit quantity source (required for per_unit/per_hour)
   * - form_field: Use value from customer's form answer (most trusted)
   * - constant: Fixed quantity (e.g., always 1)
   * - ai_signal: Use AI-extracted signal (legacy, lower trust)
   */
  quantitySource?: QuantitySource
  /** Display label for quantity (e.g., "bedrooms", "sq ft", "hours") */
  unitLabel?: string
}

/**
 * Expected signal configuration - what AI should extract
 */
export interface ExpectedSignalConfig {
  /** Unique key for this signal (e.g., "item_count", "surface_area") */
  signalKey: string
  /** Data type of the signal value */
  type: 'number' | 'enum' | 'boolean' | 'string'
  /** For enum type: possible values */
  possibleValues?: string[]
  /** Human-readable description of what this signal represents */
  description: string
}

/**
 * AI draft configuration - complete starter blueprint
 */
export interface ServiceDraftConfig {
  scope: {
    included: string[]
    excluded: string[]
    assumptions: string[]
  }
  media: {
    minPhotos: number
    maxPhotos: number
    photoGuidance: string
    requiredAngles?: Array<{
      id: string
      label: string
      guidance?: string
    }>
  }
  pricing: {
    pricingModel: 'fixed' | 'per_unit' | 'tiered' | 'inspection_first'
    unitType: string | null
    baseFee: number
    minimumCharge: number
    workSteps: WorkStepConfig[]
    addOns: Array<{
      name: string
      price: number
      description: string
    }>
    siteVisit: {
      alwaysRecommend: boolean
      confidenceBelowPct: number
      estimateAbove: number
    }
  }
  expectedSignals: ExpectedSignalConfig[]
  suggestedFields: SuggestedField[]
}

/**
 * A customer question/form field configuration
 */
export interface SuggestedField {
  label: string
  fieldId: string
  type: 'text' | 'textarea' | 'number' | 'dropdown' | 'radio' | 'checkbox' | 'boolean'
  required: boolean
  options?: string[]
  helpText?: string
  /** Whether this field is critical for accurate pricing */
  criticalForPricing?: boolean
  /**
   * Explicit mapping to a signal key.
   * For criticalForPricing fields, this MUST match a signalKey from expectedSignals.
   */
  mapsToSignal?: string
}

/**
 * Low confidence fallback mode
 */
export type LowConfidenceMode = 'show_range' | 'require_review' | 'request_more_info' | 'recommend_site_visit'

export interface Service {
  id: string
  tenant_id: string
  name: string
  description: string | null
  scope_includes: string[]
  scope_excludes: string[]
  default_assumptions: string[]
  media_config: ServiceMediaConfig
  active: boolean
  document_type_default: DocumentType
  /** Keywords that identify this service for cross-service detection */
  detection_keywords?: string[]
  /** Custom AI guidance for this service (industry-specific counting rules, etc.) */
  prompt_context?: string | null
  /** AI-generated draft configuration (complete starter blueprint) */
  draft_config?: ServiceDraftConfig | null
  /** Version number for tracking draft config updates */
  draft_config_version: number
  /** Timestamp when the draft config was generated */
  draft_config_generated_at?: string | null
  /** Work steps configuration - standard operations with cost rules */
  work_steps: WorkStepConfig[]
  /** Expected signals - what AI should extract from photos/form */
  expected_signals: ExpectedSignalConfig[]
  /** How to handle low confidence estimates */
  low_confidence_mode: LowConfidenceMode
  /** Confidence threshold for triggering fallback (0-1) */
  confidence_threshold: number
  /** High value threshold for triggering fallback */
  high_value_threshold?: number | null
  /** Pricing rules (base fee, add-ons, multipliers) - consolidated from standalone pricing table */
  pricing_rules?: PricingRules
  created_at: string
  updated_at: string
}

export type MeasurementUnit = 'sqft' | 'sqm' | 'room' | 'item' | 'hour' | 'linear_ft' | 'linear_m'

export interface MeasurementModel {
  type: 'fixed' | 'per_unit'
  unit: MeasurementUnit | null
  unitLabel: string | null
  pricePerUnit: number
  askCustomerForQuantity: boolean
}

export interface SiteVisitRules {
  alwaysRecommend: boolean
  recommendWhenConfidenceBelow: number | null  // 0-1 scale
  recommendWhenEstimateAbove: number | null    // dollar amount
}

/**
 * Item catalog entry for inventory-based pricing (rentals, events, etc.)
 */
export interface ItemCatalogEntry {
  id: string
  name: string                 // "Chiavari Chair"
  aliases?: string[]           // ["tiffany chair", "ballroom chair"]
  pricePerUnit: number         // 8.50
  category?: string            // "seating", "tables", "decor"
}

/**
 * Detected item from AI image analysis
 */
export interface DetectedItem {
  itemType: string             // "round table", "chiavari chair", "chandelier"
  quantity: number             // 8, 64, 2
  confidence: number           // 0.0-1.0
  description?: string         // "silver chiavari chairs with cushions"
}

/**
 * Matched item - detected item linked to catalog entry
 */
export interface MatchedItem extends DetectedItem {
  catalogId: string            // ID of matched catalog item
  catalogName: string          // Name from catalog
  pricePerUnit: number         // Price from catalog
  matchConfidence: number      // How confident the match is (0-1)
}

/**
 * Cross-service pricing - pricing for additional services mentioned by customer
 */
export interface CrossServicePricing {
  serviceId: string
  serviceName: string
  reason: string               // Why this service was detected (e.g., "You mentioned wall painting")
  baseFee: number
  estimatedTotal: number
  breakdown: string[]
  extractedDetails: string[]   // Details extracted by AI from description
  isEstimate: boolean          // True if low confidence
  note: string                 // Contextual note about the estimate
}

/**
 * AI-generated recommendation for unused signals
 * When AI extracts signals that aren't used by any pricing work step,
 * this captures the AI's recommendation for potential additional work
 *
 * NOTE (AD-001 Compliance): Prices are NOT included in recommendations.
 * AI cannot set prices - all pricing must come from business configuration.
 * Recommendations only suggest WHAT might be needed, not how much it costs.
 */
export interface SignalRecommendation {
  /** The signal key that triggered this recommendation */
  signalKey: string
  /** The value of the signal (e.g., true, "poor", 5) */
  signalValue: string | number | boolean
  /** AI-generated description of recommended work (3-5 words) */
  workDescription: string
  /**
   * @deprecated No longer used - violates AD-001 (AI cannot set prices).
   * Kept for backward compatibility with existing stored quotes.
   */
  estimatedCost?: number
  /**
   * Brief description of what the work entails (no prices).
   * E.g., "May require component replacement" instead of "£150 for parts"
   */
  costBreakdown: string
  /** Confidence from the original signal extraction (0-1) */
  confidence: number
  /** Evidence from original signal (why AI thinks this is needed) */
  evidence: string
  /** Always true - these are AI suggestions, not configured pricing */
  isEstimate: boolean
}

export interface AddonConfig {
  id: string
  label: string
  price: number
  /** Keywords that trigger automatic inclusion of this addon */
  triggerKeywords?: string[]
  /** Conditions detected from images that trigger this addon (e.g., 'oil_stains', 'weed_growth') */
  triggerConditions?: string[]
}

export interface MultiplierConfig {
  when: {
    fieldId: string
    operator?: string
    equals?: string | number | boolean
    value?: string | number
  }
  multiplier: number
}

export interface PricingRules {
  baseFee: number
  minimumCharge: number
  addons: AddonConfig[]
  multipliers: MultiplierConfig[]
  measurementModel?: MeasurementModel
  siteVisitRules?: SiteVisitRules
  /** Item catalog for inventory-based pricing (rentals, events, etc.) */
  itemCatalog?: ItemCatalogEntry[]
}

export interface ServicePricingRule {
  id: string
  tenant_id: string
  service_id: string
  rules_json: PricingRules
  created_at: string
  updated_at: string
}

export interface WidgetField {
  fieldId: string
  type: 'text' | 'number' | 'select' | 'multiselect' | 'boolean'
  label: string
  required: boolean
  options?: Array<{ value: string; label: string }>
  placeholder?: string
  helpText?: string
  /**
   * Explicit mapping to a signal key for pricing.
   * When set, the form value will be used as this signal in pricing calculations.
   * This is the source of truth for form-to-signal mapping.
   */
  mapsToSignal?: string
  /** Whether this field is critical for accurate pricing */
  criticalForPricing?: boolean
}

export interface WidgetFileConfig {
  minPhotos: number
  maxPhotos: number
  maxDocs: number
}

export interface WidgetConfigJson {
  fields: WidgetField[]
  files: WidgetFileConfig
}

export interface WidgetConfig {
  id: string
  tenant_id: string
  service_id: string | null
  config_json: WidgetConfigJson
  created_at: string
  updated_at: string
}

export interface Asset {
  id: string
  tenant_id: string
  quote_request_id: string | null
  type: AssetType
  file_name: string
  content_type: string
  size_bytes: number
  r2_key: string
  created_at: string
}

export interface QuoteRequestAnswer {
  fieldId: string
  value: string | number | boolean | string[]
}

export interface QuoteRequestSource {
  type: 'widget' | 'whatsapp' | 'api'
  pageUrl?: string
  userAgent?: string
}

export interface QuoteRequest {
  id: string
  tenant_id: string
  service_id: string
  customer_name: string
  customer_email: string
  customer_phone: string | null
  job_postcode: string | null
  job_address: string | null
  job_answers: QuoteRequestAnswer[]
  asset_ids: string[]
  source_json: QuoteRequestSource
  created_at: string
}

export interface QuoteCustomer {
  name: string
  email: string
  phone?: string
}

export interface QuotePricing {
  currency: string
  subtotal: number
  taxLabel?: string
  taxRate?: number
  taxAmount: number
  total: number
  breakdown: Array<{
    label: string
    amount: number
    /** Whether this addon was auto-recommended by AI */
    autoRecommended?: boolean
    /** Reason for auto-recommendation */
    recommendationReason?: string
  }>
  /** Pricing notes - warnings, site visit recommendations, etc. */
  notes?: string[]
}

export interface QuoteContent {
  scopeSummary?: string
  assumptions?: string[]
  exclusions?: string[]
  notes?: string
  validityDays?: number
}

// ============================================================================
// STRUCTURED SIGNAL EXTRACTION TYPES
// ============================================================================

/**
 * Individual extracted signal with confidence and provenance
 */
export interface ExtractedSignal {
  /** Signal key matching expectedSignals.signalKey */
  key: string
  /** Extracted value (number, string, boolean) */
  value: number | string | boolean
  /** Confidence for this specific signal (0-1) */
  confidence: number
  /** Source of the signal */
  source: 'vision' | 'form' | 'nlp' | 'inferred'
  /** Brief explanation or photo reference */
  evidence?: string
}

/**
 * Complete extracted signals with structured array
 */
export interface ExtractedSignalsV2 {
  extractedAt: string
  overallConfidence: number

  /** Structured signals array matching service's expectedSignals */
  signals: ExtractedSignal[]

  /** Legacy fields for backwards compatibility */
  dimensions?: {
    type: 'area' | 'linear' | 'count'
    value: number
    unit: string
    isEstimate: boolean
  }
  condition?: {
    rating: 'good' | 'fair' | 'poor' | 'unknown'
    notes?: string
  }
  complexity?: {
    level: 'low' | 'medium' | 'high' | 'unknown'
    factors: string[]
  }

  /** Flags */
  siteVisitRecommended: boolean
  siteVisitReason?: string
  lowConfidenceSignals: string[]
}

// ============================================================================
// PRICING TRACE TYPES
// ============================================================================

/**
 * Individual step in the pricing calculation trace
 */
export interface PricingTraceStep {
  type: 'base_fee' | 'work_step' | 'addon' | 'multiplier' | 'minimum' | 'tax' | 'inventory' | 'measurement'
  /** ID of the work step, addon, or multiplier */
  id?: string
  /** Human-readable description of this step */
  description: string
  /** Signals that influenced this calculation */
  signalsUsed: Array<{ key: string; value: string | number | boolean }>
  /** Formula or calculation explanation (e.g., "5 items × $50/item") */
  calculation: string
  /** Amount added/subtracted in this step */
  amount: number
  /** Running total after this step */
  runningTotal: number
  /** For per-unit steps: where the quantity came from */
  quantitySource?: 'form_field' | 'constant' | 'ai_signal' | 'legacy_fallback'
  /** Whether the quantity is fully trusted (form/constant) vs estimated (AI) */
  quantityTrusted?: boolean
}

/**
 * Complete pricing trace for a quote
 */
export interface PricingTrace {
  calculatedAt: string
  /** Version of the pricing config used */
  configVersion: string

  /** Step-by-step calculation trace */
  trace: PricingTraceStep[]

  /** Summary of pricing components */
  summary: {
    baseFee: number
    workStepsTotal: number
    addonsTotal: number
    inventoryTotal?: number
    measurementTotal?: number
    multiplierAdjustment: number
    minimumApplied: boolean
    taxAmount: number
    total: number
  }
}

export interface Quote {
  id: string
  tenant_id: string
  quote_request_id: string
  service_id: string
  customer_json: QuoteCustomer
  pricing_json: QuotePricing
  document_type: DocumentType
  content_json: QuoteContent
  status: QuoteStatus
  quote_token_hash: string | null
  token_expires_at: string | null
  pdf_asset_id: string | null
  /** Complete extracted signals from AI analysis */
  signals_json?: ExtractedSignalsV2 | null
  /** Step-by-step pricing calculation trace */
  pricing_trace_json?: PricingTrace | null
  created_at: string
  sent_at: string | null
  viewed_at: string | null
  accepted_at: string | null
  paid_at: string | null
}

export interface PlanFeatures {
  pdf_generation: boolean
  email_notifications: boolean
  custom_branding: boolean
  priority_support: boolean
  api_access: boolean
}

export interface Plan {
  id: string
  name: string
  monthly_estimate_limit: number
  price_cents: number
  features_json: PlanFeatures
  is_active: boolean
  created_at: string
}

export interface Subscription {
  id: string
  tenant_id: string
  plan_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: SubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  created_at: string
  updated_at: string
}

export interface UsageCounter {
  id: string
  tenant_id: string
  period_yyyymm: string
  estimates_created: number
  estimates_sent: number
  created_at: string
  updated_at: string
}

// ============================================================================
// WHATSAPP TYPES
// ============================================================================

export interface WhatsAppConfig {
  id: string
  tenant_id: string
  phone_number_id: string
  display_phone_number: string
  access_token_encrypted: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type WhatsAppMessageDirection = 'inbound' | 'outbound'
export type WhatsAppMessageType = 'text' | 'image' | 'document' | 'template'

export interface WhatsAppMessage {
  id: string
  tenant_id: string
  conversation_id: string
  wa_message_id: string | null
  direction: WhatsAppMessageDirection
  message_type: WhatsAppMessageType
  from_phone: string
  to_phone: string
  content: string | null
  media_url: string | null
  status: string
  created_at: string
}

export type WhatsAppIntakeState =
  | 'idle'
  | 'awaiting_service'
  | 'awaiting_name'
  | 'awaiting_email'
  | 'awaiting_phone'
  | 'awaiting_address'
  | 'awaiting_photos'
  | 'awaiting_confirmation'
  | 'processing'
  | 'completed'

export interface WhatsAppIntakeData {
  serviceId?: string
  serviceName?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  jobAddress?: string
  jobPostcode?: string
  assetIds?: string[]
  photoCount?: number
}

export interface WhatsAppConversation {
  id: string
  tenant_id: string
  customer_phone: string
  customer_name: string | null
  quote_request_id: string | null
  status: 'active' | 'completed' | 'expired'
  intake_state: WhatsAppIntakeState
  intake_data: WhatsAppIntakeData | null
  created_at: string
  updated_at: string
}

// ============================================================================
// INSERT TYPES (for creating new records)
// ============================================================================

export type TenantInsert = Omit<Tenant, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
}

export type ServiceInsert = Omit<
  Service,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'draft_config_version'
  | 'work_steps'
  | 'expected_signals'
  | 'low_confidence_mode'
  | 'confidence_threshold'
> & {
  id?: string
  draft_config_version?: number
  work_steps?: WorkStepConfig[]
  expected_signals?: ExpectedSignalConfig[]
  low_confidence_mode?: LowConfidenceMode
  confidence_threshold?: number
}

export type QuoteRequestInsert = Omit<QuoteRequest, 'id' | 'created_at'> & {
  id?: string
}

export type QuoteInsert = Omit<Quote, 'id' | 'created_at'> & {
  id?: string
}

export type AssetInsert = Omit<Asset, 'id' | 'created_at'> & {
  id?: string
}
