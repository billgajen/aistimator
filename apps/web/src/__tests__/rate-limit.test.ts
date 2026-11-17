import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildCounters,
  checkPublicRateLimit,
  checkRateLimit,
  emailKey,
  evaluateCounters,
  getClientIp,
  getScopeWindows,
  rateLimitedResponse,
  setRateLimitStoreForTesting,
  type RateLimitStore,
} from '@/lib/rate-limit'
import { RATE_LIMITS, RATE_LIMIT_TIMEOUT_MS, blockedMessage, type RateLimitScope } from '@/lib/rate-limit-config'

type Keys = Array<{ key: string; ttlSeconds: number }>

function fakeStore(counts: (keys: Keys) => number[]): RateLimitStore & { calls: Keys[] } {
  const calls: Keys[] = []
  return {
    calls,
    async incrementWithExpiry(keys: Keys) {
      calls.push(keys)
      return counts(keys)
    },
  }
}

/** A store that counts like Redis does */
function countingStore(): RateLimitStore {
  const seen = new Map<string, number>()
  return {
    async incrementWithExpiry(keys: Keys) {
      return keys.map(({ key }) => {
        const next = (seen.get(key) ?? 0) + 1
        seen.set(key, next)
        return next
      })
    },
  }
}

afterEach(() => {
  setRateLimitStoreForTesting(undefined)
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the limits (lib/rate-limit-config.ts)', () => {
  const scopes = Object.keys(RATE_LIMITS) as RateLimitScope[]

  it('covers every door the ticket names', () => {
    for (const scope of ['quotes', 'uploads', 'quote_actions', 'quote_actions_business', 'signup', 'login', 'password_reset'] as const) {
      expect(scopes).toContain(scope)
    }
  })

  it('gives every scope at least one window with positive whole numbers', () => {
    for (const scope of scopes) {
      const windows = getScopeWindows(scope)
      expect(windows.length).toBeGreaterThan(0)
      for (const w of windows) {
        for (const n of [w.seconds, w.perIp, w.perKey]) expect(Number.isInteger(n) && n > 0).toBe(true)
      }
    }
  })

  it('lists a scope’s windows shortest first, each allowing more than the one before', () => {
    for (const scope of scopes) {
      const windows = getScopeWindows(scope)
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]!.seconds).toBeGreaterThan(windows[i - 1]!.seconds)
        expect(windows[i]!.perIp).toBeGreaterThanOrEqual(windows[i - 1]!.perIp)
        expect(windows[i]!.perKey).toBeGreaterThanOrEqual(windows[i - 1]!.perKey)
      }
    }
  })

  it('caps what one business can be sent in a day, not only in a minute', () => {
    const windows = getScopeWindows('quotes')
    const day = windows.find((w) => w.seconds === 86400)
    expect(day).toBeDefined()
    // the per-minute figure alone would allow far more in a day than the daily ceiling
    expect(day!.perKey).toBeLessThan(windows[0]!.perKey * 60 * 24)
  })

  it('is not read from the environment: the file is the only place a limit lives', () => {
    vi.stubEnv('RATE_LIMIT_QUOTES_IP', '9999')
    expect(getScopeWindows('quotes')[0]!.perIp).toBe(RATE_LIMITS.quotes[0].perIp)
  })

  it('tells a blocked caller how long to wait, in plain words', () => {
    expect(blockedMessage(40)).toBe('Too many tries in a short time. Please wait a minute and try again.')
    expect(blockedMessage(1500)).toBe('Too many tries in a short time. Please try again in about 25 minutes.')
    expect(blockedMessage(60000)).toBe('Too many tries today. Please try again tomorrow.')
    for (const seconds of [1, 60, 600, 86400]) expect(blockedMessage(seconds)).not.toMatch(/limit|plan|upstash|redis|429/i)
  })
})

describe('buildCounters', () => {
  it('makes one counter per window for the IP and one for the key', () => {
    const counters = buildCounters('quotes', { ip: '1.2.3.4', key: 'tk_abc' }, 130)
    expect(counters).toHaveLength(RATE_LIMITS.quotes.length * 2)
    expect(counters[0]).toMatchObject({ key: 'rl:web:quotes:60:ip:1.2.3.4:2', type: 'ip', limit: RATE_LIMITS.quotes[0].perIp, ttlSeconds: 61, resetsInSeconds: 50 })
    expect(counters[1]).toMatchObject({ key: 'rl:web:quotes:60:key:tk_abc:2', type: 'key', limit: RATE_LIMITS.quotes[0].perKey })
    expect(counters[2]!.key).toBe('rl:web:quotes:3600:ip:1.2.3.4:0')
  })

  it('counts only what it is given', () => {
    expect(buildCounters('leads', { ip: '1.2.3.4' }, 0).every((c) => c.type === 'ip')).toBe(true)
    expect(buildCounters('quote_actions_business', { key: 'tnt_1' }, 0).every((c) => c.type === 'key')).toBe(true)
    expect(buildCounters('leads', {}, 0)).toHaveLength(0)
  })

  it('sanitizes attacker-supplied values', () => {
    const counters = buildCounters('chat', { ip: ' 1.2.3.4 ', key: 'x'.repeat(500) }, 0)
    expect(counters[0]!.key).toBe('rl:web:chat:60:ip:1.2.3.4:0')
    expect(counters[1]!.key.length).toBeLessThan(170)
  })

  it('falls back to unknown for empty identifiers', () => {
    const counters = buildCounters('uploads', { ip: '', key: '' }, 0)
    expect(counters[0]!.key).toContain(':ip:unknown:')
    expect(counters[1]!.key).toContain(':key:unknown:')
  })
})

describe('evaluateCounters', () => {
  const counters = buildCounters('quotes', { ip: '1.2.3.4', key: 'tk' }, 130)
  const under = counters.map(() => 1)

  it('allows a request under every limit', () => {
    expect(evaluateCounters(counters, under)).toEqual({ allowed: true, retryAfterSeconds: 0 })
  })

  it('blocks on the IP counter and says when the minute ends', () => {
    const counts = [...under]
    counts[0] = RATE_LIMITS.quotes[0].perIp + 1
    expect(evaluateCounters(counters, counts)).toEqual({ allowed: false, limitType: 'ip', retryAfterSeconds: 50 })
  })

  it('blocks on the business counter', () => {
    const counts = [...under]
    counts[1] = RATE_LIMITS.quotes[0].perKey + 1
    expect(evaluateCounters(counters, counts)).toMatchObject({ allowed: false, limitType: 'key' })
  })

  it('makes the caller wait for the longest window that is over', () => {
    const counts = [...under]
    counts[0] = 999 // the minute
    counts[2] = 999 // the hour
    expect(evaluateCounters(counters, counts).retryAfterSeconds).toBe(3600 - 130)
  })

  it('treats a missing count as allowed', () => {
    expect(evaluateCounters(counters, counters.map(() => null)).allowed).toBe(true)
    expect(evaluateCounters(counters, []).allowed).toBe(true)
  })
})

describe('checkRateLimit', () => {
  it('allows, and counts through the store once', async () => {
    const store = fakeStore((keys) => keys.map(() => 1))
    setRateLimitStoreForTesting(store)
    const result = await checkPublicRateLimit('quotes', { ip: '1.2.3.4', tenantKey: 'tk_a' })
    expect(result.allowed).toBe(true)
    expect(store.calls).toHaveLength(1)
    expect(store.calls[0]?.[0]?.key).toContain('rl:web:quotes:60:ip:1.2.3.4')
    expect(store.calls[0]?.[0]?.ttlSeconds).toBe(61)
  })

  it('blocks the call after the limit, and only that address', async () => {
    setRateLimitStoreForTesting(countingStore())
    const perIp = RATE_LIMITS.leads[0].perIp
    for (let i = 0; i < perIp; i++) expect((await checkRateLimit('leads', { ip: '9.9.9.9', key: 'tk_a' })).allowed).toBe(true)
    const blocked = await checkRateLimit('leads', { ip: '9.9.9.9', key: 'tk_a' })
    expect(blocked).toMatchObject({ allowed: false, limitType: 'ip' })
    expect((await checkRateLimit('leads', { ip: '8.8.8.8', key: 'tk_a' })).allowed).toBe(true)
  })

  it('blocks one business without touching another', async () => {
    setRateLimitStoreForTesting(countingStore())
    const perKey = RATE_LIMITS.quotes[0].perKey
    for (let i = 0; i < perKey; i++) await checkRateLimit('quotes', { ip: `10.0.0.${i}`, key: 'tk_attacked' })
    expect(await checkRateLimit('quotes', { ip: '10.0.1.1', key: 'tk_attacked' })).toMatchObject({ allowed: false, limitType: 'key' })
    expect((await checkRateLimit('quotes', { ip: '10.0.1.1', key: 'tk_other' })).allowed).toBe(true)
  })

  it('fails open, with a clear log line, when Upstash is not configured', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setRateLimitStoreForTesting(undefined)
    expect((await checkRateLimit('quotes', { ip: '1.2.3.4', key: 'tk_a' })).allowed).toBe(true)
    expect(warn.mock.calls.flat().join(' ')).toMatch(/PROTECTION OFF.*UPSTASH_REDIS_REST_URL/)
  })

  it('fails open and logs when the store throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setRateLimitStoreForTesting({
      async incrementWithExpiry() {
        throw new Error('redis down')
      },
    })
    expect((await checkRateLimit('quotes', { ip: '1.2.3.4', key: 'tk_a' })).allowed).toBe(true)
    expect(error.mock.calls.flat().join(' ')).toMatch(/FAILING OPEN.*quotes.*redis down/)
  })

  it('fails open when the store does not answer in time', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setRateLimitStoreForTesting({
      incrementWithExpiry: () => new Promise<number[]>(() => undefined),
    })
    const pending = checkRateLimit('quotes', { ip: '1.2.3.4', key: 'tk_a' })
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_TIMEOUT_MS + 10)
    expect((await pending).allowed).toBe(true)
    expect(error.mock.calls.flat().join(' ')).toMatch(/FAILING OPEN/)
  })

  it('never logs the address, the business or the email', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setRateLimitStoreForTesting(fakeStore((keys) => keys.map(() => 9999)))
    await checkRateLimit('login', { ip: '203.0.113.7', key: emailKey('megan@example.test') })
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('Blocked login request')
    expect(logged).not.toContain('203.0.113.7')
    expect(logged).not.toContain('megan')
  })
})

describe('emailKey', () => {
  it('is the same for the same address however it is typed, and holds no address', () => {
    expect(emailKey(' Megan@Example.test ')).toBe(emailKey('megan@example.test'))
    expect(emailKey('megan@example.test')).not.toContain('megan')
    expect(emailKey('megan@example.test')).not.toBe(emailKey('megan2@example.test'))
  })
})

describe('rateLimitedResponse', () => {
  it('answers 429 with the wait, in the header and the body', async () => {
    const res = rateLimitedResponse({ allowed: false, limitType: 'ip', retryAfterSeconds: 42 })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    const body = (await res.json()) as { error: { code: string; message: string; retryAfterSeconds: number } }
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error.retryAfterSeconds).toBe(42)
    expect(body.error.message).toBe(blockedMessage(42))
  })
})

describe('getClientIp', () => {
  it('takes the first x-forwarded-for entry', () => {
    expect(getClientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip, then unknown', () => {
    expect(getClientIp(new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } }))).toBe('9.9.9.9')
    expect(getClientIp(new Request('http://x'))).toBe('unknown')
  })
})
