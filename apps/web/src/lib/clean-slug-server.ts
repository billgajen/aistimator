/**
 * T-174: cleaner quote links — the database side.
 *
 * - `hasRandomLink`: the business is still on the link it was generated with,
 *   ending in random characters. Replacing that link is free: it does not use
 *   up the business's one change. It is free once: after any replacement the
 *   old link is in tenant_slug_history, so the link is no longer "random"
 *   whatever it looks like.
 * - `cleanSlugOptions`: up to three clean links built from the business's own
 *   stored details, each checked free (not reserved, not another business's,
 *   not a link anyone used to have).
 *
 * Service role only: tenant_slug_history and reserved_slugs are not readable
 * by a signed-in user. Every query is scoped to the caller's own tenant id.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { CLEAN_SLUG_OFFERS, cleanSlugCandidates, endsInGeneratedCharacters } from '@/lib/clean-slug'

type Admin = ReturnType<typeof createAdminClient>

export interface SlugTenant {
  id: string
  name: string
  slug: string
  slug_changed_at: string | null
}

export async function hasRandomLink(admin: Admin, tenant: SlugTenant): Promise<boolean> {
  if (tenant.slug_changed_at || !endsInGeneratedCharacters(tenant.slug, tenant.name)) return false
  const { count, error } = await admin
    .from('tenant_slug_history')
    .select('old_slug', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
  // unknown is "not random": the free replacement is never given on a failed read
  return !error && count === 0
}

/** The candidates that are free, in the order given */
export async function freeSlugs(admin: Admin, candidates: readonly string[], tenantId: string): Promise<string[]> {
  if (candidates.length === 0) return []
  const list = [...candidates]
  const [reserved, owned, former] = await Promise.all([
    admin.from('reserved_slugs').select('slug').in('slug', list),
    admin.from('tenants').select('slug').in('slug', list).neq('id', tenantId),
    admin.from('tenant_slug_history').select('old_slug').in('old_slug', list),
  ])
  // a failed read offers nothing rather than a link that may be taken
  if (reserved.error || owned.error || former.error) return []
  const taken = new Set<string>([
    ...((reserved.data ?? []) as { slug: string }[]).map((r) => r.slug),
    ...((owned.data ?? []) as { slug: string }[]).map((r) => r.slug),
    ...((former.data ?? []) as { old_slug: string }[]).map((r) => r.old_slug),
  ])
  return list.filter((slug) => !taken.has(slug))
}

/** Up to three clean, free links for this business, built from its own details */
export async function cleanSlugOptions(admin: Admin, tenantId: string): Promise<string[]> {
  const { data } = await admin
    .from('tenants')
    .select('name, slug, trade, trade_other, service_area_values, branding_json, region')
    .eq('id', tenantId)
    .single()
  if (!data) return []
  const row = data as {
    name: string
    slug: string
    trade: string | null
    trade_other: string | null
    service_area_values: string[] | null
    branding_json: { website?: string | null } | null
    region: string | null
  }
  const candidates = cleanSlugCandidates({
    name: row.name,
    slug: row.slug,
    trade: row.trade,
    tradeOther: row.trade_other,
    serviceAreaValues: row.service_area_values,
    website: row.branding_json?.website,
    region: row.region,
  })
  return (await freeSlugs(admin, candidates, tenantId)).slice(0, CLEAN_SLUG_OFFERS)
}
