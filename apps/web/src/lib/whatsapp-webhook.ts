/**
 * T-175: the rules of the WhatsApp webhook — pure, no IO.
 *
 * One address receives every business's messages. Two things keep businesses
 * apart:
 *   - a call is only acted on when its signature checks out against the secret
 *     of the Meta app that the number is connected through: the platform's app
 *     for a number connected with Embedded Signup, the business's own app for a
 *     manual connection. There is no path that skips the check;
 *   - a message goes to the one business whose stored row names the phone
 *     number id Meta put in the call.
 *
 * T-177: whether a message is ANSWERED is no longer decided here. Every
 * number is silent unless the customer asks for a price for something the
 * business offers (`lib/whatsapp-assistant.ts`), which replaces the T-175
 * rule that only a number kept on the WhatsApp Business app stayed quiet.
 */
import { verifyWebhookSignature } from './whatsapp'

/** Events on the account_update field that mean our app no longer has the account */
export const ACCOUNT_GONE_EVENTS: readonly string[] = ['PARTNER_REMOVED', 'PARTNER_APP_UNINSTALLED', 'ACCOUNT_DELETED', 'ACCOUNT_OFFBOARDED']

export interface AccountUpdate {
  event: string
  wabaId: string
}

/** The account_update changes in a webhook call (the account id is in waba_info, not in entry.id) */
export function parseAccountUpdates(body: unknown): AccountUpdate[] {
  const payload = body as { object?: unknown; entry?: Array<{ changes?: Array<{ field?: unknown; value?: { event?: unknown; waba_info?: { waba_id?: unknown } } }> }> } | null
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return []
  const updates: AccountUpdate[] = []
  for (const entry of payload.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'account_update') continue
      const event = change.value?.event
      const wabaId = change.value?.waba_info?.waba_id
      if (typeof event === 'string' && (typeof wabaId === 'string' || typeof wabaId === 'number')) updates.push({ event, wabaId: String(wabaId) })
    }
  }
  return updates
}

/** How a stored connection's calls are signed */
export interface SigningConfig {
  connection_method: 'manual' | 'embedded'
  /** the business's own app secret, decrypted (manual connections only) */
  ownAppSecret: string | null
}

/**
 * Was this call signed by the app this connection belongs to?
 * - embedded: the platform's app secret;
 * - manual: the business's own app secret. A manual connection with no stored
 *   secret can never pass: there is nothing to check its calls against.
 */
export function signedForConnection(rawBody: string, signature: string | null, config: SigningConfig, platformSecret: string | undefined): boolean {
  if (!signature) return false
  const secret = config.connection_method === 'manual' ? config.ownAppSecret : platformSecret
  return Boolean(secret) && verifyWebhookSignature(rawBody, signature, secret as string)
}

/** A message the business itself sent from the WhatsApp Business app (Meta's `smb_message_echoes` field) */
export interface OwnerEcho {
  phoneNumberId: string
  /** the customer it was sent to; Meta leaves this out when it does not share the number */
  to: string
  messageId: string
  /** when it was sent */
  at: Date | null
}

/**
 * T-177: the `smb_message_echoes` changes in a webhook call. Meta sends one
 * each time a business that kept its number on the WhatsApp Business app
 * messages a customer from the app. Only who it was sent to and when is
 * read: the business's own words are never looked at.
 */
export function parseOwnerEchoes(body: unknown): OwnerEcho[] {
  const payload = body as {
    object?: unknown
    entry?: Array<{ changes?: Array<{ field?: unknown; value?: { metadata?: { phone_number_id?: unknown }; message_echoes?: Array<{ to?: unknown; id?: unknown; timestamp?: unknown }> } }> }>
  } | null
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return []
  const echoes: OwnerEcho[] = []
  for (const entry of payload.entry) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'smb_message_echoes') continue
      const phoneNumberId = change.value?.metadata?.phone_number_id
      if (typeof phoneNumberId !== 'string' || !phoneNumberId) continue
      for (const echo of change.value?.message_echoes ?? []) {
        const to = typeof echo?.to === 'string' ? echo.to.replace(/\D/g, '') : ''
        if (!to || typeof echo?.id !== 'string') continue
        const seconds = Number(echo.timestamp)
        echoes.push({ phoneNumberId, to, messageId: echo.id, at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null })
      }
    }
  }
  return echoes
}
