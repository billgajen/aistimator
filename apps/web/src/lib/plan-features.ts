import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Plan feature lookups (features_json on the plans table).
 *
 * custom_branding (Growth/Pro) = white-label: the "Prepared with Aistimator"
 * badge is dropped from customer-facing surfaces. Fail-safe: any error or no
 * subscription → false (badge shows).
 */
export async function hasCustomBranding(
  supabase: SupabaseClient,
  tenantId: string
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('status, plans!plan_id (features_json)')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trialing'])
      .maybeSingle()

    if (!data) return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const planRaw = (data as any).plans
    const plan = Array.isArray(planRaw) ? planRaw[0] : planRaw
    return Boolean(plan?.features_json?.custom_branding)
  } catch {
    return false
  }
}
