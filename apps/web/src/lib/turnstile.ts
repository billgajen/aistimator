/**
 * Cloudflare Turnstile server-side verification.
 *
 * The rule (T-178, AD-060): the human check may only stop a request when
 * Cloudflare itself clearly says the token is bad. Everything else lets the
 * request through and says so in the log:
 *   - no token came with the request (the script was blocked, never loaded
 *     or gave up in the customer's browser);
 *   - Cloudflare did not answer within half a second, or answered with an
 *     error, or could not be reached;
 *   - Cloudflare answered "no" for a reason that is ours or its own (a bad
 *     secret, a malformed call, an internal error).
 * A bot that sends no token is therefore not stopped here: the rate limits
 * and the hidden field are what stop it. That is deliberate: the bot check
 * must never be the reason a real customer's request is lost.
 *
 * The check is on only when BOTH keys are set: TURNSTILE_SECRET_KEY (the
 * server's) and NEXT_PUBLIC_TURNSTILE_SITE_KEY (the browser's). It can be
 * switched off with one setting, TURNSTILE_OFF=true, without removing either
 * key.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** How long Cloudflare is given to answer before the request goes ahead without the check */
export const SITEVERIFY_TIMEOUT_MS = 500

/**
 * Cloudflare's answers that mean "this token is not a real, fresh one". Its
 * other error codes (a bad secret, a malformed call, an internal error) are
 * not the visitor's doing and never block.
 */
const CLEAR_FAILURES: readonly string[] = ['invalid-input-response', 'timeout-or-duplicate']

const on = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())

/** The one switch that turns the human check off (the keys can stay where they are) */
export function turnstileSwitchedOff(): boolean {
  return on(process.env.TURNSTILE_OFF)
}

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
  /** Only ever 'rejected': Cloudflare clearly said the token is bad */
  reason?: 'rejected'
  /** The request went ahead without a verdict, and why (for tests and logs) */
  unchecked?: 'off' | 'no-token' | 'no-answer' | 'not-the-visitor'
}

export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && !turnstileSwitchedOff()
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
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || turnstileSwitchedOff()) {
    if (!warnedOff) {
      warnedOff = true
      console.warn(
        turnstileSwitchedOff()
          ? '[Turnstile] PROTECTION OFF: switched off with TURNSTILE_OFF, so no human check is made'
          : '[Turnstile] PROTECTION OFF: TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY are not both set, so no human check is made'
      )
    }
    return { ok: true, unchecked: 'off' }
  }

  if (!token) {
    // The script was blocked, never loaded or gave up in the browser. Not a "failed" answer: the request goes ahead.
    console.warn('[Turnstile] FAILING OPEN: the request came with no token (the check did not run in the browser); it went ahead unchecked')
    return { ok: true, unchecked: 'no-token' }
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
      return { ok: true, unchecked: 'no-answer' }
    }

    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success === true) {
      return { ok: true }
    }

    const codes = Array.isArray(data['error-codes']) ? data['error-codes'] : []
    if (data.success === false && codes.some((code) => CLEAR_FAILURES.includes(code))) {
      console.warn('[Turnstile] Token rejected:', codes)
      return { ok: false, reason: 'rejected' }
    }

    // "No", but not about the visitor (our secret, a malformed call, Cloudflare's own error), or no clear answer at all
    console.error('[Turnstile] FAILING OPEN: siteverify gave no clear verdict on the visitor; the request went ahead unchecked:', codes)
    return { ok: true, unchecked: 'not-the-visitor' }
  } catch (error) {
    // The name only (TimeoutError, TypeError): a message can carry an address
    console.error(`[Turnstile] FAILING OPEN: siteverify did not answer within ${SITEVERIFY_TIMEOUT_MS} ms or could not be reached; the request went ahead unchecked: ${error instanceof Error ? error.name : 'unknown error'}`)
    return { ok: true, unchecked: 'no-answer' }
  }
}
