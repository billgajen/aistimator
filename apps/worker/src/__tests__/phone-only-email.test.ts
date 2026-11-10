/**
 * T-151: a phone-only customer has no email address. The worker must not try
 * to email them, and must still tell the business.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendQuoteEmails } from '../email'

afterEach(() => vi.unstubAllGlobals())

const base = {
  quoteId: 'qte_1',
  quoteToken: 'tok',
  business: { name: 'Gateway Doors', ownerEmail: 'owner@example.com' },
  service: { name: 'Garage door' },
  pricing: { total: 1400, currency: 'USD' },
  locale: 'en-US',
}
const config = { postmarkApiToken: 't', fromEmail: 'from@example.com', appUrl: 'https://example.test' }

describe('T-151: phone-only customers', () => {
  it('sends only the business email when the customer gave no email', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ MessageID: 'm', ErrorCode: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await sendQuoteEmails(config, { ...base, customer: { name: 'Sam', email: '', phone: '07700 900123' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body).To).toBe('owner@example.com')
    expect(result.customerEmail.success).toBe(false)
  })

  it('still emails a customer who gave one', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ MessageID: 'm', ErrorCode: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendQuoteEmails(config, { ...base, customer: { name: 'Sam', email: 'sam@example.com' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
