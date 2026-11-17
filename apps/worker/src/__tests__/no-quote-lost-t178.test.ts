/**
 * T-178: no quote is ever lost.
 *   - the queue's rate limiter fails open (an error or a slow answer never stops a quote);
 *   - over the limit still requeues;
 *   - a quote that fails for good is marked failed and the business is emailed once.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { failedRequestEmail, serviceSuggestionOf, suggestedServiceReason, slowPreparingLine, SLOW_PREPARING_MS } from '@qolumns/shared'
import { askLimiter, handleQuoteJob } from '../queue-consumer'
import type { LimiterLike, JobMessage } from '../queue-consumer'
import { LIMITER_TIMEOUT_MS } from '../rate-limiter'
import { markQuoteFailed } from '../failed-quote'

type Job = { quoteId: string; tenantId: string }
const job: Job = { quoteId: 'qte_fixture_1', tenantId: 'tnt_fixture_1' }

function message(attempts = 1) {
  const m = { body: job, attempts, timestamp: new Date(), ack: vi.fn(), retry: vi.fn() }
  return m as typeof m & JobMessage<Job>
}

function deps(limiter: LimiterLike | null, result: { success: boolean; error?: string } | Error = { success: true }) {
  return {
    limiter,
    process: vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    }),
    markFailed: vi.fn(async () => undefined),
    maxRetries: 3,
    backoffSeconds: (n: number) => 30 * 2 ** n,
  }
}

const allowed = { allowed: true, current: 1, limit: 10, resetIn: 30 }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the queue limiter fails open', () => {
  it('limiter throws → the job is processed', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const limiter: LimiterLike = {
      checkLimit: vi.fn(async () => {
        throw new Error("The 'cache' field on 'RequestInitializerDict' is not implemented. token=secret-value")
      }),
      increment: vi.fn(async () => undefined),
    }
    const m = message()
    const d = deps(limiter)
    expect(await handleQuoteJob(m, d)).toBe('done')
    expect(d.process).toHaveBeenCalledTimes(1)
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(m.retry).not.toHaveBeenCalled()
    expect(d.markFailed).not.toHaveBeenCalled()
    // the error's name only: its message can carry a key or an address
    const logged = quiet.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('FAILING OPEN (Error)')
    expect(logged).not.toContain('secret-value')
    expect(logged).not.toContain('RequestInitializerDict')
  })

  it('the counter cannot be written → the job is still processed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const limiter: LimiterLike = {
      checkLimit: vi.fn(async () => allowed),
      increment: vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    }
    const m = message()
    const d = deps(limiter)
    expect(await handleQuoteJob(m, d)).toBe('done')
    expect(d.process).toHaveBeenCalledTimes(1)
  })

  it('limiter never answers → the job is processed after 2 seconds, not later', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const limiter: LimiterLike = { checkLimit: vi.fn(() => new Promise<never>(() => undefined)), increment: vi.fn(async () => undefined) }
    const m = message()
    const d = deps(limiter)
    const run = handleQuoteJob(m, d)
    await vi.advanceTimersByTimeAsync(LIMITER_TIMEOUT_MS - 1)
    expect(d.process).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await run).toBe('done')
    expect(d.process).toHaveBeenCalledTimes(1)
    expect(m.ack).toHaveBeenCalledTimes(1)
    expect(LIMITER_TIMEOUT_MS).toBe(2000)
  })

  it('an answer that arrives after the time limit, even "over the limit", changes nothing', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let late: (r: typeof allowed) => void = () => undefined
    const limiter: LimiterLike = { checkLimit: vi.fn(() => new Promise<typeof allowed>((resolve) => (late = resolve))), increment: vi.fn(async () => undefined) }
    const decision = askLimiter(limiter, job.tenantId)
    await vi.advanceTimersByTimeAsync(LIMITER_TIMEOUT_MS)
    expect(await decision).toEqual({ proceed: true, failedOpen: true })
    late({ ...allowed, allowed: false })
    await vi.advanceTimersByTimeAsync(10)
  })

  it('over the limit → requeued, not processed, not failed', async () => {
    const limiter: LimiterLike = {
      checkLimit: vi.fn(async () => ({ allowed: false, current: 10, limit: 10, resetIn: 20, limitType: 'tenant' as const })),
      increment: vi.fn(async () => undefined),
    }
    const m = message()
    const d = deps(limiter)
    expect(await handleQuoteJob(m, d)).toBe('requeued_over_limit')
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 25 })
    expect(d.process).not.toHaveBeenCalled()
    expect(limiter.increment).not.toHaveBeenCalled()
    expect(d.markFailed).not.toHaveBeenCalled()
    expect(m.ack).not.toHaveBeenCalled()
  })

  it('no limiter configured → processed', async () => {
    const m = message()
    const d = deps(null)
    expect(await handleQuoteJob(m, d)).toBe('done')
  })

  it('the client is Upstash’s Cloudflare build, one attempt, with a time limit', () => {
    const source = readFileSync(fileURLToPath(new URL('../rate-limiter.ts', import.meta.url)), 'utf8')
    expect(source).toContain("from '@upstash/redis/cloudflare'")
    expect(source).not.toMatch(/from '@upstash\/redis'/)
    expect(source).toContain('retry: { retries: 0 }')
    expect(source).toContain('AbortSignal.timeout(LIMITER_TIMEOUT_MS)')
  })
})

describe('a job that fails', () => {
  it('is retried with a growing wait, then marked failed once the retries are used', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = message(1)
    const d1 = deps(null, { success: false, error: 'pipeline error' })
    expect(await handleQuoteJob(first, d1)).toBe('retry')
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 })
    expect(d1.markFailed).not.toHaveBeenCalled()

    const last = message(4)
    const d2 = deps(null, new Error('pipeline threw'))
    expect(await handleQuoteJob(last, d2)).toBe('failed')
    expect(d2.markFailed).toHaveBeenCalledWith(job, 'pipeline threw')
    expect(last.ack).toHaveBeenCalledTimes(1)
    expect(last.retry).not.toHaveBeenCalled()
  })

  it('an AI provider’s own rate limit waits a minute before the next try', async () => {
    const m = message(1)
    expect(await handleQuoteJob(m, deps(null, new Error('429 Too Many Requests')))).toBe('retry')
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
  })
})

/** A stand-in for the two tables markQuoteFailed touches */
function fakeDb(row: Record<string, unknown> | null, opts: { updateFails?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: table === 'quotes' ? row : null }),
          order: () => ({ limit: () => ({ single: async () => ({ data: null }) }) }),
        }),
      }),
      update: (values: Record<string, unknown>) => {
        updates.push(values)
        return { eq: async () => ({ error: opts.updateFails ? { message: 'down' } : null }) }
      },
    }),
    auth: { admin: { getUserById: async () => ({ data: null }) } },
  }
  return { db: db as never, updates }
}

const failedRow = (content: Record<string, unknown> = {}) => ({
  tenant_id: 'tnt_fixture_1',
  customer_json: { name: 'Megan Grant', email: 'megan@customer.test', phone: '+1 415 555 0142' },
  content_json: content,
  is_test: false,
  is_demo: false,
  tenant: { name: 'Fixture Business', notification_email: 'owner@business.test', is_demo: false },
  service: { name: 'Service Alpha' },
})
const mailEnv = { POSTMARK_API_TOKEN: 'pm-token', POSTMARK_FROM_EMAIL: 'quotes@sender.test', APP_URL: 'https://app.test' }

describe('a failed quote is never silent', () => {
  it('marks the quote failed, keeps the reason, and emails the business once', async () => {
    const { db, updates } = fakeDb(failedRow())
    const send = vi.fn(async () => ({ success: true }))
    const result = await markQuoteFailed(db, mailEnv, 'qte_fixture_1', 'the model timed out', send)
    expect(result).toEqual({ marked: true, emailed: true })
    expect(send).toHaveBeenCalledTimes(1)
    const [, mail] = send.mock.calls[0] as unknown as [unknown, { to: string; subject: string; htmlBody: string; tag: string }]
    expect(mail.to).toBe('owner@business.test')
    expect(mail.subject).toContain('Megan Grant')
    expect(mail.htmlBody).toContain('https://app.test/app/quotes/qte_fixture_1')
    expect(mail.htmlBody).toContain('Service Alpha')
    expect(mail.htmlBody).toContain('megan@customer.test')
    // why it failed is ours to read, not the business's
    expect(mail.htmlBody).not.toContain('the model timed out')
    expect(updates[0]!.status).toBe('failed')
    const content = updates[0]!.content_json as Record<string, unknown>
    expect(content.error).toBe('the model timed out')
    expect(typeof content.failedNotifiedAt).toBe('string')
  })

  it('a second failure of the same quote sends no second email', async () => {
    const { db, updates } = fakeDb(failedRow({ failedNotifiedAt: '2026-11-17T10:00:00.000Z' }))
    const send = vi.fn(async () => ({ success: true }))
    expect(await markQuoteFailed(db, mailEnv, 'qte_fixture_1', 'again', send)).toEqual({ marked: true, emailed: false })
    expect(send).not.toHaveBeenCalled()
    expect((updates[0]!.content_json as Record<string, unknown>).failedNotifiedAt).toBe('2026-11-17T10:00:00.000Z')
  })

  it('the demo business is not emailed; the quote is still marked', async () => {
    const { db, updates } = fakeDb({ ...failedRow(), is_demo: true })
    const send = vi.fn(async () => ({ success: true }))
    expect(await markQuoteFailed(db, mailEnv, 'qte_fixture_1', 'x', send)).toEqual({ marked: true, emailed: false })
    expect(send).not.toHaveBeenCalled()
    expect(updates[0]!.status).toBe('failed')
  })

  it('email not configured, or sending throws → still marked failed, and it never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const none = fakeDb(failedRow())
    expect(await markQuoteFailed(none.db, {}, 'qte_fixture_1', 'x')).toEqual({ marked: true, emailed: false })
    const throws = fakeDb(failedRow())
    const send = vi.fn(async () => {
      throw new Error('postmark down')
    })
    expect(await markQuoteFailed(throws.db, mailEnv, 'qte_fixture_1', 'x', send)).toEqual({ marked: true, emailed: false })
    expect((throws.updates[0]!.content_json as Record<string, unknown>).failedNotifiedAt).toBeUndefined()
    // the database itself is broken
    expect(await markQuoteFailed({} as never, mailEnv, 'qte_fixture_1', 'x', send)).toEqual({ marked: false, emailed: false })
  })

  it('the email names the customer and how to reach them, and marks a test', () => {
    const mail = failedRequestEmail({ customerName: 'Megan <Grant>', customerPhone: '+1 415 555 0142', serviceName: 'Service Alpha', quoteUrl: 'https://app.test/app/quotes/q1', isTest: true })
    expect(mail.subject.startsWith('[TEST] ')).toBe(true)
    expect(mail.html).toContain('Megan &lt;Grant&gt;')
    expect(mail.html).toContain('+1 415 555 0142')
    expect(mail.html).toContain('data-role="open-request"')
  })

  it('the slow line appears after 60 seconds and promises email only to a customer who gave one', () => {
    expect(SLOW_PREPARING_MS).toBe(60_000)
    expect(slowPreparingLine(true)).toBe('This is taking longer than usual. We’ll email you as soon as it’s ready.')
    expect(slowPreparingLine(false)).not.toContain('email')
  })
})

describe('a suggested service travels with the request', () => {
  it('is read off the request, and malformed ones are ignored', () => {
    expect(serviceSuggestionOf({ type: 'widget', serviceSuggestion: { serviceId: 'svc_b', serviceName: 'Service Beta', reason: 'They describe beta work.' } })).toEqual({
      serviceId: 'svc_b',
      serviceName: 'Service Beta',
      reason: 'They describe beta work.',
    })
    expect(serviceSuggestionOf({ type: 'widget' })).toBeNull()
    expect(serviceSuggestionOf(null)).toBeNull()
    expect(serviceSuggestionOf({ serviceSuggestion: { serviceId: 'svc_b' } })).toBeNull()
    expect(serviceSuggestionOf({ serviceSuggestion: 'svc_b' })).toBeNull()
  })

  it('the business is told both services and why', () => {
    const line = suggestedServiceReason({ serviceId: 'svc_b', serviceName: 'Service Beta', reason: 'They describe beta work.' }, 'Service Alpha')
    expect(line).toBe('The customer chose "Service Alpha", but what they wrote reads more like "Service Beta". They describe beta work. Check which they need before you send a price.')
  })
})
