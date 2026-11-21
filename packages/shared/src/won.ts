/**
 * T-196: "Won through Qolumns" — what the business won this calendar month.
 *
 * Pure. One rule for the dashboard's Home and the phone app's home tab.
 *
 * Two parts, split by who made the request (`isMadeByBusiness`, quote-turn.ts,
 * the only rule for that):
 *   - customer requests (website form, quote link, QR code, WhatsApp): the
 *     headline and the four steps;
 *   - estimates the business made on site: one quieter line, never added to
 *     the headline or the steps.
 *
 * Every number is counted by when it happened (a request by when it arrived,
 * an acceptance by when it was accepted), the way Home has always counted
 * (home-numbers.ts). The value is the accepted estimate's total. Setup tests
 * never count. Nothing shows before the first accepted estimate.
 */

import { PRODUCT_NAME } from './brand'
import { formatMoney } from './format'
import { QUOTE_TURN_COPY, isMadeByBusiness } from './quote-turn'

// ---------------------------------------------------------------------------
// The month, in the business's time zone
// ---------------------------------------------------------------------------

/** True for a time zone name this runtime knows ("Europe/London") */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** How far a zone's clock is ahead of UTC at a moment, in milliseconds */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/**
 * The first moment of a calendar month in a time zone. `monthsBack` 0 is the
 * month `now` falls in (there), 1 the month before, -1 the month after.
 */
export function monthStart(now: Date, timeZone: string, monthsBack = 0): Date {
  const zone = isTimeZone(timeZone) ? timeZone : 'UTC'
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' }).formatToParts(now)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // midnight on the 1st as if the zone were UTC, then moved by the zone's offset there
  const wall = Date.UTC(part('year'), part('month') - 1 - monthsBack, 1)
  const first = wall - zoneOffset(new Date(wall), zone)
  // the offset at the answer can differ from the one at the guess (a clock change between them)
  return new Date(wall - zoneOffset(new Date(first), zone))
}

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

export interface WonRow {
  status: string
  created_at: string
  sent_at?: string | null
  viewed_at?: string | null
  accepted_at?: string | null
  pricing_json?: { total?: number } | null
  is_test?: boolean | null
  /** The request's own record of how it was made (`quote_requests.source_json`), or just its type */
  source?: unknown
}

export interface WonTotals {
  /** The accepted estimates' totals, added up */
  value: number
  jobs: number
}

export interface WonStep {
  key: 'requests' | 'sent' | 'opened' | 'accepted'
  label: string
  count: number
  /** The share of the step before that moved on to this one ("71%"), when it can be said */
  share: string | null
}

export interface WonSummary {
  title: string
  /** Customer requests: the headline, the four steps, last month */
  customer: (WonTotals & { steps: WonStep[] | null; lastMonth: WonTotals | null }) | null
  /** Estimates the business made on site, accepted this month */
  onSite: (WonTotals & { lastMonth: WonTotals | null }) | null
}

export interface WonInput {
  now: Date
  /** The business's time zone; UTC when unknown */
  timeZone: string
  /** Accepted estimates in all time (setup tests left out): any kind, and those from customer requests */
  everAccepted: { any: number; fromCustomers: number }
}

const ACCEPTED_STATUSES = ['accepted', 'paid']

/** "71%": the share of `from` that reached `to`. Null when there is nothing to divide, or more arrived than left. */
export function shareMoved(from: number, to: number): string | null {
  if (from <= 0 || to < 0 || to > from) return null
  return `${Math.round((to / from) * 100)}%`
}

/**
 * What the panel shows, or null when it does not show at all: before the
 * first accepted estimate, or when there is nothing to say this month.
 */
export function wonSummary(rows: WonRow[] | null | undefined, input: WonInput): WonSummary | null {
  if (input.everAccepted.any <= 0) return null
  const from = monthStart(input.now, input.timeZone).getTime()
  const before = monthStart(input.now, input.timeZone, 1).getTime()
  const until = input.now.getTime()
  const inMonth = (iso: string | null | undefined, start: number, end: number) => {
    if (!iso) return false
    const at = new Date(iso).getTime()
    return at >= start && at <= end
  }
  const thisMonth = (iso: string | null | undefined) => inMonth(iso, from, until)
  const lastMonth = (iso: string | null | undefined) => inMonth(iso, before, from - 1)

  const mine = { now: { value: 0, jobs: 0 }, last: { value: 0, jobs: 0 } }
  const theirs = { now: { value: 0, jobs: 0 }, last: { value: 0, jobs: 0 } }
  const steps = { requests: 0, sent: 0, opened: 0 }
  for (const q of rows ?? []) {
    if (q.is_test) continue
    const onSite = isMadeByBusiness(typeof q.source === 'string' ? { type: q.source } : q.source)
    const won = ACCEPTED_STATUSES.includes(q.status)
    if (!onSite) {
      // A step with no date of its own was still passed when a later one happened: an estimate
      // accepted this month was opened, and one opened or accepted was sent.
      const acceptedNow = won && thisMonth(q.accepted_at)
      const openedNow = q.viewed_at ? thisMonth(q.viewed_at) : acceptedNow
      const sentNow = q.sent_at ? thisMonth(q.sent_at) : openedNow
      if (thisMonth(q.created_at)) steps.requests++
      if (sentNow) steps.sent++
      if (openedNow) steps.opened++
    }
    if (!won) continue
    const bucket = thisMonth(q.accepted_at) ? 'now' : lastMonth(q.accepted_at) ? 'last' : null
    if (!bucket) continue
    const totals = (onSite ? mine : theirs)[bucket]
    totals.jobs++
    const total = q.pricing_json?.total
    if (typeof total === 'number' && Number.isFinite(total)) totals.value += total
  }

  const C = WON_COPY
  const showCustomer = steps.requests > 0 || input.everAccepted.fromCustomers > 0
  const anyStep = steps.requests + steps.sent + steps.opened + theirs.now.jobs > 0
  const customer: WonSummary['customer'] = showCustomer
    ? {
        ...theirs.now,
        steps: anyStep
          ? [
              { key: 'requests', label: C.steps.requests, count: steps.requests, share: null },
              { key: 'sent', label: C.steps.sent, count: steps.sent, share: shareMoved(steps.requests, steps.sent) },
              { key: 'opened', label: C.steps.opened, count: steps.opened, share: shareMoved(steps.sent, steps.opened) },
              { key: 'accepted', label: C.steps.accepted, count: theirs.now.jobs, share: shareMoved(steps.opened, theirs.now.jobs) },
            ]
          : null,
        lastMonth: theirs.last.jobs > 0 ? theirs.last : null,
      }
    : null
  const onSite: WonSummary['onSite'] = mine.now.jobs > 0 ? { ...mine.now, lastMonth: mine.last.jobs > 0 ? mine.last : null } : null
  // nothing to say this month: no empty panel
  if (!customer && !onSite) return null
  return { title: customer ? C.title : C.onSiteTitle, customer, onSite }
}

// ---------------------------------------------------------------------------
// Wording (the only place it lives)
// ---------------------------------------------------------------------------

export const WON_COPY = {
  title: `Won through ${PRODUCT_NAME}`,
  onSiteTitle: 'Quoted on site this month',
  customerTitle: 'Won from customer requests',
  allNumbers: QUOTE_TURN_COPY.home.numbers.all,
  steps: {
    requests: QUOTE_TURN_COPY.home.numbers.requests,
    sent: QUOTE_TURN_COPY.home.numbers.sent,
    opened: 'Opened',
    accepted: QUOTE_TURN_COPY.home.numbers.accepted,
  },
  /** "Won this month: $12,400 from 7 jobs" */
  headline: (money: string, jobs: number) => (jobs > 0 ? `Won this month: ${money} from ${jobs} ${jobs === 1 ? 'job' : 'jobs'}` : 'No jobs won yet this month'),
  /** "Plus $3,200 from 2 estimates you made on site." Without "Plus" when it stands alone. */
  onSite: (money: string, jobs: number, alone: boolean) =>
    `${alone ? '' : 'Plus '}${money} from ${jobs} ${jobs === 1 ? 'estimate' : 'estimates'} you made on site.`,
  lastMonth: (money: string, jobs: number, noun: 'job' | 'estimate') => `Last month: ${money} from ${jobs} ${jobs === 1 ? noun : `${noun}s`}`,
  /** What a screen reader hears between two steps */
  shareSpoken: (share: string) => `${share} moved on`,
} as const

export interface WonLines {
  title: string
  /** "Won this month: $12,400 from 7 jobs", or null when the business only quotes on site */
  headline: string | null
  /** "Plus $3,200 from 2 estimates you made on site." */
  onSite: string | null
  /** "Last month: $9,800 from 5 jobs" */
  lastMonth: string | null
}

/** The panel's sentences, with the money written in the business's currency (whole units, as Home shows money) */
export function wonLines(summary: WonSummary, currency: string, locale: string): WonLines {
  const money = (amount: number) => formatMoney(amount, currency, locale, { decimals: 0 })
  const C = WON_COPY
  const last = summary.customer ? summary.customer.lastMonth : (summary.onSite?.lastMonth ?? null)
  return {
    title: summary.title,
    headline: summary.customer ? C.headline(money(summary.customer.value), summary.customer.jobs) : null,
    onSite: summary.onSite ? C.onSite(money(summary.onSite.value), summary.onSite.jobs, !summary.customer) : null,
    lastMonth: last ? C.lastMonth(money(last.value), last.jobs, summary.customer ? 'job' : 'estimate') : null,
  }
}
