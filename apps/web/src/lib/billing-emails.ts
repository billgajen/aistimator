/**
 * T-180: the words of the two billing emails to a business (pure; the sending
 * is in lib/plan-limits.ts and lib/billing-sync.ts):
 *   - "2 free quotes left", once, when the free allowance is nearly used;
 *   - "Your payment didn't go through", once per failed payment.
 * Each says one thing and has one button. No card detail, no amount: the
 * amounts and the receipts come from Stripe, who is the seller of record.
 */
import { PAYMENT_FAILED_LINE, PRODUCT_NAME, freeQuotesLeftLine, productLogoRow } from '@qolumns/shared'

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

function page(input: { title: string; label: string; heading: string; paragraphs: string[]; buttonHref: string; buttonLabel: string; buttonRole: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escape(input.title)}</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:40px 20px;">
    ${productLogoRow()}
    <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;"><tr><td style="padding:40px;">
      <p style="margin:0;font-size:14px;color:#6b7280;">${escape(input.label)}</p>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#111827;" data-role="heading">${escape(input.heading)}</h1>
      ${input.paragraphs.map((p) => `<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#374151;">${p}</p>`).join('\n      ')}
      <table role="presentation" style="width:100%;margin:24px 0 4px;"><tr><td style="text-align:center;"><a href="${escape(input.buttonHref)}" data-role="${input.buttonRole}" style="display:inline-block;padding:14px 28px;background-color:#205E56;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">${escape(input.buttonLabel)}</a></td></tr></table>
    </td></tr></table>
    <table role="presentation" style="max-width:600px;margin:20px auto 0;"><tr><td style="text-align:center;color:#6b7280;font-size:12px;">${escape(PRODUCT_NAME)}</td></tr></table>
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
        `After your free quotes, a new request is still saved and the customer is told you will send their estimate. Nothing is lost. It is priced as soon as you pick a plan.`,
      ],
      buttonHref: input.billingUrl,
      buttonLabel: 'Pick a plan',
      buttonRole: 'pick-plan',
    }),
  }
}

/** A card payment failed and is being retried. */
export function paymentFailedEmail(input: { businessName: string; billingUrl: string }): { subject: string; html: string } {
  return {
    subject: "Your payment didn't go through",
    html: page({
      title: 'Payment problem',
      label: input.businessName,
      heading: "Your payment didn't go through.",
      paragraphs: [
        `<span data-role="line">${escape(PAYMENT_FAILED_LINE)}</span>`,
        `Everything keeps working for now, and the payment will be tried again over the next days. If it still cannot be taken, your plan ends: new requests are then saved for you but not priced until a plan is active again.`,
      ],
      buttonHref: input.billingUrl,
      buttonLabel: 'Update your card',
      buttonRole: 'update-card',
    }),
  }
}
