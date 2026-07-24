/**
 * Cloudflare Turnstile server-side verification.
 *
 * Enforcement is keyed on TURNSTILE_SECRET_KEY: unset → verification is
 * skipped entirely (fail-open, same philosophy as rate limiting and
 * plan-limits). When set, a missing or rejected token blocks the request,
 * but Cloudflare outages/network errors fail open — the bot check must
 * never take quote intake down with it.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerification {
  ok: boolean
  reason?: 'missing-token' | 'rejected'
}

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp: string
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
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

    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!response.ok) {
      console.error(`[Turnstile] siteverify HTTP ${response.status} — failing open`)
      return { ok: true }
    }

    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) {
      return { ok: true }
    }

    console.warn('[Turnstile] Token rejected:', data['error-codes'] ?? [])
    return { ok: false, reason: 'rejected' }
  } catch (error) {
    console.error('[Turnstile] siteverify unreachable — failing open:', error)
    return { ok: true }
  }
}
