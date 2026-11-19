/**
 * T-183: what a business needs to judge a price before it presses
 * "Approve & send", in the order it should read it:
 *
 *   1. warnings: "Check the service", what else the customer asked for, and
 *      anything the automatic check noted
 *   2. every price line with its amount, and where its quantity came from
 *   3. on a combined quote (T-179), each service as a part with its subtotal
 *   4. the one total
 *   5. how many photos the customer sent
 *
 * The approval page (/approve/:token) and the "Review and approve" email are
 * both drawn from this one result, so they cannot say different things. Every
 * rule that decides something is the shared one the dashboard uses: the
 * minimum charge is a note, never a line (AD-048); a combined quote is one
 * quote with one total (AD-061); the checker's findings are notes (AD-049).
 *
 * Pure. Money is formatted for the business's region. No customer contact
 * detail is read here.
 */

import { checkerFindings } from './checker'
import { formatMoney } from './format'
import { minimumChargeNote, splitMinimum, type AppliedMinimum } from './minimum-charge'
import { addedSections, alsoAskedOf, alsoAskedWithStates, mainSubtotal, sectionSubtotal, type AlsoAsked } from './quote-sections'
import { isLineSource, sourceForBusiness } from './quantity-source'
import { serviceSuggestionOf, suggestedServiceReason } from './service-suggestion'

export interface ApprovalWarning {
  kind: 'service' | 'also_asked' | 'check'
  title: string
  /** One or more plain sentences */
  lines: string[]
}

export interface ApprovalLine {
  label: string
  /** Formatted for the business's region */
  amount: string
  /** Where the quantity came from, in the business's words; null when it is not known */
  source: string | null
}

/** One service's part of the quote */
export interface ApprovalPart {
  serviceName: string
  main: boolean
  /** Who added this service to the quote (absent for the main service) */
  addedBy?: 'customer' | 'business'
  lines: ApprovalLine[]
  /** "A minimum charge of $120.00 applies." when that service's minimum applied */
  minimumNote: string | null
  subtotal: string
  /** The customer sees no price for this part until the business approves */
  priceWaits: boolean
}

export interface ApprovalDetail {
  warnings: ApprovalWarning[]
  parts: ApprovalPart[]
  /** More than one service: each part shows its own subtotal */
  combined: boolean
  totals: {
    subtotal: string
    tax: { label: string; amount: string } | null
    total: string
  }
  /** "3 photos from the customer"; null when there are none */
  photosLine: string | null
  photoCount: number
}

export interface ApprovalDetailInput {
  pricing: unknown
  content: unknown
  mainServiceName: string
  /** The request's `source_json` (the form's suggestion of another service lives there) */
  requestSource?: unknown
  /** The newest quote check that found something, if any (`validation_result.issues`) */
  checkerIssues?: unknown
  photoCount: number
  /** The business's region: currency when the quote has none, and how money is written */
  currency: string
  locale: string
}

export const APPROVAL_COPY = {
  serviceTitle: 'Check the service',
  alsoAskedTitle: 'Customer also asked for',
  checksTitle: 'Worth checking',
  checksNote: 'An automatic check noted this. It changed nothing on the quote.',
  priceWaits: 'The customer sees no price for this part until you approve.',
  addedByCustomer: 'added by the customer',
  addedByYou: 'added by you',
  subtotal: 'Subtotal',
  total: 'Total',
  photos: (count: number) => (count === 1 ? '1 photo from the customer' : `${count} photos from the customer`),
  photosOnPage: (count: number) => (count === 1 ? '1 photo: view it on the approval page' : `${count} photos: view them on the approval page`),
} as const

const ALSO_ASKED_STATE: Record<AlsoAsked['state'], string> = {
  added: 'Added by the customer.',
  offered: 'Not added yet.',
  not_offered: 'Not one of your services. No price was given; the customer was told you will confirm it separately.',
}

/** Where one thing the customer also asked for stands, in a sentence (the approval page, the email, the on-site app) */
export function alsoAskedStateWords(item: Pick<AlsoAsked, 'state' | 'serviceId'>, addedBy?: 'customer' | 'business' | null): string {
  return item.state === 'added' && addedBy === 'business' ? 'Added by you.' : ALSO_ASKED_STATE[item.state]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const amountOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

interface Line {
  label: string
  amount: number
  source?: unknown
  kind?: 'minimum'
  minimumCharge?: number
}

function linesOf(raw: unknown): Line[] {
  return (Array.isArray(raw) ? raw.filter(isRecord) : []).map((line) => ({
    ...line,
    label: text(line.label),
    amount: amountOf(line.amount),
    ...(line.kind === 'minimum' ? { kind: 'minimum' as const } : { kind: undefined }),
    minimumCharge: typeof line.minimumCharge === 'number' ? line.minimumCharge : undefined,
  }))
}

interface TakeoffRow {
  item: string
  amount: number
  method: string
  source?: unknown
  used: boolean
}

/**
 * A quote priced before T-183 has no source on its lines. Its takeoff says,
 * for the same lines, how each was established: a line is matched to the
 * takeoff row with the same amount whose item starts its label, once.
 */
function sourceFromTakeoff(line: Line, takeoff: TakeoffRow[]): string | null {
  const row = takeoff.find(
    (t) => !t.used && Math.abs(t.amount - line.amount) < 0.005 && t.item !== '' && (line.label === t.item || line.label.startsWith(`${t.item} `))
  )
  if (!row) return null
  row.used = true
  return sourceForBusiness({ source: row.source, method: row.method })
}

export function approvalDetail(input: ApprovalDetailInput): ApprovalDetail {
  const pricing = isRecord(input.pricing) ? input.pricing : {}
  const content = isRecord(input.content) ? input.content : {}
  const currency = text(pricing.currency) || input.currency
  const money = (n: number) => formatMoney(n, currency, input.locale)

  // ---- The parts: the main service, then each added one ---------------------
  const takeoff: TakeoffRow[] = (Array.isArray(content.takeoff) ? content.takeoff.filter(isRecord) : []).map((t) => ({
    item: text(t.item),
    amount: amountOf(t.amount),
    method: text(t.method),
    source: t.source,
    used: false,
  }))
  const sections = addedSections(pricing)
  const combined = sections.length > 0
  const mainSplit = splitMinimum(linesOf(pricing.breakdown))
  const part = (
    serviceName: string,
    split: { lines: Line[]; minimum: AppliedMinimum | null },
    subtotal: number,
    extra: Pick<ApprovalPart, 'main' | 'addedBy' | 'priceWaits'>,
    fromTakeoff: boolean
  ): ApprovalPart => ({
    serviceName,
    ...extra,
    lines: split.lines.map((line) => ({
      label: line.label,
      amount: money(line.amount),
      source: isLineSource(line.source) ? sourceForBusiness({ source: line.source, method: takeoffMethodFor(line, takeoff) }) : fromTakeoff ? sourceFromTakeoff(line, takeoff) : null,
    })),
    minimumNote: split.minimum ? minimumChargeNote(money(split.minimum.minimumCharge)) : null,
    subtotal: money(subtotal),
  })

  const parts: ApprovalPart[] = [
    part(
      input.mainServiceName,
      mainSplit,
      combined ? mainSubtotal(pricing as Parameters<typeof mainSubtotal>[0]) : amountOf(pricing.subtotal),
      { main: true, priceWaits: false },
      true
    ),
    ...sections.map((section) =>
      part(
        section.serviceName,
        splitMinimum(linesOf(section.breakdown)),
        sectionSubtotal(section),
        { main: false, addedBy: section.addedBy, priceWaits: section.awaitingApproval === true },
        false
      )
    ),
  ]

  // ---- Warnings, in the order the business should read them -----------------
  const warnings: ApprovalWarning[] = []
  const suggestion = serviceSuggestionOf(input.requestSource)
  if (suggestion) {
    warnings.push({ kind: 'service', title: APPROVAL_COPY.serviceTitle, lines: [suggestedServiceReason(suggestion, input.mainServiceName)] })
  }
  const asked = alsoAskedWithStates(alsoAskedOf(content), sections)
  if (asked.length > 0) {
    const addedBy = new Map(sections.map((s) => [s.serviceId, s.addedBy]))
    warnings.push({
      kind: 'also_asked',
      title: APPROVAL_COPY.alsoAskedTitle,
      lines: asked.map((item) => {
        const state = alsoAskedStateWords(item, item.serviceId ? addedBy.get(item.serviceId) : null)
        return `${item.serviceName ? `${item.serviceName}: ` : ''}“${item.words.trim()}”. ${state}`
      }),
    })
  }
  const findings = checkerFindings(input.checkerIssues, pricing.breakdown)
  if (findings.length > 0) warnings.push({ kind: 'check', title: APPROVAL_COPY.checksTitle, lines: findings })

  const taxAmount = amountOf(pricing.taxAmount)
  const photoCount = Math.max(0, Math.floor(input.photoCount) || 0)
  return {
    warnings,
    parts,
    combined,
    totals: {
      subtotal: money(amountOf(pricing.subtotal)),
      tax: taxAmount > 0 ? { label: text(pricing.taxLabel) || 'Tax', amount: money(taxAmount) } : null,
      total: money(amountOf(pricing.total)),
    },
    photosLine: photoCount > 0 ? APPROVAL_COPY.photos(photoCount) : null,
    photoCount,
  }
}

/** For a line that carries its own source: the takeoff's words for it, which name where a label was read */
function takeoffMethodFor(line: Line, takeoff: TakeoffRow[]): string | null {
  if (line.source !== 'label') return null
  const row = takeoff.find((t) => Math.abs(t.amount - line.amount) < 0.005 && t.item !== '' && (line.label === t.item || line.label.startsWith(`${t.item} `)))
  return row ? row.method : null
}
