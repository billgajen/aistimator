/**
 * Email Service
 *
 * Handles sending quote notification emails to customers and businesses.
 */

import { formatMoney } from '@estimator/shared'
import { sendEmail, type PostmarkConfig } from './postmark'
import {
  customerQuoteEmail,
  businessNotificationEmail,
  type CustomerEmailData,
  type BusinessEmailData,
} from './templates'

export interface EmailConfig {
  postmarkApiToken: string
  fromEmail: string
  fromName?: string
  appUrl: string
}

export interface QuoteEmailData {
  quoteId: string
  quoteToken: string
  customer: {
    name: string
    email: string
    phone?: string
  }
  business: {
    name: string
    ownerEmail: string
    primaryColor?: string
  }
  service: {
    name: string
  }
  job?: {
    address?: string
  }
  pricing: {
    total: number
    currency: string
  }
  /** T-133: BCP 47 locale from the tenant's region (money + date formatting) */
  locale?: string
  content?: {
    scopeSummary?: string
    validityDays?: number
  }
}

export interface SendQuoteEmailsResult {
  customerEmail: {
    success: boolean
    error?: string
  }
  businessEmail: {
    success: boolean
    error?: string
  }
}

/**
 * Format date for display (T-133: locale from the tenant's region)
 */
function formatLongDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Send quote notification emails to customer and business
 */
export async function sendQuoteEmails(
  config: EmailConfig,
  data: QuoteEmailData
): Promise<SendQuoteEmailsResult> {
  const postmarkConfig: PostmarkConfig = {
    apiToken: config.postmarkApiToken,
    fromEmail: config.fromEmail,
    fromName: config.fromName || data.business.name,
  }

  const quoteViewUrl = `${config.appUrl}/q/${data.quoteId}?token=${data.quoteToken}`
  const dashboardUrl = `${config.appUrl}/app/quotes/${data.quoteId}`

  const locale = data.locale || 'en-GB'
  const totalFormatted = formatMoney(data.pricing.total, data.pricing.currency, locale)

  // Calculate validity date
  let validUntil: string | undefined
  if (data.content?.validityDays) {
    const validDate = new Date()
    validDate.setDate(validDate.getDate() + data.content.validityDays)
    validUntil = formatLongDate(validDate, locale)
  }

  // Send customer email
  const customerEmailData: CustomerEmailData = {
    customerName: data.customer.name,
    businessName: data.business.name,
    serviceName: data.service.name,
    quoteViewUrl,
    total: totalFormatted,
    currency: data.pricing.currency,
    validUntil,
    scopeSummary: data.content?.scopeSummary,
    primaryColor: data.business.primaryColor,
  }

  const customerHtml = customerQuoteEmail(customerEmailData)
  // T-151: a phone-only customer has no email address; the business is still told
  const customerResult = data.customer.email
    ? await sendEmail(postmarkConfig, {
        to: data.customer.email,
        subject: `Your quote from ${data.business.name}`,
        htmlBody: customerHtml,
        tag: 'quote-customer',
        replyTo: data.business.ownerEmail,
      })
    : { success: false, error: 'No customer email (phone only)' }

  console.log(
    `[Email] Customer email ${customerResult.success ? 'sent' : 'failed'}: ${data.customer.email}`
  )

  // Send business notification email
  const businessEmailData: BusinessEmailData = {
    businessName: data.business.name,
    customerName: data.customer.name,
    customerEmail: data.customer.email,
    customerPhone: data.customer.phone,
    serviceName: data.service.name,
    jobAddress: data.job?.address,
    quoteId: data.quoteId,
    dashboardUrl,
    total: totalFormatted,
    currency: data.pricing.currency,
    primaryColor: data.business.primaryColor,
  }

  const businessHtml = businessNotificationEmail(businessEmailData)
  const businessResult = await sendEmail(postmarkConfig, {
    to: data.business.ownerEmail,
    subject: `New quote: ${data.customer.name} - ${data.service.name}`,
    htmlBody: businessHtml,
    tag: 'quote-business',
  })

  console.log(
    `[Email] Business email ${businessResult.success ? 'sent' : 'failed'}: ${data.business.ownerEmail}`
  )

  return {
    customerEmail: {
      success: customerResult.success,
      error: customerResult.error,
    },
    businessEmail: {
      success: businessResult.success,
      error: businessResult.error,
    },
  }
}

export interface ReviewRequestEmailData {
  quoteId: string
  ownerEmail: string
  businessName: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  serviceName: string
  jobAddress?: string
  total: number
  /** Present when uncertain quantities give a price range */
  range?: { low: number; high: number }
  currency: string
  locale?: string
  /** Why a check held it (quality gate / send-guard); absent for the default review */
  reason?: string
  primaryColor?: string
}

/**
 * T-146: tell the business a quote is waiting for its approval. The customer
 * hears nothing until the business approves (the web app sends that email).
 */
export async function sendReviewRequestEmail(
  config: EmailConfig,
  data: ReviewRequestEmailData
): Promise<{ success: boolean; error?: string }> {
  const locale = data.locale || 'en-GB'
  const money = (n: number) => formatMoney(n, data.currency, locale)
  const total = data.range && data.range.high > data.range.low
    ? `${money(data.range.low)} – ${money(data.range.high)}`
    : money(data.total)
  const html = businessNotificationEmail({
    businessName: data.businessName,
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone,
    serviceName: data.serviceName,
    jobAddress: data.jobAddress,
    quoteId: data.quoteId,
    dashboardUrl: `${config.appUrl}/app/quotes/${data.quoteId}`,
    total,
    currency: data.currency,
    primaryColor: data.primaryColor,
    awaitingReview: true,
    reviewReason: data.reason,
  })
  const result = await sendEmail(
    { apiToken: config.postmarkApiToken, fromEmail: config.fromEmail, fromName: config.fromName || data.businessName },
    {
      to: data.ownerEmail,
      subject: `Review and approve: ${data.customerName} - ${data.serviceName}`,
      htmlBody: html,
      tag: 'quote-review-request',
    }
  )
  console.log(`[Email] Review request ${result.success ? 'sent' : 'failed'}: ${data.ownerEmail}`)
  return { success: result.success, error: result.error }
}

export interface EstimateShownEmailData {
  quoteId: string
  quoteToken: string
  customerName: string
  customerEmail: string
  businessName: string
  replyTo?: string
  serviceName: string
  total: number
  /** Only a range the engine measured (never one invented around a flat price) */
  range?: { low: number; high: number }
  currency: string
  locale?: string
  scopeSummary?: string
  primaryColor?: string
}

/**
 * T-147: the customer's estimate, sent the moment it is priced while the
 * business reviews it. Says the business will confirm; the "Your quote from…"
 * email follows on approval (the web app sends that one).
 */
export async function sendEstimateShownEmail(
  config: EmailConfig,
  data: EstimateShownEmailData
): Promise<{ success: boolean; error?: string }> {
  const locale = data.locale || 'en-GB'
  const money = (n: number) => formatMoney(n, data.currency, locale)
  const total = data.range && data.range.high > data.range.low
    ? `${money(data.range.low)} – ${money(data.range.high)}`
    : money(data.total)
  const html = customerQuoteEmail({
    customerName: data.customerName,
    businessName: data.businessName,
    serviceName: data.serviceName,
    quoteViewUrl: `${config.appUrl}/q/${data.quoteId}?token=${data.quoteToken}`,
    total,
    currency: data.currency,
    scopeSummary: data.scopeSummary,
    primaryColor: data.primaryColor,
    awaitingConfirmation: true,
  })
  const result = await sendEmail(
    { apiToken: config.postmarkApiToken, fromEmail: config.fromEmail, fromName: config.fromName || data.businessName },
    {
      to: data.customerEmail,
      subject: `Your estimate from ${data.businessName}`,
      htmlBody: html,
      tag: 'estimate-customer',
      ...(data.replyTo && { replyTo: data.replyTo }),
    }
  )
  console.log(`[Email] Estimate email ${result.success ? 'sent' : 'failed'}: ${data.customerEmail}`)
  return { success: result.success, error: result.error }
}

/**
 * Check if email is configured
 */
export function isEmailConfigured(
  postmarkApiToken?: string,
  fromEmail?: string
): boolean {
  return !!(postmarkApiToken && fromEmail)
}

// Re-export types
export type { PostmarkConfig, EmailMessage, PostmarkResponse } from './postmark'
export type { CustomerEmailData, BusinessEmailData } from './templates'
