import { randomUUID } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { LIVE_VOICES, getLivePrice, resolveModelRoute } from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { notThere, voiceTestAdmin } from '@/lib/voice/access'
import { loadVoiceBusiness } from '@/lib/voice/business'
import { CALL_LIMIT_SECONDS, SESSION_LIFE_SECONDS, WRAP_UP_SECONDS } from '@/lib/voice/config'
import { buildInstruction } from '@/lib/voice/instructions'
import { mintLiveToken } from '@/lib/voice/live-token'
import { sessionSecret, signSession } from '@/lib/voice/session'
import { toolDeclarations } from '@/lib/voice/tools'

export const dynamic = 'force-dynamic'

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/admin/voice-test/session (T-210)
 *
 * Starts one test call: reads the business, builds her instructions from its configuration, and
 * mints a single-use Live API token with the model, the instructions, the voice and the tools
 * locked into it. The page gets the token and a signed call session; it never gets the API key,
 * and it cannot change what the token locks. Nothing is stored.
 */
export async function POST(request: NextRequest) {
  const admin = await voiceTestAdmin()
  if (!admin) return notThere()
  const limit = await checkRateLimit('voice_test_start', { ip: getClientIp(request), key: admin.userId })
  if (!limit.allowed) return rateLimitedResponse(limit)

  const body = (await request.json().catch(() => null)) as { tenantId?: unknown; voice?: unknown } | null
  const tenantId = typeof body?.tenantId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.tenantId) ? body.tenantId : null
  const voice = typeof body?.voice === 'string' && LIVE_VOICES.includes(body.voice) ? body.voice : null
  if (!tenantId || !voice) return fail(400, 'INVALID_REQUEST', 'Pick a business and one of the listed voices.')

  try {
    const business = await loadVoiceBusiness(createAdminClient(), tenantId)
    if (!business) return fail(404, 'NO_BUSINESS', 'There is no such business.')

    const apiKey = process.env.GEMINI_API_KEY
    const secret = sessionSecret()
    const route = resolveModelRoute('voice_call', process.env)
    if (!apiKey || !secret || route.provider !== 'gemini') return fail(503, 'NOT_CONFIGURED', 'The voice test is not set up on this server.')

    const instruction = buildInstruction({ businessName: business.name, languageVariant: business.languageVariant, emergencyNumber: business.emergencyNumber, currency: business.currency })
    const now = new Date()
    const minted = await mintLiveToken(apiKey, { model: route.model, voice, instruction, tools: toolDeclarations() }, { now })
    if (!minted.ok) {
      console.error(`[VoiceTest] The Live API did not give a token (status ${minted.status})`)
      return fail(502, 'NO_TOKEN', 'Google did not give a call token. Try again in a moment.')
    }

    const session = signSession({ v: 1, callId: randomUUID(), tenantId: business.id, adminId: admin.userId, voice, exp: Math.floor(now.getTime() / 1000) + SESSION_LIFE_SECONDS }, secret)
    return NextResponse.json({
      token: minted.token,
      session,
      model: route.model,
      voice,
      prices: getLivePrice(route.model),
      limits: { callSeconds: CALL_LIMIT_SECONDS, wrapUpSeconds: WRAP_UP_SECONDS },
      business: { id: business.id, name: business.name, currency: business.currency, locale: business.locale, timeZone: business.timeZone, services: business.services.map((s) => ({ id: s.id, name: s.name })) },
      // Shown on the page so the report can quote what she was told
      instruction,
    })
  } catch (error) {
    console.error('[VoiceTest] Could not start a call:', error instanceof Error ? error.name : 'unknown error')
    return fail(500, 'INTERNAL_ERROR', 'The call could not be started.')
  }
}
