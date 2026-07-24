import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildWindowKeys,
  checkPublicRateLimit,
  evaluateCounts,
  getClientIp,
  getScopeLimits,
  setRateLimitStoreForTesting,
  type RateLimitStore,
  type ScopeLimits,
} from '@/lib/rate-limit'

const LIMITS: ScopeLimits = { ipLimit: 5, tenantLimit: 30, windowSeconds: 60 }

function fakeStore(counts: number[]): RateLimitStore & { keys: string[][] } {
  const calls: string[][] = []
  return {
    keys: calls,
    async incrementWithExpiry(keys: string[]) {
      calls.push(keys)
      return counts
    },
  }
}

afterEach(() => {
  setRateLimitStoreForTesting(undefined)
  vi.unstubAllEnvs()
})

describe('evaluateCounts', () => {
  it('allows requests under both limits', () => {
    const result = evaluateCounts([5, 30], LIMITS, 120)
    expect(result.allowed).toBe(true)
    expect(result.limitType).toBeUndefined()
  })

  it('blocks when the IP count exceeds the IP limit', () => {
    const result = evaluateCounts([6, 10], LIMITS, 120)
    expect(result.allowed).toBe(false)
    expect(result.limitType).toBe('ip')
  })

  it('blocks when the tenant count exceeds the tenant limit', () => {
    const result = evaluateCounts([1, 31], LIMITS, 120)
    expect(result.allowed).toBe(false)
    expect(result.limitType).toBe('tenant')
  })

  it('computes retry-after as seconds until the window resets', () => {
    // now=130s, window=60s → window [120, 180) → 50s remaining
    const result = evaluateCounts([6, 1], LIMITS, 130)
    expect(result.retryAfterSeconds).toBe(50)
  })

  it('treats null counts (missing pipeline results) as allowed', () => {
    const result = evaluateCounts([null, null], LIMITS, 120)
    expect(result.allowed).toBe(true)
  })
})

describe('buildWindowKeys', () => {
  it('buckets keys by window start and scopes them', () => {
    const keys = buildWindowKeys('quotes', '1.2.3.4', 'tk_abc', 60, 130)
    expect(keys).toEqual(['rl:web:quotes:ip:1.2.3.4:2', 'rl:web:quotes:tenant:tk_abc:2'])
  })

  it('sanitizes attacker-supplied values', () => {
    const keys = buildWindowKeys('chat', ' 1.2.3.4 ', 'x'.repeat(500), 60, 0)
    expect(keys[0]).toBe('rl:web:chat:ip:1.2.3.4:0')
    expect((keys[1] ?? '').length).toBeLessThan(200)
  })

  it('falls back to unknown for empty identifiers', () => {
    const keys = buildWindowKeys('uploads', '', '', 60, 0)
    expect(keys[0]).toContain(':ip:unknown:')
    expect(keys[1]).toContain(':tenant:unknown:')
  })
})

describe('getScopeLimits', () => {
  it('returns per-scope defaults', () => {
    expect(getScopeLimits('quotes').ipLimit).toBe(5)
    expect(getScopeLimits('uploads').ipLimit).toBe(20)
    expect(getScopeLimits('chat').ipLimit).toBe(15)
  })

  it('honours env overrides and ignores invalid values', () => {
    vi.stubEnv('RATE_LIMIT_QUOTES_IP', '2')
    vi.stubEnv('RATE_LIMIT_QUOTES_TENANT', 'not-a-number')
    const limits = getScopeLimits('quotes')
    expect(limits.ipLimit).toBe(2)
    expect(limits.tenantLimit).toBe(30)
  })
})

describe('checkPublicRateLimit', () => {
  it('allows and increments via the store', async () => {
    const store = fakeStore([1, 1])
    setRateLimitStoreForTesting(store)
    const result = await checkPublicRateLimit('quotes', { ip: '1.2.3.4', tenantKey: 'tk_a' })
    expect(result.allowed).toBe(true)
    expect(store.keys).toHaveLength(1)
    expect(store.keys[0]?.[0]).toContain('rl:web:quotes:ip:1.2.3.4')
  })

  it('blocks when the store reports counts over the limit', async () => {
    setRateLimitStoreForTesting(fakeStore([6, 1]))
    const result = await checkPublicRateLimit('quotes', { ip: '1.2.3.4', tenantKey: 'tk_a' })
    expect(result.allowed).toBe(false)
    expect(result.limitType).toBe('ip')
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('fails open when the store is unavailable', async () => {
    setRateLimitStoreForTesting(null)
    const result = await checkPublicRateLimit('quotes', { ip: '1.2.3.4', tenantKey: 'tk_a' })
    expect(result.allowed).toBe(true)
  })

  it('fails open when the store throws', async () => {
    setRateLimitStoreForTesting({
      async incrementWithExpiry() {
        throw new Error('redis down')
      },
    })
    const result = await checkPublicRateLimit('quotes', { ip: '1.2.3.4', tenantKey: 'tk_a' })
    expect(result.allowed).toBe(true)
  })
})

describe('getClientIp', () => {
  it('takes the first x-forwarded-for entry', () => {
    const req = new Request('http://x', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip, then unknown', () => {
    expect(getClientIp(new Request('http://x', { headers: { 'x-real-ip': '5.6.7.8' } }))).toBe(
      '5.6.7.8'
    )
    expect(getClientIp(new Request('http://x'))).toBe('unknown')
  })
})
