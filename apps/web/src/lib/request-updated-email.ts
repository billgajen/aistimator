/**
 * T-179: the words of the "request updated" email (pure; the sending is in
 * lib/request-updated.ts). It is about the SAME quote, never a second one:
 * each service as a section with its subtotal, then the one total.
 */
import { displaySections, formatMoney } from '@qolumns/shared'
import type { CombinedPricing } from '@qolumns/shared'

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

export interface RequestUpdatedInput {
  customerName: string
  mainServiceName: string
  /** The service the customer added or removed */
  changedServiceName: string
  change: 'added' | 'removed'
  pricing: CombinedPricing
  locale: string
  /** The quote now waits for the business's approval */
  awaitingApproval: boolean
  dashboardUrl: string
  approveUrl?: string
  isTest?: boolean
}

/** Subject and body. Pure. */
export function requestUpdatedEmail(input: RequestUpdatedInput): { subject: string; html: string } {
  const name = input.customerName.trim() || 'A customer'
  const money = (n: number) => formatMoney(n, input.pricing.currency, input.locale)
  const what = input.change === 'added' ? `added ${input.changedServiceName} to` : `took ${input.changedServiceName} off`
  const subject = `${input.isTest ? '[TEST] ' : ''}Request updated: ${name} ${what} their quote (${money(input.pricing.total)})`
  const sections = displaySections(input.pricing, { serviceName: input.mainServiceName })
  const rows = (sections ?? [{ serviceName: input.mainServiceName, subtotal: input.pricing.subtotal, main: true }])
    .map(
      (s) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${escape(s.serviceName)}${'addedBy' in s && s.addedBy === 'customer' ? ' <span style="color:#6b7280;">(added by the customer)</span>' : ''}</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;" data-role="section-subtotal">${escape(money(s.subtotal))}</td></tr>`
    )
    .join('')
  const tax =
    input.pricing.taxAmount > 0
      ? `<tr><td style="padding:8px 0;font-size:14px;color:#6b7280;">${escape(input.pricing.taxLabel || 'Tax')}</td><td style="padding:8px 0;font-size:14px;color:#6b7280;text-align:right;">${escape(money(input.pricing.taxAmount))}</td></tr>`
      : ''
  const button = (href: string, label: string, role: string) =>
    `<table role="presentation" style="width:100%;margin:20px 0 4px;"><tr><td style="text-align:center;"><a href="${escape(href)}" data-role="${role}" style="display:inline-block;padding:14px 28px;background-color:#205E56;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px;">${label}</a></td></tr></table>`
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Request updated</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:40px 20px;">
    <table role="presentation" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;"><tr><td style="padding:40px;">
      <p style="margin:0;font-size:14px;color:#6b7280;">Request updated</p>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:#111827;">${escape(name)}</h1>
      <p style="margin:12px 0 0;font-size:15px;color:#111827;" data-role="what-changed">
        ${escape(name)} ${escape(what)} the quote you already have for them. It is still one quote, with one total.
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0 0;">
        ${rows}
        ${tax}
        <tr><td style="padding:12px 0 0;font-size:16px;font-weight:700;color:#111827;">Total</td><td style="padding:12px 0 0;font-size:16px;font-weight:700;color:#111827;text-align:right;" data-role="total">${escape(money(input.pricing.total))}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:14px;color:#374151;" data-role="next">
        ${input.awaitingApproval ? 'The customer can accept it once you approve.' : 'Nothing is needed from you: your services send their quotes automatically.'}
      </p>
      ${input.awaitingApproval && input.approveUrl ? button(input.approveUrl, 'Approve &amp; send', 'approve') : ''}
      ${input.awaitingApproval && input.approveUrl ? `<p style="margin:12px 0 0;text-align:center;font-size:14px;"><a href="${escape(input.dashboardUrl)}" data-role="dashboard" style="color:#205E56;text-decoration:underline;">Open in dashboard to edit</a></p>` : button(input.dashboardUrl, input.awaitingApproval ? 'Review and approve' : 'Open the quote', 'dashboard')}
    </td></tr></table>
  </td></tr></table>
</body>
</html>`
  return { subject, html }
}
