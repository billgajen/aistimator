/**
 * T-175: the calls to Meta's Graph API that Embedded Signup needs, server only.
 *
 * Checked against Meta's docs on 2026-11-16 (Embedded Signup implementation,
 * "Onboarding customers as a Tech Provider", "Onboarding WhatsApp Business app
 * users", registration, error codes):
 *   - the Graph API version is v27.0;
 *   - the code from the login callback lives 30 seconds and is exchanged with
 *     GET /oauth/access_token (client_id, client_secret, code);
 *   - then POST /<account>/subscribed_apps, and POST /<number>/register with a
 *     6-digit PIN, except for a number that stays on the WhatsApp Business
 *     app, which is already registered.
 *
 * Rules of this file:
 *   - No token, code or secret is ever logged or put in an error message. An
 *     error carries Meta's own code and message and nothing we sent.
 *   - The app secret goes to Meta only: as `client_secret`, and in the app
 *     access token ("<app id>|<app secret>") in an Authorization header.
 *   - Every call has a time limit.
 */

/** The Graph API version every WhatsApp call uses (the SDK is initialised with the same one) */
export const GRAPH_API_VERSION = 'v27.0'

const GRAPH_HOST = 'https://graph.facebook.com'
const TIMEOUT_MS = 15_000

/**
 * Where Graph calls go. Always Meta in production. Outside production a local
 * stand-in can be named (WHATSAPP_GRAPH_BASE_URL), so the checks can run the
 * whole flow without calling Meta.
 */
export function graphApiUrl(): string {
  const override = process.env.NODE_ENV !== 'production' ? process.env.WHATSAPP_GRAPH_BASE_URL : undefined
  return `${(override || GRAPH_HOST).replace(/\/+$/, '')}/${GRAPH_API_VERSION}`
}

export class GraphError extends Error {
  constructor(
    /** HTTP status, or 0 when Meta could not be reached */
    readonly status: number,
    /** Meta's error code, when it gave one */
    readonly code: number | null,
    message: string
  ) {
    super(message)
    this.name = 'GraphError'
  }
}

export interface MetaApp {
  appId: string
  appSecret: string
}

/** The platform's Meta app, or null when it is not set up (names: NEXT_PUBLIC_WHATSAPP_APP_ID, WHATSAPP_APP_SECRET) */
export function metaApp(): MetaApp | null {
  const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID
  const appSecret = process.env.WHATSAPP_APP_SECRET
  return appId && appSecret ? { appId, appSecret } : null
}

type Json = Record<string, unknown>

async function call(path: string, init: { method?: string; token?: string; query?: Record<string, string>; body?: Json } = {}): Promise<Json> {
  const url = new URL(`${graphApiUrl()}${path}`)
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.token && { Authorization: `Bearer ${init.token}` }),
        ...(init.body && { 'Content-Type': 'application/json' }),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // never the cause: a fetch error can carry the URL, and the URL can carry a secret
    throw new GraphError(0, null, 'Meta could not be reached')
  }
  const json = (await response.json().catch(() => ({}))) as Json
  const error = json.error as { message?: unknown; code?: unknown } | undefined
  if (!response.ok || error) {
    throw new GraphError(
      response.status,
      typeof error?.code === 'number' ? error.code : null,
      typeof error?.message === 'string' ? error.message : `Meta answered ${response.status}`
    )
  }
  return json
}

/** The code from the login callback → the business's token. The code lives 30 seconds. */
export async function exchangeCode(app: MetaApp, code: string): Promise<string> {
  const json = await call('/oauth/access_token', { query: { client_id: app.appId, client_secret: app.appSecret, code } })
  if (typeof json.access_token !== 'string' || !json.access_token) throw new GraphError(200, null, 'Meta returned no token')
  return json.access_token
}

export interface TokenInfo {
  valid: boolean
  appId: string | null
  /** null = the token does not expire */
  expiresAt: Date | null
  /** the accounts each permission was granted for (empty when Meta lists none) */
  accountIds: string[]
  scopes: string[]
}

/** What Meta says about a token: whose app, until when, for which accounts */
export async function inspectToken(app: MetaApp, token: string): Promise<TokenInfo> {
  const json = await call('/debug_token', { query: { input_token: token }, token: `${app.appId}|${app.appSecret}` })
  const data = (json.data ?? {}) as Json
  const granular = Array.isArray(data.granular_scopes) ? (data.granular_scopes as Json[]) : []
  const accountIds = granular
    .filter((g) => typeof g.scope === 'string' && g.scope.startsWith('whatsapp_business_'))
    .flatMap((g) => (Array.isArray(g.target_ids) ? (g.target_ids as unknown[]) : []))
    .map(String)
  const expires = typeof data.expires_at === 'number' ? data.expires_at : 0
  return {
    valid: data.is_valid === true,
    appId: data.app_id === undefined ? null : String(data.app_id),
    expiresAt: expires > 0 ? new Date(expires * 1000) : null,
    accountIds: [...new Set(accountIds)],
    scopes: Array.isArray(data.scopes) ? (data.scopes as unknown[]).map(String) : [],
  }
}

export interface AccountNumber {
  id: string
  displayPhoneNumber: string
  verifiedName: string | null
  /** the number also stays on the WhatsApp Business app */
  onBusinessApp: boolean
}

function toNumber(row: Json): AccountNumber {
  return {
    id: String(row.id ?? ''),
    displayPhoneNumber: typeof row.display_phone_number === 'string' ? row.display_phone_number : '',
    verifiedName: typeof row.verified_name === 'string' ? row.verified_name : null,
    onBusinessApp: row.is_on_biz_app === true,
  }
}

const NUMBER_FIELDS = 'id,display_phone_number,verified_name,is_on_biz_app,platform_type'

/** The phone numbers in a WhatsApp account, read with the business's own token */
export async function accountNumbers(token: string, wabaId: string): Promise<AccountNumber[]> {
  const json = await call(`/${encodeURIComponent(wabaId)}/phone_numbers`, { token, query: { fields: NUMBER_FIELDS, limit: '100' } })
  return (Array.isArray(json.data) ? (json.data as Json[]) : []).map(toNumber)
}

/** One phone number, read with a token (the manual method's check that the token belongs to the number) */
export async function numberDetails(token: string, phoneNumberId: string): Promise<AccountNumber & { qualityRating: string | null }> {
  const json = await call(`/${encodeURIComponent(phoneNumberId)}`, { token, query: { fields: `${NUMBER_FIELDS},quality_rating` } })
  return { ...toNumber({ ...json, id: json.id ?? phoneNumberId }), qualityRating: typeof json.quality_rating === 'string' ? json.quality_rating : null }
}

/** Our app starts receiving this account's webhooks */
export async function subscribeApp(token: string, wabaId: string): Promise<void> {
  await call(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', token })
}

/** Our app stops receiving this account's webhooks */
export async function unsubscribeApp(token: string, wabaId: string): Promise<void> {
  await call(`/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'DELETE', token })
}

/** Register a number for the Cloud API. `pin` becomes (or must match) its two-step PIN. Never for a Business app number. */
export async function registerNumber(token: string, phoneNumberId: string, pin: string): Promise<void> {
  await call(`/${encodeURIComponent(phoneNumberId)}/register`, { method: 'POST', token, body: { messaging_product: 'whatsapp', pin } })
}

/**
 * A number that stays on the WhatsApp Business app: Meta requires the two
 * sync requests within 24 hours of onboarding, or the business has to connect
 * again. We ask for them and keep none of what they produce: the app is not
 * subscribed to the fields that carry contacts and old chats, and the webhook
 * ignores them.
 */
export async function requestBusinessAppSync(token: string, phoneNumberId: string, syncType: 'smb_app_state_sync' | 'history'): Promise<void> {
  await call(`/${encodeURIComponent(phoneNumberId)}/smb_app_data`, { method: 'POST', token, body: { messaging_product: 'whatsapp', sync_type: syncType } })
}

/** Does the WhatsApp account have a payment method attached? null when Meta does not say. */
export async function hasPaymentMethod(token: string, wabaId: string): Promise<boolean | null> {
  const json = await call(`/${encodeURIComponent(wabaId)}`, { token, query: { fields: 'primary_funding_id' } })
  if (!('primary_funding_id' in json)) return null
  const id = json.primary_funding_id
  return typeof id === 'string' ? id !== '' && id !== '0' : typeof id === 'number' ? id !== 0 : null
}

/**
 * Ask Meta for a fresh 60-day token in exchange for one that has not expired.
 * Meta documents this call for system user tokens; whether it accepts a token
 * from Embedded Signup is only known once tried with a real one, so a refusal
 * is an ordinary outcome: the caller then warns the business to reconnect.
 */
export async function renewToken(app: MetaApp, token: string): Promise<{ token: string; expiresAt: Date | null }> {
  const json = await call('/oauth/access_token', {
    query: {
      grant_type: 'fb_exchange_token',
      client_id: app.appId,
      client_secret: app.appSecret,
      set_token_expires_in_60_days: 'true',
      fb_exchange_token: token,
    },
  })
  if (typeof json.access_token !== 'string' || !json.access_token) throw new GraphError(200, null, 'Meta returned no token')
  const seconds = typeof json.expires_in === 'number' ? json.expires_in : 0
  return { token: json.access_token, expiresAt: seconds > 0 ? new Date(Date.now() + seconds * 1000) : null }
}

/** Meta's error codes this product acts on (Docs: WhatsApp error codes) */
export const META_ERROR = {
  /** the token is invalid or has expired */
  TOKEN: 190,
  /** a problem with the account's payment method */
  PAYMENT: 131042,
  /** the two-step PIN sent with a registration is wrong */
  PIN_WRONG: 133005,
  /** the number is not registered for the Cloud API */
  NOT_REGISTERED: 133010,
} as const
