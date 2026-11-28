// T-210 check, against the real servers (local stack). No model is asked, no call is made to the
// Live API, no email is sent, and nothing here touches production.
//
// What it proves (T-211 rewrote her tools and the page; what T-210 promised still holds, and is here)
//   A  the voice test is private: signed out, and as a business's owner, the page and its routes
//      are not there
//   B  her tools, through the real tool route: the business is the call session's (a session that
//      was changed, is another admin's, or has run out is refused; an argument naming a business
//      is refused; another business's service cannot be priced)
//   C  get_estimate is the pricing engine's own answer (the same total as "Test your pricing",
//      POST /api/services/preview-price) and writes nothing: no quote, request, lead or usage
//      count, and the business's own rows are as they were
//   D  the made-up free times, and the tools that only pretend
//
// The page in a browser, the typical price, several services and the call's protection are
// scripts/hardcore-test/verify-t211.mts.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t210.mts
// Needs the web app on 3000 with VOICE_TEST_ENABLED=true, and the worker on 8787. The harness is T-201's.
import { h, finish } from './t201/harness.mts'
import { http } from './lib.mjs'
import { DEFAULT_LIVE_VOICE } from '../../packages/shared/src/ai-models'
import { SESSION_LIFE_SECONDS } from '../../apps/web/src/lib/voice/config'
import { NO_NOTES, signSession, type CallSession } from '../../apps/web/src/lib/voice/session'

const { app, cfg, check, section, rows, patch } = h
const SESSION = `${app}/api/admin/voice-test/session`
const TOOL = `${app}/api/admin/voice-test/tool`
const GUARD = `${app}/api/admin/voice-test/guard`
const nowSeconds = () => Math.floor(Date.now() / 1000)

// Two businesses, each with a service priced from the form alone, and one platform admin
const one = await h.business('voice-one')
const two = await h.business('voice-two')
const serviceOne = await h.paintService(one)
const serviceTwo = await h.paintService(two)
const boss = await h.business('voice-admin')
await patch('user_profiles', `id=eq.${boss.userId}`, { role: 'admin' })
const CONTACT = { name: 'Dana Reyes', email: 'dana.reyes@example.com', phone: '(555) 201-3434' }
const whole = (tenantId: string, over: Partial<CallSession> = {}): CallSession => ({ v: 2, callId: 'check', tenantId, adminId: boss.userId, engine: 'gemini', voice: DEFAULT_LIVE_VOICE, contact: CONTACT, deviceId: 'device-check-0123456789', ipHash: null, notes: NO_NOTES, exp: nowSeconds() + SESSION_LIFE_SECONDS, ...over })
const sessionFor = (tenantId: string, over: Partial<CallSession> = {}) => signSession(whole(tenantId, over), cfg.serviceKey)
const tool = (session: string, name: unknown, args: unknown, who = boss) => http('POST', TOOL, { headers: who.cookie, body: { session, name, args } })
const start = (who: { cookie: Record<string, string> } | null, body: Record<string, unknown>) => http('POST', SESSION, { headers: who?.cookie ?? {}, body: { voice: DEFAULT_LIVE_VOICE, contact: CONTACT, ...body } })

// ---------------------------------------------------------------------------
section('A. The voice test is private')
{
  const page = await fetch(`${app}/admin/voice-test`, { redirect: 'manual' })
  check('signed out: the page sends you to sign in', page.status >= 300 && page.status < 400 && /\/login/.test(page.headers.get('location') ?? ''), { status: page.status, to: page.headers.get('location') })
  check('signed out: the three routes answer 404', (await start(null, { tenantId: one.tenantId })).status === 404 && (await http('POST', TOOL, { body: { session: sessionFor(one.tenantId), name: 'get_free_times', args: {} } })).status === 404 && (await http('POST', GUARD, { body: {} })).status === 404)
  const asOwner = await fetch(`${app}/admin/voice-test`, { redirect: 'manual', headers: one.cookie })
  check("a business's owner: the page sends them back to their dashboard", asOwner.status >= 300 && asOwner.status < 400 && /\/app$/.test(asOwner.headers.get('location') ?? ''), { status: asOwner.status, to: asOwner.headers.get('location') })
  check("a business's owner: the three routes answer 404, even for their own business and with a signed session", (await start(one, { tenantId: one.tenantId })).status === 404 && (await tool(sessionFor(one.tenantId, { adminId: one.userId }), 'get_free_times', {}, one)).status === 404 && (await http('POST', GUARD, { headers: one.cookie, body: {} })).status === 404)
  const adminPage = await fetch(`${app}/admin/voice-test`, { headers: boss.cookie })
  const html = await adminPage.text()
  check('a platform admin gets the page', adminPage.status === 200 && html.includes('data-testid="voice-test"') && /Oumn(<!-- -->)? test call/.test(html), adminPage.status)
  check('the page carries no key and no secret', !html.includes(cfg.geminiKey ?? 'no-key-set') && !html.includes(cfg.serviceKey))
  // before anything is asked of Google: what the start of a call turns away
  const badVoice = await start(boss, { tenantId: one.tenantId, voice: 'A voice that is not listed' })
  const noBusiness = await start(boss, { tenantId: 'tnt_no_such_business_t210' })
  check('starting a call: a voice that is not listed is refused, and a business that does not exist is not found', badVoice.status === 400 && noBusiness.status === 404, { badVoice: badVoice.status, noBusiness: noBusiness.status })
}

// ---------------------------------------------------------------------------
section("B. Her tools: the business is the call session's")
{
  const typical = await tool(sessionFor(one.tenantId), 'get_typical_price', { serviceId: serviceOne })
  check("a tool call is answered for the session's business: its own service is priced", typical.status === 200 && typical.json?.ok === true && (typical.json?.response as { service?: string })?.service === 'Exterior wall painting', typical.json)
  check('nothing the pricing worker needs is given to her: no rules, no rates', !/rules|defaultCost|work_steps|"row"/.test(JSON.stringify(typical.json)))

  const named = await tool(sessionFor(one.tenantId), 'get_free_times', { tenantId: two.tenantId })
  check('an argument naming another business is refused', named.status === 200 && named.json?.ok === false && named.json?.code === 'INVALID_ARGUMENT' && !JSON.stringify(named.json).includes(two.name), named.json)
  const cross = await tool(sessionFor(one.tenantId), 'get_estimate', { serviceId: serviceTwo, answers: [{ questionId: 'wall_area', value: '40' }, { questionId: 'trim_length', value: '20' }] })
  const crossTypical = await tool(sessionFor(one.tenantId), 'get_typical_price', { serviceId: serviceTwo })
  check("another business's service cannot be priced from this call, for an estimate or a typical price", cross.json?.ok === false && cross.json?.code === 'UNKNOWN_SERVICE' && crossTypical.json?.code === 'UNKNOWN_SERVICE', { cross: cross.json, crossTypical: crossTypical.json })
  check('a call for the other business prices the other business, and not this one', (await tool(sessionFor(two.tenantId), 'get_typical_price', { serviceId: serviceTwo })).json?.ok === true && (await tool(sessionFor(two.tenantId), 'get_typical_price', { serviceId: serviceOne })).json?.code === 'UNKNOWN_SERVICE')

  const good = sessionFor(one.tenantId)
  const [payload, signature] = good.split('.') as [string, string]
  const moved = `${Buffer.from(JSON.stringify(whole(two.tenantId))).toString('base64url')}.${signature}`
  const refusals = {
    'a session whose business was changed': await tool(moved, 'get_free_times', {}),
    'a session signed with another secret': await tool(signSession(whole(one.tenantId), 'not-the-server-secret'), 'get_free_times', {}),
    'a session that has run out': await tool(sessionFor(one.tenantId, { exp: nowSeconds() - 1 }), 'get_free_times', {}),
    "another admin's session": await tool(sessionFor(one.tenantId, { adminId: one.userId }), 'get_free_times', {}),
    'a session of the old kind (version 1)': await tool(signSession({ ...whole(one.tenantId), v: 1 as never }, cfg.serviceKey), 'get_free_times', {}),
    'no session': await tool('', 'get_free_times', {}),
    'half a session': await tool(payload, 'get_free_times', {}),
  }
  for (const [what, res] of Object.entries(refusals)) check(`${what} is refused (401), with nothing of a business in the answer`, res.status === 401 && !JSON.stringify(res.json).includes(one.name) && !JSON.stringify(res.json).includes(two.name), { status: res.status, json: res.json })
  const unknown = await tool(good, 'delete_business', {})
  const gone = await tool(good, 'get_business_info', {})
  check('a name that is not one of her tools is refused, and so is the tool that round two removed', unknown.json?.ok === false && unknown.json?.code === 'UNKNOWN_TOOL' && gone.json?.code === 'UNKNOWN_TOOL', { unknown: unknown.json, gone: gone.json })
  const huge = await http('POST', TOOL, { headers: boss.cookie, body: { session: good, name: 'request_person', args: { reason: 'x'.repeat(40_000) } } })
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
  const answer = estimate.json?.response as { total?: number; sayTotal?: string; lines?: Array<{ label: string; amount: number; say: string }>; status?: string } | undefined
  check('an estimate comes back: 400 at 18 and 20 at 7.35 is 7,347.00, in figures and in words', estimate.json?.ok === true && answer?.total === 7347 && answer?.sayTotal === 'seven thousand three hundred and forty-seven dollars' && JSON.stringify(answer?.lines?.map((l) => l.amount)) === JSON.stringify([7200, 147]), estimate.json)
  check('it is called an estimate that will be confirmed', answer?.status === 'An estimate. We will confirm it.')
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
  check('"Test your pricing" gives the same total and the same lines for the same answers', preview.status === 200 && preview.json?.price?.total === answer?.total && JSON.stringify(preview.json?.price?.lines) === JSON.stringify(answer?.lines?.map((l) => ({ label: l.label, amount: l.amount }))), { preview: preview.json?.price?.total, tool: answer?.total })

  // More of the same, and the ones that are turned away
  for (let i = 0; i < 4; i++) await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: String(100 + i) }, { questionId: 'trim_length', value: '0' }] })
  const missing = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: '400' }] })
  check('a required question with no answer: no price, and she is told what to ask', missing.json?.ok === false && missing.json?.code === 'MISSING_ANSWERS' && (missing.json?.response as { error?: string })?.error === 'Ask the caller first: Trim length (feet).', missing.json)
  const words = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [{ questionId: 'wall_area', value: 'quite big' }, { questionId: 'trim_length', value: '20' }] })
  const stray = await tool(session, 'get_estimate', { serviceId: serviceOne, answers: [...ANSWERS, { questionId: 'discount', value: '50' }] })
  check('an answer of the wrong kind, and an answer to a question the service does not ask, are refused', words.json?.code === 'INVALID_ARGUMENT' && stray.json?.code === 'INVALID_ARGUMENT', { words: words.json, stray: stray.json })

  const after = await snapshot()
  for (const key of Object.keys(before) as Array<keyof typeof before>) check(`after seven estimates and three refusals: ${key} as it was`, before[key] === after[key], { before: String(before[key]).slice(0, 200), after: String(after[key]).slice(0, 200) })
  check('there was nothing to begin with: no quote, no request, no lead, no usage count', before.quotes === 0 && before.requests === 0 && before.leads === 0 && before.usage === '[]', before)
}

// ---------------------------------------------------------------------------
section('D. Made-up free times, and the tools that only pretend')
{
  const session = sessionFor(one.tenantId)
  const free = await tool(session, 'get_free_times', {})
  const times = free.json?.response as { freeTimes?: Array<{ id: string; when: string }>; timeZone?: string }
  const weekday = (id: string) => new Date(`${id.slice(0, 10)}T12:00:00Z`).getUTCDay()
  check('she is given the first eight free times: weekdays, two-hour windows', free.json?.ok === true && times?.freeTimes?.length === 8 && times.freeTimes.every((t) => weekday(t.id) >= 1 && weekday(t.id) <= 5) && new Set(times.freeTimes.map((t) => t.id.slice(11))).size === 4, times)
  const tz = (await rows('tenants', `id=eq.${one.tenantId}&select=time_zone,region`))[0] as { time_zone: string | null }
  check("they are in the business's time zone, from tomorrow", times?.timeZone === (tz.time_zone ?? 'America/New_York') && times.freeTimes![0]!.id > new Intl.DateTimeFormat('en-CA', { timeZone: times.timeZone! }).format(new Date()), { zone: times?.timeZone, first: times?.freeTimes?.[0] })
  check('the page is told they are test data', /^TEST DATA: 20 made-up free times/.test(String(free.json?.wouldDo)), free.json?.wouldDo)
  const first = times!.freeTimes![0]!
  const booked = await tool(session, 'book_time', { slot: first.id })
  check("book_time: \"would book\", with the time and the caller's details from the session", booked.json?.ok === true && booked.json?.wouldDo === `would book: ${first.when} (${times!.timeZone}) for Dana Reyes, (555) 201-3434, dana.reyes@example.com`, booked.json)
  const noSlot = await tool(session, 'book_time', { slot: '2020-01-06T08:00' })
  const withName = await tool(session, 'book_time', { slot: first.id, name: 'Someone Else' })
  check('book_time for a time not on offer, or with details of its own, is refused', noSlot.json?.code === 'UNKNOWN_SLOT' && withName.json?.code === 'INVALID_ARGUMENT', { noSlot: noSlot.json?.code, withName: withName.json?.code })
  const person = await tool(session, 'request_person', { reason: 'Water is coming through the ceiling', urgent: true })
  check('request_person: "would pass to a person", marked urgent', person.json?.ok === true && person.json?.wouldDo === 'would pass to a person (URGENT): Water is coming through the ceiling', person.json)
  check('none left a row: no quote, request or lead for the business', (await rows('quotes', `tenant_id=eq.${one.tenantId}&select=id`)).length === 0 && (await rows('quote_requests', `tenant_id=eq.${one.tenantId}&select=id`)).length === 0 && (await rows('request_leads', `tenant_id=eq.${one.tenantId}&select=id`)).length === 0)
}

process.exit(finish())
