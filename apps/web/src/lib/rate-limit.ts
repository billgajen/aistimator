/**
 * Public endpoint rate limiting (Upstash Redis, fixed windows).
 *
 * Every limit is in lib/rate-limit-config.ts. A scope has one or more
 * windows; in each, one counter is kept per IP address and one per key (the
 * business, the quote or the email address). A call is refused when any
 * counter is over its limit. The check runs before any database write or AI
 * call. (The worker's own limiter only guards AI processing on the queue path.)
 *
 * Fail-open by design (same decision as plan-limits): with Upstash not
 * configured, slow or returning errors, the request goes ahead and the
 * failure is logged. A limiter must never take the product down with it.
 */

import { Redis } from '@upstash/redis'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { RATE_LIMIT_TIMEOUT_MS, blockedMessage, type LimitWindow, type RateLimitScope } from './rate-limit-config'
import { buildCounters, evaluateCounters, getScopeWindows, type RateLimitResult, type WindowCounter } from './rate-limit-counters'

export type { RateLimitScope, LimitWindow, RateLimitResult, WindowCounter }
// The counting itself is pure and lives in rate-limit-counters.ts, so the middleware (Edge) can share it (T-178)
export { buildCounters, evaluateCounters, getScopeWindows }

/**
 * Store abstraction so the decision logic is unit-testable without Redis.
 * Must atomically increment each key and make sure it expires.
 */
export interface RateLimitStore {
  incrementWithExpiry(keys: Array<{ key: string; ttlSeconds: number }>): Promise<number[]>
}

class UpstashStore implements RateLimitStore {
  constructor(private redis: Redis) {}

  async incrementWithExpiry(keys: Array<{ key: string; ttlSeconds: number }>): Promise<number[]> {
    const pipeline = this.redis.pipeline()
    for (const { key, ttlSeconds } of keys) {
      pipeline.incr(key)
      pipeline.expire(key, ttlSeconds)
    }
    const results = await pipeline.exec()
    // Results alternate [incr, expire, incr, expire, ...] — keep the incr values
    return keys.map((_, i) => Number(results[i * 2]))
  }
}

let cachedStore: RateLimitStore | null | undefined

function getStore(): RateLimitStore | null {
  if (cachedStore !== undefined) return cachedStore
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    console.warn('[RateLimit] PROTECTION OFF: Upstash Redis is not configured (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN), so no public rate limit applies')
    cachedStore = null
    return cachedStore
  }
  // No retries: a limiter that waits on a failing store slows every request
  cachedStore = new UpstashStore(new Redis({ url, token, retry: { retries: 0 } }))
  return cachedStore
}

/** Whether rate limiting is switched on (Upstash is configured) */
export function rateLimitingConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

/** Test hook: inject a fake store (pass undefined to reset to env-based). */
export function setRateLimitStoreForTesting(store: RateLimitStore | null | undefined): void {
  cachedStore = store
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Count one request against the scope's limits and say whether it may go
 * ahead. `ip` and `key` are each optional: pass only the one a check is for.
 * Fails open when Upstash is not configured, slow or failing.
 */
export async function checkRateLimit(
  scope: RateLimitScope,
  identifiers: { ip?: string; key?: string }
): Promise<RateLimitResult> {
  const store = getStore()
  if (!store) return { allowed: true, retryAfterSeconds: 0 }

  try {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const counters = buildCounters(scope, identifiers, nowSeconds)
    if (counters.length === 0) return { allowed: true, retryAfterSeconds: 0 }
    const counts = await withTimeout(store.incrementWithExpiry(counters), RATE_LIMIT_TIMEOUT_MS)
    const result = evaluateCounters(counters, counts)
    if (!result.allowed) {
      // The scope and which counter only: never the address, the business or the email
      console.warn(`[RateLimit] Blocked ${scope} request (${result.limitType} limit, ${result.retryAfterSeconds}s left)`)
    }
    return result
  } catch (error) {
    console.error(`[RateLimit] FAILING OPEN: Upstash did not answer for ${scope}; the request went ahead unchecked:`, error instanceof Error ? error.message : 'unknown error')
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

/** The older name and shape: per IP and per business key */
export async function checkPublicRateLimit(
  scope: RateLimitScope,
  identifiers: { ip: string; tenantKey: string }
): Promise<RateLimitResult> {
  return checkRateLimit(scope, { ip: identifiers.ip, key: identifiers.tenantKey })
}

/** An email address as a rate-limit key: lower-cased and hashed, so no address is stored in Redis */
export function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)
}

/** Extract the client IP from proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(request: Request | { headers: Headers }): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Standard 429 response. The message is plain and gives no billing or configuration detail. */
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = result.retryAfterSeconds || 60
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: blockedMessage(retryAfterSeconds),
        retryAfterSeconds,
      },
    },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    }
  )
}
