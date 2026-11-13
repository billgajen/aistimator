/**
 * API request/response types for the Estimator platform
 */

import type { QuoteListCounts, QuoteListGroup } from './quote-turn'
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
  ClarificationQuestion,
  TakeoffEntry,
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
  type: 'widget' | 'whatsapp' | 'api' | 'app'
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
  tagline?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
}

/** Tenant branding surfaced on the hosted quote page */
export interface QuoteViewBranding {
  primaryColor?: string
  footerNotes?: string | null
  /** false on white-label plans (custom_branding) — hides the Aistimator badge */
  showPoweredBy?: boolean
}

export interface QuoteViewCustomer {
  name: string
  /** T-151: the customer's own phone (the link holder typed it), to confirm on accept */
  phone?: string | null
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
  /** T-133: BCP 47 locale from the tenant's region (money, numbers, dates) */
  locale?: string
  /** Quote version (incremented on each business edit) */
  version?: number
  business: QuoteViewBusiness
  branding?: QuoteViewBranding
  customer: QuoteViewCustomer
  /** T-146: never carries `estimate` (grade/label/confidence are business-only) */
  pricing: Omit<QuotePricing, 'estimate'>
  /**
   * T-109 range-first: present when the quote is not yet final
   * (awaiting_clarification / pending_review). Exact pricing is withheld and
   * the customer sees this estimated range instead.
   */
  provisional?: {
    rangeLow: number
    rangeHigh: number
    reason: 'awaiting_clarification' | 'pending_review'
  }
  /**
   * T-146: the customer-facing state. 'estimate' = not yet reviewed by the
   * business ("This is an estimate based on your photos and details"),
   * 'quote' = approved ("Reviewed and confirmed by {business}"). Grades and
   * confidence never reach the customer (they stay in pricing_json).
   *
   * T-147: `confirmationPending` = the estimate is shown before the business
   * approved it (status is still pending_review). Real pricing is returned,
   * Accept is locked until the business confirms.
   */
  review: { state: 'estimate' | 'quote'; approvedAt?: string; confirmationPending?: boolean }
  /** T-146: a price range for uncertain quantities on an unreviewed estimate. No label. */
  estimateRange?: { low: number; high: number }
  /** Questions to answer when status is awaiting_clarification (T-108) */
  clarificationQuestions?: ClarificationQuestion[]
  /** T-122: quantity takeoff with measurement methods */
  takeoff?: TakeoffEntry[]
  /** T-122: human-facing estimate reference (EST-2026-XXXXXX) */
  reference?: string
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
  /**
   * T-157: the customer asked a question the business has not answered yet.
   * The page keeps its "Message sent" note (also after a reload) and offers no
   * second question; Accept and Decline stay available.
   */
  questionPending?: boolean
}

export interface AcceptQuoteRequest {
  token: string
  /** T-151: when suits the customer, the job address and a phone number */
  details?: {
    timing: 'asap' | 'two_weeks' | 'flexible'
    timingNote?: string | null
    address: string
    phone: string
  }
}

export interface AcceptQuoteResponse {
  status: 'accepted'
  acceptedAt: string
}

export interface DeclineQuoteRequest {
  token: string
  /** Optional reason shown to the business (max 500 chars) */
  reason?: string
}

export interface DeclineQuoteResponse {
  status: 'declined'
  declinedAt: string
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
  /** T-150: the owner's test request from setup (not counted toward usage) */
  isTest?: boolean
  /** T-158: for the detail line and next step (quote-turn.ts) */
  declinedAt?: string | null
  /** T-158: when the customer's link runs out */
  expiresAt?: string | null
  /** T-158: saved but not priced, because the plan limit was reached */
  held?: boolean
}

export interface QuotesListResponse {
  items: QuoteListItem[]
  nextCursor: string | null
  /** T-158: how many quotes are in each tab (they follow the search text) */
  counts?: QuoteListCounts
  /** T-158: the group these items are from (`group=default` resolves to one) */
  group?: QuoteListGroup
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
  /** T-152: 'total' = the free allowance (estimatesCreated counts every month) */
  per?: 'month' | 'total'
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
  /** T-102: per-quote price beyond the monthly limit (null/absent = hard block) */
  overagePriceCents?: number | null
  features: {
    pdfGeneration: boolean
    emailNotifications: boolean
    customBranding: boolean
    prioritySupport: boolean
    apiAccess: boolean
    /** T-134 */
    calibrationInsights?: boolean
    lidarScanning?: boolean
    multipleUsers?: boolean
  }
  stripePriceId?: string
  /** T-134: plan definitions in @estimator/shared/plans */
  tagline?: string
  annualPriceCents?: number | null
  trialDays?: number | null
  channels?: string[]
  recommended?: boolean
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
  /** T-102: quotes beyond the plan limit this period (billed as overage when enabled) */
  overageUsed?: number
  /** T-102: per-quote overage price on the current plan (null = overage not available) */
  overagePriceCents?: number | null
  /** T-134: 'ok' < 80% ≤ 'warning' < 100% ≤ 'limit' */
  level?: 'ok' | 'warning' | 'limit'
  /** T-134: leads captured but not priced because the limit was reached */
  heldLeads?: number
  /** T-152: 'total' = the free allowance (counted across all months, never resets) */
  per?: 'month' | 'total'
}

export interface BillingResponse {
  subscription: SubscriptionInfo
  usage: BillingUsage
  availablePlans: PlanInfo[]
  /** T-150: the plan picked on the pricing page before signup (pre-selected; never starts checkout) */
  selectedPlanId?: string | null
}

export interface CreateCheckoutRequest {
  planId: string
  /** T-134: monthly (default) or annual billing */
  interval?: 'monthly' | 'annual'
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
    /** T-143: what the business finally invoiced (null until recorded) */
    final_invoice_amount?: number | string | null
    final_invoice_recorded_at?: string | null
    final_invoice_note?: string | null
    signals_json?: unknown
    pricing_trace_json?: unknown
    triage_json?: unknown
    quality_gate_json?: unknown
    /** T-146: when the business approved it */
    approved_at?: string | null
    /** T-158: for the tracker's final step */
    declined_at?: string | null
    token_expires_at?: string | null
    /** T-147: why a pending_review quote awaits the business: shown | held | check */
    review_hold?: 'shown' | 'held' | 'check' | null
    /** T-150: the owner's test request from setup */
    is_test?: boolean
    /** T-151: timing, job address and phone the customer gave when accepting */
    acceptance_json?: {
      timing: 'asap' | 'two_weeks' | 'flexible'
      timingNote: string | null
      address: string
      phone: string
      submittedAt: string
    } | null
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
  /** T-157: the tenant has an active SMS number, so "Text link" can work */
  smsActive?: boolean
}

/** T-157: POST /api/quotes/:quoteId/feedback/:feedbackId/answered */
export interface MarkFeedbackAnsweredResponse {
  feedbackId: string
  feedbackStatus: 'acknowledged' | 'resolved'
  /** The quote's status afterwards (feedback_received → viewed once nothing is pending) */
  quoteStatus: QuoteStatus
  pendingLeft: number
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

// ============================================================================
// Business mobile app API (T-137) — bearer-authenticated, /api/app/*
// ============================================================================

export interface AppBootstrapResponse {
  tenantName: string
  /** The tenant's widget key: the app uses the widget's public form and upload endpoints */
  tenantKey: string
  currency: string
  region: { code: string; locale: string; postalCodeLabel: string }
}

export interface AppCreateQuoteRequest {
  serviceId: string
  customer: CustomerInput
  job?: Omit<JobInput, 'quantity'>
  assetIds?: string[]
  /** T-138: LiDAR room scan (RoomScanPayload), validated server-side */
  scan?: unknown
}

export interface AppQuoteView {
  id: string
  status: QuoteStatus
  businessName: string
  serviceName: string
  customerName: string
  createdAt: string
  pricing: {
    total: number
    currency: string
    estimate?: { grade: 'A' | 'B' | 'C'; label: string; description: string; rangeLow?: number; rangeHigh?: number }
  }
  takeoff: Array<{ item: string; amount: number; method: string; quantity?: number; unit?: string }>
  /** Open confirmation questions (status awaiting_clarification) */
  questions: Array<{
    id: string
    question: string
    type?: 'confirm_value' | 'text'
    aiValue?: string | number
    evidence?: string
    options?: string[]
  }>
}
