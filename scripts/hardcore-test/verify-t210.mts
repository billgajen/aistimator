// T-210 check, against the real servers (local stack). No model is asked, no call is made to the
// Live API, no email is sent, and nothing here touches production.
//
// What it proves
//   A  the voice test is private: signed out, and as a business's owner, the page and both routes
//      are not there
//   B  her tools, through the real tool route: the business is the call session's (a session that
//      was changed, is another admin's, or has run out is refused; an argument naming a business
//      is refused; another business's service cannot be priced)
//   C  get_estimate is the pricing engine's own answer (the same total as "Test your pricing",
//      POST /api/services/preview-price) and writes nothing: no quote, request, lead or usage
//      count, and the business's own rows are as they were
//   D  the made-up free times, and the two tools that only pretend
//   E  the page in a real browser, with a stand-in for the Live API on the other end of its
//      socket: the pickers, the microphone going up as 16 kHz PCM, her audio and words coming
//      down, her tool calls passed to the real route and answered, the delay of a turn, the
//      cost, the price check (a match, then a mismatch in red), "Copy results", End call
//   F  the six-minute wrap-up note and the eight-minute stop
//
// Not here, because this level asks nothing outside this machine: the token Google mints and a
// real call. Those were run by hand (.checks/t210, the changelog's T-210 entry).
// The browser is handed a made-up microphone stream: opening one (a real or Chrome's fake one)
// does not complete on this machine's automated browsers.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t210.mts
// Needs the web app on 3000 with VOICE_TEST_ENABLED=true, and the worker on 8787. The harness is T-201's.
import { h, finish } from './t201/harness.mts'
import { http } from './lib.mjs'
import { DEFAULT_LIVE_VOICE, LIVE_VOICES, getLivePrice, resolveModelRoute } from '../../packages/shared/src/ai-models'
import { CALL_LIMIT_SECONDS, INPUT_MIME, SESSION_LIFE_SECONDS, THINGS_TO_TRY, WRAP_UP_NOTE, WRAP_UP_SECONDS } from '../../apps/web/src/lib/voice/config'
import { buildInstruction } from '../../apps/web/src/lib/voice/instructions'
import { signSession, type CallSession } from '../../apps/web/src/lib/voice/session'
import { testSlots } from '../../apps/web/src/lib/voice/slots'

const { app, cfg, check, section, rows, patch } = h
const SESSION = `${app}/api/admin/voice-test/session`
const TOOL = `${app}/api/admin/voice-test/tool`
const model = resolveModelRoute('voice_call').model
const nowSeconds = () => Math.floor(Date.now() / 1000)

// Two businesses, each with a service priced from the form alone, and one platform admin
const one = await h.business('voice-one')
const two = await h.business('voice-two')
const serviceOne = await h.paintService(one)
const serviceTwo = await h.paintService(two)
const boss = await h.business('voice-admin')
await patch('user_profiles', `id=eq.${boss.userId}`, { role: 'admin' })
const sessionFor = (tenantId: string, over: Partial<CallSession> = {}) => signSession({ v: 1, callId: 'check', tenantId, adminId: boss.userId, voice: DEFAULT_LIVE_VOICE, exp: nowSeconds() + SESSION_LIFE_SECONDS, ...over }, cfg.serviceKey)
const tool = (session: string, name: unknown, args: unknown, who = boss) => http('POST', TOOL, { headers: who.cookie, body: { session, name, args } })

// ---------------------------------------------------------------------------
section('A. The voice test is private')
{
  const page = await fetch(`${app}/admin/voice-test`, { redirect: 'manual' })
  check('signed out: the page sends you to sign in', page.status >= 300 && page.status < 400 && /\/login/.test(page.headers.get('location') ?? ''), { status: page.status, to: page.headers.get('location') })
  check('signed out: both routes answer 404', (await http('POST', SESSION, { body: { tenantId: one.tenantId, voice: DEFAULT_LIVE_VOICE } })).status === 404 && (await http('POST', TOOL, { body: { session: sessionFor(one.tenantId), name: 'get_business_info', args: {} } })).status === 404)
  const asOwner = await fetch(`${app}/admin/voice-test`, { redirect: 'manual', headers: one.cookie })
  check("a business's owner: the page sends them back to their dashboard", asOwner.status >= 300 && asOwner.status < 400 && /\/app$/.test(asOwner.headers.get('location') ?? ''), { status: asOwner.status, to: asOwner.headers.get('location') })
  check("a business's owner: both routes answer 404, even for their own business and with a signed session", (await http('POST', SESSION, { headers: one.cookie, body: { tenantId: one.tenantId, voice: DEFAULT_LIVE_VOICE } })).status === 404 && (await tool(signSession({ v: 1, callId: 'check', tenantId: one.tenantId, adminId: one.userId, voice: DEFAULT_LIVE_VOICE, exp: nowSeconds() + 60 }, cfg.serviceKey), 'get_business_info', {}, one)).status === 404)
  const adminPage = await fetch(`${app}/admin/voice-test`, { headers: boss.cookie })
  const html = await adminPage.text()
  check('a platform admin gets the page', adminPage.status === 200 && html.includes('data-testid="voice-test"') && /Oumn(<!-- -->)? test call/.test(html), adminPage.status)
  check('the page carries no key and no secret', !html.includes(cfg.geminiKey ?? 'no-key-set') && !html.includes(cfg.serviceKey))
  // before any token is asked of Google: what the start of a call turns away
  const badVoice = await http('POST', SESSION, { headers: boss.cookie, body: { tenantId: one.tenantId, voice: 'A voice that is not listed' } })
  const noBusiness = await http('POST', SESSION, { headers: boss.cookie, body: { tenantId: 'tnt_no_such_business_t210', voice: DEFAULT_LIVE_VOICE } })
  check('starting a call: a voice that is not listed is refused, and a business that does not exist is not found', badVoice.status === 400 && noBusiness.status === 404, { badVoice: badVoice.status, noBusiness: noBusiness.status })
}

// ---------------------------------------------------------------------------
section("B. Her tools: the business is the call session's")
{
  const info = await tool(sessionFor(one.tenantId), 'get_business_info', {})
  const said = info.json?.response as { name?: string; services?: Array<{ id: string; name: string; notIncluded: string[]; questions: Array<{ id: string; ask: string; required: boolean }> }>; timeZone?: string; currency?: string } | undefined
  check("get_business_info is the session's business: its name, time zone, currency and its one service", info.status === 200 && info.json?.ok === true && said?.name === one.name && said?.currency === 'USD' && !!said?.timeZone && said?.services?.length === 1 && said.services[0]!.id === serviceOne, info.json)
  check("the service comes with what is not included and the questions its request form asks", JSON.stringify(said?.services?.[0]?.notIncluded) === JSON.stringify(['Roofline replacement']) && JSON.stringify(said?.services?.[0]?.questions.map((q) => [q.id, q.required])) === JSON.stringify([['wall_area', true], ['trim_length', true]]), said?.services?.[0])
  check('nothing the pricing worker needs is given to her: no rules, no rates', !/rules|defaultCost|work_steps|"row"/.test(JSON.stringify(info.json)))

  const named = await tool(sessionFor(one.tenantId), 'get_business_info', { tenantId: two.tenantId })
  check('an argument naming another business is refused', named.status === 200 && named.json?.ok === false && named.json?.code === 'INVALID_ARGUMENT' && !JSON.stringify(named.json).includes(two.name), named.json)
  const cross = await tool(sessionFor(one.tenantId), 'get_estimate', { serviceId: serviceTwo, answers: [{ questionId: 'wall_area', value: '40' }, { questionId: 'trim_length', value: '20' }] })
  check("another business's service cannot be priced from this call", cross.json?.ok === false && cross.json?.code === 'UNKNOWN_SERVICE', cross.json)
  const other = await tool(sessionFor(two.tenantId), 'get_business_info', {})
  check("a call for the other business reads the other business", (other.json?.response as { name?: string })?.name === two.name)

  const good = sessionFor(one.tenantId)
  const [payload, signature] = good.split('.') as [string, string]
  const moved = `${Buffer.from(JSON.stringify({ v: 1, callId: 'check', tenantId: two.tenantId, adminId: boss.userId, voice: DEFAULT_LIVE_VOICE, exp: nowSeconds() + 600 })).toString('base64url')}.${signature}`
  const refusals = {
    'a session whose business was changed': await tool(moved, 'get_business_info', {}),
    'a session signed with another secret': await tool(signSession({ v: 1, callId: 'check', tenantId: one.tenantId, adminId: boss.userId, voice: DEFAULT_LIVE_VOICE, exp: nowSeconds() + 600 }, 'not-the-server-secret'), 'get_business_info', {}),
    'a session that has run out': await tool(sessionFor(one.tenantId, { exp: nowSeconds() - 1 }), 'get_business_info', {}),
    "another admin's session": await tool(sessionFor(one.tenantId, { adminId: one.userId }), 'get_business_info', {}),
    'no session': await tool('', 'get_business_info', {}),
    'half a session': await tool(payload, 'get_business_info', {}),
  }
  for (const [what, res] of Object.entries(refusals)) check(`${what} is refused (401), with nothing of a business in the answer`, res.status === 401 && !JSON.stringify(res.json).includes(one.name) && !JSON.stringify(res.json).includes(two.name), { status: res.status, json: res.json })
  const unknown = await tool(good, 'delete_business', {})
  check('a name that is not one of her tools is refused', unknown.json?.ok === false && unknown.json?.code === 'UNKNOWN_TOOL', unknown.json)
  const huge = await http('POST', TOOL, { headers: boss.cookie, body: { session: good, name: 'request_person', args: { reason: 'x'.repeat(30_000) } } })
  check('an oversized call is refused', huge.status === 400, huge.status)
}

// ---------------------------------------------------------------------------
section('C. get_estimate: the engine\'s own price, and nothing written')
const ANSWERS = [{ questionId: 'wall_area', value: '400' }, { questionId: 'trim_length', value: '20' }]
{
  /** Everything of this business that a real request would touch */
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
  const session = sessionFor(one.tenantId)
  const estimate = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: ANSWERS })
  const answer = estimate.json?.response as { total?: number; totalAsText?: string; currency?: string; lines?: Array<{ label: string; amount: number }>; status?: string } | undefined
  check('an estimate comes back: 400 at 18 and 20 at 7.35 is 7,347.00', estimate.json?.ok === true && answer?.total === 7347 && answer?.totalAsText === '$7,347.00' && answer?.currency === 'USD' && JSON.stringify(answer?.lines?.map((l) => l.amount)) === JSON.stringify([7200, 147]), estimate.json)
  check('it is called an estimate the business will confirm', answer?.status === 'An estimate. The business will confirm it.')
  check("the page is given the engine's figures for its price check", JSON.stringify(estimate.json?.engine) === JSON.stringify({ currency: 'USD', total: 7347, subtotal: 7347, taxAmount: 0, lines: [7200, 147] }), estimate.json?.engine)

  // The same service and the same answers through "Test your pricing"
  const service = (await rows('services', `id=eq.${serviceOne}&select=*`))[0] as Record<string, unknown>
  const preview = await http('POST', `${app}/api/services/preview-price`, {
    headers: one.cookie,
    body: {
      serviceId: serviceOne,
      service: { name: service.name, description: service.description, documentTypeDefault: 'instant_estimate', scopeIncludes: service.scope_includes, scopeExcludes: service.scope_excludes, defaultAssumptions: service.default_assumptions, mediaConfig: service.media_config, workSteps: service.work_steps, expectedSignals: [],
        suggestedFields: [{ fieldId: 'wall_area', label: 'Wall area (square feet)', type: 'number', required: true, criticalForPricing: true }, { fieldId: 'trim_length', label: 'Trim length (feet)', type: 'number', required: true, criticalForPricing: true }],
        pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: service.work_steps } },
      values: { wall_area: 400, trim_length: 20 },
    },
  })
  check('"Test your pricing" gives the same total and the same lines for the same answers', preview.status === 200 && preview.json?.price?.total === answer?.total && JSON.stringify(preview.json?.price?.lines) === JSON.stringify(answer?.lines), { preview: preview.json?.price?.total, tool: answer?.total })

  // More of the same, and the ones that are turned away
  for (let i = 0; i < 4; i++) await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: String(100 + i) }, { questionId: 'trim_length', value: '0' }] })
  const missing = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: '400' }] })
  check('a required question with no answer: no price, and she is told what to ask', missing.json?.ok === false && missing.json?.code === 'MISSING_ANSWERS' && (missing.json?.response as { error?: string })?.error === 'Ask the customer first: Trim length (feet).', missing.json)
  const words = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: 'quite big' }, { questionId: 'trim_length', value: '20' }] })
  const stray = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [...ANSWERS, { questionId: 'discount', value: '50' }] })
  check('an answer of the wrong kind, and an answer to a question the service does not ask, are refused', words.json?.code === 'INVALID_ARGUMENT' && stray.json?.code === 'INVALID_ARGUMENT', { words: words.json, stray: stray.json })

  const after = await snapshot()
  for (const key of Object.keys(before) as Array<keyof typeof before>) check(`after seven estimates and three refusals: ${key} as it was`, before[key] === after[key], { before: String(before[key]).slice(0, 200), after: String(after[key]).slice(0, 200) })
  check('there was nothing to begin with: no quote, no request, no lead, no usage count', before.quotes === 0 && before.requests === 0 && before.leads === 0 && before.usage === '[]', before)
}

// ---------------------------------------------------------------------------
section('D. Made-up free times, and the two tools that only pretend')
const slots = testSlots({ timeZone: 'America/New_York', locale: 'en-US' })
{
  const session = sessionFor(one.tenantId)
  const free = await tool(session, 'get_free_times', {})
  const times = (free.json?.response as { freeTimes?: Array<{ id: string; when: string }>; timeZone?: string })
  const weekday = (id: string) => new Date(`${id.slice(0, 10)}T12:00:00Z`).getUTCDay()
  check('twenty free times: five weekdays, four two-hour windows each', free.json?.ok === true && times?.freeTimes?.length === 20 && times.freeTimes.every((t) => weekday(t.id) >= 1 && weekday(t.id) <= 5) && new Set(times.freeTimes.map((t) => t.id.slice(11))).size === 4, times)
  const tz = (await rows('tenants', `id=eq.${one.tenantId}&select=time_zone,region`))[0] as { time_zone: string | null }
  check("they are in the business's time zone, from tomorrow", times?.timeZone === (tz.time_zone ?? 'America/New_York') && times.freeTimes![0]!.id > new Intl.DateTimeFormat('en-CA', { timeZone: times.timeZone! }).format(new Date()), { zone: times?.timeZone, first: times?.freeTimes?.[0] })
  check('the page is told they are test data', /^TEST DATA: 20 made-up free times/.test(String(free.json?.wouldDo)), free.json?.wouldDo)
  const first = times!.freeTimes![0]!
  const booked = await tool(session, 'book_time', { slot: first.id, name: 'Dana Reyes', phone: '(555) 201-3434' })
  check('book_time: "would book", with the time and the customer', booked.json?.ok === true && booked.json?.wouldDo === `would book: ${first.when} (${times!.timeZone}) for Dana Reyes, (555) 201-3434`, booked.json)
  const noContact = await tool(session, 'book_time', { slot: first.id, name: 'Dana Reyes' })
  const noSlot = await tool(session, 'book_time', { slot: '2020-01-06T08:00', name: 'Dana Reyes', phone: '(555) 201-3434' })
  check('book_time without a phone or email, or for a time not on offer, is refused', noContact.json?.code === 'MISSING_CONTACT' && noSlot.json?.code === 'UNKNOWN_SLOT', { noContact: noContact.json?.code, noSlot: noSlot.json?.code })
  const person = await tool(session, 'request_person', { reason: 'Water is coming through the ceiling', urgent: true })
  check('request_person: "would pass to a person", marked urgent', person.json?.ok === true && person.json?.wouldDo === 'would pass to a person (URGENT): Water is coming through the ceiling', person.json)
  check('neither left a row: no quote, request or lead for the business', (await rows('quotes', `tenant_id=eq.${one.tenantId}&select=id`)).length === 0 && (await rows('quote_requests', `tenant_id=eq.${one.tenantId}&select=id`)).length === 0 && (await rows('request_leads', `tenant_id=eq.${one.tenantId}&select=id`)).length === 0)
}

// ---------------------------------------------------------------------------
const { browserDeps } = await import('./browser.mjs')
const browser = await browserDeps().chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const origin = new URL(app).origin
const pageErrors: string[] = []
const words = (s: string) => s.replace(/\s+/g, ' ').trim()
const pcm = (ms: number) => Buffer.from(Int16Array.from({ length: (24_000 * ms) / 1000 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 24_000))).buffer).toString('base64')
type Json = Record<string, unknown>

/** A page signed in as the admin, with a made-up microphone (a tone the script switches on and off) and a stand-in for the Live API */
async function openPage(script: (live: { send: (m: Json) => void; got: Json[]; wait: (test: (m: Json) => boolean, ms?: number) => Promise<Json | null>; closed: () => boolean }) => void, clock = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
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
  if (clock) await p.clock.install()
  p.on('pageerror', (e) => pageErrors.push(e.message))
  // Starting a call: the answer the real route gives, without asking Google for a token. The session is really signed.
  await p.route('**/api/admin/voice-test/session', async (route) => {
    const asked = route.request().postDataJSON() as { tenantId: string; voice: string }
    await route.fulfill({ json: { token: 'auth_tokens/stand-in', session: sessionFor(asked.tenantId), model, voice: asked.voice, prices: getLivePrice(model), limits: { callSeconds: CALL_LIMIT_SECONDS, wrapUpSeconds: WRAP_UP_SECONDS }, business: { id: asked.tenantId, name: one.name, currency: 'USD', locale: 'en-US', timeZone: 'America/New_York', services: [] }, instruction: buildInstruction({ businessName: one.name, languageVariant: 'US English', emergencyNumber: '911', currency: 'USD' }) } })
  })
  const got: Json[] = []
  let socketUrl = ''
  let isClosed = false
  await p.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    socketUrl = ws.url()
    ws.onClose(() => { isClosed = true })
    ws.onMessage((message) => { got.push(JSON.parse(String(message)) as Json) })
    script({
      send: (m) => ws.send(JSON.stringify(m)),
      got,
      closed: () => isClosed,
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
  return { ctx, p, got, socketUrl: () => socketUrl, closed: () => isClosed }
}
const usage = { usageMetadata: { promptTokenCount: 2000, responseTokenCount: 300, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 1500 }, { modality: 'AUDIO', tokenCount: 500 }], responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 300 }], thoughtsTokenCount: 40 } }
const says = (text: string, ms = 200): Json => ({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm(ms), mimeType: 'audio/pcm;rate=24000' } }] }, outputTranscription: { text } } })

try {
  // -------------------------------------------------------------------------
  section('E. The page, with a stand-in for the Live API on its socket')
  let live!: Parameters<Parameters<typeof openPage>[0]>[0]
  const { ctx, p, got, socketUrl, closed } = await openPage((l) => { live = l })

  check('the business picker lists the businesses, and the voice picker the registry\'s voices with its default chosen', (await p.locator('[data-testid=vt-business] option').count()) >= 3 && (await p.locator('[data-testid=vt-voice] option').allTextContents()).join() === LIVE_VOICES.join() && (await p.locator('[data-testid=vt-voice]').inputValue()) === DEFAULT_LIVE_VOICE)
  check('the eight things to try are on the page', JSON.stringify(await p.locator('[data-testid=vt-try-list] li').allTextContents()) === JSON.stringify(THINGS_TO_TRY))
  await p.selectOption('[data-testid=vt-business]', one.tenantId)
  await p.click('[data-testid=vt-start]')
  const setup = await (async () => { for (let i = 0; i < 200 && !live; i++) await p.waitForTimeout(50); return live ? live.wait((m) => 'setup' in m) : null })()
  check('the call opens the constrained Live API service with the token, and nothing else in the address', socketUrl() === `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent('auth_tokens/stand-in')}`, socketUrl())
  check('its first message names the model only: the instructions, voice and tools are the token\'s, not the page\'s', JSON.stringify(setup) === JSON.stringify({ setup: { model: `models/${model}` } }), setup)
  live.send({ setupComplete: {} })
  const hello = await live.wait((m) => typeof (m.realtimeInput as Json | undefined)?.text === 'string')
  check('once connected she is told the call has connected, so that she opens it', (hello?.realtimeInput as Json | undefined)?.text === 'The call has connected.', hello)
  await p.waitForFunction(() => /Live/.test(document.querySelector('[data-testid=vt-status]')?.textContent ?? ''), null, { timeout: 10_000 }).catch(() => undefined)
  check('the page says the call is live, out of 8:00', /^Live 0:0\d of 8:00$/.test(words(await p.locator('[data-testid=vt-status]').innerText())), await p.locator('[data-testid=vt-status]').innerText())

  // her opening
  live.send(says(`Hello, I'm Oumn, the AI assistant for ${one.name}. How can I help?`))
  live.send({ serverContent: { turnComplete: true }, ...usage })
  // the microphone
  const firstAudio = await live.wait((m) => !!(m.realtimeInput as Json | undefined)?.audio)
  const piece = (firstAudio?.realtimeInput as { audio?: { data: string; mimeType: string } } | undefined)?.audio
  check('the microphone goes up as 16 kHz 16-bit PCM, in pieces of 40 ms', piece?.mimeType === INPUT_MIME && INPUT_MIME === 'audio/pcm;rate=16000' && Buffer.from(piece?.data ?? '', 'base64').length === 1280, { mime: piece?.mimeType, bytes: Buffer.from(piece?.data ?? '', 'base64').length })

  // the caller speaks for a second, stops, and 700 ms later her tool call arrives
  await p.evaluate('window.__voice(true)')
  await p.waitForTimeout(1000)
  const loud = [...got].reverse().find((m) => !!(m.realtimeInput as Json | undefined)?.audio)
  const samples = new Int16Array(Uint8Array.from(Buffer.from((loud!.realtimeInput as { audio: { data: string } }).audio.data, 'base64')).buffer)
  check('what goes up is the sound at the microphone', Math.max(...samples) > 8000, Math.max(...samples))
  await p.evaluate('window.__voice(false)')
  const stopped = Date.now()
  live.send({ serverContent: { inputTranscription: { text: 'How much to paint 400 square feet of wall with 20 feet of trim?' } } })
  await p.waitForTimeout(700)
  live.send({ toolCall: { functionCalls: [{ id: 'call-1', name: 'get_estimate', args: { serviceId: serviceOne, answers: ANSWERS } }] } })
  const answered = await live.wait((m) => !!(m.toolResponse as Json | undefined))
  const response = ((answered?.toolResponse as { functionResponses?: Array<{ id: string; name: string; response: { total?: number; totalAsText?: string } }> } | undefined)?.functionResponses ?? [])[0]
  check("her tool call went to the real route and its answer came back to her: the engine's 7,347.00", response?.id === 'call-1' && response?.name === 'get_estimate' && response?.response?.total === 7347 && response?.response?.totalAsText === '$7,347.00', answered)
  const spokeAt = Date.now()
  live.send(says(`That comes to an estimate of $7,347.00, which ${one.name} will confirm.`, 400))
  live.send({ serverContent: { turnComplete: true }, ...usage })
  // the estimate is listed as soon as the tool answers; what she said about it arrives a moment later
  await p.waitForFunction(() => document.querySelector('[data-testid=vt-prices] li')?.getAttribute('data-verdict') === 'match' && /Turn 2/.test(document.querySelector('[data-testid=vt-delay]')?.textContent ?? '') && document.querySelectorAll('[data-testid=vt-transcript-list] p').length === 3, null, { timeout: 10_000 }).catch(() => undefined)
  const firstCheck = p.locator('[data-testid=vt-prices] li').first()
  check('the price check shows the engine\'s total beside what she said, and says Match', (await firstCheck.getAttribute('data-verdict')) === 'match' && /the engine’s total is 7347\.00 USD/.test(words(await firstCheck.innerText())) && /“\$7,347\.00” = 7347\.00 \(total\)/.test(words(await firstCheck.innerText())) && /Match$/.test(words(await firstCheck.innerText())), await firstCheck.innerText())
  const delayText = words(await p.locator('[data-testid=vt-delay]').innerText())
  const measured = Number(/Turn 2 at \d:\d\d: (\d+) ms \(after get_estimate\)/.exec(delayText)?.[1])
  check(`the delay of that turn is from the caller's last sound to her first audio (about ${spokeAt - stopped} ms here), with the tool she waited for`, Number.isFinite(measured) && Math.abs(measured - (spokeAt - stopped)) <= 350, { measured, expected: spokeAt - stopped, delayText })
  check('her opening is a turn with no caller speech before it, and the median and worst are shown', /Turn 1 at 0:0\d: no caller speech before it/.test(delayText) && new RegExp(`Median ${measured} ms, worst ${measured} ms, over 1 turns`).test(delayText), delayText)
  check('both sides are in the transcript', JSON.stringify((await p.locator('[data-testid=vt-transcript-list] p').allTextContents()).map((t) => words(t).replace(/^\d:\d\d ?/, ''))) === JSON.stringify([`Oumn: Hello, I'm Oumn, the AI assistant for ${one.name}. How can I help?`, 'Caller: How much to paint 400 square feet of wall with 20 feet of trim?', `Oumn: That comes to an estimate of $7,347.00, which ${one.name} will confirm.`]), await p.locator('[data-testid=vt-transcript-list] p').allTextContents())

  // the cost, from two usage reports at the registry's prices
  const price = getLivePrice(model)!
  const expected = (2 * (1500 * price.textInPerMTok + 500 * price.audioInPerMTok + 300 * price.audioOutPerMTok + 40 * price.textOutPerMTok)) / 1_000_000
  await p.waitForFunction(() => /Audio in 1,000 tokens/.test((document.querySelector('[data-testid=vt-cost]')?.textContent ?? '').replace(/\s+/g, ' ')), null, { timeout: 5_000 }).catch(() => undefined)
  const costText = words(await p.locator('[data-testid=vt-cost]').innerText())
  check(`the cost is the usage at the registry's prices ($${expected.toFixed(4)} for two reports), with a per-minute figure and the tokens of each kind`, costText.includes(`This call $${expected.toFixed(4)}, per minute $`) && /Audio in 1,000 tokens/.test(costText) && /Audio out 600 tokens/.test(costText) && /Text in 3,000 tokens/.test(costText) && /Thinking 80 tokens/.test(costText) && costText.includes(`checked ${price.asOf}`), costText)

  // a second estimate, and this time she rounds it
  live.send({ toolCall: { functionCalls: [{ id: 'call-2', name: 'get_estimate', args: { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: '401' }, { questionId: 'trim_length', value: '20' }] } }] } })
  await live.wait((m) => ((m.toolResponse as { functionResponses?: Array<{ id: string }> } | undefined)?.functionResponses ?? [])[0]?.id === 'call-2')
  live.send(says('That would be about seven thousand four hundred dollars.'))
  live.send({ serverContent: { turnComplete: true } })
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=vt-prices] li')[1]?.getAttribute('data-verdict') === 'mismatch', null, { timeout: 10_000 }).catch(() => undefined)
  const second = p.locator('[data-testid=vt-prices] li').nth(1)
  const red = await second.evaluate((el) => getComputedStyle(el).color)
  const danger = await p.evaluate(() => { const probe = document.createElement('span'); probe.className = 'text-danger'; document.body.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c })
  check('an amount she said that the engine did not give (7,365.00 said as "about 7,400") is a mismatch, in red', (await second.getAttribute('data-verdict')) === 'mismatch' && /the engine’s total is 7365\.00 USD/.test(words(await second.innerText())) && /= 7400\.00 \(not the engine's\)/.test(words(await second.innerText())) && /Mismatch$/.test(words(await second.innerText())) && red === danger && (await firstCheck.getAttribute('data-verdict')) === 'match', { text: await second.innerText(), red, danger })

  // the tools that pretend, a refused call, and an interruption
  live.send({ toolCall: { functionCalls: [{ id: 'call-3', name: 'book_time', args: { slot: slots.slots[0]!.id, name: 'Dana Reyes', email: 'dana@example.com' } }, { id: 'call-4', name: 'request_person', args: { reason: 'Wants a person' } }, { id: 'call-5', name: 'get_business_info', args: { tenantId: two.tenantId } }] } })
  await live.wait((m) => ((m.toolResponse as { functionResponses?: Array<{ id: string }> } | undefined)?.functionResponses ?? [])[0]?.id === 'call-5')
  live.send({ serverContent: { interrupted: true } })
  await p.waitForFunction(() => document.querySelectorAll('[data-testid=vt-tools] li').length === 5, null, { timeout: 10_000 }).catch(() => undefined)
  const toolsText = words(await p.locator('[data-testid=vt-tools]').innerText())
  check('every tool call is listed with its arguments and result; the two that pretend say what they would have done; a refused one says so', toolsText.includes(`would book: ${slots.slots[0]!.label} (America/New_York) for Dana Reyes, dana@example.com`) && toolsText.includes('would pass to a person: Wants a person') && /get_business_info refused in \d+ ms/.test(toolsText) && toolsText.includes(`arguments: {"serviceId":"${serviceOne}"`) && toolsText.includes('"total":7347') && !toolsText.includes(two.name), toolsText.slice(0, 600))

  await p.click('[data-testid=vt-copy]')
  const copied = await p.evaluate(() => navigator.clipboard.readText())
  check('"Copy results" puts the whole panel on the clipboard as plain text', ['OUMN TEST CALL', `Business: ${one.name}`, `Model: ${model}   Voice: ${DEFAULT_LIVE_VOICE}`, '1. COST', '2. DELAY BEFORE SHE ANSWERS', '4. PRICE CHECK', '| MATCH', '| MISMATCH', '5. TOOL CALLS', 'would book:', 'TRANSCRIPT', 'Caller: How much to paint'].every((part) => copied.includes(part)) && (await p.locator('[data-testid=vt-copy]').innerText()) === 'Copied', copied.slice(0, 300))

  await p.click('[data-testid=vt-end]')
  await p.waitForFunction(() => /Ended/.test(document.querySelector('[data-testid=vt-status]')?.textContent ?? ''), null, { timeout: 5_000 }).catch(() => undefined)
  for (let i = 0; i < 40 && !closed(); i++) await p.waitForTimeout(50)
  check('End call closes the socket and says so; the results stay on the page', closed() && /^Ended at \d:\d\d: ended on the page$/.test(words(await p.locator('[data-testid=vt-status]').innerText())) && (await p.locator('[data-testid=vt-prices] li').count()) === 2 && (await p.locator('[data-testid=vt-start]').count()) === 1, await p.locator('[data-testid=vt-status]').innerText())
  check('the page kept nothing in the browser', await p.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0))
  check('nothing the page was sent or sent held a key', !JSON.stringify(got).includes(cfg.serviceKey) && !JSON.stringify(got).includes(cfg.geminiKey ?? 'no-key-set'))
  await ctx.close()

  // -------------------------------------------------------------------------
  section('F. The wrap-up note at six minutes and the stop at eight')
  let timed!: Parameters<Parameters<typeof openPage>[0]>[0]
  const t = await openPage((l) => { timed = l }, true)
  await t.p.selectOption('[data-testid=vt-business]', one.tenantId)
  await t.p.click('[data-testid=vt-start]')
  for (let i = 0; i < 200 && !timed; i++) await t.p.waitForTimeout(50)
  await timed.wait((m) => 'setup' in m)
  timed.send({ setupComplete: {} })
  await timed.wait((m) => (m.realtimeInput as Json | undefined)?.text === 'The call has connected.')
  const texts = () => t.got.map((m) => (m.realtimeInput as Json | undefined)?.text).filter((x): x is string => typeof x === 'string')
  await t.p.clock.fastForward((WRAP_UP_SECONDS - 5) * 1000)
  await t.p.waitForTimeout(300)
  check('before six minutes she has been told nothing about time, and the call is live', texts().length === 1 && !t.closed() && /Live/.test(await t.p.locator('[data-testid=vt-status]').innerText()), { texts: texts(), status: await t.p.locator('[data-testid=vt-status]').innerText() })
  await t.p.clock.fastForward(10_000)
  await timed.wait((m) => (m.realtimeInput as Json | undefined)?.text === WRAP_UP_NOTE, 5_000)
  check('at six minutes she is told that time is short, once', JSON.stringify(texts()) === JSON.stringify(['The call has connected.', WRAP_UP_NOTE]) && !t.closed(), texts())
  await t.p.clock.fastForward((CALL_LIMIT_SECONDS - WRAP_UP_SECONDS) * 1000)
  await t.p.waitForFunction(() => /Ended/.test(document.querySelector('[data-testid=vt-status]')?.textContent ?? ''), null, { timeout: 5_000 }).catch(() => undefined)
  for (let i = 0; i < 40 && !t.closed(); i++) await t.p.waitForTimeout(50)
  check('at eight minutes the call is ended by the page, whatever is being said', t.closed() && /^Ended at 8:0\d: the 8-minute limit$/.test(words(await t.p.locator('[data-testid=vt-status]').innerText())), await t.p.locator('[data-testid=vt-status]').innerText())
  await t.ctx.close()

  check('no page threw an error', pageErrors.length === 0, pageErrors)
} finally {
  await browser.close()
}

process.exit(finish())
