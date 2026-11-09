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
 * T-146: PostgREST filter matching a quote by its current link OR the link
 * issued before the business approved it (quotes.previous_token_hash), so the
 * link the customer already holds keeps working after approval.
 * Only ever called with a sha256 hex digest; anything else matches nothing.
 */
export function quoteTokenFilter(tokenHash: string): string {
  const safe = /^[0-9a-f]{64}$/.test(tokenHash) ? tokenHash : '0'.repeat(64)
  return `quote_token_hash.eq.${safe},previous_token_hash.eq.${safe}`
}
