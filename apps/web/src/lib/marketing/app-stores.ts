/**
 * T-187: where the on-site app can be downloaded. Nothing is shown until an
 * address is set: a badge appears only for a store whose URL is in the
 * environment, so the site can never point at a store page that does not
 * exist.
 *
 *   APP_STORE_URL    the app's page on Apple's App Store
 *   PLAY_STORE_URL   the app's page on Google Play
 *
 * Both are read on the server when the page is built. A value that is not an
 * https address is ignored. There is no Android app: leaving PLAY_STORE_URL
 * empty is what keeps the site from saying there is one.
 */
export interface StoreLink {
  store: 'app-store' | 'play-store'
  url: string
  /** The words on the badge slot (a plain link: a store's own badge artwork is theirs, and is added with the URL) */
  label: string
}

const httpsUrl = (value: string | undefined): string | null => {
  const text = (value ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The stores to show a badge for: only those whose address is set */
export function storeLinks(env: Record<string, string | undefined> = process.env): StoreLink[] {
  const links: StoreLink[] = []
  const apple = httpsUrl(env.APP_STORE_URL)
  if (apple) links.push({ store: 'app-store', url: apple, label: 'Download on the App Store' })
  const google = httpsUrl(env.PLAY_STORE_URL)
  if (google) links.push({ store: 'play-store', url: google, label: 'Get it on Google Play' })
  return links
}
