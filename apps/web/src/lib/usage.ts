import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Get current period in YYYYMM format
 */
export function getCurrentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Increment usage counter for a tenant
 * Uses upsert to create record if it doesn't exist
 */
export async function incrementUsageCounter(
  supabase: SupabaseClient,
  tenantId: string,
  field: 'estimates_created' | 'estimates_sent'
): Promise<void> {
  const period = getCurrentPeriod()

  // First try to get existing record
  const { data: existing } = await supabase
    .from('usage_counters')
    .select('id, estimates_created, estimates_sent')
    .eq('tenant_id', tenantId)
    .eq('period_yyyymm', period)
    .single()

  if (existing) {
    // Update existing record
    const updates: Record<string, number> = {}
    if (field === 'estimates_created') {
      updates.estimates_created = existing.estimates_created + 1
    } else {
      updates.estimates_sent = existing.estimates_sent + 1
    }

    const { error } = await supabase
      .from('usage_counters')
      .update(updates)
      .eq('id', existing.id)

    if (error) {
      console.error('Failed to update usage counter:', error)
    }
  } else {
    // Create new record
    const { error } = await supabase.from('usage_counters').insert({
      tenant_id: tenantId,
      period_yyyymm: period,
      estimates_created: field === 'estimates_created' ? 1 : 0,
      estimates_sent: field === 'estimates_sent' ? 1 : 0,
    })

    if (error) {
      // Could be race condition, try update instead
      if (error.code === '23505') {
        // Unique constraint violation - record was created by another request
        await incrementUsageCounter(supabase, tenantId, field)
      } else {
        console.error('Failed to create usage counter:', error)
      }
    }
  }
}
