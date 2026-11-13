/**
 * T-159: the worker's emails show a sender name.
 *
 * Customer emails go out as "<business name> via <PRODUCT_NAME>", business
 * emails as PRODUCT_NAME, always from the configured address. The header is
 * built by the shared helper, so a business name is display text only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_NAME } from '@estimator/shared'
import { sendEstimateShownEmail, sendQuoteEmails, sendReviewRequestEmail } from '../email'
import { sendEmail } from '../email/postmark'

const ADDRESS = 'quotes@mail.example.com'
const config = { postmarkApiToken: 't', fromEmail: ADDRESS, appUrl: 'https://example.test' }

type Sent = { From: string; To: string; ReplyTo?: string; Tag?: string }

function captureSends(): Sent[] {
  const sent: Sent[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Sent)
      return new Response(JSON.stringify({ MessageID: 'm' }), { status: 200 })
    })
  )
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => undefined)
  return sent
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('T-159: sender names on the worker’s emails', () => {
  it('the quote email to the customer and the "new quote" email to the business', async () => {
    const sent = captureSends()
    await sendQuoteEmails(config, {
      quoteId: 'qte_from',
      quoteToken: 'tok',
      customer: { name: 'Riley Stone', email: 'riley.stone@example.com' },
      business: { name: 'Stone Decorating', ownerEmail: 'office@example.com' },
      service: { name: 'Exterior painting' },
      pricing: { total: 622.8, currency: 'GBP' },
    })
    const toCustomer = sent.find((m) => m.Tag === 'quote-customer')!
    const toBusiness = sent.find((m) => m.Tag === 'quote-business')!
    expect(toCustomer.From).toBe(`"Stone Decorating via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(toCustomer.To).toBe('riley.stone@example.com')
    // T-157: replies still reach the business
    expect(toCustomer.ReplyTo).toBe('office@example.com')
    expect(toBusiness.From).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(toBusiness.To).toBe('office@example.com')
  })

  it('the estimate email to the customer', async () => {
    const sent = captureSends()
    await sendEstimateShownEmail(config, {
      quoteId: 'qte_from',
      quoteToken: 'tok',
      customerName: 'Riley Stone',
      customerEmail: 'riley.stone@example.com',
      businessName: 'Stone Decorating',
      replyTo: 'office@example.com',
      serviceName: 'Exterior painting',
      total: 622.8,
      currency: 'GBP',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.From).toBe(`"Stone Decorating via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(sent[0]!.ReplyTo).toBe('office@example.com')
  })

  it('the "review and approve" email to the business', async () => {
    const sent = captureSends()
    await sendReviewRequestEmail(config, {
      quoteId: 'qte_from',
      ownerEmail: 'office@example.com',
      businessName: 'Stone Decorating',
      customerName: 'Riley Stone',
      customerEmail: 'riley.stone@example.com',
      serviceName: 'Exterior painting',
      total: 622.8,
      currency: 'GBP',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.From).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(sent[0]!.To).toBe('office@example.com')
  })

  it('a business name with quotes, brackets and line breaks stays display text', async () => {
    const sent = captureSends()
    await sendQuoteEmails(config, {
      quoteId: 'qte_from',
      quoteToken: 'tok',
      customer: { name: 'Riley Stone', email: 'riley.stone@example.com' },
      business: { name: 'Stone "Deco" <billing@elsewhere.example>\r\nBcc: x@y.example', ownerEmail: 'office@example.com' },
      service: { name: 'Exterior painting' },
      pricing: { total: 622.8, currency: 'GBP' },
    })
    const from = sent.find((m) => m.Tag === 'quote-customer')!.From
    expect(from).toBe(`"Stone \\"Deco\\" billing@elsewhere.example Bcc: x@y.example via ${PRODUCT_NAME}" <${ADDRESS}>`)
    expect(from.endsWith(` <${ADDRESS}>`)).toBe(true)
    expect(from.match(/[<>]/g)).toHaveLength(2)
    expect(from).not.toMatch(/[\r\n]/)
    expect(sent.find((m) => m.Tag === 'quote-customer')!.To).toBe('riley.stone@example.com')
  })

  it('a missing business name falls back to the product name', async () => {
    const sent = captureSends()
    await sendEmail(
      { apiToken: 't', fromEmail: ADDRESS },
      { from: { kind: 'customer', businessName: '' }, to: 'riley.stone@example.com', subject: 's', htmlBody: '<p>h</p>' }
    )
    expect(sent[0]!.From).toBe(`"${PRODUCT_NAME}" <${ADDRESS}>`)
  })
})
