import { NextResponse } from 'next/server'
import { isExpoPushToken, isPushPlatform, type AppPushPrefsResponse, type PushPrefs } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { prefColumns, userPushPrefs } from '@/lib/push'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * /api/app/push-token (T-196): the phone app's notification token and the
 * user's three switches. Auth: session cookie or `Authorization: Bearer
 * <access token>`. Every row is the signed-in user's own.
 *
 *   GET     the user's switches (all on when no phone is registered)
 *   PUT     { token, platform }  register this phone, or refresh it. A phone
 *           that changed hands moves to the user now signed in on it.
 *   PATCH   { newRequest?, accepted?, question? }  set switches, on every
 *           phone of the user (they are saved per user)
 *   DELETE  { token }  forget this phone (sign-out)
 *
 * The token is written with the service role, because moving a token from
 * another user's row is not something a user's own rules allow. The user and
 * the business written are always the signed-in ones, never the request's.
 */
function bad(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { prefs, devices } = await userPushPrefs(createAdminClient(), auth.userId)
  const body: AppPushPrefsResponse = { prefs, registered: devices > 0 }
  return NextResponse.json(body)
}

export async function PUT(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { token?: unknown; platform?: unknown } | null
  if (!isExpoPushToken(body?.token)) return bad('INVALID_TOKEN', 'token must be an Expo push token')
  if (!isPushPlatform(body?.platform)) return bad('INVALID_PLATFORM', 'platform must be "ios" or "android"')

  const admin = createAdminClient()
  // a new phone starts with the switches the user already has
  const { prefs } = await userPushPrefs(admin, auth.userId)
  const { error } = await admin
    .from('push_devices')
    .upsert(
      { token: body.token, tenant_id: auth.tenantId, user_id: auth.userId, platform: body.platform, ...prefColumns(prefs), updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    )
  if (error) {
    console.error('[PushToken] could not be saved:', error.code ?? 'unknown')
    return bad('DB_ERROR', 'The phone could not be registered', 500)
  }
  const answer: AppPushPrefsResponse = { prefs, registered: true }
  return NextResponse.json(answer)
}

export async function PATCH(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as Partial<Record<keyof PushPrefs, unknown>> | null
  const wanted: Partial<PushPrefs> = {}
  for (const key of ['newRequest', 'accepted', 'question'] as const) {
    if (body?.[key] === undefined) continue
    if (typeof body[key] !== 'boolean') return bad('INVALID_SWITCH', `${key} must be true or false`)
    wanted[key] = body[key] as boolean
  }
  if (Object.keys(wanted).length === 0) return bad('NO_CHANGE', 'Send at least one switch')

  const admin = createAdminClient()
  const { data, error } = await admin.from('push_devices').update(prefColumns(wanted)).eq('user_id', auth.userId).eq('tenant_id', auth.tenantId).select('token')
  if (error) {
    console.error('[PushToken] switches could not be saved:', error.code ?? 'unknown')
    return bad('DB_ERROR', 'The switches could not be saved', 500)
  }
  // nowhere to keep a switch until a phone is registered
  if ((data ?? []).length === 0) return bad('NO_DEVICE', 'No phone is registered for notifications yet', 409)
  const { prefs } = await userPushPrefs(admin, auth.userId)
  const answer: AppPushPrefsResponse = { prefs, registered: true }
  return NextResponse.json(answer)
}

export async function DELETE(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  if (!isExpoPushToken(body?.token)) return bad('INVALID_TOKEN', 'token must be an Expo push token')
  // the user's own row only: under the user's own rules, not the service role
  const { error } = await auth.supabase.from('push_devices').delete().eq('token', body.token).eq('user_id', auth.userId)
  if (error) {
    console.error('[PushToken] could not be removed:', error.code ?? 'unknown')
    return bad('DB_ERROR', 'The phone could not be removed', 500)
  }
  return NextResponse.json({ ok: true })
}
