/**
 * T-189: the owner's alerts (pure, shared by the worker and the web app).
 *
 * Before this the only signal that something had gone wrong was the email a
 * BUSINESS gets when its own request could not be priced (T-178). Nobody who
 * runs the product was told anything: a failing worker or a stuck queue was
 * found by opening the dashboard.
 *
 * Now one email goes to the owner's alert address when:
 *   - a quote could not be priced            (`quote_failed`)
 *   - the worker hit an error of its own, or
 *     the web app could not reach it         (`worker_error`)
 *   - requests have been waiting too long    (`queue_backed_up`)
 *   - a business reported a problem sorted
 *     as high severity (T-197)               (`support_high`)
 *   - the AI providers were busy often, or
 *     calls overflowed to the second one
 *     (T-203; counts only)                   (`ai_busy`)
 *
 * At most one email per kind per hour. The count of what was held back in
 * between is said in the next one. The email carries ids and counts only:
 * never a customer's name, contact details, words or photos, and never an
 * error's message (a message can carry an address or a key), only its name.
 *
 * To turn alerts off: remove the ALERT_EMAIL setting (worker and web). With
 * no address nothing is claimed and nothing is sent.
 */
import { PRODUCT_NAME } from './brand'
import { emailShell } from './email-shell'
import { productLogoRow } from './product-logo'

export type OpsAlertKind = 'quote_failed' | 'worker_error' | 'queue_backed_up' | 'support_high' | 'ai_busy'

/** One email per kind in this many seconds */
export const OPS_ALERT_EVERY_SECONDS = 3600
/** A request that has waited this long to be priced counts as waiting too long */
export const QUEUE_WAIT_MINUTES = 10
/** Requests older than this are left out of the queue check: an old stuck one is not news every hour */
export const QUEUE_LOOK_BACK_HOURS = 24
/** T-203: the queue check runs this often, and counts busy answers over the same stretch */
export const AI_BUSY_WINDOW_MINUTES = 5
/** T-203: this many busy retries in one window raises the `ai_busy` alert */
export const AI_BUSY_ALERT_RETRIES = 20
/** T-203: so does this many calls sent to an overflow model */
export const AI_BUSY_ALERT_OVERFLOW = 5
/** T-203: quotes that arrived longer ago than this are not read for the count (a job lives 15 minutes at most) */
export const AI_BUSY_LOOK_BACK_MINUTES = 30

export interface OpsAlert {
  kind: OpsAlertKind
  /** Short facts: ids, counts, the part of the product, an error's name. No personal data. */
  details: Record<string, string | number>
}

const WORDS: Record<OpsAlertKind, { subject: string; what: string; look: string; adminPath?: string }> = {
  quote_failed: {
    subject: 'A quote could not be priced',
    what: 'A request came in and no price could be worked out for it. The business has been emailed to reply to its customer itself, and the customer has been told the business has the request.',
    look: 'The reason is stored on the quote. Open it in the admin area and press Retry once the cause is fixed.',
  },
  worker_error: {
    subject: 'The pricing worker hit an error',
    what: 'The worker that prices requests hit an error of its own, or the web app could not reach it.',
    look: 'Check the worker’s logs and that it is deployed and answering.',
  },
  queue_backed_up: {
    subject: 'Requests are waiting to be priced',
    what: `One or more requests have been waiting more than ${QUEUE_WAIT_MINUTES} minutes for a price.`,
    look: 'Check the worker and its queue. Requests waiting can be retried from the admin area.',
  },
  // T-203: counts only. It is news, not a fault: requests were still priced unless a quote_failed alert says otherwise.
  ai_busy: {
    subject: 'The AI providers were busy',
    what: `In the last ${AI_BUSY_WINDOW_MINUTES} minutes the worker met many busy answers from an AI provider, or sent calls to the overflow provider. Requests are retried and put back by themselves; this is only so you know it is happening.`,
    look: 'If it keeps happening, check the rate limit tier of the main provider, and that the overflow provider’s key is set in the worker.',
  },
  // T-197: a business reported a problem the AI sorted as high severity
  support_high: {
    subject: 'A business reported a serious problem',
    what: 'A business sent a problem report that was sorted as high severity: quoting is blocked, a wrong price reached a customer, or data or security is at risk.',
    look: 'Open the support inbox. The report, what was attached and a draft fix ticket are there.',
    adminPath: '/admin/support',
  },
}

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** An error as an alert may carry it: its name only */
export function errorNameOf(error: unknown): string {
  return error instanceof Error && error.name ? error.name.slice(0, 60) : 'unknown error'
}

export interface OpsAlertEmailOptions {
  appUrl?: string
  /** 'production', or the name of another environment (said in the subject so a test never reads as live) */
  environment?: string
  /** How many of this kind happened since the last email and were not sent */
  heldBack?: number
}

export function opsAlertEmail(alert: OpsAlert, opts: OpsAlertEmailOptions = {}): { subject: string; html: string; text: string } {
  const words = WORDS[alert.kind]
  const where = opts.environment && opts.environment !== 'production' ? ` (${opts.environment})` : ''
  const subject = `${PRODUCT_NAME} alert${where}: ${words.subject}`
  const facts = Object.entries(alert.details).map(([label, value]) => `${label}: ${String(value).slice(0, 200)}`)
  const held = opts.heldBack && opts.heldBack > 0 ? `${opts.heldBack} more of this kind happened in the last hour and were not emailed.` : ''
  const admin = opts.appUrl ? `${opts.appUrl.replace(/\/$/, '')}${words.adminPath ?? '/admin/quotes'}` : ''
  const off = 'These alerts go to the ALERT_EMAIL address, at most one of each kind an hour. To turn them off, remove that setting.'
  const lines = [words.what, ...facts, held, words.look, admin, off].filter(Boolean)
  // T-204: the page is the one every email uses (fixed 600 px card, phone padding): emailShell
  const html = emailShell({
    title: words.subject,
    above: productLogoRow(),
    content: `<h1 style="margin:0;font-size:20px;font-weight:700;color:#1B2823;">${escape(words.subject)}</h1>
  <p style="margin:12px 0 0;font-size:15px;color:#1B2823;" data-role="what">${escape(words.what)}</p>
  ${facts.length ? `<ul style="margin:12px 0 0;padding-left:20px;font-size:14px;color:#4F5D57;" data-role="facts">${facts.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>` : ''}
  ${held ? `<p style="margin:12px 0 0;font-size:14px;color:#4F5D57;" data-role="held-back">${escape(held)}</p>` : ''}
  <p style="margin:12px 0 0;font-size:15px;color:#1B2823;">${escape(words.look)}</p>
  ${admin ? `<p style="margin:12px 0 0;font-size:15px;"><a href="${escape(admin)}" data-role="admin" style="color:#205E56;">Open the admin area</a></p>` : ''}
  <p style="margin:24px 0 0;font-size:13px;color:#626C66;" data-role="turn-off">${escape(off)}</p>`,
  })
  return { subject, html, text: lines.join('\n\n') }
}

export type OpsAlertOutcome = 'off' | 'sent' | 'held' | 'failed'

export interface OpsAlertDeps {
  /** The alert address (ALERT_EMAIL). Empty or missing: alerts are off. */
  to: string | undefined
  appUrl?: string
  environment?: string
  /**
   * Asks the database whether this kind may be sent now (claim_ops_alert).
   * Returns null, or throws, when the database cannot answer.
   */
  claim(kind: OpsAlertKind, everySeconds: number): Promise<{ send: boolean; heldBack: number } | null>
  /** Sends the email; true when it went */
  send(email: { to: string; subject: string; html: string; text: string }): Promise<boolean>
  /** When this process last sent each kind: the limit used when the database cannot answer */
  memory?: Map<OpsAlertKind, number>
  now?: () => number
}

/** One process's own record, for the hour limit when the database cannot be asked */
const SENT_HERE = new Map<OpsAlertKind, number>()

/**
 * Raise an alert: off without an address; otherwise at most one email per
 * kind per hour. The database keeps the hour across every copy of the worker
 * and the web app. When the database cannot answer (which may be the very
 * fault being reported), this process's own memory keeps it, so a fault is
 * still reported and a burst still cannot flood the inbox. Never throws.
 */
export async function raiseOpsAlert(alert: OpsAlert, deps: OpsAlertDeps): Promise<OpsAlertOutcome> {
  try {
    const to = (deps.to ?? '').trim()
    if (!to) return 'off'
    const now = (deps.now ?? Date.now)()
    const memory = deps.memory ?? SENT_HERE

    let claim: { send: boolean; heldBack: number } | null = null
    try {
      claim = await deps.claim(alert.kind, OPS_ALERT_EVERY_SECONDS)
    } catch {
      claim = null
    }
    if (claim === null) {
      const last = memory.get(alert.kind)
      if (last !== undefined && now - last < OPS_ALERT_EVERY_SECONDS * 1000) return 'held'
      claim = { send: true, heldBack: 0 }
    }
    if (!claim.send) return 'held'

    memory.set(alert.kind, now)
    const email = opsAlertEmail(alert, { appUrl: deps.appUrl, environment: deps.environment, heldBack: claim.heldBack })
    return (await deps.send({ to, ...email })) ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * The queue check: of the requests waiting now, the ones that were already
 * waiting at the previous check. A request priced again after an answer is
 * "queued" for a few seconds; only one seen waiting twice, a check apart, is
 * stuck.
 */
export function stillWaiting(previous: unknown, current: readonly string[]): string[] {
  const before = new Set(Array.isArray(previous) ? previous.filter((id): id is string => typeof id === 'string') : [])
  return current.filter((id) => before.has(id))
}

/** T-203: what one quote's stored notes say about busy models (see the worker's stage-timer.ts and busy-state.ts) */
export interface BusyRow {
  /** `pricing_trace_json.timings` of a quote that was priced */
  timings?: { busyRetries?: unknown; overflowCalls?: unknown; busyRequeues?: unknown; lastRun?: { busyRetries?: unknown; overflowCalls?: unknown } | null; finishedAt?: unknown } | null
  /** `content_json.busy` of a quote that was put back and is not priced yet */
  busy?: { requeues?: unknown; lastAt?: unknown; lastRun?: { busyRetries?: unknown; overflowCalls?: unknown } | null } | null
}

export interface BusyCount {
  busyRetries: number
  overflowCalls: number
  /** Quotes put back in the window because a model was busy on every provider */
  requeued: number
  /** Quotes that met any of it */
  quotes: number
}

const wholeNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
const within = (at: unknown, from: number, to: number): boolean => {
  if (typeof at !== 'string') return false
  const time = Date.parse(at)
  return !Number.isNaN(time) && time > from && time <= to
}

/**
 * T-203: busy retries and overflow calls that happened between `from` and
 * `to`. Each run of a quote is counted once, in the window it ended in: a
 * priced quote by its last run (its totals when it was never put back), a
 * quote still waiting by the run that put it back.
 */
export function countBusy(rows: readonly BusyRow[], from: number, to: number): BusyCount {
  const count: BusyCount = { busyRetries: 0, overflowCalls: 0, requeued: 0, quotes: 0 }
  for (const row of rows) {
    let retries = 0
    let overflow = 0
    let requeued = 0
    if (row.timings && within(row.timings.finishedAt, from, to)) {
      const run = row.timings.lastRun ?? row.timings
      retries += wholeNumber(run.busyRetries)
      overflow += wholeNumber(run.overflowCalls)
    }
    if (row.busy && within(row.busy.lastAt, from, to)) {
      retries += wholeNumber(row.busy.lastRun?.busyRetries)
      overflow += wholeNumber(row.busy.lastRun?.overflowCalls)
      requeued = 1
    }
    if (retries + overflow + requeued === 0) continue
    count.busyRetries += retries
    count.overflowCalls += overflow
    count.requeued += requeued
    count.quotes += 1
  }
  return count
}

/** T-203: does a window's count pass a threshold? */
export function busyAlertDue(count: BusyCount): boolean {
  return count.busyRetries >= AI_BUSY_ALERT_RETRIES || count.overflowCalls >= AI_BUSY_ALERT_OVERFLOW
}
