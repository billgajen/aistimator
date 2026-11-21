/**
 * T-196: the worker's side of the phone's notifications.
 *
 * The rule (who is told, what a notification may say, one per event) is the
 * shared one, packages/shared/src/push.ts; the web app gives it the same
 * store over its own client (apps/web/src/lib/push.ts). The worker tells the
 * phones about a new request, beside the email it sends the business.
 *
 * Never throws, and never waits longer than the shared time-out.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { PUSH_TIMEOUT_MS, getRegion, sendBusinessPush, type PushDevice, type PushEvent, type PushQuoteFacts, type PushResult, type PushStore } from '@qolumns/shared'

export interface PushEnv {
  ENVIRONMENT?: string
  /** Expo's optional access token, when the Expo account requires one */
  EXPO_ACCESS_TOKEN?: string
  /** A stand-in for Expo's push service, honoured in development only (a test reads what would be sent) */
  EXPO_PUSH_BASE_URL?: string
}

const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null))

interface DeviceRow {
  token: string
  platform: string | null
  notify_new_request: boolean | null
  notify_accepted: boolean | null
  notify_question: boolean | null
  last_ticket_id: string | null
}

export function pushStore(supabase: Pick<SupabaseClient, 'from'>): PushStore {
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
      const { data } = await supabase
        .from('push_devices')
        .select('token, platform, notify_new_request, notify_accepted, notify_question, last_ticket_id')
        .eq('tenant_id', tenantId)
        .limit(500)
      return ((data ?? []) as unknown as DeviceRow[]).map((row) => ({
        token: row.token,
        platform: row.platform,
        prefs: { newRequest: row.notify_new_request !== false, accepted: row.notify_accepted !== false, question: row.notify_question !== false },
        lastTicketId: row.last_ticket_id ?? null,
      }))
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

/** Tell the business's phones about one event on one quote. Never throws. */
export async function notifyPhones(
  supabase: Pick<SupabaseClient, 'from'>,
  env: PushEnv,
  event: PushEvent,
  quoteId: string,
  doFetch: typeof fetch = fetch
): Promise<PushResult> {
  return sendBusinessPush(
    {
      store: pushStore(supabase),
      fetch: (input, init) => doFetch(input, { ...init, signal: AbortSignal.timeout(PUSH_TIMEOUT_MS) }),
      baseUrl: env.ENVIRONMENT === 'development' ? env.EXPO_PUSH_BASE_URL || undefined : undefined,
      accessToken: env.EXPO_ACCESS_TOKEN || undefined,
      log: (line) => console.log(line),
    },
    event,
    quoteId
  )
}
