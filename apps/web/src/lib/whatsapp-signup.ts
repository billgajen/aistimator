/**
 * T-175: Meta's Embedded Signup, the browser side — pure. What the page hands
 * to FB.login, and how it reads the message Meta's window posts back.
 *
 * T-177: this runs **v5**, Meta's current version (released 20 October 2026;
 * read on 2026-11-17). Against v4 it changes two things only:
 * - connecting a number that is already on the WhatsApp Business app is on by
 *   default (v4 needed `featureType`), so a business can keep using its app
 *   while this product listens;
 * - the message Meta's window posts names the account in
 *   `messaging_account_ids` (v4: `waba_id`) and carries `is_on_biz_app`.
 *   `readSignupMessage` reads both shapes.
 * The configuration id and the app id are unchanged, and a connection made
 * under v4 is not touched: the version only shapes Meta's window.
 * v2 and v3 were retired on 15 October 2026. A request with no version is
 * served as v4, which is why the version is always sent.
 */

export const EMBEDDED_SIGNUP_VERSION: 'v4' | 'v5' = 'v5'

/** The second argument of FB.login */
export function signupLoginOptions(configId: string, version: 'v4' | 'v5' = EMBEDDED_SIGNUP_VERSION) {
  return {
    config_id: configId,
    response_type: 'code',
    override_default_response_type: true,
    extras:
      version === 'v5'
        ? { setup: {}, version: 'v5' }
        : { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  }
}

export type SignupMessage =
  | { kind: 'finished'; wabaId: string | null; phoneNumberId: string | null; businessId: string | null; onBusinessApp: boolean }
  | { kind: 'cancelled'; step: string | null }
  | { kind: 'error'; message: string | null }

const FINISH_EVENTS = ['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH_GRANT_ONLY_API_ACCESS']
const idOf = (value: unknown): string | null => (typeof value === 'string' && /^\d{5,32}$/.test(value) ? value : typeof value === 'number' ? String(value) : null)

/** Does a window message come from Meta? (the check Meta's own sample uses, on a parsed origin) */
export function fromMeta(origin: string): boolean {
  try {
    const host = new URL(origin).hostname
    return host === 'facebook.com' || host.endsWith('.facebook.com')
  } catch {
    return false
  }
}

/** Read Meta's WA_EMBEDDED_SIGNUP message; null for anything else */
export function readSignupMessage(raw: unknown): SignupMessage | null {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const message = data as { type?: unknown; event?: unknown; data?: Record<string, unknown> } | null
  if (!message || message.type !== 'WA_EMBEDDED_SIGNUP' || typeof message.event !== 'string') return null
  const d = message.data ?? {}
  if (FINISH_EVENTS.includes(message.event)) {
    // v5 names the account in messaging_account_ids; v4 in waba_id
    const accounts = Array.isArray(d.messaging_account_ids) ? d.messaging_account_ids : []
    return {
      kind: 'finished',
      wabaId: idOf(d.waba_id) ?? idOf(accounts[0]),
      phoneNumberId: idOf(d.phone_number_id),
      businessId: idOf(d.business_id),
      onBusinessApp: message.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' || d.is_on_biz_app === true,
    }
  }
  if (message.event === 'CANCEL') return { kind: 'cancelled', step: typeof d.current_step === 'string' ? d.current_step : null }
  if (message.event === 'ERROR') return { kind: 'error', message: typeof d.error_message === 'string' ? d.error_message : null }
  return null
}
