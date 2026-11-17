/**
 * T-175: what the dashboard is told about a business's WhatsApp connection —
 * pure, no IO. Nothing here carries a token or any other secret: the view is
 * built from the stored row by naming each field, so a new secret column can
 * never reach the browser by accident.
 */

/** Days before the token expires at which the business is warned (page and email) */
export const TOKEN_WARN_DAYS = 14
/** Days before the token expires at which the daily job tries to renew it with Meta */
export const TOKEN_RENEW_DAYS = 30

export type ConnectionMethod = 'manual' | 'embedded'
export type TokenState = 'no_expiry' | 'ok' | 'expiring' | 'expired'

/** The stored row, as the server reads it (secrets left out of the type on purpose) */
export interface WhatsAppConfigRow {
  phone_number_id: string
  display_phone_number: string
  is_active: boolean
  connection_method: ConnectionMethod
  waba_id: string | null
  business_id: string | null
  verified_name: string | null
  number_kind: 'new_number' | 'business_app' | null
  token_expires_at: string | null
  registered_at: string | null
  messages_ready_at: string | null
  connected_at: string | null
  created_at: string
  updated_at: string
}

/** Whole days until `expiresAt` (0 on the last day, negative once past); null when there is no expiry */
export function daysUntil(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (Number.isNaN(ms)) return null
  return Math.floor(ms / 86_400_000)
}

export function tokenState(expiresAt: string | null, now: Date): TokenState {
  const days = daysUntil(expiresAt, now)
  if (days === null) return 'no_expiry'
  if (new Date(expiresAt as string).getTime() <= now.getTime()) return 'expired'
  return days < TOKEN_WARN_DAYS ? 'expiring' : 'ok'
}

export interface ConnectionView {
  method: ConnectionMethod
  phoneNumberId: string
  displayPhoneNumber: string
  verifiedName: string | null
  isActive: boolean
  /** a number that also stays on the WhatsApp Business app */
  alsoOnBusinessApp: boolean
  connectedAt: string
  token: { state: TokenState; expiresAt: string | null; daysLeft: number | null }
  /** Meta has accepted the number for the Cloud API (always true for a manual connection) */
  registered: boolean
  /** Meta reports a payment method on the account, or a message has gone out */
  messagesReady: boolean
  /** where the business adds a payment method (embedded connections only) */
  paymentUrl: string | null
}

/** Meta's own instructions for adding a payment method (from its Tech Provider onboarding page) */
export const PAYMENT_HELP_URL = 'https://www.facebook.com/business/help/488291839463771'

/**
 * WhatsApp Manager's Overview, where Meta's docs send a business to press
 * "Add payment method". The two ids open it on the right account; Meta ignores
 * them if it does not use them.
 */
export function paymentSettingsUrl(wabaId: string | null, businessId: string | null): string | null {
  if (!wabaId) return null
  const query = new URLSearchParams({ waba_id: wabaId })
  if (businessId) query.set('business_id', businessId)
  return `https://business.facebook.com/wa/manage/home/?${query.toString()}`
}

export function connectionView(row: WhatsAppConfigRow, now: Date): ConnectionView {
  return {
    method: row.connection_method,
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number,
    verifiedName: row.verified_name,
    isActive: row.is_active,
    alsoOnBusinessApp: row.number_kind === 'business_app',
    connectedAt: row.connected_at ?? row.created_at,
    token: { state: tokenState(row.token_expires_at, now), expiresAt: row.token_expires_at, daysLeft: daysUntil(row.token_expires_at, now) },
    registered: row.connection_method === 'manual' || Boolean(row.registered_at),
    messagesReady: Boolean(row.messages_ready_at),
    paymentUrl: row.connection_method === 'embedded' ? paymentSettingsUrl(row.waba_id, row.business_id) : null,
  }
}

/** The columns `connectionView` needs: what a route selects (never the encrypted columns) */
export const CONNECTION_VIEW_COLUMNS =
  'phone_number_id, display_phone_number, is_active, connection_method, waba_id, business_id, verified_name, number_kind, token_expires_at, registered_at, messages_ready_at, connected_at, created_at, updated_at'
