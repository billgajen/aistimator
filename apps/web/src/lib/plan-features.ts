import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlan, type PlanDefinition, type PlanFeatureSet, type PlanChannel } from '@estimator/shared'

/**
 * Plan feature lookups (T-134: from the plan definitions in @estimator/shared,
 * not the plans table). Fail-safe: any error or no live subscription → null
 * plan → every gated feature off.
 */
export async function getActivePlan(supabase: SupabaseClient, tenantId: string): Promise<PlanDefinition | null> {
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('status, plan_id')
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trialing'])
      .maybeSingle()
    return data ? getPlan((data as { plan_id?: string }).plan_id) : null
  } catch {
    return null
  }
}

export async function hasPlanFeature(
  supabase: SupabaseClient,
  tenantId: string,
  feature: keyof PlanFeatureSet
): Promise<boolean> {
  return Boolean((await getActivePlan(supabase, tenantId))?.features[feature])
}

export async function hasPlanChannel(supabase: SupabaseClient, tenantId: string, channel: PlanChannel): Promise<boolean> {
  return Boolean((await getActivePlan(supabase, tenantId))?.channels.includes(channel))
}

/**
 * custom_branding = white-label: the "Prepared with Aistimator" badge is
 * dropped from customer-facing surfaces.
 */
export async function hasCustomBranding(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  return hasPlanFeature(supabase, tenantId, 'custom_branding')
}
