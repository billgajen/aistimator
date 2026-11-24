/**
 * T-199: what this business can use, read from its rows. The rule itself is
 * `businessAccess` in @qolumns/shared (access.ts); this is the web app's ONLY
 * reader of it. Every gate asks here: the WhatsApp assistant, room scan,
 * on-site quotes, the badge, the business's own address.
 *
 * Any read that fails answers `NO_ACCESS`: a feature that needs a plan stays
 * off rather than run for a business that may not have it. (Pricing a
 * customer's request is not decided here: the quote limit fails open,
 * lib/plan-limits.ts.)
 *
 * Works with the business's own signed-in client (its rows are its own to
 * read) and with the service-role client on public pages.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NO_ACCESS, businessAccess, canUse, freeQuotesUsed, type BusinessAccess, type Capability, type UsageRow } from '@qolumns/shared'

type Db = Pick<SupabaseClient, 'from'>

export async function loadAccess(db: Db, tenantId: string): Promise<BusinessAccess> {
  try {
    const [subscription, usage, tenant] = await Promise.all([
      db.from('subscriptions').select('plan_id, status').eq('tenant_id', tenantId).maybeSingle(),
      db.from('usage_counters').select('estimates_created, plan_estimates_created').eq('tenant_id', tenantId),
      db.from('tenants').select('region').eq('id', tenantId).maybeSingle(),
    ])
    if (subscription.error || usage.error || tenant.error || !tenant.data) return NO_ACCESS
    return businessAccess({
      subscription: subscription.data as { plan_id?: string | null; status?: string | null } | null,
      region: (tenant.data as { region?: string | null }).region,
      // T-201: the free quotes used, by the same count as the quote limit
      quotesUsed: freeQuotesUsed((usage.data ?? []) as UsageRow[]),
    })
  } catch {
    return NO_ACCESS
  }
}

/** One question, one answer: can this business use it now? */
export async function businessCan(db: Db, tenantId: string, capability: Capability): Promise<boolean> {
  return canUse(await loadAccess(db, tenantId), capability)
}
