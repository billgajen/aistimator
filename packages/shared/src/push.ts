/**
 * T-196: the phone's notifications. One rule for the web app and the worker.
 *
 * Three notifications, and nothing else may notify:
 *   new_request  a customer made a request (never one the business made itself)
 *   accepted     a customer accepted an estimate
 *   question     a customer used "Ask a question" on the quote page
 *
 * What a notification may carry: the customer's name, the service's name and
 * the total. Never the customer's message, address, phone or email. Its data
 * is the quote's id and the event, so a tap opens that quote.
 *
 * One notification per event: the event is claimed in the database first
 * (`push_events`), so a repriced or re-sent request, or a job the queue runs
 * twice, claims nothing and sends nothing.
 *
 * Sent through Expo's push service. A failure is logged with the quote's id
 * and a count (no token, no name) and is never thrown: the quote and the
 * email go on whatever happens here.
 */

import { formatMoney } from './format'
import { isMadeByBusiness } from './quote-turn'

export type PushEvent = 'new_request' | 'accepted' | 'question'

export const PUSH_EVENTS: readonly PushEvent[] = ['new_request', 'accepted', 'question']

/** The three switches on the Account tab, all on until the user turns one off */
export interface PushPrefs {
  newRequest: boolean
  accepted: boolean
  question: boolean
}

export const DEFAULT_PUSH_PREFS: PushPrefs = { newRequest: true, accepted: true, question: true }

/** Which switch an event answers to */
export const PUSH_PREF_OF: Record<PushEvent, keyof PushPrefs> = { new_request: 'newRequest', accepted: 'accepted', question: 'question' }

/** The switches' column names in `push_devices` */
export const PUSH_PREF_COLUMNS: Record<keyof PushPrefs, string> = { newRequest: 'notify_new_request', accepted: 'notify_accepted', question: 'notify_question' }

export type PushPlatform = 'ios' | 'android'

export function isPushPlatform(value: unknown): value is PushPlatform {
  return value === 'ios' || value === 'android'
}

/** An Expo push token: "ExponentPushToken[…]" or "ExpoPushToken[…]" */
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && /^Expo(nent)?PushToken\[[A-Za-z0-9_:-]+\]$/.test(value)
}

/** The Android channel every notification is posted to (the app creates it; a second one would need a new id) */
export const PUSH_ANDROID_CHANNEL = { id: 'quotes', name: 'Requests and estimates' } as const

/** What the Account tab and the permission question say */
export const PUSH_COPY = {
  section: 'Notifications',
  switches: {
    newRequest: { title: 'New requests', note: 'When a customer asks for an estimate' },
    accepted: { title: 'Accepted estimates', note: 'When a customer accepts' },
    question: { title: 'Customer questions', note: 'When a customer asks about their estimate' },
  } satisfies Record<keyof PushPrefs, { title: string; note: string }>,
  /** The one line before the phone's own permission question */
  ask: 'We will tell you when a customer sends a request, accepts an estimate or asks a question. Nothing else.',
  askTitle: 'Turn on notifications?',
  askYes: 'Turn on',
  askNo: 'Not now',
  /** The switches when the phone itself refuses notifications for the app */
  refused: "Turned off in your phone's settings",
  openSettings: "Open your phone's settings",
  /** A build that cannot receive notifications (one installed from a Mac for testing) */
  unavailable: 'Available in the App Store version',
  saveFailed: 'That could not be saved. Please try again.',
} as const

// ---------------------------------------------------------------------------
// Who is told, and what
// ---------------------------------------------------------------------------

/** What is known about the quote an event is about */
export interface PushQuoteFacts {
  quoteId: string
  tenantId: string
  customerName?: string | null
  serviceName?: string | null
  total?: number | null
  currency?: string | null
  locale?: string | null
  isTest?: boolean | null
  isDemo?: boolean | null
  /** The request's own record of how it was made (`quote_requests.source_json`) */
  requestSource?: unknown
}

export interface PushDevice {
  token: string
  platform?: string | null
  prefs: PushPrefs
  /** The id Expo gave the last notification sent to this phone: its receipt says whether the token is dead */
  lastTicketId?: string | null
}

/**
 * Does this event notify at all? A setup test and the public demo never do.
 * A new request notifies only when a customer made it.
 */
export function shouldNotify(event: PushEvent, facts: Pick<PushQuoteFacts, 'isTest' | 'isDemo' | 'requestSource'>): boolean {
  if (facts.isTest === true || facts.isDemo === true) return false
  if (event === 'new_request' && isMadeByBusiness(facts.requestSource)) return false
  return true
}

/** A name fit for one line: trimmed, one line, not endless */
function oneLine(value: string | null | undefined, fallback: string): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return fallback
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text
}

/** The notification's one sentence */
export function pushBody(event: PushEvent, facts: Pick<PushQuoteFacts, 'customerName' | 'serviceName' | 'total' | 'currency' | 'locale'>): string {
  const name = oneLine(facts.customerName, 'A customer')
  if (event === 'new_request') return `New request from ${name}: ${oneLine(facts.serviceName, 'a service')}`
  if (event === 'question') return `${name} asked a question about their estimate`
  const total = typeof facts.total === 'number' && Number.isFinite(facts.total) && facts.total > 0
    ? formatMoney(facts.total, facts.currency || 'USD', facts.locale || 'en-US')
    : null
  return total ? `${name} accepted your estimate: ${total}` : `${name} accepted your estimate`
}

/** What a notification carries besides its sentence: enough to open the quote, and nothing about the customer */
export interface PushData {
  quoteId: string
  event: PushEvent
}

export interface ExpoPushMessage {
  to: string
  body: string
  data: PushData
  sound: 'default'
  channelId: string
  priority: 'high'
}

/** The phones whose user has this event's switch on */
export function devicesFor(event: PushEvent, devices: PushDevice[]): PushDevice[] {
  const seen = new Set<string>()
  return devices.filter((d) => {
    if (!isExpoPushToken(d.token) || d.prefs[PUSH_PREF_OF[event]] !== true || seen.has(d.token)) return false
    seen.add(d.token)
    return true
  })
}

export function pushMessages(event: PushEvent, facts: PushQuoteFacts, devices: PushDevice[]): ExpoPushMessage[] {
  const body = pushBody(event, facts)
  return devicesFor(event, devices).map((d) => ({
    to: d.token,
    body,
    data: { quoteId: facts.quoteId, event },
    sound: 'default',
    channelId: PUSH_ANDROID_CHANNEL.id,
    priority: 'high',
  }))
}

/** The quote a tapped notification opens, read from its data; null for anything else */
export function quoteIdFromPushData(data: unknown): string | null {
  const id = typeof data === 'object' && data !== null ? (data as { quoteId?: unknown }).quoteId : null
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null
}

/** The claim's key: one per quote for a request and an acceptance, one per question asked */
export function pushEventKey(event: PushEvent, eventId?: string | null): string {
  return event === 'question' && eventId ? `question:${eventId}` : event
}

// ---------------------------------------------------------------------------
// Expo's answers
// ---------------------------------------------------------------------------

export interface ExpoTicket {
  status?: string
  id?: string
  details?: { error?: string } | null
}

/** Expo's word for a phone that no longer has the app (or turned it away for good) */
const DEAD = 'DeviceNotRegistered'

/** Sort the answers to a send: tokens Expo says are dead, the ticket ids of those accepted, and how many failed otherwise */
export function readTickets(messages: Array<Pick<ExpoPushMessage, 'to'>>, tickets: ExpoTicket[] | null | undefined): {
  dead: string[]
  accepted: Array<{ token: string; ticketId: string }>
  failed: number
} {
  const dead: string[] = []
  const accepted: Array<{ token: string; ticketId: string }> = []
  let failed = 0
  messages.forEach((message, i) => {
    const ticket = tickets?.[i]
    if (ticket?.status === 'ok') {
      if (typeof ticket.id === 'string' && ticket.id) accepted.push({ token: message.to, ticketId: ticket.id })
    } else if (ticket?.details?.error === DEAD) dead.push(message.to)
    else failed++
  })
  return { dead, accepted, failed }
}

/** The tokens whose last notification came back "this phone is gone" */
export function deadFromReceipts(devices: Array<Pick<PushDevice, 'token' | 'lastTicketId'>>, receipts: Record<string, ExpoTicket> | null | undefined): string[] {
  if (!receipts) return []
  return devices.filter((d) => d.lastTicketId && receipts[d.lastTicketId]?.status === 'error' && receipts[d.lastTicketId]?.details?.error === DEAD).map((d) => d.token)
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export const EXPO_PUSH_BASE_URL = 'https://exp.host/--/api/v2/push'

/** Expo takes at most this many notifications in one request */
export const EXPO_PUSH_BATCH = 100

/** A send that gets no answer in this long is given up: the quote does not wait for it */
export const PUSH_TIMEOUT_MS = 4000

/** What the sender needs from the database (each app gives its own service-role client) */
export interface PushStore {
  /** The quote the event is about; null when it cannot be read */
  quote(quoteId: string): Promise<PushQuoteFacts | null>
  /** Every phone registered to the business */
  devices(tenantId: string): Promise<PushDevice[]>
  /** Record the event. True only the first time: a second claim of the same event sends nothing. */
  claim(tenantId: string, quoteId: string, eventKey: string): Promise<boolean>
  removeTokens(tokens: string[]): Promise<void>
  saveTickets(tickets: Array<{ token: string; ticketId: string }>): Promise<void>
}

/** The caller's fetch. It must give up by itself after `PUSH_TIMEOUT_MS` (each app passes `AbortSignal.timeout`). */
type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface PushSender {
  store: PushStore
  fetch: FetchLike
  /** Expo's address; a test may point it at a stand-in */
  baseUrl?: string
  /** Expo's optional access token (EXPO_ACCESS_TOKEN), when the account requires one */
  accessToken?: string
  log?: (line: string) => void
}

export interface PushResult {
  /** Why nothing was sent, when nothing was */
  skipped?: 'no_quote' | 'not_notified' | 'no_devices' | 'already_sent' | 'error'
  sent: number
  failed: number
  removed: number
}

async function post(sender: PushSender, path: string, body: unknown): Promise<unknown> {
  const res = await sender.fetch(`${(sender.baseUrl || EXPO_PUSH_BASE_URL).replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(sender.accessToken && { Authorization: `Bearer ${sender.accessToken}` }),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

/**
 * Tell the business's phones about one event on one quote. Never throws.
 * `eventId` tells two questions on the same quote apart (the question's id).
 */
export async function sendBusinessPush(sender: PushSender, event: PushEvent, quoteId: string, eventId?: string | null): Promise<PushResult> {
  const log = sender.log ?? (() => undefined)
  const result: PushResult = { sent: 0, failed: 0, removed: 0 }
  try {
    const facts = await sender.store.quote(quoteId)
    if (!facts) return { ...result, skipped: 'no_quote' }
    if (!shouldNotify(event, facts)) return { ...result, skipped: 'not_notified' }

    let devices = devicesFor(event, await sender.store.devices(facts.tenantId))
    if (devices.length === 0) return { ...result, skipped: 'no_devices' }
    if (!(await sender.store.claim(facts.tenantId, quoteId, pushEventKey(event, eventId)))) return { ...result, skipped: 'already_sent' }

    // what Expo learned about each phone since its last notification: a dead token is dropped before sending
    const asked = devices.filter((d) => d.lastTicketId)
    if (asked.length > 0) {
      try {
        const answer = (await post(sender, '/getReceipts', { ids: asked.map((d) => d.lastTicketId) })) as { data?: Record<string, ExpoTicket> } | null
        const gone = deadFromReceipts(asked, answer?.data)
        if (gone.length > 0) {
          await sender.store.removeTokens(gone)
          result.removed += gone.length
          devices = devices.filter((d) => !gone.includes(d.token))
        }
      } catch {
        // the receipts are a courtesy: the notification is still sent
      }
    }

    const messages = pushMessages(event, facts, devices)
    for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH) {
      const batch = messages.slice(i, i + EXPO_PUSH_BATCH)
      try {
        const answer = (await post(sender, '/send', batch)) as { data?: ExpoTicket[] } | null
        const read = readTickets(batch, answer?.data)
        result.sent += read.accepted.length
        result.failed += read.failed
        if (read.dead.length > 0) {
          await sender.store.removeTokens(read.dead)
          result.removed += read.dead.length
        }
        if (read.accepted.length > 0) await sender.store.saveTickets(read.accepted)
      } catch (error) {
        result.failed += batch.length
        log(`[Push] ${event} for ${quoteId}: a send failed (${error instanceof Error ? error.name : 'unknown error'})`)
      }
    }
    log(`[Push] ${event} for ${quoteId}: sent ${result.sent}, failed ${result.failed}, removed ${result.removed}`)
    return result
  } catch (error) {
    log(`[Push] ${event} for ${quoteId}: not sent (${error instanceof Error ? error.name : 'unknown error'})`)
    return { ...result, skipped: 'error' }
  }
}
