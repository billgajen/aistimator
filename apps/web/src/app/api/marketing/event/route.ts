import { NextResponse } from 'next/server'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { metaCookies, sendMetaEvent } from '@/lib/meta-capi'

/**
 * POST /api/marketing/event (T-144) — the server half of a browser Pixel
 * event (Conversions API), for events that happen client-side (signup).
 * Only whitelisted events; rate limited; the email is hashed before it
 * leaves the server and is never logged.
 */
const ALLOWED = new Set(['CompleteRegistration'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rate = await checkPublicRateLimit('marketing', { ip, tenantKey: 'marketing' })
  if (!rate.allowed) return rateLimitedResponse(rate)

  let body: { eventName?: string; eventId?: string; email?: string; pageUrl?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  if (!body.eventName || !ALLOWED.has(body.eventName) || !body.eventId || !EVENT_ID.test(body.eventId)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Unknown event' } }, { status: 400 })
  }
  const { fbp, fbc } = metaCookies(request.headers.get('cookie'))
  const result = await sendMetaEvent({
    eventName: 'CompleteRegistration',
    eventId: body.eventId,
    email: body.email && EMAIL.test(body.email) ? body.email : null,
    clientIp: ip,
    userAgent: request.headers.get('user-agent'),
    fbp,
    fbc,
    eventSourceUrl: typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 300) : undefined,
  })
  return NextResponse.json({ ok: true, sent: result.sent })
}
