/**
 * Where emails to the business go (T-157). The rule is `chooseBusinessEmail`
 * in @estimator/shared, the same one the worker applies:
 *   the notification email from Settings, else the account email of the
 *   tenant's first user; the demo business emails no one.
 *
 * The same address is the reply-to on emails to the customer.
 *
 * Reading the first user's account email needs the service role, so every
 * caller passes a service-role client and a tenant id it has already
 * authorised (the signed-in user's tenant, or the quote's own tenant).
 * Addresses are never logged.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chooseBusinessEmail } from '@estimator/shared'
import { createAdminClient } from './supabase/server'

/** The parts of the client this needs (the fake in tests implements just these) */
type EmailLookupClient = Pick<SupabaseClient, 'from' | 'auth'>

export async function resolveBusinessEmail(
  supabase: EmailLookupClient,
  tenantId: string
): Promise<string | null> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('notification_email, is_demo')
    .eq('id', tenantId)
    .single()
  const row = tenant as { notification_email?: string | null; is_demo?: boolean | null } | null
  if (!row) return null

  // The setting (or the demo flag) settles it without the second lookup
  const fromSetting = chooseBusinessEmail({ isDemo: row.is_demo, notificationEmail: row.notification_email })
  if (fromSetting || row.is_demo) return fromSetting

  const { data: owner } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  const ownerId = (owner as { id?: string } | null)?.id
  if (!ownerId) return null

  const { data: authUser } = await supabase.auth.admin.getUserById(ownerId)
  return chooseBusinessEmail({
    isDemo: row.is_demo,
    notificationEmail: row.notification_email,
    ownerEmail: authUser?.user?.email ?? null,
  })
}

/**
 * The business's address for a tenant the caller has already authorised,
 * looked up with the service role (a signed-in user's own client can't read
 * account emails).
 */
export async function businessEmailFor(tenantId: string): Promise<string | null> {
  return resolveBusinessEmail(createAdminClient(), tenantId)
}

/**
 * The reply-to for an email to the customer. Never throws and never blocks a
 * send: without an address the email simply goes out with no reply-to.
 */
export async function businessReplyTo(tenantId: string): Promise<string | undefined> {
  try {
    return (await businessEmailFor(tenantId)) ?? undefined
  } catch (error) {
    console.error('[BusinessEmail] reply-to lookup failed:', error instanceof Error ? error.message : 'unknown error')
    return undefined
  }
}
