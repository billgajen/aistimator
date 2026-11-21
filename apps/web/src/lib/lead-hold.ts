/**
 * Over-limit lead capture (T-134, AD-026). With overage off, a request beyond
 * the plan's monthly limit is still saved — as an unpriced lead the business
 * can price after upgrading — and the customer is told the estimate is coming.
 * The AI pipeline does not run, so a held lead costs nothing to keep.
 */

import { sendEmail, isPostmarkConfigured } from './postmark'
import { generateLeadHeldEmailHtml } from './email-templates'
import { businessEmailFor } from './business-email'
import { notifyPhones } from './push'

/** Customer-facing message for a held lead (never mentions billing). */
export function leadHeldMessage(businessName: string): string {
  return `Thanks — ${businessName} has your request and will send your estimate shortly.`
}

/** content_json for a held lead; `limitHold` is the flag the dashboard and /process read. */
export function leadHoldContent(businessName: string): Record<string, unknown> {
  return {
    limitHold: true,
    title: 'Estimate on its way',
    intro: leadHeldMessage(businessName),
  }
}

/**
 * Tell the business about a held lead: its phones (T-196: a held lead is a new request like any
 * other) and an email. Never throws — capture must not depend on either.
 */
export async function notifyLeadHeld(
  opts: { tenantId: string; businessName: string; customerName: string; serviceName: string; quoteId: string; used: number; limit: number; per?: 'month' | 'total' }
): Promise<void> {
  await notifyPhones('new_request', opts.quoteId)
  try {
    if (!isPostmarkConfigured()) return
    // T-157: the one business email rule (setting, else the first user's account email)
    const to = await businessEmailFor(opts.tenantId)
    if (!to) return
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    await sendEmail({
      from: { kind: 'business' },
      to,
      subject: `New lead waiting: ${opts.customerName} — ${opts.per === 'total' ? 'pick a plan' : 'upgrade'} to price it instantly`,
      htmlBody: generateLeadHeldEmailHtml({
        businessName: opts.businessName,
        customerName: opts.customerName,
        serviceName: opts.serviceName,
        used: opts.used,
        limit: opts.limit,
        billingUrl: `${appUrl}/app/settings/billing`,
        quoteUrl: `${appUrl}/app/quotes/${opts.quoteId}`,
        per: opts.per,
      }),
      tag: 'lead-held',
    })
  } catch (error) {
    console.error('[LeadHold] Failed to notify business:', error)
  }
}
