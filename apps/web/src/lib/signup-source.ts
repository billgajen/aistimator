/**
 * T-189: where a new business came from.
 *
 * Until now nothing was recorded: a sign-up carried its email, its business
 * name and the plan picked on the Pricing page, and nothing about how the
 * person found us.
 *
 * What is kept is small and holds nothing that identifies a person:
 *   - the campaign tags on the link they followed (utm_source and the rest);
 *   - the site they came from, as a host name only ("google.com"), never the
 *     page or its query;
 *   - the first page of ours they opened, as a path only, never its query.
 *
 * No cookie is set (the Privacy Policy's cookies are the sign-in session, the
 * human check and Meta's on our marketing pages). The first visit is held in
 * the browser tab (sessionStorage), is gone when the tab is closed, and is
 * sent to us only with the sign-up form. The server cleans it again before it
 * is stored: what a browser sends is never trusted to be the right shape.
 */

export interface SignupSource {
  utm?: Partial<Record<UtmKey, string>>
  /** The host of the site they came from, when it is not ours */
  referrer?: string
  /** The path of the first page of ours they opened */
  landing?: string
  /** When that first visit was (ISO) */
  at?: string
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const
export type UtmKey = (typeof UTM_KEYS)[number]

export const FIRST_VISIT_KEY = 'qolumns:first-visit'
const MAX = 120

const short = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  // printable, one line, no markup
  const cleaned = [...value]
    .filter((ch) => {
      const at = ch.charCodeAt(0)
      return at > 31 && at !== 127 && ch !== '<' && ch !== '>'
    })
    .join('')
    .trim()
    .slice(0, MAX)
  return cleaned || undefined
}

const hostOf = (value: unknown): string | undefined => {
  const text = short(value)
  if (!text) return undefined
  const host = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]?.replace(/^www\./i, '').toLowerCase()
  return host && /^[a-z0-9.-]+(:\d+)?$/.test(host) ? host : undefined
}

const pathOf = (value: unknown): string | undefined => {
  const text = short(value)
  if (!text || !text.startsWith('/')) return undefined
  return text.split(/[?#]/)[0]
}

/** The source of a first visit, from the address opened and where the browser came from (pure) */
export function firstVisitSource(input: { url: string; referrer?: string | null; now?: Date }): SignupSource {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return {}
  }
  const utm: Partial<Record<UtmKey, string>> = {}
  for (const key of UTM_KEYS) {
    const value = short(url.searchParams.get(`utm_${key}`))
    if (value) utm[key] = value
  }
  const from = hostOf(input.referrer)
  const own = hostOf(url.host)
  return {
    ...(Object.keys(utm).length > 0 && { utm }),
    ...(from && from !== own && { referrer: from }),
    landing: pathOf(url.pathname) ?? '/',
    at: (input.now ?? new Date()).toISOString(),
  }
}

/**
 * What the server keeps of a source a browser sent: the known keys, as short
 * plain strings, a host and a path. Null when nothing usable is left.
 */
export function cleanSignupSource(input: unknown): SignupSource | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const utmIn = typeof raw.utm === 'object' && raw.utm !== null && !Array.isArray(raw.utm) ? (raw.utm as Record<string, unknown>) : {}
  const utm: Partial<Record<UtmKey, string>> = {}
  for (const key of UTM_KEYS) {
    const value = short(utmIn[key])
    if (value) utm[key] = value
  }
  const referrer = hostOf(raw.referrer)
  const landing = pathOf(raw.landing)
  const at = typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? new Date(raw.at).toISOString() : undefined
  const cleaned: SignupSource = {
    ...(Object.keys(utm).length > 0 && { utm }),
    ...(referrer && { referrer }),
    ...(landing && { landing }),
    ...(at && { at }),
  }
  return cleaned.utm || cleaned.referrer || cleaned.landing ? cleaned : null
}

/** One line for the admin's list: "google / cpc / spring · from instagram.com · first page /pricing" */
export function signupSourceLine(input: unknown): string {
  const source = cleanSignupSource(input)
  if (!source) return 'Not recorded'
  const parts: string[] = []
  const tags = [source.utm?.source, source.utm?.medium, source.utm?.campaign].filter(Boolean)
  if (tags.length > 0) parts.push(tags.join(' / '))
  if (source.referrer) parts.push(`from ${source.referrer}`)
  else if (tags.length === 0) parts.push('came directly')
  if (source.landing) parts.push(`first page ${source.landing}`)
  return parts.join(' · ')
}

/**
 * Remember this tab's first visit, once. Called on our marketing pages and on
 * the sign-up page. Does nothing when the tab already has one, or when the
 * browser gives no storage (a private window): the sign-up then carries none.
 */
export function rememberFirstVisit(): void {
  try {
    if (typeof window === 'undefined' || window.sessionStorage.getItem(FIRST_VISIT_KEY)) return
    window.sessionStorage.setItem(FIRST_VISIT_KEY, JSON.stringify(firstVisitSource({ url: window.location.href, referrer: document.referrer })))
  } catch {
    // no storage: nothing is kept
  }
}

/** The first visit this tab remembers, for the sign-up form to send */
export function readFirstVisit(): SignupSource | null {
  try {
    if (typeof window === 'undefined') return null
    const stored = window.sessionStorage.getItem(FIRST_VISIT_KEY)
    return stored ? cleanSignupSource(JSON.parse(stored)) : null
  } catch {
    return null
  }
}
