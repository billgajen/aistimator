/**
 * AI Module Exports
 *
 * Single provider: Gemini 1.5 Flash for both vision and text generation.
 */

export { GeminiClient, createGeminiClient } from './gemini'
export type { GeminiConfig, GeminiMessage, GeminiResponse } from './gemini'

export {
  extractSignals,
  extractStructuredSignals,
  getDefaultSignals,
  getDefaultSignalsV2,
  getSignalsWithoutImages,
  getSignalsWithoutImagesV2,
  detectAddonsFromDescription,
  extractInventoryItems,
  matchItemsToCatalog,
  autoGeneratePromptContext,
} from './signals'
export type { ExtractedSignals, AddonForMatching, AddonDetectionResult, InventoryDetectionContext, SignalExtractionContext, PricingRulesForContext, ServiceForContext } from './signals'

export {
  generateWording,
  getDefaultContent,
  generateWordingFallback,
} from './wording'
export type { QuoteContent, WordingContext } from './wording'

export { extractCrossServiceDetails } from './cross-service'
export type { CrossServiceEstimate } from './cross-service'

export { detectServicesFromDescription } from './service-detection'
export type { ServiceForMatching, DetectedServiceResult } from './service-detection'

export { generateServiceDraft, getFallbackDraft } from './service-draft'
export type { ServiceDraftRequest } from './service-draft'

export { generateSignalRecommendations, findUnusedSignals } from './signal-recommendations'
export type { UnusedSignal, RecommendationContext, FormAnswerForFiltering, WidgetFieldForFiltering } from './signal-recommendations'
