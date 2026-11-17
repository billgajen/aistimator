import type { NextResponse } from 'next/server'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'

/**
 * T-173: limits on what a customer does on their quote (accept, decline, ask
 * a question, answer one). Two checks, both in lib/rate-limit-config.ts:
 *
 * 1. Before anything is read: by the caller's address.
 * 2. Once the quote's token has been checked: for that quote, and across the
 *    whole business, so a flood aimed at one business's quotes cannot bury it
 *    in emails. These are counted only for a caller who holds the quote's
 *    link, so someone who merely knows a quote's id cannot use up its
 *    allowance and lock the real customer out.
 *
 * Each returns the 429 to send, or null to carry on.
 */
export async function limitQuoteAction(request: Request): Promise<NextResponse | null> {
  const result = await checkRateLimit('quote_actions', { ip: getClientIp(request) })
  return result.allowed ? null : rateLimitedResponse(result)
}

export async function limitQuoteAndBusinessActions(quoteId: string, tenantId: string | null | undefined): Promise<NextResponse | null> {
  const forQuote = await checkRateLimit('quote_actions', { key: quoteId })
  if (!forQuote.allowed) return rateLimitedResponse(forQuote)
  if (!tenantId) return null
  const forBusiness = await checkRateLimit('quote_actions_business', { key: tenantId })
  return forBusiness.allowed ? null : rateLimitedResponse(forBusiness)
}
