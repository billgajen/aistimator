import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isSyncProcessing, repriceQuoteNow } from '@/lib/queue'
import { isQuoteProcessing } from '@estimator/shared'

describe('quote processing mode', () => {
  it('follows SYNC_QUOTE_PROCESSING when set', () => {
    expect(isSyncProcessing({ SYNC_QUOTE_PROCESSING: 'true', NODE_ENV: 'production' })).toBe(true)
    expect(isSyncProcessing({ SYNC_QUOTE_PROCESSING: 'false', NODE_ENV: 'development' })).toBe(false)
    expect(isSyncProcessing({ SYNC_QUOTE_PROCESSING: ' FALSE ', NODE_ENV: 'production' })).toBe(false)
  })

  it('defaults to sync in local dev and async in production', () => {
    expect(isSyncProcessing({ NODE_ENV: 'development' })).toBe(true)
    expect(isSyncProcessing({ NODE_ENV: 'production' })).toBe(false)
  })
})

describe('isQuoteProcessing', () => {
  it('is true only before the worker has produced a document', () => {
    expect(isQuoteProcessing('queued')).toBe(true)
    expect(isQuoteProcessing('generating')).toBe(true)
    for (const s of ['sent', 'viewed', 'pending_review', 'awaiting_clarification', 'failed', null, undefined]) {
      expect(isQuoteProcessing(s)).toBe(false)
    }
  })
})

describe('repriceQuoteNow', () => {
  const job = { quoteId: 'qte_1', quoteRequestId: 'qr_1', tenantId: 'tnt_1', timestamp: 1, quoteToken: 'tok' }
  const env = { ...process.env }

  beforeEach(() => {
    process.env.CLOUDFLARE_WORKER_URL = 'https://worker.test'
    process.env.CLOUDFLARE_WORKER_TOKEN = 'secret'
  })
  afterEach(() => {
    process.env = { ...env }
    vi.unstubAllGlobals()
  })

  it('posts to /reprice with the bearer token and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await repriceQuoteNow(job)).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://worker.test/reprice')
    expect(init.headers.Authorization).toBe('Bearer secret')
  })

  it('falls back (false) on 409 no-snapshot, errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409 })))
    expect(await repriceQuoteNow(job)).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await repriceQuoteNow(job)).toBe(false)
  })
})
