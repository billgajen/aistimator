/**
 * T-211: where strikes, blocks and call counts are kept: the Upstash Redis the rate limits use.
 * Server only. Null when Upstash is not configured (or the rate limits' one switch is off): the
 * guard then lets every call through and counts nothing.
 */
import { Redis } from '@upstash/redis'
import { rateLimitingConfigured } from '@/lib/rate-limit'
import type { GuardStore } from './guard'

let cached: GuardStore | null | undefined

export function guardStore(): GuardStore | null {
  if (cached !== undefined) return cached
  if (!rateLimitingConfigured()) {
    cached = null
    return cached
  }
  // No retries: a guard that waits on a failing store would hold up the call it is meant to let through
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN!, retry: { retries: 0 } })
  cached = {
    async get(key) {
      const value = await redis.get<unknown>(key)
      return value === null || value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value)
    },
    async set(key, value, ttlSeconds) {
      await redis.set(key, value, { ex: ttlSeconds })
    },
    async increment(key, ttlSeconds) {
      const pipeline = redis.pipeline()
      pipeline.incr(key)
      pipeline.expire(key, ttlSeconds)
      const [count] = await pipeline.exec()
      return Number(count)
    },
    async remove(keys) {
      if (keys.length > 0) await redis.del(...keys)
    },
  }
  return cached
}
