/**
 * The Quotes tab: what needs the business now, first (T-184). Pure.
 *
 * The groups, their order and their names are the dashboard's own
 * (packages/shared/src/quote-turn.ts): "Needs you", "Waiting for customer",
 * "Accepted", then the rest. A request that could not be priced, or one held
 * at the plan limit, is in "Needs you" with its reason, as on the dashboard.
 */
import { agoWords, formatMoney, quoteGroupOf, QUOTE_TURN_COPY, type QuoteGroup, type QuoteListItem, type QuoteTurnOptions } from '@qolumns/shared'
import { turnOfListItem } from './status'

export type ListGroupKey = 'needs_you' | 'waiting' | 'accepted' | 'rest'

export interface ListGroup {
  key: ListGroupKey
  title: string
  /** Said with the title: "Needs you, 3" */
  count: number
  items: QuoteListItem[]
}

const ORDER: ListGroupKey[] = ['needs_you', 'waiting', 'accepted', 'rest']
const TITLES: Record<ListGroupKey, string> = {
  needs_you: QUOTE_TURN_COPY.tabs.needs_you,
  waiting: QUOTE_TURN_COPY.tabs.waiting,
  accepted: QUOTE_TURN_COPY.tabs.accepted,
  rest: 'Everything else',
}

/** Which group a quote is listed under */
export function listGroupOf(item: Pick<QuoteListItem, 'status' | 'held' | 'madeByBusiness'>): ListGroupKey {
  // T-186: a quote the business made, with its own questions open, needs the business
  const group: QuoteGroup = quoteGroupOf(item.status, item.madeByBusiness === true)
  if (group === 'needs_you' || group === 'waiting' || group === 'accepted') return group
  return 'rest'
}

/** The list in groups, in the dashboard's order; a group with nothing in it is left out */
export function groupQuotes(items: readonly QuoteListItem[]): ListGroup[] {
  const by = new Map<ListGroupKey, QuoteListItem[]>(ORDER.map((key) => [key, []]))
  for (const item of items) by.get(listGroupOf(item))!.push(item)
  return ORDER.map((key) => ({ key, title: TITLES[key], count: by.get(key)!.length, items: by.get(key)! })).filter((g) => g.count > 0)
}

/** Customer name contains the text (the server searches the same way; this narrows what is already on the phone) */
export function matchesSearch(item: Pick<QuoteListItem, 'customerName'>, text: string): boolean {
  const wanted = text.trim().toLowerCase()
  return wanted === '' || (item.customerName ?? '').toLowerCase().includes(wanted)
}

export interface RowWords {
  customer: string
  service: string
  /** null when there is no price to state (held, failed, still being worked out) */
  total: string | null
  state: string
  /** The reason under the state, when there is one ("Your plan limit was reached"). Never a time. */
  detail: string | null
  /** The one time on the row: when the quote last changed ("2 hours ago") */
  when: string | null
  /** One sentence for a screen reader */
  spoken: string
}

/** The next steps whose detail line is a reason, not a time (a held request, no price yet, a question waiting) */
const REASON_ACTIONS = new Set<string>(['price_request', 'add_price', 'answer_question', 'give_answers'])

/** When the quote last changed: the latest of when it arrived, was sent, opened, accepted, paid or declined */
export function lastChanged(item: Pick<QuoteListItem, 'createdAt' | 'sentAt' | 'viewedAt' | 'acceptedAt' | 'paidAt' | 'declinedAt'>): string {
  const times = [item.createdAt, item.sentAt, item.viewedAt, item.acceptedAt, item.paidAt, item.declinedAt ?? null]
    .filter((t): t is string => typeof t === 'string' && t !== '')
    .map((t) => ({ t, at: new Date(t).getTime() }))
    .filter((x) => Number.isFinite(x.at))
  return times.reduce((latest, x) => (x.at > latest.at ? x : latest), times[0] ?? { t: item.createdAt, at: 0 }).t
}

/** Everything one row says */
export function rowWords(item: QuoteListItem, opts: QuoteTurnOptions = {}): RowWords {
  const turn = turnOfListItem(item, opts)
  const total = item.total > 0 && !item.held && item.status !== 'failed' && quoteGroupOf(item.status, item.madeByBusiness === true) !== 'working' ? formatMoney(item.total, item.currency) : null
  const customer = item.customerName?.trim() || 'Customer'
  // T-185: one time only. The dashboard's detail line often carries a time of its own ("Sent 2 days
  // ago, not opened yet"); a phone row shows the state, a reason when there is one, and one time.
  const when = agoWords(lastChanged(item), opts)
  const detail = REASON_ACTIONS.has(turn.action ?? '') && turn.detail ? turn.detail : null
  return {
    customer,
    service: item.serviceName,
    total,
    state: turn.label,
    detail,
    when,
    spoken: [customer, item.serviceName, total, turn.label, detail, when].filter(Boolean).join(', '),
  }
}
