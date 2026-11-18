/**
 * T-177: may this business's WhatsApp assistant speak?
 *
 * Two conditions, both read from what already exists:
 *   - its plan includes the WhatsApp channel (the plan definitions in
 *     @qolumns/shared decide; no plan is named here);
 *   - its subscription is live (`subscriptionLive`: the same rule, and the
 *     same grace, as the quote limit: a payment that failed and is being
 *     retried, `past_due`, still counts; a cancelled subscription does not).
 * A business with no subscription is on the free allowance, which has no
 * WhatsApp.
 * T-180: and it is not suspended. A platform admin's suspend switch silences
 * the assistant whatever the plan says (checked first).
 *
 * When the answer is no, the assistant is SILENT everywhere: no reply to a
 * customer, no template, no approval notice, no test message, and no new
 * connection. An existing connection is kept, never disconnected: it speaks
 * again the moment the plan is active.
 */
import { offeredPlansWithChannel, planHasChannel, subscriptionLive } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export type WhatsAppAccess =
  | { allowed: true }
  /** 'plan': the plan has no WhatsApp (or there is no plan). 'subscription': it has, but the subscription is not live. 'suspended': a platform admin paused the account (T-180). */
  | { allowed: false; why: 'plan' | 'subscription' | 'suspended' }

/** Pure: the rule, from a subscription row (or none), and whether the account is suspended */
export function whatsappAccessFor(
  subscription: { plan_id?: string | null; status?: string | null } | null | undefined,
  suspended = false
): WhatsAppAccess {
  if (suspended) return { allowed: false, why: 'suspended' }
  if (!subscription || !planHasChannel(subscription.plan_id, 'whatsapp')) return { allowed: false, why: 'plan' }
  if (!subscriptionLive(subscription.status)) return { allowed: false, why: 'subscription' }
  return { allowed: true }
}

/** Any trouble reading the subscription means "no": the assistant stays silent rather than speak for a business that may have lapsed */
export async function whatsappAccess(admin: Admin, tenantId: string): Promise<WhatsAppAccess> {
  try {
    const [{ data, error }, tenant] = await Promise.all([
      admin.from('subscriptions').select('plan_id, status').eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('suspended_at').eq('id', tenantId).maybeSingle(),
    ])
    if (error || tenant.error) return { allowed: false, why: 'subscription' }
    const suspended = Boolean((tenant.data as { suspended_at?: string | null } | null)?.suspended_at)
    return whatsappAccessFor(data as { plan_id?: string | null; status?: string | null } | null, suspended)
  } catch {
    return { allowed: false, why: 'subscription' }
  }
}

export const PAUSED_LINE = 'Your WhatsApp assistant is paused until your plan is active again.'
/** T-180: the account itself is paused (the dashboard's notice says what to do) */
export const SUSPENDED_WHATSAPP_LINE = 'Your WhatsApp assistant is paused while your account is paused.'

/** The upgrade line for a plan without WhatsApp, naming the plans that have it (from the plan definitions) */
export function upgradeLine(): string {
  const names = offeredPlansWithChannel('whatsapp').map((p) => p.name)
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return list ? `WhatsApp quoting is part of the ${list} ${names.length === 1 ? 'plan' : 'plans'}.` : 'WhatsApp quoting is not part of your plan.'
}

/** What the page is told */
export interface WhatsAppAccessView {
  allowed: boolean
  why: 'plan' | 'subscription' | 'suspended' | null
  /** the one line to show when it is not allowed */
  line: string | null
}

export function accessView(access: WhatsAppAccess): WhatsAppAccessView {
  if (access.allowed) return { allowed: true, why: null, line: null }
  const line = access.why === 'plan' ? upgradeLine() : access.why === 'suspended' ? SUSPENDED_WHATSAPP_LINE : PAUSED_LINE
  return { allowed: false, why: access.why, line }
}

/** The answer a route gives when the assistant may not act */
export function accessRefusal(access: WhatsAppAccess): { status: number; code: string; message: string } | null {
  if (access.allowed) return null
  if (access.why === 'plan') return { status: 403, code: 'PLAN_REQUIRED', message: upgradeLine() }
  return { status: 403, code: 'ASSISTANT_PAUSED', message: access.why === 'suspended' ? SUSPENDED_WHATSAPP_LINE : PAUSED_LINE }
}
