/**
 * T-198: what "Ask Qolumns" is told about the business that is asking
 * (server only): its plan and quotes used, its services, whether its prices
 * are checked, its link shared, WhatsApp connected, its branding set, its
 * region and currency.
 *
 * Read through the business's own signed-in client, so the database's rules
 * decide what comes back (the WhatsApp connection is the one row only the
 * server may read; it is asked for by this business's id). The page comes
 * from the browser and is kept only when it is a dashboard path.
 *
 * Every part is optional: one that cannot be read is left out, and the
 * assistant answers without it. Nothing here throws. No customer is read.
 */
import { EMPTY_HELP_STATE, getRegion, type HelpState } from '@qolumns/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkPlanLimit } from '@/lib/plan-limits'
import { loadAccess } from '@/lib/access'
import { hasCustomBranding, quoteLinkShared } from '@/lib/setup-checklist'
import { planName } from '@/lib/support'

type Db = SupabaseClient

/** A dashboard path, without its query: "/app/quotes/abc". Anything else is not kept. */
export function dashboardPath(page: unknown): string | null {
  if (typeof page !== 'string') return null
  const path = page.split('?')[0]!.split('#')[0]!.trim()
  return /^\/app(?:\/[A-Za-z0-9_\-[\]]+)*$/.test(path) && path.length <= 120 ? path : null
}

const attempt = async <T>(read: () => PromiseLike<T>): Promise<T | null> => {
  try {
    return await read()
  } catch {
    return null
  }
}

export async function loadHelpState(
  supabase: Db,
  tenantId: string,
  page: unknown,
  /** Whether this business has a WhatsApp number connected; read by the server, since the row is not the business's to read */
  whatsappConnected: () => Promise<boolean | null> = async () => null
): Promise<HelpState> {
  const state: HelpState = { ...EMPTY_HELP_STATE, page: dashboardPath(page) }
  const [tenant, services, limit, plan, request, whatsapp] = await Promise.all([
    attempt(() => supabase.from('tenants').select('region, currency, branding_json, prices_checked_at, quote_link_copied_at, quote_link_first_visit_at').eq('id', tenantId).maybeSingle()),
    attempt(() => supabase.from('services').select('name, active').eq('tenant_id', tenantId).order('name').limit(50)),
    attempt(() => checkPlanLimit(supabase, tenantId)),
    attempt(() => planName(supabase, tenantId)),
    // a customer's own request: not a setup test, not a quote the business made in its app (Home's rule)
    attempt(() =>
      supabase
        .from('quotes')
        .select('id, quote_requests!quote_request_id!inner (id)')
        .eq('tenant_id', tenantId)
        .eq('is_test', false)
        .or('source_json->>type.is.null,source_json->>type.neq.app', { referencedTable: 'quote_requests' })
        .limit(1)
    ),
    attempt(whatsappConnected),
  ])

  const row = (tenant && !tenant.error ? tenant.data : null) as {
    region?: string | null
    currency?: string | null
    branding_json?: unknown
    prices_checked_at?: string | null
    quote_link_copied_at?: string | null
    quote_link_first_visit_at?: string | null
  } | null
  if (row) {
    state.region = row.region ? getRegion(row.region).code : null
    state.currency = row.currency ?? null
    state.brandingSet = hasCustomBranding(row.branding_json)
    state.pricesChecked = Boolean(row.prices_checked_at)
  }
  // T-202: the same rule as Home's checklist (Copy or Share, a tick from before T-202, or a first real request)
  const hasRequest = request && !request.error ? (request.data?.length ?? 0) > 0 : null
  if (row) {
    state.linkShared = quoteLinkShared({
      quoteLinkCopiedAt: row.quote_link_copied_at,
      quoteLinkFirstVisitAt: row.quote_link_first_visit_at,
      hasRealRequest: hasRequest === true,
    })
  } else if (hasRequest === true) {
    state.linkShared = true
  }
  if (services && !services.error) {
    state.services = ((services.data ?? []) as Array<{ name?: string | null; active?: boolean | null }>).map((s) => ({ name: s.name ?? '', active: s.active === true }))
  }
  if (limit) {
    state.quotesUsed = limit.used
    state.quotesAllowed = limit.unlimited ? null : limit.limit
    state.allowancePer = limit.per
  }
  if (plan) state.plan = plan
  // T-199: on the free start the business works like another plan while free quotes are left (the one rule)
  const access = await attempt(() => loadAccess(supabase, tenantId))
  if (access?.basis === 'free_start' && access.plan && access.freeLeft !== null) state.freeStart = { plan: access.plan.name, left: access.freeLeft }
  if (hasRequest !== null) state.hasRequest = hasRequest
  if (typeof whatsapp === 'boolean') state.whatsappConnected = whatsapp
  return state
}
