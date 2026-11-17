/**
 * The counting behind every public rate limit: which counters a request
 * touches and whether it may go ahead. Pure, with no Node or Redis imports,
 * so both the server routes (lib/rate-limit.ts) and the middleware
 * (lib/rate-limit-edge.ts, T-178) use the same keys and the same decision.
 */
import { RATE_LIMITS, type LimitWindow, type RateLimitScope } from './rate-limit-config'

export interface RateLimitResult {
  allowed: boolean
  /** Which counter refused it: the caller's address, or the business / quote / email address */
  limitType?: 'ip' | 'key'
  retryAfterSeconds: number
}

export function getScopeWindows(scope: RateLimitScope): readonly LimitWindow[] {
  return RATE_LIMITS[scope]
}

/** Attacker-supplied values go into keys: no whitespace, capped length */
function safe(value: string, max: number): string {
  return value.replace(/\s/g, '').slice(0, max) || 'unknown'
}

/** One counter the request touches */
export interface WindowCounter {
  key: string
  ttlSeconds: number
  limit: number
  type: 'ip' | 'key'
  /** Seconds until this counter's window ends */
  resetsInSeconds: number
}

/**
 * The counters for one request: for each window, the IP's and (when a key is
 * given) the key's. Keys are bucketed by the window's start, so a window ends
 * on the clock, not a fixed time after the first call.
 */
export function buildCounters(
  scope: RateLimitScope,
  identifiers: { ip?: string; key?: string },
  nowSeconds: number
): WindowCounter[] {
  const counters: WindowCounter[] = []
  for (const window of getScopeWindows(scope)) {
    const windowStart = Math.floor(nowSeconds / window.seconds)
    const resetsInSeconds = Math.max(1, (windowStart + 1) * window.seconds - nowSeconds)
    const base = { ttlSeconds: window.seconds + 1, resetsInSeconds }
    if (identifiers.ip !== undefined) {
      counters.push({ ...base, type: 'ip', limit: window.perIp, key: `rl:web:${scope}:${window.seconds}:ip:${safe(identifiers.ip, 64)}:${windowStart}` })
    }
    if (identifiers.key !== undefined) {
      counters.push({ ...base, type: 'key', limit: window.perKey, key: `rl:web:${scope}:${window.seconds}:key:${safe(identifiers.key, 128)}:${windowStart}` })
    }
  }
  return counters
}

/**
 * Pure decision: given each counter's value after this request was counted,
 * is the request allowed? When several counters are over, the caller is told
 * to wait for the longest of them.
 */
export function evaluateCounters(counters: WindowCounter[], counts: Array<number | null | undefined>): RateLimitResult {
  let blocked: WindowCounter | null = null
  counters.forEach((counter, i) => {
    const count = counts[i]
    if (typeof count === 'number' && count > counter.limit) {
      if (!blocked || counter.resetsInSeconds > blocked.resetsInSeconds) blocked = counter
    }
  })
  if (!blocked) return { allowed: true, retryAfterSeconds: 0 }
  const over: WindowCounter = blocked
  return { allowed: false, limitType: over.type, retryAfterSeconds: over.resetsInSeconds }
}
