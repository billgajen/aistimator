import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, emailKey, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { passwordProblem } from '@/lib/auth-flow'
import { authError, readJson } from '@/lib/auth-route'
import { CHANGE_PASSWORD_COPY, changePasswordProblem } from '@/lib/change-password'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/change-password  (T-201)
 * Change the password from Settings: { currentPassword, newPassword, confirmPassword }.
 *
 * Signed in only. The current password is checked here, on the server, before
 * anything changes: with a client of its own that keeps no session, so the
 * cookies of the person asking are not touched and they stay logged in. A
 * wrong current password is a guess at a password, so the route is limited
 * like log-in (by address and by email), before the check.
 *
 * The email address is not changed here. No password is logged.
 */
export async function POST(request: Request) {
  const C = CHANGE_PASSWORD_COPY
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return authError(401, 'UNAUTHORIZED', C.signedOut)

  const rate = await checkRateLimit('login', { ip: getClientIp(request), key: emailKey(user.email) })
  if (!rate.allowed) return rateLimitedResponse(rate)

  const body = await readJson(request)
  const problem = changePasswordProblem(body, passwordProblem)
  if (problem) return authError(400, 'VALIDATION_ERROR', problem)
  const currentPassword = body?.currentPassword as string
  const newPassword = body?.newPassword as string

  // The current password, checked by logging in with it on a client that is thrown away
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return authError(500, 'CHANGE_FAILED', C.failed)
  const checker = createSupabaseClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { error: wrong } = await checker.auth.signInWithPassword({ email: user.email, password: currentPassword })
  if (wrong) {
    if (wrong.code === 'invalid_credentials' || wrong.status === 400) return authError(400, 'WRONG_PASSWORD', C.wrongCurrent)
    console.error(`[Auth] Current password check failed: ${wrong.code ?? wrong.status ?? 'unknown'}`)
    return authError(500, 'CHANGE_FAILED', C.failed)
  }
  // that check opened a session of its own: close it, and only it
  await checker.auth.signOut({ scope: 'local' }).catch(() => undefined)

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    if (error.code === 'same_password') return authError(400, 'VALIDATION_ERROR', C.same)
    if (error.code === 'weak_password') return authError(400, 'VALIDATION_ERROR', 'That password is too easy to guess. Choose a longer one.')
    console.error(`[Auth] Password change failed: ${error.code ?? error.status ?? 'unknown'}`)
    return authError(500, 'CHANGE_FAILED', C.failed)
  }
  return NextResponse.json({ ok: true })
}
