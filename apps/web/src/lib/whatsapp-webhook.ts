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

/**
 * A number that stays on the WhatsApp Business app is not only for quotes: the
 * owner's other chats arrive on it too. So a new conversation there starts
 * only when the message asks for a quote, estimate or price; anything else is
 * left for the owner to answer in the app. A number connected just for
 * Qolumns answers every first message, as before (T-111).
 */
export function shouldAnswer(opts: { numberKind: 'new_number' | 'business_app' | null; intakeState: string; asksForQuote: boolean }): boolean {
  if (opts.numberKind !== 'business_app') return true
  const underWay = opts.intakeState !== 'idle' && opts.intakeState !== 'completed'
  return underWay || opts.asksForQuote
}
