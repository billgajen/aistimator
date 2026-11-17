/**
 * T-175: the daily look at WhatsApp connections that are close to running out.
 *
 * A connection made through Meta's Embedded Signup holds a token that lasts 60
 * days. Each day, for every connection with 30 days or less left:
 *   1. ask Meta for a fresh token. Meta documents the call for this kind of
 *      token's family; if it gives a later expiry, that is stored and nothing
 *      else happens;
 *   2. if Meta did not renew it and fewer than 14 days are left (or it has run
 *      out), email the business: one click on the WhatsApp page reconnects it.
 *      At most one email every 6 days.
 *
 * Addresses and tokens are never logged.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { renewStoredToken } from '@/lib/whatsapp-connect'
import { TOKEN_RENEW_DAYS, TOKEN_WARN_DAYS, daysUntil } from '@/lib/whatsapp-state'
import { resolveBusinessEmail } from '@/lib/business-email'
import { sendEmail, isPostmarkConfigured } from '@/lib/postmark'
import { generateWhatsAppRenewalEmailHtml } from '@/lib/email-templates'

type Admin = ReturnType<typeof createAdminClient>

const WARN_EVERY_DAYS = 6
/** A connection that ran out longer ago than this is no longer chased */
const STOP_WARNING_AFTER_DAYS = 14

export interface RenewalSummary {
  checked: number
  renewed: number
  warned: number
}

interface Row {
  tenant_id: string
  display_phone_number: string
  token_expires_at: string
  expiry_warned_at: string | null
}

export async function checkWhatsAppTokens(admin: Admin, now = new Date()): Promise<RenewalSummary> {
  const summary: RenewalSummary = { checked: 0, renewed: 0, warned: 0 }
  const horizon = new Date(now.getTime() + TOKEN_RENEW_DAYS * 86_400_000).toISOString()
  const { data } = await admin
    .from('whatsapp_configs')
    .select('tenant_id, display_phone_number, token_expires_at, expiry_warned_at')
    .eq('connection_method', 'embedded')
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', horizon)
    .limit(200)

  for (const row of (data ?? []) as Row[]) {
    summary.checked++
    const days = daysUntil(row.token_expires_at, now)
    if (days === null) continue
    const expired = new Date(row.token_expires_at).getTime() <= now.getTime()

    // an expired token cannot be exchanged
    if (!expired && (await renewStoredToken(admin, row.tenant_id))) {
      summary.renewed++
      continue
    }

    if (days >= TOKEN_WARN_DAYS || days < -STOP_WARNING_AFTER_DAYS) continue
    const lastWarned = row.expiry_warned_at ? new Date(row.expiry_warned_at).getTime() : 0
    if (now.getTime() - lastWarned < WARN_EVERY_DAYS * 86_400_000) continue
    if (!isPostmarkConfigured()) continue

    const to = await resolveBusinessEmail(admin, row.tenant_id)
    if (!to) continue
    const { data: tenant } = await admin.from('tenants').select('name').eq('id', row.tenant_id).single()
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
    const result = await sendEmail({
      from: { kind: 'business' },
      to,
      subject: expired ? 'Your WhatsApp connection has run out' : 'Reconnect WhatsApp before it runs out',
      htmlBody: generateWhatsAppRenewalEmailHtml({
        businessName: (tenant as { name?: string } | null)?.name || 'Your business',
        displayPhoneNumber: row.display_phone_number,
        daysLeft: days,
        expiresOn: new Date(row.token_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        whatsappUrl: `${appUrl}/app/whatsapp`,
      }),
      tag: 'whatsapp-renewal',
    })
    if (result.success) {
      summary.warned++
      await admin.from('whatsapp_configs').update({ expiry_warned_at: now.toISOString() }).eq('tenant_id', row.tenant_id)
    }
  }
  return summary
}
