import { NextResponse, type NextRequest } from 'next/server'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { notThere, voiceTestAdmin } from '@/lib/voice/access'
import { clearGuard, deviceIdOf, guardStatus, ipHashOf } from '@/lib/voice/guard'
import { guardStore } from '@/lib/voice/guard-store'
import { sessionSecret } from '@/lib/voice/session'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/voice-test/guard (T-211)
 *
 * Where this visitor stands: strikes, a block, and today's calls for the device and the
 * business. With `clear: true` (the test page's "Clear my block" button) they are forgotten
 * first. Test only: the real build has no such button. The address is hashed and never kept.
 */
export async function POST(request: NextRequest) {
  const admin = await voiceTestAdmin()
  if (!admin) return notThere()
  const ip = getClientIp(request)
  const limit = await checkRateLimit('voice_test_tool', { ip, key: admin.userId })
  if (!limit.allowed) return rateLimitedResponse(limit)
  const secret = sessionSecret()
  if (!secret) return NextResponse.json({ error: { code: 'NOT_CONFIGURED', message: 'The voice test is not set up on this server.' } }, { status: 503 })

  const body = (await request.json().catch(() => null)) as { deviceId?: unknown; tenantId?: unknown; clear?: unknown } | null
  const visitor = { deviceId: deviceIdOf(body?.deviceId), ipHash: ipHashOf(ip, secret) }
  const tenantId = typeof body?.tenantId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.tenantId) ? body.tenantId : null
  const now = Math.floor(Date.now() / 1000)
  const store = guardStore()
  const cleared = body?.clear === true ? await clearGuard(store, visitor, tenantId, now) : undefined
  return NextResponse.json({ guard: await guardStatus(store, visitor, tenantId, now), ...(cleared !== undefined && { cleared }) })
}
