import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Get current period in YYYYMM format
 */
export function getCurrentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Add one to a usage counter, inside the database (T-180, AD-063).
 *
 * Until T-180 this read the count, added one and wrote it back, so two quotes
 * finishing at the same moment both wrote the same number. It is one
 * statement now (`increment_usage_counter`, migration 44). The worker only
 * counts estimates sent; a priced quote is counted by the web app when the
 * request arrives (`claimPlanQuote`).
 */
export async function incrementUsageCounter(
  supabase: SupabaseClient,
  tenantId: string,
  field: 'estimates_created' | 'estimates_sent'
): Promise<void> {
  const { error } = await supabase.rpc('increment_usage_counter', {
    p_tenant_id: tenantId,
    p_period: getCurrentPeriod(),
    p_field: field,
  })
  if (error) console.error('Failed to update usage counter:', error.code ?? error.message)
}
