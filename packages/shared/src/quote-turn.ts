/**
 * Whose turn it is on a quote, and what the business does next (T-158, AD-043).
 *
 * The business does not read raw statuses ("Sent", "Viewed", "Revised"). It
 * reads a group, a label, a detail line and one next step, all worked out
 * here. The quotes list, the quote page and Home use this file and nothing
 * else for that wording; the list API filters with the same groups.
 *
 * Pure. The database statuses do not change, and no action rule lives here:
 * what a button may do is still decided by quote-status.ts (T-157).
 */

import type { QuoteStatus } from './database.types'
import { canSendQuoteAgain } from './quote-status'

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type QuoteGroup = 'needs_you' | 'waiting' | 'accepted' | 'closed' | 'working'

/** Every status belongs to exactly one group */
export const QUOTE_GROUP_STATUSES: Record<QuoteGroup, readonly QuoteStatus[]> = {
  needs_you: ['pending_review', 'feedback_received', 'failed'],
  waiting: ['sent', 'viewed', 'revised', 'awaiting_clarification'],
  accepted: ['accepted', 'paid'],
  closed: ['declined', 'expired'],
  working: ['queued', 'generating'],
}

export const QUOTE_GROUPS = Object.keys(QUOTE_GROUP_STATUSES) as QuoteGroup[]

export function quoteGroupOf(status: string | null | undefined): QuoteGroup {
  for (const group of QUOTE_GROUPS) {
    if ((QUOTE_GROUP_STATUSES[group] as readonly string[]).includes(status ?? '')) return group
  }
  return 'working'
}

/** The tabs on the quotes list, in order. "Working" has no tab: it shows under All. */
export type QuoteListTab = 'needs_you' | 'waiting' | 'accepted' | 'closed' | 'unfinished' | 'all'

export const QUOTE_LIST_TABS: readonly QuoteListTab[] = ['needs_you', 'waiting', 'accepted', 'closed', 'unfinished', 'all']

/** The groups the list API can filter by */
export type QuoteListGroup = Exclude<QuoteListTab, 'unfinished'>

export const QUOTE_LIST_GROUPS: readonly QuoteListGroup[] = ['needs_you', 'waiting', 'accepted', 'closed', 'all']

export type QuoteListCounts = Record<QuoteListTab, number>

/** The tab the list opens on: the work waiting for the business, when there is any */
export function defaultQuoteListGroup(counts: Pick<QuoteListCounts, 'needs_you'>): QuoteListGroup {
  return counts.needs_you > 0 ? 'needs_you' : 'all'
}

// ---------------------------------------------------------------------------
// Wording (the only place it lives)
// ---------------------------------------------------------------------------

/** After this many days unopened, the next step becomes "Send again" (the automatic reminder waits as long) */
export const SEND_AGAIN_AFTER_DAYS = 3

export const QUOTE_TURN_COPY = {
  tabs: {
    needs_you: 'Needs you',
    waiting: 'Waiting for customer',
    accepted: 'Accepted',
    closed: 'Closed',
    unfinished: 'Unfinished',
    all: 'All',
  } satisfies Record<QuoteListTab, string>,
  empty: {
    needs_you: 'Nothing needs you right now.',
    waiting: 'No quotes are waiting for a customer.',
    accepted: 'No accepted quotes yet.',
    closed: 'No declined or expired quotes.',
    all: 'No quotes yet.',
  } satisfies Record<QuoteListGroup, string>,
  labels: {
    needsApproval: 'Needs your approval',
    held: 'Saved, not priced yet',
    question: 'Customer asked a question',
    failed: 'Could not be priced',
    waiting: 'Waiting for customer',
    accepted: 'Customer accepted',
    paid: 'Paid',
    declined: 'Customer declined',
    expired: 'Expired',
    working: 'Working out the price',
  },
  /** The one worded button on a list row */
  listButtons: {
    approve: 'Check and approve',
    add_price: 'Add the price',
    price_request: 'Price this request',
    answer_question: 'Answer question',
    send_again: 'Send again',
    contact: 'Contact customer',
  } satisfies Record<QuoteNextAction, string>,
  /** The main button in the quote page's Next step box */
  pageButtons: {
    approve: 'Approve & send',
    approving: 'Sending…',
    editQuote: 'Edit quote',
    priceRequest: 'Price this request',
    pricingRequest: 'Starting…',
    upgradePlan: 'Upgrade plan',
    sendAgain: 'Send again',
    sendingAgain: 'Sending…',
    email: (firstName: string | null) => `Email ${firstName ?? 'customer'}`,
    call: (firstName: string | null) => `Call ${firstName ?? 'customer'}`,
  },
  nextStepTitle: 'Next step',
  nextStepColumn: 'Next step',
  /** The "More" menu on a list row */
  more: {
    button: 'More',
    open: 'Open quote',
    sendAgain: 'Send again',
    copyLink: 'Copy link',
    downloadPdf: 'Download PDF',
    pricingTrace: 'Pricing trace',
  },
  tracker: {
    title: 'Progress',
    received: 'Request received',
    approved: 'You approved',
    sentAutomatically: 'Sent automatically',
    waitingApproval: 'Waiting for your approval',
    notSent: 'Not sent yet',
    opened: 'Customer opened',
    notOpened: 'Not opened yet',
    accepted: 'Customer accepted',
    notAccepted: 'Not accepted yet',
    declined: 'Customer declined',
    expired: 'Expired',
    paid: (date: string) => `Paid ${date}`,
  },
  home: {
    title: 'Waiting for you',
    count: (n: number) => (n === 1 ? 'needs you' : 'need you'),
    /** T-160: "Where your quotes stand" */
    stand: {
      title: 'Where your quotes stand',
      acceptedNote: 'in the last 30 days',
      empty: 'No quotes yet. When a customer sends a request, you will see here whose turn it is.',
    },
    /** T-160: "Latest activity" */
    activity: {
      title: 'Latest activity',
      empty: 'Nothing has happened yet. New requests, opens and answers will show here.',
      quiet: 'Nothing in the last 30 days.',
    },
    /** T-160: "Your quote link" */
    quoteLink: {
      title: 'Your quote link',
      copy: 'Copy',
      copied: 'Copied',
      open: 'Open',
      more: 'QR code and website form',
    },
    /** T-160: the four numbers and how they changed */
    numbers: {
      title: (days: number) => `Last ${days} days`,
      all: 'See all numbers',
      note: (days: number) => `Compared with the ${days} days before.`,
      requests: 'Requests',
      sent: 'Estimates sent',
      accepted: 'Accepted',
      valueAccepted: 'Value accepted',
      up: (amount: string) => `up ${amount}`,
      down: (amount: string) => `down ${amount}`,
      same: 'same',
    },
  },
  /** T-160: the dashboard menu, in sections */
  menu: {
    sections: { work: 'Work', setUp: 'Set up', account: 'Account' },
    home: 'Home',
    quotes: 'Quotes',
    unfinished: 'Unfinished requests',
    analytics: 'Analytics',
    services: 'Services',
    quoteLink: 'Quote link',
    whatsapp: 'WhatsApp',
    settings: 'Settings',
  },
  /** T-160: unfinished requests (people who started and did not finish) */
  unfinished: {
    banner: (n: number) =>
      `${n === 1 ? 'new person' : 'new people'} started a request but didn't finish. A quick call often wins the job.`,
    bannerButton: 'See who',
    newTag: 'New',
    done: 'Done',
    doneSaving: 'Saving…',
    doneNote: "Marked as done. They won't show here again.",
    saveFailed: 'Could not save that. Please try again.',
  },
} as const

// ---------------------------------------------------------------------------
// Time words
// ---------------------------------------------------------------------------

export interface QuoteTurnOptions {
  /** Defaults to the current time */
  now?: Date
  /** Defaults to the viewer's locale */
  locale?: string
  /** Defaults to the viewer's time zone */
  timeZone?: string
}

/** The calendar day of a moment in a time zone, as a day count (for differences only) */
function dayNumber(date: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Math.round(Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000)
}

/** Whole calendar days from a moment until now; null without a usable date. Never negative. */
export function daysSince(iso: string | null | undefined, opts: QuoteTurnOptions = {}): number | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  return Math.max(0, dayNumber(opts.now ?? new Date(), opts.timeZone) - dayNumber(then, opts.timeZone))
}

/** "12 Nov" */
export function shortDate(iso: string | null | undefined, opts: QuoteTurnOptions = {}): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(opts.locale, { day: 'numeric', month: 'short', timeZone: opts.timeZone }).format(date)
}

/** "today", "yesterday", "2 days ago" (up to 6), then "on 12 Nov" */
export function whenWords(iso: string | null | undefined, opts: QuoteTurnOptions = {}): string | null {
  const days = daysSince(iso, opts)
  if (days === null) return null
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return `on ${shortDate(iso, opts)}`
}

/**
 * How long ago, by the clock: "just now", "5 minutes ago", "2 hours ago",
 * "yesterday", "3 days ago", then "on 12 Nov" (T-160, Home's latest activity).
 * It counts elapsed time, not calendar days, so it reads the same wherever it
 * is worked out.
 */
export function agoWords(iso: string | null | undefined, opts: QuoteTurnOptions = {}): string | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const minutes = Math.max(0, Math.floor(((opts.now ?? new Date()).getTime() - then.getTime()) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return `on ${shortDate(iso, opts)}`
}

// ---------------------------------------------------------------------------
// Latest activity (T-160): one line per thing that happened to a quote
// ---------------------------------------------------------------------------

export type QuoteActivityKind = 'request' | 'approved' | 'opened' | 'question' | 'accepted' | 'declined'

/** "Sarah opened the quote". No "his" or "her": a name does not tell us which. */
export function quoteActivityLine(kind: QuoteActivityKind, customerName: string | null | undefined): string {
  const first = customerFirstName(customerName)
  const Name = first ?? 'A customer'
  switch (kind) {
    case 'request':
      return `${Name} sent a request`
    case 'approved':
      return first ? `You approved ${first}'s quote` : 'You approved a quote'
    case 'opened':
      return `${Name} opened the quote`
    case 'question':
      return `${Name} asked a question`
    case 'accepted':
      return `${Name} accepted the quote`
    case 'declined':
      return `${Name} declined the quote`
  }
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/** What the one next step does. `null` in a turn means there is nothing to do. */
export type QuoteNextAction = 'approve' | 'add_price' | 'price_request' | 'answer_question' | 'send_again' | 'contact'

export type QuoteTurnTone = 'attention' | 'danger' | 'waiting' | 'good' | 'closed' | 'working'

export interface QuoteTurnInput {
  status: QuoteStatus | string
  customerName?: string | null
  /** Send again needs an address to send to (the T-157 rule) */
  hasEmail: boolean
  /** The price; a pending quote with none cannot be approved yet */
  total?: number | null
  /** pending_review held by the plan limit (content_json.limitHold) */
  held?: boolean
  createdAt?: string | null
  sentAt?: string | null
  viewedAt?: string | null
  acceptedAt?: string | null
  paidAt?: string | null
  declinedAt?: string | null
  /** When the customer's link runs out (token_expires_at) */
  expiresAt?: string | null
}

export interface QuoteTurn {
  group: QuoteGroup
  /** The short status the business reads */
  label: string
  /** One line under the label; '' when there is nothing to add */
  detail: string
  /** The quote page's next-step sentence */
  sentence: string
  /** The one next step, or null when there is nothing for the business to do */
  action: QuoteNextAction | null
  /** The words on the list row's button for that step */
  buttonLabel: string | null
  tone: QuoteTurnTone
}

/** "Morgan" from "Morgan Field"; null when there is no name */
export function customerFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? first : null
}

function turn(
  group: QuoteGroup,
  tone: QuoteTurnTone,
  label: string,
  detail: string | null,
  sentence: string,
  action: QuoteNextAction | null
): QuoteTurn {
  return {
    group,
    tone,
    label,
    detail: detail ?? '',
    sentence,
    action,
    buttonLabel: action ? QUOTE_TURN_COPY.listButtons[action] : null,
  }
}

/** What the business sees for one quote: group, label, detail line and next step */
export function quoteTurn(input: QuoteTurnInput, opts: QuoteTurnOptions = {}): QuoteTurn {
  const L = QUOTE_TURN_COPY.labels
  const first = customerFirstName(input.customerName)
  const name = first ?? 'the customer'
  const Name = first ?? 'The customer'
  const when = (iso: string | null | undefined) => whenWords(iso, opts)
  const onDate = (iso: string | null | undefined) => {
    const date = shortDate(iso, opts)
    return date ? ` on ${date}` : ''
  }
  const received = () => {
    const words = when(input.createdAt)
    return words ? `Received ${words}` : ''
  }
  const group = quoteGroupOf(input.status)

  switch (input.status) {
    case 'pending_review': {
      if (input.held) {
        return turn(
          group,
          'attention',
          L.held,
          'Your plan limit was reached',
          `This request arrived after your plan limit was reached, so it has no price. ${Name} was told you will send their estimate shortly. Upgrade your plan, then price it.`,
          'price_request'
        )
      }
      if (!((input.total ?? 0) > 0)) {
        return turn(group, 'attention', L.needsApproval, 'No price yet', `This quote has no price yet. Add the price, then send it to ${name}.`, 'add_price')
      }
      return turn(
        group,
        'attention',
        L.needsApproval,
        received(),
        'Check the price and approve. The customer can accept only after you approve.',
        'approve'
      )
    }

    case 'feedback_received':
      return turn(
        group,
        'attention',
        L.question,
        'Waiting for your answer',
        `${Name} asked a question. Answer them, then mark it as answered, or edit the quote and send it again.`,
        'answer_question'
      )

    case 'failed':
      return turn(
        group,
        'danger',
        L.failed,
        received(),
        `We could not work out a price for this request. Contact ${name} and quote it yourself.`,
        'contact'
      )

    case 'sent': {
      const sentAt = input.sentAt ?? input.createdAt
      const sent = when(sentAt)
      // Opened once, then sent again: "not opened yet" would be untrue
      const openedBefore = Boolean(input.viewedAt && sentAt && new Date(input.viewedAt).getTime() < new Date(sentAt).getTime())
      const detail = sent ? `Sent ${sent}, ${openedBefore ? 'not opened since' : 'not opened yet'}` : openedBefore ? 'Not opened since' : 'Not opened yet'
      const days = daysSince(sentAt, opts) ?? 0
      if (days < SEND_AGAIN_AFTER_DAYS) {
        return turn(group, 'waiting', L.waiting, detail, `Nothing for you to do. Waiting for ${name}. ${detail}.`, null)
      }
      const unopened = `${Name} has not opened the quote${sent ? `, sent ${sent}` : ''}.`
      return canSendQuoteAgain(input.status, { hasEmail: input.hasEmail })
        ? turn(group, 'waiting', L.waiting, detail, `${unopened} Send it again.`, 'send_again')
        : turn(group, 'waiting', L.waiting, detail, `${unopened} They gave no email address, so copy the link and send it another way.`, 'contact')
    }

    case 'viewed': {
      const opened = when(input.viewedAt)
      return turn(
        group,
        'waiting',
        L.waiting,
        opened ? `Opened ${opened}` : 'Opened',
        `Nothing for you to do. Waiting for ${name}. They opened it${opened ? ` ${opened}` : ''}.`,
        null
      )
    }

    case 'revised': {
      const sent = when(input.sentAt)
      return turn(
        group,
        'waiting',
        L.waiting,
        `Updated quote sent${sent ? ` ${sent}` : ''}`,
        `Nothing for you to do. Waiting for ${name}. You sent the updated quote${sent ? ` ${sent}` : ''}.`,
        null
      )
    }

    case 'awaiting_clarification':
      return turn(
        group,
        'waiting',
        L.waiting,
        'Waiting for their answers',
        `Nothing for you to do. ${Name} was asked for more details. The price comes once they answer.`,
        null
      )

    case 'accepted': {
      const on = onDate(input.acceptedAt)
      return turn(group, 'good', L.accepted, on ? `Accepted${on}` : '', `${Name} accepted${on}. Contact them to book the job.`, 'contact')
    }

    case 'paid': {
      const on = onDate(input.paidAt)
      return turn(group, 'good', L.paid, on ? `Paid${on}` : '', `${Name} paid${on}. Nothing for you to do.`, null)
    }

    case 'declined': {
      const on = onDate(input.declinedAt)
      return turn(group, 'closed', L.declined, on ? `Declined${on}` : '', `${Name} declined${on}. Nothing for you to do.`, null)
    }

    case 'expired': {
      const on = onDate(input.expiresAt)
      const expired = `This quote expired${on} without an answer.`
      return canSendQuoteAgain(input.status, { hasEmail: input.hasEmail })
        ? turn(group, 'closed', L.expired, on ? `Expired${on}` : '', `${expired} Send it again to give ${name} a new link.`, 'send_again')
        : turn(group, 'closed', L.expired, on ? `Expired${on}` : '', `${expired} Contact ${name} if the job is still open.`, 'contact')
    }

    default:
      // queued, generating (and anything unknown reads as still working)
      return turn('working', 'working', L.working, received(), 'We are working out the price. Nothing for you to do yet.', null)
  }
}

// ---------------------------------------------------------------------------
// The four-step tracker on the quote page
// ---------------------------------------------------------------------------

export interface QuoteTrackerInput {
  status: QuoteStatus | string
  /** The price and the plan hold decide whether step two is waiting on the business */
  total?: number | null
  held?: boolean
  createdAt?: string | null
  /** When the business approved it; empty on a quote that was sent automatically */
  approvedAt?: string | null
  sentAt?: string | null
  viewedAt?: string | null
  acceptedAt?: string | null
  paidAt?: string | null
  declinedAt?: string | null
  expiresAt?: string | null
}

export interface QuoteTrackerStep {
  key: 'received' | 'approved' | 'opened' | 'decided'
  label: string
  done: boolean
  /** "12 Nov" on a done step that has a date */
  date: string | null
  /** A second line ("Paid 14 Nov") */
  note: string | null
  /** The final step when the quote ended without an acceptance */
  ended: boolean
}

/** Request received, You approved, Customer opened, Customer accepted */
export function quoteTracker(input: QuoteTrackerInput, opts: QuoteTurnOptions = {}): QuoteTrackerStep[] {
  const T = QUOTE_TURN_COPY.tracker
  const date = (iso: string | null | undefined) => shortDate(iso, opts)
  const step = (
    key: QuoteTrackerStep['key'],
    label: string,
    done: boolean,
    at: string | null | undefined = null,
    extra: { note?: string | null; ended?: boolean } = {}
  ): QuoteTrackerStep => ({ key, label, done, date: done ? date(at) : null, note: extra.note ?? null, ended: extra.ended === true })

  const awaitingApproval = input.status === 'pending_review' && !input.held && (input.total ?? 0) > 0
  const second = input.approvedAt
    ? step('approved', T.approved, true, input.approvedAt)
    : input.sentAt
      ? step('approved', T.sentAutomatically, true, input.sentAt)
      : step('approved', awaitingApproval ? T.waitingApproval : T.notSent, false)

  const third = input.viewedAt ? step('opened', T.opened, true, input.viewedAt) : step('opened', T.notOpened, false)

  let fourth: QuoteTrackerStep
  if (input.status === 'accepted' || input.status === 'paid') {
    const paid = input.status === 'paid' ? date(input.paidAt) : null
    fourth = step('decided', T.accepted, true, input.acceptedAt, { note: paid ? T.paid(paid) : null })
  } else if (input.status === 'declined') {
    fourth = step('decided', T.declined, true, input.declinedAt, { ended: true })
  } else if (input.status === 'expired') {
    fourth = step('decided', T.expired, true, input.expiresAt, { ended: true })
  } else {
    fourth = step('decided', T.notAccepted, false)
  }

  return [step('received', T.received, true, input.createdAt), second, third, fourth]
}

// ---------------------------------------------------------------------------
// Customer page: "quote" once the business reviewed it, "estimate" before
// ---------------------------------------------------------------------------

export interface CustomerDecisionWords {
  noun: 'quote' | 'estimate'
  /** The accept button, before the price */
  accept: string
  accepted: string
  declined: string
  declineLink: string
  declineTitle: string
  keep: string
  declineButton: string
}

/**
 * The words around Accept and Decline on the customer's page. A quote the
 * business approved is a "quote"; one that went out automatically stays an
 * "estimate" (AD-034: those are the only two words the customer sees).
 */
export function customerDecisionWords(reviewed: boolean): CustomerDecisionWords {
  const noun = reviewed ? 'quote' : 'estimate'
  const Noun = reviewed ? 'Quote' : 'Estimate'
  return {
    noun,
    accept: `Accept this ${noun}`,
    accepted: `${Noun} accepted`,
    declined: `${Noun} declined`,
    declineLink: `No longer need this? Decline this ${noun}`,
    declineTitle: `Decline this ${noun}`,
    keep: `Keep the ${noun}`,
    declineButton: `Decline ${noun}`,
  }
}

/** Pricing trace exists once a quote has been priced and sent (the list's rule before T-158, unchanged) */
export const QUOTE_TRACE_STATUSES: readonly QuoteStatus[] = ['sent', 'viewed', 'accepted', 'paid', 'feedback_received', 'revised']

export function canViewPricingTrace(status: string | null | undefined): boolean {
  return (QUOTE_TRACE_STATUSES as readonly string[]).includes(status ?? '')
}
