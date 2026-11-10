/**
 * Public endpoint rate limiting (Upstash Redis, fixed window).
 *
 * Protects unauthenticated intake endpoints (/api/public/quotes, uploads/init,
 * widget/chat) with per-IP and per-tenant-key counters. These run BEFORE any
 * DB writes or AI calls — the worker's rate limiter only guards AI processing
 * and only applies on the queue path (SYNC_QUOTE_PROCESSING=false).
 *
 * Fail-open by design (same decision as plan-limits): missing Redis config or
 * Redis errors must never block legitimate quote requests.
 */

import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

export type RateLimitScope = 'quotes' | 'uploads' | 'chat' | 'marketing' | 'quote_page'

export interface ScopeLimits {
  /** Max requests per window from a single IP */
  ipLimit: number
  /** Max requests per window across a tenant key (all IPs) */
  tenantLimit: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  limitType?: 'ip' | 'tenant'
  retryAfterSeconds: number
}

/**
 * Store abstraction so the decision logic is unit-testable without Redis.
 * Must atomically increment each key and ensure a TTL is set.
 */
export interface RateLimitStore {
  incrementWithExpiry(keys: string[], ttlSeconds: number): Promise<number[]>
}

const DEFAULT_LIMITS: Record<RateLimitScope, ScopeLimits> = {
  // Runs the full AI pipeline synchronously — strictest limit
  quotes: { ipLimit: 5, tenantLimit: 30, windowSeconds: 60 },
  // Issues presigned R2 URLs and creates asset rows (up to 10 files/request)
  uploads: { ipLimit: 20, tenantLimit: 100, windowSeconds: 60 },
  // Each turn is a Gemini call
  chat: { ipLimit: 15, tenantLimit: 100, windowSeconds: 60 },
  // T-144: Conversions API relay (signup events) — a person signs up once
  marketing: { ipLimit: 5, tenantLimit: 1000, windowSeconds: 60 },
  // T-149: the hosted quote page /quote/{slug} (a page view: two DB reads)
  quote_page: { ipLimit: 60, tenantLimit: 2000, windowSeconds: 60 },
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getScopeLimits(scope: RateLimitScope): ScopeLimits {
  const upper = scope.toUpperCase()
  const defaults = DEFAULT_LIMITS[scope]
  return {
    ipLimit: envInt(`RATE_LIMIT_${upper}_IP`, defaults.ipLimit),
    tenantLimit: envInt(`RATE_LIMIT_${upper}_TENANT`, defaults.tenantLimit),
    windowSeconds: envInt('RATE_LIMIT_WINDOW_SECONDS', defaults.windowSeconds),
  }
}

/**
 * Pure decision logic: given post-increment counts for [ip, tenant] keys,
 * decide whether the request is allowed and which limit was hit.
 */
export function evaluateCounts(
  counts: Array<number | null>,
  limits: ScopeLimits,
  nowSeconds: number
): RateLimitResult {
  const windowStart = Math.floor(nowSeconds / limits.windowSeconds)
  const retryAfterSeconds = Math.max(1, (windowStart + 1) * limits.windowSeconds - nowSeconds)

  const [ipCount, tenantCount] = counts
  if (typeof ipCount === 'number' && ipCount > limits.ipLimit) {
    return { allowed: false, limitType: 'ip', retryAfterSeconds }
  }
  if (typeof tenantCount === 'number' && tenantCount > limits.tenantLimit) {
    return { allowed: false, limitType: 'tenant', retryAfterSeconds }
  }
  return { allowed: true, retryAfterSeconds }
}

export function buildWindowKeys(
  scope: RateLimitScope,
  ip: string,
  tenantKey: string,
  windowSeconds: number,
  nowSeconds: number
): string[] {
  const windowStart = Math.floor(nowSeconds / windowSeconds)
  // Attacker-supplied values go into keys: cap length, strip whitespace
  const safeIp = ip.replace(/\s/g, '').slice(0, 64) || 'unknown'
  const safeTenant = tenantKey.replace(/\s/g, '').slice(0, 128) || 'unknown'
  return [
    `rl:web:${scope}:ip:${safeIp}:${windowStart}`,
    `rl:web:${scope}:tenant:${safeTenant}:${windowStart}`,
  ]
}

class UpstashStore implements RateLimitStore {
  constructor(private redis: Redis) {}

  async incrementWithExpiry(keys: string[], ttlSeconds: number): Promise<number[]> {
    const pipeline = this.redis.pipeline()
    for (const key of keys) {
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
    console.warn('[RateLimit] Upstash Redis not configured — public rate limiting disabled')
    cachedStore = null
    return cachedStore
  }
  cachedStore = new UpstashStore(new Redis({ url, token }))
  return cachedStore
}

/** Test hook: inject a fake store (pass undefined to reset to env-based). */
export function setRateLimitStoreForTesting(store: RateLimitStore | null | undefined): void {
  cachedStore = store
}

/**
 * Check and consume one request against the scope's per-IP and per-tenant
 * fixed-window limits. Fails open on missing config or Redis errors.
 */
export async function checkPublicRateLimit(
  scope: RateLimitScope,
  identifiers: { ip: string; tenantKey: string }
): Promise<RateLimitResult> {
  const limits = getScopeLimits(scope)
  const store = getStore()
  if (!store) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  try {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const keys = buildWindowKeys(
      scope,
      identifiers.ip,
      identifiers.tenantKey,
      limits.windowSeconds,
      nowSeconds
    )
    const counts = await store.incrementWithExpiry(keys, limits.windowSeconds + 1)
    const result = evaluateCounts(counts, limits, nowSeconds)
    if (!result.allowed) {
      // Log the limit type only — never log the raw IP beyond what's needed
      console.warn(`[RateLimit] Blocked ${scope} request (${result.limitType} limit)`)
    }
    return result
  } catch (error) {
    console.error('[RateLimit] Redis error — failing open:', error)
    return { allowed: true, retryAfterSeconds: 0 }
  }
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

/** Standard 429 response. Message is neutral — no billing/config details. */
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
      },
    },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfterSeconds || 60) },
    }
  )
}
