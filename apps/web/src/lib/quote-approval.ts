/**
 * T-146: business approval of a held quote — one tap from the dashboard or
 * the mobile app sends it to the customer.
 *
 * - Only `pending_review` quotes with a price can be approved (a lead held at
 *   the plan limit has no price yet; it is priced from the dashboard first).
 * - Marks it approved (`approved_at`/`approved_by`): the customer page then
 *   reads "Quote — Reviewed and confirmed by {business}".
 * - Issues a fresh link for the email, and keeps the link the customer
 *   already holds valid (`previous_token_hash`) instead of breaking it.
 *   (T-157: every earlier link stays valid, in `link_token_hashes`.)
 * - The status guard in the UPDATE makes a double tap send once.
 * - T-148: approving without editing (version 1) sends the generated wording
 *   as it is, so banned customer words in it are removed first (no AI here).
 *   Wording that can't be repaired that way must be edited: 400
 *   WORDING_NEEDS_EDIT. An edited quote's text is the business's own and is
 *   never touched.
 * - T-156: the one function behind every approval: the dashboard, the app and
 *   the one-tap email link (no user: `userId` null, `via: 'email_link'`).
 *   `approved_via` records which.
 */

import { formatMoney, getRegion, repairCustomerWording, businessPhrasesFrom } from '@estimator/shared'
import type { QuotePricing, TenantBranding, CustomerWording, WordingRepairRecord, PricingRules, WorkStepConfig } from '@estimator/shared'
import type { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { sendEmail, isPostmarkConfigured, generateCustomerEmailHtml } from '@/lib/postmark'
import { businessReplyTo } from '@/lib/business-email'

/** A signed-in user's client (dashboard, app) or the service role (email link, T-156) */
type Supabase = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>

export type ApprovalVia = 'dashboard' | 'app' | 'email_link'

export type ApproveResult =
  | { ok: true; status: 'sent'; quoteViewUrl: string; emailed: boolean; emailError?: string }
  | { ok: false; httpStatus: number; code: string; message: string }

/** Pure: can this quote be approved, and if not, why (for tests and the UI). */
export function approvalBlocker(quote: {
  status: string
  pricing_json: { total?: number } | null
  content_json: { limitHold?: boolean } | null
}): { code: string; message: string } | null {
  if (quote.status !== 'pending_review') {
    return { code: 'INVALID_STATUS', message: `Only quotes awaiting your approval can be approved (this one is '${quote.status}')` }
  }
  if (quote.content_json?.limitHold || !((quote.pricing_json?.total ?? 0) > 0)) {
    return { code: 'NOT_PRICED', message: 'This quote has no price yet. Price it first.' }
  }
  return null
}

interface ServiceText {
  name: string
  description?: string | null
  scope_includes?: string[] | null
  scope_excludes?: string[] | null
  default_assumptions?: string[] | null
  work_steps?: WorkStepConfig[] | null
  /** Add-ons and steps live in the related service_pricing_rules row */
  service_pricing_rules?: { rules_json?: Partial<PricingRules> | null } | Array<{ rules_json?: Partial<PricingRules> | null }> | null
}

/**
 * T-148: the wording an unedited quote would send, with banned customer words
 * removed. Pure apart from the clock. `changed` = the content must be saved.
 */
export async function wordingForApproval(opts: {
  content: CustomerWording | null
  version: number
  service: ServiceText
}): Promise<{ content: CustomerWording | null; changed: boolean; record?: WordingRepairRecord; unresolved: string[] }> {
  const { content, version, service } = opts
  // Edited by the business: its own text, sent as written
  if (!content || version > 1) return { content, changed: false, unresolved: [] }
  const ruleRow = Array.isArray(service.service_pricing_rules) ? service.service_pricing_rules[0] : service.service_pricing_rules
  const rules = ruleRow?.rules_json ?? {}
  const result = await repairCustomerWording(content, {
    path: 'approval',
    businessPhrases: businessPhrasesFrom({
      serviceName: service.name,
      serviceDescription: service.description,
      scopeIncludes: service.scope_includes,
      scopeExcludes: service.scope_excludes,
      defaultAssumptions: service.default_assumptions,
      addonLabels: (rules.addons || []).map((a) => a.label),
      workStepNames: (rules.workSteps || service.work_steps || []).map((ws) => ws.name),
    }),
  })
  const changed = result.record.rewritten.length + result.record.removed.length > 0
  return {
    content: result.wording,
    changed,
    ...(result.record.found > 0 && { record: result.record }),
    unresolved: result.unresolved,
  }
}

export async function approveQuote(opts: {
  supabase: Supabase
  quoteId: string
  tenantId: string
  /** null for the email link: no one is signed in */
  userId: string | null
  via: ApprovalVia
}): Promise<ApproveResult> {
  const { quoteId, tenantId, userId, via } = opts
  // The two client types share every call used here
  const supabase = opts.supabase as Awaited<ReturnType<typeof createClient>>

  const { data: quote, error } = await supabase
    .from('quotes')
    .select(
      `id, status, version, quote_token_hash, pricing_json, content_json, customer_json, pricing_trace_json,
       tenants!tenant_id ( id, name, region, branding_json ),
       services!service_id ( id, name, description, scope_includes, scope_excludes, default_assumptions, work_steps, service_pricing_rules ( rules_json ) )`
    )
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (error && error.code !== 'PGRST116') console.error('[Approve] load failed:', error.message)
  if (error || !quote) return { ok: false, httpStatus: 404, code: 'NOT_FOUND', message: 'Quote not found' }

  const blocker = approvalBlocker(quote as never)
  if (blocker) return { ok: false, httpStatus: 400, ...blocker }

  // T-148: what an unedited quote sends must pass the customer language guard
  const wording = await wordingForApproval({
    content: quote.content_json as CustomerWording | null,
    version: (quote as { version?: number | null }).version ?? 1,
    service: quote.services as unknown as ServiceText,
  })
  if (wording.unresolved.length > 0) {
    return {
      ok: false,
      httpStatus: 400,
      code: 'WORDING_NEEDS_EDIT',
      message: `The estimate's wording uses a word customers should not see (${wording.unresolved[0]}). Edit the wording, then send it.`,
    }
  }

  const { token, hash } = generateQuoteToken()
  const expiry = getTokenExpiry(30)
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('quotes')
    .update({
      status: 'sent',
      sent_at: now,
      approved_at: now,
      approved_by: userId,
      approved_via: via,
      previous_token_hash: quote.quote_token_hash,
      quote_token_hash: hash,
      token_expires_at: expiry.toISOString(),
      ...(wording.changed && { content_json: wording.content }),
      ...(wording.record && {
        pricing_trace_json: { ...((quote as { pricing_trace_json?: object | null }).pricing_trace_json ?? {}), wordingRepair: wording.record },
      }),
    })
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending_review') // a second tap finds nothing to update
    .select('id')
  if (updateError) {
    console.error('[Approve] update failed:', updateError.message)
    return { ok: false, httpStatus: 500, code: 'DB_ERROR', message: 'Failed to approve quote' }
  }
  if (!updated || updated.length === 0) {
    return { ok: false, httpStatus: 409, code: 'ALREADY_SENT', message: 'This quote was already approved' }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const quoteViewUrl = `${appUrl}/q/${quoteId}?token=${token}`

  const tenant = quote.tenants as unknown as { name: string; region?: string | null; branding_json: TenantBranding | null }
  const service = quote.services as unknown as { name: string }
  const customer = quote.customer_json as { name: string; email?: string | null }
  const pricing = quote.pricing_json as QuotePricing

  if (!customer?.email || !isPostmarkConfigured()) {
    return { ok: true, status: 'sent', quoteViewUrl, emailed: false }
  }
  const locale = getRegion(tenant.region).locale
  const htmlBody = generateCustomerEmailHtml({
    customerName: customer.name,
    businessName: tenant.name,
    serviceName: service.name,
    quoteViewUrl,
    total: formatMoney(pricing.total, pricing.currency, locale),
    validUntil: expiry.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
    primaryColor: tenant.branding_json?.primaryColor,
  })
  const emailResult = await sendEmail({
    to: customer.email,
    subject: `Your quote from ${tenant.name}`,
    htmlBody,
    tag: 'quote-approved',
    // T-157: replies reach the business
    replyTo: await businessReplyTo(tenantId),
  })
  if (!emailResult.success) console.error('[Approve] customer email failed:', emailResult.error)
  return { ok: true, status: 'sent', quoteViewUrl, emailed: emailResult.success, emailError: emailResult.error }
}
