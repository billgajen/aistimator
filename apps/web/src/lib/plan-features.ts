import type { SupabaseClient } from '@supabase/supabase-js'
import { businessCan } from '@/lib/access'

/**
 * The badge on customer-facing pages. T-199: decided by the one rule
 * (`businessAccess`, @qolumns/shared), through lib/access.ts: a plan that
 * includes it, or the free start. Any error or no plan: the badge shows.
 *
 * White-label: the "Prepared with Qolumns" badge is dropped from the
 * estimate and the request form.
 */
export async function hasCustomBranding(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  return businessCan(supabase, tenantId, 'no_badge')
}
