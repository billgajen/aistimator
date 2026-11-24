// Shared types and utilities for the Qolumns platform

// Re-export database types
export * from './database.types'

// Re-export API types
export * from './api.types'

// Re-export outcome calibration (T-110)
export * from './calibration'

// Re-export rate benchmarks (T-115)
export * from './benchmarks'

// Re-export plausibility envelopes (T-116, Measurement Engine)
export * from './envelopes'

// Re-export estimate grading + VOI (T-120/T-121, Measurement Engine)
export * from './grading'
// T-146: customer-facing language guard (no grades / certainty words)
export * from './customer-language'
export * from './review-mode'
export * from './wording-repair'
export * from './identification'
export * from './room-scan'
export * from './room-scan-report'
export * from './scan-spec'
export * from './accuracy'

// Re-export deterministic quantity formulas (T-125)
export * from './formula'

// Re-export region layer, units and locale formatting (T-133, AD-025)
export * from './regions'
// T-201: the one service-area rule (postcode list, county/state)
export * from './service-area'
export * from './units'
export * from './format'
export * from './checker'

// Re-export the AI model registry (T-135)
export * from './ai-models'

// Re-export plan definitions (T-134)
export * from './plans'
export * from './access'
export * from './own-address'
export * from './brand'
export * from './product-logo'
export * from './colour-contrast'
export * from './email-style'
// T-201: the business's logo and the "Powered by" line in emails to a customer
export * from './customer-email'
export * from './review-account'
export * from './demo'
// T-156: approve from the review email
export * from './approval-link'

// Quote status groups (queue processing) and business actions (T-157)
export * from './quote-status'
// T-158: whose turn it is on a quote, and the business's next step
export * from './quote-turn'
// T-157: money rounding, label maths, the business email rule
export * from './money'
export * from './business-email'
// T-159: the From header on every email
export * from './email-from'
export * from './minimum-charge'
export * from './failed-request'
export * from './ops-alerts'
export * from './service-suggestion'
// T-179: one request, several services
export * from './quote-sections'
export * from './line-labels'
export * from './quantity-source'
// T-186: how a question on a quote is answered (buttons, then "Other")
export * from './question-choices'
export * from './approval-detail'
// T-196: won this month, and the phone's notifications
export * from './won'
export * from './push'
export * from './field-hint'
// T-197: the Help button: reports, feature requests, the AI's sorting, the support emails
export * from './support'
export * from './support-sort'
export * from './support-emails'
export * from './customer-reminder'
// T-198: the help guide and the assistant that answers from it
export * from './help-guide'
export * from './help-ask'

// ID prefixes for stable, readable IDs
export const ID_PREFIXES = {
  tenant: 'tnt_',
  service: 'svc_',
  quote: 'qte_',
  quoteRequest: 'qr_',
  asset: 'ast_',
  site: 'site_',
  tenantKey: 'tkey_',
  subscription: 'sub_',
  usageCounter: 'uc_',
  servicePricingRule: 'spr_',
  widgetConfig: 'wc_',
} as const

// Utility type for branded IDs
export type TenantId = string & { readonly __brand: 'TenantId' }
export type ServiceId = string & { readonly __brand: 'ServiceId' }
export type QuoteId = string & { readonly __brand: 'QuoteId' }
export type AssetId = string & { readonly __brand: 'AssetId' }
