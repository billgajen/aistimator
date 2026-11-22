/**
 * T-177: may this business's WhatsApp assistant speak?
 *
 * T-199: the one rule decides (`businessAccess`, @qolumns/shared, read
 * through lib/access.ts): a live plan that includes the WhatsApp channel, or
 * the free start while free quotes are left. No plan is named here.
 *   - 'plan': nothing the business holds includes WhatsApp (no plan, the free
 *     quotes used up, or a plan without the channel);
 *   - 'subscription': a plan it holds includes it, but the subscription is
 *     not live (a payment being retried, `past_due`, still counts as live:
 *     the same grace as the quote limit).
 * T-180: and it is not suspended. A platform admin's suspend switch silences
 * the assistant whatever the plan says (checked first).
 *
 * When the answer is no, the assistant is SILENT everywhere: no reply to a
 * customer, no template, no approval notice, no test message, and no new
 * connection. An existing connection is kept, never disconnected: it speaks
 * again the moment the business can use the channel.
 */
import { canUse, freeStartTag, planNamesFor, whyNot, plansWith, type BusinessAccess } from '@qolumns/shared'
import { loadAccess } from '@/lib/access'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export type WhatsAppAccess =
  | { allowed: true }
  /** 'plan': nothing it holds has WhatsApp. 'subscription': a plan it holds has, but is not live. 'suspended': a platform admin paused the account (T-180). */
  | { allowed: false; why: 'plan' | 'subscription' | 'suspended' }

/** Pure: the answer, from what the business can use and whether the account is suspended */
export function whatsappAccessFor(access: BusinessAccess, suspended = false): WhatsAppAccess {
  if (suspended) return { allowed: false, why: 'suspended' }
  if (canUse(access, 'whatsapp')) return { allowed: true }
  return { allowed: false, why: whyNot(access, 'whatsapp') }
}

/** Any trouble reading means "no": the assistant stays silent rather than speak for a business that may have lapsed */
export async function whatsappAccess(admin: Admin, tenantId: string): Promise<WhatsAppAccess> {
  return (await whatsappAccessWithTag(admin, tenantId)).access
}

/** The same answer, with the free start's tag for the page ("Pro": the plan that keeps it), or null */
export async function whatsappAccessWithTag(admin: Admin, tenantId: string): Promise<{ access: WhatsAppAccess; tag: string | null }> {
  try {
    const [access, tenant] = await Promise.all([loadAccess(admin, tenantId), admin.from('tenants').select('suspended_at').eq('id', tenantId).maybeSingle()])
    if (tenant.error) return { access: { allowed: false, why: 'subscription' }, tag: null }
    const suspended = Boolean((tenant.data as { suspended_at?: string | null } | null)?.suspended_at)
    return { access: whatsappAccessFor(access, suspended), tag: freeStartTag(access, 'whatsapp') }
  } catch {
    return { access: { allowed: false, why: 'subscription' }, tag: null }
  }
}

export const PAUSED_LINE = 'Your WhatsApp assistant is paused until your plan is active again.'
/** T-180: the account itself is paused (the dashboard's notice says what to do) */
export const SUSPENDED_WHATSAPP_LINE = 'Your WhatsApp assistant is paused while your account is paused.'

/** The upgrade line for a business without WhatsApp, naming the plans that have it (from the plan definitions) */
export function upgradeLine(): string {
  const count = plansWith('whatsapp').length
  return count > 0 ? `WhatsApp quoting is part of the ${planNamesFor('whatsapp')} ${count === 1 ? 'plan' : 'plans'}.` : 'WhatsApp quoting is not part of your plan.'
}

/** What the page is told */
export interface WhatsAppAccessView {
  allowed: boolean
  why: 'plan' | 'subscription' | 'suspended' | null
  /** the one line to show when it is not allowed */
  line: string | null
  /** T-199: on the free start, the plan that keeps WhatsApp ("Pro"), for the small tag */
  tag?: string | null
}

export function accessView(access: WhatsAppAccess, tag: string | null = null): WhatsAppAccessView {
  if (access.allowed) return { allowed: true, why: null, line: null, tag }
  const line = access.why === 'plan' ? upgradeLine() : access.why === 'suspended' ? SUSPENDED_WHATSAPP_LINE : PAUSED_LINE
  return { allowed: false, why: access.why, line }
}

/** The answer a route gives when the assistant may not act */
export function accessRefusal(access: WhatsAppAccess): { status: number; code: string; message: string } | null {
  if (access.allowed) return null
  if (access.why === 'plan') return { status: 403, code: 'PLAN_REQUIRED', message: upgradeLine() }
  return { status: 403, code: 'ASSISTANT_PAUSED', message: access.why === 'suspended' ? SUSPENDED_WHATSAPP_LINE : PAUSED_LINE }
}
