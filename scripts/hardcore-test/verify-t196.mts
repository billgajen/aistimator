// T-196 check: "Won through Qolumns", the phone's notifications, and the small fixes, against the
// real server (local stack).
//
// Nothing is sent to a real phone or to Expo: the web app and the worker are pointed at a stand-in
// for Expo's push service that this script starts (port 8792), and what they post to it is read.
//
// What it proves:
//   A. migration 46: a user reads and changes only their own phones; another business, another
//      user of the same business, and a signed-out caller get nothing; the event record is closed
//   B. the token routes: register, refresh, the three switches (saved per user), a phone that
//      changes hands, sign-out
//   C. the three notifications: a customer's new request (from the worker), an acceptance and a
//      question (from the web app); never for a quote the business made itself; one per event;
//      no customer details; a switch turned off; a dead token removed; a push service that is
//      down stops nothing
//   D. the panel on Home and the app's line: hidden before the first accepted estimate, then the
//      customer part and the on-site line, setup tests left out, the stat cards gone; a business
//      that only quotes on site; the time zone kept once
//   E. the hint saved once; the "Who it's for" cards
//
// Needs the web app's development server and the worker, both started with
//   EXPO_PUSH_BASE_URL=http://127.0.0.1:8792/push
// (the runner does this: `pnpm check:full --only t196`). Neither honours that address in production.
// Run by hand:  npx tsx scripts/hardcore-test/verify-t196.mts
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { createApi } from '../../apps/mobile/src/lib/api'
import { PUSH_COPY } from '../../packages/shared/src/push'
import { WON_COPY } from '../../packages/shared/src/won'

type Row = Record<string, unknown>
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t196-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rest = (pathAndQuery: string) => `${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`
const asUser = (accessToken: string) => ({ apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` })

// =====================================================================================
// A stand-in for Expo's push service
// =====================================================================================
const PUSH_PORT = 8792
interface Sent { to: string; body: string; data: { quoteId?: string; event?: string }; channelId?: string }
const sent: Sent[] = []
const receiptAsks: string[][] = []
let pushDown = false
/** Tokens the stand-in answers "this phone is gone" for */
const gone = new Set<string>()
const standIn = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    if (pushDown) {
      res.writeHead(503).end('down')
      return
    }
    const body = JSON.parse(raw || 'null') as unknown
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.endsWith('/getReceipts')) {
      receiptAsks.push((body as { ids: string[] }).ids)
      res.end(JSON.stringify({ data: {} }))
      return
    }
    const messages = body as Sent[]
    sent.push(...messages)
    res.end(JSON.stringify({ data: messages.map((m) => (gone.has(m.to) ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `ticket-${shortId()}` })) }))
  })
})
await new Promise<void>((resolve) => standIn.listen(PUSH_PORT, '127.0.0.1', resolve))

function finish(): never {
  standIn.close()
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}
/** Wait until `count` notifications of an event for a quote have reached the stand-in (or the time runs out) */
async function pushesFor(quoteId: string, event: string, count: number, timeoutMs = 20_000): Promise<Sent[]> {
  const of = () => sent.filter((m) => m.data?.quoteId === quoteId && m.data?.event === event)
  const until = Date.now() + timeoutMs
  while (Date.now() < until && of().length < count) await sleep(300)
  return of()
}

// =====================================================================================
// Two businesses; the first has a second user
// =====================================================================================
interface Person { userId: string; cookie: { Cookie: string }; accessToken: string }
interface Business extends Person { name: string; tenantId: string; tenantKey: string; serviceId: string }
async function person(email: string, name: string): Promise<Person> {
  const password = `Hardcore-${shortId()}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  return { userId: user.id as string, cookie: { Cookie: sessionCookieHeader(cfg, session) }, accessToken: session.access_token as string }
}
const SERVICE = { name: 'Service One', price: 480 }
async function business(label: string): Promise<Business> {
  const id = shortId()
  const name = `${label} ${id}`
  const owner = await person(`owner+t196-${id}@hardcore.test`, name)
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: owner.cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${owner.userId}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: owner.cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const steps = [{ id: 'one_visit', name: 'Visit', description: 'One visit', costType: 'fixed', defaultCost: SERVICE.price, optional: false }]
  const created = expectOk('service', await call('POST', `${app}/api/services`, {
    headers: owner.cookie,
    body: {
      name: SERVICE.name, description: 'Service One for the T-196 check', documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['One visit'], scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
      workSteps: steps, expectedSignals: [],
      // E: a question with a hint, saved the way setup saves one
      suggestedFields: [{ fieldId: 'how_many', label: 'How many?', type: 'number', required: false, helpText: 'From 1 to 5.' }],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: steps },
    },
  }))
  return { ...owner, name, tenantId, tenantKey: site.tenant_key as string, serviceId: created.service.id as string }
}

const a = await business('Push Works')
const rival = await business('Rival Works')
// a second user of the first business (the profile is the membership)
const second = await person(`second+t196-${shortId()}@hardcore.test`, 'Second user')
await call('DELETE', rest(`user_profiles?id=eq.${second.userId}`), { headers: admin })
await sb.insert('user_profiles', { id: second.userId, tenant_id: a.tenantId, role: 'admin', display_name: 'Second user' })

const token = (label: string) => `ExponentPushToken[t196${label}${shortId()}]`
const pushToken = (who: Person, method: string, body?: Row) => call(method, `${app}/api/app/push-token`, { headers: { Authorization: `Bearer ${who.accessToken}` }, ...(body && { body }) })
const devicesOf = async (query: string) => (await sb.select('push_devices', `${query}&select=token,tenant_id,user_id,platform,notify_new_request,notify_accepted,notify_question,last_ticket_id`)) as Row[]

// =====================================================================================
section('A + B. The phones: the routes, and who can read what')
// =====================================================================================
check('signed out, every token route refuses (401)', (await Promise.all(['GET', 'PUT', 'PATCH', 'DELETE'].map((m) => call(m, `${app}/api/app/push-token`, m === 'GET' ? {} : { body: { token: token('x'), platform: 'ios' } })))).every((r) => r.status === 401))
const start = expectOk('prefs', await pushToken(a, 'GET'))
check('before a phone is registered: the three switches are on, and nothing is registered', JSON.stringify(start) === JSON.stringify({ prefs: { newRequest: true, accepted: true, question: true }, registered: false }), start)
check('a switch cannot be saved before a phone is registered (409), and nothing is written', (await pushToken(a, 'PATCH', { question: false })).status === 409 && (await devicesOf(`user_id=eq.${a.userId}`)).length === 0)
check('what is not a push token, or not a phone, is refused (400)', (await pushToken(a, 'PUT', { token: 'https://example.test/hook', platform: 'ios' })).status === 400 && (await pushToken(a, 'PUT', { token: token('x'), platform: 'web' })).status === 400)

const phoneA = token('a')
// the request names another business and another user: neither is used
const registered = await pushToken(a, 'PUT', { token: phoneA, platform: 'ios', tenantId: rival.tenantId, tenant_id: rival.tenantId, userId: rival.userId, user_id: rival.userId })
const rowA = (await devicesOf(`token=eq.${encodeURIComponent(phoneA)}`))[0]
check('registering writes the signed-in user and their business, whatever the request says', registered.ok && rowA?.tenant_id === a.tenantId && rowA?.user_id === a.userId && rowA?.platform === 'ios', rowA)
await pushToken(a, 'PUT', { token: phoneA, platform: 'ios' })
check('registering the same phone again (every launch) keeps one row', (await devicesOf(`token=eq.${encodeURIComponent(phoneA)}`)).length === 1)

const phoneSecond = token('s')
const phoneRival = token('r')
expectOk('second registers', await pushToken(second, 'PUT', { token: phoneSecond, platform: 'android' }))
expectOk('rival registers', await pushToken(rival, 'PUT', { token: phoneRival, platform: 'ios' }))

// row-level rules, asked as each user through the database's own API (not through our routes)
const seenBy = async (who: Person | null) => ((await call('GET', rest('push_devices?select=token'), { headers: who ? asUser(who.accessToken) : { apikey: cfg.anonKey } })).json ?? []) as Row[]
const seenByA = (await seenBy(a)).map((r) => r.token)
check('a user sees only their own phone', JSON.stringify(seenByA) === JSON.stringify([phoneA]), seenByA)
check('another user of the same business does not see it; nor does another business', !(await seenBy(second)).some((r) => r.token === phoneA) && !(await seenBy(rival)).some((r) => r.token === phoneA || r.token === phoneSecond))
const anon = await call('GET', rest('push_devices?select=token'), { headers: { apikey: cfg.anonKey } })
check('signed out, the table gives nothing', !anon.ok || (anon.json as Row[]).length === 0, anon.status)
await call('PATCH', rest(`push_devices?token=eq.${encodeURIComponent(phoneA)}`), { headers: { ...asUser(rival.accessToken), Prefer: 'return=minimal' }, body: { notify_accepted: false, user_id: rival.userId } })
await call('DELETE', rest(`push_devices?token=eq.${encodeURIComponent(phoneA)}`), { headers: asUser(rival.accessToken) })
await call('DELETE', rest(`push_devices?token=eq.${encodeURIComponent(phoneA)}`), { headers: asUser(second.accessToken) })
const untouched = (await devicesOf(`token=eq.${encodeURIComponent(phoneA)}`))[0]
check('another business, and another user of the same business, cannot change or delete it', untouched?.user_id === a.userId && untouched?.notify_accepted === true, untouched)
const planted = await call('POST', rest('push_devices'), { headers: { ...asUser(rival.accessToken), Prefer: 'return=minimal' }, body: { token: token('planted'), tenant_id: a.tenantId, user_id: rival.userId, platform: 'ios' } })
const plantedAsOther = await call('POST', rest('push_devices'), { headers: { ...asUser(rival.accessToken), Prefer: 'return=minimal' }, body: { token: token('planted'), tenant_id: a.tenantId, user_id: a.userId, platform: 'ios' } })
check('a user cannot add a phone to another business, or in another user’s name', !planted.ok && !plantedAsOther.ok && (await devicesOf(`tenant_id=eq.${a.tenantId}`)).length === 2, [planted.status, plantedAsOther.status])
const eventsAsUser = await call('GET', rest('push_events?select=quote_id'), { headers: asUser(a.accessToken) })
check('the record of events already sent is closed to every user', !eventsAsUser.ok || (eventsAsUser.json as Row[]).length === 0, eventsAsUser.status)

// the switches are saved per user
const phoneA2 = token('a2')
const off = expectOk('switch', await pushToken(a, 'PATCH', { question: false }))
check('a switch turned off answers the new state', off.prefs.question === false && off.prefs.newRequest === true && off.prefs.accepted === true, off)
const laterPhone = expectOk('second phone', await pushToken(a, 'PUT', { token: phoneA2, platform: 'ios' }))
const bothA = await devicesOf(`user_id=eq.${a.userId}`)
check('a second phone of the same user starts with that user’s switches', laterPhone.prefs.question === false && bothA.length === 2 && bothA.every((r) => r.notify_question === false && r.notify_new_request === true), bothA.map((r) => r.notify_question))
check('one user’s switch does not move another’s', (await devicesOf(`user_id=eq.${second.userId}`))[0]?.notify_question === true && (await devicesOf(`user_id=eq.${rival.userId}`))[0]?.notify_question === true)
check('a switch that is not true or false is refused (400)', (await pushToken(a, 'PATCH', { question: 'no' })).status === 400 && (await pushToken(a, 'PATCH', {})).status === 400)
expectOk('switch back on', await pushToken(a, 'PATCH', { question: true }))

// a phone that changes hands, and sign-out
expectOk('rival signs in on the phone', await pushToken(rival, 'PUT', { token: phoneA2, platform: 'ios' }))
const moved = (await devicesOf(`token=eq.${encodeURIComponent(phoneA2)}`))[0]
check('a phone that another user signs in on moves to that user and business (it is never told about the old one)', moved?.user_id === rival.userId && moved?.tenant_id === rival.tenantId, moved)
await pushToken(a, 'DELETE', { token: phoneA2 })
check('signing out forgets only your own phone: another user’s token is left alone', (await devicesOf(`token=eq.${encodeURIComponent(phoneA2)}`)).length === 1)
await pushToken(rival, 'DELETE', { token: phoneA2 })
check('signing out deletes the phone', (await devicesOf(`token=eq.${encodeURIComponent(phoneA2)}`)).length === 0)

// the app's own client speaks the same routes
const appClient = createApi({ baseUrl: app, getAccessToken: async () => a.accessToken })
check('the app’s client reads the switches with its bearer', (await appClient.pushPrefs()).registered === true)

// =====================================================================================
section('C. The three notifications')
// =====================================================================================
const submit = (b: Business, customer: Row) =>
  call('POST', `${app}/api/public/quotes`, { body: { tenantKey: b.tenantKey, serviceId: b.serviceId, customer, job: { postcodeOrZip: '63021', answers: [] }, source: { type: 'widget' } }, timeoutMs: 150_000 })
const quoteRow = async (quoteId: string) => ((await sb.select('quotes', `id=eq.${quoteId}&select=*`)) as Row[])[0]!
async function settle(quoteId: string, timeoutMs = 420_000): Promise<Row> {
  const until = Date.now() + timeoutMs
  let row = await quoteRow(quoteId)
  while (Date.now() < until && ['queued', 'generating'].includes(String(row?.status))) {
    await sleep(3000)
    row = await quoteRow(quoteId)
  }
  return row
}
const tokenOf = (url: unknown) => new URL(String(url)).searchParams.get('token')!
const PRIVATE = { email: `megan.grant.${shortId()}@hardcore.test`, phone: '+1 555 0142', address: '12 Alder Close', message: 'Can you come before 8am? The gate code is 4417.' }

const made = expectOk('submit', await submit(a, { name: 'Megan Grant', email: PRIVATE.email, phone: PRIVATE.phone }))
const quoteId = made.quoteId as string
const quoteToken = tokenOf(made.quoteViewUrl)
const priced = await settle(quoteId)
check('the request is priced by the rules', ['sent', 'pending_review'].includes(String(priced.status)) && Number((priced.pricing_json as { total?: number }).total) === SERVICE.price, { status: priced.status, total: (priced.pricing_json as { total?: number }).total })
const newRequest = await pushesFor(quoteId, 'new_request', 2)
check(
  'a customer’s new request reaches both users’ phones, in the ticket’s words, from the worker',
  newRequest.length === 2 && newRequest.every((m) => m.body === `New request from Megan Grant: ${SERVICE.name}`) && JSON.stringify(newRequest.map((m) => m.to).sort()) === JSON.stringify([phoneA, phoneSecond].sort()),
  newRequest.map((m) => m.body)
)
check('it is posted to the Android channel the app makes, and carries only the quote and the event', newRequest.every((m) => m.channelId === 'quotes' && JSON.stringify(Object.keys(m.data).sort()) === JSON.stringify(['event', 'quoteId'])))
check('another business’s phone hears nothing', !sent.some((m) => m.to === phoneRival))
check('the event is recorded once', ((await sb.select('push_events', `quote_id=eq.${quoteId}&select=event_key`)) as Row[]).map((r) => r.event_key).join() === 'new_request')
check('the ticket is kept, to ask later whether the phone is still there', typeof (await devicesOf(`token=eq.${encodeURIComponent(phoneA)}`))[0]?.last_ticket_id === 'string')

// a quote the business makes itself, in its own app
const onSite = await appClient.createQuote({ serviceId: a.serviceId, customer: { name: 'Dana Whitfield' } })
const onSiteRow = await settle(onSite.quoteId)
await sleep(2500)
check('a quote the business made in its own app is priced and notifies no one', Number((onSiteRow.pricing_json as { total?: number }).total) === SERVICE.price && !sent.some((m) => m.data?.quoteId === onSite.quoteId), { status: onSiteRow.status })

// approve when it waits for approval, so the customer can accept
if (priced.status === 'pending_review') expectOk('approve', await call('POST', `${app}/api/quotes/${quoteId}/approve`, { headers: a.cookie }))
await sleep(1500)
check('approving and sending the request again notifies no one a second time', (await pushesFor(quoteId, 'new_request', 3, 2000)).length === 2)

// a question from the "Ask a question" box
const asked = await call('POST', `${app}/api/public/quotes/${quoteId}/feedback`, { body: { token: quoteToken, feedbackType: 'feedback', feedbackText: PRIVATE.message } })
const questions = await pushesFor(quoteId, 'question', 2)
check('a customer’s question reaches the phones in the ticket’s words', asked.ok && questions.length === 2 && questions.every((m) => m.body === 'Megan Grant asked a question about their estimate'), questions.map((m) => m.body))
// the business answered; a customer can ask again once the quote is back with them
await call('PATCH', rest(`quotes?id=eq.${quoteId}`), { headers: { ...admin, Prefer: 'return=minimal' }, body: { status: 'sent' } })
expectOk('second question', await call('POST', `${app}/api/public/quotes/${quoteId}/feedback`, { body: { token: quoteToken, feedbackType: 'feedback', feedbackText: 'And is the price for both sides?' } }))
check('a second question is a second notification', (await pushesFor(quoteId, 'question', 4)).length === 4)

// the switches
expectOk('switch off', await pushToken(a, 'PATCH', { accepted: false }))
const accept = await call('POST', `${app}/api/public/quotes/${quoteId}/accept`, { body: { token: quoteToken } })
const acceptedPushes = await pushesFor(quoteId, 'accepted', 1)
await sleep(1500)
check(
  'an acceptance reaches the phone whose switch is on, with the total, and not the one that turned it off',
  accept.ok && (await pushesFor(quoteId, 'accepted', 2, 500)).length === 1 && acceptedPushes[0]?.to === phoneSecond && acceptedPushes[0]?.body === 'Megan Grant accepted your estimate: $480.00',
  { status: accept.status, bodies: acceptedPushes.map((m) => m.body), error: accept.ok ? undefined : accept.json }
)
const again = await call('POST', `${app}/api/public/quotes/${quoteId}/accept`, { body: { token: quoteToken } })
await sleep(1500)
check('accepting twice is refused and notifies no one again', again.status === 409 && (await pushesFor(quoteId, 'accepted', 2, 500)).length === 1)
const everything = JSON.stringify(sent)
check('no notification carries the customer’s message, address, phone or email', Object.values(PRIVATE).every((secret) => !everything.includes(secret)) && !/@|555|Alder|gate code/.test(everything))
check('only the three notifications were ever sent', sent.every((m) => ['new_request', 'accepted', 'question'].includes(String(m.data?.event))) && sent.length === 2 + 4 + 1, sent.length)
expectOk('switch on', await pushToken(a, 'PATCH', { accepted: true }))

// the on-site quote: accepted by its customer, which is an event like any other
if (onSiteRow.status === 'pending_review') expectOk('approve on-site', await call('POST', `${app}/api/quotes/${onSite.quoteId}/approve`, { headers: a.cookie }))
const onSiteLink = expectOk('link', await call('POST', `${app}/api/quotes/${onSite.quoteId}/link`, { headers: a.cookie, body: { force: true } }))
const onSiteAccept = await call('POST', `${app}/api/public/quotes/${onSite.quoteId}/accept`, { body: { token: tokenOf(onSiteLink.quoteViewUrl) } })
const onSiteAccepted = await pushesFor(onSite.quoteId, 'accepted', 2)
check('a customer accepting a quote made on site does notify (both phones)', onSiteAccept.ok && onSiteAccepted.length === 2 && onSiteAccepted.every((m) => m.body === 'Dana Whitfield accepted your estimate: $480.00'), { status: onSiteAccept.status, n: onSiteAccepted.length })
check('before sending again, the server asks what became of each phone’s last notification', receiptAsks.length > 0 && receiptAsks.every((ids) => ids.every((id) => id.startsWith('ticket-'))))

// a dead token, and a push service that is down
gone.add(phoneSecond)
const third = expectOk('submit 2', await submit(a, { name: 'Jordan Reyes', email: `jordan.reyes.${shortId()}@hardcore.test` }))
await settle(third.quoteId as string)
await pushesFor(third.quoteId as string, 'new_request', 2)
await sleep(2000)
check('a token the push service says is dead is removed; the other phone keeps its own', (await devicesOf(`token=eq.${encodeURIComponent(phoneSecond)}`)).length === 0 && (await devicesOf(`token=eq.${encodeURIComponent(phoneA)}`)).length === 1)
pushDown = true
const fourth = expectOk('submit 3', await submit(a, { name: 'Sam Carter', email: `sam.carter.${shortId()}@hardcore.test` }))
const fourthRow = await settle(fourth.quoteId as string)
if (fourthRow.status === 'pending_review') expectOk('approve 3', await call('POST', `${app}/api/quotes/${fourth.quoteId}/approve`, { headers: a.cookie }))
const acceptWhileDown = await call('POST', `${app}/api/public/quotes/${fourth.quoteId}/accept`, { body: { token: tokenOf(fourth.quoteViewUrl) } })
check('with the push service down, the request is still priced and the customer can still accept', Number((fourthRow.pricing_json as { total?: number }).total) === SERVICE.price && acceptWhileDown.ok && (await quoteRow(fourth.quoteId as string)).status === 'accepted', { status: fourthRow.status, accept: acceptWhileDown.status })
pushDown = false

// =====================================================================================
section('D. Won through Qolumns')
// =====================================================================================
const page = async (who: Person) => (await call('GET', `${app}/app`, { headers: who.cookie })).text as string
const textOf = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`)
  if (at < 0) return null
  const from = html.indexOf('>', at) + 1
  // the element's own text: tags and React's comment markers taken out, up to its closing tag
  const depthEnd = html.indexOf('</p>', from)
  return html.slice(from, depthEnd).replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}
const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex')
/** A copy of a real quote under a new customer, with a status and dates set by hand; `source` makes its own request row */
async function copyOf(sourceId: string, customerName: string, overrides: Row = {}, source?: string) {
  const { id: _id, ...quote } = await quoteRow(sourceId)
  let requestId = quote.quote_request_id as string
  if (source) {
    const { id: _requestId, ...request } = ((await sb.select('quote_requests', `id=eq.${requestId}&select=*`)) as Row[])[0]!
    requestId = (await sb.insert('quote_requests', { ...request, customer_name: customerName, source_json: { type: source } })).id as string
  }
  const created = await sb.insert('quotes', {
    ...quote,
    quote_request_id: requestId,
    customer_json: { ...(quote.customer_json as Row), name: customerName },
    quote_token_hash: sha(crypto.randomBytes(24).toString('hex')),
    previous_token_hash: null,
    link_token_hashes: [],
    ...overrides,
  })
  return created.id as string
}
const now = new Date()
const iso = (date: Date) => date.toISOString()
const minutesAgo = (n: number) => iso(new Date(now.getTime() - n * 60_000))

// a third business: requests, a sent estimate, nothing accepted yet
const fresh = await business('Fresh Works')
const freshMade = expectOk('fresh submit', await submit(fresh, { name: 'Megan Grant', email: `megan.grant.${shortId()}@hardcore.test` }))
const freshRow = await settle(freshMade.quoteId as string)
const freshClient = createApi({ baseUrl: app, getAccessToken: async () => fresh.accessToken })
const freshPage = await page(fresh)
check('before the first accepted estimate, Home has no panel and keeps its four numbers', !freshPage.includes('data-testid="won-panel"') && freshPage.includes('data-testid="home-numbers"') && !freshPage.includes(WON_COPY.title), { status: freshRow.status })
const freshBoot = await freshClient.bootstrap()
check('and the app is given no line', freshBoot.won === null, freshBoot.won)
// a setup test that is accepted is not an accepted estimate
await copyOf(freshMade.quoteId as string, 'Sam Carter', { status: 'accepted', accepted_at: minutesAgo(5), is_test: true, pricing_json: { ...(freshRow.pricing_json as Row), total: 99999 } })
check('an accepted setup test does not bring the panel in', !(await page(fresh)).includes('data-testid="won-panel"') && (await freshClient.bootstrap()).won === null)

// business a: Megan (customer, $480) and Dana (on site, $480) accepted above, Sam accepted ($480) while the push service was down
const lastMonthDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12))
await copyOf(quoteId, 'Jordan Reyes', { status: 'accepted', created_at: iso(lastMonthDay), sent_at: iso(lastMonthDay), viewed_at: iso(lastMonthDay), accepted_at: iso(lastMonthDay), pricing_json: { ...(priced.pricing_json as Row), total: 1250 } })
await copyOf(quoteId, 'Setup Test', { status: 'accepted', accepted_at: minutesAgo(3), is_test: true, pricing_json: { ...(priced.pricing_json as Row), total: 77777 } })
const homeA = await page(a)
const headline = textOf(homeA, 'won-headline')
const onSiteLine = textOf(homeA, 'won-on-site')
check('Home shows the panel with the customer headline: two jobs, $960, in the business’s currency', homeA.includes('data-testid="won-panel"') && homeA.includes(WON_COPY.title) && headline === 'Won this month: $960 from 2 jobs', headline)
check('the estimate made on site is its own quieter line, never added in', onSiteLine === 'Plus $480 from 1 estimate you made on site.', onSiteLine)
check('last month is said when it has data', textOf(homeA, 'won-last-month') === 'Last month: $1,250 from 1 job', textOf(homeA, 'won-last-month'))
check('the accepted setup test ($77,777) is in no figure', !homeA.includes('77,777') && !homeA.includes('78,'))
const stepCounts = [...homeA.matchAll(/data-testid="won-step" data-step="(\w+)"[\s\S]*?data-testid="won-step-count">(?:<!--.*?-->)?(\d+)/g)].map((m) => `${m[1]}:${m[2]}`)
// customer requests this month: Megan, Jordan and Sam (3); the on-site quote is in none of the steps
check('four steps in a row: Requests, Estimates sent, Opened, Accepted, counted from customer requests only', stepCounts.length === 4 && stepCounts[0] === 'requests:3' && stepCounts[3] === 'accepted:2' && stepCounts.map((s) => s.split(':')[0]).join() === 'requests,sent,opened,accepted', stepCounts)
check('once the panel shows, the four stat cards are gone: a number has one home', !homeA.includes('data-testid="home-numbers"'))
const bootA = await appClient.bootstrap()
check('the app’s home line is the same sentence, with the on-site line, from the bootstrap route', bootA.won?.headline === headline && bootA.won?.onSite === onSiteLine, bootA.won)
check('another business is not shown these figures', (await createApi({ baseUrl: app, getAccessToken: async () => fresh.accessToken }).bootstrap()).won === null)

// a business that only quotes on site
const rivalClient = createApi({ baseUrl: app, getAccessToken: async () => rival.accessToken })
const rivalOnSite = await rivalClient.createQuote({ serviceId: rival.serviceId, customer: { name: 'Megan Grant' } })
const rivalRow = await settle(rivalOnSite.quoteId)
await copyOf(rivalOnSite.quoteId, 'Megan Grant', { status: 'accepted', accepted_at: minutesAgo(8), sent_at: minutesAgo(20) }, 'app')
await copyOf(rivalOnSite.quoteId, 'Dana Whitfield', { status: 'accepted', accepted_at: minutesAgo(6), sent_at: minutesAgo(20), pricing_json: { ...(rivalRow.pricing_json as Row), total: 2720 } }, 'app')
const homeRival = await page(rival)
check(
  'a business that only quotes on site: the title "Quoted on site this month" and its one line, no headline and no steps',
  homeRival.includes('data-kind="on-site"') && homeRival.includes(WON_COPY.onSiteTitle) && !homeRival.includes(WON_COPY.title) && textOf(homeRival, 'won-on-site') === '$3,200 from 2 estimates you made on site.' && !homeRival.includes('data-testid="won-headline"') && !homeRival.includes('data-testid="won-steps"'),
  textOf(homeRival, 'won-on-site')
)
const rivalBoot = await rivalClient.bootstrap()
check('and the app shows only that line', rivalBoot.won?.headline === null && rivalBoot.won?.onSite === '$3,200 from 2 estimates you made on site.', rivalBoot.won)

// the time zone: kept the first time a screen reports it
const zoneOf = async (tenantId: string) => ((await sb.select('tenants', `id=eq.${tenantId}&select=time_zone`)) as Row[])[0]?.time_zone
check('a business starts with no time zone of its own', (await zoneOf(fresh.tenantId)) === null)
await freshClient.bootstrap('America/Chicago')
check('the first one reported is kept', (await zoneOf(fresh.tenantId)) === 'America/Chicago')
await freshClient.bootstrap('Asia/Tokyo')
await call('POST', `${app}/api/tenant/time-zone`, { headers: fresh.cookie, body: { timeZone: 'Europe/London' } })
check('a later one does not move the business’s month', (await zoneOf(fresh.tenantId)) === 'America/Chicago')
check('what is not a time zone is refused (400), and signed out the route refuses (401)', (await call('POST', `${app}/api/tenant/time-zone`, { headers: a.cookie, body: { timeZone: 'Mars/Olympus' } })).status === 400 && (await call('POST', `${app}/api/tenant/time-zone`, { body: { timeZone: 'Europe/London' } })).status === 401)
const dashboardZone = await call('POST', `${app}/api/tenant/time-zone`, { headers: a.cookie, body: { timeZone: 'America/Denver' } })
check('the dashboard reports the browser’s zone the same way', dashboardZone.ok && (await zoneOf(a.tenantId)) === 'America/Denver')

// =====================================================================================
section('E. Small fixes')
// =====================================================================================
const widget = expectOk('widget config', await call('GET', `${app}/api/public/widget/config?tenantKey=${a.tenantKey}`))
const field = ((widget.serviceFields?.[a.serviceId] ?? []) as Row[]).find((f) => f.fieldId === 'how_many')
check('a question’s hint is saved once: under the box, not inside it', field?.helpText === 'From 1 to 5.' && (field?.placeholder === undefined || field?.placeholder === null), field)
const trades = (await call('GET', `${app}/trades`)).text as string
const cards = [...trades.matchAll(/data-testid="template-card"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>([\s\S]*?)<\/li>/g)].map((m) => ({ title: m[1], rest: m[2] }))
const servicesOf = (title: string) => /data-testid="template-services"[^>]*>([^<]*)</.exec(cards.find((c) => c.title === title)?.rest ?? '')?.[1] ?? null
check('nine cards', cards.length === 9, cards.map((c) => c.title))
check('a template whose only service has the card’s name shows no service line', ['Junk removal', 'Pressure washing', 'Fence installation'].every((title) => cards.some((c) => c.title === title) && servicesOf(title) === null), ['Junk removal', 'Pressure washing', 'Fence installation'].map(servicesOf))
const lines = cards.map((c) => servicesOf(c.title!)).filter((line): line is string => Boolean(line))
const tied = (line: string) => line.replace(/&nbsp;/g, '\u00A0')
check('in every other card the "·" is tied to the name before it (a space that does not break), so it never starts a line', lines.length === 6 && lines.every((line) => !/[^\u00A0]·/.test(tied(line))) && lines.filter((line) => /\u00A0· /.test(tied(line))).length >= 4, lines.length)
check('the words the app shows for its switches and its dev build are the shared ones', PUSH_COPY.unavailable === 'Available in the App Store version' && PUSH_COPY.refused === "Turned off in your phone's settings")

finish()
