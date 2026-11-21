/**
 * T-196: the web app's side of the phone's notifications.
 *
 * The rule (who is told, what a notification may say, one per event) is the
 * shared one, packages/shared/src/push.ts; the worker gives it the same
 * store over its own client. This file is the database behind it and the
 * three switches' reads and writes.
 *
 * `notifyPhones` is called beside each email the business gets for the three
 * events. It never throws and never waits longer than the shared time-out.
 */
import {
  DEFAULT_PUSH_PREFS,
  PUSH_PREF_COLUMNS,
  PUSH_TIMEOUT_MS,
  getRegion,
  sendBusinessPush,
  type PushDevice,
  type PushEvent,
  type PushPrefs,
  type PushQuoteFacts,
  type PushResult,
  type PushStore,
} from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null))

export interface PushDeviceRow {
  token: string
  platform: string | null
  notify_new_request: boolean | null
  notify_accepted: boolean | null
  notify_question: boolean | null
  last_ticket_id?: string | null
}

export const PUSH_DEVICE_COLUMNS = 'token, platform, notify_new_request, notify_accepted, notify_question, last_ticket_id'

/** The three switches of a row; a missing value is "on" */
export function prefsOfRow(row: Partial<PushDeviceRow> | null | undefined): PushPrefs {
  return {
    newRequest: row?.notify_new_request !== false,
    accepted: row?.notify_accepted !== false,
    question: row?.notify_question !== false,
  }
}

/** The switches as the table's columns */
export function prefColumns(prefs: Partial<PushPrefs>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const key of Object.keys(PUSH_PREF_COLUMNS) as Array<keyof PushPrefs>) {
    if (typeof prefs[key] === 'boolean') out[PUSH_PREF_COLUMNS[key]] = prefs[key] as boolean
  }
  return out
}

export function pushStore(supabase: Admin): PushStore {
  return {
    async quote(quoteId): Promise<PushQuoteFacts | null> {
      const { data } = await supabase
        .from('quotes')
        .select('id, tenant_id, customer_json, pricing_json, is_test, is_demo, tenant:tenants!tenant_id (region, currency, is_demo), service:services!service_id (name), request:quote_requests!quote_request_id (source_json)')
        .eq('id', quoteId)
        .maybeSingle()
      if (!data) return null
      const row = data as unknown as {
        id: string
        tenant_id: string
        customer_json: { name?: string } | null
        pricing_json: { total?: number; currency?: string } | null
        is_test?: boolean | null
        is_demo?: boolean | null
        tenant: unknown
        service: unknown
        request: unknown
      }
      const tenant = one(row.tenant as { region?: string | null; currency?: string | null; is_demo?: boolean | null } | null)
      const region = getRegion(tenant?.region)
      return {
        quoteId: row.id,
        tenantId: row.tenant_id,
        customerName: row.customer_json?.name ?? null,
        serviceName: one(row.service as { name?: string } | null)?.name ?? null,
        total: row.pricing_json?.total ?? null,
        currency: row.pricing_json?.currency || tenant?.currency || region.currency,
        locale: region.locale,
        isTest: row.is_test === true,
        isDemo: row.is_demo === true || tenant?.is_demo === true,
        requestSource: one(row.request as { source_json?: unknown } | null)?.source_json ?? null,
      }
    },
    async devices(tenantId): Promise<PushDevice[]> {
      const { data } = await supabase.from('push_devices').select(PUSH_DEVICE_COLUMNS).eq('tenant_id', tenantId).limit(500)
      return ((data ?? []) as unknown as PushDeviceRow[]).map((row) => ({ token: row.token, platform: row.platform, prefs: prefsOfRow(row), lastTicketId: row.last_ticket_id ?? null }))
    },
    async claim(tenantId, quoteId, eventKey): Promise<boolean> {
      const { error } = await supabase.from('push_events').insert({ tenant_id: tenantId, quote_id: quoteId, event_key: eventKey })
      // a second claim of the same event meets the primary key: that is the "already sent"
      return !error
    },
    async removeTokens(tokens): Promise<void> {
      if (tokens.length > 0) await supabase.from('push_devices').delete().in('token', tokens)
    },
    async saveTickets(tickets): Promise<void> {
      await Promise.all(tickets.map((t) => supabase.from('push_devices').update({ last_ticket_id: t.ticketId }).eq('token', t.token)))
    },
  }
}

/**
 * Where notifications are posted. Outside production a test can point this
 * at a stand-in (EXPO_PUSH_BASE_URL) to read what would have been sent; in
 * production it is always Expo.
 */
function pushBaseUrl(): string | undefined {
  const override = process.env.EXPO_PUSH_BASE_URL
  return override && process.env.NODE_ENV !== 'production' ? override : undefined
}

/** Tell the business's phones about one event on one quote. Never throws. */
export async function notifyPhones(event: PushEvent, quoteId: string, eventId?: string | null, supabase: Admin = createAdminClient()): Promise<PushResult> {
  return sendBusinessPush(
    {
      store: pushStore(supabase),
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) }),
      baseUrl: pushBaseUrl(),
      accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
      log: (line) => console.log(line),
    },
    event,
    quoteId,
    eventId
  )
}

/** A user's switches: those of any phone of theirs (they are kept the same on all), on when they have none */
export async function userPushPrefs(supabase: Admin, userId: string): Promise<{ prefs: PushPrefs; devices: number }> {
  const { data } = await supabase.from('push_devices').select(PUSH_DEVICE_COLUMNS).eq('user_id', userId).order('updated_at', { ascending: false }).limit(20)
  const rows = (data ?? []) as unknown as PushDeviceRow[]
  return { prefs: rows[0] ? prefsOfRow(rows[0]) : { ...DEFAULT_PUSH_PREFS }, devices: rows.length }
}
