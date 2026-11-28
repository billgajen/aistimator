/**
 * T-211: the bot check before a call. The check itself is the site's own (lib/turnstile.ts).
 *
 * A request form lets a request through when the check could not be run (AD-060): a lost request
 * costs a business a customer. A call is different: it costs money by the minute from its first
 * second, so **a call does not start without a passed check**. Where the check is not set up at
 * all (no keys: a local machine, the checks) there is no check to pass, and the call starts.
 *
 * Pure.
 */
import type { TurnstileVerification } from '@/lib/turnstile'

export type HumanCheck = 'passed' | 'not_set_up' | 'failed' | 'not_run'

export function humanCheckOf(verification: TurnstileVerification): HumanCheck {
  if (!verification.ok) return 'failed'
  if (verification.unchecked === undefined) return 'passed'
  // 'off': the site has no check. Anything else: the check exists and did not give a yes (no token, no answer).
  return verification.unchecked === 'off' ? 'not_set_up' : 'not_run'
}

export const mayStartCall = (check: HumanCheck): boolean => check === 'passed' || check === 'not_set_up'

/** How long the check is given to answer before a call: it has to say yes, so it is given longer than a form gives it */
export const HUMAN_CHECK_TIMEOUT_MS = 3_000

export const HUMAN_CHECK_MESSAGE = 'We could not confirm you are a person, so the call was not started. Please try again.'
