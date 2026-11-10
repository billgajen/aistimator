/**
 * T-150: test requests from setup — a short-lived token the server issues to
 * the signed-in owner, so a test request can skip the plan and usage
 * counters. A public visitor can't make one: it is an HMAC over the tenant id
 * and expiry with a server-only secret, checked again on submission against
 * the tenant the widget key belongs to.
 *
 * Secret: TEST_QUOTE_SECRET when set, otherwise a key derived from the
 * Supabase service-role key (server-only and always present), so no new
 * environment variable is required.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

export const TEST_TOKEN_TTL_MS = 2 * 60 * 60 * 1000
/** Test requests one business can make in 24 hours before they count again */
export const TEST_QUOTES_PER_DAY = 10

interface TokenPayload {
  /** tenant id */
  t: string
  /** expiry, ms since epoch */
  e: number
  /** nonce */
  n: string
}

function secret(): string {
  const explicit = process.env.TEST_QUOTE_SECRET
  if (explicit) return explicit
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('No secret available for test tokens')
  return createHmac('sha256', base).update('aistimator:test-quote-token:v1').digest('hex')
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
const sign = (body: string, key: string) => createHmac('sha256', key).update(body).digest('base64url')

export function issueTestToken(tenantId: string, now = Date.now(), key = secret()): { token: string; expiresAt: string } {
  const payload: TokenPayload = { t: tenantId, e: now + TEST_TOKEN_TTL_MS, n: randomBytes(6).toString('hex') }
  const body = b64(JSON.stringify(payload))
  return { token: `${body}.${sign(body, key)}`, expiresAt: new Date(payload.e).toISOString() }
}

export type TestTokenCheck = { ok: true; tenantId: string } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_tenant' }

/** Is this a valid, unexpired test token for `tenantId`? */
export function verifyTestToken(token: string, tenantId: string, now = Date.now(), key = secret()): TestTokenCheck {
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined || token.length > 400) return { ok: false, reason: 'malformed' }
  const expected = Buffer.from(sign(body, key))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' }
  let payload: TokenPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof payload.t !== 'string' || typeof payload.e !== 'number') return { ok: false, reason: 'malformed' }
  if (payload.e < now) return { ok: false, reason: 'expired' }
  if (payload.t !== tenantId) return { ok: false, reason: 'wrong_tenant' }
  return { ok: true, tenantId: payload.t }
}
