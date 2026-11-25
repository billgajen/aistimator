/**
 * T-202: "Try again" on a request that could not be priced (pure).
 *
 * The same button, the same words and the same server action as the
 * dashboard's quote page (T-201): the rules and the sentences are the shared
 * ones (`RETRY_COPY`, `QUOTE_TURN_COPY.pageButtons`), the server counts the
 * tries (five a request) and never counts the request against the plan again.
 * Nothing is decided here: the server says how many tries are left.
 */
import { QUOTE_TURN_COPY, RETRY_COPY, type AppQuoteView } from '@qolumns/shared'
import { plainError } from './errors'

/**
 *   offer   the request could not be priced and a try is left: the button shows
 *   used    every try is used: no button, the sentence that says what to do now
 *   null    not a failed request, or a server from before T-202 (it says nothing
 *           about tries, so the screen is as it was: reach the customer)
 */
export type TryAgainState = 'offer' | 'used' | null

export function tryAgainState(q: Pick<AppQuoteView, 'status' | 'tryAgain'>): TryAgainState {
  if (q.status !== 'failed' || !q.tryAgain) return null
  return q.tryAgain.left > 0 ? 'offer' : 'used'
}

/** The button's words: "Try again", and "Starting…" while the request is on its way */
export const TRY_AGAIN_BUTTON = { title: QUOTE_TURN_COPY.pageButtons.tryAgain, busy: QUOTE_TURN_COPY.pageButtons.tryingAgain } as const

/** Said while the price is worked out again */
export const TRY_AGAIN_STARTED = RETRY_COPY.started

/** Said in place of the button when the tries are used */
export const TRY_AGAIN_USED = RETRY_COPY.limit

/**
 * What to say when the try was refused or never arrived. The server's own
 * sentence where it has one (a paused account, the limit); the dashboard's
 * "Could not start pricing. Try again." for anything else; the app's own
 * no-signal line when the phone is offline.
 */
export function tryAgainError(thrown: unknown): string {
  return plainError(thrown, RETRY_COPY.notStarted)
}
