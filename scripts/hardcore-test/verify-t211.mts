// T-211 check, against the real servers (local stack). No model is asked, no call is made to a
// voice engine, no email is sent, and nothing here touches production.
//
// What it proves
//   A  starting a call: the caller's details are held to the business's own contact rules; the
//      second engine is not offered without its key; with no store set up the protection lets
//      every call through and says so
//   B  through the real tool route and the real pricing worker: get_typical_price is the engine's
//      own total for the smallest valid answers (the same as "Test your pricing" gives for them);
//      two services are two engine prices and no sum; a corrected detail is used by the tools
//      that follow; end_call takes its four reasons. **A typical price and estimates for several
//      services write nothing**: no quote, request, lead or usage count, and the business's own
//      rows are as they were
//   C  the page in a real browser, with a stand-in for the Live API on its socket: the details
//      form and the line under the button; she is told the call has connected; a typical price
//      and an estimate she says are valid, an amount the engine did not give is a mismatch in
//      red; "not on my list" is recorded with what the caller had asked; a corrected email shows;
//      a tool turn is timed to her first words and to the answer; after end_call her last
//      sentence finishes and then the page disconnects
//   D  silence: at 20 s she is told the caller is silent, 10 s later that they still are, and
//      the page ends the call as "silent" if she does not
//   E  the wrap-up note at six minutes and the stop at eight still hold; a blocked visitor is
//      told calls are not available
//
// Not here: strikes and blocks against a real store (this level has no Upstash: the rules are
// unit-tested with a store in memory), the bot check (not set up on the checks' server), and a
// real call on either engine (run by hand: the changelog's T-211 entry).
// The browser is handed a made-up microphone stream: opening one does not complete on this
// machine's automated browsers.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t211.mts
// Needs the web app on 3000 with VOICE_TEST_ENABLED=true, and the worker on 8787. The harness is T-201's.
import { h, finish } from './t201/harness.mts'
import { http } from './lib.mjs'
import { DEFAULT_LIVE_VOICE, LIVE_VOICES, getLivePrice, resolveModelRoute } from '../../packages/shared/src/ai-models'
import { CALL_LIMIT_SECONDS, CONNECTED_NOTE, INPUT_MIME, SESSION_LIFE_SECONDS, SILENT_NOTE, STILL_SILENT_NOTE, THINGS_TO_TRY, WRAP_UP_NOTE, WRAP_UP_SECONDS, callNotice } from '../../apps/web/src/lib/voice/config'
import { VOICE_GUARD } from '../../apps/web/src/lib/voice/guard-config'
import { systemNote } from '../../apps/web/src/lib/voice/instructions'
import { NO_NOTES, signSession, type CallSession } from '../../apps/web/src/lib/voice/session'
import { testSlots } from '../../apps/web/src/lib/voice/slots'

const { app, cfg, check, section, rows, patch } = h
const SESSION = `${app}/api/admin/voice-test/session`
const TOOL = `${app}/api/admin/voice-test/tool`
const GUARD = `${app}/api/admin/voice-test/guard`
const model = resolveModelRoute('voice_call').model
const nowSeconds = () => Math.floor(Date.now() / 1000)

// One business with two services priced from the form alone, and one platform admin
const one = await h.business('voice-two-services')
const serviceA = await h.paintService(one)
const serviceB = await h.paintService(one)
const boss = await h.business('voice-admin')
await patch('user_profiles', `id=eq.${boss.userId}`, { role: 'admin' })
const CONTACT = { name: 'Dana Reyes', email: 'dana.reyes@example.com', phone: '(555) 201-3434' }
const whole = (over: Partial<CallSession> = {}): CallSession => ({ v: 2, callId: 'check', tenantId: one.tenantId, adminId: boss.userId, engine: 'gemini', voice: DEFAULT_LIVE_VOICE, contact: CONTACT, deviceId: 'device-check-0123456789', ipHash: null, notes: NO_NOTES, exp: nowSeconds() + SESSION_LIFE_SECONDS, ...over })
const signed = (over: Partial<CallSession> = {}) => signSession(whole(over), cfg.serviceKey)
const tool = (session: string, name: unknown, args: unknown) => http('POST', TOOL, { headers: boss.cookie, body: { session, name, args } })
const start = (body: Record<string, unknown>) => http('POST', SESSION, { headers: boss.cookie, body: { tenantId: one.tenantId, voice: DEFAULT_LIVE_VOICE, contact: CONTACT, ...body } })

// ---------------------------------------------------------------------------
section('A. Starting a call')
{
  const noName = await start({ contact: { name: '', email: 'dana.reyes@example.com', phone: '' } })
  const noEmail = await start({ contact: { name: 'Dana Reyes', email: '', phone: '(555) 201-3434' } })
  const badEmail = await start({ contact: { name: 'Dana Reyes', email: 'dana at example', phone: '' } })
  check("the caller's details are held to the business's contact rules: no name, no email, or a bad email, and no call starts", [noName, noEmail, badEmail].every((r) => r.status === 400 && r.json?.error?.code === 'INVALID_CONTACT') && !!noName.json?.fields?.name && !!noEmail.json?.fields?.email && !!badEmail.json?.fields?.email, { noName: noName.json, noEmail: noEmail.json })
  // a business that asks for a phone number instead: the email becomes optional and the phone is needed
  await patch('tenants', `id=eq.${one.tenantId}`, { contact_requirement: 'phone' })
  const phoneOnly = await start({ contact: { name: 'Dana Reyes', email: '', phone: '(555) 201-3434' }, voice: 'A voice that is not listed' })
  const noPhone = await start({ contact: { name: 'Dana Reyes', email: 'dana.reyes@example.com', phone: '' } })
  check('the rule is the business\'s own: for one that asks for a phone number, the phone is needed and the email is not', phoneOnly.status === 400 && phoneOnly.json?.error?.code === 'INVALID_REQUEST' && noPhone.status === 400 && noPhone.json?.error?.code === 'INVALID_CONTACT' && !!noPhone.json?.fields?.phone, { phoneOnly: phoneOnly.json, noPhone: noPhone.json })
  await patch('tenants', `id=eq.${one.tenantId}`, { contact_requirement: 'email' })
  const second = await start({ engine: 'openai', sdp: 'v=0' })
  const unknown = await start({ engine: 'some-other-engine' })
  check('the second engine is not offered without its key, and an engine that is not listed is refused', second.status === 400 && unknown.status === 400, { second: second.status, unknown: unknown.status })
  const guard = await http('POST', GUARD, { headers: boss.cookie, body: { deviceId: 'device-check-0123456789', tenantId: one.tenantId } })
  check('with no store set up, nothing is counted and nothing blocks: the protection says so', guard.status === 200 && guard.json?.guard?.unavailable === true && guard.json.guard.blocked === false && guard.json.guard.strikes === 0, guard.json)
  const cleared = await http('POST', GUARD, { headers: boss.cookie, body: { deviceId: 'device-check-0123456789', tenantId: one.tenantId, clear: true } })
  check('"Clear my block" answers without a store too', cleared.status === 200 && cleared.json?.cleared === false && cleared.json?.guard?.unavailable === true, cleared.json)
}

// ---------------------------------------------------------------------------
section('B. Typical price, several services, a corrected detail: the engine\'s figures, and nothing written')
{
  const snapshot = async () => ({
    quotes: (await rows('quotes', `tenant_id=eq.${one.tenantId}&select=id`)).length,
    requests: (await rows('quote_requests', `tenant_id=eq.${one.tenantId}&select=id`)).length,
    leads: (await rows('request_leads', `tenant_id=eq.${one.tenantId}&select=id`)).length,
    usage: JSON.stringify(await rows('usage_counters', `tenant_id=eq.${one.tenantId}&select=*&order=id`)),
    assets: (await rows('assets', `tenant_id=eq.${one.tenantId}&select=id`)).length,
    tenant: JSON.stringify(await rows('tenants', `id=eq.${one.tenantId}&select=*`)),
    services: JSON.stringify(await rows('services', `tenant_id=eq.${one.tenantId}&select=*&order=id`)),
    rules: JSON.stringify(await rows('service_pricing_rules', `tenant_id=eq.${one.tenantId}&select=*&order=id`)),
    forms: JSON.stringify(await rows('widget_configs', `tenant_id=eq.${one.tenantId}&select=*&order=id`)),
    adminLog: (await rows('admin_activity_logs', `admin_user_id=eq.${boss.userId}&select=id`)).length,
  })
  const before = await snapshot()
  let session = signed()

  const typical = await tool(session, 'get_typical_price', { serviceId: serviceA })
  const said = typical.json?.response as { typicalTotal?: number; sayTotal?: string; forAJobOf?: string; dependsOn?: string[] } | undefined
  check('a typical price: the smallest valid answers (1 and 1), priced by the engine: 18.00 and 7.35 is 25.35', typical.json?.ok === true && said?.typicalTotal === 25.35 && said?.sayTotal === 'twenty-five dollars and thirty-five cents' && said?.forAJobOf === 'Wall area (square feet): 1; Trim length (feet): 1' && JSON.stringify(said?.dependsOn) === JSON.stringify(['Wall area (square feet)', 'Trim length (feet)']), typical.json)
  check('the page is given it as a typical price she may say', JSON.stringify(typical.json?.typical) === JSON.stringify({ service: 'Exterior wall painting', currency: 'USD', total: 25.35, lines: [18, 7.35] }), typical.json?.typical)
  session = typical.json?.session ?? session

  // The same service and the same smallest answers through "Test your pricing"
  const service = (await rows('services', `id=eq.${serviceA}&select=*`))[0] as Record<string, unknown>
  const preview = await http('POST', `${app}/api/services/preview-price`, {
    headers: one.cookie,
    body: {
      serviceId: serviceA,
      service: { name: service.name, description: service.description, documentTypeDefault: 'instant_estimate', scopeIncludes: service.scope_includes, scopeExcludes: service.scope_excludes, defaultAssumptions: service.default_assumptions, mediaConfig: service.media_config, workSteps: service.work_steps, expectedSignals: [],
        suggestedFields: [{ fieldId: 'wall_area', label: 'Wall area (square feet)', type: 'number', required: true, criticalForPricing: true }, { fieldId: 'trim_length', label: 'Trim length (feet)', type: 'number', required: true, criticalForPricing: true }],
        pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: service.work_steps } },
      values: { wall_area: 1, trim_length: 1 },
    },
  })
  check('"Test your pricing" gives the same total for those answers: it is the same pricing path', preview.status === 200 && preview.json?.price?.total === said?.typicalTotal, { preview: preview.json?.price?.total, tool: said?.typicalTotal })

  // Several services: one engine price each, and no sum of them anywhere
  const first = await tool(session, 'get_estimate', { serviceId: serviceA, answers: [{ questionId: 'wall_area', value: '400' }, { questionId: 'trim_length', value: '20' }] })
  session = first.json?.session ?? session
  const second = await tool(session, 'get_estimate', { serviceId: serviceB, answers: [{ questionId: 'wall_area', value: '100' }, { questionId: 'trim_length', value: '10' }] })
  session = second.json?.session ?? session
  const a = first.json?.response as { total?: number } | undefined
  const b = second.json?.response as { total?: number; callSoFar?: { estimatesGiven?: Array<{ service: string; sayTotal: string }>; typicalPricesGiven?: unknown[] } } | undefined
  check('two services are two engine prices: 7,347.00 and 1,873.50', a?.total === 7347 && b?.total === 1873.5, { a: a?.total, b: b?.total })
  check('each answer carries what the call has been told so far: both estimates and the typical price', b?.callSoFar?.estimatesGiven?.length === 2 && b.callSoFar.estimatesGiven[0]!.sayTotal === 'seven thousand three hundred and forty-seven dollars' && b.callSoFar.estimatesGiven[1]!.sayTotal === 'one thousand eight hundred and seventy-three dollars and fifty cents' && b.callSoFar.typicalPricesGiven?.length === 1, b?.callSoFar)
  check('no total of the two is made: the sum (9,220.50) is in neither answer', !JSON.stringify([first.json, second.json]).includes('9220') && !/nine thousand two hundred/.test(JSON.stringify([first.json, second.json])))
  const both = await tool(session, 'get_estimate', { serviceIds: [serviceA, serviceB], answers: [] })
  check('get_estimate takes one service a call', both.json?.ok === false && both.json?.code === 'INVALID_ARGUMENT', both.json)

  // A corrected detail is the session's from then on
  const fixed = await tool(session, 'update_contact', { field: 'email', value: 'dana@reyes.example' })
  check('update_contact: the new value is shown to the page and she is told not to say it back', fixed.json?.ok === true && fixed.json?.contact?.email === 'dana@reyes.example' && fixed.json?.wouldDo === 'contact corrected: email is now dana@reyes.example' && (fixed.json?.response as { doNot?: string })?.doNot === 'Do not say the new value back.' && typeof fixed.json?.session === 'string', fixed.json)
  const stale = await tool(session, 'send_estimate', {})
  session = fixed.json?.session ?? session
  const sent = await tool(session, 'send_estimate', {})
  check('send_estimate: "would email" to the corrected address with the newest session, and to the old one with the older session', sent.json?.wouldDo === 'would email the estimate to dana@reyes.example: Exterior wall painting 7347.00; Exterior wall painting 1873.50' && String(stale.json?.wouldDo).startsWith('would email the estimate to dana.reyes@example.com:') && (sent.json?.response as { tellTheCaller?: string })?.tellTheCaller === "I've emailed that to you.", { sent: sent.json?.wouldDo, stale: stale.json?.wouldDo })
  const slot = testSlots({ timeZone: 'America/New_York', locale: 'en-US' }).slots[2]!
  const booked = await tool(session, 'book_time', { slot: slot.id })
  check('book_time uses the details from the form, with the correction', booked.json?.wouldDo === `would book: ${slot.label} (America/New_York) for Dana Reyes, (555) 201-3434, dana@reyes.example`, booked.json?.wouldDo)
  const badFix = await tool(session, 'update_contact', { field: 'email', value: 'not an email' })
  check('a correction that is not an email address is refused', badFix.json?.ok === false && badFix.json?.code === 'INVALID_ARGUMENT', badFix.json)

  // end_call
  const ends = await Promise.all(['finished', 'off_topic', 'abusive', 'silent'].map((reason) => tool(session, 'end_call', { reason })))
  check('end_call takes its four reasons', ends.every((r, i) => r.json?.ok === true && r.json?.end === ['finished', 'off_topic', 'abusive', 'silent'][i]), ends.map((r) => r.json))
  check('an off-topic or abusive ending asks for a strike, a finished or silent one does not; with no store the strike is not kept and nothing fails', ends[1]!.json?.guard?.recorded === false && ends[2]!.json?.guard?.recorded === false && ends[0]!.json?.guard === undefined && ends[3]!.json?.guard === undefined, ends.map((r) => r.json?.guard))
  const badEnd = await tool(session, 'end_call', { reason: 'bored' })
  check('another reason is refused', badEnd.json?.ok === false && badEnd.json?.code === 'INVALID_ARGUMENT', badEnd.json)

  for (let i = 0; i < 3; i++) await tool(session, 'get_typical_price', { serviceId: i % 2 ? serviceA : serviceB })
  const after = await snapshot()
  for (const key of Object.keys(before) as Array<keyof typeof before>) check(`after four typical prices, two services' estimates, a correction, a booking and five endings: ${key} as it was`, before[key] === after[key], { before: String(before[key]).slice(0, 200), after: String(after[key]).slice(0, 200) })
  check('there was nothing to begin with: no quote, no request, no lead, no usage count', before.quotes === 0 && before.requests === 0 && before.leads === 0 && before.usage === '[]', before)
}

// ---------------------------------------------------------------------------
const { browserDeps } = await import('./browser.mjs')
const browser = await browserDeps().chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const origin = new URL(app).origin
const pageErrors: string[] = []
const words = (s: string) => s.replace(/\s+/g, ' ').trim()
const pcm = (ms: number) => Buffer.from(Int16Array.from({ length: (24_000 * ms) / 1000 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 24_000))).buffer).toString('base64')
type Json = Record<string, unknown>
type Live = { send: (m: Json) => void; got: Json[]; wait: (test: (m: Json) => boolean, ms?: number) => Promise<Json | null>; closed: () => boolean; closedAt: () => number }
const guardOpen = { blocked: false, blockedUntil: null, strikes: 0, deviceCallsToday: null, businessCallsToday: null, unavailable: true }

/** A page signed in as the admin, with a made-up microphone (a tone the script switches on and off) and a stand-in for the Live API */
async function openPage(script: (live: Live) => void, options: { clock?: boolean; limits?: Json; refuse?: Json } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addCookies(boss.cookie.Cookie.split('; ').map((pair: string) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
  await ctx.addInitScript(`navigator.mediaDevices.getUserMedia = async function () {
    const audio = new AudioContext()
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    gain.gain.value = 0
    tone.frequency.value = 440
    const out = audio.createMediaStreamDestination()
    tone.connect(gain).connect(out)
    tone.start()
    window.__voice = (on) => { gain.gain.value = on ? 0.4 : 0 }
    return out.stream
  }`)
  const p = await ctx.newPage()
  if (options.clock) await p.clock.install()
  p.on('pageerror', (e) => pageErrors.push(e.message))
  const asked: Json[] = []
  // Starting a call: the answer the real route gives, without asking Google for a token. The session is really signed.
  await p.route('**/api/admin/voice-test/session', async (route) => {
    const body = route.request().postDataJSON() as { tenantId: string; voice: string; contact: typeof CONTACT; basedIn: string; generalAdvice: boolean; deviceId: string; engine: string }
    asked.push(body as unknown as Json)
    if (options.refuse) return route.fulfill({ status: 403, json: options.refuse })
    await route.fulfill({
      json: {
        engine: 'gemini', token: 'auth_tokens/stand-in', session: signed({ contact: { name: body.contact.name, email: body.contact.email || null, phone: body.contact.phone || null } }), model, voice: body.voice, contact: body.contact,
        notice: callNotice(one.name), prices: getLivePrice(model), tuning: { endOfSpeechMs: 500, memory: { triggerTokens: 5000, slidingWindow: { targetTokens: 3500 } } },
        limits: { callSeconds: CALL_LIMIT_SECONDS, wrapUpSeconds: WRAP_UP_SECONDS, silenceAskSeconds: VOICE_GUARD.silenceAskSeconds, silenceEndSeconds: VOICE_GUARD.silenceEndSeconds, lastWordsSeconds: VOICE_GUARD.lastWordsSeconds, ...options.limits },
        guard: guardOpen, humanCheck: 'not_set_up', area: 'not_set', business: { id: body.tenantId, name: one.name, currency: 'USD', locale: 'en-US', timeZone: 'America/New_York', services: [] }, instruction: 'Her instructions for this call.',
      },
    })
  })
  const got: Json[] = []
  let socketUrl = ''
  let isClosed = false
  let closedAt = 0
  await p.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    socketUrl = ws.url()
    ws.onClose(() => { isClosed = true; closedAt = Date.now() })
    ws.onMessage((message) => { got.push(JSON.parse(String(message)) as Json) })
    script({
      send: (m) => ws.send(JSON.stringify(m)),
      got,
      closed: () => isClosed,
      closedAt: () => closedAt,
      wait: async (test, ms = 10_000) => {
        const until = Date.now() + ms
        let seen = 0
        while (Date.now() < until) {
          for (; seen < got.length; seen++) if (test(got[seen]!)) return got[seen]!
          await new Promise((r) => setTimeout(r, 25))
        }
        return null
      },
    })
  })
  await p.goto(`${app}/admin/voice-test`, { waitUntil: 'networkidle' })
  await p.selectOption('[data-testid=vt-business]', one.tenantId)
  return { ctx, p, got, asked, socketUrl: () => socketUrl, closed: () => isClosed }
}
const fill = async (p: Awaited<ReturnType<typeof openPage>>['p']) => {
  await p.fill('[data-testid=vt-name]', CONTACT.name)
  await p.fill('[data-testid=vt-email]', CONTACT.email)
  await p.fill('[data-testid=vt-phone]', CONTACT.phone)
}
const usage = { usageMetadata: { promptTokenCount: 2000, responseTokenCount: 300, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1500 }, { modality: 'AUDIO', tokenCount: 500 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 300 }], thoughtsTokenCount: 40 } }
const says = (text: string, ms = 200): Json => ({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm(ms), mimeType: 'audio/pcm;rate=24000' } }] }, outputTranscription: { text } } })
const done: Json = { serverContent: { turnComplete: true } }
const textOf = (m: Json) => (m.realtimeInput as Json | undefined)?.text
const responseTo = (id: string) => (m: Json) => ((m.toolResponse as { functionResponses?: Array<{ id: string }> } | undefined)?.functionResponses ?? [])[0]?.id === id

try {
  // -------------------------------------------------------------------------
  section('C. The page, with a stand-in for the Live API on its socket')
  let live!: Live
  const { ctx, p, got, asked, closed } = await openPage((l) => { live = l })

  check('the ten things to try are on the page', JSON.stringify(await p.locator('[data-testid=vt-try-list] li').allTextContents()) === JSON.stringify(THINGS_TO_TRY) && THINGS_TO_TRY.length === 10)
  check('the voice picker lists the registry\'s voices with its default chosen, and there is no engine picker without the second engine\'s key', (await p.locator('[data-testid=vt-voice] option').allTextContents()).join() === LIVE_VOICES.join() && (await p.locator('[data-testid=vt-voice]').inputValue()) === DEFAULT_LIVE_VOICE && (await p.locator('[data-testid=vt-engine]').count()) === 0)
  check('under the button: whose assistant she is, and that calls are transcribed', words(await p.locator('[data-testid=vt-notice]').innerText()) === `Oumn is ${one.name}'s AI assistant. Calls are transcribed so ${one.name} can follow up.`, await p.locator('[data-testid=vt-notice]').innerText())
  check('"Based in" is empty and "General advice" is on, to begin with', (await p.locator('[data-testid=vt-based]').inputValue()) === '' && (await p.locator('[data-testid=vt-advice]').isChecked()))
  check('the strikes panel says that nothing is being counted here', /Nothing is being counted/.test(await p.locator('[data-testid=vt-guard]').innerText()) && (await p.locator('[data-testid=vt-clear]').count()) === 1, await p.locator('[data-testid=vt-guard]').innerText())

  // the details form: a call does not start without them
  await p.click('[data-testid=vt-start]')
  await p.waitForTimeout(400)
  check('without a name and an email the call does not start, and the form says what is missing', (await p.locator('[data-testid=vt-name-error]').innerText()) === 'Please enter your name.' && (await p.locator('[data-testid=vt-email-error]').innerText()) === 'Please enter a valid email address.' && (await p.locator('[data-testid=vt-phone-error]').count()) === 0 && asked.length === 0 && !live, { asked: asked.length })
  await fill(p)
  await p.fill('[data-testid=vt-based]', 'Springfield')
  await p.click('[data-testid=vt-start]')
  for (let i = 0; i < 200 && !live; i++) await p.waitForTimeout(50)
  const begun = asked[0] as { contact?: typeof CONTACT; basedIn?: string; generalAdvice?: boolean; deviceId?: string; engine?: string; turnstileToken?: unknown } | undefined
  check('starting sends the details, "Based in", the advice switch, the engine and a device id', JSON.stringify(begun?.contact) === JSON.stringify({ name: CONTACT.name, email: CONTACT.email, phone: CONTACT.phone }) && begun?.basedIn === 'Springfield' && begun?.generalAdvice === true && begun?.engine === 'gemini' && /^[A-Za-z0-9-]{16,64}$/.test(String(begun?.deviceId)), begun)
  const device = await p.evaluate(() => ({ stored: localStorage.getItem('qolumns.voice.device'), cookie: document.cookie }))
  check('the device id is kept in localStorage and in a cookie, the same one', device.stored === begun?.deviceId && device.cookie.includes(`qv_device=${begun?.deviceId}`), device)

  await live.wait((m) => 'setup' in m)
  live.send({ setupComplete: {} })
  const hello = await live.wait((m) => typeof textOf(m) === 'string')
  check('once connected she is told so, as a system note, so that she opens the call', textOf(hello ?? {}) === systemNote(CONNECTED_NOTE) && systemNote(CONNECTED_NOTE) === '[System note: the call has connected.]', hello)
  live.send(says(`Hi Dana, I'm Oumn, ${one.name}'s AI assistant. How can I help?`))
  live.send({ ...done, ...usage })
  const firstAudio = await live.wait((m) => !!(m.realtimeInput as Json | undefined)?.audio)
  const piece = (firstAudio?.realtimeInput as { audio?: { data: string; mimeType: string } } | undefined)?.audio
  check('the microphone goes up as 16 kHz 16-bit PCM, in pieces of 40 ms', piece?.mimeType === INPUT_MIME && Buffer.from(piece?.data ?? '', 'base64').length === 1280, { mime: piece?.mimeType })

  /** The caller speaks for a moment and stops; answers when they stopped */
  const callerSays = async (text: string) => {
    await p.evaluate('window.__voice(true)')
    await p.waitForTimeout(700)
    await p.evaluate('window.__voice(false)')
    const stopped = Date.now()
    live.send({ serverContent: { inputTranscription: { text } } })
    return stopped
  }

  // what a service costs, before any details: a line first, then the tool, then the answer
  let stopped = await callerSays('How much is exterior wall painting?')
  await p.waitForTimeout(500)
  const firstWords = Date.now()
  live.send(says('One moment, let me check.'))
  live.send({ toolCall: { functionCalls: [{ id: 'call-1', name: 'get_typical_price', args: { serviceId: serviceA } }] } })
  const typicalAnswer = await live.wait(responseTo('call-1'))
  const typicalGot = ((typicalAnswer?.toolResponse as { functionResponses?: Array<{ response: { typicalTotal?: number; sayTotal?: string } }> } | undefined)?.functionResponses ?? [])[0]?.response
  check("her tool call went to the real route and its answer came back to her: the engine's 25.35, in words", typicalGot?.typicalTotal === 25.35 && typicalGot?.sayTotal === 'twenty-five dollars and thirty-five cents', typicalAnswer)
  await p.waitForTimeout(300)
  const answerAt = Date.now()
  live.send(says('It depends on the wall area and the trim, but we normally charge about twenty-five dollars and thirty-five cents for one square foot of wall and one foot of trim.', 300))
  live.send({ ...done, ...usage })
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=vt-said] li').length === 1 && /to the answer/.test(document.querySelector('[data-testid=vt-delay]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => undefined)
  const delayText = words(await p.locator('[data-testid=vt-delay]').innerText())
  const timed = /Turn 2 at \d:\d\d: (\d+) ms \(get_typical_price: (\d+) ms to the answer \)/.exec(delayText) ?? /Turn 2 at \d:\d\d: (\d+) ms \(get_typical_price: (\d+) ms to the answer\)/.exec(delayText)
  check(`a tool turn is timed twice: to her first words (about ${firstWords - stopped} ms here) and to the answer itself (about ${answerAt - stopped} ms)`, !!timed && Math.abs(Number(timed[1]) - (firstWords - stopped)) <= 350 && Math.abs(Number(timed[2]) - (answerAt - stopped)) <= 450 && Number(timed[2]) > Number(timed[1]), { delayText, firstWords: firstWords - stopped, answer: answerAt - stopped })
  const saidOne = p.locator('[data-testid=vt-said] li').first()
  check('the typical price she said is valid', (await saidOne.getAttribute('data-verdict')) === 'valid' && /= 25\.35: valid \(a typical price\)/.test(words(await saidOne.innerText())) && /Typical price, Exterior wall painting: 25\.35 USD said/.test(words(await p.locator('[data-testid=vt-given]').innerText())), await saidOne.innerText())

  // the estimate, then an amount the engine never gave
  stopped = await callerSays('It is 400 square feet of wall and 20 feet of trim.')
  live.send(says('Let me work that out.'))
  live.send({ toolCall: { functionCalls: [{ id: 'call-2', name: 'get_estimate', args: { serviceId: serviceA, answers: [{ questionId: 'wall_area', value: '400' }, { questionId: 'trim_length', value: '20' }] } }] } })
  await live.wait(responseTo('call-2'))
  live.send(says("That's an estimate of seven thousand three hundred and forty-seven dollars, which we'll confirm."))
  live.send({ ...done, ...usage })
  live.send(says('Or about nine thousand dollars with a second coat.'))
  live.send(done)
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=vt-said] li').length === 3, null, { timeout: 10_000 }).catch(() => undefined)
  const verdicts = await p.locator('[data-testid=vt-said] li').evaluateAll((items) => items.map((li) => [li.getAttribute('data-verdict'), getComputedStyle(li).color]))
  const danger = await p.evaluate(() => { const probe = document.createElement('span'); probe.className = 'text-danger'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })
  check('the estimate she said is valid; an amount the engine did not give (9,000) is a mismatch, in red', JSON.stringify(verdicts.map((v) => v[0])) === JSON.stringify(['valid', 'valid', 'mismatch']) && verdicts[2]![1] === danger && verdicts[1]![1] !== danger && /= 9000\.00: Mismatch: not a figure the engine gave/.test(words(await p.locator('[data-testid=vt-said] li').nth(2).innerText())), { verdicts, danger })

  // not on her list: recorded with what the caller had asked, and no tool call for it
  const toolsBefore = await p.locator('[data-testid=vt-tools] li').count()
  await callerSays('Do you paint doors as well?')
  live.send(says("That's not on my list, so I'll get the team to confirm."))
  live.send(done)
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=vt-team] li').length === 1, null, { timeout: 10_000 }).catch(() => undefined)
  check('"not on my list" is recorded with what the caller had asked, with no tool call', /“Do you paint doors as well\?”/.test(words(await p.locator('[data-testid=vt-recorded]').innerText())) && (await p.locator('[data-testid=vt-tools] li').count()) === toolsBefore, await p.locator('[data-testid=vt-recorded]').innerText())

  // a corrected email: the page shows the new value
  await callerSays('My email is wrong, it should be dana at reyes dot example.')
  live.send({ toolCall: { functionCalls: [{ id: 'call-3', name: 'update_contact', args: { field: 'email', value: 'dana@reyes.example' } }] } })
  await live.wait(responseTo('call-3'))
  live.send(says("Thanks, I've updated that."))
  live.send(done)
  await p.waitForFunction(() => /dana@reyes\.example/.test(document.querySelector('[data-testid=vt-contact]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => undefined)
  const recorded = words(await p.locator('[data-testid=vt-recorded]').innerText())
  check('a corrected detail shows: the new value on file, and that it was corrected', recorded.includes('Contact details corrected: email is now dana@reyes.example') && recorded.includes('Details on file: Dana Reyes, dana@reyes.example, (555) 201-3434'), recorded)
  // the tools that follow use the newest session: the visit is booked for the corrected address
  const slot = testSlots({ timeZone: 'America/New_York', locale: 'en-US' }).slots[0]!
  live.send({ toolCall: { functionCalls: [{ id: 'call-4', name: 'book_time', args: { slot: slot.id } }, { id: 'call-5', name: 'send_estimate', args: {} }] } })
  await live.wait(responseTo('call-5'))
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=vt-tools] li').length === 5, null, { timeout: 10_000 }).catch(() => undefined)
  const toolsText = words(await p.locator('[data-testid=vt-tools]').innerText())
  check('the tools that follow use the corrected detail: the visit and the estimate are for the new address', toolsText.includes(`would book: ${slot.label} (America/New_York) for Dana Reyes, (555) 201-3434, dana@reyes.example`) && toolsText.includes('would email the estimate to dana@reyes.example: Exterior wall painting 7347.00'), toolsText.slice(0, 500))
  live.send(done)

  await p.click('[data-testid=vt-copy]')
  const copied = await p.evaluate(() => navigator.clipboard.readText())
  check('"Copy results" has the engine, the checks and what she recorded', ['OUMN TEST CALL', `Engine: Gemini Live   Model: ${model}   Voice: ${DEFAULT_LIVE_VOICE}`, 'Strikes: not counted (the store was not there)', 'valid (a typical price)', 'valid (an engine total)', 'MISMATCH (not a figure the engine gave)', 'the caller asked: "Do you paint doors as well?"', 'Contact details corrected:', 'email is now dana@reyes.example', 'would email the estimate to dana@reyes.example'].every((part) => copied.includes(part)), copied.slice(0, 400))

  // she ends the call: her last sentence is heard out, then the page disconnects
  await callerSays('That is everything, thank you. Goodbye.')
  live.send(says('Thanks for calling, Dana. Goodbye!', 1600))
  live.send({ toolCall: { functionCalls: [{ id: 'call-6', name: 'end_call', args: { reason: 'finished' } }] } })
  const ended = await live.wait(responseTo('call-6'))
  const answeredAt = Date.now()
  check('end_call is answered by the real route', !!ended, got.slice(-2))
  await p.waitForFunction(() => /Ended/.test(document.querySelector('[data-testid=vt-status]')?.textContent ?? ''), null, { timeout: 12_000 }).catch(() => undefined)
  for (let i = 0; i < 60 && !closed(); i++) await p.waitForTimeout(50)
  check('her last sentence is let finish, and then the page disconnects', closed() && live.closedAt() - answeredAt >= 700 && live.closedAt() - answeredAt <= 6000, { waited: live.closedAt() - answeredAt })
  check('the page says she ended the call, and why', /^Ended at \d:\d\d: she ended the call \(finished\)$/.test(words(await p.locator('[data-testid=vt-status]').innerText())) && /her reason: finished/.test(words(await p.locator('[data-testid=vt-summary]').innerText())), await p.locator('[data-testid=vt-status]').innerText())
  check('nothing the page was sent or sent held a key', !JSON.stringify(got).includes(cfg.serviceKey) && !JSON.stringify(got).includes(cfg.geminiKey ?? 'no-key-set'))
  await ctx.close()

  // -------------------------------------------------------------------------
  section('D. Silence')
  let quiet!: Live
  const s = await openPage((l) => { quiet = l }, { clock: true })
  await fill(s.p)
  await s.p.click('[data-testid=vt-start]')
  for (let i = 0; i < 200 && !quiet; i++) await s.p.waitForTimeout(50)
  await quiet.wait((m) => 'setup' in m)
  quiet.send({ setupComplete: {} })
  await quiet.wait((m) => textOf(m) === systemNote(CONNECTED_NOTE))
  const notes = () => s.got.map(textOf).filter((x): x is string => typeof x === 'string')
  await s.p.clock.fastForward((VOICE_GUARD.silenceAskSeconds - 3) * 1000)
  await s.p.waitForTimeout(300)
  check('before 20 seconds of silence she has been told nothing more', notes().length === 1 && !s.closed(), notes())
  await s.p.clock.fastForward(4000)
  await quiet.wait((m) => textOf(m) === systemNote(SILENT_NOTE), 5000)
  check('at 20 seconds with no sound from the caller she is told so, once', JSON.stringify(notes()) === JSON.stringify([systemNote(CONNECTED_NOTE), systemNote(SILENT_NOTE)]), notes())
  await s.p.clock.fastForward((VOICE_GUARD.silenceEndSeconds - 3) * 1000)
  await s.p.waitForTimeout(300)
  check('for the next 10 seconds nothing more', notes().length === 2 && !s.closed(), notes())
  await s.p.clock.fastForward(4000)
  await quiet.wait((m) => textOf(m) === systemNote(STILL_SILENT_NOTE), 5000)
  check('10 seconds on, still silent: she is told that too, and the call is still open for her goodbye', notes().at(-1) === systemNote(STILL_SILENT_NOTE) && notes().length === 3 && !s.closed(), notes())
  await s.p.clock.fastForward((VOICE_GUARD.lastWordsSeconds + 3) * 1000)
  await s.p.waitForFunction(() => /Ended/.test(document.querySelector('[data-testid=vt-status]')?.textContent ?? ''), null, { timeout: 5_000 }).catch(() => undefined)
  for (let i = 0; i < 40 && !s.closed(); i++) await s.p.waitForTimeout(50)
  check('if she does not end it herself, the page does, as "silent"', s.closed() && /she ended the call \(silent\)/.test(words(await s.p.locator('[data-testid=vt-status]').innerText())) && /her reason: silent/.test(words(await s.p.locator('[data-testid=vt-summary]').innerText())), await s.p.locator('[data-testid=vt-status]').innerText())
  await s.ctx.close()

  // -------------------------------------------------------------------------
  section('E. The six-minute note and the eight-minute stop; a blocked visitor')
  let clocked!: Live
  // (the silence prompts are put out of the way: this caller is not silent, the page's clock is being moved)
  const t = await openPage((l) => { clocked = l }, { clock: true, limits: { silenceAskSeconds: 100_000 } })
  await fill(t.p)
  await t.p.click('[data-testid=vt-start]')
  for (let i = 0; i < 200 && !clocked; i++) await t.p.waitForTimeout(50)
  await clocked.wait((m) => 'setup' in m)
  clocked.send({ setupComplete: {} })
  await clocked.wait((m) => textOf(m) === systemNote(CONNECTED_NOTE))
  const told = () => t.got.map(textOf).filter((x): x is string => typeof x === 'string')
  await t.p.clock.fastForward((WRAP_UP_SECONDS - 5) * 1000)
  await t.p.waitForTimeout(300)
  check('before six minutes she has been told nothing about time, and the call is live', told().length === 1 && !t.closed() && /Live/.test(await t.p.locator('[data-testid=vt-status]').innerText()), told())
  await t.p.clock.fastForward(10_000)
  await clocked.wait((m) => textOf(m) === systemNote(WRAP_UP_NOTE), 5_000)
  check('at six minutes she is told that time is short, once', JSON.stringify(told()) === JSON.stringify([systemNote(CONNECTED_NOTE), systemNote(WRAP_UP_NOTE)]) && !t.closed(), told())
  await t.p.clock.fastForward((CALL_LIMIT_SECONDS - WRAP_UP_SECONDS) * 1000)
  await t.p.waitForFunction(() => /Ended/.test(document.querySelector('[data-testid=vt-status]')?.textContent ?? ''), null, { timeout: 5_000 }).catch(() => undefined)
  for (let i = 0; i < 40 && !t.closed(); i++) await t.p.waitForTimeout(50)
  check('at eight minutes the call is ended by the page, whatever is being said', t.closed() && /^Ended at 8:0\d: the 8-minute limit$/.test(words(await t.p.locator('[data-testid=vt-status]').innerText())), await t.p.locator('[data-testid=vt-status]').innerText())
  await t.ctx.close()

  const blockedUntil = nowSeconds() + 2 * 24 * 3600
  const b = await openPage(() => undefined, { refuse: { error: { code: 'CALLS_UNAVAILABLE', message: VOICE_GUARD.blockedMessage }, why: 'blocked', guard: { blocked: true, blockedUntil, strikes: 0, deviceCallsToday: 2, businessCallsToday: 5, unavailable: false } } })
  await fill(b.p)
  await b.p.click('[data-testid=vt-start]')
  await b.p.waitForFunction(() => !!document.querySelector('[data-testid=vt-error]'), null, { timeout: 10_000 }).catch(() => undefined)
  check('a blocked visitor is told "Calls aren\'t available right now", the panel shows the block, and no call is opened', (await b.p.locator('[data-testid=vt-error]').innerText()) === "Calls aren't available right now" && /Blocked until/.test(await b.p.locator('[data-testid=vt-guard]').innerText()) && b.socketUrl() === '' && (await b.p.locator('[data-testid=vt-start]').count()) === 1, { error: await b.p.locator('[data-testid=vt-error]').innerText().catch(() => null), guard: await b.p.locator('[data-testid=vt-guard]').innerText() })
  await b.ctx.close()

  check('no page threw an error', pageErrors.length === 0, pageErrors)
} finally {
  await browser.close()
}

process.exit(finish())
