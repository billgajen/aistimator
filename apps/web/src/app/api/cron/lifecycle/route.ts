import { createAdminClient } from '@/lib/supabase/server'
import { formatMoney, resolveRegionContext } from '@estimator/shared'
import { NextResponse } from 'next/server'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { sendEmail, isPostmarkConfigured } from '@/lib/postmark'
import { generateQuoteReminderEmailHtml } from '@/lib/email-templates'
import type { QuotePricing, TenantBranding } from '@estimator/shared'

/**
 * GET /api/cron/lifecycle — Vercel Cron (daily, see vercel.json)
 *
 * 1. Expire: quotes still awaiting a decision whose link has expired are
 *    flipped to 'expired' so dashboards and analytics reflect reality.
 * 2. Remind: one follow-up email per quote, REMINDER_AFTER_DAYS (default 3)
 *    days after sending, if the customer has neither accepted nor declined.
 *    The token is rotated (we never store the raw token), so the reminder
 *    link supersedes the original email's link.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically.
 * Fails closed if CRON_SECRET is unset.
 */

export const maxDuration = 60

const AWAITING_DECISION = ['sent', 'viewed', 'feedback_received', 'revised']
const REMINDER_STATUSES = ['sent', 'viewed']
const REMINDER_BATCH_SIZE = 50

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[Lifecycle] CRON_SECRET not configured — refusing to run')
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'CRON_SECRET is not set' } },
      { status: 503 }
    )
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } },
      { status: 401 }
    )
  }

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  // ---- 1. Expire stale quotes -------------------------------------------
  const { data: expiredRows, error: expireError } = await supabase
    .from('quotes')
    .update({ status: 'expired' })
    .in('status', AWAITING_DECISION)
    .lt('token_expires_at', nowIso)
    .select('id')

  if (expireError) {
    console.error('[Lifecycle] Expire pass failed:', expireError)
  }
  const expiredCount = expiredRows?.length ?? 0

  // ---- 2. Send follow-up reminders --------------------------------------
  let remindersSent = 0
  let remindersFailed = 0

  if (!isPostmarkConfigured()) {
    console.warn('[Lifecycle] Postmark not configured — skipping reminder pass')
  } else {
    const reminderDays = parseInt(process.env.REMINDER_AFTER_DAYS || '3', 10)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - (Number.isFinite(reminderDays) ? reminderDays : 3))

    const { data: candidates, error: candidatesError } = await supabase
      .from('quotes')
      .select(`
        id, customer_json, pricing_json, sent_at,
        tenants!tenant_id ( id, name, region, currency, branding_json ),
        services!service_id ( id, name )
      `)
      .in('status', REMINDER_STATUSES)
      .is('reminder_sent_at', null)
      .is('accepted_at', null)
      .is('declined_at', null)
      .not('sent_at', 'is', null)
      .lt('sent_at', cutoff.toISOString())
      .gt('token_expires_at', nowIso)
      .limit(REMINDER_BATCH_SIZE)

    if (candidatesError) {
      console.error('[Lifecycle] Reminder candidate query failed:', candidatesError)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    for (const row of candidates || []) {
      try {
        const customer = row.customer_json as { name: string; email: string } | null
        if (!customer?.email) continue

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tenantRaw = row.tenants as any
        const tenant = (Array.isArray(tenantRaw) ? tenantRaw[0] : tenantRaw) as {
          id: string; name: string; region?: string | null; currency?: string | null; branding_json: TenantBranding | null
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceRaw = row.services as any
        const service = (Array.isArray(serviceRaw) ? serviceRaw[0] : serviceRaw) as { id: string; name: string }
        const pricing = row.pricing_json as QuotePricing | null

        // Rotate the token (raw tokens are never stored). Mark the reminder
        // BEFORE sending so a crash can't cause duplicate reminders.
        const { token, hash } = generateQuoteToken()
        const { error: markError } = await supabase
          .from('quotes')
          .update({
            quote_token_hash: hash,
            token_expires_at: getTokenExpiry().toISOString(),
            reminder_sent_at: new Date().toISOString(),
          })
          .eq('id', row.id)
          .is('reminder_sent_at', null)

        if (markError) {
          console.error(`[Lifecycle] Failed to mark reminder for quote:`, markError)
          remindersFailed++
          continue
        }

        const totalFormatted = pricing
          ? (() => {
              // T-133: tenant region decides locale + currency fallback
              const regionCtx = resolveRegionContext(tenant ?? {})
              return formatMoney(pricing.total, pricing.currency || regionCtx.currency, regionCtx.locale)
            })()
          : ''

        const htmlBody = generateQuoteReminderEmailHtml({
          businessName: tenant?.name || 'the business',
          customerName: customer.name || 'there',
          serviceName: service?.name || 'your project',
          totalFormatted,
          quoteViewUrl: `${appUrl}/q/${row.id}?token=${token}`,
          primaryColor: tenant?.branding_json?.primaryColor,
        })

        const result = await sendEmail({
          to: customer.email,
          subject: `Reminder: your quote from ${tenant?.name || 'us'} is ready`,
          htmlBody,
          tag: 'quote-reminder',
        })

        if (result.success) {
          remindersSent++
        } else {
          remindersFailed++
          console.error('[Lifecycle] Reminder email failed:', result.error)
        }
      } catch (rowError) {
        remindersFailed++
        console.error('[Lifecycle] Reminder failed for a quote:', rowError)
      }
    }
  }

  console.log(
    `[Lifecycle] Done: expired=${expiredCount} remindersSent=${remindersSent} remindersFailed=${remindersFailed}`
  )
  return NextResponse.json({ expired: expiredCount, remindersSent, remindersFailed })
}
