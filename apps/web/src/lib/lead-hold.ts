/**
 * Over-limit lead capture (T-134, AD-026). With overage off, a request beyond
 * the plan's monthly limit is still saved — as an unpriced lead the business
 * can price after upgrading — and the customer is told the estimate is coming.
 * The AI pipeline does not run, so a held lead costs nothing to keep.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, isPostmarkConfigured } from './postmark'
import { generateLeadHeldEmailHtml } from './email-templates'

/** Customer-facing message for a held lead (never mentions billing). */
export function leadHeldMessage(businessName: string): string {
  return `Thanks — ${businessName} has your request and will send your estimate shortly.`
}

/** content_json for a held lead; `limitHold` is the flag the dashboard and /process read. */
export function leadHoldContent(businessName: string): Record<string, unknown> {
  return {
    limitHold: true,
    title: 'Estimate on its way',
    intro: leadHeldMessage(businessName),
  }
}

/** Email the business about a held lead. Never throws — capture must not depend on email. */
export async function notifyLeadHeld(
  supabase: SupabaseClient,
  opts: { tenantId: string; businessName: string; customerName: string; serviceName: string; quoteId: string; used: number; limit: number }
): Promise<void> {
  try {
    if (!isPostmarkConfigured()) return
    const { data: tenant } = await supabase.from('tenants').select('notification_email').eq('id', opts.tenantId).single()
    let to = (tenant as { notification_email?: string | null } | null)?.notification_email ?? null
    if (!to) {
      const { data: owner } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('tenant_id', opts.tenantId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      if (owner?.id) to = (await supabase.auth.admin.getUserById(owner.id)).data?.user?.email ?? null
    }
    if (!to) return
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    await sendEmail({
      to,
      subject: `New lead waiting: ${opts.customerName} — upgrade to price it instantly`,
      htmlBody: generateLeadHeldEmailHtml({
        businessName: opts.businessName,
        customerName: opts.customerName,
        serviceName: opts.serviceName,
        used: opts.used,
        limit: opts.limit,
        billingUrl: `${appUrl}/app/billing`,
        quoteUrl: `${appUrl}/app/quotes/${opts.quoteId}`,
      }),
      tag: 'lead-held',
    })
  } catch (error) {
    console.error('[LeadHold] Failed to notify business:', error)
  }
}
