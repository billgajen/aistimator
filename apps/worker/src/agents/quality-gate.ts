/**
 * Quality Gate Agent
 *
 * Evaluates quote quality after pricing + wording and decides:
 * - send: Quote is good, proceed to customer
 * - ask_clarification: Low-confidence signals need customer input (max 2 questions)
 * - require_review: Critical issue, flag for business owner
 *
 * Uses signal provenance from Phase 3 to decide what to ask.
 * Capped at 1 clarification round to prevent loops.
 */

import type { GeminiClient } from '../ai/gemini'
import type { ExtractedSignalsV2, ClarificationQuestion, QualityGateResult } from '@estimator/shared'
import type { PricingResult } from '../pricing/rules-engine'
import type { FusedSignals, SignalConflict } from './types'

/** Input context for quality gate evaluation */
export interface QualityGateInput {
  /** Structured signals with confidence info */
  structuredSignals: ExtractedSignalsV2
  /** Signal fusion result with conflicts */
  fusionResult: FusedSignals | null
  /** Pricing result */
  pricing: PricingResult
  /** Number of previous clarification rounds */
  clarificationCount: number
  /** Service name for context */
  serviceName: string
  /** Whether customer provided photos */
  hasPhotos: boolean
}

/** Schema for AI-generated clarification questions */
const CLARIFICATION_QUESTIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          targetSignalKey: { type: 'string' },
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['targetSignalKey', 'question'],
      },
    },
  },
  required: ['questions'],
}

/**
 * Evaluate quote quality and decide next action.
 *
 * Decision logic:
 * 1. If clarification_count >= 1, skip gate (no infinite loops)
 * 2. If there are critical issues → require_review
 * 3. If there are low-confidence signals used in pricing → ask_clarification (max 2 questions)
 * 4. Otherwise → send
 */
export async function evaluateQualityGate(
  input: QualityGateInput,
  gemini: GeminiClient | null
): Promise<QualityGateResult> {
  // Cap at 1 clarification round
  if (input.clarificationCount >= 1) {
    console.log('[QualityGate] Skipping — already had 1 clarification round')
    return {
      action: 'send',
      evaluatedAt: new Date().toISOString(),
    }
  }

  const { structuredSignals, fusionResult } = input

  // Check for critical issues that require business review
  const reviewReason = checkForCriticalIssues(input)
  if (reviewReason) {
    console.log(`[QualityGate] Flagged for review: ${reviewReason}`)
    return {
      action: 'require_review',
      reason: reviewReason,
      evaluatedAt: new Date().toISOString(),
    }
  }

  // Find low-confidence signals that affect pricing
  const lowConfSignals = structuredSignals.lowConfidenceSignals || []
  const conflicts = fusionResult?.conflicts || []

  // Determine if clarification is needed
  const signalsNeedingClarification = identifySignalsForClarification(
    lowConfSignals,
    conflicts,
    structuredSignals
  )

  if (signalsNeedingClarification.length === 0) {
    return {
      action: 'send',
      evaluatedAt: new Date().toISOString(),
    }
  }

  // Generate targeted questions (max 2)
  const questions = await generateClarificationQuestions(
    signalsNeedingClarification.slice(0, 2),
    input.serviceName,
    gemini
  )

  if (questions.length === 0) {
    // Couldn't generate questions — proceed with send
    return {
      action: 'send',
      evaluatedAt: new Date().toISOString(),
    }
  }

  console.log(`[QualityGate] Requesting clarification: ${questions.length} questions`)
  return {
    action: 'ask_clarification',
    questions,
    evaluatedAt: new Date().toISOString(),
  }
}

/**
 * Check for critical issues that require business owner review.
 */
function checkForCriticalIssues(input: QualityGateInput): string | null {
  const { structuredSignals, pricing } = input

  // Overall confidence too low
  if (structuredSignals.overallConfidence < 0.3 && input.hasPhotos) {
    return `Very low overall confidence (${(structuredSignals.overallConfidence * 100).toFixed(0)}%) — AI could not extract reliable signals from photos`
  }

  // Zero total with work steps configured (pricing likely failed)
  if (pricing.total <= 0 && pricing.breakdown.length > 0) {
    return 'Pricing calculated to £0 or below despite having work steps — likely a configuration issue'
  }

  // Site visit strongly recommended
  if (structuredSignals.siteVisitRecommended && structuredSignals.overallConfidence < 0.4) {
    return `Site visit recommended with low confidence (${(structuredSignals.overallConfidence * 100).toFixed(0)}%) — manual review needed`
  }

  return null
}

/**
 * Identify signals that need customer clarification.
 */
function identifySignalsForClarification(
  lowConfSignals: string[],
  conflicts: SignalConflict[],
  structuredSignals: ExtractedSignalsV2
): Array<{ key: string; reason: string }> {
  const signalsToAsk: Array<{ key: string; reason: string }> = []

  // Low-confidence signals
  for (const key of lowConfSignals) {
    const signal = structuredSignals.signals.find(s => s.key === key)
    if (signal && signal.confidence < 0.5) {
      signalsToAsk.push({
        key,
        reason: `Low confidence (${(signal.confidence * 100).toFixed(0)}%) for "${key}" — value: ${signal.value}`,
      })
    }
  }

  // Unresolved conflicts where form didn't provide a value
  for (const conflict of conflicts) {
    // If the conflict was resolved by form, it's fine — form is authoritative
    if (conflict.resolvedSource === 'form') continue

    // If resolved by text/inferred, might still be worth asking
    if (!signalsToAsk.find(s => s.key === conflict.key)) {
      signalsToAsk.push({
        key: conflict.key,
        reason: `Conflicting sources: vision="${conflict.visionValue}", resolved by "${conflict.resolvedSource}"`,
      })
    }
  }

  return signalsToAsk
}

/**
 * Generate targeted clarification questions using AI.
 * Falls back to template-based questions if AI is unavailable.
 */
async function generateClarificationQuestions(
  signalsToAsk: Array<{ key: string; reason: string }>,
  serviceName: string,
  gemini: GeminiClient | null
): Promise<ClarificationQuestion[]> {
  if (signalsToAsk.length === 0) return []

  // Try AI-powered question generation
  if (gemini) {
    try {
      const signalDescriptions = signalsToAsk
        .map(s => `- "${s.key}": ${s.reason}`)
        .join('\n')

      const prompt = `Generate ${signalsToAsk.length} clear, friendly question(s) to ask a customer about their ${serviceName} quote request.

These signals need clarification:
${signalDescriptions}

Rules:
1. Questions should be simple and easy for a non-technical customer to answer
2. If possible, provide 2-4 answer options to choose from
3. Each question should target exactly one signal
4. Keep questions concise (1-2 sentences max)

Return a JSON object with a "questions" array.`

      const result = await gemini.generateWithSchema<{ questions: Array<{ targetSignalKey: string; question: string; options?: string[] }> }>(
        prompt,
        CLARIFICATION_QUESTIONS_SCHEMA,
        'You are a friendly customer service assistant helping gather information for a quote.'
      )

      return result.questions.map((q, i) => ({
        id: `cq_${Date.now()}_${i}`,
        targetSignalKey: q.targetSignalKey,
        question: q.question,
        options: q.options,
      }))
    } catch (error) {
      console.error('[QualityGate] AI question generation failed:', error)
    }
  }

  // Fallback: template-based questions
  return signalsToAsk.map((s, i) => ({
    id: `cq_${Date.now()}_${i}`,
    targetSignalKey: s.key,
    question: `Could you provide more details about "${s.key.replace(/_/g, ' ')}" for your ${serviceName} quote?`,
  }))
}
