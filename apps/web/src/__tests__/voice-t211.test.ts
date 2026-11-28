/**
 * T-211: the voice test, round two. Her tools as they now are (the business and the caller's
 * details are the session's; bad arguments are turned away; nothing is written), the call's
 * protection (strikes, blocks, limits, and "the store is down = the call goes ahead"), the
 * typical price, which spoken amounts are valid, how she is told to talk, and the second engine.
 *
 * What the page does in a browser, and that a typical price and several services leave no row
 * behind, is scripts/hardcore-test/verify-t211.mts.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CUSTOMER_BANNED_WORDS, comparisonVoices, getLiveMinutePrice, getModelPrice, getRegion, resolveComparisonModel, resolveModelRoute } from '@qolumns/shared'
import registry from '../../../../packages/shared/src/ai-models.json'
import type { WorkerPreview } from '@/lib/pricing-preview'
import { ASSISTANT_NAME, CALL_LIMIT_SECONDS, ENGINES, THINGS_TO_TRY, TOKEN_LIFE_SECONDS, WRAP_UP_SECONDS, callNotice, liveSocketUrl, voiceTestEnabled } from '@/lib/voice/config'
import { NO_MINUTES, minuteCost } from '@/lib/voice/cost'
import { NO_RECORD, afterStrike, clearGuard, deviceIdOf, guardStatus, ipHashOf, isStrike, keepSeconds, recordStrike, startCall, stateOf, type GuardStore } from '@/lib/voice/guard'
import { END_REASONS, VOICE_GUARD } from '@/lib/voice/guard-config'
import { HUMAN_CHECK_TIMEOUT_MS, humanCheckOf, mayStartCall } from '@/lib/voice/human-check'
import { SYSTEM_NOTE, areaRule, buildInstruction, firstNameOf, systemNote } from '@/lib/voice/instructions'
import { LIVE_TUNING, lockedSetup, mintLiveToken, slidingWindow, tokenRequest } from '@/lib/voice/live-token'
import { currencyWord, moneyWords, numberWords } from '@/lib/voice/money-words'
import { BROWSER_MAY_SEND, OPENAI_LIVE_URL, createLiveSession, liveSessionRequest, openAiEnabled } from '@/lib/voice/openai-live'
import { forTheTeam, moneySaid, priceChecks, repeatedSentences, resultsText, toolDelaysOf, validAmounts, type CallResults } from '@/lib/voice/results'
import { NO_NOTES, readSession, signSession } from '@/lib/voice/session'
import { spokenAmounts } from '@/lib/voice/spoken'
import { FREE_TIMES_GIVEN, TOOLS, TOOL_NAMES, functionTools, notesForHer, runTool, toolDeclarations, toolResponse, type ToolOutcome } from '@/lib/voice/tools'
import { TYPICAL_PRICE_CALLS, basisOf, minimumOf, typicalPlan, typicalPrice } from '@/lib/voice/typical'
import { testSlots } from '@/lib/voice/slots'
import { NOW, business, call, priced, session } from './voice-fixture'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const VOICE_DIR = 'apps/web/src/lib/voice'
const VOICE_FILES = readdirSync(join(ROOT, VOICE_DIR)).map((f) => `${VOICE_DIR}/${f}`)
const SESSION_ROUTE = 'apps/web/src/app/api/admin/voice-test/session/route.ts'
const TOOL_ROUTE = 'apps/web/src/app/api/admin/voice-test/tool/route.ts'
const GUARD_ROUTE = 'apps/web/src/app/api/admin/voice-test/guard/route.ts'
const ROUTES = [SESSION_ROUTE, TOOL_ROUTE, GUARD_ROUTE]
const PAGE = 'apps/web/src/app/admin/voice-test/page.tsx'
const COMPONENT = 'apps/web/src/components/voice-test/VoiceTest.tsx'
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const HOUR = 3600
const DAY = 24 * HOUR
const T0 = 1_800_000_000
const SECRET = 'a-server-only-value'

/** Upstash, in memory: values with an expiry, and a record of every key and value it was ever handed */
function memoryStore(now: () => number) {
  const data = new Map<string, { value: string; until: number }>()
  const seen: string[] = []
  const alive = (key: string) => {
    const entry = data.get(key)
    if (entry && entry.until <= now()) data.delete(key)
    return data.get(key)
  }
  const store: GuardStore = {
    async get(key) {
      seen.push(key)
      return alive(key)?.value ?? null
    },
    async set(key, value, ttl) {
      seen.push(key, value)
      data.set(key, { value, until: now() + ttl })
    },
    async increment(key, ttl) {
      seen.push(key)
      const next = Number(alive(key)?.value ?? 0) + 1
      data.set(key, { value: String(next), until: now() + ttl })
      return next
    },
    async remove(keys) {
      for (const key of keys) data.delete(key)
    },
  }
  return { store, data, seen }
}
const broken = (how: 'throws' | 'hangs'): GuardStore => {
  const fail = () => (how === 'throws' ? Promise.reject(new Error('down')) : new Promise<never>(() => undefined))
  return { get: fail, set: fail, increment: fail, remove: fail }
}
const QUICK = { ...VOICE_GUARD, storeTimeoutMs: 30 }
const visitor = { deviceId: 'device-0123456789abcdef', ipHash: 'b'.repeat(32) }

describe('T-211 B5: strikes and blocks', () => {
  it('the numbers are in one place', () => {
    expect(VOICE_GUARD).toMatchObject({ strikeReasons: ['off_topic', 'abusive'], strikeWindowSeconds: 24 * HOUR, strikesToBlock: 2, blockSeconds: 2 * DAY, repeatWindowSeconds: 30 * DAY, repeatBlockSeconds: 7 * DAY, callsPerDevicePerDay: 3, callsPerBusinessPerDay: 20, silenceAskSeconds: 20, silenceEndSeconds: 10 })
    expect(VOICE_GUARD.blockedMessage).toBe("Calls aren't available right now")
    // no other voice file writes one of these durations or counts out
    for (const file of VOICE_FILES.filter((f) => !f.endsWith('guard-config.ts'))) expect(code(file), file).not.toMatch(/2 \* DAY|7 \* DAY|30 \* DAY|PerDay\s*[:=]\s*\d|strikesToBlock\s*[:=]\s*\d/)
  })

  it('an off-topic or abusive ending is a strike; a finished or a silent one is not', () => {
    expect(END_REASONS).toEqual(['finished', 'off_topic', 'abusive', 'silent'])
    expect(END_REASONS.map((r) => isStrike(r))).toEqual([false, true, true, false])
  })

  it('one strike does not block; two within 24 hours block for 2 days', () => {
    const one = afterStrike(NO_RECORD, T0)
    expect(stateOf(one, T0)).toEqual({ blocked: false, blockedUntil: null, strikes: 1 })
    const two = afterStrike(one, T0 + 23 * HOUR)
    expect(stateOf(two, T0 + 23 * HOUR)).toEqual({ blocked: true, blockedUntil: T0 + 23 * HOUR + 2 * DAY, strikes: 0 })
    expect(stateOf(two, T0 + 23 * HOUR + 2 * DAY - 1).blocked).toBe(true)
    expect(stateOf(two, T0 + 23 * HOUR + 2 * DAY).blocked).toBe(false)
  })

  it('two strikes more than 24 hours apart do not block: the first has left the window', () => {
    const later = afterStrike(afterStrike(NO_RECORD, T0), T0 + 25 * HOUR)
    expect(stateOf(later, T0 + 25 * HOUR)).toEqual({ blocked: false, blockedUntil: null, strikes: 1 })
  })

  it('a strike within 30 days of a block ending blocks again at once, for 7 days', () => {
    const blocked = afterStrike(afterStrike(NO_RECORD, T0), T0 + HOUR)
    const ended = blocked.blockUntil!
    const again = afterStrike(blocked, ended + 29 * DAY)
    expect(stateOf(again, ended + 29 * DAY)).toEqual({ blocked: true, blockedUntil: ended + 29 * DAY + 7 * DAY, strikes: 0 })
    // after the 30 days it is an ordinary first strike again
    const muchLater = afterStrike(blocked, ended + 31 * DAY)
    expect(stateOf(muchLater, ended + 31 * DAY)).toEqual({ blocked: false, blockedUntil: null, strikes: 1 })
    // while blocked, nothing is added
    expect(afterStrike(blocked, ended - HOUR)).toBe(blocked)
  })

  it('a record is kept as long as it can still matter, and no longer', () => {
    expect(keepSeconds(afterStrike(NO_RECORD, T0), T0)).toBe(24 * HOUR)
    const blocked = afterStrike(afterStrike(NO_RECORD, T0), T0)
    expect(keepSeconds(blocked, T0)).toBe(2 * DAY + 30 * DAY)
    expect(keepSeconds(NO_RECORD, T0)).toBe(60)
  })

  it('a block applies to the device and to the address: either one blocked, no call starts', async () => {
    let now = T0
    const { store } = memoryStore(() => now)
    expect(await recordStrike(store, visitor, now)).toMatchObject({ blocked: false, strikes: 1, recorded: true })
    now += HOUR
    expect(await recordStrike(store, visitor, now)).toMatchObject({ blocked: true, blockedUntil: now + 2 * DAY, recorded: true })
    // the same device from another address, and another device from the same address
    expect((await guardStatus(store, { deviceId: visitor.deviceId, ipHash: 'c'.repeat(32) }, 'tnt_one', now)).blocked).toBe(true)
    expect((await guardStatus(store, { deviceId: 'another-device-000000', ipHash: visitor.ipHash }, 'tnt_one', now)).blocked).toBe(true)
    expect((await guardStatus(store, { deviceId: 'another-device-000000', ipHash: 'c'.repeat(32) }, 'tnt_one', now)).blocked).toBe(false)
    const refused = await startCall(store, { deviceId: 'another-device-000000', ipHash: visitor.ipHash }, 'tnt_one', now)
    expect(refused).toMatchObject({ allowed: false, why: 'blocked', message: "Calls aren't available right now" })
    // two days on, the call starts again
    expect((await startCall(store, visitor, 'tnt_one', now + 2 * DAY)).allowed).toBe(true)
  })

  it('a strike on one of the two blocks both, until the later time', async () => {
    let now = T0
    const { store, data } = memoryStore(() => now)
    // the device already has a strike from another address
    await recordStrike(store, { deviceId: visitor.deviceId, ipHash: null }, now)
    now += HOUR
    const result = await recordStrike(store, visitor, now)
    expect(result).toMatchObject({ blocked: true, blockedUntil: now + 2 * DAY })
    expect(JSON.parse(data.get(`voice:guard:ip:${visitor.ipHash}`)!.value)).toEqual({ strikes: [], blockUntil: now + 2 * DAY })
    expect(JSON.parse(data.get(`voice:guard:device:${visitor.deviceId}`)!.value)).toEqual({ strikes: [], blockUntil: now + 2 * DAY })
  })

  it('UPSTASH DOWN = ALLOWED: not set up, failing or slow, the call goes ahead and nothing is counted', async () => {
    for (const store of [null, broken('throws'), broken('hangs')]) {
      const status = await guardStatus(store, visitor, 'tnt_one', T0, QUICK)
      expect(status).toEqual({ blocked: false, blockedUntil: null, strikes: 0, deviceCallsToday: null, businessCallsToday: null, unavailable: true })
      expect(await startCall(store, visitor, 'tnt_one', T0, QUICK)).toMatchObject({ allowed: true, status: { unavailable: true } })
      expect(await recordStrike(store, visitor, T0, QUICK)).toEqual({ blocked: false, blockedUntil: null, strikes: 0, recorded: false })
      expect(await clearGuard(store, visitor, 'tnt_one', T0, QUICK)).toBe(false)
    }
  })

  it('a store that answers the read and then fails the count still lets the call start', async () => {
    const { store } = memoryStore(() => T0)
    const halfBroken: GuardStore = { ...store, increment: () => Promise.reject(new Error('down')) }
    expect(await startCall(halfBroken, visitor, 'tnt_one', T0, QUICK)).toMatchObject({ allowed: true, status: { unavailable: true } })
  })

  it('"Clear my block" forgets the strikes, the block and today\'s counts', async () => {
    const now = T0
    const { store } = memoryStore(() => now)
    await recordStrike(store, visitor, now)
    await recordStrike(store, visitor, now)
    await startCall(store, { deviceId: visitor.deviceId, ipHash: null }, 'tnt_one', now + 3 * DAY)
    expect((await guardStatus(store, visitor, 'tnt_one', now)).blocked).toBe(true)
    expect(await clearGuard(store, visitor, 'tnt_one', now)).toBe(true)
    expect(await guardStatus(store, visitor, 'tnt_one', now)).toMatchObject({ blocked: false, strikes: 0, deviceCallsToday: 0, businessCallsToday: 0, unavailable: false })
  })
})

describe('T-211 B6: daily limits', () => {
  it('a device may start 3 calls a day; the fourth is refused, and tomorrow it may again', async () => {
    let now = T0
    const { store } = memoryStore(() => now)
    for (let i = 1; i <= 3; i++) expect(await startCall(store, visitor, `tnt_${i}`, now)).toMatchObject({ allowed: true, status: { deviceCallsToday: i } })
    expect(await startCall(store, visitor, 'tnt_4', now)).toMatchObject({ allowed: false, why: 'device_limit', message: "Calls aren't available right now. Please try again tomorrow." })
    // a refused call is not counted, for the device or for the business
    expect(await guardStatus(store, visitor, 'tnt_4', now)).toMatchObject({ deviceCallsToday: 3, businessCallsToday: 0 })
    now += DAY
    expect((await startCall(store, visitor, 'tnt_4', now)).allowed).toBe(true)
  })

  it('a business may receive 20 calls a day, from everyone together', async () => {
    const { store } = memoryStore(() => T0)
    for (let i = 0; i < 20; i++) expect((await startCall(store, { deviceId: `device-${String(i).padStart(16, '0')}`, ipHash: null }, 'tnt_one', T0)).allowed).toBe(true)
    expect(await startCall(store, { deviceId: 'device-zzzzzzzzzzzzzzzz', ipHash: null }, 'tnt_one', T0)).toMatchObject({ allowed: false, why: 'business_limit' })
    // another business is not affected
    expect((await startCall(store, { deviceId: 'device-zzzzzzzzzzzzzzzz', ipHash: null }, 'tnt_two', T0)).allowed).toBe(true)
  })

  it('the 8-minute cap stays, with the wrap-up at 6', () => {
    expect([CALL_LIMIT_SECONDS, WRAP_UP_SECONDS, TOKEN_LIFE_SECONDS]).toEqual([480, 360, 540])
  })
})

describe('T-211 B5: who is counted. The raw address is never stored', () => {
  it('a device id is the page\'s own random id, and nothing else', () => {
    expect(deviceIdOf('3f2c9a7e-1b4d-4c8a-9e6f-0a1b2c3d4e5f')).toBe('3f2c9a7e-1b4d-4c8a-9e6f-0a1b2c3d4e5f')
    for (const bad of [undefined, null, 42, '', 'short', 'x'.repeat(65), 'has spaces in it 12345', 'semi;colon;0123456789', '../../etc/passwd/0123']) expect(deviceIdOf(bad), String(bad)).toBeNull()
  })

  it('an address becomes a salted hash: the same address the same hash, another salt another hash, and the address is not in it', () => {
    const hash = ipHashOf('203.0.113.77', SECRET)!
    expect(hash).toMatch(/^[0-9a-f]{32}$/)
    expect(ipHashOf('203.0.113.77', SECRET)).toBe(hash)
    expect(ipHashOf('203.0.113.78', SECRET)).not.toBe(hash)
    expect(ipHashOf('203.0.113.77', 'another-secret')).not.toBe(hash)
    expect(hash).not.toContain('203')
    expect([ipHashOf('unknown', SECRET), ipHashOf('', SECRET), ipHashOf(null, SECRET)]).toEqual([null, null, null])
  })

  it('nothing the store is ever handed holds the address', async () => {
    const ip = '203.0.113.77'
    const { store, seen } = memoryStore(() => T0)
    const who = { deviceId: visitor.deviceId, ipHash: ipHashOf(ip, SECRET) }
    await startCall(store, who, 'tnt_one', T0)
    await recordStrike(store, who, T0)
    await recordStrike(store, who, T0 + 60)
    await guardStatus(store, who, 'tnt_one', T0 + 120)
    expect(seen.length).toBeGreaterThan(8)
    expect(seen.join('\n')).not.toContain(ip)
    expect(seen.join('\n')).toContain(who.ipHash!)
  })

  it('the routes hash the address the moment they read it, and neither keep nor log it', () => {
    for (const file of [SESSION_ROUTE, GUARD_ROUTE]) {
      const route = code(file)
      expect(route, file).toContain('ipHash: ipHashOf(ip, secret)')
      // the address goes to the rate limiter, the bot check and the hash, and nowhere else
      expect(route.match(/\bip\b/g)!.length, file).toBeLessThanOrEqual(file === SESSION_ROUTE ? 5 : 4)
      expect(route, file).not.toMatch(/console\.[a-z]+\([^)]*\bip\b|signSession\([^)]*\bip\b[,\s}]/)
    }
    expect(code(SESSION_ROUTE)).toContain('deviceId: visitor.deviceId, ipHash: visitor.ipHash')
    expect(code(`${VOICE_DIR}/session.ts`)).not.toMatch(/\bip:\s|rawIp|clientIp/)
    // the strike is kept for the session's device and hash: the tool route never reads an address for it
    expect(code(TOOL_ROUTE)).toContain('recordStrike(guardStore(), { deviceId: session.deviceId, ipHash: session.ipHash }, nowSeconds)')
  })

  it('the page keeps its device id in localStorage and in a cookie', () => {
    const client = code(`${VOICE_DIR}/call-client.ts`)
    expect(client).toContain('localStorage.getItem(DEVICE_KEY)')
    expect(client).toContain('localStorage.setItem(DEVICE_KEY, id)')
    expect(client).toContain('document.cookie = `${DEVICE_COOKIE}=${id};')
    expect(client).toContain('crypto.randomUUID()')
  })
})

describe('T-211 A1: a call does not start without a passed check', () => {
  it('passed, or no check set up at all: the call may start. Rejected, or the check did not run: it may not', () => {
    expect(humanCheckOf({ ok: true })).toBe('passed')
    expect(humanCheckOf({ ok: true, unchecked: 'off' })).toBe('not_set_up')
    expect(humanCheckOf({ ok: false, reason: 'rejected' })).toBe('failed')
    for (const unchecked of ['no-token', 'no-answer', 'not-the-visitor'] as const) expect(humanCheckOf({ ok: true, unchecked }), unchecked).toBe('not_run')
    expect([mayStartCall('passed'), mayStartCall('not_set_up'), mayStartCall('failed'), mayStartCall('not_run')]).toEqual([true, true, false, false])
  })

  it('the route checks, in order: the details, the bot check, the block and the limits, and only then opens a call', () => {
    const route = code(SESSION_ROUTE)
    // a call needs a real yes, so the check is given three seconds here (a form gives it half a second and goes ahead)
    expect(HUMAN_CHECK_TIMEOUT_MS).toBe(3000)
    expect(code(SESSION_ROUTE)).toContain('ip, HUMAN_CHECK_TIMEOUT_MS))')
    expect(code('apps/web/src/lib/turnstile.ts')).toContain('timeoutMs: number = SITEVERIFY_TIMEOUT_MS')
    const order = ['checkContact({', 'humanCheckOf(await verifyTurnstileToken(', 'await startCall(guardStore(), visitor, business.id, nowSeconds)', 'buildInstruction(business,', 'await mintLiveToken(', 'await createLiveSession('].map((mark) => route.indexOf(mark))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(route).toContain("if (!mayStartCall(human)) return fail(403, 'HUMAN_CHECK', HUMAN_CHECK_MESSAGE)")
    expect(route).toContain("if (!contact.ok) return fail(400, 'INVALID_CONTACT'")
    expect(route).toContain("if (!start.allowed) return fail(403, 'CALLS_UNAVAILABLE', start.message, { why: start.why, guard: start.status })")
    // the business's own contact rule, the form's own check, the site's own bot check
    expect(route).toContain("import { checkContact } from '@/lib/contact-rules'")
    expect(route).toContain("import { verifyTurnstileToken } from '@/lib/turnstile'")
    expect(code(COMPONENT)).toContain("import { useTurnstile } from '@/components/embed/useTurnstile'")
    expect(code(COMPONENT)).toContain("checkContact({ name, email, phone }, business?.contact ?? 'email')")
  })

  it('the line under the button names the business twice', () => {
    expect(callNotice('Harlow Works')).toBe("Oumn is Harlow Works's AI assistant. Calls are transcribed so Harlow Works can follow up.")
    expect(code(COMPONENT)).toContain("{callNotice(business?.name ?? 'the business')}")
  })
})

describe('T-211 her tools: the business and the caller are the session\'s', () => {
  it('get_business_info is gone, and there are eight tools', () => {
    expect([...TOOL_NAMES]).toEqual(['get_typical_price', 'get_estimate', 'get_free_times', 'book_time', 'send_estimate', 'update_contact', 'request_person', 'end_call'])
    expect(TOOLS.map((t) => t.name)).toEqual([...TOOL_NAMES])
    for (const file of [...VOICE_FILES, ...ROUTES, COMPONENT]) expect(code(file), file).not.toMatch(/get_business_info|not_on_list/)
  })

  it('each engine is told of the same tools in its own spelling', () => {
    const gemini = toolDeclarations()
    const open = functionTools()
    expect(gemini.map((d) => d.name)).toEqual([...TOOL_NAMES])
    expect(open.map((d) => d.name)).toEqual([...TOOL_NAMES])
    for (const d of gemini) expect(d.behavior, d.name).toBe('BLOCKING')
    expect(gemini.find((d) => d.name === 'end_call')!.parameters).toEqual({ type: 'OBJECT', properties: { reason: { type: 'STRING', enum: ['finished', 'off_topic', 'abusive', 'silent'], description: expect.any(String) } }, required: ['reason'] })
    expect(open.find((d) => d.name === 'end_call')).toMatchObject({ type: 'function', parameters: { type: 'object', properties: { reason: { type: 'string', enum: ['finished', 'off_topic', 'abusive', 'silent'] } } } })
    const props = (name: string) => Object.keys(TOOLS.find((t) => t.name === name)!.parameters.properties)
    expect(TOOL_NAMES.map(props)).toEqual([['serviceId'], ['serviceId', 'answers'], ['fromDate'], ['slot'], [], ['field', 'value'], ['reason', 'urgent'], ['reason']])
  })

  it('no tool takes a business or a caller: an argument naming one is turned away, on every tool', async () => {
    const price = vi.fn(async () => priced())
    for (const name of TOOL_NAMES) {
      for (const stray of [{ tenantId: 'tnt_two' }, { businessId: 'tnt_two' }, { email: 'someone@else.example' }, { name: 'Someone Else' }, { phone: '555 000 0000' }]) {
        const outcome = await runTool(call(), name, { ...stray }, { price, now: () => NOW })
        expect(outcome, `${name} ${JSON.stringify(stray)}`).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
      }
      expect(Object.keys(TOOLS.find((t) => t.name === name)!.parameters.properties).join(' ')).not.toMatch(/tenant|business|email|phone|name/i)
    }
    expect(price).not.toHaveBeenCalled()
  })

  it('the tool route takes the business and the session\'s state from the signed session and nothing in the call', () => {
    const route = code(TOOL_ROUTE)
    expect(route).toContain('const session = readSession(body.session, secret, { adminId: admin.userId, nowSeconds })')
    expect(route).toContain('const business = await loadVoiceBusiness(createAdminClient(), session.tenantId)')
    expect(route).toContain('await runTool({ business, session }, body.name, body.args, { price: previewPriceNow })')
    expect(route.match(/body\.args/g)).toHaveLength(1)
    expect(route).not.toMatch(/tenantId:\s*body|args\.tenant|args\?\.tenant/)
    // a change to the call's own state comes back as a newly signed session
    expect(route).toContain('...(outcome.change && { session: signSession(next, secret) })')
  })

  it('a signed session comes back as it was; changed, re-signed, run out, another admin\'s or an old version, it is refused', () => {
    const signed = signSession(session(), SECRET)
    expect(readSession(signed, SECRET, { adminId: 'admin-1', nowSeconds: 1_900_000_000 })).toEqual(session())
    const [payload, signature] = signed.split('.') as [string, string]
    const moved = Buffer.from(JSON.stringify(session({ tenantId: 'tnt_two' })), 'utf8').toString('base64url')
    const otherContact = Buffer.from(JSON.stringify(session({ contact: { name: 'Mallory', email: 'mallory@example.com', phone: null } })), 'utf8').toString('base64url')
    const fakePrice = Buffer.from(JSON.stringify(session({ notes: { ...NO_NOTES, estimates: [{ service: 'Service A', total: 5, say: 'five dollars' }] } })), 'utf8').toString('base64url')
    for (const tampered of [moved, otherContact, fakePrice]) expect(readSession(`${tampered}.${signature}`, SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
    expect(readSession(signSession(session(), 'another-secret'), SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
    expect(readSession(signed, SECRET, { adminId: 'admin-1', nowSeconds: session().exp })).toBeNull()
    expect(readSession(signed, SECRET, { adminId: 'admin-2', nowSeconds: 1 })).toBeNull()
    expect(readSession(signSession({ ...session(), v: 1 as never }, SECRET), SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
    for (const junk of [undefined, null, 42, '', 'nodot', '.', `${payload}.`, 'x'.repeat(13_000)]) expect(readSession(junk, SECRET, { adminId: 'admin-1', nowSeconds: 1 })).toBeNull()
  })

  it('an estimate is priced for the session\'s business, for one of its own services, and comes back in figures and in words', async () => {
    const price = vi.fn(async (_input: unknown) => priced({ subtotal: 450, taxAmount: 37.13, taxLabel: 'Sales tax', total: 487.13, unmeasured: [{ stepId: 's', name: 'Ceiling', rate: 2, unitLabel: 'sq ft' }] }))
    const outcome = await runTool(call(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '1,250' }, { questionId: 'finish', value: 'premium' }, { questionId: 'rush', value: 'Yes' }, { questionId: 'measured_area', value: '400' }, { questionId: 'size', value: '40' }] }, { price })
    expect(price.mock.calls[0]![0]).toEqual({ tenantId: 'tnt_one', service: { id: 'svc_a', name: 'Service A' }, rules: { baseFee: 0 }, fields: business().services[0]!.fields, answers: [{ fieldId: 'size', value: 40 }, { fieldId: 'finish', value: 'prem' }, { fieldId: 'rush', value: true }, { fieldId: 'measured_area', value: 400 }] })
    expect(outcome).toMatchObject({ ok: true, engine: { currency: 'USD', total: 487.13, subtotal: 450, taxAmount: 37.13, lines: [75, 375] } })
    expect(toolResponse(outcome, NO_NOTES)).toEqual({
      service: 'Service A', total: 487.13, sayTotal: 'four hundred and eighty-seven dollars and thirteen cents',
      beforeTax: { amount: 450, say: 'four hundred and fifty dollars' }, tax: { label: 'Sales tax', amount: 37.13, say: 'thirty-seven dollars and thirteen cents' },
      lines: [{ label: 'Base', amount: 75, say: 'seventy-five dollars' }, { label: 'Work', amount: 375, say: 'three hundred and seventy-five dollars' }],
      notInThisEstimate: ['Ceiling'], notInThisEstimateWhy: 'These are priced from a size we measure. They are not in the total.',
      status: 'An estimate. We will confirm it.',
    })
    expect(await runTool(call(), 'get_estimate', { serviceId: 'svc_of_another_business', answers: [] }, { price })).toMatchObject({ ok: false, code: 'UNKNOWN_SERVICE' })
    expect(price).toHaveBeenCalledTimes(1)
  })

  it('bad arguments are turned away with a line she can act on', async () => {
    const deps = { price: vi.fn(async () => priced()), now: () => NOW }
    const refused = async (name: string, args: unknown, over = {}) => {
      const outcome = await runTool(call(over), name, args, deps)
      expect(outcome.ok, `${name} ${JSON.stringify(args)}`).toBe(false)
      return outcome as Extract<ToolOutcome, { ok: false }>
    }
    expect((await refused('get_business_info', {})).code).toBe('UNKNOWN_TOOL')
    expect((await refused('delete_everything', {})).code).toBe('UNKNOWN_TOOL')
    for (const args of ['a string', 42, ['a list'], true]) expect((await refused('send_estimate', args)).code).toBe('INVALID_ARGUMENT')
    const ask = (answers: unknown) => refused('get_estimate', { serviceId: 'svc_a', answers })
    expect((await ask([{ questionId: 'not_a_question', value: '1' }])).message).toContain("is not one of this service's questions")
    // D2: a vague answer is not a number, and she is told to ask for one
    expect((await ask([{ questionId: 'size', value: 'a couple' }])).message).toBe('"How large is it?" needs a number. If the caller was vague, ask them for a number.')
    expect((await ask([{ questionId: 'size', value: '40' }, { questionId: 'finish', value: 'Gold' }])).message).toBe('"Which finish?" must be one of: Standard, Premium.')
    expect(await ask([{ questionId: 'finish', value: 'std' }])).toMatchObject({ code: 'MISSING_ANSWERS', message: 'Ask the caller first: How large is it?.' })
    expect((await refused('get_estimate', { serviceId: 'svc_b', answers: [] })).code).toBe('NO_PRICE')
    expect((await refused('get_typical_price', {})).code).toBe('UNKNOWN_SERVICE')
    expect((await refused('get_typical_price', { serviceId: 'svc_a', answers: [] })).code).toBe('INVALID_ARGUMENT')
    expect((await refused('get_free_times', { fromDate: 'next Tuesday' })).message).toBe('fromDate must be a date as YYYY-MM-DD.')
    expect((await refused('book_time', { slot: '2026-11-28T08:00' })).code).toBe('UNKNOWN_SLOT')
    expect((await refused('not_on_list', { item: 'a thing' })).code).toBe('UNKNOWN_TOOL')
    expect((await refused('request_person', { reason: 'A leak', urgent: 'yes' })).code).toBe('INVALID_ARGUMENT')
    expect(deps.price).not.toHaveBeenCalled()
  })

  it('when the engine gives no price she is told to give none', async () => {
    for (const reason of ['unreachable', 'failed', 'no_business'] as const) {
      const outcome = await runTool(call(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '40' }] }, { price: async () => ({ success: false, reason }) })
      expect(toolResponse(outcome, NO_NOTES)).toEqual({ error: 'The estimate is not available right now. Do not give a price: say the team will confirm it.' })
    }
  })

  it('B1: end_call takes one of four reasons and nothing else', async () => {
    for (const reason of END_REASONS) expect(await runTool(call(), 'end_call', { reason }, { price: async () => priced() })).toEqual({ ok: true, end: reason, result: { ended: true } })
    for (const bad of [{}, { reason: 'bored' }, { reason: 7 }, { reason: 'finished', strike: false }, { reason: '' }]) expect(await runTool(call(), 'end_call', bad, { price: async () => priced() }), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    // the route, not the tool, keeps the strike, and only for the two reasons that are one
    expect(code(TOOL_ROUTE)).toContain('const guard = outcome.end && isStrike(outcome.end) ? await recordStrike(')
    expect(code(`${VOICE_DIR}/tools.ts`)).not.toMatch(/recordStrike|guardStore/)
  })

  it('A3: update_contact changes one detail by the request form\'s own rules, and she is told not to say it back', async () => {
    const outcome = await runTool(call(), 'update_contact', { field: 'email', value: 'dana.reyes @example.org' }, { price: async () => priced() })
    expect(outcome).toMatchObject({ ok: true, contact: { name: 'Dana Reyes', email: 'dana.reyes@example.org', phone: '(555) 201-3434' }, wouldDo: 'contact corrected: email is now dana.reyes@example.org', change: { contact: { email: 'dana.reyes@example.org' }, notes: { contactChanged: ['email'] } } })
    expect((outcome as Extract<ToolOutcome, { ok: true }>).result).toEqual({ status: 'updated', tellTheCaller: "Thanks, I've updated that.", doNot: 'Do not say the new value back.' })
    expect(await runTool(call(), 'update_contact', { field: 'phone', value: '020 7946 0958' }, { price: async () => priced() })).toMatchObject({ ok: true, contact: { phone: '020 7946 0958' } })
    expect(await runTool(call(), 'update_contact', { field: 'name', value: 'Dana R. Reyes' }, { price: async () => priced() })).toMatchObject({ ok: true, contact: { name: 'Dana R. Reyes' } })
    for (const bad of [{ field: 'email', value: 'dana at example' }, { field: 'phone', value: '12' }, { field: 'address', value: '1 High St' }, { field: 'email' }, { field: 'email', value: '' }, { value: 'x@y.zz' }]) expect(await runTool(call(), 'update_contact', bad, { price: async () => priced() }), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    expect(code(`${VOICE_DIR}/tools.ts`)).toContain("import { checkContact } from '../contact-rules'")
  })

  it('D8: book_time uses the details from the form, or the corrected ones, and never an argument', async () => {
    const slot = testSlots({ timeZone: 'America/New_York', now: NOW }).slots[1]!
    const deps = { price: async () => priced(), now: () => NOW }
    expect(await runTool(call(), 'book_time', { slot: slot.id }, deps)).toMatchObject({ ok: true, wouldDo: `would book: ${slot.label} (America/New_York) for Dana Reyes, (555) 201-3434, dana@example.com`, change: { notes: { visit: slot.label } }, result: { tellTheCaller: `The visit is noted for ${slot.label}. We will confirm it.` } })
    expect(await runTool(call({ session: { contact: { name: 'Dana Reyes', email: 'new@example.org', phone: null } } }), 'book_time', { slot: slot.id }, deps)).toMatchObject({ ok: true, wouldDo: `would book: ${slot.label} (America/New_York) for Dana Reyes, new@example.org` })
    expect(await runTool(call(), 'book_time', { slot: slot.id, name: 'Someone Else', phone: '555 000 0000' }, deps)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it('D7: send_estimate only says what it would have emailed, to the address on file, after an estimate', async () => {
    const deps = { price: async () => priced() }
    expect(await runTool(call(), 'send_estimate', {}, deps)).toMatchObject({ ok: false, code: 'NOTHING_TO_SEND' })
    const given = { notes: { ...NO_NOTES, estimates: [{ service: 'Service A', total: 450, say: 'four hundred and fifty dollars' }] } }
    expect(await runTool(call({ session: given }), 'send_estimate', {}, deps)).toMatchObject({ ok: true, wouldDo: 'would email the estimate to dana@example.com: Service A 450.00', result: { tellTheCaller: "I've emailed that to you." }, change: { notes: { estimateSent: true } } })
    expect(await runTool(call({ session: { ...given, contact: { name: 'Dana Reyes', email: null, phone: '(555) 201-3434' } } }), 'send_estimate', {}, deps)).toMatchObject({ ok: true, wouldDo: 'would pass the estimate to the team to send (no email address on file): Service A 450.00' })
  })

  it('E4: what her tools have answered goes back to her with every answer, so it outlives a trimmed memory', async () => {
    const notes = { estimates: [{ service: 'Service A', total: 450, say: 'four hundred and fifty dollars' }], typical: [{ service: 'Service A', total: 120, say: 'one hundred and twenty dollars' }], visit: 'Monday, November 30, 8 am to 10 am', estimateSent: true, contactChanged: ['email' as const] }
    expect(notesForHer(NO_NOTES)).toBeNull()
    expect(notesForHer(notes)).toEqual({ estimatesGiven: [{ service: 'Service A', sayTotal: 'four hundred and fifty dollars' }], typicalPricesGiven: [{ service: 'Service A', sayTotal: 'one hundred and twenty dollars' }], visitNoted: 'Monday, November 30, 8 am to 10 am', estimateEmailed: true, detailsCorrected: ['email'] })
    const free = await runTool(call(), 'get_free_times', {}, { price: async () => priced(), now: () => NOW })
    // she is given the first eight of the made-up times, not all twenty: a long list is read again on every later turn
    expect((toolResponse(free, notes) as { freeTimes: unknown[] }).freeTimes).toHaveLength(FREE_TIMES_GIVEN)
    expect(FREE_TIMES_GIVEN).toBe(8)
    expect((toolResponse(free, notes) as { callSoFar: unknown }).callSoFar).toEqual(notesForHer(notes))
    expect(toolResponse(free, NO_NOTES)).not.toHaveProperty('callSoFar')
    // and the estimate just given is in the notes its own answer carries
    const estimate = (await runTool(call(), 'get_estimate', { serviceId: 'svc_a', answers: [{ questionId: 'size', value: '40' }] }, { price: async () => priced() })) as Extract<ToolOutcome, { ok: true }>
    expect(estimate.change!.notes!.estimates).toEqual([{ service: 'Service A', total: 450, say: 'four hundred and fifty dollars' }])
    // the caller's email and phone never go to her: only which details were corrected
    expect(JSON.stringify(notesForHer(notes))).not.toMatch(/@|555/)
  })
})

describe('T-211 D3: the typical price', () => {
  const fields = [
    { fieldId: 'rooms', type: 'number' as const, label: 'How many rooms?', required: true },
    { fieldId: 'area', type: 'number' as const, label: 'Floor area', required: true, mapsToSignal: 'floor_area' },
    { fieldId: 'finish', type: 'select' as const, label: 'Which finish?', required: true, options: [{ value: 'prem', label: 'Premium' }, { value: 'std', label: 'Standard' }, { value: 'lux', label: 'Luxury' }] },
    { fieldId: 'urgent', type: 'boolean' as const, label: 'Is it urgent?', required: true },
    { fieldId: 'notes', type: 'text' as const, label: 'Anything else?', required: true },
    { fieldId: 'extras', type: 'number' as const, label: 'Extra items', required: false },
  ]
  const service = { ...business().services[0]!, fields, row: { id: 'svc_a', expected_signals: [{ signalKey: 'floor_area', type: 'number', description: 'Floor area', envelope: { absoluteMin: 25, absoluteMax: 5000 } }] } }
  /** A made-up engine: 10 a room, 2 a unit of area, the finish and urgency add to it */
  const engine = vi.fn(async (answers: Array<{ fieldId: string; value: unknown }>): Promise<WorkerPreview> => {
    const of = (id: string) => answers.find((a) => a.fieldId === id)?.value
    const total = Number(of('rooms') ?? 0) * 10 + Number(of('area') ?? 0) * 2 + ({ std: 0, prem: 40, lux: 90 }[String(of('finish'))] ?? 0) + (of('urgent') === true ? 25 : 0)
    return priced({ total, subtotal: total, lines: [{ label: 'Work', amount: total }] })
  })

  it('the smallest valid answers: required numbers at their minimum, required choices for the engine to decide, the rest left out', () => {
    expect(minimumOf({ fieldId: 'rooms' }, [])).toBe(1)
    expect(minimumOf(fields[1]!, service.row.expected_signals as never)).toBe(25)
    const plan = typicalPlan(service)
    expect(plan.fixed).toEqual([{ fieldId: 'rooms', value: 1 }, { fieldId: 'area', value: 25 }])
    expect(plan.choices.map((c) => [c.field.fieldId, c.options.map((o) => o.value)])).toEqual([['finish', ['prem', 'std', 'lux']], ['urgent', [false, true]]])
  })

  it('each choice is the option the ENGINE prices lowest (the one that adds nothing), and the total is the engine\'s own', async () => {
    engine.mockClear()
    const found = await typicalPrice(service, engine)
    expect(found).toMatchObject({ ok: true, answers: [{ fieldId: 'rooms', value: 1 }, { fieldId: 'area', value: 25 }, { fieldId: 'finish', value: 'std' }, { fieldId: 'urgent', value: false }], basis: 'How many rooms: 1; Floor area: 25; Which finish: Standard; Is it urgent: no', dependsOn: ['How many rooms', 'Floor area', 'Which finish', 'Is it urgent', 'Anything else'] })
    expect((found as { priced: { total: number } }).priced.total).toBe(60)
    // three options, then two, then the price itself: every figure came from the engine
    expect(engine).toHaveBeenCalledTimes(6)
    expect(engine.mock.calls.length).toBeLessThanOrEqual(TYPICAL_PRICE_CALLS)
    expect(code(`${VOICE_DIR}/typical.ts`)).not.toMatch(/[-+*/]\s*(total|amount|subtotal)|\.reduce\(/)
  })

  it('the basis is the answers used, in the questions\' own words', () => {
    expect(basisOf(fields, [{ fieldId: 'rooms', value: 2 }, { fieldId: 'finish', value: 'lux' }, { fieldId: 'urgent', value: true }, { fieldId: 'gone', value: 1 }])).toBe('How many rooms: 2; Which finish: Luxury; Is it urgent: yes')
    expect(basisOf(fields, [])).toBe('the simplest job')
  })

  it('no typical price for a service priced from photos, for one with no prices, or when the engine cannot be reached', async () => {
    expect(await typicalPrice(service, async () => priced({ unmeasured: [{ stepId: 's', name: 'Walls', rate: 2, unitLabel: 'sq ft' }] }))).toEqual({ ok: false, why: 'needs_photos' })
    expect(await typicalPrice({ ...service, rules: null }, engine)).toEqual({ ok: false, why: 'no_price' })
    expect(await typicalPrice(service, async () => priced({ total: 0 }))).toEqual({ ok: false, why: 'no_price' })
    expect(await typicalPrice(service, async () => ({ success: false, reason: 'unreachable' }))).toEqual({ ok: false, why: 'unavailable' })
  })

  it('the tool: the same path as an estimate, the total in figures and in words, the basis and what it depends on', async () => {
    const price = vi.fn(async (_input: unknown) => priced({ total: 120, subtotal: 120, lines: [{ label: 'Work', amount: 120 }] }))
    const outcome = await runTool(call(), 'get_typical_price', { serviceId: 'svc_a' }, { price })
    expect(price.mock.calls[0]![0]).toEqual({ tenantId: 'tnt_one', service: { id: 'svc_a', name: 'Service A' }, rules: { baseFee: 0 }, fields: business().services[0]!.fields, answers: [{ fieldId: 'size', value: 1 }] })
    expect(outcome).toMatchObject({ ok: true, typical: { service: 'Service A', currency: 'USD', total: 120, lines: [120] }, change: { notes: { typical: [{ service: 'Service A', total: 120, say: 'one hundred and twenty dollars' }] } } })
    expect((outcome as Extract<ToolOutcome, { ok: true }>).result).toEqual({ service: 'Service A', typicalTotal: 120, sayTotal: 'one hundred and twenty dollars', forAJobOf: 'How large is it: 1', dependsOn: ['How large is it'], note: 'Not an estimate for their job.' })
    const photos = await runTool(call(), 'get_typical_price', { serviceId: 'svc_a' }, { price: async () => priced({ unmeasured: [{ stepId: 's', name: 'Walls', rate: 2, unitLabel: null }] }) })
    expect(photos).toEqual({ ok: true, result: { service: 'Service A', noTypicalPrice: true, tellTheCaller: 'We price that one from photos, so we need photos before we can say what it costs.' } })
    expect(await runTool(call(), 'get_typical_price', { serviceId: 'svc_b' }, { price })).toMatchObject({ ok: false, code: 'NO_PRICE' })
  })

  it('it writes nothing: its one way out is the price it is handed, which is the worker\'s preview', () => {
    const typical = code(`${VOICE_DIR}/typical.ts`)
    expect(typical).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(|createAdminClient|fetch\(/)
    expect(code(`${VOICE_DIR}/tools.ts`)).toContain('typicalPrice(service, (answers) => deps.price({ tenantId: b.id, service: service.row, rules: service.rules, fields: service.fields, answers }))')
  })
})

describe('T-211 C3: money in words', () => {
  it('says an amount the way a person does, in the currency\'s own words', () => {
    expect(moneyWords(825, 'USD')).toBe('eight hundred and twenty-five dollars')
    expect(moneyWords(7347, 'USD')).toBe('seven thousand three hundred and forty-seven dollars')
    expect(moneyWords(1250.5, 'GBP')).toBe('one thousand two hundred and fifty pounds and fifty pence')
    expect(moneyWords(1, 'USD')).toBe('one dollar')
    expect(moneyWords(0.99, 'EUR')).toBe('ninety-nine cents')
    expect(moneyWords(1001, 'USD')).toBe('one thousand and one dollars')
    expect(moneyWords(2_000_000, 'USD')).toBe('two million dollars')
    expect(moneyWords(100.01, 'GBP')).toBe('one hundred pounds and one pence')
    expect(moneyWords(450, 'XXX')).toBeNull()
    expect([numberWords(0), numberWords(19), numberWords(40), numberWords(110), numberWords(999_999)]).toEqual(['zero', 'nineteen', 'forty', 'one hundred and ten', 'nine hundred and ninety-nine thousand nine hundred and ninety-nine'])
    expect([currencyWord('USD'), currencyWord('gbp'), currencyWord('XXX')]).toEqual(['dollars', 'pounds', null])
  })

  it('the page reads every such amount back to the same figure', () => {
    const amounts = [0.05, 1, 1.01, 9.99, 12, 20, 99, 100, 101, 119.5, 450, 487.13, 825, 1000, 1001, 1250.5, 7347, 11094, 25000, 100_000, 999_999.99, 1_000_000]
    for (let n = 13; n < 60_000; n = Math.round(n * 1.37 * 100) / 100 + 0.01) amounts.push(Math.round(n * 100) / 100)
    for (const currency of ['USD', 'GBP', 'EUR']) {
      for (const amount of amounts) {
        const said = moneyWords(amount, currency)!
        // an amount under one unit is said in the small unit alone, and a "cent" names no one currency
        const expected = amount < 1 && currency !== 'GBP' ? null : currency
        expect(spokenAmounts(`That comes to ${said}, which we'll confirm.`).filter((a) => a.money).map((a) => [a.amount, a.currency]), `${amount} ${currency}: ${said}`).toEqual([[amount, expected]])
      }
    }
  })
})

describe('T-211 G: which spoken amounts are valid', () => {
  const results = (over: Partial<CallResults> = {}): CallResults => ({
    business: 'Harlow Works', engine: 'gemini', model: 'a-live-model', voice: 'Aoede', browser: 'A browser', seconds: 95, status: 'ended', endedBecause: 'she ended the call (finished)', endReason: 'finished',
    transcript: [
      { who: 'her', at: 1, text: "Hi Dana, I'm Oumn." },
      { who: 'caller', at: 5, text: 'What does it cost?' },
      { who: 'her', at: 7, text: 'It depends on the size, but we normally charge about one hundred and twenty dollars.' },
      { who: 'caller', at: 15, text: 'It is forty.' },
      { who: 'her', at: 20, text: "That's an estimate of four hundred and fifty dollars. The base is seventy-five dollars." },
      { who: 'caller', at: 30, text: 'And for eighty?' },
      { who: 'her', at: 36, text: 'About nine hundred dollars. That comes to four hundred and fifty dollars. That comes to four hundred and fifty dollars.' },
    ],
    turns: [{ n: 1, at: 1, ms: null, tools: [], overlapped: false }, { n: 2, at: 6, ms: 900, answerMs: 1900, tools: ['get_typical_price'], overlapped: false }, { n: 3, at: 19, ms: 1000, answerMs: 2400, tools: ['get_estimate'], overlapped: false }, { n: 4, at: 36, ms: 1100, tools: [], overlapped: true }],
    tools: [
      { at: 6.5, name: 'get_typical_price', args: { serviceId: 'svc_a' }, ok: true, response: { service: 'Service A' }, ms: 300, typical: { service: 'Service A', currency: 'USD', total: 120, lines: [120] } },
      { at: 19.5, name: 'get_estimate', args: { serviceId: 'svc_a' }, ok: true, response: { service: 'Service A', total: 450 }, ms: 240, engine: { currency: 'USD', total: 450, subtotal: 450, taxAmount: 0, lines: [75, 375] } },
      { at: 60, name: 'book_time', args: { slot: 'x' }, ok: false, response: { error: 'no' }, ms: 30 },
    ],
    tokens: { turns: 3, textIn: 9000, audioIn: 2000, otherIn: 0, textOut: 80, audioOut: 900, thoughts: 300 },
    contexts: [3100, 4200, 3900], minutes: NO_MINUTES,
    guard: { blocked: false, blockedUntil: null, strikes: 1, deviceCallsToday: 2, businessCallsToday: 5, unavailable: false },
    contact: { name: 'Dana Reyes', email: 'new@example.org', phone: null }, corrected: [{ at: 50, field: 'email', value: 'new@example.org' }], problems: [],
    ...over,
  })

  it('valid: an engine total, an engine line, a typical price returned in this call. Anything else is a mismatch', () => {
    expect(moneySaid(results()).map((s) => [s.amount, s.is])).toEqual([[120, 'typical'], [450, 'total'], [75, 'line'], [900, 'not_the_engines'], [450, 'total'], [450, 'total']])
    expect(validAmounts(results().tools)).toEqual({ currency: 'USD', totals: [450], lines: [75, 375], typical: [120] })
  })

  it('an amount she said BEFORE the engine gave it is a mismatch: she cannot have had it from the engine', () => {
    const early = results({ transcript: [{ who: 'her', at: 3, text: 'It will be four hundred and fifty dollars.' }, { who: 'her', at: 25, text: 'Yes, four hundred and fifty dollars.' }] })
    expect(moneySaid(early).map((s) => [s.at, s.is])).toEqual([[3, 'not_the_engines'], [25, 'total']])
  })

  it('the wrong currency is flagged, and a number that is not money is not checked', () => {
    expect(moneySaid(results({ transcript: [{ who: 'her', at: 25, text: 'That is 450 pounds, for 2 rooms, on Monday the 30th at 8.' }] }))).toMatchObject([{ amount: 450, is: 'total', wrongCurrency: true }])
  })

  it('with tax, the amount before tax and the tax are engine lines too', () => {
    const taxed = results({ tools: [{ at: 1, name: 'get_estimate', args: {}, ok: true, response: {}, ms: 1, engine: { currency: 'USD', total: 487.13, subtotal: 450, taxAmount: 37.13, lines: [450] } }], transcript: [{ who: 'her', at: 2, text: '$450 before tax, $37.13 sales tax, $487.13 in all.' }] })
    expect(moneySaid(taxed).map((s) => s.is)).toEqual(['line', 'line', 'total'])
  })

  it('each price the engine gave is marked said or not said; a sentence said twice is found', () => {
    expect(priceChecks(results()).map((c) => [c.kind, c.total, c.said])).toEqual([['typical', 120, true], ['estimate', 450, true]])
    expect(priceChecks(results({ transcript: [] })).map((c) => c.said)).toEqual([false, false])
    expect(repeatedSentences(results().transcript)).toEqual(['"that comes to four hundred and fifty dollars" (2 times)'])
    expect(toolDelaysOf(results().turns)).toEqual([1900, 2400])
  })

  it('"Copy results": the engine and voice, the end reason, strikes and block, the checks, what she recorded', () => {
    const text = resultsText(results(), { live: { textInPerMTok: 0.75, audioInPerMTok: 3, textOutPerMTok: 4.5, audioOutPerMTok: 12, asOf: '2026-11-27', source: 's' }, minute: null, backend: null })
    for (const part of ['OUMN TEST CALL', 'Engine: Gemini Live   Model: a-live-model   Voice: Aoede', 'Ended: she ended the call (finished)   Her reason: finished', 'Strikes: 1   Blocked: no   Calls today: device 2, business 5', '1. COST', 'Context read at each turn (tokens): 3100, 4200, 3900', 'With a tool, to the answer itself: median 2150 ms, worst 2400 ms', 'Turn 3 at 0:19: 1000 ms (get_estimate: 2400 ms to the answer)', '0:06 typical price, Service A: 120.00 USD | SAID', 'she said "nine hundred dollars" = 900.00: MISMATCH (not a figure the engine gave)', 'valid (a typical price)', 'valid (an engine line)', 'Sentences she said more than once: "that comes to four hundred and fifty dollars" (2 times)', '5. WHAT SHE RECORDED', 'Not on her list, for the team to confirm: nothing', 'Contact details corrected: 0:50 email is now new@example.org', 'Details on file: Dana Reyes, new@example.org', '6. TOOL CALLS', 'TRANSCRIPT']) expect(text, part).toContain(part)
    const blocked = resultsText(results({ guard: { blocked: true, blockedUntil: T0, strikes: 0, deviceCallsToday: 1, businessCallsToday: 1, unavailable: false } }), { live: null, minute: null, backend: null })
    expect(blocked).toContain('Blocked: yes, until 2027-01-15 08:00 UTC')
    expect(resultsText(results({ guard: { blocked: false, blockedUntil: null, strikes: 0, deviceCallsToday: null, businessCallsToday: null, unavailable: true } }), { live: null, minute: null, backend: null })).toContain('Strikes: not counted (the store was not there)')
  })

  it('D1: what is not on her list is read from the call: what the caller had asked each time she said so', () => {
    const talk = [
      { who: 'her' as const, at: 1, text: "Hi Dana, I'm Oumn." },
      { who: 'caller' as const, at: 5, text: 'Do you do a second coat?' },
      { who: 'her' as const, at: 7, text: "That's not on my list, so I'll get the team to confirm." },
      { who: 'caller' as const, at: 15, text: 'Is there parking?' },
      { who: 'her' as const, at: 17, text: "I'll have the team confirm that for you." },
      { who: 'her' as const, at: 18, text: 'I will check with the team on that too.' },
      { who: 'caller' as const, at: 25, text: 'How much for forty?' },
      { who: 'her' as const, at: 28, text: "That's an estimate of four hundred and fifty dollars, and I'll get the team to confirm it." },
      { who: 'caller' as const, at: 35, text: 'Is the trim included?' },
      { who: 'her' as const, at: 37, text: 'Yes, that is included.' },
    ]
    // the two unanswered questions, once each; not the estimate that "the team will confirm", and not an answered question
    expect(forTheTeam(talk).map((t) => [t.at, t.asked])).toEqual([[7, 'Do you do a second coat?'], [17, 'Is there parking?']])
    expect(forTheTeam([])).toEqual([])
    const text = resultsText(results({ transcript: talk }), { live: null, minute: null, backend: null })
    expect(text).toContain('Not on her list, for the team to confirm: \n  0:07 the caller asked: "Do you do a second coat?"\n  0:17 the caller asked: "Is there parking?"')
    // no tool is called for it
    expect(TOOL_NAMES.join(' ')).not.toMatch(/list|record/)
  })

  it('the page has the ten things to try, in the ticket\'s order', () => {
    expect(THINGS_TO_TRY).toHaveLength(10)
    expect(THINGS_TO_TRY.join(' ')).toMatch(/costs before[\s\S]*two services[\s\S]*not listed[\s\S]*nearby[\s\S]*far away[\s\S]*another country[\s\S]*off topic[\s\S]*rude[\s\S]*silent[\s\S]*goodbye[\s\S]*Trail off[\s\S]*Correct your email/)
  })
})

describe('T-211 C and D: how she is told to talk, and what she knows', () => {
  const setup = { callerName: 'Dana Reyes', hasEmail: true, hasPhone: true, basedIn: '', generalAdvice: true }
  const text = buildInstruction(business(), setup)

  it('she is staff: "we" and "our", short, and never "<business> does not offer"', () => {
    expect(text.split('\n')[0]).toBe("You are Oumn, Harlow Works's AI assistant, on a voice call with a customer. You speak as one of the team.")
    expect(text).toContain('You are staff: say "we" and "our", use contractions, one or two short sentences at a time. Say "We don\'t offer that", never "Harlow Works does not offer that".')
    expect(text).toContain('say truthfully that you are an AI assistant')
    expect(ASSISTANT_NAME).toBe('Oumn')
  })

  it('A3: she greets by first name and never asks for, says or spells a name, an email or a phone number', () => {
    expect(firstNameOf('  Dana  Reyes ')).toBe('Dana')
    expect(text).toContain("you're Oumn, Harlow Works's AI assistant; greet Dana by first name")
    expect(text).toContain('We have their name and an email address and a phone number on file. Never ask for a name, an email address or a phone number, and never say or spell one back.')
    expect(text).toContain('call update_contact, and say thanks. Do not repeat it.')
    // her instructions hold the name only: not the address, not the number
    expect(text).not.toMatch(/dana@example\.com|555/)
    expect(buildInstruction(business(), { ...setup, hasPhone: false })).toContain('We have their name and an email address on file.')
  })

  it('C2 to C6: no repeats, money in words, a line before a slow tool, English, and waiting for an unfinished sentence', () => {
    expect(text).toContain('Never say the same sentence twice in a call.')
    expect(text).toContain('Do not end every answer with the same question.')
    expect(text).toContain('Say an amount exactly as the tool\'s "say" words give it (like "eight hundred and twenty-five dollars"), in dollars. Never say a currency code such as USD.')
    expect(buildInstruction(business({ currency: 'GBP' }), setup)).toContain('(like "eight hundred and twenty-five pounds"), in pounds. Never say a currency code such as GBP.')
    expect(text).toContain('ALWAYS speak first: one short natural line such as "One moment, let me check", in different words each time. Then call the tool at once, in the same turn: never stop after that line.')
    expect(text).toContain('Answer in English. Change language only if the caller speaks a whole sentence in another language; a stray foreign word in what you heard is a slip of the line, so ignore it.')
    expect(text).toContain('stay silent and let them finish. Never talk over them.')
  })

  it('D1 and D2: included, not included, not on my list; and no guessed answers', () => {
    expect(text).toContain('In a service\'s "Included" list: confirm it is included, also when the caller describes it in other words.')
    expect(text).toContain('In a service\'s "Not included" list: say "that\'s not included".')
    expect(text).toContain('say that it is "not on my list" and that you\'ll get the team to confirm. Always use the words "not on my list", in a differently worded sentence each time. Never say we don\'t offer it, and never make an answer up.')
    expect(text).toContain('If an answer is vague ("a couple", "quite big", "not sure"), ask for a number or a clear choice and confirm it first. Never guess an answer.')
  })

  it('D3, D5, D7: the typical price up front, several services each from the tool, and the estimate is sent', () => {
    expect(text).toContain('call get_typical_price. Then say, in your own words, that it depends on (what its questions ask), but we normally charge about (the amount) for (what the tool gives as "forAJobOf", in plain words), and ask the questions for a proper estimate.')
    expect(text).toContain('say we need photos for that one')
    expect(text).toContain('Several services: get each price from the tool, give each separately, and say the written estimate will show the total. Never add them up.')
    expect(text).toContain("call send_estimate, then say you've emailed it. Never say that you can't send things.")
    expect(text).toContain('A price comes only from get_typical_price or get_estimate. Never work out, add, multiply, round, convert or guess a price, and never say one before the tool has answered.')
  })

  it('D6: general advice is on by default and can be switched off', () => {
    expect(text).toContain('You may give one or two sentences of basic, general advice about the kind of work we do, ending with "the team will confirm when they see it".')
    expect(text).toContain('Never give step-by-step instructions for work that could hurt someone or damage a property if done wrong: say that is one for us to handle.')
    const off = buildInstruction(business(), { ...setup, generalAdvice: false })
    expect(off).toContain('Do not give advice about how work is done, even general advice.')
    expect(off).not.toContain('You may give one or two sentences')
  })

  it('B1 to B4: goodbye, off topic, abuse and silence each end the call her way', () => {
    expect(text).toContain('say one short goodbye, then call end_call with reason "finished"')
    expect(text).toContain('steer once ("I can help with what we do. What do you need?"). Still off topic about 30 seconds later: end politely and call end_call with reason "off_topic".')
    expect(text).toContain('one calm warning that you will end the call if it carries on. If it happens again, say goodbye and call end_call with reason "abusive".')
    expect(text).toContain('ask, once and briefly, whether they are still there. A system note that they are still silent: say a short goodbye and call end_call with reason "silent".')
    expect(text).toContain('end_call is the last thing you do: your goodbye comes before it, and nothing after it is heard.')
    // …and the page does not play what she says once end_call is answered (round two's first call had her read its answer out)
    expect(code(`${VOICE_DIR}/call-client.ts`)).toContain('if (!data || this.hushed) continue')
    expect(systemNote('the call has connected.')).toBe('[System note: the call has connected.]')
    expect(text).toContain(`A line in square brackets that begins "${SYSTEM_NOTE}" is from the phone system, not the caller. Act on it; never read it out or mention it. One that begins "${SYSTEM_NOTE}: for your notes" needs no answer.`)
  })

  it('E1: the business\'s information is in her instructions from the start', () => {
    expect(text).toContain('WHAT YOU KNOW ABOUT HARLOW WORKS')
    expect(text).toContain('Our standard terms: Half is due before work starts.')
    expect(text).toContain('Service "Service A" (id svc_a): The first service.\n  Included: Part one\n  Not included: Part nine\n  We assume: Access from the ground\n  Question size (number, needed for a price): How large is it?\n  Question finish (select, optional): Which finish? Choices: Standard (value std), Premium (value prem).\n  Question rush (boolean, optional): Is it urgent?\n  Measurement measured_area (sq ft): Area read from photos. We normally measure this from photos; pass it only if the caller knows it.')
    expect(text).toContain('Service "Service B" (id svc_b)')
    // nothing the pricing worker needs: no rules, no rates
    expect(text).not.toMatch(/baseFee|rules|defaultCost/)
    expect(buildInstruction(business({ services: [] }), setup)).toContain('We have no services set up yet.')
  })

  it('D4: which service-area wording she is given', () => {
    // the business has set an area: that area and nothing else, whatever "Based in" says
    const set = areaRule(business(), 'Springfield')
    expect(set.kind).toBe('set')
    expect(set.lines.join('\n')).toContain('We cover only these areas (each is a ZIP code, the start of one, or a named area): 63021, Missouri.')
    expect(set.lines.join('\n')).not.toContain('Springfield')
    const open = business({ serviceArea: { everywhere: true, areas: [], postalCodeLabel: 'ZIP code' } })
    // no area, "Based in" filled: where we are based, nearby is normally fine, the team confirms further out, ask where the job is
    const based = areaRule(open, '  Springfield ')
    expect(based.kind).toBe('based_in')
    expect(based.lines.join('\n')).toContain("We're based in Springfield.")
    expect(based.lines.join('\n')).toContain("say we're based in Springfield, that nearby is normally fine and the team will confirm anything further out, and ask where the job is. Never say that we do cover a place.")
    // no area, "Based in" empty: ask where the job is, the team will confirm
    const unknown = areaRule(open, '')
    expect(unknown.kind).toBe('not_set')
    expect(unknown.lines.join('\n')).toContain('ask where the job is, and say the team will confirm we cover it. Never say that we do cover a place.')
    expect(unknown.lines.join('\n')).not.toMatch(/based in [A-Z]/)
    // another country is always no
    for (const rule of [set, based, unknown]) expect(rule.lines.at(-1)).toBe('- A job in another country than United States: "Sorry, we don\'t cover that."')
    expect(areaRule(business({ country: 'United Kingdom' }), '').lines.at(-1)).toContain('another country than United Kingdom')
    // she never promises an area that is not set
    for (const rule of [based, unknown]) expect(rule.lines.join('\n')).not.toMatch(/yes, we cover/i)
    expect(buildInstruction(open, { ...setup, basedIn: 'Springfield' })).toContain("We're based in Springfield.")
  })

  it('urgent and danger: the region\'s own emergency number', () => {
    expect(text).toContain('tell them first to call 911 now')
    expect(buildInstruction(business({ emergencyNumber: getRegion('GB').emergencyNumber }), setup)).toContain('tell them first to call 999 now')
  })

  it('the words she must not use are the customer language guard\'s own list, and her instructions use none of them', () => {
    expect(text).toContain(`Never use these words about a price or the work: ${CUSTOMER_BANNED_WORDS.join(', ')}.`)
    const rest = text.replace(/- Never use these words[^\n]*\n/, '')
    for (const word of CUSTOMER_BANNED_WORDS) expect(rest.toLowerCase(), word).not.toMatch(new RegExp(`(^|[^a-z])${word}([^a-z]|$)`))
  })

  it('nothing in her instructions, or in the code, is about one trade (the T-210 test, kept)', () => {
    const trades = /\b(paint|painting|painter|plumb\w*|roof\w*|cleaning|cleaner|boiler|hvac|electric\w*|garden\w*|carpet|window|fenc\w*|pressure wash\w*)\b/i
    expect(text).not.toMatch(trades)
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, COMPONENT]) expect(code(file), file).not.toMatch(trades)
    // only the business's own words and the call's own details differ between two businesses
    const other = buildInstruction(business({ name: 'Marlow & Sons', services: [], terms: null }), setup)
    expect(other.split('WHAT YOU KNOW ABOUT')[0]!.split('Marlow & Sons').join('NAME')).toBe(buildInstruction(business({ services: [], terms: null }), setup).split('WHAT YOU KNOW ABOUT')[0]!.split('Harlow Works').join('NAME'))
  })
})

describe('T-211 E: speed and cost', () => {
  const setup = { model: 'a-live-model', voice: 'Aoede', instruction: 'x'.repeat(8000), tools: toolDeclarations(), language: 'en-US' }

  it('the token still locks the call, and now carries the end-of-speech wait, the sliding window and the language', () => {
    const request = tokenRequest(setup, NOW)
    expect(request.uses).toBe(1)
    expect(request).not.toHaveProperty('fieldMask')
    expect(request.bidiGenerateContentSetup).toEqual(lockedSetup(setup))
    expect(request.bidiGenerateContentSetup).toMatchObject({
      model: 'models/a-live-model',
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
      realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: LIVE_TUNING.silenceDurationMs, prefixPaddingMs: LIVE_TUNING.prefixPaddingMs } },
      inputAudioTranscription: { languageCodes: ['en-US'] },
      outputAudioTranscription: {},
    })
    expect(request.bidiGenerateContentSetup.tools[0]!.functionDeclarations.map((d) => (d as { name: string }).name)).toEqual([...TOOL_NAMES])
    expect(new Date(request.expireTime).getTime() - NOW.getTime()).toBe(TOKEN_LIFE_SECONDS * 1000)
  })

  it('E3: the wait for the end of speech is shorter than the Live API\'s own (about 800 ms), inside Google\'s advice', () => {
    expect(LIVE_TUNING.silenceDurationMs).toBe(500)
    expect(LIVE_TUNING.silenceDurationMs).toBeGreaterThanOrEqual(500)
    expect(LIVE_TUNING.silenceDurationMs).toBeLessThan(800)
  })

  it('E4: the call\'s memory slides: her instructions\' own size, plus the conversation to allow and to keep', () => {
    const tools = JSON.stringify(setup.tools).length
    const fixed = Math.ceil((8000 + tools) / LIVE_TUNING.charsPerToken)
    expect(slidingWindow(setup)).toEqual({ triggerTokens: fixed + LIVE_TUNING.historyTriggerTokens, slidingWindow: { targetTokens: fixed + LIVE_TUNING.historyKeepTokens } })
    expect(LIVE_TUNING.historyKeepTokens).toBeLessThan(LIVE_TUNING.historyTriggerTokens)
    expect(lockedSetup(setup).contextWindowCompression).toEqual(slidingWindow(setup))
    // longer instructions move both numbers up: the conversation's room does not shrink
    const longer = slidingWindow({ ...setup, instruction: 'x'.repeat(16_000) })
    expect(longer.triggerTokens - slidingWindow(setup).triggerTokens).toBe(2000)
  })

  it('E2: this model takes no thinking setting, so none is sent', () => {
    expect(JSON.stringify(lockedSetup(setup))).not.toMatch(/thinking/i)
  })

  it('the key goes to Google in a header and is in nothing that comes back', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ name: 'auth_tokens/abc123' }), { status: 200 })
    }) as unknown as typeof fetch
    expect(await mintLiveToken('the-api-key', setup, { now: NOW, fetchImpl })).toEqual({ ok: true, token: 'auth_tokens/abc123' })
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('the-api-key')
    expect(String(calls[0]!.init.body)).not.toContain('the-api-key')
    expect(liveSocketUrl('auth_tokens/a b')).toBe('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fa%20b')
  })
})

describe('T-211 F: the second engine, for comparison only', () => {
  it('it is offered only when its key is set', () => {
    expect(openAiEnabled({ OPENAI_API_KEY: 'k' })).toBe(true)
    expect(openAiEnabled({})).toBe(false)
    expect(openAiEnabled({ OPENAI_API_KEY: '' })).toBe(false)
    expect(ENGINES).toEqual(['gemini', 'openai'])
    expect(code(PAGE)).toMatch(/if \(openAiEnabled\(\)\) \{[\s\S]*engines\.push\(\{ id: 'openai'/)
    expect(code(COMPONENT)).toContain('{engines.length > 1 && (')
    expect(code(SESSION_ROUTE)).toContain("(engine === 'openai' && !openAiEnabled())")
    expect(read('apps/web/.env.example')).toMatch(/^# OPENAI_API_KEY=$/m)
  })

  it('the registry holds its voice model and its backend model, apart from the product\'s tasks', () => {
    expect(registry.comparison).toEqual({ voice_call_openai: { provider: 'openai', model: resolveComparisonModel('voice_call_openai').model }, voice_call_openai_backend: { provider: 'openai', model: resolveComparisonModel('voice_call_openai_backend').model } })
    expect(resolveComparisonModel('voice_call_openai', { AI_MODEL_VOICE_CALL_OPENAI: 'another-voice-model' }).model).toBe('another-voice-model')
    expect(resolveComparisonModel('voice_call_openai_backend', { AI_MODEL_VOICE_CALL_OPENAI_BACKEND: 'another-backend' }).model).toBe('another-backend')
    // no product task runs on it
    expect(Object.values(registry.tasks).map((t) => t.provider)).not.toContain('openai')
    expect(Object.keys(registry.tasks).join(' ')).not.toMatch(/openai/)
    expect(resolveModelRoute('voice_call').provider).toBe('gemini')
  })

  it('its prices are in the registry with the date and the page: by the minute for the voice, by the token for the backend', () => {
    const voice = getLiveMinutePrice(resolveComparisonModel('voice_call_openai').model)!
    expect(voice.activePerMinute).toBeGreaterThan(0)
    expect(voice.startSeconds).toBeGreaterThan(0)
    expect(voice.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(voice.source).toMatch(/^developers\.openai\.com\//)
    const backend = getModelPrice(resolveComparisonModel('voice_call_openai_backend').model)!
    expect(backend.inputPerMTok).toBeGreaterThan(0)
    expect(backend.outputPerMTok).toBeGreaterThan(backend.inputPerMTok)
    expect(backend.source).toMatch(/^developers\.openai\.com\//)
    const voices = comparisonVoices(resolveComparisonModel('voice_call_openai').model)!
    expect(voices.voices).toContain(voices.default)
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, COMPONENT]) {
      expect(code(file), file).not.toMatch(/gpt-|PerMinute\s*[:=]\s*\d|startSeconds\s*[:=]\s*\d/)
      for (const name of voices.voices) expect(code(file), `${file} ${name}`).not.toContain(`'${name}'`)
    }
  })

  it('the voice by the minute, with the seconds a session is charged as it starts, plus the backend\'s tokens', () => {
    const voice = { activePerMinute: 0.05, startSeconds: 15 }
    const backend = { inputPerMTok: 0.1, outputPerMTok: 0.5, cachedInputPerMTok: 0.01 }
    const five = minuteCost({ seconds: 300, backendIn: 100_000, backendCachedIn: 60_000, backendOut: 2_000 }, voice, backend)!
    expect(five.voiceUsd).toBeCloseTo(0.25, 9)
    expect(five.backendUsd).toBeCloseTo(40_000 * 0.1e-6 + 60_000 * 0.01e-6 + 2_000 * 0.5e-6, 9)
    expect(five.perMinuteUsd).toBeCloseTo(five.totalUsd / 5, 9)
    // a call shorter than the start charge is charged the start charge
    expect(minuteCost({ ...NO_MINUTES, seconds: 6 }, voice, backend)).toMatchObject({ billedSeconds: 15, voiceUsd: 0.0125 })
    // …and a longer one only its own time: the start is credited against it
    expect(minuteCost({ ...NO_MINUTES, seconds: 60 }, voice, null)).toMatchObject({ billedSeconds: 60, voiceUsd: 0.05, backendUsd: 0 })
    expect(minuteCost({ ...NO_MINUTES, seconds: 60 }, null, backend)).toBeNull()
  })

  it('the session is created with the same instructions and tools, and the browser may not change them', () => {
    const request = liveSessionRequest({ model: 'a-voice-model', backendModel: 'a-backend-model', voice: 'a-voice', instruction: 'You are Oumn.', tools: functionTools(), sdp: 'v=0 offer' })
    expect(request.transport).toEqual({ type: 'webrtc', sdp: 'v=0 offer' })
    expect(request.session).toMatchObject({ model: 'a-voice-model', instructions: 'You are Oumn.', audio: { output: { voice: 'a-voice' } }, store: false, delegation: { type: 'responses', responses: { model: 'a-backend-model', tool_choice: 'auto' } } })
    expect(request.session.delegation.responses.instructions.startsWith('You are Oumn.\n\n')).toBe(true)
    expect((request.session.delegation.responses.tools as Array<{ name: string }>).map((t) => t.name)).toEqual([...TOOL_NAMES])
    // the lock: the events a browser may send do not include the two that change her instructions or her tools
    expect(request.session.client.data_channel.allowed_client_events).toEqual([...BROWSER_MAY_SEND])
    expect(BROWSER_MAY_SEND).not.toContain('session.update')
    expect(BROWSER_MAY_SEND).not.toContain('session.instructions.append')
    expect(request.session.input[0]).toMatchObject({ role: 'developer', content: [{ type: 'input_text' }] })
  })

  it('the key goes to OpenAI in a header from our server, and the browser gets the answer and no key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ session: { id: 'live_123' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } }), { status: 201 })
    }) as unknown as typeof fetch
    const setup = { model: 'm', backendModel: 'b', voice: 'v', instruction: 'i', tools: [], sdp: 'v=0 offer' }
    expect(await createLiveSession('the-openai-key', setup, { fetchImpl })).toEqual({ ok: true, sessionId: 'live_123', sdp: 'v=0 answer' })
    expect(calls[0]!.url).toBe(OPENAI_LIVE_URL)
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer the-openai-key')
    expect(String(calls[0]!.init.body)).not.toContain('the-openai-key')
    expect(await createLiveSession('k', setup, { fetchImpl: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch })).toEqual({ ok: false, status: 401 })
    expect(await createLiveSession('k', setup, { fetchImpl: (async () => { throw new Error('down') }) as unknown as typeof fetch })).toEqual({ ok: false, status: 0 })
    const route = code(SESSION_ROUTE)
    expect(route.match(/OPENAI_API_KEY/g)).toHaveLength(1)
    expect(route.match(/GEMINI_API_KEY/g)).toHaveLength(1)
    const answered = route.slice(route.indexOf('return NextResponse.json({\n      engine,'))
    expect(answered).not.toMatch(/apiKey|secret\b/)
    for (const file of [COMPONENT, `${VOICE_DIR}/call-client.ts`, PAGE]) expect(code(file), file).not.toMatch(/_API_KEY|x-goog-api-key|Bearer /)
  })

  it('her tools run on our server on this engine too: the page passes each call to the same route', () => {
    const client = code(`${VOICE_DIR}/call-client.ts`)
    expect(client.match(/fetch\('\/api\/admin\/voice-test\/tool'/g)).toHaveLength(1)
    expect(client).toContain("if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {")
    expect(client).toContain("send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: call.id, output: JSON.stringify(response) } })")
    expect(client).toContain("const channel = peer.createDataChannel('oai-events')")
  })
})

describe('T-211 the page is still private and off by default', () => {
  it('the page and all three routes ask the one rule first: switched on, and a platform admin', () => {
    expect(voiceTestEnabled({ VOICE_TEST_ENABLED: 'true' })).toBe(true)
    for (const value of [undefined, '', 'false', '1', 'TRUE']) expect(voiceTestEnabled({ VOICE_TEST_ENABLED: value }), String(value)).toBe(false)
    for (const file of ROUTES) expect(code(file), file).toMatch(/export async function POST\(request: NextRequest\) \{\s+const admin = await voiceTestAdmin\(\)\s+if \(!admin\) return notThere\(\)/)
    expect(code(PAGE)).toMatch(/const admin = await voiceTestAdmin\(\)\s+if \(!admin\) notFound\(\)/)
    expect(code(SESSION_ROUTE)).toContain("checkRateLimit('voice_test_start', { ip, key: admin.userId })")
    expect(code(TOOL_ROUTE)).toContain("checkRateLimit('voice_test_tool', { ip: getClientIp(request), key: admin.userId })")
    expect(read('apps/web/.env.example')).toMatch(/^# VOICE_TEST_ENABLED=true$/m)
    expect(read('apps/web/src/app/admin/layout.tsx')).not.toContain('voice-test')
  })

  it('nothing of a call is logged, and nothing but a strike or a count is kept', () => {
    for (const file of ROUTES) expect(code(file), file).not.toMatch(/console\.(log|info|warn)\(|logAdminActivity/)
    for (const file of [...VOICE_FILES, ...ROUTES, PAGE, COMPONENT]) expect(code(file), file).not.toMatch(/\.(insert|upsert|rpc)\(|\.from\('[a-z_]+'\)\.(update|delete)\(/)
  })
})
