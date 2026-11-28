import { randomUUID } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { LIVE_VOICES, comparisonVoices, getLiveMinutePrice, getLivePrice, getModelPrice, resolveComparisonModel, resolveModelRoute } from '@qolumns/shared'
import { checkContact } from '@/lib/contact-rules'
import { createAdminClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { notThere, voiceTestAdmin } from '@/lib/voice/access'
import { loadVoiceBusiness } from '@/lib/voice/business'
import { CALL_LIMIT_SECONDS, ENGINES, SESSION_LIFE_SECONDS, WRAP_UP_SECONDS, callNotice, type Engine } from '@/lib/voice/config'
import { deviceIdOf, ipHashOf, startCall } from '@/lib/voice/guard'
import { VOICE_GUARD } from '@/lib/voice/guard-config'
import { guardStore } from '@/lib/voice/guard-store'
import { HUMAN_CHECK_MESSAGE, HUMAN_CHECK_TIMEOUT_MS, humanCheckOf, mayStartCall } from '@/lib/voice/human-check'
import { areaRule, buildInstruction } from '@/lib/voice/instructions'
import { LIVE_TUNING, mintLiveToken, slidingWindow } from '@/lib/voice/live-token'
import { createLiveSession, openAiEnabled } from '@/lib/voice/openai-live'
import { NO_NOTES, sessionSecret, signSession } from '@/lib/voice/session'
import { functionTools, toolDeclarations } from '@/lib/voice/tools'

export const dynamic = 'force-dynamic'

const fail = (status: number, code: string, message: string, more: Record<string, unknown> = {}) => NextResponse.json({ error: { code, message }, ...more }, { status })
const shortText = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/**
 * POST /api/admin/voice-test/session (T-210, T-211)
 *
 * Starts one test call. In order: the caller's details pass the business's own contact rules;
 * the bot check has passed; the visitor is not blocked and neither daily limit is reached; then
 * her instructions are built from the business's configuration and the call is opened on the
 * chosen engine with the model, the instructions, the voice and the tools fixed by the server.
 * The page gets what it needs to connect and a signed call session; it never gets an API key.
 * Nothing is stored but the call's counts and strikes (lib/voice/guard.ts).
 */
export async function POST(request: NextRequest) {
  const admin = await voiceTestAdmin()
  if (!admin) return notThere()
  const ip = getClientIp(request)
  const limit = await checkRateLimit('voice_test_start', { ip, key: admin.userId })
  if (!limit.allowed) return rateLimitedResponse(limit)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const tenantId = typeof body?.tenantId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.tenantId) ? body.tenantId : null
  const engine = (ENGINES as readonly string[]).includes(String(body?.engine ?? 'gemini')) ? (String(body?.engine ?? 'gemini') as Engine) : null
  if (!body || !tenantId || !engine || (engine === 'openai' && !openAiEnabled())) return fail(400, 'INVALID_REQUEST', 'Pick a business and one of the listed engines.')

  try {
    const business = await loadVoiceBusiness(createAdminClient(), tenantId)
    if (!business) return fail(404, 'NO_BUSINESS', 'There is no such business.')

    // 1. The caller's details, by the business's own rules (the request form's)
    const given = (typeof body.contact === 'object' && body.contact !== null ? body.contact : {}) as Record<string, unknown>
    const contact = checkContact({ name: shortText(given.name, 200), email: shortText(given.email, 300), phone: shortText(given.phone, 60) }, business.contactRequirement)
    if (!contact.ok) return fail(400, 'INVALID_CONTACT', 'Check the details and try again.', { fields: contact.errors })

    // The voice must be one of the chosen engine's, before anything is counted
    const offered = engine === 'gemini' ? LIVE_VOICES : (comparisonVoices(resolveComparisonModel('voice_call_openai', process.env).model)?.voices ?? [])
    const voice = typeof body.voice === 'string' && offered.includes(body.voice) ? body.voice : ''
    if (!voice || (engine === 'openai' && !(typeof body.sdp === 'string' && body.sdp.length > 0 && body.sdp.length < 20_000))) return fail(400, 'INVALID_REQUEST', 'Pick one of the listed voices.')

    // 2. The bot check: a call does not start without a passed one
    const human = humanCheckOf(await verifyTurnstileToken(typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined, ip, HUMAN_CHECK_TIMEOUT_MS))
    if (!mayStartCall(human)) return fail(403, 'HUMAN_CHECK', HUMAN_CHECK_MESSAGE)

    const secret = sessionSecret()
    if (!secret) return fail(503, 'NOT_CONFIGURED', 'The voice test is not set up on this server.')

    // 3. Strikes, blocks and the day's limits. The address is hashed here and goes no further.
    const visitor = { deviceId: deviceIdOf(body.deviceId), ipHash: ipHashOf(ip, secret) }
    const now = new Date()
    const nowSeconds = Math.floor(now.getTime() / 1000)
    const start = await startCall(guardStore(), visitor, business.id, nowSeconds)
    if (!start.allowed) return fail(403, 'CALLS_UNAVAILABLE', start.message, { why: start.why, guard: start.status })

    // 4. Her instructions, and the call itself
    const basedIn = shortText(body.basedIn, 80)
    const generalAdvice = body.generalAdvice !== false
    const instruction = buildInstruction(business, { callerName: contact.clean.name, hasEmail: !!contact.clean.email, hasPhone: !!contact.clean.phone, basedIn, generalAdvice })

    let connect: Record<string, unknown>
    let model: string
    if (engine === 'gemini') {
      const route = resolveModelRoute('voice_call', process.env)
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey || route.provider !== 'gemini') return fail(503, 'NOT_CONFIGURED', 'The voice test is not set up on this server.')
      model = route.model
      const setup = { model, voice, instruction, tools: toolDeclarations(), language: business.speechLanguage }
      const minted = await mintLiveToken(apiKey, setup, { now })
      if (!minted.ok) {
        console.error(`[VoiceTest] The Live API did not give a token (status ${minted.status})`)
        return fail(502, 'NO_TOKEN', 'Google did not give a call token. Try again in a moment.')
      }
      connect = { token: minted.token, prices: getLivePrice(model), tuning: { endOfSpeechMs: LIVE_TUNING.silenceDurationMs, memory: slidingWindow(setup) } }
    } else {
      const apiKey = process.env.OPENAI_API_KEY
      model = resolveComparisonModel('voice_call_openai', process.env).model
      const backendModel = resolveComparisonModel('voice_call_openai_backend', process.env).model
      const sdp = String(body.sdp)
      if (!apiKey) return fail(503, 'NOT_CONFIGURED', 'The voice test is not set up on this server.')
      const made = await createLiveSession(apiKey, { model, backendModel, voice, instruction, tools: functionTools(), sdp })
      if (!made.ok) {
        console.error(`[VoiceTest] OpenAI did not open a session (status ${made.status})`)
        return fail(502, 'NO_SESSION', 'OpenAI did not open the call. Try again in a moment.')
      }
      connect = { sdp: made.sdp, backendModel, minutePrice: getLiveMinutePrice(model), backendPrice: getModelPrice(backendModel) }
    }

    const session = signSession(
      { v: 2, callId: randomUUID(), tenantId: business.id, adminId: admin.userId, engine, voice, contact: contact.clean, deviceId: visitor.deviceId, ipHash: visitor.ipHash, notes: NO_NOTES, exp: nowSeconds + SESSION_LIFE_SECONDS },
      secret
    )
    return NextResponse.json({
      engine,
      ...connect,
      session,
      model,
      voice,
      contact: contact.clean,
      notice: callNotice(business.name),
      limits: { callSeconds: CALL_LIMIT_SECONDS, wrapUpSeconds: WRAP_UP_SECONDS, silenceAskSeconds: VOICE_GUARD.silenceAskSeconds, silenceEndSeconds: VOICE_GUARD.silenceEndSeconds, lastWordsSeconds: VOICE_GUARD.lastWordsSeconds },
      guard: start.status,
      humanCheck: human,
      area: areaRule(business, basedIn).kind,
      business: { id: business.id, name: business.name, currency: business.currency, locale: business.locale, timeZone: business.timeZone, services: business.services.map((s) => ({ id: s.id, name: s.name })) },
      // Shown on the page so the report can quote what she was told
      instruction,
    })
  } catch (error) {
    console.error('[VoiceTest] Could not start a call:', error instanceof Error ? error.name : 'unknown error')
    return fail(500, 'INTERNAL_ERROR', 'The call could not be started.')
  }
}
