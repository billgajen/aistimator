import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { previewPriceNow } from '@/lib/pricing-preview'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { notThere, voiceTestAdmin } from '@/lib/voice/access'
import { loadVoiceBusiness } from '@/lib/voice/business'
import { readSession, sessionSecret } from '@/lib/voice/session'
import { runTool, toolResponse } from '@/lib/voice/tools'

export const dynamic = 'force-dynamic'

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/admin/voice-test/tool (T-210)
 *
 * One of her tool calls, passed through by the test page. The business is the signed call
 * session's and nothing else's: a tool's arguments cannot name one. Every tool reads or
 * pretends; none writes, sends or counts anything (lib/voice/tools.ts).
 *
 * Nothing of a call is logged: not the arguments, not the answer.
 */
export async function POST(request: NextRequest) {
  const admin = await voiceTestAdmin()
  if (!admin) return notThere()
  const limit = await checkRateLimit('voice_test_tool', { ip: getClientIp(request), key: admin.userId })
  if (!limit.allowed) return rateLimitedResponse(limit)

  const raw = await request.text().catch(() => '')
  if (raw.length > 20_000) return fail(400, 'INVALID_REQUEST', 'That tool call is too large.')
  const body = ((): { session?: unknown; name?: unknown; args?: unknown } | null => {
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  })()
  if (!body) return fail(400, 'INVALID_REQUEST', 'A tool call needs a session and a name.')

  const secret = sessionSecret()
  if (!secret) return fail(503, 'NOT_CONFIGURED', 'The voice test is not set up on this server.')
  const session = readSession(body.session, secret, { adminId: admin.userId, nowSeconds: Math.floor(Date.now() / 1000) })
  if (!session) return fail(401, 'INVALID_SESSION', 'This call has ended. Start a new one.')

  try {
    const started = Date.now()
    // The business is the session's. Nothing in `body.args` is read to find it.
    const business = await loadVoiceBusiness(createAdminClient(), session.tenantId)
    if (!business) return fail(404, 'NO_BUSINESS', 'There is no such business.')
    const outcome = await runTool(business, body.name, body.args, { price: previewPriceNow })
    return NextResponse.json({
      ok: outcome.ok,
      response: toolResponse(outcome),
      ...(outcome.ok ? { wouldDo: outcome.wouldDo, engine: outcome.engine } : { code: outcome.code }),
      ms: Date.now() - started,
    })
  } catch (error) {
    console.error('[VoiceTest] A tool call failed:', error instanceof Error ? error.name : 'unknown error')
    return fail(500, 'INTERNAL_ERROR', 'That could not be done.')
  }
}
