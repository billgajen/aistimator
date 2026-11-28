/**
 * T-210: the call session. It is what pins a test call to one business.
 *
 * Starting a call makes one of these on the server and hands it to the page, signed. Each of her
 * tool calls comes back through the page with it, and the tool route takes the business from the
 * session and from nowhere else: nothing in a tool's arguments can name another business, and the
 * page cannot change the one it was given without breaking the signature.
 *
 * Nothing is stored: the session is its own record, and it runs out with the call.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export interface CallSession {
  v: 1
  callId: string
  tenantId: string
  /** The admin who started the call: only that admin's requests can use it */
  adminId: string
  voice: string
  /** When it stops working, in seconds since 1970 */
  exp: number
}

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(`qolumns:voice-test:v1:${payload}`).digest('hex')

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
  if (typeof signed !== 'string' || signed.length > 2000) return null
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
  if (session?.v !== 1 || typeof session.tenantId !== 'string' || !session.tenantId || typeof session.callId !== 'string' || typeof session.adminId !== 'string' || typeof session.exp !== 'number') return null
  if (session.exp <= input.nowSeconds || session.adminId !== input.adminId) return null
  return session
}
