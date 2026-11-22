/**
 * T-199: can this business start a quote in the app? (Pure.)
 *
 * The app is open to every business, on any plan or none: its quotes,
 * approving and sending, notifications, the account, reporting a problem.
 * Only starting a quote on site needs a plan that includes it (or the free
 * start). The server says which (`onsiteQuotes` in GET /api/app/bootstrap,
 * by the one rule in @qolumns/shared) and decides again when a quote is
 * sent, so an older build of the app cannot get round it.
 *
 * When the answer is no, "New quote" shows one screen and STARTS NOTHING: no
 * draft is made. The screen has no price, no link and no way to buy (the App
 * Store's rule): a heading, a sentence and "OK". Its words come from the
 * server, with the shared ones as the fallback, so every build says the same.
 *
 * When the phone cannot ask (no signal and nothing remembered), the form
 * opens as it always did and the server decides when the quote is sent.
 */
import { onsiteNotInPlan, type AppBootstrapResponse } from '@qolumns/shared'

export interface OnsiteWords {
  heading: string
  text: string
  button: string
}

export type OnsiteGate = { state: 'checking' } | { state: 'open' } | { state: 'closed'; words: OnsiteWords }

type Boot = Pick<AppBootstrapResponse, 'onsiteQuotes' | 'onsiteNotInPlan'>

/** `boot`: what the server last said (live, else remembered on the phone). `settled`: both have been tried. */
export function onsiteGate(boot: Boot | null | undefined, settled: boolean): OnsiteGate {
  if (boot?.onsiteQuotes === false) {
    const fallback = onsiteNotInPlan()
    const said = boot.onsiteNotInPlan
    const words = said && said.heading && said.text && said.button ? { heading: said.heading, text: said.text, button: said.button } : { heading: fallback.heading, text: fallback.text, button: fallback.button }
    return { state: 'closed', words }
  }
  // true, or a server from before T-199 (it says nothing): the form opens and the server decides
  if (boot) return { state: 'open' }
  return settled ? { state: 'open' } : { state: 'checking' }
}

/** T-199: the home tab's account line. A failed payment is said plainly, with nothing to do about it here: the app never points at paying. */
export const PAYMENT_NOTICE = 'A payment for your account did not go through. Your quotes keep running while it is tried again.'

export function accountNoticeLine(notice: { kind: 'payment_failed' | 'suspended'; line: string }): string {
  return notice.kind === 'payment_failed' ? PAYMENT_NOTICE : notice.line
}
