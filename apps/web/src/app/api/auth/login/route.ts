import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, emailKey, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { validEmail } from '@/lib/auth-flow'
import { authError, readJson } from '@/lib/auth-route'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login  (T-173)
 * Log in with email and password. Rate limited by address and by email
 * before the password is checked. The session cookies are set here, exactly
 * as the browser's own call to Supabase used to set them.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  const email = body?.email
  const password = body?.password
  if (!validEmail(email) || typeof password !== 'string' || !password) {
    return authError(400, 'VALIDATION_ERROR', 'Enter your email and password.')
  }

  const rate = await checkRateLimit('login', { ip: getClientIp(request), key: emailKey(email) })
  if (!rate.allowed) return rateLimitedResponse(rate)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) {
    if (error.code === 'email_not_confirmed') {
      return authError(403, 'EMAIL_NOT_CONFIRMED', 'Your email is not confirmed yet. Open the link we emailed you. To get a new link, sign up again with the same address.')
    }
    if (error.code === 'invalid_credentials' || error.status === 400) {
      return authError(401, 'INVALID_LOGIN', 'That email and password do not match an account.')
    }
    console.error(`[Auth] Log-in failed: ${error.code ?? error.status ?? 'unknown'}`)
    return authError(500, 'LOGIN_FAILED', 'We could not log you in just now. Please try again.')
  }
  return NextResponse.json({ ok: true })
}
