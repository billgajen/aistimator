/**
 * T-196: what "Won through Qolumns" needs from the database.
 *
 * The rule is the shared one (packages/shared/src/won.ts). This reads the two
 * things it asks for that Home had not loaded before: whether the business
 * has ever had an estimate accepted (any kind, and from a customer's own
 * request), and the business's time zone.
 */
import { BUSINESS_REQUEST_SOURCES, getRegion, isTimeZone, monthStart, wonLines, wonSummary, type WonInput, type WonLines, type WonRow, type WonSummary } from '@qolumns/shared'
import type { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

/** The statuses of an estimate the customer accepted */
const ACCEPTED = ['accepted', 'paid']

/**
 * A request the customer made themselves, as a filter on the joined request
 * row. Written from the shared list of the business's own sources, so the
 * database and `isMadeByBusiness` cannot disagree.
 */
export function customerMadeFilter(): string {
  return `source_json->>type.is.null,source_json->>type.not.in.(${BUSINESS_REQUEST_SOURCES.join(',')})`
}

/** The business's time zone: its own once known, its region's until then */
export function businessTimeZone(tenant: { time_zone?: string | null; region?: string | null } | null | undefined): string {
  return isTimeZone(tenant?.time_zone) ? tenant.time_zone : getRegion(tenant?.region).timeZone
}

/** How many estimates were ever accepted: of any kind, and from customers' own requests. Setup tests left out. */
export async function everAccepted(supabase: Client, tenantId: string): Promise<WonInput['everAccepted']> {
  const [any, fromCustomers] = await Promise.all([
    supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_test', false).in('status', ACCEPTED),
    supabase
      .from('quotes')
      .select('id, quote_requests!quote_request_id!inner (id)', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_test', false)
      .in('status', ACCEPTED)
      .or(customerMadeFilter(), { referencedTable: 'quote_requests' }),
  ])
  return { any: any.count ?? 0, fromCustomers: fromCustomers.count ?? 0 }
}

/** The earliest moment the panel reads: the start of last month, in the business's time zone */
export function wonReadsFrom(now: Date, timeZone: string): Date {
  return monthStart(now, timeZone, 1)
}

/**
 * The panel for a screen that has not loaded the month's quotes itself (the
 * phone app's home tab). Home passes its own rows to `wonSummary` instead.
 * Null when nothing shows. Never throws: the line is a courtesy.
 */
export async function loadWonLines(
  supabase: Client,
  tenantId: string,
  tenant: { time_zone?: string | null; region?: string | null; currency?: string | null }
): Promise<{ summary: WonSummary; lines: WonLines } | null> {
  try {
    const ever = await everAccepted(supabase, tenantId)
    if (ever.any <= 0) return null
    const now = new Date()
    const timeZone = businessTimeZone(tenant)
    const from = wonReadsFrom(now, timeZone).toISOString()
    const thisMonth = monthStart(now, timeZone).toISOString()
    const { data } = await supabase
      .from('quotes')
      .select('status, created_at, sent_at, viewed_at, accepted_at, pricing_json, is_test, quote_requests!quote_request_id (source_type:source_json->>type)')
      .eq('tenant_id', tenantId)
      .eq('is_test', false)
      .or([`accepted_at.gte.${from}`, ...['created_at', 'sent_at', 'viewed_at'].map((column) => `${column}.gte.${thisMonth}`)].join(','))
    const rows: WonRow[] = ((data ?? []) as unknown as Array<WonRow & { quote_requests?: { source_type?: string | null } | Array<{ source_type?: string | null }> | null }>).map((q) => ({
      ...q,
      source: (Array.isArray(q.quote_requests) ? q.quote_requests[0] : q.quote_requests)?.source_type ?? null,
    }))
    const summary = wonSummary(rows, { now, timeZone, everAccepted: ever })
    if (!summary) return null
    const region = getRegion(tenant.region)
    return { summary, lines: wonLines(summary, tenant.currency || region.currency, region.locale) }
  } catch (error) {
    console.error('[Won] could not be worked out:', error instanceof Error ? error.name : 'unknown error')
    return null
  }
}

/**
 * Keep the business's time zone the first time a screen reports it. Written
 * once: a business that travels does not move its month. Never throws.
 */
export async function rememberTimeZone(tenantId: string, current: string | null | undefined, reported: unknown): Promise<boolean> {
  if (isTimeZone(current) || !isTimeZone(reported)) return false
  try {
    const { error } = await createAdminClient().from('tenants').update({ time_zone: reported }).eq('id', tenantId).is('time_zone', null)
    return !error
  } catch {
    return false
  }
}
