import { createHash, randomBytes } from 'crypto'

/**
 * Generate a secure random token for quote view URLs.
 * Returns both the plain token (for URL) and the hash (for storage).
 */
export function generateQuoteToken(): { token: string; hash: string } {
  // Generate 32 bytes of random data
  const tokenBytes = randomBytes(32)
  const token = tokenBytes.toString('base64url')

  // Hash for storage (don't store plain token)
  const hash = createHash('sha256').update(token).digest('hex')

  return { token, hash }
}

/**
 * Hash a token for comparison with stored hash.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Calculate token expiry date (default 30 days from now).
 */
export function getTokenExpiry(days: number = 30): Date {
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + days)
  return expiry
}

/**
 * PostgREST `or` filter matching a quote by any link issued for it:
 * - its current link (quote_token_hash);
 * - T-146: the link issued before the business approved it (previous_token_hash);
 * - T-157: every earlier link (link_token_hashes, kept by a database trigger
 *   whenever the token changes: copy link, send again, text link, reminder).
 * So a link the customer already has keeps working. Expiry is separate and
 * unchanged: token_expires_at covers every link of the quote.
 * Only ever called with a sha256 hex digest; anything else matches nothing.
 */
export function quoteTokenFilter(tokenHash: string): string {
  const safe = /^[0-9a-f]{64}$/.test(tokenHash) ? tokenHash : '0'.repeat(64)
  return `quote_token_hash.eq.${safe},previous_token_hash.eq.${safe},link_token_hashes.cs.{${safe}}`
}

/**
 * The same rule for a quote row already loaded (routes that fetch by id and
 * then check the token).
 */
export function quoteTokenMatches(
  quote: { quote_token_hash?: string | null; previous_token_hash?: string | null; link_token_hashes?: string[] | null },
  tokenHash: string
): boolean {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) return false
  return (
    quote.quote_token_hash === tokenHash ||
    quote.previous_token_hash === tokenHash ||
    (quote.link_token_hashes ?? []).includes(tokenHash)
  )
}
