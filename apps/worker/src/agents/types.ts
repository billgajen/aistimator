/**
 * Agent type definitions
 *
 * Shared types for the agentic pipeline: triage, signal fusion, quality gate.
 */

// ============================================================================
// TRIAGE AGENT TYPES
// ============================================================================

/** Complexity classification for a quote request */
export type TriageClassification = 'simple' | 'standard' | 'complex'

/** Strategy for how many photos to analyze */
export interface PhotoStrategy {
  /** Whether to run vision extraction at all */
  skipVision: boolean
  /** Max photos to analyze (0 = skip) */
  maxPhotos: number
}

/** Full triage decision output */
export interface TriageDecision {
  /** Complexity classification */
  classification: TriageClassification
  /** How to handle photos */
  photoStrategy: PhotoStrategy
  /** Whether to run cross-service detection */
  crossServiceCheck: boolean
  /** Whether this is a returning customer */
  returningCustomer: boolean
  /** Number of previous quotes for this customer+tenant */
  previousQuoteCount: number
  /** Reasons for this classification (for debugging) */
  reasons: string[]
}

/** Input context for triage classification */
export interface TriageInput {
  /** Number of photos attached */
  photoCount: number
  /** Customer description text */
  description: string
  /** Customer email for returning customer detection */
  customerEmail: string
  /** Tenant ID for scoping queries */
  tenantId: string
  /** Number of services the tenant offers */
  tenantServiceCount: number
  /** Whether other services exist for cross-service detection */
  hasOtherServices: boolean
  /** Number of AI-extractable work steps with signal sources */
  aiSignalWorkStepCount: number
}

// ============================================================================
// SIGNAL PROVENANCE TYPES (Phase 3)
// ============================================================================

/** Source of a signal value */
export type SignalSource = 'form' | 'vision' | 'text' | 'inferred'

/** Provenance tracking for a single signal */
export interface SignalProvenance {
  /** Signal key */
  key: string
  /** Final resolved value */
  value: string | number | boolean
  /** Confidence in the value (0-1) */
  confidence: number
  /** Where this value came from */
  source: SignalSource
  /** Human-readable evidence */
  evidence?: string
  /** If form overrode a different source, why */
  overrideReason?: string
}

/** Conflict between two sources for the same signal */
export interface SignalConflict {
  /** Signal key */
  key: string
  /** Value from form/text */
  formValue?: string | number | boolean
  /** Value from vision/AI */
  visionValue?: string | number | boolean
  /** Which source won */
  resolvedSource: SignalSource
  /** Why this source was chosen */
  resolution: string
}

/** Output of the signal fusion process */
export interface FusedSignals {
  /** Provenance-tracked signals */
  signals: SignalProvenance[]
  /** Recorded conflicts */
  conflicts: SignalConflict[]
}

/** Inputs to the signal fusion process */
export interface SignalFusionInputs {
  /** AI-extracted signals from vision */
  visionSignals: Array<{ key: string; value: string | number | boolean; confidence: number; evidence?: string }>
  /** Form-submitted answers */
  formAnswers: Array<{ fieldId: string; value: string | number | boolean | string[] }>
  /** Widget field definitions */
  widgetFields: Array<{ fieldId: string; type: string; label: string; mapsToSignal?: string }>
  /** Expected signals config from service */
  expectedSignals?: Array<{ signalKey: string; type: string; possibleValues?: string[] }>
  /** Customer description text */
  customerNotes?: string
}
