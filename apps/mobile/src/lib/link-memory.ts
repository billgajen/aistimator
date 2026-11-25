/**
 * T-204: the business's quote link, kept on the phone.
 *
 * "Your quote link" used to draw its QR code only after it had asked the
 * server for the whole account again (the name, the logo, the plan and its
 * usage), although the Account tab it was opened from had just read the very
 * same thing. On a weak signal on site that was seconds of a grey square,
 * with a customer waiting.
 *
 * Now the link is remembered when the Account tab reads it: in memory, so the
 * screen draws the code in its first frame, and on the phone, so it draws at
 * once the next time the app is opened too, even with no signal. The screen
 * still asks the server quietly and redraws only if the link has changed
 * (a business can change its address).
 *
 * Kept per signed-in user: another account on the same phone never sees it.
 * A quote link is a public address, not a secret.
 */
import * as SecureStore from 'expo-secure-store'

export interface SavedLink {
  userId: string
  businessName: string
  /** Null when the business has no quote link yet */
  quoteLink: string | null
}

const KEY = 'quote_link_v1'

let memory: SavedLink | null = null

/** What is stored, as a saved link for this user; null when it is someone else's, or not readable */
export function readSavedLink(raw: string | null | undefined, userId: string | null): SavedLink | null {
  if (!raw || !userId) return null
  try {
    const value = JSON.parse(raw) as Partial<SavedLink> | null
    if (!value || value.userId !== userId || typeof value.businessName !== 'string') return null
    const link = typeof value.quoteLink === 'string' && /^https?:\/\//.test(value.quoteLink) ? value.quoteLink : null
    return { userId, businessName: value.businessName, quoteLink: link }
  } catch {
    return null
  }
}

/** The link held in memory for this user: there the moment the Account tab has loaded once */
export function linkInMemory(userId: string | null): SavedLink | null {
  return memory && userId && memory.userId === userId ? memory : null
}

/** The link saved on the phone for this user (a few milliseconds; no network) */
export async function loadSavedLink(userId: string | null): Promise<SavedLink | null> {
  const held = linkInMemory(userId)
  if (held) return held
  try {
    const saved = readSavedLink(await SecureStore.getItemAsync(KEY), userId)
    if (saved) memory = saved
    return saved
  } catch {
    return null
  }
}

/** Remember what the server just said. Never throws: the screen that read it must not fail on this. */
export async function rememberLink(userId: string | null, account: { businessName: string; quoteLink: string | null }): Promise<void> {
  if (!userId) return
  const next: SavedLink = { userId, businessName: account.businessName, quoteLink: account.quoteLink }
  const same = memory && memory.userId === next.userId && memory.businessName === next.businessName && memory.quoteLink === next.quoteLink
  memory = next
  if (same) return
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next))
  } catch {
    // in memory for this run of the app; saved the next time it is read
  }
}

/** For the checks */
export function forgetLinkInMemory(): void {
  memory = null
}
