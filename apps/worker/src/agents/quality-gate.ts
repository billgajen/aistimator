/**
 * Quality Gate Agent
 *
 * Evaluates quote quality after pricing + wording and decides:
 * - send: Quote is good, proceed to customer
 * - ask_clarification: Low-confidence signals need an answer (max 2 questions). T-188: every question
 *   carries the answers to press, built in code from the business's own rules (question-choices.ts),
 *   and is worded for whoever answers it: the customer, or the business on a quote it made (T-186).
 * - require_review: Critical issue, flag for business owner
 *
 * Uses signal provenance from Phase 3 to decide what to ask.
 * Capped at 1 clarification round to prevent loops.
 */

import type { AiClient } from '../ai/client'
import type { ExtractedSignalsV2, ClarificationQuestion, QualityGateResult } from '@qolumns/shared'
import type { PricingResult } from '../pricing/rules-engine'
import type { FusedSignals, SignalConflict } from './types'
import { doubtChoices, missingChoices, type Audience, type BuiltAnswer, type ChoiceContext } from './question-choices'

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
  defaultedQuantitySteps?: Array<{ askKey: string; stepName: string; /** T-204: the line is left out (counted as 0), not priced at a placeholder of 1 */ leftOut?: boolean }>
  /**
   * T-139 (AD-029): questions about identified equipment, built by code
   * (one-tap confirmation of a label reading, or where to find the value).
   * They take precedence over AI-written questions for the same key.
   */
  identificationQuestions?: ClarificationQuestion[]
  /**
   * R3-1: the wording layer concluded a customer-STATED price driver is
   * contradicted by the photos/description. Ask the customer to confirm the
   * quantity (answer merges back as a form answer via the fieldId).
   */
  quantityConcern?: {
    reason: string
    fieldId?: string
    /** T-188: what the evidence points to, in the wording layer's words; a number is read out of it for a choice */
    suggested?: string
    /**
     * T-204: the doubt as one short question to the customer, written by the wording layer in plain
     * words ("You mentioned…, but picked…. How many…?"). Used only for a customer, and only when it
     * passes `plainCustomerQuestion`; otherwise the question is built in code.
     */
    customerQuestion?: string
  }
  /**
   * T-188: who answers the questions. A quote the business made itself asks the business (T-186); every
   * other asks the customer. It changes a question's words, never its choices. Default: the customer.
   */
  audience?: Audience
  /**
   * T-188: what the choices are built from: the request's fields, the service's lines and extras, and the
   * answers given. Without it a doubt cannot be turned into choices, and is not asked.
   */
  choiceContext?: Omit<ChoiceContext, 'audience'>
  /** T-126 send-guard: how many work steps the config defines */
  workStepsConfigured?: number
  /** T-126 send-guard: how many work-step lines actually priced */
  workStepLinesPriced?: number
  /**
   * R2-3: names of non-optional steps configured at £0 — the compiler could
   * not establish their price (block packages, from-prices), so the quote is
   * missing its primary work and must not auto-send.
   */
  zeroCostSteps?: string[]
}

/**
 * T-204: a question a customer is asked is plain and short, and speaks to them.
 *
 * The live test showed one that read like a report about the customer ("The
 * project description specifies…, but the form answer selects…. Which is
 * right?"). A model is now asked for the plain version, and this is the check
 * in code that what it wrote is one: a question, short, and with none of the
 * words a report uses about the person reading it. A text that fails is not
 * repaired: the caller falls back to a question built from the business's own
 * question label (below), so a customer never reads the report.
 *
 * Nothing here knows a trade or a business: the patterns are about how the
 * sentence talks, never about what the job is.
 */
export const CUSTOMER_QUESTION_MAX_CHARS = 220

const REPORT_STYLE: readonly RegExp[] = [
  // the customer, their note or their form, spoken about instead of spoken to
  /\bthe\s+(?:customer|client|user|requester)(?:'s|’s)?\b/i,
  /\bthe\s+(?:project|job|customer|request)\s+(?:description|details|notes?)\b/i,
  /\bthe\s+(?:description|form|submission|request)\s+(?:says|said|states?|stated|mentions?|mentioned|specif\w+|indicat\w+|select\w+|shows?|lists?|gives?)\b/i,
  /\bform\s+(?:answers?|field|input|response)s?\b/i,
  /\b(?:specif(?:y|ies|ied)|indicat(?:e|es|ed))\b/i,
  // our own vocabulary
  /\b(?:signal|signals|field\s*id|low confidence|confidence)\b/i,
  // a key printed as it is stored (room_count)
  /\b[a-z]+_[a-z_]+\b/,
]

/** The text as a customer may be asked it, or null when it is not a plain, short question */
export function plainCustomerQuestion(text: string | null | undefined): string | null {
  const question = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!question || question.length > CUSTOMER_QUESTION_MAX_CHARS) return null
  if (!question.endsWith('?')) return null
  if (REPORT_STYLE.some((pattern) => pattern.test(question))) return null
  return question
}

/** A business's own question, as a question: its label, with a question mark when it has none */
function labelAsQuestion(label: string): string {
  const text = label.replace(/\s+/g, ' ').trim().replace(/[:.]+$/, '')
  return text.endsWith('?') ? text : `${text}?`
}

const said = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value ?? '').trim()
}

/**
 * The doubt about one of the customer's own answers, asked in code: what they
 * answered, to which of the business's questions, and whether it is right.
 * Null when the answer or the question's label is not known.
 */
export function doubtQuestionFromLabel(fieldId: string | undefined, context: Pick<ChoiceContext, 'fields' | 'answers'>): string | null {
  if (!fieldId) return null
  const label = context.fields.find((f) => f.fieldId === fieldId)?.label?.trim()
  const answer = said(context.answers.find((a) => a.fieldId === fieldId)?.value)
  if (!label || !answer || answer.length > 60) return null
  return `You answered “${answer}” to “${labelAsQuestion(label)}” Is that right?`
}

/** A question about something nobody gave, when no model wrote one: the business's own question, else the key's words */
function missingQuestionFromLabel(key: string, serviceName: string, audience: Audience, fields: ChoiceContext['fields']): string {
  const label = fields.find((f) => f.fieldId === key)?.label?.trim()
  if (label) return labelAsQuestion(label)
  const words = key.replace(/_/g, ' ').trim()
  return audience === 'business' ? `What is "${words}" for this ${serviceName} job?` : `What is the ${words} for this job?`
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
  gemini: AiClient | null
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
      reason: d.leftOut
        ? `The quantity for "${d.stepName}" was not provided — the line is left out of the price for now; ask the customer for the actual value`
        : `The quantity for "${d.stepName}" was not provided — the line is currently priced at a single-unit placeholder; ask the customer for the actual value`,
    }))
  // R3-1: stated-but-doubted quantities — the concern is a plain sentence of its own, so it is asked
  // directly (the confirm-template would absurdly ask someone to confirm the number they themselves typed).
  // T-188: it is asked with choices built from the business's own rules, never as an open question. A
  // doubt tied to no answer the business configured has no choices and no answer that could change the
  // price: it is not asked, and goes to the business as a note (below).
  const audience: Audience = input.audience ?? 'customer'
  const choiceContext: ChoiceContext = { fields: [], workSteps: [], addons: [], answers: [], ...input.choiceContext, audience }
  const concernAnswer = input.quantityConcern ? doubtChoices(input.quantityConcern.fieldId, input.quantityConcern.suggested, choiceContext) : null
  const unaskedConcern = input.quantityConcern && !concernAnswer ? input.quantityConcern.reason : null
  const concern = input.quantityConcern && concernAnswer
    ? [{
        key: input.quantityConcern.fieldId!,
        reason: input.quantityConcern.reason,
        direct: true,
        built: concernAnswer,
        customerQuestion: input.quantityConcern.customerQuestion,
      }]
    : []
  // T-139: identification questions arrive ready-made (deterministic)
  const identification = (input.identificationQuestions || []).map((q) => ({
    key: q.targetSignalKey,
    reason: q.question,
    prebuilt: q,
  }))
  const structural = [
    ...missing,
    ...identification.filter((q) => !missing.some((m) => m.key === q.key)),
    ...concern.filter((c) => !missing.some((m) => m.key === c.key)),
    ...defaulted,
  ]
  const signalsNeedingClarification = [
    ...structural,
    ...identified.filter((s) => !structural.some((m) => m.key === s.key)),
  ]

  // T-188: a doubt that could not be asked is the business's to look at before the quote goes anywhere
  const heldForDoubt = (): QualityGateResult => ({ action: 'require_review', reason: unaskedConcern!, evaluatedAt: new Date().toISOString() })

  if (signalsNeedingClarification.length === 0) {
    if (unaskedConcern) return heldForDoubt()
    return {
      action: 'send',
      evaluatedAt: new Date().toISOString(),
    }
  }

  // Generate targeted questions (max 2)
  const quantityKeys = new Set([...missing.map((m) => m.key), ...defaulted.map((d) => d.key)])
  const questions = await generateClarificationQuestions(
    signalsNeedingClarification.slice(0, 2),
    input.serviceName,
    structuredSignals,
    gemini,
    { audience, context: choiceContext, quantityKeys }
  )

  if (questions.length === 0) {
    if (unaskedConcern) return heldForDoubt()
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
  // T-204: not when the price is only missing a number the customer is about to be asked for. An
  // optional number question left empty counts as 0 (it used to be a placeholder of 1, which kept
  // the total above £0 and let the question be asked). The question is asked first; after the
  // answer the processor's own send-guard still holds a quote that comes to nothing.
  const askedFirst = (input.defaultedQuantitySteps ?? []).some((d) => d.leftOut)
  if (pricing.total <= 0 && !askedFirst) {
    return 'Pricing calculated to £0 or below — nothing could be priced from the configuration; needs review'
  }

  // T-126 send-guard: config defines work steps but none applied — the quote
  // is priced from base fee/addons/minimum only, which for a step-priced
  // service means the request's actual work went unpriced.
  if ((input.workStepsConfigured ?? 0) > 0 && (input.workStepLinesPriced ?? 0) === 0 && !askedFirst) {
    return `None of the ${input.workStepsConfigured} configured work steps applied to this request — conditional charges may have failed to bind; needs review`
  }

  // R2-3 send-guard: a mandatory step compiled at £0 means the pricing
  // description couldn't be expressed (block packages, from-prices) — the
  // quote would ship surcharges without the service itself (£16 PT quote)
  if (input.zeroCostSteps && input.zeroCostSteps.length > 0) {
    return `The price for ${input.zeroCostSteps.map((s) => `"${s}"`).join(', ')} could not be established from the pricing configuration — the quote is missing its primary work; needs review`
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
    // An 'unknown' value is the extractor saying it couldn't tell: asking the
    // customer to confirm "unknown" wastes one of the two question slots
    // (T-139 live run: "we estimated condition rating: unknown. Is that right?")
    if (signal && String(signal.value).trim().toLowerCase() === 'unknown') continue
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
  gemini: AiClient | null,
  who: { audience: Audience; context: ChoiceContext; quantityKeys: Set<string> }
): Promise<ClarificationQuestion[]> {
  if (signalsToAsk.length === 0) return []

  const confirmQuestions: ClarificationQuestion[] = []
  const needsAiQuestion: Array<{ key: string; reason: string }> = []

  for (const s of signalsToAsk) {
    const prebuilt = (s as { prebuilt?: ClarificationQuestion }).prebuilt
    if (prebuilt) {
      confirmQuestions.push(prebuilt)
      continue
    }
    // R3-1: a direct entry states the doubt in its own sentence. T-188: what follows it is the question
    // the choices answer ("Keep <the line>?", "Which is right?"), never an open "What should we allow for?"
    if ((s as { direct?: boolean }).direct) {
      const built = (s as unknown as { built: BuiltAnswer }).built
      // The doubt, then what the choices answer. T-204: a customer is asked it in plain words spoken
      // to them. In order: the wording layer's own short question, when it is one; the observation
      // followed by the choices' question, as before, when the observation does not read like a
      // report; else a question built from the business's own label and the answer that was given.
      const observed = `${s.reason.replace(/\s+$/, '')} ${built.ask}`
      const forCustomer =
        who.audience === 'customer'
          ? plainCustomerQuestion((s as { customerQuestion?: string }).customerQuestion) ??
            plainCustomerQuestion(observed) ??
            doubtQuestionFromLabel(s.key, who.context)
          : null
      confirmQuestions.push({
        id: `cq_${Date.now()}_d${confirmQuestions.length}`,
        targetSignalKey: s.key,
        question: forCustomer ?? observed,
        ...(built.choices.length > 0 && { choices: built.choices }),
        ...(built.closed && { closed: true }),
        ...(built.answerKind && { answerKind: built.answerKind }),
      })
      continue
    }
    const signal = structuredSignals.signals.find(sig => sig.key === s.key)
    const value = signal?.value
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      const label = s.key.replace(/_/g, ' ')
      confirmQuestions.push({
        id: `cq_${Date.now()}_c${confirmQuestions.length}`,
        targetSignalKey: s.key,
        // T-188: worded for who answers. On a quote the business made, the photos and details are its own.
        question:
          who.audience === 'business'
            ? `From the photos and details, ${label} was estimated at ${value}. Is that right?`
            : `From your photos and details, we estimated ${label}: ${value}. Is that right?`,
        type: 'confirm_value',
        aiValue: typeof value === 'number' ? value : String(value),
        evidence: signal?.evidence,
      })
    } else {
      needsAiQuestion.push(s)
    }
  }

  // T-188: a question about something nobody gave is answered with the options of the field it fills, or
  // with a number. A model's own suggested options are not used: they are not the business's.
  const textQuestions = (await generateTextQuestions(needsAiQuestion, serviceName, gemini, who.audience, who.context.fields)).map((asked) => {
    const answer = missingChoices(asked.targetSignalKey, who.context, who.quantityKeys.has(asked.targetSignalKey))
    return {
      ...asked,
      ...(answer && answer.choices.length > 0 && { choices: answer.choices }),
      ...(answer?.closed && { closed: true }),
      ...(answer?.answerKind && { answerKind: answer.answerKind }),
    }
  })
  return [...confirmQuestions, ...textQuestions]
}

/**
 * AI-generated free-text questions for signals with no extracted value.
 * Falls back to template-based questions if AI is unavailable.
 */
async function generateTextQuestions(
  signalsToAsk: Array<{ key: string; reason: string }>,
  serviceName: string,
  gemini: AiClient | null,
  audience: Audience = 'customer',
  fields: ChoiceContext['fields'] = []
): Promise<ClarificationQuestion[]> {
  if (signalsToAsk.length === 0) return []

  // Try AI-powered question generation
  if (gemini) {
    try {
      const signalDescriptions = signalsToAsk
        .map(s => `- "${s.key}": ${s.reason}`)
        .join('\n')

      // T-188: who is asked. On a quote the business made itself, the question goes to the person who
      // entered the job; it must not speak to them as a customer ("your quote request", "your photos").
      const asked =
        audience === 'business'
          ? `to ask the business that is pricing this ${serviceName} job. The business entered the job itself and is looking at it now`
          : `to ask a customer about their ${serviceName} quote request`
      const reader =
        audience === 'business'
          ? 'Speak to the business about the job ("How many…", "What is the…"). Never say "your quote", "your request" or "your photos", and never thank them'
          : 'Speak to the customer as "you", in plain everyday words a person with no trade knowledge understands. When the note below says what they told us, say it back first ("You mentioned…", "You picked…"), then ask. Never write like a report about them: no "the customer", "the project description", "the form", "specifies" or "indicates", and never print a name with an underscore in it'
      // T-204: short and plain. The notes below are ours (why the value is needed); they are never repeated to the reader.
      const prompt = `Write ${signalsToAsk.length} short question(s) ${asked}.

What is needed, and why (these notes are for you, not for the reader):
${signalDescriptions}

Rules:
1. ${reader}
2. Do not offer answer options: the answers to choose from are added separately
3. Each question asks for exactly one of the values above; set its targetSignalKey to that value's key, exactly as written in quotes
4. At most 30 words each, ending with a question mark. No greeting, no thanks, no explanation of why it is asked

Return a JSON object with a "questions" array.`

      const result = await gemini.generateWithSchema<{ questions: Array<{ targetSignalKey: string; question: string; options?: string[] }> }>(
        prompt,
        CLARIFICATION_QUESTIONS_SCHEMA,
        audience === 'business'
          ? 'You help a business gather the last details it needs to price a job.'
          : 'You are a friendly customer service assistant helping gather information for a quote.'
      )

      return result.questions.map((q, i) => ({
        id: `cq_${Date.now()}_${i}`,
        targetSignalKey: q.targetSignalKey,
        // T-204: a customer never reads a question that is not plain and short; the business's own
        // question (its label) is asked in its place
        question:
          audience === 'customer'
            ? plainCustomerQuestion(q.question) ?? missingQuestionFromLabel(q.targetSignalKey, serviceName, audience, fields)
            : q.question,
      }))
    } catch (error) {
      console.error('[QualityGate] AI question generation failed:', error)
    }
  }

  // Fallback: template-based questions
  return signalsToAsk.map((s, i) => ({
    id: `cq_${Date.now()}_${i}`,
    targetSignalKey: s.key,
    // T-204: the business's own question when there is one for this value; never "Could you provide more details about…"
    question: missingQuestionFromLabel(s.key, serviceName, audience, fields),
  }))
}
