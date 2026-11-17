/**
 * T-178: a public rate limit that can run in the middleware (the Edge
 * runtime), so a blocked page view is answered with a real 429.
 *
 * The quote link page (/quote/{slug}) used to check its own limit while
 * rendering. A page that is already rendering cannot change its status, so a
 * blocked visitor got the "too many requests" words with status 200: the
 * limit worked, but nothing watching status codes could see it.
 *
 * Same counters, keys and decision as lib/rate-limit.ts (rate-limit-counters.ts);
 * the only difference is how Upstash is called: its REST pipeline through
 * fetch, with no SDK, because the middleware cannot load Node modules. It
 * fails open the same way (AD-055): not configured, slow (1.5 seconds) or
 * failing means the request goes ahead and the log says so.
 */
import { RATE_LIMIT_TIMEOUT_MS, blockedMessage, type RateLimitScope } from './rate-limit-config'
import { buildCounters, evaluateCounters, type RateLimitResult } from './rate-limit-counters'

const OPEN: RateLimitResult = { allowed: true, retryAfterSeconds: 0 }

export async function checkRateLimitEdge(
  scope: RateLimitScope,
  identifiers: { ip?: string; key?: string },
  // Read by name (the Edge runtime only promises `process.env.NAME`); a test passes its own
  store: { url?: string; token?: string } = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN },
  fetchImpl: typeof fetch = fetch
): Promise<RateLimitResult> {
  const { url, token } = store
  if (!url || !token) return OPEN
  try {
    const counters = buildCounters(scope, identifiers, Math.floor(Date.now() / 1000))
    if (counters.length === 0) return OPEN
    const commands = counters.flatMap((c) => [
      ['INCR', c.key],
      ['EXPIRE', c.key, c.ttlSeconds],
    ])
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Upstash answered ${response.status}`)
    const results = (await response.json()) as Array<{ result?: unknown; error?: string }>
    // Results alternate [incr, expire, incr, expire, ...]: keep the incr values
    const counts = counters.map((_, i) => {
      const value = results[i * 2]?.result
      return typeof value === 'number' ? value : null
    })
    const result = evaluateCounters(counters, counts)
    if (!result.allowed) console.warn(`[RateLimit] Blocked ${scope} request (${result.limitType} limit, ${result.retryAfterSeconds}s left)`)
    return result
  } catch (error) {
    // The name only: never the address, the business or Upstash's own message
    console.error(`[RateLimit] FAILING OPEN: Upstash did not answer for ${scope}; the request went ahead unchecked: ${error instanceof Error ? error.name : 'unknown error'}`)
    return OPEN
  }
}

/** The quote link page's limit: one address, and one business's link from everyone together */
export async function quotePageLimit(pathname: string, forwardedFor: string | null, realIp: string | null): Promise<RateLimitResult> {
  const slug = decodeURIComponent(pathname.split('/')[2] ?? '').toLowerCase().slice(0, 60)
  if (!slug) return OPEN
  const ip = forwardedFor?.split(',')[0]?.trim() || realIp?.trim() || 'unknown'
  return checkRateLimitEdge('quote_page', { ip, key: `slug:${slug}` })
}

/** A plain 429 page: the same words the page used to render, now with the right status */
export function tooManyPageResponse(result: RateLimitResult): Response {
  const wait = result.retryAfterSeconds || 60
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Too many requests</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAF9F6;color:#1B2823;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:0 16px"><p style="font-size:14px;max-width:28rem;text-align:center">${blockedMessage(wait)}</p></body></html>`
  return new Response(html, {
    status: 429,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': String(wait), 'Cache-Control': 'no-store' },
  })
}
