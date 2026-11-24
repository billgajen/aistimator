import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * T-201: which quotes are due the one automatic reminder to the customer. The daily job
 * (/api/cron/lifecycle) asks this and sends one email for each row.
 *
 * A quote is due when all of these are true:
 *  - it was sent before `cutoffIso` (three days ago) and is still waiting for the customer: sent, or
 *    opened and not answered;
 *  - the customer has neither accepted nor declined, and no reminder has gone for it before;
 *  - its link has not expired, and it is not a visitor's demo request (T-153);
 *  - its business has the reminder on (Settings, tenants.customer_reminder_enabled; on by default).
 *
 * The switch is part of the question, not a check afterwards: quotes of a business that has it off
 * are never returned, so they cannot fill the batch and hold back everyone else's. Switched off, it
 * covers every quote not yet reminded, including ones already sent; switched back on, those that are
 * still waiting and not expired are reminded at the next daily run.
 */
export const REMINDER_STATUSES = ['sent', 'viewed'] as const
export const REMINDER_BATCH_SIZE = 50

export interface ReminderWindow {
  /** Now: a quote whose link has run out is not reminded */
  nowIso: string
  /** Quotes sent before this are due */
  cutoffIso: string
}

/** One quote due a reminder, as the daily job reads it */
export interface DueReminder {
  id: string
  customer_json: unknown
  pricing_json: unknown
  sent_at: string
  tenants: unknown
  services: unknown
}

export async function dueReminders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client is not typed with the schema
  supabase: SupabaseClient<any, any, any>,
  window: ReminderWindow,
  /** `tenantIds` narrows the question to those businesses: a check looking at its own, never the daily job */
  options: { limit?: number; tenantIds?: string[] } = {}
): Promise<{ data: DueReminder[] | null; error: { message: string } | null }> {
  let query = supabase
    .from('quotes')
    .select(
      `
        id, customer_json, pricing_json, sent_at,
        tenants!tenant_id!inner ( id, name, region, currency, branding_json, customer_reminder_enabled ),
        services!service_id ( id, name )
      `
    )
    .in('status', [...REMINDER_STATUSES])
    .eq('tenants.customer_reminder_enabled', true)
    // T-153: a demo quote is never reminded
    .eq('is_demo', false)
    .is('reminder_sent_at', null)
    .is('accepted_at', null)
    .is('declined_at', null)
    .not('sent_at', 'is', null)
    .lt('sent_at', window.cutoffIso)
    .gt('token_expires_at', window.nowIso)
    .limit(options.limit ?? REMINDER_BATCH_SIZE)
  if (options.tenantIds) query = query.in('tenant_id', options.tenantIds)
  const { data, error } = await query
  return { data: (data as DueReminder[] | null) ?? null, error: error ? { message: error.message } : null }
}
