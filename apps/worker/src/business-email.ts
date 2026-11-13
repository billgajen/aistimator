/**
 * Where emails to the business go, and the reply-to on customer emails
 * (T-157). The rule is `chooseBusinessEmail` in @estimator/shared, the same
 * one the web app applies:
 *   the notification email from Settings > Notifications when set, otherwise
 *   the account email of the tenant's first user; the demo business emails
 *   no one.
 *
 * Until T-157 the worker always used the first user's account email and
 * ignored the setting. Addresses are never logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chooseBusinessEmail } from '@estimator/shared'

/** The parts of the service-role client this needs */
type EmailLookupClient = Pick<SupabaseClient, 'from' | 'auth'>

export async function loadBusinessEmail(
  supabase: EmailLookupClient,
  tenantId: string,
  tenant: { notification_email?: string | null; is_demo?: boolean | null } | null | undefined
): Promise<string | undefined> {
  // The setting (or the demo flag) settles it without the account lookup
  const fromSetting = chooseBusinessEmail({ isDemo: tenant?.is_demo, notificationEmail: tenant?.notification_email })
  if (fromSetting || tenant?.is_demo) return fromSetting ?? undefined

  const { data: ownerProfile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  const ownerId = (ownerProfile as { id?: string } | null)?.id
  if (!ownerId) return undefined

  const { data: authUser } = await supabase.auth.admin.getUserById(ownerId)
  return (
    chooseBusinessEmail({
      isDemo: tenant?.is_demo,
      notificationEmail: tenant?.notification_email,
      ownerEmail: authUser?.user?.email ?? null,
    }) ?? undefined
  )
}
