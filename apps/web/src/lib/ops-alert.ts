/**
 * T-189: the web app's side of the owner's alerts (the rules are in
 * packages/shared/src/ops-alerts.ts). The web app raises one kind: it could
 * not hand a request to the worker. Off without ALERT_EMAIL. Never throws.
 */
import { raiseOpsAlert, type OpsAlert, type OpsAlertOutcome } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { isPostmarkConfigured, sendEmail } from '@/lib/postmark'

type Admin = ReturnType<typeof createAdminClient>

export async function sendOpsAlert(supabase: Admin, alert: OpsAlert, env: Record<string, string | undefined> = process.env): Promise<OpsAlertOutcome> {
  if (!isPostmarkConfigured()) return 'off'
  const outcome = await raiseOpsAlert(alert, {
    to: env.ALERT_EMAIL,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    claim: async (kind, everySeconds) => {
      const { data, error } = await supabase.rpc('claim_ops_alert', { p_kind: kind, p_every_seconds: everySeconds })
      const row = (Array.isArray(data) ? data[0] : data) as { send?: boolean; held_back?: number } | null
      if (error || !row || typeof row.send !== 'boolean') return null
      return { send: row.send, heldBack: typeof row.held_back === 'number' ? row.held_back : 0 }
    },
    send: async (email) => {
      const result = await sendEmail({ from: { kind: 'business' }, to: email.to, subject: email.subject, htmlBody: email.html, textBody: email.text, tag: 'ops-alert' })
      return result.success
    },
  })
  if (outcome !== 'off') console.log(`[Alert] ${alert.kind}: ${outcome}`)
  return outcome
}
