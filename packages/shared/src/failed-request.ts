/**
 * T-178: a request that could not be priced, or is slow, is never silent.
 *
 * One place for what the customer reads while they wait and when pricing
 * fails, and for the one email the business gets about a failed request. The
 * web app and the worker both use it, so the two never drift.
 */
import { PRODUCT_NAME } from './brand'
import { productLogoRow } from './product-logo'

/** After this long on "Preparing your estimate" the customer is told it is slow */
export const SLOW_PREPARING_MS = 60_000

/** The one line shown when pricing is slow. Email is promised only to a customer who gave one. */
export function slowPreparingLine(hasEmail: boolean): string {
  return hasEmail
    ? 'This is taking longer than usual. We’ll email you as soon as it’s ready.'
    : 'This is taking longer than usual. Keep this page open, or come back to it: your estimate will appear here.'
}

/** What the customer reads when the estimate could not be made */
export function failedRequestTitle(businessName: string): string {
  return `${businessName} has your request`
}

export function failedRequestLine(businessName: string): string {
  return `${businessName} has your details and will be in touch about your estimate. There is nothing more you need to do.`
}

export interface FailedRequestEmailInput {
  customerName: string
  customerEmail?: string | null
  customerPhone?: string | null
  serviceName: string
  /** The request in the business's dashboard */
  quoteUrl: string
  isTest?: boolean
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** The email to the business: who asked, for what, and where the request is. Never the reason it failed. */
export function failedRequestEmail(input: FailedRequestEmailInput): { subject: string; html: string } {
  const name = input.customerName.trim() || 'A customer'
  const contact = [input.customerEmail, input.customerPhone].filter((v): v is string => Boolean(v && v.trim()))
  const subject = `${input.isTest ? '[TEST] ' : ''}${name} asked for an estimate: please reply to them yourself`
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>A request needs you</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:40px 20px;">
    ${productLogoRow()}
    <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;"><tr><td style="padding:40px;">
      <p style="margin:0;font-size:14px;color:#6b7280;">A request needs you</p>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#111827;">${escape(name)}</h1>
      <p style="margin:4px 0 0;font-size:15px;color:#374151;">${escape(input.serviceName)}</p>
      <p style="margin:20px 0 0;font-size:15px;color:#111827;" data-role="what-happened">
        ${PRODUCT_NAME} could not work out a price for this request, so no estimate was sent. The customer has been told you have their request and will be in touch.
      </p>
      <p style="margin:12px 0 0;font-size:15px;color:#111827;">Their details, answers and photos are saved.</p>
      <table role="presentation" style="width:100%;margin:24px 0;"><tr><td style="text-align:center;">
        <a href="${escape(input.quoteUrl)}" data-role="open-request" style="display:inline-block;padding:14px 28px;background-color:#205E56;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">Open the request</a>
      </td></tr></table>
      ${
        contact.length
          ? `<div style="padding:16px;background-color:#f9fafb;border-radius:8px;"><p style="margin:0;font-weight:600;color:#374151;font-size:14px;">How to reach them</p>${contact
              .map((line) => `<p style="margin:6px 0 0;color:#374151;font-size:14px;">${escape(line.trim())}</p>`)
              .join('')}</div>`
          : ''
      }
    </td></tr></table>
  </td></tr></table>
</body>
</html>`
  return { subject, html }
}
