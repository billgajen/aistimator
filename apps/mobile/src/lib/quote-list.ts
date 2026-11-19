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
export function listGroupOf(item: Pick<QuoteListItem, 'status' | 'held'>): ListGroupKey {
  const group: QuoteGroup = quoteGroupOf(item.status)
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
  /** The reason or the detail under the state ("The plan's quotes are used up") */
  detail: string | null
  /** "2 hours ago" */
  when: string | null
  /** One sentence for a screen reader */
  spoken: string
}

/** Everything one row says */
export function rowWords(item: QuoteListItem, opts: QuoteTurnOptions = {}): RowWords {
  const turn = turnOfListItem(item, opts)
  const total = item.total > 0 && !item.held && item.status !== 'failed' && quoteGroupOf(item.status) !== 'working' ? formatMoney(item.total, item.currency) : null
  const customer = item.customerName?.trim() || 'Customer'
  const when = agoWords(item.createdAt, opts)
  return {
    customer,
    service: item.serviceName,
    total,
    state: turn.label,
    detail: turn.detail ?? null,
    when,
    spoken: [customer, item.serviceName, total, turn.label, turn.detail, when].filter(Boolean).join(', '),
  }
}
