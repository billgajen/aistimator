/**
 * T-189: the worker's side of the owner's alerts (packages/shared/src/ops-alerts.ts
 * has the rules: three kinds, one email per kind per hour, off without ALERT_EMAIL).
 *
 * Nothing here ever throws or delays a quote's own outcome: an alert is sent
 * after the quote has been dealt with, and a fault in sending one is a log line.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AI_BUSY_LOOK_BACK_MINUTES,
  AI_BUSY_WINDOW_MINUTES,
  QUEUE_LOOK_BACK_HOURS,
  QUEUE_WAIT_MINUTES,
  busyAlertDue,
  countBusy,
  raiseOpsAlert,
  stillWaiting,
  type BusyCount,
  type BusyRow,
  type OpsAlert,
  type OpsAlertKind,
  type OpsAlertOutcome,
} from '@qolumns/shared'
import { sendEmail } from './email/postmark'

export interface OpsAlertEnv {
  /** The owner's alert address. Not set: alerts are off. */
  ALERT_EMAIL?: string
  POSTMARK_API_TOKEN?: string
  POSTMARK_FROM_EMAIL?: string
  APP_URL?: string
  ENVIRONMENT?: string
}

type Send = typeof sendEmail

/** Email the owner about a fault, at most once per kind per hour. Never throws. */
export async function sendOpsAlert(
  supabase: SupabaseClient | null,
  env: OpsAlertEnv,
  alert: OpsAlert,
  send: Send = sendEmail,
  memory?: Map<OpsAlertKind, number>
): Promise<OpsAlertOutcome> {
  const apiToken = env.POSTMARK_API_TOKEN
  const fromEmail = env.POSTMARK_FROM_EMAIL
  // no way to send: the same as off
  if (!apiToken || !fromEmail) return 'off'
  const outcome = await raiseOpsAlert(alert, {
    to: env.ALERT_EMAIL,
    appUrl: env.APP_URL,
    environment: env.ENVIRONMENT,
    memory,
    claim: async (kind, everySeconds) => {
      if (!supabase) return null
      const { data, error } = await supabase.rpc('claim_ops_alert', { p_kind: kind, p_every_seconds: everySeconds })
      const row = (Array.isArray(data) ? data[0] : data) as { send?: boolean; held_back?: number } | null
      if (error || !row || typeof row.send !== 'boolean') return null
      return { send: row.send, heldBack: typeof row.held_back === 'number' ? row.held_back : 0 }
    },
    send: async (email) => {
      const result = await send(
        { apiToken, fromEmail },
        { from: { kind: 'business' }, to: email.to, subject: email.subject, htmlBody: email.html, textBody: email.text, tag: 'ops-alert' }
      )
      return result.success
    },
  })
  if (outcome !== 'off') console.log(`[Alert] ${alert.kind}: ${outcome}`)
  return outcome
}

const WATCH = 'queue_watch'

/**
 * The queue check, run on a timer. A request counts as waiting when it has
 * been queued or in progress for more than QUEUE_WAIT_MINUTES (and arrived in
 * the last QUEUE_LOOK_BACK_HOURS), AND the previous check saw it waiting too:
 * a request being priced again after an answer is "queued" for a few seconds
 * and must not raise an alarm. What this check saw is kept for the next one.
 */
export async function checkQueue(
  supabase: SupabaseClient,
  env: OpsAlertEnv,
  now: Date = new Date(),
  send: Send = sendEmail
): Promise<{ waiting: number; stuck: number; alert: OpsAlertOutcome | 'none' }> {
  const before = new Date(now.getTime() - QUEUE_WAIT_MINUTES * 60_000).toISOString()
  const after = new Date(now.getTime() - QUEUE_LOOK_BACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('quotes')
    .select('id, created_at')
    .in('status', ['queued', 'generating'])
    .lt('created_at', before)
    .gt('created_at', after)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) throw new Error('the waiting requests could not be read')
  const rows = (data ?? []) as Array<{ id: string; created_at: string }>
  const ids = rows.map((r) => r.id)

  const { data: watch } = await supabase.from('ops_alerts').select('seen').eq('kind', WATCH).maybeSingle()
  const stuck = stillWaiting((watch as { seen?: unknown } | null)?.seen, ids)
  await supabase.from('ops_alerts').upsert({ kind: WATCH, seen: ids, last_sent_at: now.toISOString() }, { onConflict: 'kind' })

  if (stuck.length === 0) return { waiting: ids.length, stuck: 0, alert: 'none' }
  const oldest = rows.find((r) => stuck.includes(r.id))
  const alert = await sendOpsAlert(
    supabase,
    env,
    {
      kind: 'queue_backed_up',
      details: {
        Waiting: stuck.length,
        ...(oldest && { 'Oldest, in minutes': Math.round((now.getTime() - new Date(oldest.created_at).getTime()) / 60_000) }),
        ...(oldest && { 'Oldest quote': oldest.id }),
      },
    },
    send
  )
  return { waiting: ids.length, stuck: stuck.length, alert }
}

/**
 * T-203: the second half of the 5-minute check. It adds up the busy retries
 * and overflow calls of the last window from what each quote stored (its
 * timings, or its busy note while it waits), and emails the owner once when a
 * threshold is passed (at most one `ai_busy` email an hour, like every kind).
 * The email carries the counts and nothing else. It never throws: a count
 * that cannot be read is "nothing to report".
 */
export async function checkBusy(
  supabase: SupabaseClient,
  env: OpsAlertEnv,
  now: Date = new Date(),
  send: Send = sendEmail
): Promise<{ count: BusyCount; alert: OpsAlertOutcome | 'none' }> {
  const none: BusyCount = { busyRetries: 0, overflowCalls: 0, requeued: 0, quotes: 0 }
  try {
    const after = new Date(now.getTime() - AI_BUSY_LOOK_BACK_MINUTES * 60_000).toISOString()
    const { data, error } = await supabase
      .from('quotes')
      .select('timings:pricing_trace_json->timings, busy:content_json->busy')
      .gt('created_at', after)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error) return { count: none, alert: 'none' }
    const count = countBusy((data ?? []) as BusyRow[], now.getTime() - AI_BUSY_WINDOW_MINUTES * 60_000, now.getTime())
    if (!busyAlertDue(count)) return { count, alert: 'none' }
    const alert = await sendOpsAlert(
      supabase,
      env,
      {
        kind: 'ai_busy',
        details: {
          'Busy retries': count.busyRetries,
          'Calls sent to the overflow provider': count.overflowCalls,
          'Requests put back to wait': count.requeued,
          'Requests that met any of it': count.quotes,
          'Minutes counted': AI_BUSY_WINDOW_MINUTES,
        },
      },
      send
    )
    return { count, alert }
  } catch {
    return { count: none, alert: 'none' }
  }
}

