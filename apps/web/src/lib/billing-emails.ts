/**
 * T-180: the words of the two billing emails to a business (pure; the sending
 * is in lib/plan-limits.ts and lib/billing-sync.ts):
 *   - "2 free quotes left", once, when the free allowance is nearly used;
 *   - "Your payment didn't go through", once per failed payment.
 * Each says one thing and has one button. No card detail, no amount: the
 * amounts and the receipts come from Stripe, who is the seller of record.
 */
import { EMAIL_FONT, PAYMENT_FAILED_LINE, PRODUCT_NAME, emailHeadStyle, freeQuotesLeftLine, productLogoRow } from '@qolumns/shared'

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

function page(input: { title: string; label: string; heading: string; paragraphs: string[]; buttonHref: string; buttonLabel: string; buttonRole: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(input.title)}</title>${emailHeadStyle()}
</head>
<body style="margin:0;padding:0;font-family:${EMAIL_FONT.body};background-color:#FAF9F6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:40px 20px;">
    ${productLogoRow()}
    <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#FFFFFF;border-radius:8px;"><tr><td style="padding:40px;">
      <p style="margin:0;font-size:14px;color:#626C66;">${escape(input.label)}</p>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#1B2823;" data-role="heading">${escape(input.heading)}</h1>
      ${input.paragraphs.map((p) => `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#4F5D57;">${p}</p>`).join('\n      ')}
      <table role="presentation" style="width:100%;margin:24px 0 4px;"><tr><td style="text-align:center;"><a href="${escape(input.buttonHref)}" data-role="${input.buttonRole}" style="display:inline-block;padding:14px 28px;background-color:#205E56;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">${escape(input.buttonLabel)}</a></td></tr></table>
    </td></tr></table>
    <table role="presentation" style="max-width:600px;margin:20px auto 0;"><tr><td style="text-align:center;color:#626C66;font-size:12px;">${escape(PRODUCT_NAME)}</td></tr></table>
  </td></tr></table>
</body>
</html>`
}

/** The free allowance is nearly used. Null when there is nothing to warn about. */
export function freeQuotesLeftEmail(input: { businessName: string; used: number; limit: number; billingUrl: string }): { subject: string; html: string } | null {
  const line = freeQuotesLeftLine(input.used, input.limit)
  if (!line) return null
  const left = input.limit - input.used
  return {
    subject: `${left} free ${left === 1 ? 'quote' : 'quotes'} left`,
    html: page({
      title: 'Free quotes left',
      label: input.businessName,
      heading: line.split('. ')[0] + '.',
      paragraphs: [
        `You have used <strong>${input.used} of your ${input.limit}</strong> free quotes. Pick a plan to keep pricing every request.`,
        `After your free quotes, a new request is still saved and the customer is told you will send their estimate. Nothing is lost. When you pick a plan, the requests saved in the last 30 days are priced for you, as far as the plan's monthly number goes.`,
      ],
      buttonHref: input.billingUrl,
      buttonLabel: 'Pick a plan',
      buttonRole: 'pick-plan',
    }),
  }
}

/**
 * T-202: what happens to new requests if the payment is never taken and the
 * plan ends, for this business. Until T-202 the email said "new requests are
 * then saved for you but not priced", which is wrong for a business that still
 * has free quotes: since T-201 a quote priced on a plan is not one of the free
 * ones, so they are still there when the plan ends.
 *   - free quotes left: the next ones are still priced, then requests are saved
 *   - none left: requests are saved, not priced, until a plan is active
 *   - the old monthly allowance (a business from before the US launch)
 *   - `null` (the numbers could not be read): the rule, with no number
 * Plain text; the caller escapes nothing in it because it holds only numbers.
 */
export function afterPlanEndsLine(after: { per: 'month' | 'total'; limit: number; left: number } | null | undefined): string {
  const saved = 'saved for you but not priced until a plan is active again'
  if (!after) return `If it still cannot be taken, your plan ends. New requests are then priced only while you have free quotes left; after that they are ${saved}.`
  if (after.per === 'month') {
    return `If it still cannot be taken, your plan ends. Without a plan, up to ${after.limit} new requests a month are still priced; past that, they are ${saved}.`
  }
  if (after.left > 0) {
    const next = after.left === 1 ? 'the next new request is still priced' : `the next ${after.left} new requests are still priced`
    const those = after.left === 1 ? 'After that one' : 'After those'
    return `If it still cannot be taken, your plan ends. You still have ${after.left} of your ${after.limit} free quotes, so ${next}. ${those}, new requests are ${saved}.`
  }
  return `If it still cannot be taken, your plan ends. Your ${after.limit} free quotes are used, so new requests are then ${saved}.`
}

/** A card payment failed and is being retried. `afterPlan`: this business's allowance once it has no plan (T-202). */
export function paymentFailedEmail(input: { businessName: string; billingUrl: string; afterPlan?: { per: 'month' | 'total'; limit: number; left: number } | null }): { subject: string; html: string } {
  return {
    subject: "Your payment didn't go through",
    html: page({
      title: 'Payment problem',
      label: input.businessName,
      heading: "Your payment didn't go through.",
      paragraphs: [
        `<span data-role="line">${escape(PAYMENT_FAILED_LINE)}</span>`,
        `Everything keeps working for now, and the payment will be tried again over the next days. New requests are still priced meanwhile.`,
        `<span data-role="after-plan">${escape(afterPlanEndsLine(input.afterPlan))}</span>`,
      ],
      buttonHref: input.billingUrl,
      buttonLabel: 'Update your card',
      buttonRole: 'update-card',
    }),
  }
}
