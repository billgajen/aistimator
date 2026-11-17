import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { passwordProblem } from '@/lib/auth-flow'
import { authError, readJson } from '@/lib/auth-route'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password  (T-173)
 * Set a new password. Only for someone who is signed in, which is what the
 * link in the reset email does. Rate limited by address.
 */
export async function POST(request: Request) {
  const rate = await checkRateLimit('password_reset', { ip: getClientIp(request) })
  if (!rate.allowed) return rateLimitedResponse(rate)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return authError(401, 'UNAUTHORIZED', 'That link has expired or was already used. Ask for a new one.')

  const body = await readJson(request)
  const problem = passwordProblem(body?.password)
  if (problem) return authError(400, 'VALIDATION_ERROR', problem)

  const { error } = await supabase.auth.updateUser({ password: body?.password as string })
  if (error) {
    if (error.code === 'same_password') return authError(400, 'VALIDATION_ERROR', 'Choose a password you have not used on this account before.')
    if (error.code === 'weak_password') return authError(400, 'VALIDATION_ERROR', 'That password is too easy to guess. Choose a longer one.')
    console.error(`[Auth] Password change failed: ${error.code ?? error.status ?? 'unknown'}`)
    return authError(500, 'RESET_FAILED', 'We could not change the password just now. Please try again.')
  }
  return NextResponse.json({ ok: true })
}
