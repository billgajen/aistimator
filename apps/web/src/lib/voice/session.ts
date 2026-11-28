/**
 * T-210, T-211: the call session. It is what pins a test call to one business, and (T-211) what
 * carries the call's own small state from one tool call to the next.
 *
 * Starting a call makes one of these on the server and hands it to the page, signed. Each of her
 * tool calls comes back through the page with it, and the tool route takes the business from the
 * session and from nowhere else: nothing in a tool's arguments can name another business, and the
 * page cannot change what it was given without breaking the signature.
 *
 * T-211: the session also holds the caller's details from the form, who is counted for strikes
 * (the device id and the address's hash, never the address), and a short record of what the
 * tools have answered so far. A tool that changes any of it (a corrected email, an estimate
 * given) gets a new signed session back, and the page sends the newest one next time. A page that
 * sends an older one only makes her forget; it cannot invent a price.
 *
 * Nothing is stored: the session is its own record, and it runs out with the call.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export interface CallContact {
  name: string
  email: string | null
  phone: string | null
}

/** What her tools have answered so far in this call: kept short, and given back to her with every tool answer */
export interface CallNotes {
  estimates: Array<{ service: string; total: number; say: string }>
  typical: Array<{ service: string; total: number; say: string }>
  visit: string | null
  estimateSent: boolean
  contactChanged: Array<'name' | 'email' | 'phone'>
}

export const NO_NOTES: CallNotes = { estimates: [], typical: [], visit: null, estimateSent: false, contactChanged: [] }

export interface CallSession {
  v: 2
  callId: string
  tenantId: string
  /** The admin who started the call: only that admin's requests can use it */
  adminId: string
  engine: string
  voice: string
  contact: CallContact
  /** Who is counted for strikes: the page's device id and a salted hash of the address. Either can be null. */
  deviceId: string | null
  ipHash: string | null
  notes: CallNotes
  /** When it stops working, in seconds since 1970 */
  exp: number
}

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(`qolumns:voice-test:v2:${payload}`).digest('hex')

/** The secret sessions are signed with: a server-only value every deployment already has. Null = cannot sign. */
export function sessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  return env.SUPABASE_SERVICE_ROLE_KEY || null
}

export function signSession(session: CallSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

/** The session a signed string holds, or null: wrong signature, wrong shape, run out, or another admin's */
export function readSession(signed: unknown, secret: string, input: { adminId: string; nowSeconds: number }): CallSession | null {
  if (typeof signed !== 'string' || signed.length > 12_000) return null
  const dot = signed.indexOf('.')
  if (dot <= 0) return null
  const payload = signed.slice(0, dot)
  const given = Buffer.from(signed.slice(dot + 1), 'utf8')
  const expected = Buffer.from(sign(payload, secret), 'utf8')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  let session: CallSession
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CallSession
  } catch {
    return null
  }
  if (session?.v !== 2 || typeof session.tenantId !== 'string' || !session.tenantId || typeof session.callId !== 'string' || typeof session.adminId !== 'string' || typeof session.exp !== 'number') return null
  if (typeof session.contact?.name !== 'string' || typeof session.notes !== 'object' || session.notes === null) return null
  if (session.exp <= input.nowSeconds || session.adminId !== input.adminId) return null
  return session
}
