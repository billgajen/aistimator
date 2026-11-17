/**
 * T-178: what the request form does with the service matcher's answer.
 * Pure, no IO.
 *
 * The rule: a customer is never stopped at submit because of what they wrote.
 *
 *   1. If the chosen service has any answered question, a quantity or any
 *      photo, the matcher is not asked at all. The customer chose that
 *      service and filled it in; the free-text box is then the optional
 *      "anything else" note, and a note cannot overrule the choice.
 *   2. Only when the description is the request's whole content is the
 *      matcher asked. If it is confident that another of the business's
 *      services fits better, the request is STILL made on the chosen
 *      service, with the suggestion attached; the worker holds the priced
 *      quote for the business to review (AD-059).
 *   3. If it is confident that none of the business's services fits, the
 *      request becomes a general inquiry, or, for a business that switched
 *      general inquiries off, is refused with SERVICE_NOT_AVAILABLE. Both as
 *      before, and reachable only in this description-only case.
 */
import type { ServiceSuggestion } from '@qolumns/shared'
import type { MatchResult } from '@/lib/ai/service-matcher'

/** The free-text box's answer id (the widget, chat and message channels all use it) */
export const DESCRIPTION_FIELD = '_project_description'

type AnswerValue = string | number | boolean | string[] | null | undefined

const answered = (value: AnswerValue) =>
  value !== undefined && value !== null && value !== '' && value !== false && !(Array.isArray(value) && value.length === 0)

/** Did the customer give the chosen service anything of its own: an answer, a quantity or a photo? */
export function requestHasOwnContent(input: {
  answers?: Array<{ fieldId: string; value: AnswerValue }> | null
  quantity?: number | null
  assetIds?: string[] | null
}): boolean {
  if ((input.assetIds?.length ?? 0) > 0) return true
  if (typeof input.quantity === 'number' && input.quantity > 0) return true
  return (input.answers ?? []).some((a) => a.fieldId !== DESCRIPTION_FIELD && answered(a.value))
}

/** How sure the matcher must be before its "no" counts, by the business's strictness setting */
export const MATCH_THRESHOLDS: Record<string, number> = { low: 0.9, medium: 0.8, high: 0.7 }

export type MatchDecision =
  | { kind: 'proceed' }
  | { kind: 'hold'; suggestion: ServiceSuggestion }
  | { kind: 'general_inquiry' }
  | { kind: 'not_available'; reason: string }

export function decideServiceMatch(match: MatchResult, settings: { mode: string; generalInquiryEnabled: boolean }): MatchDecision {
  const threshold = MATCH_THRESHOLDS[settings.mode] ?? MATCH_THRESHOLDS.medium!
  if (match.isMatch || !(match.confidence >= threshold)) return { kind: 'proceed' }
  if (match.suggestedServiceId && match.suggestedServiceName) {
    return { kind: 'hold', suggestion: { serviceId: match.suggestedServiceId, serviceName: match.suggestedServiceName, reason: match.reason } }
  }
  return settings.generalInquiryEnabled ? { kind: 'general_inquiry' } : { kind: 'not_available', reason: match.reason }
}
