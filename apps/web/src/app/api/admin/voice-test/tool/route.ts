import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { previewPriceNow } from '@/lib/pricing-preview'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { notThere, voiceTestAdmin } from '@/lib/voice/access'
import { loadVoiceBusiness } from '@/lib/voice/business'
import { isStrike, recordStrike } from '@/lib/voice/guard'
import { guardStore } from '@/lib/voice/guard-store'
import { readSession, sessionSecret, signSession, type CallSession } from '@/lib/voice/session'
import { runTool, toolResponse } from '@/lib/voice/tools'

export const dynamic = 'force-dynamic'

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/admin/voice-test/tool (T-210, T-211)
 *
 * One of her tool calls, passed through by the test page. The business and the caller's details
 * are the signed call session's and nothing else's: a tool's arguments cannot name either. Every
 * tool reads or pretends; none writes a row, sends anything or counts a quote (lib/voice/tools.ts).
 * A tool that changes the call's own state (a corrected detail, a price given) is answered with
 * a newly signed session. An off-topic or abusive ending is kept as a strike (lib/voice/guard.ts).
 *
 * Nothing of a call is logged: not the arguments, not the answer.
 */
export async function POST(request: NextRequest) {
  const admin = await voiceTestAdmin()
  if (!admin) return notThere()
  const limit = await checkRateLimit('voice_test_tool', { ip: getClientIp(request), key: admin.userId })
  if (!limit.allowed) return rateLimitedResponse(limit)

  const raw = await request.text().catch(() => '')
  if (raw.length > 30_000) return fail(400, 'INVALID_REQUEST', 'That tool call is too large.')
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
  const nowSeconds = Math.floor(Date.now() / 1000)
  const session = readSession(body.session, secret, { adminId: admin.userId, nowSeconds })
  if (!session) return fail(401, 'INVALID_SESSION', 'This call has ended. Start a new one.')

  try {
    const started = Date.now()
    // The business is the session's. Nothing in `body.args` is read to find it.
    const business = await loadVoiceBusiness(createAdminClient(), session.tenantId)
    if (!business) return fail(404, 'NO_BUSINESS', 'There is no such business.')
    const outcome = await runTool({ business, session }, body.name, body.args, { price: previewPriceNow })
    if (!outcome.ok) return NextResponse.json({ ok: false, response: toolResponse(outcome, session.notes), code: outcome.code, ms: Date.now() - started })

    const next: CallSession = outcome.change ? { ...session, contact: outcome.change.contact ?? session.contact, notes: outcome.change.notes ?? session.notes } : session
    // An off-topic or abusive ending is a strike for the device and the address the call started from
    const guard = outcome.end && isStrike(outcome.end) ? await recordStrike(guardStore(), { deviceId: session.deviceId, ipHash: session.ipHash }, nowSeconds) : undefined
    return NextResponse.json({
      ok: true,
      response: toolResponse(outcome, next.notes),
      ...(outcome.change && { session: signSession(next, secret) }),
      wouldDo: outcome.wouldDo,
      engine: outcome.engine,
      typical: outcome.typical,
      contact: outcome.contact,
      end: outcome.end,
      guard,
      ms: Date.now() - started,
    })
  } catch (error) {
    console.error('[VoiceTest] A tool call failed:', error instanceof Error ? error.name : 'unknown error')
    return fail(500, 'INTERNAL_ERROR', 'That could not be done.')
  }
}
