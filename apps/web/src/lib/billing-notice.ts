/**
 * T-180: the account notice shown on every dashboard page. Pure.
 *
 *   payment_failed   a card payment failed and Stripe is retrying. The plan
 *                    still works (the same grace as the quote limit and the
 *                    WhatsApp assistant: `subscriptionLive`). The action opens
 *                    the Stripe portal, where the card is changed.
 *   suspended        a platform admin paused the account. New requests are
 *                    saved, not priced. The admin's reason is never shown.
 *
 * Suspended wins: it is the one that stops quotes.
 */
import { PAYMENT_FAILED_LINE, SUPPORT_EMAIL } from '@qolumns/shared'

export type BillingNotice =
  | { kind: 'payment_failed'; line: string; action: 'portal'; actionLabel: string }
  | { kind: 'suspended'; line: string; action: 'email'; actionLabel: string; email: string }

export const SUSPENDED_LINE = 'Your account is paused. New requests are being saved, not priced. Quotes you have already sent still open.'

export function billingNotice(input: { status: string | null; hasStripeCustomer: boolean; suspended: boolean }): BillingNotice | null {
  if (input.suspended) return { kind: 'suspended', line: SUSPENDED_LINE, action: 'email', actionLabel: 'Email us', email: SUPPORT_EMAIL }
  if (input.status === 'past_due' && input.hasStripeCustomer) {
    return { kind: 'payment_failed', line: PAYMENT_FAILED_LINE, action: 'portal', actionLabel: 'Update your card' }
  }
  return null
}
