/**
 * T-150: carry what the business chose before signing up onto its tenant.
 * The pricing page links to /signup?plan=<id>; signup keeps the id in the
 * user's metadata (the tenant doesn't exist until the email is verified), and
 * the first dashboard or setup page load copies a valid, offered plan id here
 * for the billing page to pre-select. Checkout is never started from it.
 */
import { getPlan } from '@qolumns/shared'
import { createAdminClient, type createClient } from '@/lib/supabase/server'
import { cleanSignupSource } from '@/lib/signup-source'

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

/**
 * T-189: keep where a new business came from. The sign-up form sent the
 * first-visit source and it waited in the user's metadata (the business does
 * not exist until the address is confirmed). This runs once, when the address
 * is confirmed: it writes the source onto the business the database has just
 * created, if that business has none yet. Server-only (the column refuses any
 * other writer).
 *
 * Never throws and never delays the person: a sign-up with no source, or a
 * write that fails, changes nothing about the sign-in.
 */
export async function saveSignupSource(userId: string, userMetadata: Record<string, unknown> | undefined): Promise<'saved' | 'none' | 'failed'> {
  const source = cleanSignupSource(userMetadata?.signup_source)
  if (!source) return 'none'
  try {
    const admin = createAdminClient()
    const { data: profile } = await admin.from('user_profiles').select('tenant_id').eq('id', userId).maybeSingle()
    const tenantId = (profile as { tenant_id?: string } | null)?.tenant_id
    if (!tenantId) return 'failed'
    const { error } = await admin.from('tenants').update({ signup_source: source }).eq('id', tenantId).is('signup_source', null)
    if (error) {
      console.error(`[Auth] Sign-up source not saved (${error.code ?? 'unknown'})`)
      return 'failed'
    }
    return 'saved'
  } catch {
    console.error('[Auth] Sign-up source not saved (error)')
    return 'failed'
  }
}
