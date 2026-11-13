/**
 * Words the quote page shows after an action (T-157). Kept out of the page so
 * a message never points at a button that isn't there.
 */

/** After approving a quote whose customer got no email */
export function approvedWithoutEmailMessage(opts: { smsActive: boolean }): string {
  const next = opts.smsActive ? 'use Text link or Copy link' : 'use Copy link'
  return `Approved. No email went out (no customer email or email not set up); ${next} to send it yourself.`
}

/** After Copy link, when the browser refused the clipboard */
export function copyLinkFallbackMessage(url: string): string {
  return `Couldn't copy it for you. Copy this link: ${url}`
}
