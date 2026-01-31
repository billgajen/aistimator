/**
 * Quote PDF Template Generator
 *
 * Generates branded HTML for PDF conversion.
 * Uses inline styles for consistent rendering across PDF generators.
 */

import type {
  QuotePricing,
  QuoteContent,
  TenantBranding,
  TenantTemplate,
} from '@estimator/shared'

export interface QuotePdfData {
  quoteId: string
  businessName: string
  logoUrl?: string
  branding: TenantBranding
  template: TenantTemplate
  customer: {
    name: string
    email: string
    phone?: string
  }
  pricing: QuotePricing
  content: QuoteContent
  createdAt: string
  validUntil?: string
}

function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '£',
    USD: '$',
    EUR: '€',
    AUD: 'A$',
    CAD: 'C$',
    NZD: 'NZ$',
  }
  const symbol = symbols[currency] || currency + ' '
  return `${symbol}${amount.toFixed(2)}`
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Generate HTML for quote PDF
 */
export function generateQuotePdfHtml(data: QuotePdfData): string {
  const {
    quoteId,
    businessName,
    logoUrl,
    branding,
    template,
    customer,
    pricing,
    content,
    createdAt,
    validUntil,
  } = data

  const primaryColor = branding.primaryColor || '#2563eb'

  // Build sections based on template settings
  const sections: string[] = []

  // Scope summary
  if (content.scopeSummary) {
    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Scope of Work
        </h2>
        <p style="margin: 0; color: #374151; line-height: 1.6;">
          ${escapeHtml(content.scopeSummary)}
        </p>
      </div>
    `)
  }

  // Line items / pricing breakdown
  if (template.showLineItems && pricing.breakdown && pricing.breakdown.length > 0) {
    const lineItemsHtml = pricing.breakdown
      .map(
        (item) => `
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #374151;">
              ${escapeHtml(item.label)}
            </td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right; color: #111827; font-weight: 500;">
              ${formatCurrency(item.amount, pricing.currency)}
            </td>
          </tr>
        `
      )
      .join('')

    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Pricing Breakdown
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tbody>
            ${lineItemsHtml}
          </tbody>
        </table>
      </div>
    `)
  }

  // Pricing totals
  const totalsSection = `
    <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          <tr>
            <td style="padding: 8px 0; color: #6b7280;">Subtotal</td>
            <td style="padding: 8px 0; text-align: right; color: #111827;">${formatCurrency(pricing.subtotal, pricing.currency)}</td>
          </tr>
          ${
            pricing.taxAmount > 0
              ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">
                ${pricing.taxLabel || 'Tax'}${pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
              </td>
              <td style="padding: 8px 0; text-align: right; color: #111827;">${formatCurrency(pricing.taxAmount, pricing.currency)}</td>
            </tr>
          `
              : ''
          }
          <tr>
            <td style="padding: 12px 0; font-size: 18px; font-weight: 700; color: #111827; border-top: 2px solid #e5e7eb;">Total</td>
            <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: 700; color: ${primaryColor}; border-top: 2px solid #e5e7eb;">
              ${formatCurrency(pricing.total, pricing.currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `
  sections.push(totalsSection)

  // Assumptions
  if (template.includeAssumptions && content.assumptions && content.assumptions.length > 0) {
    const assumptionsList = content.assumptions
      .map((item) => `<li style="margin-bottom: 4px; color: #374151;">${escapeHtml(item)}</li>`)
      .join('')

    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Assumptions
        </h2>
        <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
          ${assumptionsList}
        </ul>
      </div>
    `)
  }

  // Exclusions
  if (template.includeExclusions && content.exclusions && content.exclusions.length > 0) {
    const exclusionsList = content.exclusions
      .map((item) => `<li style="margin-bottom: 4px; color: #374151;">${escapeHtml(item)}</li>`)
      .join('')

    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Exclusions
        </h2>
        <ul style="margin: 0; padding-left: 20px; line-height: 1.6;">
          ${exclusionsList}
        </ul>
      </div>
    `)
  }

  // Additional notes
  if (content.notes) {
    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Notes
        </h2>
        <p style="margin: 0; color: #374151; line-height: 1.6;">
          ${escapeHtml(content.notes)}
        </p>
      </div>
    `)
  }

  // Footer notes from branding
  const footerHtml = branding.footerNotes
    ? `
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; font-size: 12px; color: #6b7280; line-height: 1.5;">
          ${escapeHtml(branding.footerNotes)}
        </p>
      </div>
    `
    : ''

  // Logo section
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${escapeHtml(businessName)}" style="max-height: 60px; max-width: 200px;" />`
    : `<h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${primaryColor};">${escapeHtml(businessName)}</h1>`

  // Full HTML document
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quote ${quoteId} - ${escapeHtml(businessName)}</title>
  <style>
    @page {
      size: A4;
      margin: 20mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #111827;
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <div style="max-width: 100%; margin: 0 auto;">
    <!-- Header -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid ${primaryColor}; padding-bottom: 20px;">
      <div>
        ${logoHtml}
      </div>
      <div style="text-align: right;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b7280;">Quote Reference</p>
        <p style="margin: 0; font-weight: 600; color: #111827;">${escapeHtml(quoteId)}</p>
        <p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7280;">Date: ${formatDate(createdAt)}</p>
        ${validUntil ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">Valid until: ${formatDate(validUntil)}</p>` : ''}
      </div>
    </div>

    <!-- Customer Details -->
    <div style="margin-bottom: 32px;">
      <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
        Prepared For
      </h2>
      <p style="margin: 0; font-weight: 600; color: #111827;">${escapeHtml(customer.name)}</p>
      <p style="margin: 4px 0 0 0; color: #6b7280;">${escapeHtml(customer.email)}</p>
      ${customer.phone ? `<p style="margin: 4px 0 0 0; color: #6b7280;">${escapeHtml(customer.phone)}</p>` : ''}
    </div>

    <!-- Quote Content -->
    ${sections.join('')}

    <!-- Footer -->
    ${footerHtml}
  </div>
</body>
</html>
  `.trim()
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char)
}
