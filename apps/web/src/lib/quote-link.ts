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
  quoteLinkFirstVisitAt: string | null
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
  quote_link_first_visit_at: string | null
}
const toTenant = (row: TenantRow | null): QuoteLinkTenant | null =>
  row ? { id: row.id, name: row.name, slug: row.slug, quoteLinkFirstVisitAt: row.quote_link_first_visit_at } : null

export function supabaseQuoteLinkStore(supabase: Admin): QuoteLinkStore {
  const tenantCols = 'id, name, slug, quote_link_first_visit_at'
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

/** Record the first visit to a tenant's quote page (once; later visits are no-ops). */
export async function markFirstVisit(supabase: Admin, tenantId: string): Promise<void> {
  await supabase
    .from('tenants')
    .update({ quote_link_first_visit_at: new Date().toISOString() })
    .eq('id', tenantId)
    .is('quote_link_first_visit_at', null)
}

export { quoteLinkUrl } from '@/lib/quote-link-url'
