/**
 * T-175: connecting, checking and disconnecting a business's WhatsApp number —
 * server only. Every function takes the service-role client and a tenant id
 * the caller has already authorised (the signed-in user's own tenant).
 *
 * Connecting through Meta's Embedded Signup, in order:
 *   1. exchange the code for the business's token (the code lives 30 seconds);
 *   2. ask Meta whose token it is: ours, valid, and granted for this account;
 *   3. read the account's numbers WITH THAT TOKEN and find the number in them.
 *      The account id and the number id come from the browser, so they are
 *      never trusted: a row is only written for a number Meta itself lists
 *      under the token. That is what stops one business claiming another's
 *      number;
 *   4. subscribe our app to the account's webhooks;
 *   5. register the number (not for a number that stays on the WhatsApp
 *      Business app: it is registered already, and gets the two sync requests
 *      Meta requires instead);
 *   6. store the token encrypted, with its expiry.
 *
 * No token, code, PIN or secret is logged anywhere in this file.
 */
import crypto from 'crypto'
import type { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret, encryptSecret, whatsappKeyConfigured } from '@/lib/whatsapp-crypto'
import {
  GraphError,
  META_ERROR,
  accountNumbers,
  exchangeCode,
  hasPaymentMethod,
  inspectToken,
  metaApp,
  numberDetails,
  registerNumber,
  renewToken,
  requestBusinessAppSync,
  subscribeApp,
  unsubscribeApp,
} from '@/lib/whatsapp-graph'
import { CONNECTION_VIEW_COLUMNS, connectionView, type ConnectionView, type WhatsAppConfigRow } from '@/lib/whatsapp-state'

type Admin = ReturnType<typeof createAdminClient>

/** What a connect attempt can come back with. `message` is plain words for the business. */
export type ConnectResult =
  | { ok: true; connection: ConnectionView; registrationProblem: string | null }
  | { ok: false; status: number; code: string; message: string }

const fail = (status: number, code: string, message: string): ConnectResult => ({ ok: false, status, code, message })

/** Is one-click connect switched on? (the app id and the configuration id are public; the two secrets are not) */
export function embeddedSignupAvailable(): boolean {
  return Boolean(metaApp() && process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID && whatsappKeyConfigured())
}

/** Meta's ids are digits. Anything else never reaches a URL. */
const isMetaId = (value: unknown): value is string => typeof value === 'string' && /^\d{5,32}$/.test(value)

const newPin = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

export async function loadConnection(admin: Admin, tenantId: string, now = new Date()): Promise<ConnectionView | null> {
  const { data } = await admin.from('whatsapp_configs').select(CONNECTION_VIEW_COLUMNS).eq('tenant_id', tenantId).maybeSingle()
  return data ? connectionView(data as unknown as WhatsAppConfigRow, now) : null
}

export async function connectWithEmbeddedSignup(
  admin: Admin,
  tenantId: string,
  input: { code?: unknown; wabaId?: unknown; phoneNumberId?: unknown; businessId?: unknown; onBusinessApp?: unknown }
): Promise<ConnectResult> {
  const app = metaApp()
  if (!app || !embeddedSignupAvailable()) return fail(503, 'NOT_AVAILABLE', 'One-click connect is not switched on yet.')
  if (typeof input.code !== 'string' || input.code.length < 8 || input.code.length > 4000) {
    return fail(400, 'INVALID_REQUEST', 'Meta did not finish the sign-up. Press Connect WhatsApp and go through to the last screen.')
  }
  // The account is normally named by Meta's message; when the message did not arrive, the token says which one it is for
  if (input.wabaId !== undefined && input.wabaId !== null && !isMetaId(input.wabaId)) {
    return fail(400, 'INVALID_REQUEST', 'Meta did not say which WhatsApp account was connected. Try again.')
  }
  // Meta's message for a WhatsApp Business app number can name the account alone; the number is then found in step 3
  if (input.phoneNumberId !== undefined && input.phoneNumberId !== null && !isMetaId(input.phoneNumberId)) {
    return fail(400, 'INVALID_REQUEST', 'Meta did not say which number was connected. Try again.')
  }
  const namedAccountId = isMetaId(input.wabaId) ? input.wabaId : null
  const namedNumberId = isMetaId(input.phoneNumberId) ? input.phoneNumberId : null
  const businessId = isMetaId(input.businessId) ? input.businessId : null

  let token: string
  try {
    token = await exchangeCode(app, input.code)
  } catch (error) {
    console.error(`[WhatsApp connect] code exchange refused: ${describe(error)}`)
    return fail(422, 'CODE_REFUSED', 'Meta did not accept the sign-in (its code lasts 30 seconds). Press Connect WhatsApp to try again.')
  }

  try {
    const info = await inspectToken(app, token)
    if (!info.valid || info.appId !== app.appId) return fail(422, 'TOKEN_REFUSED', 'Meta returned a sign-in that is not for this app. Try again.')
    // When Meta lists the accounts the permissions were granted for, this account must be one of them
    if (namedAccountId && info.accountIds.length > 0 && !info.accountIds.includes(namedAccountId)) {
      return fail(403, 'NOT_YOUR_ACCOUNT', 'That WhatsApp account was not shared in the sign-up. Try again and choose the account you want to connect.')
    }
    const wabaId = namedAccountId ?? (info.accountIds.length === 1 ? (info.accountIds[0] as string) : null)
    if (!wabaId) {
      return fail(422, 'WHICH_ACCOUNT', 'Meta did not say which WhatsApp account was connected. Press Connect WhatsApp again and go through to the last screen.')
    }

    // Step 3: Meta's own list, read with the business's token
    const numbers = await accountNumbers(token, wabaId)
    if (numbers.length === 0) {
      return fail(422, 'NO_NUMBER', 'The sign-up finished without a phone number. Press Connect WhatsApp again and add or choose a number.')
    }
    let number = namedNumberId ? numbers.find((n) => n.id === namedNumberId) : undefined
    if (namedNumberId && !number) return fail(403, 'NOT_YOUR_NUMBER', 'That number is not in the WhatsApp account you connected. Try again and choose the number.')
    if (!number) {
      // not named: the account's only number, or its only WhatsApp Business app number when that is what was connected
      const candidates = input.onBusinessApp === true && numbers.some((n) => n.onBusinessApp) ? numbers.filter((n) => n.onBusinessApp) : numbers
      if (candidates.length !== 1) {
        return fail(422, 'WHICH_NUMBER', 'That WhatsApp account has more than one number and Meta did not say which one you chose. Press Connect WhatsApp again and choose the number.')
      }
      number = candidates[0] as (typeof numbers)[number]
    }
    const phoneNumberId = number.id

    await subscribeApp(token, wabaId)

    const nowIso = new Date().toISOString()
    let registeredAt: string | null = null
    let pinEncrypted: string | null = null
    let registrationProblem: string | null = null
    if (number.onBusinessApp) {
      registeredAt = nowIso
      // Meta: both requests within 24 hours, or the business must connect again. Nothing they produce is kept.
      for (const syncType of ['smb_app_state_sync', 'history'] as const) {
        try {
          await requestBusinessAppSync(token, phoneNumberId, syncType)
        } catch (error) {
          console.error(`[WhatsApp connect] Business app sync request (${syncType}) refused: ${describe(error)}`)
        }
      }
    } else {
      const pin = newPin()
      try {
        await registerNumber(token, phoneNumberId, pin)
        registeredAt = nowIso
        pinEncrypted = encryptSecret(pin)
      } catch (error) {
        console.error(`[WhatsApp connect] registration refused: ${describe(error)}`)
        registrationProblem = registrationMessage(error)
      }
    }

    let paid: boolean | null = null
    try {
      paid = await hasPaymentMethod(token, wabaId)
    } catch {
      // Meta does not say: the payment step stays shown until a message goes out
    }

    // Meta has just shown this token covers the number, so a row another
    // business holds for it is stale (the number moved, or was claimed by hand).
    const { error: clearError } = await admin.from('whatsapp_configs').delete().eq('phone_number_id', phoneNumberId).neq('tenant_id', tenantId)
    if (clearError) throw new Error('could not clear an earlier connection of this number')

    // Reconnecting the same account keeps what is already known about its payment method
    const { data: before } = await admin.from('whatsapp_configs').select('waba_id, messages_ready_at').eq('tenant_id', tenantId).maybeSingle()
    const earlier = before as { waba_id: string | null; messages_ready_at: string | null } | null
    const readyAt = paid ? nowIso : earlier?.waba_id === wabaId ? earlier.messages_ready_at : null

    const { error: saveError } = await admin.from('whatsapp_configs').upsert(
      {
        tenant_id: tenantId,
        phone_number_id: phoneNumberId,
        display_phone_number: number.displayPhoneNumber || phoneNumberId,
        verified_name: number.verifiedName,
        access_token_encrypted: encryptSecret(token),
        is_active: true,
        connection_method: 'embedded',
        waba_id: wabaId,
        business_id: businessId,
        number_kind: number.onBusinessApp ? 'business_app' : 'new_number',
        token_expires_at: info.expiresAt ? info.expiresAt.toISOString() : null,
        expiry_warned_at: null,
        app_secret_encrypted: null,
        registered_at: registeredAt,
        registration_pin_encrypted: pinEncrypted,
        messages_ready_at: readyAt,
        connected_at: nowIso,
      },
      { onConflict: 'tenant_id' }
    )
    if (saveError) throw new Error('could not save the connection')

    const connection = await loadConnection(admin, tenantId)
    if (!connection) throw new Error('the connection was saved and could not be read back')
    return { ok: true, connection, registrationProblem }
  } catch (error) {
    console.error(`[WhatsApp connect] failed: ${describe(error)}`)
    if (error instanceof GraphError) {
      return fail(502, 'META_REFUSED', `Meta did not let us finish connecting${error.code ? ` (code ${error.code})` : ''}. Nothing was saved. Try again in a minute.`)
    }
    return fail(500, 'INTERNAL_ERROR', 'Could not finish connecting. Nothing was saved. Try again.')
  }
}

/** What to log about a failure: Meta's status and code, or the error's name. Never a message we did not write. */
function describe(error: unknown): string {
  if (error instanceof GraphError) return `Meta HTTP ${error.status}, code ${error.code ?? 'none'}`
  return error instanceof Error ? error.message : 'unknown error'
}

function registrationMessage(error: unknown): string {
  if (error instanceof GraphError && error.code === META_ERROR.PIN_WRONG) {
    return 'This number already has a two-step PIN. Enter that PIN below to finish.'
  }
  return 'Meta has not accepted the number yet. Try again below in a few minutes.'
}

interface StoredSecrets {
  access_token_encrypted: string
  waba_id: string | null
  phone_number_id: string
  connection_method: 'manual' | 'embedded'
  number_kind: 'new_number' | 'business_app' | null
  registered_at: string | null
  token_expires_at: string | null
}
const SECRET_COLUMNS = 'access_token_encrypted, waba_id, phone_number_id, connection_method, number_kind, registered_at, token_expires_at'

async function loadSecrets(admin: Admin, tenantId: string): Promise<StoredSecrets | null> {
  const { data } = await admin.from('whatsapp_configs').select(SECRET_COLUMNS).eq('tenant_id', tenantId).maybeSingle()
  return (data as unknown as StoredSecrets | null) ?? null
}

/**
 * Finish registering a number Meta refused at connect time (most often: the
 * number already had a two-step PIN, which the business now supplies).
 */
export async function finishRegistration(admin: Admin, tenantId: string, pin: unknown): Promise<ConnectResult> {
  const row = await loadSecrets(admin, tenantId)
  if (!row || row.connection_method !== 'embedded') return fail(404, 'NOT_CONNECTED', 'WhatsApp is not connected.')
  if (pin !== undefined && pin !== null && pin !== '' && !(typeof pin === 'string' && /^\d{6}$/.test(pin))) {
    return fail(400, 'INVALID_PIN', 'The PIN is six digits.')
  }
  if (!row.registered_at) {
    const usePin = typeof pin === 'string' && pin ? pin : newPin()
    try {
      await registerNumber(decryptSecret(row.access_token_encrypted), row.phone_number_id, usePin)
    } catch (error) {
      console.error(`[WhatsApp register] refused: ${describe(error)}`)
      return fail(422, 'REGISTRATION_REFUSED', registrationMessage(error))
    }
    await admin
      .from('whatsapp_configs')
      .update({ registered_at: new Date().toISOString(), registration_pin_encrypted: encryptSecret(usePin) })
      .eq('tenant_id', tenantId)
  }
  const connection = await loadConnection(admin, tenantId)
  return connection ? { ok: true, connection, registrationProblem: null } : fail(404, 'NOT_CONNECTED', 'WhatsApp is not connected.')
}

/**
 * Ask Meta how the connection stands and store what it says: the number's
 * name, whether a payment method is on the account, and whether the token is
 * still good. Returns the refreshed view, and a line to show when Meta
 * reported a problem.
 */
export async function refreshConnection(admin: Admin, tenantId: string): Promise<{ connection: ConnectionView | null; problem: string | null }> {
  const row = await loadSecrets(admin, tenantId)
  if (!row) return { connection: null, problem: null }
  let problem: string | null = null
  const updates: Record<string, unknown> = {}
  try {
    const token = decryptSecret(row.access_token_encrypted)
    const number = await numberDetails(token, row.phone_number_id)
    if (number.displayPhoneNumber) updates.display_phone_number = number.displayPhoneNumber
    updates.verified_name = number.verifiedName
    if (row.connection_method === 'embedded' && row.waba_id) {
      const paid = await hasPaymentMethod(token, row.waba_id).catch(() => null)
      if (paid === true) updates.messages_ready_at = new Date().toISOString()
      const app = metaApp()
      if (app) {
        const info = await inspectToken(app, token).catch(() => null)
        if (info && !info.valid) problem = 'Meta says the connection is no longer valid. Reconnect to carry on.'
        if (info?.valid) updates.token_expires_at = info.expiresAt ? info.expiresAt.toISOString() : null
      }
    }
  } catch (error) {
    console.error(`[WhatsApp status] check failed: ${describe(error)}`)
    problem =
      error instanceof GraphError && error.code === META_ERROR.TOKEN
        ? 'Meta says the connection has expired or was removed. Reconnect to carry on.'
        : 'Could not reach Meta to check the connection. Try again in a minute.'
  }
  if (Object.keys(updates).length > 0) {
    // a payment method once seen stays seen: never overwrite the first time with a later one
    const { messages_ready_at: readyAt, ...rest } = updates
    if (Object.keys(rest).length > 0) await admin.from('whatsapp_configs').update(rest).eq('tenant_id', tenantId)
    if (readyAt) await admin.from('whatsapp_configs').update({ messages_ready_at: readyAt }).eq('tenant_id', tenantId).is('messages_ready_at', null)
  }
  return { connection: await loadConnection(admin, tenantId), problem }
}

/**
 * Disconnect: our app stops receiving the account's webhooks (asked of Meta,
 * best effort) and the stored token is removed with the row. The number is
 * NOT deregistered: that would stop it working with the Cloud API for any
 * other tool the business uses, and Meta forbids it for a number that is also
 * on the WhatsApp Business app.
 */
export async function disconnect(admin: Admin, tenantId: string): Promise<{ removed: boolean; metaToldToStop: boolean }> {
  const row = await loadSecrets(admin, tenantId)
  if (!row) return { removed: false, metaToldToStop: false }
  let metaToldToStop = false
  if (row.connection_method === 'embedded' && row.waba_id) {
    try {
      await unsubscribeApp(decryptSecret(row.access_token_encrypted), row.waba_id)
      metaToldToStop = true
    } catch (error) {
      // the token may be expired or the app already removed: the row goes either way
      console.error(`[WhatsApp disconnect] Meta did not confirm the unsubscribe: ${describe(error)}`)
    }
  }
  const { error } = await admin.from('whatsapp_configs').delete().eq('tenant_id', tenantId)
  if (error) throw new Error('could not remove the connection')
  return { removed: true, metaToldToStop }
}

/**
 * Meta told us (account_update webhook) that our app no longer has this
 * account: the business removed the app, left, or the account was deleted.
 * The token is useless and is removed.
 */
export async function removeConnectionsOfAccount(admin: Admin, wabaId: string): Promise<number> {
  const { data } = await admin.from('whatsapp_configs').delete().eq('waba_id', wabaId).eq('connection_method', 'embedded').select('tenant_id')
  return (data ?? []).length
}

/** The daily job's part: try to renew one token that is close to expiry. True when Meta gave a later one. */
export async function renewStoredToken(admin: Admin, tenantId: string): Promise<boolean> {
  const app = metaApp()
  const row = await loadSecrets(admin, tenantId)
  if (!app || !row || row.connection_method !== 'embedded' || !row.token_expires_at) return false
  try {
    const renewed = await renewToken(app, decryptSecret(row.access_token_encrypted))
    const info = await inspectToken(app, renewed.token)
    const expiresAt = info.expiresAt ?? renewed.expiresAt
    if (!info.valid || info.appId !== app.appId) return false
    // only a later expiry counts as a renewal
    if (expiresAt && expiresAt.getTime() <= new Date(row.token_expires_at).getTime()) return false
    const { error } = await admin
      .from('whatsapp_configs')
      .update({ access_token_encrypted: encryptSecret(renewed.token), token_expires_at: expiresAt ? expiresAt.toISOString() : null, expiry_warned_at: null })
      .eq('tenant_id', tenantId)
    return !error
  } catch (error) {
    console.error(`[WhatsApp renew] Meta did not renew the token: ${describe(error)}`)
    return false
  }
}

/**
 * The manual method (T-112): the business has its own Meta app and pastes its
 * phone number id, a permanent token and that app's secret.
 * - A new connection needs all three. The token is checked with Meta against
 *   the number before anything is saved, here on the server.
 * - An update keeps the stored token and secret when they are left empty.
 * - The secret is what its webhook calls are checked against: without one, no
 *   message from that number is ever acted on.
 * - A number another business holds cannot be taken this way.
 */
export async function saveManualConnection(
  admin: Admin,
  tenantId: string,
  input: { phoneNumberId?: unknown; displayPhoneNumber?: unknown; accessToken?: unknown; appSecret?: unknown; isActive?: unknown }
): Promise<ConnectResult> {
  if (!whatsappKeyConfigured()) return fail(503, 'NOT_AVAILABLE', 'WhatsApp is not switched on yet.')
  const phoneNumberId = typeof input.phoneNumberId === 'string' ? input.phoneNumberId.trim() : ''
  if (!isMetaId(phoneNumberId)) {
    return fail(400, 'VALIDATION_ERROR', 'Enter the Phone Number ID: the long number under your phone number on the API Setup page, not the phone number itself.')
  }
  const newToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : ''
  const newSecret = typeof input.appSecret === 'string' ? input.appSecret.trim() : ''
  const isActive = input.isActive !== false

  const { data: existingRow } = await admin
    .from('whatsapp_configs')
    .select('phone_number_id, connection_method, access_token_encrypted, app_secret_encrypted, display_phone_number')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const existing = existingRow as {
    phone_number_id: string
    connection_method: 'manual' | 'embedded'
    access_token_encrypted: string
    app_secret_encrypted: string | null
    display_phone_number: string
  } | null
  // the stored token and secret carry over only for the same number, connected the same way
  const sameConnection = existing?.connection_method === 'manual' && existing.phone_number_id === phoneNumberId

  if (!newToken && !sameConnection) return fail(400, 'VALIDATION_ERROR', 'Enter the access token.')
  if (!newSecret && !(sameConnection && existing?.app_secret_encrypted)) {
    return fail(400, 'VALIDATION_ERROR', 'Enter your Meta app’s App Secret. We use it to check that each message really comes from Meta.')
  }

  const { data: other } = await admin.from('whatsapp_configs').select('tenant_id').eq('phone_number_id', phoneNumberId).neq('tenant_id', tenantId).maybeSingle()
  if (other) return fail(409, 'NUMBER_IN_USE', 'That number is connected to another account.')

  let displayPhoneNumber = typeof input.displayPhoneNumber === 'string' ? input.displayPhoneNumber.trim() : ''
  let verifiedName: string | null = null
  let onBusinessApp = false
  if (newToken) {
    try {
      const number = await numberDetails(newToken, phoneNumberId)
      displayPhoneNumber = number.displayPhoneNumber || displayPhoneNumber
      verifiedName = number.verifiedName
      onBusinessApp = number.onBusinessApp
    } catch (error) {
      console.error(`[WhatsApp manual] Meta refused the credentials: ${describe(error)}`)
      const message =
        error instanceof GraphError && error.code === META_ERROR.TOKEN
          ? 'The access token is invalid or expired. Generate a permanent token in Meta Business Settings → System Users.'
          : error instanceof GraphError && error.code === 100
            ? 'The Phone Number ID was not found for this token. Copy the Phone Number ID (not the phone number) from the WhatsApp API Setup page.'
            : 'Meta did not accept these details. Check them and try again.'
      return fail(422, 'VERIFICATION_FAILED', message)
    }
  }
  if (!displayPhoneNumber) displayPhoneNumber = sameConnection && existing ? existing.display_phone_number : phoneNumberId

  const nowIso = new Date().toISOString()
  const { error } = await admin.from('whatsapp_configs').upsert(
    {
      tenant_id: tenantId,
      phone_number_id: phoneNumberId,
      display_phone_number: displayPhoneNumber,
      ...(newToken ? { verified_name: verifiedName, number_kind: onBusinessApp ? 'business_app' : 'new_number' } : {}),
      access_token_encrypted: newToken ? encryptSecret(newToken) : (existing as { access_token_encrypted: string }).access_token_encrypted,
      app_secret_encrypted: newSecret ? encryptSecret(newSecret) : (existing?.app_secret_encrypted ?? null),
      is_active: isActive,
      connection_method: 'manual',
      // a manual connection carries nothing from an earlier Embedded Signup one
      ...(sameConnection ? {} : { waba_id: null, business_id: null, token_expires_at: null, expiry_warned_at: null, registered_at: null, registration_pin_encrypted: null, messages_ready_at: null, connected_at: nowIso }),
    },
    { onConflict: 'tenant_id' }
  )
  if (error) {
    console.error('[WhatsApp manual] could not save the connection')
    return fail(500, 'DB_ERROR', 'Could not save the connection.')
  }
  const connection = await loadConnection(admin, tenantId)
  return connection ? { ok: true, connection, registrationProblem: null } : fail(500, 'DB_ERROR', 'Could not save the connection.')
}

/** Does a manual connection still lack the secret its webhook calls are checked against? */
export async function manualNeedsSecret(admin: Admin, tenantId: string): Promise<boolean> {
  const { data } = await admin.from('whatsapp_configs').select('connection_method, app_secret_encrypted').eq('tenant_id', tenantId).maybeSingle()
  const row = data as { connection_method: string; app_secret_encrypted: string | null } | null
  return Boolean(row && row.connection_method === 'manual' && !row.app_secret_encrypted)
}
