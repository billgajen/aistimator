/**
 * T-182: the business app's view of one quote, shaped from the stored rows.
 *
 * The app shows what the dashboard shows, in the same words and by the same
 * rules, so everything that decides something is taken from the shared
 * package and nothing is worked out a second time here:
 *   - the minimum charge is a floor, said in a note, never a line (AD-048)
 *   - a combined quote (T-179) is one quote with one total; each added service
 *     is a section with its own lines and subtotal
 *   - a request held at the plan limit or by a paused account has no price (T-152, T-180)
 *   - a request that could not be priced still shows what was sent (T-178)
 *
 * Pure: the route reads the rows and signs the photo addresses.
 */
import {
  addedSections,
  isQuoteProcessing,
  mainSubtotal,
  sectionSubtotal,
  splitMinimum,
  type AppQuoteSection,
  type AppQuoteView,
  type ClarificationQuestion,
  type QuoteStatus,
  type RequestDetails,
} from '@qolumns/shared'

type Estimate = NonNullable<AppQuoteView['pricing']['estimate']>

export interface AppQuoteRow {
  id: string
  status: string
  created_at: string
  customer_json?: unknown
  pricing_json?: unknown
  content_json?: unknown
  clarification_questions_json?: unknown
  sent_at?: string | null
  viewed_at?: string | null
  accepted_at?: string | null
  paid_at?: string | null
  declined_at?: string | null
  token_expires_at?: string | null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const money = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** Photos are left out while the price is being worked out: the app asks again every few seconds then */
export function appViewWantsPhotos(status: string): boolean {
  return !isQuoteProcessing(status)
}

export function appQuoteView(input: {
  quote: AppQuoteRow
  serviceName: string
  businessName: string
  request: RequestDetails
  photos: Array<{ id: string; url: string }>
}): AppQuoteView {
  const { quote } = input
  const status = quote.status as QuoteStatus
  const pricing = (quote.pricing_json || {}) as {
    total?: number
    subtotal?: number
    currency?: string
    taxLabel?: string
    taxAmount?: number
    estimate?: Estimate
    breakdown?: Array<{ label: string; amount: number; kind?: 'minimum'; minimumCharge?: number }>
  }
  const content = (quote.content_json || {}) as { takeoff?: AppQuoteView['takeoff']; limitHold?: boolean }
  const customer = (quote.customer_json || {}) as { name?: unknown; email?: unknown; phone?: unknown }

  const questions =
    status === 'awaiting_clarification'
      ? ((quote.clarification_questions_json || []) as ClarificationQuestion[]).map((q) => ({
          id: q.id,
          question: q.question,
          ...(q.type && { type: q.type }),
          ...(q.aiValue !== undefined && { aiValue: q.aiValue }),
          ...(q.evidence && { evidence: q.evidence }),
          ...(q.options && { options: q.options }),
        }))
      : []

  const main = splitMinimum(pricing.breakdown)
  const added = addedSections(quote.pricing_json as object | null)
  const sections: AppQuoteSection[] = added.map((section) => {
    const split = splitMinimum(section.breakdown)
    return {
      serviceName: section.serviceName,
      addedBy: section.addedBy,
      subtotal: sectionSubtotal(section),
      lines: split.lines.map((line) => ({ label: line.label, amount: line.amount })),
      ...(split.minimum && { minimum: split.minimum }),
      ...(section.awaitingApproval === true && { awaitingApproval: true }),
    }
  })

  const total = money(pricing.total)
  const taxAmount = money(pricing.taxAmount)

  return {
    id: quote.id,
    status,
    businessName: input.businessName,
    serviceName: [input.serviceName, ...sections.map((section) => section.serviceName)].filter(Boolean).join(' + '),
    mainServiceName: input.serviceName,
    customerName: text(customer.name) ?? '',
    customer: { name: text(customer.name) ?? '', email: text(customer.email), phone: text(customer.phone) },
    createdAt: quote.created_at,
    pricing: { total, currency: pricing.currency || 'USD', ...(pricing.estimate && { estimate: pricing.estimate }) },
    // the measured quantities of the main service; the price lines are `lines`
    takeoff: content.takeoff || [],
    lines: main.lines.map((line) => ({ label: line.label, amount: line.amount })),
    ...(main.minimum && { minimum: main.minimum }),
    ...(sections.length > 0 && { sections, mainSubtotal: mainSubtotal(quote.pricing_json as Parameters<typeof mainSubtotal>[0]) }),
    totals: {
      subtotal: money(pricing.subtotal),
      ...(taxAmount > 0 && { tax: { label: pricing.taxLabel || 'Tax', amount: taxAmount } }),
      total,
    },
    held: status === 'pending_review' && content.limitHold === true,
    dates: {
      sentAt: quote.sent_at ?? null,
      viewedAt: quote.viewed_at ?? null,
      acceptedAt: quote.accepted_at ?? null,
      paidAt: quote.paid_at ?? null,
      declinedAt: quote.declined_at ?? null,
      expiresAt: quote.token_expires_at ?? null,
    },
    questions,
    request: input.request,
    photos: input.photos,
  }
}
