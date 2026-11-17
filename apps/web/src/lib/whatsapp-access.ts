/**
 * T-177: may this business's WhatsApp assistant speak?
 *
 * Two conditions, both read from what already exists:
 *   - its plan includes the WhatsApp channel (the plan definitions in
 *     @qolumns/shared decide; no plan is named here);
 *   - its subscription is paid up (`subscriptionPaidUp`: active or on trial).
 *     A cancelled one is not, and neither is an unpaid one (`past_due`),
 *     although the quote limit gives that one grace.
 * A business with no subscription is on the free allowance, which has no
 * WhatsApp.
 *
 * When the answer is no, the assistant is SILENT everywhere: no reply to a
 * customer, no template, no approval notice, no test message, and no new
 * connection. An existing connection is kept, never disconnected: it speaks
 * again the moment the plan is active.
 */
import { offeredPlansWithChannel, planHasChannel, subscriptionPaidUp } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export type WhatsAppAccess =
  | { allowed: true }
  /** 'plan': the plan has no WhatsApp (or there is no plan). 'subscription': it has, but the subscription is not live. */
  | { allowed: false; why: 'plan' | 'subscription' }

/** Pure: the rule, from a subscription row (or none) */
export function whatsappAccessFor(subscription: { plan_id?: string | null; status?: string | null } | null | undefined): WhatsAppAccess {
  if (!subscription || !planHasChannel(subscription.plan_id, 'whatsapp')) return { allowed: false, why: 'plan' }
  if (!subscriptionPaidUp(subscription.status)) return { allowed: false, why: 'subscription' }
  return { allowed: true }
}

/** Any trouble reading the subscription means "no": the assistant stays silent rather than speak for a business that may have lapsed */
export async function whatsappAccess(admin: Admin, tenantId: string): Promise<WhatsAppAccess> {
  try {
    const { data, error } = await admin.from('subscriptions').select('plan_id, status').eq('tenant_id', tenantId).maybeSingle()
    if (error) return { allowed: false, why: 'subscription' }
    return whatsappAccessFor(data as { plan_id?: string | null; status?: string | null } | null)
  } catch {
    return { allowed: false, why: 'subscription' }
  }
}

export const PAUSED_LINE = 'Your WhatsApp assistant is paused until your plan is active again.'

/** The upgrade line for a plan without WhatsApp, naming the plans that have it (from the plan definitions) */
export function upgradeLine(): string {
  const names = offeredPlansWithChannel('whatsapp').map((p) => p.name)
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return list ? `WhatsApp quoting is part of the ${list} ${names.length === 1 ? 'plan' : 'plans'}.` : 'WhatsApp quoting is not part of your plan.'
}

/** What the page is told */
export interface WhatsAppAccessView {
  allowed: boolean
  why: 'plan' | 'subscription' | null
  /** the one line to show when it is not allowed */
  line: string | null
}

export function accessView(access: WhatsAppAccess): WhatsAppAccessView {
  if (access.allowed) return { allowed: true, why: null, line: null }
  return { allowed: false, why: access.why, line: access.why === 'plan' ? upgradeLine() : PAUSED_LINE }
}

/** The answer a route gives when the assistant may not act */
export function accessRefusal(access: WhatsAppAccess): { status: number; code: string; message: string } | null {
  if (access.allowed) return null
  return access.why === 'plan'
    ? { status: 403, code: 'PLAN_REQUIRED', message: upgradeLine() }
    : { status: 403, code: 'ASSISTANT_PAUSED', message: PAUSED_LINE }
}
