/**
 * T-179: a combined quote in an email. Every email that states a quote's
 * price shows, for a quote with added services, each service as a section
 * with its subtotal (and the tax line), next to the one total. For a
 * single-service quote it adds nothing, so those emails read as they did.
 */
import { displaySections, formatMoney } from '@qolumns/shared'
import type { QuotePricing } from '@qolumns/shared'

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)

/** The services on a combined quote, as rows of an email; '' for a single-service quote. Pure. */
export function sectionsEmailHtml(pricing: QuotePricing | null | undefined, mainServiceName: string, locale: string): string {
  const sections = displaySections(pricing, { serviceName: mainServiceName })
  if (!pricing || !sections) return ''
  const money = (n: number) => formatMoney(n, pricing.currency, locale)
  const rows = sections
    .map(
      (s) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${escape(s.serviceName)}</td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">${escape(money(s.subtotal))}</td></tr>`
    )
    .join('')
  const tax =
    pricing.taxAmount > 0
      ? `<tr><td style="padding:8px 0;font-size:14px;color:#6b7280;">${escape(pricing.taxLabel || 'Tax')}</td><td style="padding:8px 0;font-size:14px;color:#6b7280;text-align:right;white-space:nowrap;">${escape(money(pricing.taxAmount))}</td></tr>`
      : ''
  return `<table role="presentation" data-role="quote-sections" style="width:100%;border-collapse:collapse;margin:0 0 24px;">${rows}${tax}<tr><td style="padding:10px 0 0;font-size:15px;font-weight:700;color:#111827;">Total</td><td style="padding:10px 0 0;font-size:15px;font-weight:700;color:#111827;text-align:right;white-space:nowrap;">${escape(money(pricing.total))}</td></tr></table>`
}
