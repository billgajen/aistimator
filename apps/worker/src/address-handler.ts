/**
 * T-199: the rules of the small Worker that serves businesses' own addresses
 * (yourname.<our domain>). Its own Worker, with its own settings file
 * (wrangler.addresses.toml) and route (*.<our domain>/*): it shares nothing
 * with the job worker but this folder, and holds no database access.
 * The Worker itself is src/addresses.ts, which only hands each request here
 * (a Worker's entry file may export nothing but its handler).
 *
 * What it does with a request to <name>.<our domain>:
 *   - the address itself ("/") shows the business's quote page: the main
 *     site's /quote/<its quote-link name>, fetched and answered here, so the
 *     address bar keeps the address. Not a redirect.
 *   - a path under the quote page (the customer's estimate, what the pages
 *     load, the public API) is fetched from the main site as it is.
 *   - anything else (sign-in, the dashboard, the admin area, the rest of the
 *     site) is answered with a redirect to the main address.
 *   - an address whose business cannot use it now (the web app's one rule
 *     says so) is answered with a redirect to its quote link. The address
 *     stays its own and serves again when it can.
 *   - nobody's address: a redirect to the main address.
 *
 * Which paths are which is `addressRoute` (packages/shared/src/own-address.ts).
 * Whose address it is comes from the web app (GET /api/public/address/:name),
 * kept for a minute in this data centre's cache.
 *
 * No cookie crosses it in either direction: none is passed on to the main
 * site and none is set for the address.
 *
 * The main site counts its public limits per caller's address. Everyone who
 * comes through here would look like one caller, so the Worker passes each
 * caller's own address on, with a key the main site checks (ADDRESS_PROXY_KEY,
 * the same value on both sides). WITHOUT THE KEY IT SERVES NOTHING: every
 * address answers with a redirect to its quote link, which is always safe.
 */
import { ADDRESS_PROXY_HEADERS, addressFromHost, addressRoute } from '@qolumns/shared'

export interface AddressEnv {
  /** The main site: the main address, with its scheme */
  MAIN_ORIGIN: string
  /** What comes after the name: the main domain */
  ADDRESS_HOST: string
  /** Shared with the web app (a secret): lets it trust the caller's address we pass on */
  ADDRESS_PROXY_KEY?: string
}

/** How long a business's answer is reused in a data centre */
export const LOOKUP_SECONDS = 60

export interface AddressLookup {
  slug: string
  serve: boolean
}

/** What the Worker needs from outside, so the rules can be tested without a network */
export interface AddressDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** A small cache of look-ups (the data centre's), or none */
  cache?: { match(key: string): Promise<Response | undefined>; put(key: string, response: Response): Promise<void> } | null
}

const mainOrigin = (env: AddressEnv): string => env.MAIN_ORIGIN.replace(/\/+$/, '')

function redirect(to: string): Response {
  // 302, never permanent: an address that forwards today may serve tomorrow
  return new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } })
}

function tryAgain(): Response {
  return new Response('This page could not be opened just now. Please try again in a moment.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '10', 'Cache-Control': 'no-store' },
  })
}

/** Whose address is it? `null`: nobody's. `'unknown'`: the main site could not be asked. */
export async function lookup(name: string, env: AddressEnv, deps: AddressDeps): Promise<AddressLookup | null | 'unknown'> {
  const url = `${mainOrigin(env)}/api/public/address/${encodeURIComponent(name)}`
  try {
    let response = await deps.cache?.match(url)
    if (!response) {
      response = await deps.fetch(url, { headers: { Accept: 'application/json' } })
      if (response.status === 200 || response.status === 404) {
        const kept = new Response(response.clone().body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${LOOKUP_SECONDS}` } })
        await deps.cache?.put(url, kept)
      }
    }
    if (response.status === 404) return null
    if (response.status !== 200) return 'unknown'
    const body = (await response.json()) as { slug?: unknown; serve?: unknown }
    return typeof body.slug === 'string' && body.slug ? { slug: body.slug, serve: body.serve === true } : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Headers never passed on to the main site: the caller's cookies and anything that says who or where they are */
const NOT_FORWARDED = ['cookie', 'authorization', 'host', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', ADDRESS_PROXY_HEADERS.key, ADDRESS_PROXY_HEADERS.ip]

export async function handleAddress(request: Request, env: AddressEnv, deps: AddressDeps): Promise<Response> {
  const main = mainOrigin(env)
  const url = new URL(request.url)
  const rest = `${url.pathname}${url.search}`
  const name = addressFromHost(request.headers.get('host') ?? url.host, env.ADDRESS_HOST)
  // not an address of ours (a deeper name, or the route caught something else): the same path on the main site
  if (!name) return redirect(`${main}${rest}`)

  const route = addressRoute(url.pathname)
  // sign-in, the dashboard, the admin area, the rest of the site: never served on an address
  if (route.kind === 'main') return redirect(`${main}${rest}`)

  const found = await lookup(name, env, deps)
  if (found === null) return redirect(main)
  if (found === 'unknown') return tryAgain()

  const key = (env.ADDRESS_PROXY_KEY ?? '').trim()
  if (!found.serve || !key) {
    // the business cannot use its address now (or this Worker has no key): its quote link, which always works
    return redirect(route.kind === 'quote_page' ? `${main}/quote/${found.slug}${url.search}` : `${main}${rest}`)
  }

  const target = route.kind === 'quote_page' ? `${main}/quote/${found.slug}${url.search}` : `${main}${rest}`
  const headers = new Headers(request.headers)
  for (const header of NOT_FORWARDED) headers.delete(header)
  headers.set(ADDRESS_PROXY_HEADERS.key, key)
  const caller = request.headers.get('cf-connecting-ip')
  if (caller) headers.set(ADDRESS_PROXY_HEADERS.ip, caller)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let answer: Response
  try {
    answer = await deps.fetch(target, { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: 'manual', ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit)
  } catch {
    return tryAgain()
  }

  const out = new Headers(answer.headers)
  // no cookie is ever set for an address
  out.delete('set-cookie')
  // a redirect of the main site's to one of the served pages stays on the address
  const location = out.get('location')
  if (location) {
    try {
      const to = new URL(location, target)
      if (to.origin === new URL(main).origin && addressRoute(to.pathname).kind === 'serve') out.set('location', `${url.origin}${to.pathname}${to.search}`)
      else out.set('location', to.toString())
    } catch {
      // left as the main site wrote it
    }
  }
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out })
}
