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
