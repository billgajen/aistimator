import { describe, it, expect } from 'vitest'
import { isSyncProcessing } from '@/lib/queue'
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
