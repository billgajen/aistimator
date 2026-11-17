/**
 * T-176: the business's one WhatsApp message template — pure, no IO.
 *
 * WhatsApp delivers a free-form message only for 24 hours after the
 * customer's last message. After that it delivers only wording Meta approved
 * beforehand: a template. This product uses one, "estimate ready", to send a
 * customer the link to their estimate when the business approves it late.
 *
 * Rules from Meta's docs (read 2026-11-17) that shape the wording:
 *   - a name is lowercase letters, digits and underscores;
 *   - the body may not start or end with a variable, and needs an example
 *     value for each one;
 *   - a utility template is not promotional and answers something the
 *     customer asked for. Meta decides the category itself and may file a
 *     template under marketing; what it chose is shown, not assumed.
 *
 * The wording is fixed here and is the same for every business except its
 * name. The name is written into the template (each business has its own
 * WhatsApp account, so its own copy); the customer's link is the one variable.
 */
import type { MetaTemplate } from '@/lib/whatsapp-graph'

/** What Meta knows the template as */
export const ESTIMATE_TEMPLATE_NAME = 'estimate_ready'

/** The one variable: the customer's own link */
const LINK = '{{1}}'

export type TemplateState = 'none' | 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled' | 'unknown'

/** Meta's template statuses, in the states the page speaks of. Only APPROVED can be sent. */
export function templateState(status: string | null): TemplateState {
  switch ((status ?? '').toUpperCase()) {
    case '':
      return 'none'
    case 'APPROVED':
      return 'approved'
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending'
    case 'REJECTED':
      return 'rejected'
    case 'PAUSED':
      return 'paused'
    case 'DISABLED':
    case 'ARCHIVED':
    case 'DELETED':
    case 'PENDING_DELETION':
    case 'LIMIT_EXCEEDED':
      return 'disabled'
    default:
      return 'unknown'
  }
}

/** Meta's template language for a region's locale ("en-GB" → "en_GB"); US English when it is not one Meta lists here */
export function templateLanguage(locale: string | null | undefined): string {
  return (locale ?? '').toLowerCase() === 'en-gb' ? 'en_GB' : 'en_US'
}

/**
 * A business's name as it may stand inside a template: one line, no braces
 * (they would read as a variable), not long enough to crowd the sentence.
 */
export function nameForTemplate(businessName: string): string {
  const clean = businessName.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
  return clean || 'us'
}

/** The template's body, with Meta's placeholder where the link goes */
export function estimateTemplateBody(businessName: string): string {
  const name = nameForTemplate(businessName)
  return `Your estimate from ${name} is ready. Open it here: ${LINK}\n\nThank you for asking ${name} for a price.`
}

/** The same sentence with the link in place: what the customer reads, and what is sent free-form inside the 24 hours */
export function estimateReadyText(businessName: string, link: string): string {
  return estimateTemplateBody(businessName).replace(LINK, link)
}

/** What is sent to Meta to create the template */
export function estimateTemplateDefinition(opts: { businessName: string; language: string; exampleLink: string }) {
  return {
    name: ESTIMATE_TEMPLATE_NAME,
    language: opts.language,
    category: 'UTILITY',
    // positional variables ({{1}}) are Meta's default, so no parameter_format is sent
    components: [
      {
        type: 'BODY',
        text: estimateTemplateBody(opts.businessName),
        // Meta requires an example value for every variable
        example: { body_text: [[opts.exampleLink]] },
      },
    ],
  }
}

/** The one parameter a send carries: the customer's link */
export function estimateTemplateParameters(link: string) {
  return [{ type: 'body' as const, parameters: [{ type: 'text' as const, text: link }] }]
}

const REASONS: Record<string, string> = {
  ABUSIVE_CONTENT: 'Meta read the wording as abusive.',
  CATEGORY_NOT_AVAILABLE: 'Meta does not offer this kind of template to this account.',
  INCORRECT_CATEGORY: 'Meta did not agree that this is a service message.',
  INVALID_FORMAT: 'Meta did not accept the way the wording is laid out.',
  PROMOTIONAL: 'Meta read the wording as advertising.',
  SCAM: 'Meta read the wording as a possible scam.',
  TAG_CONTENT_MISMATCH: 'Meta found the wording does not match what the template is for.',
}

/** Meta's rejection reason in plain words; its own word when it is one this list does not know */
export function rejectedReasonWords(reason: string | null): string | null {
  if (!reason || reason === 'NONE') return null
  return REASONS[reason] ?? `Meta gave the reason “${reason.toLowerCase().replace(/_/g, ' ')}”.`
}

/**
 * Of the templates Meta lists under our name (one per language), the one to
 * show and to send: an approved one first, in the business's language if
 * there is a choice.
 */
export function pickTemplate(templates: MetaTemplate[], language: string): MetaTemplate | null {
  const rank = (t: MetaTemplate) => (t.status === 'APPROVED' ? 0 : 2) + (t.language === language ? 0 : 1)
  return [...templates].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

/** What the page is told about the template. Nothing here is secret. */
export interface TemplateView {
  name: string
  language: string
  state: TemplateState
  /** Meta's own status word; null when the template does not exist yet */
  metaStatus: string | null
  /** the category Meta filed it under (it can differ from the one asked for) */
  category: string | null
  /** why Meta rejected it, in plain words */
  reason: string | null
  /** the wording as a customer reads it, with a sample link */
  text: string
  /** WhatsApp Manager's template list for this account */
  managerUrl: string | null
}

/** WhatsApp Manager → Message templates, opened on the business's account */
export function templateManagerUrl(wabaId: string | null, businessId: string | null): string | null {
  if (!wabaId) return null
  const query = new URLSearchParams({ waba_id: wabaId })
  if (businessId) query.set('business_id', businessId)
  return `https://business.facebook.com/wa/manage/message-templates/?${query.toString()}`
}

export function templateView(opts: {
  found: MetaTemplate | null
  businessName: string
  language: string
  sampleLink: string
  wabaId: string | null
  businessId: string | null
}): TemplateView {
  const { found } = opts
  // Meta's own copy of the wording once it exists (it may have been made before the business changed its name)
  const body = found?.bodyText || estimateTemplateBody(opts.businessName)
  return {
    name: ESTIMATE_TEMPLATE_NAME,
    language: found?.language || opts.language,
    state: templateState(found?.status ?? null),
    metaStatus: found?.status ?? null,
    category: found?.category ?? null,
    reason: rejectedReasonWords(found?.rejectedReason ?? null),
    text: body.replace(LINK, opts.sampleLink),
    managerUrl: templateManagerUrl(opts.wabaId, opts.businessId),
  }
}
