/**
 * T-190: the worker's emails to the business start with the product's logo; its emails to a customer do not.
 */
import { describe, it, expect } from 'vitest'
import { failedRequestEmail, productLogoRow, productLogoUrl } from '@qolumns/shared'
import { businessNotificationEmail, customerQuoteEmail, reviewRequestEmail } from '../email/templates'

const common = { customerName: 'Megan Grant', businessName: 'Business A', serviceName: 'Service A' }

describe('T-190: the logo in the worker’s emails', () => {
  it('the new-request email, the review email and the failed-request email have it, once, above the card', () => {
    for (const html of [
      businessNotificationEmail({ ...common, customerEmail: 'megan@example.com', quoteId: 'qte_1', dashboardUrl: 'u', total: '$1.00', currency: 'USD' }),
      businessNotificationEmail({ ...common, customerEmail: '', quoteId: 'qte_1', dashboardUrl: 'u', total: '$1.00', currency: 'USD', awaitingReview: true }),
      reviewRequestEmail({ ...common, quoteId: 'qte_1', total: '$1.00', approveUrl: 'a', dashboardUrl: 'u', holdLine: 'Held until you approve.' }),
      failedRequestEmail({ customerName: 'Megan Grant', serviceName: 'Service A', quoteUrl: 'u' }).html,
    ]) {
      expect(html.split(productLogoRow())).toHaveLength(2)
      expect(html.indexOf(productLogoRow())).toBeLessThan(html.indexOf('#ffffff'))
    }
  })

  it('emails to a customer have no logo of ours', () => {
    const customer = customerQuoteEmail({ ...common, quoteViewUrl: 'q', total: '$1.00', currency: 'USD' })
    expect(customer).not.toContain('data-role="product-logo"')
    expect(customer).not.toContain(productLogoUrl())
  })
})
