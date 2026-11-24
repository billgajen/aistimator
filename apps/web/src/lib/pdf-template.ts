/**
 * Quote PDF Template Generator
 *
 * Generates branded HTML for PDF conversion.
 * Uses inline styles for consistent rendering across PDF generators.
 */

import { formatMoney, lineLabelNow, splitMinimum, minimumChargeNote, displaySections, roomsCoveredWords } from '@qolumns/shared'
// a relative path: verify-t179 loads this file outside Next, where "@/" does not resolve
import { TERMS_HEADING, termsParagraphs } from './quote-terms'
import type {
  CustomerRoomScanView,
  QuotePricing,
  QuoteContent,
  TenantBranding,
  TenantTemplate,
} from '@qolumns/shared'

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
  /** T-133: BCP 47 locale from the tenant's region (money + dates) */
  locale?: string
  /** T-179: the quote's own service (the first section's heading on a combined quote) */
  serviceName?: string
  /** T-193: what the room scan measured: each room's floor and wall area and its floor plan (no 3D model in a PDF) */
  roomScan?: CustomerRoomScanView
  /** T-201: the business's "Default Terms & Conditions" (lib/quote-terms.ts), printed after the price and the notes; null or absent prints nothing */
  terms?: string | null
}

function formatCurrency(amount: number, currency: string, locale: string): string {
  return formatMoney(amount, currency, locale)
}

function formatDate(dateString: string, locale: string): string {
  return new Date(dateString).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Generate HTML for quote PDF
 */
export function generateQuotePdfHtml(data: QuotePdfData): string {
  const locale = data.locale || 'en-GB'
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
          Scope of work
        </h2>
        <p style="margin: 0; color: #374151; line-height: 1.6;">
          ${escapeHtml(content.scopeSummary)}
        </p>
      </div>
    `)
  }

  // Line items / pricing breakdown
  // T-165: the minimum charge is a floor, not an item: the job's real lines,
  // then one note when the minimum applied (shared/minimum-charge.ts)
  const { lines: priceLines, minimum: minimumApplied } = splitMinimum(pricing.breakdown)
  // T-179: a combined quote shows each service as a section with its subtotal.
  // (Shown whatever the "line items" setting: the sections are how the total is made up.)
  const combined = displaySections(pricing, { serviceName: data.serviceName || 'Service' })
  if (combined) {
    const row = (label: string, amount: string, strong = false) => `
          <tr>
            <td style="padding: ${strong ? '12px 0 4px' : '10px 0'}; border-bottom: ${strong ? 'none' : '1px solid #e5e7eb'}; color: ${strong ? '#111827' : '#374151'}; ${strong ? 'font-weight: 600;' : ''}">${label}</td>
            <td style="padding: ${strong ? '12px 0 4px' : '10px 0'}; border-bottom: ${strong ? 'none' : '1px solid #e5e7eb'}; text-align: right; color: #111827; font-weight: ${strong ? '600' : '500'};">${amount}</td>
          </tr>`
    const blocks = combined
      .map(
        (section) => `
        <div style="margin-bottom: 20px;" data-role="quote-section">
          <h3 style="font-size: 14px; font-weight: 600; color: #111827; margin: 0 0 6px 0;">${escapeHtml(section.serviceName)}</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${template.showLineItems ? section.lines.map((item) => row(escapeHtml(lineLabelNow(item.label)), formatCurrency(item.amount, pricing.currency, locale))).join('') : ''}
              ${row(`${escapeHtml(section.serviceName)} subtotal`, formatCurrency(section.subtotal, pricing.currency, locale), true)}
            </tbody>
          </table>
          ${section.minimum ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #374151;">${escapeHtml(minimumChargeNote(formatCurrency(section.minimum.minimumCharge, pricing.currency, locale)))}</p>` : ''}
        </div>`
      )
      .join('')
    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Pricing breakdown
        </h2>
        ${blocks}
      </div>
    `)
  } else if (template.showLineItems && (priceLines.length > 0 || minimumApplied)) {
    const lineItemsHtml = priceLines
      .map(
        (item) => `
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; color: #374151;">
              ${escapeHtml(lineLabelNow(item.label))}
            </td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb; text-align: right; color: #111827; font-weight: 500;">
              ${formatCurrency(item.amount, pricing.currency, locale)}
            </td>
          </tr>
        `
      )
      .join('')

    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Pricing breakdown
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tbody>
            ${lineItemsHtml}
          </tbody>
        </table>
        ${minimumApplied ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #374151;">${escapeHtml(minimumChargeNote(formatCurrency(minimumApplied.minimumCharge, pricing.currency, locale)))}</p>` : ''}
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
            <td style="padding: 8px 0; text-align: right; color: #111827;">${formatCurrency(pricing.subtotal, pricing.currency, locale)}</td>
          </tr>
          ${
            pricing.taxAmount > 0
              ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280;">
                ${pricing.taxLabel || 'Tax'}${pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}
              </td>
              <td style="padding: 8px 0; text-align: right; color: #111827;">${formatCurrency(pricing.taxAmount, pricing.currency, locale)}</td>
            </tr>
          `
              : ''
          }
          <tr>
            <td style="padding: 12px 0; font-size: 18px; font-weight: 700; color: #111827; border-top: 2px solid #e5e7eb;">Total</td>
            <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: 700; color: ${primaryColor}; border-top: 2px solid #e5e7eb;">
              ${formatCurrency(pricing.total, pricing.currency, locale)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `
  sections.push(totalsSection)

  // T-193: measured on site. The plan is our own SVG (only numbers and the escaped room name: floorPlanSvg).
  if (data.roomScan && data.roomScan.rooms.length > 0) {
    const rooms = data.roomScan.rooms
      .map(
        (room) => `
        <div style="margin-bottom: 14px; page-break-inside: avoid;">
          <h3 style="font-size: 14px; font-weight: 600; color: #111827; margin: 0 0 4px 0;">${escapeHtml(room.name)}${room.roomsCovered > 1 ? ` <span style="font-weight: 400; color: #374151;">· ${escapeHtml(roomsCoveredWords(room.roomsCovered) ?? '')}</span>` : ''}</h3>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #374151;">${room.figures.map((f) => `${escapeHtml(f.label)} ${escapeHtml(f.value)}`).join(' · ')}</p>
          ${room.planSvg ? `<div style="max-width: 360px;">${room.planSvg.replace('<svg ', '<svg style="width: 100%; height: auto;" ')}</div>` : ''}
        </div>`
      )
      .join('')
    sections.push(`
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          Measured on site
        </h2>
        ${data.roomScan.priced.length > 0 ? `<p style="margin: 0 0 10px 0; font-size: 13px; color: #374151;">Priced from these sizes: ${data.roomScan.priced.map(escapeHtml).join('; ')}</p>` : ''}
        ${rooms}
      </div>
    `)
  }

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

  // T-201: the business's own terms, after the price and the notes. Its words, with its line breaks.
  if (data.terms) {
    const paragraphs = termsParagraphs(data.terms)
      .map((lines) => `<p style="margin: 0 0 8px 0; font-size: 12px; color: #374151; line-height: 1.6;">${lines.map(escapeHtml).join('<br />')}</p>`)
      .join('')
    sections.push(`
      <div data-role="terms" style="margin-bottom: 24px;">
        <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
          ${TERMS_HEADING}
        </h2>
        ${paragraphs}
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
  // T-183: a logo never stands in for the name. With a logo, the name is beside it; with none, the name alone.
  const nameHtml = `<h1 data-role="business-name" style="margin: 0; font-size: 24px; font-weight: 700; color: ${primaryColor};">${escapeHtml(businessName)}</h1>`
  const logoHtml = logoUrl
    ? `<table role="presentation" data-role="business-identity" style="border-collapse: collapse;"><tr>
        <td style="padding: 0 14px 0 0; vertical-align: middle;"><img src="${logoUrl}" alt="" style="max-height: 60px; max-width: 160px;" /></td>
        <td style="padding: 0; vertical-align: middle;">${nameHtml}</td>
      </tr></table>`
    : nameHtml

  // Identity lines under the logo/name: tagline + contact details
  const taglineHtml = branding.tagline
    ? `<p style="margin: 6px 0 0 0; font-size: 12px; color: #4b5563;">${escapeHtml(branding.tagline)}</p>`
    : ''
  const contactParts = [branding.phone, branding.email, branding.website].filter(
    (part): part is string => Boolean(part)
  )
  const contactHtml = contactParts.length
    ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: #6b7280;">${contactParts
        .map(escapeHtml)
        .join(' &middot; ')}</p>`
    : ''

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
        ${taglineHtml}
        ${contactHtml}
      </div>
      <div style="text-align: right;">
        <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b7280;">Quote reference</p>
        <p style="margin: 0; font-weight: 600; color: #111827;">${escapeHtml(quoteId)}</p>
        <p style="margin: 8px 0 0 0; font-size: 12px; color: #6b7280;">Date: ${formatDate(createdAt, locale)}</p>
        ${validUntil ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">Valid until: ${formatDate(validUntil, locale)}</p>` : ''}
      </div>
    </div>

    <!-- Customer Details -->
    <div style="margin-bottom: 32px;">
      <h2 style="font-size: 14px; font-weight: 600; color: ${primaryColor}; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">
        Prepared for
      </h2>
      <p style="margin: 0; font-weight: 600; color: #111827;">${escapeHtml(customer.name)}</p>
      ${customer.email ? `<p style="margin: 4px 0 0 0; color: #6b7280;">${escapeHtml(customer.email)}</p>` : ''}
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
