/**
 * Bearer-token check for the worker's job endpoints (/process, /trigger,
 * /stats). The web app sends `Authorization: Bearer <CLOUDFLARE_WORKER_TOKEN>`.
 * Fails closed: outside local development a missing secret rejects every
 * request instead of leaving the endpoints open.
 */

export interface WorkerAuthEnv {
  ENVIRONMENT?: string
  CLOUDFLARE_WORKER_TOKEN?: string
}

/** Constant-time string comparison (no early exit on the first differing byte). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const left = enc.encode(a)
  const right = enc.encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

/** null = authorised; otherwise the response to return. */
export function authorizeJobRequest(request: Request, env: WorkerAuthEnv): Response | null {
  const expected = env.CLOUDFLARE_WORKER_TOKEN?.trim()
  if (!expected) {
    if (env.ENVIRONMENT === 'development') return null
    console.error('[Worker] CLOUDFLARE_WORKER_TOKEN is not set — refusing job requests')
    return json({ error: 'Worker auth not configured' }, 503)
  }
  const header = request.headers.get('Authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!provided || !safeEqual(provided, expected)) {
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
