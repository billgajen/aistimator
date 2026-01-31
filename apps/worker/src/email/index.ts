/**
 * Email Service
 *
 * Handles sending quote notification emails to customers and businesses.
 */

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
 * Format currency for display
 */
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

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
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
  const dashboardUrl = `${config.appUrl}/app/quotes` // Will link to quote details when implemented

  const totalFormatted = formatCurrency(data.pricing.total, data.pricing.currency)

  // Calculate validity date
  let validUntil: string | undefined
  if (data.content?.validityDays) {
    const validDate = new Date()
    validDate.setDate(validDate.getDate() + data.content.validityDays)
    validUntil = formatDate(validDate)
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
  const customerResult = await sendEmail(postmarkConfig, {
    to: data.customer.email,
    subject: `Your quote from ${data.business.name}`,
    htmlBody: customerHtml,
    tag: 'quote-customer',
    replyTo: data.business.ownerEmail,
  })

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
