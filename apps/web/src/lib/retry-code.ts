/**
 * T-178: the one-time code that lets `scripts/retry-failed-quote.sh` retry a
 * quote without a signed-in platform admin.
 *
 * The script writes the SHA-256 of a random code onto the quote, through the
 * database's own management access (which only the platform's owner has),
 * and then calls the retry route with the code. Holding a code that matches
 * the row proves the caller could write to the database. A code works once,
 * for one quote, for ten minutes; the route removes it as it uses it. Pure.
 */
import { createHash, timingSafeEqual } from 'crypto'

export const RETRY_CODE_HEADER = 'x-retry-code'
export const RETRY_CODE_MINUTES = 10
const CODE_RE = /^[a-f0-9]{64}$/

export function looksLikeRetryCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && CODE_RE.test(code)
}

export function retryCodeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Does this code match the one stored on the quote, and is it still in date? */
export function retryCodeValid(code: string | null | undefined, content: unknown, now: Date = new Date()): boolean {
  if (!looksLikeRetryCode(code)) return false
  const stored = (content as { retryCode?: { hash?: unknown; expiresAt?: unknown } } | null)?.retryCode
  if (!stored || typeof stored.hash !== 'string' || typeof stored.expiresAt !== 'string') return false
  const expires = Date.parse(stored.expiresAt)
  if (Number.isNaN(expires) || expires <= now.getTime()) return false
  // never valid for longer than the script grants, whatever the row says
  if (expires - now.getTime() > RETRY_CODE_MINUTES * 60_000 + 60_000) return false
  const given = Buffer.from(retryCodeHash(code))
  const expected = Buffer.from(stored.hash)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The quote's content for a fresh run: the code, the old error and its time are dropped; "the business was told" stays */
export function contentForRetry(content: unknown): Record<string, unknown> {
  const { retryCode: _code, error: _error, failedAt: _failedAt, ...rest } = (content as Record<string, unknown> | null) ?? {}
  void _code
  void _error
  void _failedAt
  return rest
}
