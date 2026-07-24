import { describe, it, expect, afterEach, vi } from 'vitest'
import { isTurnstileEnabled, verifyTurnstileToken } from '@/lib/turnstile'

function mockSiteverify(response: { status?: number; body?: unknown; reject?: boolean }) {
  const fn = vi.fn(async () => {
    if (response.reject) throw new Error('network down')
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('isTurnstileEnabled', () => {
  it('is false without a secret and true with one', () => {
    expect(isTurnstileEnabled()).toBe(false)
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    expect(isTurnstileEnabled()).toBe(true)
  })
})

describe('verifyTurnstileToken', () => {
  it('passes everything through when no secret is configured', async () => {
    const fetchMock = mockSiteverify({})
    const result = await verifyTurnstileToken(undefined, '1.2.3.4')
    expect(result.ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a missing token when the secret is configured', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    const fetchMock = mockSiteverify({})
    const result = await verifyTurnstileToken(undefined, '1.2.3.4')
    expect(result).toEqual({ ok: false, reason: 'missing-token' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a token Cloudflare verifies', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    mockSiteverify({ body: { success: true } })
    const result = await verifyTurnstileToken('tok', '1.2.3.4')
    expect(result.ok).toBe(true)
  })

  it('rejects a token Cloudflare rejects', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    mockSiteverify({ body: { success: false, 'error-codes': ['invalid-input-response'] } })
    const result = await verifyTurnstileToken('tok', '1.2.3.4')
    expect(result).toEqual({ ok: false, reason: 'rejected' })
  })

  it('fails open on siteverify HTTP errors', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    mockSiteverify({ status: 503 })
    const result = await verifyTurnstileToken('tok', '1.2.3.4')
    expect(result.ok).toBe(true)
  })

  it('fails open when siteverify is unreachable', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    mockSiteverify({ reject: true })
    const result = await verifyTurnstileToken('tok', '1.2.3.4')
    expect(result.ok).toBe(true)
  })

  it('omits unknown IPs from the verification request', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk')
    const fetchMock = mockSiteverify({ body: { success: true } })
    await verifyTurnstileToken('tok', 'unknown')
    const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1]
    expect(init.body).toContain('response=tok')
    expect(init.body).not.toContain('remoteip')
  })
})
