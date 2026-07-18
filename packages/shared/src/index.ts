// Shared types and utilities for the Estimator platform

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
