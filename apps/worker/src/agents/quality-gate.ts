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
  /**
   * AI-signal quantity sources the extraction could NOT produce (missing or
   * non-numeric). These make per-unit pricing structurally wrong (quantity
   * falls back to 1) and MUST be clarified — a missing signal never appears
   * in lowConfidenceSignals, so this is the only guard for them.
   */
  missingQuantitySignals?: Array<{ signalKey: string; stepName: string }>
  /**
   * T-127 (hardcore F3): work-step lines priced on a DEFAULTED quantity (×1
   * placeholder — unanswered form field / unresolvable formula / legacy
   * fallback). askKey is the fieldId/identifier the clarify round should fill
   * (answers merge back as form answers via targetSignalKey).
   */
  defaultedQuantitySteps?: Array<{ askKey: string; stepName: string }>
  /** T-126 send-guard: how many work steps the config defines */
  workStepsConfigured?: number
  /** T-126 send-guard: how many work-step lines actually priced */
  workStepLinesPriced?: number
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
  const identified = identifySignalsForClarification(
    lowConfSignals,
    conflicts,
    structuredSignals
  )

  // Missing quantity signals FIRST — without them the price is structurally
  // wrong (per-unit steps priced at quantity 1), not merely uncertain
  const missing = (input.missingQuantitySignals || []).map((m) => ({
    key: m.signalKey,
    reason: `Required to price "${m.stepName}" but could not be measured from the photos — ask the customer for the value directly`,
  }))
  // T-127: defaulted ×1 quantities are equally structural — the line is a
  // placeholder price, not an estimate
  const defaulted = (input.defaultedQuantitySteps || [])
    .filter((d) => !missing.some((m) => m.key === d.askKey))
    .map((d) => ({
      key: d.askKey,
      reason: `The quantity for "${d.stepName}" was not provided — the line is currently priced at a single-unit placeholder; ask the customer for the actual value`,
    }))
  const structural = [...missing, ...defaulted]
  const signalsNeedingClarification = [
    ...structural,
    ...identified.filter((s) => !structural.some((m) => m.key === s.key)),
  ]

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
    structuredSignals,
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

  // T-126 send-guard (hardcore F7): a £0 quote must NEVER auto-send.
  // The old check required breakdown.length > 0 — but the worst failure mode
  // (every configured step failed to bind) produces an EMPTY breakdown, which
  // is exactly when the guard is needed (S09 sent a £0 piano-move quote).
  if (pricing.total <= 0) {
    return 'Pricing calculated to £0 or below — nothing could be priced from the configuration; needs review'
  }

  // T-126 send-guard: config defines work steps but none applied — the quote
  // is priced from base fee/addons/minimum only, which for a step-priced
  // service means the request's actual work went unpriced.
  if ((input.workStepsConfigured ?? 0) > 0 && (input.workStepLinesPriced ?? 0) === 0) {
    return `None of the ${input.workStepsConfigured} configured work steps applied to this request — conditional charges may have failed to bind; needs review`
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
 * Generate targeted clarification questions.
 *
 * T-108 (AD-024-consistent): when the AI extracted a concrete value, the
 * question is built DETERMINISTICALLY by code as a one-tap confirmation of
 * that value ("We counted 4 rooms — is that right?"), with the AI's evidence
 * shown. A confirmed value becomes a 1.0-confidence customer signal (AD-002).
 * AI-generated free-text questions remain only for signals with no value.
 */
async function generateClarificationQuestions(
  signalsToAsk: Array<{ key: string; reason: string }>,
  serviceName: string,
  structuredSignals: ExtractedSignalsV2,
  gemini: GeminiClient | null
): Promise<ClarificationQuestion[]> {
  if (signalsToAsk.length === 0) return []

  const confirmQuestions: ClarificationQuestion[] = []
  const needsAiQuestion: Array<{ key: string; reason: string }> = []

  for (const s of signalsToAsk) {
    const signal = structuredSignals.signals.find(sig => sig.key === s.key)
    const value = signal?.value
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const label = s.key.replace(/_/g, ' ')
      confirmQuestions.push({
        id: `cq_${Date.now()}_c${confirmQuestions.length}`,
        targetSignalKey: s.key,
        question: `From your photos and details, we estimated ${label}: ${value}. Is that right?`,
        type: 'confirm_value',
        aiValue: typeof value === 'number' ? value : String(value),
        evidence: signal?.evidence,
      })
    } else {
      needsAiQuestion.push(s)
    }
  }

  const textQuestions = await generateTextQuestions(needsAiQuestion, serviceName, gemini)
  return [...confirmQuestions, ...textQuestions]
}

/**
 * AI-generated free-text questions for signals with no extracted value.
 * Falls back to template-based questions if AI is unavailable.
 */
async function generateTextQuestions(
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
