/**
 * T-201: what the worker's emails to a customer carry of the business and of
 * us: the business's logo (when it has one) and whether "Powered by" shows.
 *
 * `loadAccess` is the worker's ONLY reader of the one access rule
 * (`businessAccess`, @qolumns/shared access.ts), the same three rows the web
 * app's loader reads (apps/web/src/lib/access.ts). "Powered by" is that
 * rule's `no_badge`, which is what the estimate page asks, so the email and
 * the page it links to agree: gone on a plan that removes the badge (a
 * payment being retried included) and on the free start, shown otherwise.
 * A read that fails shows the line, as on the page.
 *
 * The HTML is in @qolumns/shared (customer-email.ts), shared with the web
 * app's emails.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NO_ACCESS, businessAccess, businessLogoUrl, canUse, freeQuotesUsed } from '@qolumns/shared'
import type { BusinessAccess, CustomerEmailBrand, UsageRow } from '@qolumns/shared'

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
      quotesUsed: freeQuotesUsed((usage.data ?? []) as UsageRow[]),
    })
  } catch {
    return NO_ACCESS
  }
}

export async function customerEmailBrand(db: Db, appUrl: string | null | undefined, tenantId: string, branding: unknown): Promise<CustomerEmailBrand> {
  const logoAssetId = (branding as { logoAssetId?: unknown } | null | undefined)?.logoAssetId
  return {
    logoUrl: businessLogoUrl(appUrl, logoAssetId),
    showPoweredBy: !canUse(await loadAccess(db, tenantId), 'no_badge'),
  }
}
