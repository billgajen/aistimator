/**
 * T-150: carry what the business chose before signing up onto its tenant.
 * The pricing page links to /signup?plan=<id>; signup keeps the id in the
 * user's metadata (the tenant doesn't exist until the email is verified), and
 * the first dashboard or setup page load copies a valid, offered plan id here
 * for the billing page to pre-select. Checkout is never started from it.
 */
import { getPlan } from '@estimator/shared'
import type { createClient } from '@/lib/supabase/server'

type UserClient = Awaited<ReturnType<typeof createClient>>

/** A plan id from the pricing page, if it is one we offer */
export function offeredPlanId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const plan = getPlan(value)
  return plan?.offered ? plan.id : null
}

export async function syncSelectedPlan(
  supabase: UserClient,
  tenantId: string,
  current: string | null | undefined,
  userMetadata: Record<string, unknown> | undefined
): Promise<void> {
  if (current) return
  const planId = offeredPlanId(userMetadata?.selected_plan)
  if (!planId) return
  await supabase.from('tenants').update({ selected_plan: planId }).eq('id', tenantId).is('selected_plan', null)
}
