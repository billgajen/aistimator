/**
 * T-204: Home and Quotes update by themselves.
 *
 * The dashboard asks one small question every few seconds while its tab is
 * on screen: "has anything changed for this business?" The answer is a short
 * stamp. Only when the stamp differs from the last one does a page read its
 * data again, so a quiet business costs one small request and no redraw.
 *
 * Short polling was chosen over a database subscription: it needs no
 * migration, no publication and no second connection from the browser, and it
 * goes through the same signed-in session and row rules as every other read.
 *
 * What moves the stamp: a request arriving (a new quote, a new unfinished
 * request), a quote being priced, sent, opened, accepted, declined or edited,
 * a customer's question, and an unfinished request moving on or being cleared.
 */

/** How often the dashboard asks, while its tab is visible */
export const PULSE_INTERVAL_MS = 5_000
/** After a failed ask (offline, signed out) it asks less often until one works */
export const PULSE_RETRY_MS = 30_000

/** The browser event a page listens for to read its data again */
export const DASHBOARD_CHANGED_EVENT = 'dashboard-data-changed'

/** How far back a change to an older quote is looked for (opened, accepted, declined, edited) */
export const PULSE_RECENT_HOURS = 24
/** The newest quotes whose status is part of the stamp */
export const PULSE_NEWEST_QUOTES = 100

export interface PulseParts {
  /** The newest quotes: id, status and version (an edit raises the version) */
  newest: ReadonlyArray<{ id: string; status: string; version?: number | null }>
  /** Quotes something happened to lately, with the times that say what */
  recent: ReadonlyArray<{
    id: string
    status: string
    sent_at?: string | null
    viewed_at?: string | null
    accepted_at?: string | null
    declined_at?: string | null
    last_amended_at?: string | null
  }>
  /** Unfinished requests as listed: how many, how many are new, and the last time one moved */
  unfinished: { listed: number; fresh: number; lastActiveAt: string | null }
  /** Customer questions waiting for the business */
  questions: number
}

/** FNV-1a over a string, as eight hex digits: a short stamp, not a secret */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * The stamp for what a business's dashboard shows. Pure: the same rows give
 * the same stamp, in any order.
 *
 * A quote is taken once, by id, with its facts merged: a quote that only
 * drops out of the "lately" window (nothing happened to it) must not move
 * the stamp, so the times are part of it only through the newest of each.
 */
export function pulseStamp(parts: PulseParts): string {
  const newest = [...parts.newest].map((q) => `${q.id}:${q.status}:${q.version ?? 0}`).sort()
  const latest = (pick: (row: PulseParts['recent'][number]) => string | null | undefined) =>
    parts.recent.map(pick).filter((value): value is string => !!value).sort().at(-1) ?? ''
  const times = [
    latest((q) => q.sent_at),
    latest((q) => q.viewed_at),
    latest((q) => q.accepted_at),
    latest((q) => q.declined_at),
    latest((q) => q.last_amended_at),
  ]
  const u = parts.unfinished
  return hash([newest.join(','), times.join(','), `${u.listed}:${u.fresh}:${u.lastActiveAt ?? ''}`, String(parts.questions)].join('|'))
}

/** The start of the "lately" window, to the hour, so the question asked of the database is steady */
export function pulseRecentSince(now: Date = new Date(), hours: number = PULSE_RECENT_HOURS): string {
  const hour = 60 * 60 * 1000
  return new Date(Math.floor((now.getTime() - hours * hour) / hour) * hour).toISOString()
}

export interface PulseAnswer {
  stamp: string
  /** Unfinished requests the business has not seen: the menu's badge */
  newUnfinished: number
}
