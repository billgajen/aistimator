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
  alsoAskedOf,
  alsoAskedStateWords,
  alsoAskedWithStates,
  anyMeasuredFromPhotos,
  askedQuestions,
  QUESTIONS_OPEN_STATUS,
  businessIsAsked,
  businessSources,
  certaintySentence,
  isMadeByBusiness,
  isQuoteProcessing,
  lineSourceCodes,
  mainSubtotal,
  sectionSubtotal,
  splitMinimum,
  type AppAlsoAsked,
  type AppQuoteLine,
  type AppQuoteSection,
  type AppQuoteView,
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
  approved_at?: string | null
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
  photos: Array<{ id: string; url: string; fullUrl?: string }>
  /** How many photos the request carries (they are not signed while the price is worked out) */
  photoCount?: number
  /** The request's `source_json`: who made it decides who is asked and whose answers the lines name (T-186) */
  requestSource?: unknown
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
    breakdown?: Array<{ label: string; amount: number; kind?: 'minimum'; minimumCharge?: number; source?: unknown }>
  }
  // T-184, T-185: each line with its note (where its quantity came from, in the business's words). One
  // shared function decides it for the approval page, the email and the app, so the base fee's note is
  // the same on every quote; the takeoff covers quotes priced before the note was stored on the line.
  // T-186: on a quote the business made, an answer is "Your answer", not the customer's.
  const madeByBusiness = isMadeByBusiness(input.requestSource)
  const withNotes = (list: Array<{ label: string; amount: number; source?: unknown }>, takeoff?: unknown): AppQuoteLine[] => {
    const notes = businessSources(list, takeoff, { madeByBusiness })
    return list.map((l, i) => ({ label: l.label, amount: l.amount, ...(notes[i] && { source: notes[i]! }) }))
  }
  const content = (quote.content_json || {}) as { takeoff?: AppQuoteView['takeoff']; limitHold?: boolean }
  const customer = (quote.customer_json || {}) as { name?: unknown; email?: unknown; phone?: unknown }

  // T-186: the business answers the questions of a quote it made. A customer's quote that waits
  // for the customer's answers shows none here: the customer was asked, and the screen says so.
  const open = status === QUESTIONS_OPEN_STATUS ? askedQuestions(quote.clarification_questions_json) : []
  const questions = businessIsAsked(status, madeByBusiness) ? open : []
  // T-188: the customer's own open questions, so the business can answer for them (a quiet link; the
  // screen still says the customer was asked)
  const customerQuestions = businessIsAsked(status, madeByBusiness) ? [] : open

  const main = splitMinimum(pricing.breakdown)
  const added = addedSections(quote.pricing_json as object | null)
  const sections: AppQuoteSection[] = added.map((section) => {
    const split = splitMinimum(section.breakdown)
    return {
      serviceName: section.serviceName,
      addedBy: section.addedBy,
      subtotal: sectionSubtotal(section),
      lines: withNotes(split.lines),
      ...(split.minimum && { minimum: split.minimum }),
      ...(section.awaitingApproval === true && { awaitingApproval: true }),
    }
  })

  const total = money(pricing.total)
  const taxAmount = money(pricing.taxAmount)

  // T-186: how sure the price is, in the one sentence the dashboard shows. A quote priced before the
  // reasons were stored cannot say "measured from the photos" when none of its lines was.
  const codes = [...lineSourceCodes(main.lines, content.takeoff), ...added.flatMap((section) => lineSourceCodes(splitMinimum(section.breakdown).lines))]
  const certainty = certaintySentence(pricing.estimate, { measuredOnQuote: anyMeasuredFromPhotos(codes) })

  // T-184: what else the customer asked for (T-179), each with where it stands, as the dashboard lists it
  const addedBy = new Map(added.map((section) => [section.serviceId, section.addedBy]))
  const alsoAsked: AppAlsoAsked[] = alsoAskedWithStates(alsoAskedOf(quote.content_json), added).map((item) => ({
    words: item.words,
    ...(item.serviceName && { serviceName: item.serviceName }),
    state: item.state,
    stateWords: alsoAskedStateWords(item, item.serviceId ? addedBy.get(item.serviceId) : null),
  }))

  return {
    id: quote.id,
    status,
    businessName: input.businessName,
    serviceName: [input.serviceName, ...sections.map((section) => section.serviceName)].filter(Boolean).join(' + '),
    mainServiceName: input.serviceName,
    customerName: text(customer.name) ?? '',
    customer: { name: text(customer.name) ?? '', email: text(customer.email), phone: text(customer.phone) },
    createdAt: quote.created_at,
    pricing: { total, currency: pricing.currency || 'USD', ...(pricing.estimate && { estimate: pricing.estimate }), certainty },
    madeByBusiness,
    // the measured quantities of the main service; the price lines are `lines`
    takeoff: content.takeoff || [],
    lines: withNotes(main.lines, content.takeoff),
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
      approvedAt: quote.approved_at ?? null,
    },
    questions,
    ...(customerQuestions.length > 0 && { customerQuestions }),
    request: input.request,
    photos: input.photos,
    ...(input.photoCount !== undefined && { photoCount: input.photoCount }),
    ...(alsoAsked.length > 0 && { alsoAsked }),
  }
}
