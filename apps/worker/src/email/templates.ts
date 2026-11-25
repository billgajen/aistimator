/**
 * Email Templates
 *
 * HTML email templates for quote notifications.
 * Uses inline styles for maximum email client compatibility.
 */
import { APPROVAL_COPY, EMAIL_COLOR, brandColourForEmail, businessLogoBlock, customerPricePanel, emailShell, poweredByRow, productLogoRow, textColourOnCardForEmail, textOnColourForEmail } from '@qolumns/shared'
import type { ApprovalDetail, CustomerEmailBrand, CustomerQuoteState } from '@qolumns/shared'

export interface CustomerEmailData {
  customerName: string
  businessName: string
  serviceName: string
  quoteViewUrl: string
  total: string
  currency: string
  validUntil?: string
  scopeSummary?: string
  primaryColor?: string
  /** T-147: an estimate shown before the business approved it; the business will confirm */
  awaitingConfirmation?: boolean
  /**
   * T-204: where the quote stands, said beside the price. Left out, it follows `awaitingConfirmation`:
   * waiting for the business, or (a quote the worker sent automatically) an estimate nobody reviewed.
   * The worker never sends a reviewed quote: approving is the web app's.
   */
  state?: CustomerQuoteState
  /** T-201: the business's logo and whether "Powered by" shows (customer-email-brand.ts) */
  brand?: CustomerEmailBrand
}

export interface BusinessEmailData {
  businessName: string
  customerName: string
  /** T-151: empty when the customer gave a phone number only */
  customerEmail: string
  customerPhone?: string
  serviceName: string
  jobAddress?: string
  quoteId: string
  dashboardUrl: string
  total: string
  currency: string
  primaryColor?: string
  /** T-146: the quote is waiting for the business to approve it */
  awaitingReview?: boolean
  /** T-146: why it was held, when a check (not the default review) held it */
  reviewReason?: string
}

/**
 * Base email wrapper with consistent styling
 */
function emailWrapper(content: string, _primaryColor?: string, options: { fromProduct?: boolean; toBusiness?: boolean; brand?: CustomerEmailBrand } = {}): string {
  // T-183 marked this row; T-190 fills it: every email the product sends to the business has the product's logo
  // at the top (productLogoRow, @qolumns/shared). Emails to a customer carry the business's brand, not ours.
  const productHeader = options.fromProduct || options.toBusiness ? productLogoRow() : ''
  // T-185: no email to the business carries "Powered by" (it is from the product); the line is for the
  // business's emails to its customers. T-201: there it follows the plan, by the estimate page's own
  // rule (`brand.showPoweredBy`, customer-email-brand.ts; the HTML is @qolumns/shared's).
  const footer = options.fromProduct || options.toBusiness ? '' : poweredByRow(options.brand?.showPoweredBy)
  // T-204: the page itself is the one every email uses (fixed 600 px card, phone padding): emailShell
  return emailShell({ title: 'Quote notification', content, above: productHeader, below: footer })
}

/**
 * Customer quote notification email
 */
export function customerQuoteEmail(data: CustomerEmailData): string {
  const primaryColor = brandColourForEmail(data.primaryColor)

  const estimate = data.awaitingConfirmation === true
  const validitySection = estimate
    ? `<p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">${escapeHtml(data.businessName)} will review and confirm this estimate. You can accept it once they have.</p>`
    : data.validUntil
    ? `<p style="margin: 0 0 24px; color: #626C66; font-size: 14px;">This quote is valid until <strong>${data.validUntil}</strong>.</p>`
    : ''

  // T-204: said beside the price (see `state` above)
  const state: CustomerQuoteState = data.state ?? (estimate ? 'waiting' : 'estimate')

  const scopeSection = data.scopeSummary
    ? `
      <div style="margin: 24px 0; padding: 16px; background-color: #F2F0EA; border-radius: 8px;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #4F5D57; font-size: 14px;">Scope of work</p>
        <p style="margin: 0; color: #626C66; font-size: 14px; line-height: 1.5;">${escapeHtml(data.scopeSummary)}</p>
      </div>
    `
    : ''

  const content = `
    ${businessLogoBlock(data.brand?.logoUrl, data.businessName)}
    <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: ${textColourOnCardForEmail(primaryColor)};">
      ${escapeHtml(data.businessName)}
    </h1>
    <p style="margin: 0 0 32px; color: #626C66; font-size: 14px;">
      Your ${estimate ? 'estimate' : 'quote'} for ${escapeHtml(data.serviceName)}
    </p>

    <p style="margin: 0 0 16px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
      Hi ${escapeHtml(data.customerName)},
    </p>
    <p style="margin: 0 0 24px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
      ${estimate
        ? 'Thank you for your enquiry. Here is your estimate, based on your photos and details:'
        : "Thank you for your enquiry. We've prepared a quote for you:"}
    </p>

    ${customerPricePanel({ label: estimate ? 'Estimate' : 'Quoted total', total: data.total, colour: textColourOnCardForEmail(primaryColor), state, businessName: data.businessName })}

    ${scopeSection}
    ${validitySection}

    <table role="presentation" style="width: 100%; margin: 32px 0;">
      <tr>
        <td style="text-align: center;">
          <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
            ${estimate ? 'View your estimate' : 'View full quote'}
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 24px 0 0; color: #626C66; font-size: 14px; line-height: 1.5;">
      If you have any questions, simply reply to this email and we'll get back to you.
    </p>

    <p style="margin: 24px 0 0; color: #4F5D57; font-size: 14px;">
      Best regards,<br>
      <strong>${escapeHtml(data.businessName)}</strong>
    </p>
  `

  return emailWrapper(content, primaryColor, { brand: data.brand })
}

/**
 * Business new lead notification email
 */
export function businessNotificationEmail(data: BusinessEmailData): string {
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's

  const phoneSection = data.customerPhone
    ? `<p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">Phone: ${escapeHtml(data.customerPhone)}</p>`
    : ''

  const addressSection = data.jobAddress
    ? `
      <div style="margin-top: 16px;">
        <p style="margin: 0; font-weight: 600; color: #4F5D57; font-size: 14px;">Job location</p>
        <p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">${escapeHtml(data.jobAddress)}</p>
      </div>
    `
    : ''

  const content = `
    <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #E5E2D8;">
      <p style="margin: 0; font-size: 14px; color: #626C66;">${data.awaitingReview ? 'Estimate ready for your review' : 'New quote generated'}</p>
      ${data.reviewReason ? `<p style="margin: 8px 0 0; font-size: 13px; color: #7F5710;">${escapeHtml(data.reviewReason)}</p>` : ''}
      <h1 style="margin: 8px 0 0; font-size: 24px; font-weight: 700; color: #1B2823;">
        ${escapeHtml(data.customerName)}
      </h1>
    </div>

    <div style="margin-bottom: 24px;">
      <table role="presentation" style="width: 100%;">
        <tr>
          <td style="width: 50%; vertical-align: top;">
            <p style="margin: 0; font-weight: 600; color: #4F5D57; font-size: 14px;">Service</p>
            <p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">${escapeHtml(data.serviceName)}</p>
          </td>
          <td style="width: 50%; vertical-align: top; text-align: right;">
            <p style="margin: 0; font-weight: 600; color: #4F5D57; font-size: 14px;">Quote total</p>
            <p style="margin: 4px 0 0; font-size: 20px; font-weight: 700; color: ${textColourOnCardForEmail(primaryColor)};">${escapeHtml(data.total)}</p>
          </td>
        </tr>
      </table>
    </div>

    <div style="margin-bottom: 24px; padding: 16px; background-color: #F2F0EA; border-radius: 8px;">
      <p style="margin: 0; font-weight: 600; color: #4F5D57; font-size: 14px;">Customer details</p>
      <p style="margin: 8px 0 0; color: #626C66; font-size: 14px;">${escapeHtml(data.customerName)}</p>
      ${data.customerEmail ? `<p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">
        <a href="mailto:${escapeHtml(data.customerEmail)}" style="color: ${textColourOnCardForEmail(primaryColor)}; text-decoration: none;">
          ${escapeHtml(data.customerEmail)}
        </a>
      </p>` : ''}
      ${phoneSection}
      ${addressSection}
    </div>

    <p style="margin: 0 0 8px; color: #626C66; font-size: 12px;">
      Quote ID: ${escapeHtml(data.quoteId)}
    </p>

    <table role="presentation" style="width: 100%; margin: 24px 0;">
      <tr>
        <td style="text-align: center;">
          <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 14px 28px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 8px;">
            ${data.awaitingReview ? 'Review and approve' : 'View in dashboard'}
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 24px 0 0; color: #626C66; font-size: 12px; text-align: center;">
      ${data.awaitingReview
        ? 'The customer has not been sent anything yet. Review it, edit if needed, and approve to send it.'
        : 'The customer has been sent their quote automatically.'}
    </p>
  `

  return emailWrapper(content, primaryColor, { toBusiness: true })
}

export interface ReviewEmailData {
  businessName: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  serviceName: string
  jobAddress?: string
  quoteId: string
  /** Price or measured range, already formatted for the business's region */
  total: string
  /** T-156: the one-tap link; absent when it couldn't be issued (the dashboard link still works) */
  approveUrl?: string
  dashboardUrl: string
  /** T-147 hold kind, said in plain words */
  holdLine: string
  /** Why a check held it */
  reviewReason?: string
  /** T-150: the owner's own test request from setup */
  testBanner?: string
  primaryColor?: string
  /** T-183: warnings, every price line with its source, the parts of a combined quote, the total and the photo count */
  detail?: ApprovalDetail
}

/**
 * T-183: what the business judges the price by, in the order it should read
 * it: warnings first, then each line with its amount and where its quantity
 * came from, each service's subtotal on a combined quote, and the one total.
 * The same result draws the approval page (shared/approval-detail.ts).
 *
 * The customer's photos are private (short-lived signed addresses), and email
 * programs block, proxy or cache images, so the email says how many there are
 * and the approval page shows them.
 */
export function approvalDetailHtml(detail: ApprovalDetail): { warnings: string; price: string; photos: string } {
  const warnings = detail.warnings
    .map(
      (warning) => `<div data-role="warning" data-kind="${warning.kind}" style="margin: 0 0 12px; padding: 12px 14px; background-color: #F2F0EA; border-left: 4px solid #7F5710; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; font-size: 13px; font-weight: 700; color: #7F5710;">${escapeHtml(warning.title)}</p>
        ${warning.lines.map((line) => `<p style="margin: 6px 0 0; font-size: 14px; line-height: 1.45; color: #1B2823;">${escapeHtml(line)}</p>`).join('')}
        ${warning.kind === 'check' ? `<p style="margin: 6px 0 0; font-size: 12px; color: #626C66;">${escapeHtml(APPROVAL_COPY.checksNote)}</p>` : ''}
      </div>`
    )
    .join('')

  const cell = 'padding: 8px 0; border-bottom: 1px solid #E5E2D8; font-size: 14px; vertical-align: top;'
  const rows = detail.parts
    .map((part) => {
      const who = part.addedBy === 'customer' ? APPROVAL_COPY.addedByCustomer : part.addedBy === 'business' ? APPROVAL_COPY.addedByYou : ''
      const heading = detail.combined
        ? `<tr data-role="part"><td colspan="2" style="padding: 14px 0 4px; font-size: 14px; font-weight: 700; color: #1B2823;">${escapeHtml(part.serviceName)}${who ? ` <span style="font-weight: 400; color: #626C66;">(${escapeHtml(who)})</span>` : ''}</td></tr>`
        : ''
      const lines = part.lines
        .map(
          (line) => `<tr data-role="line">
            <td style="${cell} color: #1B2823;">${escapeHtml(line.label)}${line.source ? `<br><span data-role="source" style="font-size: 12px; color: #626C66;">${escapeHtml(line.source)}</span>` : ''}</td>
            <td style="${cell} color: #1B2823; text-align: right; white-space: nowrap;">${escapeHtml(line.amount)}</td>
          </tr>`
        )
        .join('')
      const minimum = part.minimumNote
        ? `<tr data-role="minimum"><td colspan="2" style="padding: 8px 0; font-size: 13px; color: #626C66;">${escapeHtml(part.minimumNote)}</td></tr>`
        : ''
      const waits = part.priceWaits
        ? `<tr><td colspan="2" style="padding: 4px 0 8px; font-size: 13px; color: #626C66;">${escapeHtml(APPROVAL_COPY.priceWaits)}</td></tr>`
        : ''
      const subtotal = detail.combined
        ? `<tr data-role="part-subtotal"><td style="padding: 8px 0; font-size: 14px; color: #4F5D57;">${escapeHtml(APPROVAL_COPY.subtotal)}</td><td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #1B2823; text-align: right; white-space: nowrap;">${escapeHtml(part.subtotal)}</td></tr>`
        : ''
      return heading + lines + minimum + waits + subtotal
    })
    .join('')
  const tax = detail.totals.tax
    ? `<tr data-role="tax"><td style="padding: 8px 0; font-size: 14px; color: #626C66;">${escapeHtml(detail.totals.tax.label)}</td><td style="padding: 8px 0; font-size: 14px; color: #626C66; text-align: right; white-space: nowrap;">${escapeHtml(detail.totals.tax.amount)}</td></tr>`
    : ''
  const price = `<table role="presentation" data-role="price-lines" style="width: 100%; border-collapse: collapse; margin: 0 0 16px;">
      ${rows}
      ${tax}
      <tr><td style="padding: 12px 0 0; font-size: 16px; font-weight: 700; color: #1B2823;">${escapeHtml(APPROVAL_COPY.total)}</td><td data-role="total" style="padding: 12px 0 0; font-size: 20px; font-weight: 700; color: #1B2823; text-align: right; white-space: nowrap;">${escapeHtml(detail.totals.total)}</td></tr>
    </table>`
  const photos =
    detail.photoCount > 0
      ? `<p data-role="photos" style="margin: 0 0 16px; font-size: 14px; color: #4F5D57;">${escapeHtml(APPROVAL_COPY.photosOnPage(detail.photoCount))}</p>`
      : ''
  return { warnings, price, photos }
}

/**
 * T-146 / T-156: "Review and approve". A big Approve & send button (the
 * one-tap link: it opens a confirmation page, it never approves on its own),
 * a smaller dashboard link for editing, the price, and whether the customer
 * can already see the estimate.
 */
export function reviewRequestEmail(data: ReviewEmailData): string {
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's
  const testBanner = data.testBanner
    ? `<div style="margin: 0 0 20px; padding: 12px 14px; background-color: #F2F0EA; border: 1px solid #CFC0A6; border-radius: 8px;">
        <p style="margin: 0; font-size: 13px; font-weight: 700; color: #7F5710;">TEST REQUEST</p>
        <p style="margin: 4px 0 0; font-size: 13px; color: #7F5710;">${escapeHtml(data.testBanner)}</p>
      </div>`
    : ''
  const approveButton = data.approveUrl
    ? `<table role="presentation" style="width: 100%; margin: 24px 0 8px;">
        <tr>
          <td style="text-align: center;">
            <a href="${escapeHtml(data.approveUrl)}" style="display: block; padding: 16px 28px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 700; font-size: 17px; border-radius: 10px;" data-role="approve">
              Approve &amp; send
            </a>
          </td>
        </tr>
      </table>
      <p style="margin: 0 0 8px; text-align: center; font-size: 12px; color: #626C66;">Opens a page to confirm. Works once, for 72 hours.</p>`
    : ''
  const dashboardLink = data.approveUrl
    ? `<p style="margin: 16px 0 0; text-align: center; font-size: 14px;">
        <a href="${escapeHtml(data.dashboardUrl)}" style="color: ${textColourOnCardForEmail(primaryColor)}; text-decoration: underline;" data-role="dashboard">Open in dashboard to edit</a>
      </p>`
    : `<table role="presentation" style="width: 100%; margin: 24px 0;">
        <tr>
          <td style="text-align: center;">
            <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 14px 28px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 8px;" data-role="dashboard">
              Review and approve
            </a>
          </td>
        </tr>
      </table>`

  // T-183: warnings first, then the lines the price is made of, then the photos, then the button
  const detail = data.detail ? approvalDetailHtml(data.detail) : null
  // the reason a check held it is not said twice when it is the "Check the service" warning
  const reasonShown = data.detail?.warnings.some((warning) => warning.lines.includes(data.reviewReason ?? ''))
  const content = `
    ${testBanner}
    <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #E5E2D8;">
      <p style="margin: 0; font-size: 14px; color: #626C66;">Estimate ready for your approval</p>
      <h1 style="margin: 8px 0 0; font-size: 24px; font-weight: 700; color: #1B2823;">${escapeHtml(data.customerName)}</h1>
      <p style="margin: 4px 0 0; font-size: 15px; color: #4F5D57;">${escapeHtml(data.serviceName)}</p>
      <p style="margin: 12px 0 0; font-size: 28px; font-weight: 700; color: ${textColourOnCardForEmail(primaryColor)};" data-role="price">${escapeHtml(data.total)}</p>
    </div>

    ${detail ? detail.warnings : ''}
    ${detail ? detail.price : ''}
    ${detail ? detail.photos : ''}

    <div style="margin-bottom: 20px; padding: 14px 16px; background-color: #F2F0EA; border-radius: 8px;">
      <p style="margin: 0; font-size: 14px; color: #1B2823;" data-role="hold">${escapeHtml(data.holdLine)}</p>
      ${data.reviewReason && !reasonShown ? `<p style="margin: 8px 0 0; font-size: 13px; color: #7F5710;" data-role="reason">Why: ${escapeHtml(data.reviewReason)}</p>` : ''}
    </div>

    ${approveButton}
    ${dashboardLink}

    <div style="margin-top: 28px; padding: 16px; background-color: #F2F0EA; border-radius: 8px;">
      <p style="margin: 0; font-weight: 600; color: #4F5D57; font-size: 14px;">Customer details</p>
      <p style="margin: 8px 0 0; color: #626C66; font-size: 14px;">${escapeHtml(data.customerName)}</p>
      ${data.customerEmail ? `<p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">${escapeHtml(data.customerEmail)}</p>` : ''}
      ${data.customerPhone ? `<p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">Phone: ${escapeHtml(data.customerPhone)}</p>` : ''}
      ${data.jobAddress ? `<p style="margin: 4px 0 0; color: #626C66; font-size: 14px;">${escapeHtml(data.jobAddress)}</p>` : ''}
    </div>

    <p style="margin: 16px 0 0; color: #626C66; font-size: 12px;">Quote ID: ${escapeHtml(data.quoteId)}</p>
  `

  return emailWrapper(content, primaryColor, { fromProduct: true })
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

// ============================================================================
// CLARIFICATION EMAIL TEMPLATE (Phase 4: Quality Gate)
// ============================================================================

export interface ClarificationEmailData {
  customerName: string
  businessName: string
  serviceName: string
  clarifyUrl: string
  questions: Array<{ question: string }>
  primaryColor?: string
}

/**
 * Email sent to customer when the quality gate requests clarification.
 */
// ============================================================================
// FEEDBACK NOTIFICATION EMAIL (Quote Editor Flow)
// ============================================================================

export interface FeedbackNotificationEmailData {
  businessName: string
  customerName: string
  serviceName: string
  feedbackType: 'feedback' | 'approval_request'
  feedbackText?: string
  dashboardUrl: string
  primaryColor?: string
}

/**
 * Email sent to business owner when customer submits feedback on a quote.
 */
export function feedbackNotificationEmail(data: FeedbackNotificationEmailData): string {
  const primaryColor: string = EMAIL_COLOR.juniper // T-191: an email to the business is the product's
  const feedbackLabel = data.feedbackType === 'approval_request' ? 'Review request' : 'Feedback'

  const feedbackSection = data.feedbackText
    ? `
      <div style="margin: 16px 0; padding: 16px; background-color: #F2F0EA; border-left: 4px solid #CFC0A6; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #4F5D57; font-size: 14px;">Customer message:</p>
        <p style="margin: 0; color: #4F5D57; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(data.feedbackText)}</p>
      </div>
    `
    : ''

  const content = `
    <div style="margin-bottom: 16px; display: inline-block; padding: 6px 12px; background-color: #F2F0EA; border-radius: 6px;">
      <span style="font-weight: 600; font-size: 13px; color: #7F5710;">${feedbackLabel}</span>
    </div>

    <h1 style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #1B2823;">
      Customer ${feedbackLabel.toLowerCase()} on quote
    </h1>
    <p style="margin: 0 0 16px; color: #626C66; font-size: 14px;">
      ${escapeHtml(data.customerName)} &middot; ${escapeHtml(data.serviceName)}
    </p>

    ${feedbackSection}

    <table role="presentation" style="width: 100%; margin: 24px 0;">
      <tr>
        <td style="text-align: center;">
          <a href="${escapeHtml(data.dashboardUrl)}" style="display: inline-block; padding: 14px 28px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 14px; border-radius: 8px;">
            View in dashboard
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 16px 0 0; color: #626C66; font-size: 13px;">
      You can review and respond to this ${feedbackLabel.toLowerCase()} from your dashboard.
    </p>
  `

  return emailWrapper(content, primaryColor)
}

// ============================================================================
// REVISED QUOTE EMAIL (Quote Editor Flow)
// ============================================================================

export interface RevisedQuoteEmailData {
  customerName: string
  businessName: string
  serviceName: string
  quoteViewUrl: string
  total: string
  primaryColor?: string
}

/**
 * Email sent to customer when business edits and resends a quote.
 */
export function revisedQuoteEmail(data: RevisedQuoteEmailData): string {
  const primaryColor = brandColourForEmail(data.primaryColor)

  const content = `
    <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: ${textColourOnCardForEmail(primaryColor)};">
      ${escapeHtml(data.businessName)}
    </h1>
    <p style="margin: 0 0 32px; color: #626C66; font-size: 14px;">
      Updated quote for ${escapeHtml(data.serviceName)}
    </p>

    <p style="margin: 0 0 16px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
      Hi ${escapeHtml(data.customerName)},
    </p>
    <p style="margin: 0 0 24px; color: #4F5D57; font-size: 16px; line-height: 1.5;">
      Your quote has been updated. Please review the latest version:
    </p>

    ${customerPricePanel({ label: 'Updated total', total: data.total, colour: textColourOnCardForEmail(primaryColor), state: 'confirmed', businessName: data.businessName })}

    <table role="presentation" style="width: 100%; margin: 32px 0;">
      <tr>
        <td style="text-align: center;">
          <a href="${escapeHtml(data.quoteViewUrl)}" style="display: inline-block; padding: 16px 32px; background-color: ${primaryColor}; color: ${textOnColourForEmail(primaryColor)}; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 8px;">
            View updated quote
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 24px 0 0; color: #626C66; font-size: 14px; line-height: 1.5;">
      If you have any questions, simply reply to this email and we'll get back to you.
    </p>

    <p style="margin: 24px 0 0; color: #4F5D57; font-size: 14px;">
      Best regards,<br>
      <strong>${escapeHtml(data.businessName)}</strong>
    </p>
  `

  return emailWrapper(content, primaryColor)
}

// ============================================================================
// CLARIFICATION EMAIL TEMPLATE (Phase 4: Quality Gate)
// ============================================================================

export function customerClarificationEmail(data: ClarificationEmailData): string {
  const questionsList = data.questions
    .map((q) => `<li style="margin-bottom: 8px; color: #4F5D57;">${escapeHtml(q.question)}</li>`)
    .join('')

  const content = `
    <tr>
      <td style="padding: 32px;">
        <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 800; color: #1B2823;">
          Quick question about your quote
        </h1>
        <p style="margin: 0 0 24px 0; color: #4F5D57; font-size: 15px; line-height: 1.6;">
          Hi ${escapeHtml(data.customerName)},
        </p>
        <p style="margin: 0 0 16px 0; color: #4F5D57; font-size: 15px; line-height: 1.6;">
          ${escapeHtml(data.businessName)} needs a little more information to finalize your ${escapeHtml(data.serviceName)} quote.
          It will only take a moment:
        </p>
        <ul style="margin: 0 0 24px 0; padding-left: 20px; font-size: 14px;">
          ${questionsList}
        </ul>
        <table role="presentation" style="margin: 0 auto;">
          <tr>
            <td style="background-color: #1B2823; border-radius: 6px;">
              <a href="${data.clarifyUrl}" style="display: inline-block; padding: 14px 32px; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none;">
                Answer questions
              </a>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0 0; color: #626C66; font-size: 13px;">
          This helps us provide you with the most accurate quote possible.
        </p>
      </td>
    </tr>`

  return emailWrapper(content, data.primaryColor)
}
