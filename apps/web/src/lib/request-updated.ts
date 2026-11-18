/**
 * T-179: the one email a business gets when a customer changes their request
 * by adding a service to their quote, or taking one off again. It is a
 * "request updated" notice about the SAME quote, never a second quote.
 *
 * It shows each service as a section with its subtotal, then the one total.
 * When the quote now waits for the business, it carries a fresh one-tap
 * approval link (a change to a quote ends the links in earlier emails).
 * Never throws: a customer's change must not depend on an email.
 */
import { approvalLinkExpiry, approvalLinkUrl, generateApprovalToken, getRegion } from '@qolumns/shared'
import type { CombinedPricing } from '@qolumns/shared'
import { requestUpdatedEmail } from './request-updated-email'
import type { createAdminClient } from '@/lib/supabase/server'
import { isPostmarkConfigured, sendEmail } from '@/lib/postmark'
import { resolveBusinessEmail } from '@/lib/business-email'

type Admin = ReturnType<typeof createAdminClient>

/** A fresh one-tap approval link (any earlier open link for the quote is replaced). Undefined if it could not be made. */
export async function issueApprovalLink(supabase: Admin, opts: { quoteId: string; tenantId: string; appUrl: string; now?: Date }): Promise<string | undefined> {
  const now = opts.now ?? new Date()
  try {
    await supabase
      .from('quote_approval_tokens')
      .update({ invalidated_at: now.toISOString(), invalidated_reason: 'replaced' })
      .eq('quote_id', opts.quoteId)
      .is('used_at', null)
      .is('invalidated_at', null)
    const { token, hash } = await generateApprovalToken()
    const { error } = await supabase
      .from('quote_approval_tokens')
      .insert({ tenant_id: opts.tenantId, quote_id: opts.quoteId, token_hash: hash, expires_at: approvalLinkExpiry(now).toISOString() })
    if (error) throw new Error(error.message)
    return approvalLinkUrl(opts.appUrl, token)
  } catch (e) {
    console.error(`[ApprovalLink] Could not issue a link for ${opts.quoteId}: ${e instanceof Error ? e.name : 'unknown error'}`)
    return undefined
  }
}

/** Tell the business. Best effort. */
export async function notifyRequestUpdated(
  supabase: Admin,
  opts: { quoteId: string; tenantId: string; mainServiceId: string; customerName: string; changedServiceName: string; change: 'added' | 'removed'; pricing: CombinedPricing; status: string; isTest?: boolean }
): Promise<boolean> {
  try {
    if (!isPostmarkConfigured()) return false
    // null for the demo business, which emails no one
    const to = await resolveBusinessEmail(supabase, opts.tenantId)
    if (!to) return false
    const [{ data: tenant }, { data: service }] = await Promise.all([
      supabase.from('tenants').select('region').eq('id', opts.tenantId).single(),
      supabase.from('services').select('name').eq('id', opts.mainServiceId).single(),
    ])
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const awaitingApproval = opts.status === 'pending_review'
    const approveUrl = awaitingApproval ? await issueApprovalLink(supabase, { quoteId: opts.quoteId, tenantId: opts.tenantId, appUrl }) : undefined
    const { subject, html } = requestUpdatedEmail({
      customerName: opts.customerName,
      mainServiceName: (service as { name?: string } | null)?.name ?? 'Service',
      changedServiceName: opts.changedServiceName,
      change: opts.change,
      pricing: opts.pricing,
      locale: getRegion((tenant as { region?: string | null } | null)?.region).locale,
      awaitingApproval,
      dashboardUrl: `${appUrl}/app/quotes/${opts.quoteId}`,
      approveUrl,
      isTest: opts.isTest,
    })
    const result = await sendEmail({ from: { kind: 'business' }, to, subject, htmlBody: html, tag: 'request-updated' })
    return result.success
  } catch (error) {
    console.error(`[Sections] Request-updated email error for ${opts.quoteId}: ${error instanceof Error ? error.name : 'unknown error'}`)
    return false
  }
}
