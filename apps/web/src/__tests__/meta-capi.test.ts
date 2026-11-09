import { describe, it, expect, afterEach } from 'vitest'
import { buildCapiPayload, hashEmail, metaCookies, sendMetaEvent, sha256 } from '@/lib/meta-capi'
import { TRADES, getTrade } from '@/lib/marketing/trades'

describe('Meta Conversions API (T-144)', () => {
  afterEach(() => {
    delete process.env.META_PIXEL_ID
    delete process.env.META_CAPI_ACCESS_TOKEN
  })

  it('hashes the normalised email, never sends it raw', () => {
    expect(hashEmail('  Owner@Example.com ')).toBe(sha256('owner@example.com'))
    const body = buildCapiPayload({ eventName: 'CompleteRegistration', eventId: 'evt12345', email: 'Owner@Example.com', clientIp: '1.2.3.4', userAgent: 'UA' })
    expect(JSON.stringify(body)).not.toContain('Owner@Example.com')
    expect(body.data[0]).toMatchObject({ event_name: 'CompleteRegistration', event_id: 'evt12345', action_source: 'website', user_data: { em: [sha256('owner@example.com')], client_ip_address: '1.2.3.4', client_user_agent: 'UA' } })
  })

  it('adds value/currency for Subscribe and a test code when given', () => {
    const body = buildCapiPayload({ eventName: 'Subscribe', eventId: 'cs_1', value: 99, currency: 'usd' }, { testEventCode: 'TEST1' })
    expect(body.data[0]!.custom_data).toEqual({ value: 99, currency: 'USD' })
    expect(body.test_event_code).toBe('TEST1')
  })

  it('is a no-op without configuration', async () => {
    let called = false
    const r = await sendMetaEvent({ eventName: 'Lead', eventId: 'x1234567' }, (async () => { called = true; return new Response('{}') }) as typeof fetch)
    expect(r.sent).toBe(false)
    expect(called).toBe(false)
  })

  it('posts to the pixel endpoint when configured, and never throws', async () => {
    process.env.META_PIXEL_ID = '123'
    process.env.META_CAPI_ACCESS_TOKEN = 'tok'
    let url = ''
    const ok = await sendMetaEvent({ eventName: 'Lead', eventId: 'x1234567' }, (async (u: string) => { url = u; return new Response('{}', { status: 200 }) }) as unknown as typeof fetch)
    expect(ok.sent).toBe(true)
    expect(url).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/123\/events\?access_token=tok/)
    const down = await sendMetaEvent({ eventName: 'Lead', eventId: 'x1234567' }, (async () => { throw new Error('down') }) as typeof fetch)
    expect(down.sent).toBe(false)
  })

  it('reads _fbp/_fbc cookies', () => {
    expect(metaCookies('a=1; _fbp=fb.1.123.456; _fbc=fb.1.789.abc')).toEqual({ fbp: 'fb.1.123.456', fbc: 'fb.1.789.abc' })
    expect(metaCookies(null)).toEqual({ fbp: null, fbc: null })
  })
})

describe('trade landing content', () => {
  it('six launch trades, unique slugs, every section filled', () => {
    expect(TRADES.map((t) => t.slug)).toEqual(['hvac', 'water-heaters', 'plumbing', 'electrical', 'garage-doors', 'painting'])
    for (const t of TRADES) {
      expect(t.howPriced.length).toBe(3)
      expect(t.features.length).toBeGreaterThan(0)
      expect(t.metaDescription.length).toBeLessThanOrEqual(160)
      // US launch copy: dollars, no pounds
      expect(JSON.stringify(t)).not.toMatch(/£/)
    }
    expect(getTrade('nope')).toBeUndefined()
  })
})
