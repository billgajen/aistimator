/**
 * Signal Fusion with Provenance
 *
 * Records provenance and conflicts during the signal merge process.
 * Every signal gets tracked: where it came from, what confidence, why it was chosen.
 * When vision and form disagree, both values are recorded as a conflict.
 *
 * This module does NOT replace the existing merge logic in quote-processor.ts.
 * Instead, it observes the merge and produces auditable provenance data.
 */

import type {
  SignalProvenance,
  SignalConflict,
  FusedSignals,
  SignalSource,
} from './types'
import type { ExtractedSignal, ExtractedSignalsV2 } from '@estimator/shared'

/**
 * Create a SignalFusion recorder that captures provenance during merge.
 */
export function createSignalFusionRecorder() {
  const provenanceMap = new Map<string, SignalProvenance>()
  const conflicts: SignalConflict[] = []

  return {
    /**
     * Record initial vision/AI signals before form merge.
     */
    recordVisionSignals(signals: ExtractedSignal[]): void {
      for (const signal of signals) {
        provenanceMap.set(signal.key, {
          key: signal.key,
          value: signal.value,
          confidence: signal.confidence,
          source: (signal.source === 'vision' || signal.source === 'inferred')
            ? signal.source as SignalSource
            : 'vision',
          evidence: signal.evidence,
        })
      }
    },

    /**
     * Record a form signal overriding a vision signal (AD-007).
     * Captures the conflict and records the override reason.
     */
    recordFormOverride(
      key: string,
      formValue: string | number | boolean,
      formEvidence: string,
      previousSignal?: ExtractedSignal
    ): void {
      if (previousSignal && previousSignal.source !== 'form') {
        // Record the conflict
        conflicts.push({
          key,
          formValue,
          visionValue: previousSignal.value,
          resolvedSource: 'form',
          resolution: 'AD-007: Form input overrides AI-extracted signal — customer knows their project better',
        })
      }

      provenanceMap.set(key, {
        key,
        value: formValue,
        confidence: 1.0,
        source: 'form',
        evidence: formEvidence,
        overrideReason: previousSignal && previousSignal.source !== 'form'
          ? `Overrode ${previousSignal.source} value "${previousSignal.value}" (confidence: ${previousSignal.confidence})`
          : undefined,
      })
    },

    /**
     * Record a new form signal (no prior AI signal existed).
     */
    recordNewFormSignal(
      key: string,
      value: string | number | boolean,
      evidence: string
    ): void {
      provenanceMap.set(key, {
        key,
        value,
        confidence: 1.0,
        source: 'form',
        evidence,
      })
    },

    /**
     * Record an access override from customer description text (FIX-8).
     */
    recordTextOverride(
      key: string,
      value: string | number | boolean,
      matchedPhrase: string,
      previousSignal?: ExtractedSignal
    ): void {
      if (previousSignal) {
        conflicts.push({
          key,
          formValue: value,
          visionValue: previousSignal.value,
          resolvedSource: 'text',
          resolution: `FIX-8: Customer description overrides vision — stated "${matchedPhrase}"`,
        })
      }

      provenanceMap.set(key, {
        key,
        value,
        confidence: 1.0,
        source: 'text',
        evidence: `Customer stated: "${matchedPhrase}"`,
        overrideReason: previousSignal
          ? `Overrode ${previousSignal.source} value "${previousSignal.value}"`
          : undefined,
      })
    },

    /**
     * Finalize and return the fused signals with full provenance.
     */
    finalize(): FusedSignals {
      return {
        signals: Array.from(provenanceMap.values()),
        conflicts,
      }
    },
  }
}

/**
 * Apply the fusion recorder to an existing structuredSignals object.
 * This integrates with the current merge flow in quote-processor.ts.
 *
 * Call this BEFORE the merge starts to capture initial vision signals,
 * then use recorder methods during the merge, and finalize after.
 */
export function initializeFusionFromStructuredSignals(
  structuredSignals: ExtractedSignalsV2
): ReturnType<typeof createSignalFusionRecorder> {
  const recorder = createSignalFusionRecorder()
  recorder.recordVisionSignals(structuredSignals.signals)
  return recorder
}
