/**
 * API request/response types for the Estimator platform
 */

import type {
  QuoteStatus,
  DocumentType,
  QuotePricing,
  QuoteContent,
  CrossServicePricing,
  SignalRecommendation,
  QuoteFeedback,
  AmendmentSource,
  FeedbackType,
  LearningPattern,
} from './database.types'

// ============================================================================
// Common Types
// ============================================================================

export interface ApiError {
  code: string
  message: string
  details?: unknown[]
}

export interface ApiErrorResponse {
  error: ApiError
}

// ============================================================================
// Auth API Types
// ============================================================================

export interface MeResponse {
  userId: string
  tenantId: string
  role: string
  email: string
  displayName: string | null
}

export interface SetupTenantRequest {
  businessName: string
}

export interface SetupTenantResponse {
  tenantId: string
  tenantName: string
}

// ============================================================================
// Public Quote API Types
// ============================================================================

export interface CustomerInput {
  name: string
  email: string
  phone?: string
}

export interface JobInput {
  address?: string
  postcodeOrZip?: string
  answers?: Array<{ fieldId: string; value: string | number | boolean | string[] }>
}

export interface SourceInput {
  type: 'widget' | 'whatsapp' | 'api'
  pageUrl?: string
  userAgent?: string
}

export interface CreateQuoteRequest {
  tenantKey: string
  serviceId: string
  customer: CustomerInput
  job?: JobInput
  assetIds?: string[]
  source?: SourceInput
}

export interface CreateQuoteResponse {
  quoteId: string
  status: QuoteStatus
  quoteViewUrl: string
  tokenExpiresAt: string
}

// ============================================================================
// Public Clarification API Types (Phase 4: Quality Gate)
// ============================================================================

export interface ClarifyQuoteRequest {
  token: string
  answers: Array<{ questionId: string; answer: string }>
}

export interface ClarifyQuoteResponse {
  success: boolean
  message: string
}

// ============================================================================
// Public Quote View API Types
// ============================================================================

export interface QuoteViewBusiness {
  name: string
  logoUrl?: string
}

export interface QuoteViewCustomer {
  name: string
}

export interface QuoteViewAsset {
  assetId: string
  type: 'image' | 'document'
  viewUrl: string
}

export interface QuoteViewActions {
  acceptUrl: string
  payUrl?: string
  pdfUrl?: string
}

export interface QuoteViewResponse {
  quoteId: string
  status: QuoteStatus
  documentType: DocumentType
  /** Quote version (incremented on each business edit) */
  version?: number
  business: QuoteViewBusiness
  customer: QuoteViewCustomer
  pricing: QuotePricing
  breakdown: Array<{
    label: string
    amount: number
    autoRecommended?: boolean
    recommendationReason?: string
  }>
  notes: QuoteContent
  validUntil?: string
  assets: QuoteViewAsset[]
  actions: QuoteViewActions
  /** Pricing for additional services mentioned by the customer */
  crossServicePricing?: CrossServicePricing[]
  /** AI-recommended additional work based on unused signals */
  signalRecommendations?: SignalRecommendation[]
  /** Whether the Accept Quote button is shown to customers */
  acceptQuoteEnabled?: boolean
}

export interface AcceptQuoteRequest {
  token: string
}

export interface AcceptQuoteResponse {
  status: 'accepted'
  acceptedAt: string
}

// ============================================================================
// Upload API Types
// ============================================================================

export interface FileInput {
  fileName: string
  contentType: string
  sizeBytes: number
}

export interface InitUploadsRequest {
  tenantKey: string
  files: FileInput[]
}

export interface UploadIntent {
  assetId: string
  uploadUrl: string
  method: 'PUT'
}

export interface InitUploadsResponse {
  uploads: UploadIntent[]
  errors?: Array<{ fileName: string; error: string }>
}

// ============================================================================
// Dashboard API Types
// ============================================================================

export interface TenantSettingsResponse {
  tenantId: string
  name: string
  currency: string
  tax: {
    enabled: boolean
    label?: string
    rate?: number
  }
  serviceArea: {
    mode: 'none' | 'postcode_allowlist' | 'county_state'
    values: string[]
  }
}

export interface UpdateTenantRequest {
  name?: string
  currency?: string
  tax?: {
    enabled: boolean
    label?: string
    rate?: number
  }
  serviceArea?: {
    mode: 'none' | 'postcode_allowlist' | 'county_state'
    values: string[]
  }
}

export interface ServiceResponse {
  serviceId: string
  name: string
  active: boolean
  documentTypeDefault: DocumentType
}

export interface QuoteListItem {
  quoteId: string
  serviceName: string
  customerName: string
  customerEmail: string
  status: QuoteStatus
  createdAt: string
  sentAt: string | null
  viewedAt: string | null
  acceptedAt: string | null
  paidAt: string | null
  total: number
  currency: string
}

export interface QuotesListResponse {
  items: QuoteListItem[]
  nextCursor: string | null
}

// ============================================================================
// Analytics API Types
// ============================================================================

export interface AnalyticsMetrics {
  totalQuotes: number
  quotesViewed: number
  quotesAccepted: number
  quotesPaid: number
  conversionRate: number // percentage (0-100)
}

export interface UsageData {
  periodYYYYMM: string
  estimatesCreated: number
  estimatesSent: number
  planLimit: number
  planName: string
}

export interface AnalyticsResponse {
  metrics: AnalyticsMetrics
  usage: UsageData
}

// ============================================================================
// Billing API Types
// ============================================================================

export interface PlanInfo {
  id: string
  name: string
  monthlyEstimateLimit: number
  priceCents: number
  currency: string
  features: {
    pdfGeneration: boolean
    emailNotifications: boolean
    customBranding: boolean
    prioritySupport: boolean
    apiAccess: boolean
  }
  stripePriceId?: string
}

export interface SubscriptionInfo {
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'none'
  plan: PlanInfo | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  stripeCustomerId: string | null
}

export interface BillingUsage {
  estimatesCreated: number
  estimatesSent: number
  planLimit: number
  periodStart: string
  periodEnd: string
}

export interface BillingResponse {
  subscription: SubscriptionInfo
  usage: BillingUsage
  availablePlans: PlanInfo[]
}

export interface CreateCheckoutRequest {
  planId: string
}

export interface CreateCheckoutResponse {
  checkoutUrl: string
}

export interface CreatePortalResponse {
  portalUrl: string
}

// ============================================================================
// Quote Edit API Types
// ============================================================================

export interface UpdateQuoteRequest {
  /** Optimistic lock — must match current DB version */
  version: number
  /** Full updated pricing */
  pricing_json: QuotePricing
  /** Full updated content */
  content_json: QuoteContent
  /** Internal notes visible only to business */
  business_notes?: string
  /** If true, send/re-send email after saving */
  sendToCustomer?: boolean
  /** If responding to feedback, link this feedback ID */
  feedbackId?: string
}

export interface UpdateQuoteResponse {
  quoteId: string
  version: number
  status: QuoteStatus
  updatedAt: string
}

// ============================================================================
// Customer Feedback API Types
// ============================================================================

export interface SubmitFeedbackRequest {
  token: string
  feedbackType: FeedbackType
  feedbackText?: string
}

export interface SubmitFeedbackResponse {
  success: boolean
  message: string
}

// ============================================================================
// Quote Detail API Types (enriched response for business dashboard)
// ============================================================================

export interface AmendmentSummary {
  id: string
  version: number
  source: AmendmentSource
  changeCount: number
  createdAt: string
  amendedBy: string
}

export interface QuoteDetailResponse {
  quote: {
    id: string
    tenant_id: string
    quote_request_id: string
    service_id: string
    customer_json: { name: string; email: string; phone?: string }
    pricing_json: QuotePricing
    document_type: DocumentType
    content_json: QuoteContent
    status: QuoteStatus
    business_notes: string | null
    version: number
    last_amended_at: string | null
    last_amended_by: string | null
    created_at: string
    sent_at: string | null
    viewed_at: string | null
    accepted_at: string | null
    paid_at: string | null
    signals_json?: unknown
    pricing_trace_json?: unknown
    triage_json?: unknown
    quality_gate_json?: unknown
  }
  service: {
    id: string
    name: string
    description: string | null
    work_steps: unknown[]
    expected_signals: unknown[]
  }
  amendments: AmendmentSummary[]
  feedback: QuoteFeedback[]
}

// ============================================================================
// Learning API Types
// ============================================================================

export interface LearningContextResponse {
  serviceId: string
  serviceName: string
  patterns: LearningPattern[]
  promptContext: string | null
  totalAmendmentsAnalyzed: number
  lastAnalyzedAt: string | null
}

export interface AnalyzeLearningRequest {
  serviceId: string
}

export interface AnalyzeLearningResponse {
  success: boolean
  patternsFound: number
  message: string
}
