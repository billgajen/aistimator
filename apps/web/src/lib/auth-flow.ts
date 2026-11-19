/**
 * T-173: sign-up and password reset, done by the server.
 *
 * The browser used to call Supabase directly, and Supabase sent the emails
 * with its built-in sender (a few an hour, its own wording). Now the server
 * asks Supabase for the link (admin API: it sends nothing), and sends the
 * email itself through Postmark. The routes in app/api/auth put the rate
 * limits and the human check in front of this.
 *
 * Nothing here tells a caller whether an address has an account: sign-up and
 * reset answer the same either way, and the difference arrives by email.
 *
 * Without Postmark: outside production the link is written to the server log
 * (so the product can be used on a laptop); in production the caller is told
 * the email could not be sent.
 */
import type { SignupSource } from '@/lib/signup-source'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail, isPostmarkConfigured } from '@/lib/postmark'
import { alreadyRegisteredEmail, confirmEmail, resetPasswordEmail } from '@/lib/auth-emails'

export type AuthLinkType = 'signup' | 'recovery'

export const PASSWORD_MIN_LENGTH = 8
/** bcrypt, which Supabase uses, reads no more than 72 bytes */
export const PASSWORD_MAX_LENGTH = 72
export const BUSINESS_NAME_MAX_LENGTH = 120
const EMAIL_MAX_LENGTH = 254

export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) return `Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_LENGTH) return `Choose a password of at most ${PASSWORD_MAX_LENGTH} characters.`
  return null
}

/**
 * The site's own address, for links in emails. Production uses the configured
 * address only: a link built from the request's Host header could be pointed
 * at someone else's site by whoever sent the request.
 */
export function siteOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  if (process.env.NODE_ENV === 'production') return configured || 'http://localhost:3000'
  try {
    return new URL(request.url).origin
  } catch {
    return configured || 'http://localhost:3000'
  }
}

/** The page a link in an email opens. It shows one button; pressing it uses the link. */
export function confirmPageUrl(origin: string, type: AuthLinkType, tokenHash: string): string {
  return `${origin}/auth/confirm?type=${type}&token_hash=${encodeURIComponent(tokenHash)}`
}

export type AuthMailResult = { ok: true } | { ok: false; reason: 'email-not-sent' | 'failed' }

async function deliver(to: string, email: { subject: string; htmlBody: string; textBody: string }, tag: string, linkForLocalUse: string): Promise<AuthMailResult> {
  if (!isPostmarkConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[Auth] EMAIL OFF: Postmark is not configured (POSTMARK_API_TOKEN, POSTMARK_FROM_EMAIL), so the ${tag} email was not sent`)
      return { ok: false, reason: 'email-not-sent' }
    }
    // A laptop without Postmark: the link goes to the log so the flow can be finished by hand
    console.warn(`[Auth] EMAIL OFF: Postmark is not configured, so the ${tag} email was not sent. Local use only, open: ${linkForLocalUse}`)
    return { ok: true }
  }
  const sent = await sendEmail({ from: { kind: 'business' }, to, subject: email.subject, htmlBody: email.htmlBody, textBody: email.textBody, tag })
  if (!sent.success) {
    console.error(`[Auth] The ${tag} email could not be sent: ${sent.error ?? 'unknown error'}`)
    return { ok: false, reason: 'email-not-sent' }
  }
  return { ok: true }
}

/**
 * Start a sign-up: make the (unconfirmed) account and email its confirmation
 * link. The business itself is created when the address is confirmed, by the
 * database trigger, as before. An address that already has an account gets an
 * email saying so, and the caller is told nothing different.
 */
export async function startSignup(input: {
  email: string
  password: string
  businessName: string
  selectedPlan: string | null
  /** T-189: the first-visit source, already cleaned by the route */
  signupSource?: SignupSource | null
  origin: string
}): Promise<AuthMailResult> {
  const email = input.email.trim().toLowerCase()
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email,
    password: input.password,
    options: {
      data: {
        business_name: input.businessName,
        ...(input.selectedPlan && { selected_plan: input.selectedPlan }),
        ...(input.signupSource && { signup_source: input.signupSource }),
      },
    },
  })

  if (error) {
    if (error.code === 'email_exists') {
      return deliver(
        email,
        alreadyRegisteredEmail({ loginUrl: `${input.origin}/login`, forgotUrl: `${input.origin}/forgot-password` }),
        'account-exists',
        `${input.origin}/login`
      )
    }
    console.error(`[Auth] Sign-up link could not be made: ${error.code ?? error.status ?? 'unknown'}`)
    return { ok: false, reason: 'failed' }
  }

  const tokenHash = data.properties?.hashed_token
  if (!tokenHash) {
    console.error('[Auth] Sign-up link came back without a token')
    return { ok: false, reason: 'failed' }
  }
  const confirmUrl = confirmPageUrl(input.origin, 'signup', tokenHash)
  return deliver(email, confirmEmail({ businessName: input.businessName, confirmUrl }), 'confirm-email', confirmUrl)
}

/** Email a password reset link, if the address has an account. The caller is told the same either way. */
export async function startPasswordReset(input: { email: string; origin: string }): Promise<AuthMailResult> {
  const email = input.email.trim().toLowerCase()
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (error) {
    if (error.code === 'user_not_found') return { ok: true }
    console.error(`[Auth] Reset link could not be made: ${error.code ?? error.status ?? 'unknown'}`)
    return { ok: false, reason: 'failed' }
  }
  const tokenHash = data.properties?.hashed_token
  if (!tokenHash) {
    console.error('[Auth] Reset link came back without a token')
    return { ok: false, reason: 'failed' }
  }
  const resetUrl = confirmPageUrl(input.origin, 'recovery', tokenHash)
  return deliver(email, resetPasswordEmail({ resetUrl }), 'password-reset', resetUrl)
}

export const EMAIL_NOT_SENT_MESSAGE = 'We could not send the email just now. Please try again in a few minutes.'
