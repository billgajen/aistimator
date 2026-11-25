/**
 * T-149: resolve /quote/{slug} to a tenant's public widget.
 *
 * A slug only ever resolves to its own tenant: the widget key comes from
 * that tenant's own active site row, looked up by the tenant id the slug
 * belongs to. An old slug (one the business changed away from) redirects to
 * the current one. Anything else, or a tenant with no active site, is 404.
 *
 * The data access is injected so the rules are unit-testable;
 * `supabaseQuoteLinkStore` is the real one (admin client: the page is public).
 */

import type { createAdminClient } from '@/lib/supabase/server'
import { slugProblem } from '@/lib/tenant-slug'

export interface QuoteLinkTenant {
  id: string
  name: string
  slug: string
}

export interface QuoteLinkStore {
  tenantBySlug(slug: string): Promise<QuoteLinkTenant | null>
  /** Tenant id that used to own this slug, if any */
  tenantIdForOldSlug(slug: string): Promise<string | null>
  tenantById(id: string): Promise<QuoteLinkTenant | null>
  /** The tenant's own active widget key, if it has one */
  activeTenantKey(tenantId: string): Promise<string | null>
}

export type QuoteLinkResolution =
  | { kind: 'found'; tenant: QuoteLinkTenant; tenantKey: string }
  | { kind: 'redirect'; slug: string }
  | { kind: 'not_found' }

export async function resolveQuoteLink(store: QuoteLinkStore, rawSlug: string): Promise<QuoteLinkResolution> {
  const slug = rawSlug.trim().toLowerCase()
  // A malformed slug can't exist; skip the lookups (reserved words still look up
  // nothing, since no tenant can hold one)
  const problem = slugProblem(slug)
  if (problem && problem !== 'reserved') return { kind: 'not_found' }

  const tenant = await store.tenantBySlug(slug)
  if (tenant) {
    const tenantKey = await store.activeTenantKey(tenant.id)
    return tenantKey ? { kind: 'found', tenant, tenantKey } : { kind: 'not_found' }
  }

  const formerOwner = await store.tenantIdForOldSlug(slug)
  if (formerOwner) {
    const current = await store.tenantById(formerOwner)
    if (current && current.slug !== slug) return { kind: 'redirect', slug: current.slug }
  }
  return { kind: 'not_found' }
}

type Admin = ReturnType<typeof createAdminClient>

interface TenantRow {
  id: string
  name: string
  slug: string
}
const toTenant = (row: TenantRow | null): QuoteLinkTenant | null => (row ? { id: row.id, name: row.name, slug: row.slug } : null)

export function supabaseQuoteLinkStore(supabase: Admin): QuoteLinkStore {
  const tenantCols = 'id, name, slug'
  return {
    async tenantBySlug(slug) {
      const { data } = await supabase.from('tenants').select(tenantCols).eq('slug', slug).maybeSingle()
      return toTenant(data as TenantRow | null)
    },
    async tenantIdForOldSlug(slug) {
      const { data } = await supabase.from('tenant_slug_history').select('tenant_id').eq('old_slug', slug).maybeSingle()
      return (data as { tenant_id: string } | null)?.tenant_id ?? null
    },
    async tenantById(id) {
      const { data } = await supabase.from('tenants').select(tenantCols).eq('id', id).maybeSingle()
      return toTenant(data as TenantRow | null)
    },
    async activeTenantKey(tenantId) {
      const { data } = await supabase
        .from('tenant_sites')
        .select('tenant_key')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
      return (data?.[0] as { tenant_key: string } | undefined)?.tenant_key ?? null
    },
  }
}

// T-202: a visit to the page is not recorded any more. Opening the link used to
// tick "Share your quote link" (tenants.quote_link_first_visit_at), but a visit
// cannot tell the owner from a customer (on a business's own address no sign-in
// reaches the page). The step is ticked by Copy or Share, or by the first real
// request (lib/setup-checklist.ts). The column is still read there, so a
// business ticked by a visit before T-202 stays ticked; nothing writes it.

export { quoteLinkUrl } from '@/lib/quote-link-url'
