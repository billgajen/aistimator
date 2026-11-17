/**
 * Cloudflare Turnstile server-side verification.
 *
 * The check is on only when BOTH keys are set: TURNSTILE_SECRET_KEY (the
 * server's) and NEXT_PUBLIC_TURNSTILE_SITE_KEY (the browser's). With either
 * missing it is skipped entirely and the log says so (fail-open, same
 * philosophy as rate limiting and plan-limits). T-173: the site key is
 * required too, because with only the secret set no browser could make a
 * token and every request would be refused. When on, a missing or rejected
 * token blocks the request, but Cloudflare outages/network errors fail open:
 * the bot check must never take quote intake down with it.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** How long Cloudflare is given to answer before the request goes ahead without the check */
const SITEVERIFY_TIMEOUT_MS = 5000

/**
 * Where a token is checked. T-173: outside production a test can point this
 * at a stand-in (TURNSTILE_VERIFY_URL); in production it is always Cloudflare.
 */
function siteverifyUrl(): string {
  const override = process.env.TURNSTILE_VERIFY_URL
  if (override && process.env.NODE_ENV !== 'production') return override
  return SITEVERIFY_URL
}

export interface TurnstileVerification {
  ok: boolean
  reason?: 'missing-token' | 'rejected'
}

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

/** What a person is told when the check fails. Nothing they typed is lost; trying again runs the check afresh. */
export const HUMAN_CHECK_FAILED_MESSAGE =
  'We could not confirm you are a person. Please try again. If it keeps happening, turn off any content blocker for this page.'

let warnedOff = false

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    if (!warnedOff) {
      warnedOff = true
      console.warn('[Turnstile] PROTECTION OFF: TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY are not both set, so no human check is made')
    }
    return { ok: true }
  }

  if (!token) {
    console.warn('[Turnstile] Blocked request with no token')
    return { ok: false, reason: 'missing-token' }
  }

  try {
    const params = new URLSearchParams({ secret, response: token })
    if (remoteIp && remoteIp !== 'unknown') {
      params.set('remoteip', remoteIp)
    }

    const response = await fetch(siteverifyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error(`[Turnstile] FAILING OPEN: siteverify HTTP ${response.status}; the request went ahead unchecked`)
      return { ok: true }
    }

    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) {
      return { ok: true }
    }

    console.warn('[Turnstile] Token rejected:', data['error-codes'] ?? [])
    return { ok: false, reason: 'rejected' }
  } catch (error) {
    console.error('[Turnstile] FAILING OPEN: siteverify unreachable; the request went ahead unchecked:', error instanceof Error ? error.message : 'unknown error')
    return { ok: true }
  }
}
