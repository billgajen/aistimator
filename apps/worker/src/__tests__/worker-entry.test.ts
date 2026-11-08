import { describe, it, expect, vi, beforeEach } from 'vitest'

// The pipeline itself is covered elsewhere; here it is a switch we flip.
const processQuote = vi.fn()
const updateQuoteStatus = vi.fn()
vi.mock('../quote-processor', () => ({ processQuote: (...a: unknown[]) => processQuote(...a) }))
vi.mock('../supabase', () => ({
  getSupabaseClient: () => ({}),
  updateQuoteStatus: (...a: unknown[]) => updateQuoteStatus(...a),
}))

import worker from '../index'
import type { Env, QuoteJobMessage } from '../index'
import { authorizeJobRequest, safeEqual } from '../auth'

const TOKEN = 'test-worker-token'
const job: QuoteJobMessage = { quoteId: 'qte_1', quoteRequestId: 'qr_1', tenantId: 'tnt_1', timestamp: 1 }

function req(path: string, opts: { token?: string; method?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  return new Request(`https://worker.test${path}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

function prodEnv(extra: Partial<Env> = {}): Env {
  return { ENVIRONMENT: 'production', CLOUDFLARE_WORKER_TOKEN: TOKEN, SUPABASE_URL: 'u', SUPABASE_SERVICE_KEY: 'k', ...extra }
}

beforeEach(() => {
  processQuote.mockReset()
  updateQuoteStatus.mockReset()
})

describe('worker auth', () => {
  it('compares tokens exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })

  it('fails closed outside development when the secret is missing', async () => {
    const res = authorizeJobRequest(req('/process', { token: 'anything' }), { ENVIRONMENT: 'production' })
    expect(res?.status).toBe(503)
  })

  it('lets local development run without a secret', () => {
    expect(authorizeJobRequest(req('/process'), { ENVIRONMENT: 'development' })).toBeNull()
  })

  it('requires the token on /process, /trigger and /stats; /health stays public', async () => {
    for (const path of ['/process', '/trigger']) {
      expect((await worker.fetch(req(path, { body: job }), prodEnv())).status).toBe(401)
      expect((await worker.fetch(req(path, { token: 'wrong', body: job }), prodEnv())).status).toBe(401)
    }
    expect((await worker.fetch(req('/stats', { method: 'GET' }), prodEnv())).status).toBe(401)
    expect((await worker.fetch(req('/health', { method: 'GET' }), prodEnv())).status).toBe(200)
    expect(processQuote).not.toHaveBeenCalled()
  })

  it('processes with the right token', async () => {
    processQuote.mockResolvedValue({ success: true, pricing: { total: 1 } })
    const res = await worker.fetch(req('/process', { token: TOKEN, body: job }), prodEnv())
    expect(res.status).toBe(200)
    expect(processQuote).toHaveBeenCalledOnce()
  })
})

describe('/trigger', () => {
  it('503s clearly when the queue is not bound', async () => {
    const res = await worker.fetch(req('/trigger', { token: TOKEN, body: job }), prodEnv())
    expect(res.status).toBe(503)
  })

  it('enqueues the job', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const res = await worker.fetch(req('/trigger', { token: TOKEN, body: job }), prodEnv({ QUOTE_JOBS: { send } as unknown as Queue }))
    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledWith(job)
  })

  it('reports a bad body and a failed send differently', async () => {
    const send = vi.fn().mockRejectedValue(new Error('queue down'))
    const env = prodEnv({ QUOTE_JOBS: { send } as unknown as Queue })
    expect((await worker.fetch(req('/trigger', { token: TOKEN, body: { quoteId: 'x' } }), env)).status).toBe(400)
    expect((await worker.fetch(req('/trigger', { token: TOKEN, body: job }), env)).status).toBe(502)
  })
})

describe('queue consumer retries', () => {
  function message(attempts: number) {
    return { body: job, attempts, ack: vi.fn(), retry: vi.fn() }
  }
  function batch(m: ReturnType<typeof message>) {
    return { messages: [m], retryAll: vi.fn() } as unknown as MessageBatch<QuoteJobMessage>
  }

  it('acks a success', async () => {
    processQuote.mockResolvedValue({ success: true })
    const m = message(1)
    await worker.queue(batch(m), prodEnv())
    expect(m.ack).toHaveBeenCalled()
    expect(m.retry).not.toHaveBeenCalled()
  })

  it('retries early failures with backoff, using Cloudflare attempts', async () => {
    processQuote.mockResolvedValue({ success: false, error: 'boom' })
    const m = message(2)
    await worker.queue(batch(m), prodEnv())
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
    expect(updateQuoteStatus).not.toHaveBeenCalledWith(expect.anything(), 'qte_1', 'failed', expect.anything())
  })

  it('marks the quote failed on the last attempt instead of dead-lettering it silently', async () => {
    processQuote.mockResolvedValue({ success: false, error: 'boom' })
    const m = message(4)
    await worker.queue(batch(m), prodEnv())
    expect(updateQuoteStatus).toHaveBeenCalledWith(expect.anything(), 'qte_1', 'failed', 'boom')
    expect(m.ack).toHaveBeenCalled()
  })

  it('stops retrying provider 429s once attempts are used up', async () => {
    processQuote.mockRejectedValue(new Error('Gemini API error: 429 quota'))
    const early = message(1)
    await worker.queue(batch(early), prodEnv())
    expect(early.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
    const last = message(4)
    await worker.queue(batch(last), prodEnv())
    expect(updateQuoteStatus).toHaveBeenCalledWith(expect.anything(), 'qte_1', 'failed', expect.stringContaining('429'))
    expect(last.ack).toHaveBeenCalled()
  })
})
