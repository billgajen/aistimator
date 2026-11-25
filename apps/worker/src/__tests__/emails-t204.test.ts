/**
 * T-204, Part C: the worker's emails are in the same page as the web app's
 * (item 11), say where the quote stands beside the price (item 12), and
 * carry the product's logo on its light panel with the phone's padding
 * (item 15).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMAIL_PHONE_PADDING, EMAIL_WIDTH, emailShell, productLogoRow } from '@qolumns/shared'
import { businessNotificationEmail, customerQuoteEmail, reviewRequestEmail } from '../email/templates'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const BUSINESS = 'Harlow Heating & Air'

const customer = (awaitingConfirmation: boolean, scopeSummary?: string) =>
  customerQuoteEmail({
    customerName: 'Megan Grant',
    businessName: BUSINESS,
    serviceName: 'Service A',
    quoteViewUrl: 'https://qolumns.example/q/qte_1?token=t',
    total: '$2,327.38',
    currency: 'USD',
    awaitingConfirmation,
    scopeSummary,
  })
const toBusiness = businessNotificationEmail({
  businessName: BUSINESS,
  customerName: 'Megan Grant',
  customerEmail: 'megan@customer.test',
  serviceName: 'Service A',
  quoteId: 'qte_1',
  dashboardUrl: 'https://qolumns.example/app/quotes/qte_1',
  total: '$2,327.38',
  currency: 'USD',
})
const review = reviewRequestEmail({
  businessName: BUSINESS,
  customerName: 'Megan Grant',
  serviceName: 'Service A',
  quoteId: 'qte_1',
  total: '$2,327.38',
  dashboardUrl: 'https://qolumns.example/app/quotes/qte_1',
  holdLine: 'Your customer can already see this estimate. They can accept it once you approve.',
})

/** The page up to the card's own cell: everything that is not the email's own content */
const pageBefore = (html: string) => html.slice(html.indexOf('<body'), html.indexOf('>', html.indexOf('<td class="email-card"')) + 1)

describe('T-204 item 11: the worker’s emails are in the shared page', () => {
  for (const [name, html] of [['estimate shown early', customer(true)], ['quote sent automatically', customer(false)], ['new quote (business)', toBusiness], ['review and approve', review]] as const) {
    it(`"${name}": one card, ${EMAIL_WIDTH} px wide whatever is in it`, () => {
      expect(html.match(/data-role="email-card"/g)).toHaveLength(1)
      const card = /<table role="presentation" data-role="email-card"[^>]*>/.exec(html)![0]
      expect(card).toContain(`width="${EMAIL_WIDTH}"`)
      expect(card).toContain(`width: 100%; max-width: ${EMAIL_WIDTH}px;`)
    })
  }

  it('a short estimate email and one with a long scope are in the same page', () => {
    const long = customer(true, 'A long description of the work. '.repeat(40))
    expect(pageBefore(customer(true))).toBe(pageBefore(long))
  })

  it('it is the page the web app’s emails use: the same function, not a copy', () => {
    const templates = read('apps/worker/src/email/templates.ts')
    expect(templates).toContain("return emailShell({ title: 'Quote notification', content, above: productHeader, below: footer })")
    expect(templates).not.toMatch(/<!DOCTYPE|<body/)
    // the estimate email (worker) and a page made by the shared function agree around the card
    expect(pageBefore(customer(true))).toBe(pageBefore(emailShell({ title: 'x', content: '' })))
  })
})

describe('T-204 item 12: where the quote stands, beside the price', () => {
  it('an estimate shown before approval: "Waiting for <business> to confirm", in the price panel', () => {
    const html = customer(true)
    const panel = html.slice(html.indexOf('data-role="price-panel"'), html.indexOf('</div>', html.indexOf('data-role="quote-status"')))
    expect(panel).toContain('$2,327.38')
    expect(panel).toContain('data-state="waiting"')
    expect(panel).toContain('Waiting for Harlow Heating &amp; Air to confirm')
  })

  it('a quote the worker sent automatically was reviewed by no one, and does not say it was', () => {
    const html = customer(false)
    expect(html).toContain('data-state="estimate"')
    expect(html).toContain('Estimate based on your photos and details')
    expect(html).not.toMatch(/Reviewed and confirmed|Waiting for/)
  })

  it('an email to the business carries no customer status line', () => {
    expect(toBusiness).not.toContain('data-role="quote-status"')
    expect(review).not.toContain('data-role="quote-status"')
  })
})

describe('T-204 item 15: the logo on its light panel, and a phone’s padding', () => {
  it('emails to the business start with the logo row, once; a customer’s email has none', () => {
    for (const html of [toBusiness, review]) {
      expect(html.split(productLogoRow())).toHaveLength(2)
      expect(html).toContain('qolumns-wordmark-email-panel.png')
      expect(html).toContain('data-role="product-logo-panel"')
    }
    expect(customer(true)).not.toContain('data-role="product-logo"')
  })

  it('every one says it is light and carries the phone rule', () => {
    for (const html of [customer(true), customer(false), toBusiness, review]) {
      expect(html).toContain('<meta name="color-scheme" content="light only">')
      expect(html).toContain(`.email-outer { padding: ${EMAIL_PHONE_PADDING.outer} !important; }`)
      expect(html).toContain(`.email-card { padding: ${EMAIL_PHONE_PADDING.card} !important; }`)
    }
  })
})
