import { NextResponse } from 'next/server'
import { checkRateLimit, emailKey, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { EMAIL_NOT_SENT_MESSAGE, siteOrigin, startPasswordReset, validEmail } from '@/lib/auth-flow'
import { authError, readJson } from '@/lib/auth-route'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/forgot-password  (T-173)
 * Email a password reset link. Rate limited by address and by email. The
 * answer is the same whether or not the address has an account.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  const email = body?.email
  if (!validEmail(email)) return authError(400, 'VALIDATION_ERROR', 'Enter a valid email address.')
  if (typeof body?.website === 'string' && body.website.trim() !== '') return NextResponse.json({ ok: true })

  const rate = await checkRateLimit('password_reset', { ip: getClientIp(request), key: emailKey(email) })
  if (!rate.allowed) return rateLimitedResponse(rate)

  const result = await startPasswordReset({ email, origin: siteOrigin(request) })
  if (!result.ok) {
    return result.reason === 'email-not-sent'
      ? authError(503, 'EMAIL_NOT_SENT', EMAIL_NOT_SENT_MESSAGE)
      : authError(500, 'RESET_FAILED', 'We could not start the reset just now. Please try again.')
  }
  return NextResponse.json({ ok: true })
}
