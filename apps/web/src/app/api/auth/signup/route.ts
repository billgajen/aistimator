import { NextResponse } from 'next/server'
import { checkRateLimit, emailKey, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { verifyTurnstileToken, HUMAN_CHECK_FAILED_MESSAGE } from '@/lib/turnstile'
import { BUSINESS_NAME_MAX_LENGTH, EMAIL_NOT_SENT_MESSAGE, passwordProblem, siteOrigin, startSignup, validEmail } from '@/lib/auth-flow'
import { authError, readJson } from '@/lib/auth-route'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/signup  (T-173)
 * Start a sign-up. In order: honeypot, rate limit (by address and by email),
 * human check, then the account and its confirmation email. The answer is the
 * same whether or not the address already has an account.
 */
export async function POST(request: Request) {
  const body = await readJson(request)
  if (!body) return authError(400, 'VALIDATION_ERROR', 'Something was missing. Please try again.')

  // Honeypot: a field people never see. A filled one gets the ordinary answer and nothing happens.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn('[Auth] Honeypot tripped on sign-up')
    return NextResponse.json({ ok: true })
  }

  const email = body.email
  if (!validEmail(email)) return authError(400, 'VALIDATION_ERROR', 'Enter a valid email address.')

  const ip = getClientIp(request)
  const rate = await checkRateLimit('signup', { ip, key: emailKey(email) })
  if (!rate.allowed) return rateLimitedResponse(rate)

  const turnstile = await verifyTurnstileToken(typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined, ip)
  if (!turnstile.ok) return authError(403, 'VERIFICATION_FAILED', HUMAN_CHECK_FAILED_MESSAGE)

  const problem = passwordProblem(body.password)
  if (problem) return authError(400, 'VALIDATION_ERROR', problem)
  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : ''
  if (!businessName) return authError(400, 'VALIDATION_ERROR', 'Enter your business name.')
  if (businessName.length > BUSINESS_NAME_MAX_LENGTH) {
    return authError(400, 'VALIDATION_ERROR', `Keep the business name under ${BUSINESS_NAME_MAX_LENGTH} characters.`)
  }
  // T-150: the plan picked on the pricing page rides along; it never starts a checkout
  const selectedPlan = typeof body.plan === 'string' && /^[a-z0-9_]{1,40}$/.test(body.plan) ? body.plan : null

  const result = await startSignup({
    email,
    password: body.password as string,
    businessName,
    selectedPlan,
    origin: siteOrigin(request),
  })
  if (!result.ok) {
    return result.reason === 'email-not-sent'
      ? authError(503, 'EMAIL_NOT_SENT', EMAIL_NOT_SENT_MESSAGE)
      : authError(500, 'SIGNUP_FAILED', 'We could not create the account just now. Please try again.')
  }
  return NextResponse.json({ ok: true })
}
