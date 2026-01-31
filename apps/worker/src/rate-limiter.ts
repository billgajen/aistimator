/**
 * Upstash Redis Rate Limiter
 *
 * Implements sliding window rate limiting using Redis INCR with TTL.
 * Supports both global and per-tenant limits.
 */

import { Redis } from '@upstash/redis'

export interface RateLimiterConfig {
  /** Global limit across all tenants per window */
  globalLimit: number
  /** Per-tenant limit per window */
  tenantLimit: number
  /** Window size in seconds (default: 60) */
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Current count in window */
  current: number
  /** Limit that was checked */
  limit: number
  /** Seconds until window resets */
  resetIn: number
  /** Which limit was hit (if any) */
  limitType?: 'global' | 'tenant'
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  globalLimit: 100, // 100 requests/minute across all tenants
  tenantLimit: 10, // 10 requests/minute per tenant
  windowSeconds: 60,
}

export class RateLimiter {
  private redis: Redis
  private config: RateLimiterConfig

  constructor(redisUrl: string, redisToken: string, config?: Partial<RateLimiterConfig>) {
    this.redis = new Redis({
      url: redisUrl,
      token: redisToken,
    })
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Get the current window key based on timestamp
   */
  private getWindowKey(prefix: string): string {
    const windowStart = Math.floor(Date.now() / 1000 / this.config.windowSeconds)
    return `${prefix}:${windowStart}`
  }

  /**
   * Check if a request is allowed under rate limits
   */
  async checkLimit(tenantId: string): Promise<RateLimitResult> {
    const globalKey = this.getWindowKey('ratelimit:global')
    const tenantKey = this.getWindowKey(`ratelimit:tenant:${tenantId}`)

    // Use pipeline for efficiency
    const pipeline = this.redis.pipeline()

    // Get current counts
    pipeline.get(globalKey)
    pipeline.get(tenantKey)

    const results = await pipeline.exec()
    const globalCount = parseInt(String(results[0] || '0'), 10)
    const tenantCount = parseInt(String(results[1] || '0'), 10)

    // Calculate reset time
    const windowStart = Math.floor(Date.now() / 1000 / this.config.windowSeconds)
    const windowEnd = (windowStart + 1) * this.config.windowSeconds
    const resetIn = windowEnd - Math.floor(Date.now() / 1000)

    // Check global limit first
    if (globalCount >= this.config.globalLimit) {
      return {
        allowed: false,
        current: globalCount,
        limit: this.config.globalLimit,
        resetIn,
        limitType: 'global',
      }
    }

    // Check tenant limit
    if (tenantCount >= this.config.tenantLimit) {
      return {
        allowed: false,
        current: tenantCount,
        limit: this.config.tenantLimit,
        resetIn,
        limitType: 'tenant',
      }
    }

    return {
      allowed: true,
      current: Math.max(globalCount, tenantCount),
      limit: this.config.tenantLimit,
      resetIn,
    }
  }

  /**
   * Increment rate limit counters after processing starts
   */
  async increment(tenantId: string): Promise<void> {
    const globalKey = this.getWindowKey('ratelimit:global')
    const tenantKey = this.getWindowKey(`ratelimit:tenant:${tenantId}`)

    const pipeline = this.redis.pipeline()

    // Increment and set TTL for both keys
    pipeline.incr(globalKey)
    pipeline.expire(globalKey, this.config.windowSeconds + 1)
    pipeline.incr(tenantKey)
    pipeline.expire(tenantKey, this.config.windowSeconds + 1)

    await pipeline.exec()
  }

  /**
   * Get current usage stats (for monitoring)
   */
  async getStats(tenantId?: string): Promise<{
    globalUsage: number
    tenantUsage?: number
    globalLimit: number
    tenantLimit: number
  }> {
    const globalKey = this.getWindowKey('ratelimit:global')
    const pipeline = this.redis.pipeline()

    pipeline.get(globalKey)

    if (tenantId) {
      const tenantKey = this.getWindowKey(`ratelimit:tenant:${tenantId}`)
      pipeline.get(tenantKey)
    }

    const results = await pipeline.exec()
    const globalUsage = parseInt(String(results[0] || '0'), 10)
    const tenantUsage = tenantId ? parseInt(String(results[1] || '0'), 10) : undefined

    return {
      globalUsage,
      tenantUsage,
      globalLimit: this.config.globalLimit,
      tenantLimit: this.config.tenantLimit,
    }
  }
}

/**
 * Create a rate limiter instance from environment variables
 */
export function createRateLimiter(
  redisUrl: string | undefined,
  redisToken: string | undefined,
  config?: Partial<RateLimiterConfig>
): RateLimiter | null {
  if (!redisUrl || !redisToken) {
    console.warn('[RateLimiter] Missing Redis credentials, rate limiting disabled')
    return null
  }

  return new RateLimiter(redisUrl, redisToken, config)
}
