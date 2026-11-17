// T-178 check: no quote is ever lost.
//
//   1. A customer is never stopped at submit for what they wrote: a request with answers or a
//      photo goes ahead whatever the note says; a description-only request that reads like
//      another offered service is made on the chosen service and held for the business.
//   2. A failed quote is never silent: the business gets one email and sees the customer's
//      answers and photos; the customer is told the business has the request.
//   3. A failed quote can be retried with the platform owner's one-time code.
//   4. The quote link page's rate limit answers with a real 429.
//   5. After 60 seconds of "Preparing your estimate" the customer is told it is slow.
//
// Two stand-ins run inside this script, and the web app is started pointing at them:
//   - the AI model that answers "does this description fit the chosen service?" (a live model's
//     answers vary from run to run, so it is never a pass-or-fail check);
//   - Upstash, for the quote link page's limit (it counts that page only; every other limit is
//     answered "1", so nothing else here is ever blocked).
//
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//   SERVICE_MATCH_BASE_URL=http://127.0.0.1:8797/ai \
//   UPSTASH_REDIS_REST_URL=http://127.0.0.1:8797/upstash UPSTASH_REDIS_REST_TOKEN=local-upstash-t178 \
//   pnpm dev:web
//
// The worker must be running (requests are priced, with the real models), WITHOUT Upstash
// settings. The worker's own limiter is covered by its unit tests and by the wrangler proof in
// Docs/CHANGELOG.md (T-178). No email is sent: the failed-quote email is captured, not posted.
//
// Run:  PLAYWRIGHT_DIR=<folder> npx tsx scripts/hardcore-test/verify-t178.mts
// Without PLAYWRIGHT_DIR the browser section is skipped, and the script says so.
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp, uploadAssets } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { markQuoteFailed } from '../../apps/worker/src/failed-quote'
import { RATE_LIMITS } from '../../apps/web/src/lib/rate-limit-config'
import { SLOW_PREPARING_MS, slowPreparingLine, failedRequestLine, failedRequestTitle } from '../../packages/shared/src/failed-request'

type Row = Record<string, unknown>
const MOCK_PORT = 8797
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t178-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const notChecked: string[] = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, values: Row) => call('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=minimal' }, body: values })

// =====================================================================================
// Stand-ins: the matcher's model, and Upstash for the quote link page
// =====================================================================================
/** What the "model" answers, by a marker in the customer's words */
const matcherPlan = new Map<string, Row>()
const matcherAsked: string[] = []
const pageCounts = new Map<string, number>()
let upstashCalls = 0
const mock = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    let body: unknown = null
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null
    } catch {
      body = null
    }
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(json))
    }
    const url = req.url ?? '/'
    if (url.startsWith('/ai/')) {
      const prompt = String((body as { contents?: Array<{ parts?: Array<{ text?: string }> }> } | null)?.contents?.[0]?.parts?.[0]?.text ?? '')
      matcherAsked.push(prompt)
      const marker = [...matcherPlan.keys()].find((m) => prompt.includes(m))
      const answer = marker ? matcherPlan.get(marker)! : { isMatch: true, confidence: 0.5, suggestedServiceId: null, reason: 'No plan for this message.' }
      return send(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] })
    }
    if (url.startsWith('/upstash')) {
      upstashCalls++
      if (!Array.isArray(body)) return send(400, { error: 'ERR not a pipeline' })
      // Only the quote link page is counted; every other limit is answered "1" (never blocked)
      return send(
        200,
        (body as unknown[][]).map(([command, key]) => {
          if (String(command).toUpperCase() !== 'INCR') return { result: 1 }
          if (!String(key).includes(':quote_page:')) return { result: 1 }
          pageCounts.set(String(key), (pageCounts.get(String(key)) ?? 0) + 1)
          return { result: pageCounts.get(String(key)) }
        })
      )
    }
    return send(404, { error: 'unknown' })
  })
})
await new Promise<void>((resolve, reject) => mock.once('error', reject).listen(MOCK_PORT, '127.0.0.1', resolve))
function finish(): never {
  mock.close()
  const failed = checks.filter((c) => !c.pass)
  if (notChecked.length) console.log(`\nNot checked:\n${notChecked.map((n) => `  - ${n}`).join('\n')}`)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}

// =====================================================================================
// A business with three services: two from a trade pack, and one fixed-price visit with no questions
// =====================================================================================
const id = shortId()
const businessName = `Harbor Doors ${id}`
const ownerEmail = `owner+t178-${id}@hardcore.test`
const user = await sb.createUser(ownerEmail, `Hardcore-${id}-Aa1!`, businessName)
const session = await sb.signIn(ownerEmail, `Hardcore-${id}-Aa1!`)
const cookieHeader = sessionCookieHeader(cfg, session)
const cookie = { Cookie: cookieHeader }
const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName } })
const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
const tenantKey = site.tenant_key as string

async function packService(index: number): Promise<{ id: string; name: string }> {
  const svc = garageDoorsPackUS.services[index]!
  const created = expectOk('service', await call('POST', `${app}/api/services`, {
    headers: cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
    },
  }))
  return { id: created.service.id as string, name: svc.name }
}
const withQuestions = await packService(0)
const other = await packService(1)
const visitSteps = [{ id: 'visit', name: 'Standard visit', description: 'One visit, fixed price', costType: 'fixed', defaultCost: 120, optional: false }]
const plainCreated = expectOk('plain service', await call('POST', `${app}/api/services`, {
  headers: cookie,
  body: {
    name: 'Standard Visit', description: 'One visit at a fixed price', documentTypeDefault: 'instant_estimate',
    scopeIncludes: ['One visit'], scopeExcludes: [], defaultAssumptions: [],
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
    workSteps: visitSteps, expectedSignals: [],
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: visitSteps },
  },
}))
const plain = { id: plainCreated.service.id as string, name: 'Standard Visit' }

const submit = (serviceId: string, customer: Row, answers: Row[], assetIds: string[] = []) =>
  call('POST', `${app}/api/public/quotes`, { body: { tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers }, assetIds, source: { type: 'widget' } }, timeoutMs: 120_000 })
const quoteRow = async (quoteId: string) =>
  ((await sb.select('quotes', `id=eq.${quoteId}&select=status,service_id,pricing_json,content_json,review_hold,quality_gate_json,quote_request_id`)) as Row[])[0]
const requestRow = async (requestId: string) => ((await sb.select('quote_requests', `id=eq.${requestId}&select=service_id,source_json,asset_ids`)) as Row[])[0]
async function settle(quoteId: string, timeoutMs = 420_000): Promise<Row> {
  const until = Date.now() + timeoutMs
  let row = await quoteRow(quoteId)
  while (Date.now() < until && ['queued', 'generating'].includes(String(row?.status))) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    row = await quoteRow(quoteId)
  }
  return row!
}
const tokenOf = (url: unknown) => new URL(String(url)).searchParams.get('token')!
const total = (row: Row) => Number((row.pricing_json as { total?: number } | null)?.total ?? 0)

// =====================================================================================
section('0. The web app is asking the stand-ins')
matcherPlan.set('PROBE-MARKER', { isMatch: true, confidence: 0.9, suggestedServiceId: null, reason: 'Fits.' })
const probe = await submit(plain.id, { name: 'Probe Person', email: 'probe.person@example.com' }, [{ fieldId: '_project_description', value: 'PROBE-MARKER a standard visit please, any day next week' }])
if (!probe.ok || !matcherAsked.some((p) => p.includes('PROBE-MARKER'))) {
  console.error('\nThe web app is not asking this script’s stand-in for the service match. Start it as the top of this file says (SERVICE_MATCH_BASE_URL), then run again.')
  check('the web app runs with the local test settings', false, { status: probe.status, asked: matcherAsked.length, error: probe.json?.error })
  finish()
}
check('the web app runs with the local test settings (the matcher is stood in for)', true)
const probePrompt = matcherAsked.find((p) => p.includes('PROBE-MARKER'))!
check(
  'the matcher is given the full context: the chosen service and the others, each with what it covers',
  probePrompt.includes(`name: ${plain.name}`) && probePrompt.includes(`name: ${withQuestions.name}`) && probePrompt.includes(`name: ${other.name}`) && probePrompt.includes('includes: One visit') && /includes: .+/.test(probePrompt.split(`name: ${withQuestions.name}`)[1] ?? '')
)

// =====================================================================================
section('1. A customer is never stopped at submit for what they wrote')
// a photo, uploaded the way the form does it (skipped when storage is not set up on this machine)
const jpeg = createRequire(path.join(ROOT, 'apps/web/package.json'))('jpeg-js') as { encode: (image: { width: number; height: number; data: Buffer }, quality: number) => { data: Buffer } }
const pixels = Buffer.alloc(320 * 240 * 4)
for (let i = 0; i < 320 * 240; i++) pixels.set([120 + (i % 80), 110, 100, 255], i * 4)
const photoPath = path.join(outDir, 'garage.jpg')
writeFileSync(photoPath, jpeg.encode({ width: 320, height: 240, data: pixels }, 80).data)
let photoIds: string[] = []
try {
  const uploaded = await uploadAssets(cfg, tenantKey, [{ fileName: 'garage.jpg', contentType: 'image/jpeg', path: photoPath }])
  photoIds = uploaded.assetIds
} catch {
  photoIds = []
}
if (photoIds.length === 0) notChecked.push('A request with a photo: storage is not set up on this machine, so the request below carries answers and a note only.')

// (a) answers (+ photo) for the chosen service, and a note asking for another offered service.
//     If the matcher WERE asked, the stand-in would say "another service" with full confidence.
const SINGLE = 'Single (8 or 9 ft wide, 7 ft tall)'
matcherPlan.set('ALSO-OTHER', { isMatch: false, confidence: 0.99, suggestedServiceId: other.id, reason: 'They ask for the other service.' })
const askedBefore = matcherAsked.length
const megan = { name: 'Megan Grant', email: 'megan.grant@example.com', phone: '(555) 201-0142' }
const a = await submit(
  withQuestions.id,
  megan,
  [{ fieldId: 'door_size', value: SINGLE }, { fieldId: 'door_style', value: 'Steel, non-insulated' }, { fieldId: '_project_description', value: `ALSO-OTHER Single steel door. I would also like ${other.name.toLowerCase()} while you are here.` }],
  photoIds
)
check('answers, a photo and a note asking for another offered service → accepted (200), not refused', a.status === 200 && !a.json?.error && a.json?.status === 'queued', a.json?.error ?? a.status)
check('… and the matcher was not asked at all: the customer chose that service and filled it in', matcherAsked.length === askedBefore, matcherAsked.length - askedBefore)

// (b) description only, and the model is sure another offered service fits
matcherPlan.set('CLEARLY-OTHER', { isMatch: false, confidence: 0.96, suggestedServiceId: other.id, reason: 'They describe a broken spring, not a visit.' })
const b = await submit(plain.id, { name: 'Dana Whitfield', email: 'dana.whitfield@example.com' }, [{ fieldId: '_project_description', value: 'CLEARLY-OTHER my garage door spring snapped this morning and the door will not open' }])
check('description only, clearly another offered service → still accepted (200): no SERVICE_MISMATCH, no "did you mean"', b.status === 200 && !b.json?.error && b.json?.status === 'queued' && b.json?.isGeneralInquiry === false, b.json?.error ?? b.json)
check('… an old cached form sees an ordinary success: a quote id and the customer’s link', typeof b.json?.quoteId === 'string' && /\/q\/[^?]+\?token=/.test(String(b.json?.quoteViewUrl)))

// (c) description only and vague: the model says it fits
matcherPlan.set('VAGUE-ONE', { isMatch: true, confidence: 0.55, suggestedServiceId: null, reason: 'Could be a visit.' })
const c = await submit(plain.id, { name: 'Sam Okafor', email: 'sam.okafor@example.com' }, [{ fieldId: '_project_description', value: 'VAGUE-ONE need someone to come and have a look at it some time' }])
check('description only and vague → accepted normally', c.status === 200 && c.json?.status === 'queued', c.json?.error ?? c.status)

// (d) description only and nothing the business offers fits: a general inquiry, as before
matcherPlan.set('NOTHING-FITS', { isMatch: false, confidence: 0.97, suggestedServiceId: null, reason: 'Not something this business does.' })
const d = await submit(plain.id, { name: 'Lee Castellan', email: 'lee.castellan@example.com' }, [{ fieldId: '_project_description', value: 'NOTHING-FITS can you repaint my boat and re-rig the mast' }])
check('description only and no offered service fits → a general inquiry, as before (only reachable with a description alone)', d.status === 200 && d.json?.isGeneralInquiry === true, d.json?.error ?? d.json)

if (![a, b, c].every((r) => r.ok)) finish()
console.log('   … waiting for the worker to price them')
const [rowA, rowB, rowC] = await Promise.all([settle(a.json.quoteId), settle(b.json.quoteId), settle(c.json.quoteId)])
const reqA = await requestRow(String(rowA.quote_request_id))
const reqB = await requestRow(String(rowB.quote_request_id))
const reqC = await requestRow(String(rowC.quote_request_id))
check(
  '(a) is made and priced for the service the customer chose, with nothing attached',
  rowA.service_id === withQuestions.id && reqA.service_id === withQuestions.id && !(reqA.source_json as Row).serviceSuggestion && ['pending_review', 'awaiting_clarification', 'sent'].includes(String(rowA.status)) && (rowA.status === 'awaiting_clarification' || total(rowA) > 0),
  { status: rowA.status, total: total(rowA) }
)
if (photoIds.length) check('(a) keeps its photo', ((reqA.asset_ids as string[]) ?? []).length === 1)
check('(b) is made on the chosen service, with the suggestion on the request', rowB.service_id === plain.id && (reqB.source_json as { serviceSuggestion?: Row }).serviceSuggestion?.serviceId === other.id, reqB.source_json)
const gateB = rowB.quality_gate_json as { action?: string; reason?: string } | null
check(
  '(b) is priced and HELD for the business, hidden from the customer, with the reason naming both services',
  rowB.status === 'pending_review' && rowB.review_hold === 'check' && total(rowB) > 0 && String(gateB?.reason).includes(`"${plain.name}"`) && String(gateB?.reason).includes(`"${other.name}"`),
  { status: rowB.status, hold: rowB.review_hold, reason: gateB?.reason }
)
const viewB = await call('GET', `${app}/api/public/quotes/${b.json.quoteId}?token=${tokenOf(b.json.quoteViewUrl)}&poll=1`)
check('(b) the customer sees no price while it is held', viewB.ok && viewB.json?.status === 'pending_review' && viewB.json?.review?.confirmationPending !== true && !(Number(viewB.json?.pricing?.total) > 0), { status: viewB.json?.status, total: viewB.json?.pricing?.total })
const dashB = await call('GET', `${app}/api/quotes/${b.json.quoteId}`, { headers: cookie })
check('(b) the business’s quote page is given the suggestion and the customer’s words', dashB.json?.serviceSuggestion?.serviceName === other.name && /spring snapped/.test(String(dashB.json?.request?.description)), dashB.json?.serviceSuggestion)
check('(c) is priced as usual: shown to the customer while the business reviews it, nothing attached', rowC.status === 'pending_review' && rowC.review_hold === 'shown' && total(rowC) > 0 && !(reqC.source_json as Row).serviceSuggestion, { status: rowC.status, hold: rowC.review_hold })

// =====================================================================================
section('2. A failed quote is never silent')
// The worker's own function, against this database, with the email captured instead of posted
const { createClient } = createRequire(path.join(ROOT, 'apps/worker/package.json'))('@supabase/supabase-js') as { createClient: (url: string, key: string, options: Row) => never }
const db = createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const mails: Array<{ to: string; subject: string; htmlBody: string }> = []
const capture = (async (_config: unknown, message: { to: string; subject: string; htmlBody: string }) => {
  mails.push(message)
  return { success: true }
}) as never
const mailEnv = { POSTMARK_API_TOKEN: 'captured-not-posted', POSTMARK_FROM_EMAIL: 'quotes@example.test', APP_URL: app }
const REASON = 'made to fail by verify-t178'
const failedA = await markQuoteFailed(db, mailEnv, a.json.quoteId, REASON, capture)
const afterFail = await quoteRow(a.json.quoteId)
check('the quote is marked failed and the reason is kept on it', failedA.marked && afterFail.status === 'failed' && (afterFail.content_json as Row).error === REASON, failedA)
check(
  'the business gets ONE email: who asked, for what, and a link to the request',
  mails.length === 1 && mails[0]!.to === ownerEmail && mails[0]!.subject.includes('Megan Grant') && mails[0]!.htmlBody.includes(`${app}/app/quotes/${a.json.quoteId}`) && mails[0]!.htmlBody.includes(withQuestions.name) && mails[0]!.htmlBody.includes('megan.grant@example.com'),
  { count: mails.length, subject: mails[0]?.subject }
)
check('… which does not say why it failed', mails.length === 1 && !mails[0]!.htmlBody.includes(REASON))
await markQuoteFailed(db, mailEnv, a.json.quoteId, REASON, capture)
check('failing the same quote again sends no second email', mails.length === 1, mails.length)

const tokenA = tokenOf(a.json.quoteViewUrl)
const viewA = await call('GET', `${app}/api/public/quotes/${a.json.quoteId}?token=${tokenA}&poll=1`)
check('the customer’s page is told "failed" (so it stops saying Preparing), and nothing about why', viewA.ok && viewA.json?.status === 'failed' && !JSON.stringify(viewA.json).includes(REASON), viewA.json?.status)
const dashA = await call('GET', `${app}/api/quotes/${a.json.quoteId}`, { headers: cookie })
const sentA = dashA.json?.request as { description?: string; answers?: Array<{ label: string; value: string }>; postcode?: string } | undefined
check(
  'the business sees the request: the customer’s details, their words, their answers in the business’s own question wording, and the photos',
  dashA.ok && dashA.json?.quote?.status === 'failed' && dashA.json?.quote?.customer_json?.email === 'megan.grant@example.com' && /Single steel door/.test(String(sentA?.description)) &&
    (sentA?.answers ?? []).some((x) => x.value === SINGLE && x.label !== 'door_size') && sentA?.postcode === '63021' && (photoIds.length === 0 || (dashA.json?.photos ?? []).length === 1),
  { answers: sentA?.answers, photos: (dashA.json?.photos ?? []).length }
)
const home = await call('GET', `${app}/api/quotes?group=needs_you`, { headers: cookie })
check('… and it is in the business’s "needs you" list', home.ok && JSON.stringify(home.json).includes(a.json.quoteId), home.status)

// =====================================================================================
section('3. A failed quote can be priced again with the owner’s one-time code')
const retry = (quoteId: string, code?: string) => call('POST', `${app}/api/admin/quotes/${quoteId}/retry`, { headers: code ? { 'X-Retry-Code': code } : {}, body: {} })
const code = crypto.randomBytes(32).toString('hex')
const hash = crypto.createHash('sha256').update(code).digest('hex')
check('no code and not an admin → refused', (await retry(a.json.quoteId)).status === 403)
check('a code the quote does not carry → refused', (await retry(a.json.quoteId, code)).status === 403)
// what scripts/retry-failed-quote.sh writes, through the database's own access
await patch('quotes', `id=eq.${a.json.quoteId}`, { content_json: { ...(afterFail.content_json as Row), failedNotifiedAt: new Date().toISOString(), retryCode: { hash, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } } })
check('a signed-in business owner (not a platform admin) holding no code → refused', (await call('POST', `${app}/api/admin/quotes/${a.json.quoteId}/retry`, { headers: cookie, body: {} })).status === 403)
check('the code does not work for another quote', (await retry(c.json.quoteId, code)).status === 403)
const retried = await retry(a.json.quoteId, code)
check('the right code → the quote is queued again', retried.status === 200 && retried.json?.status === 'queued', retried.json)
check('the code works once', (await retry(a.json.quoteId, code)).status === 403)
const again = await settle(a.json.quoteId)
check(
  'the worker prices it again; the code and the old error are gone from the quote',
  ['pending_review', 'awaiting_clarification', 'sent'].includes(String(again.status)) && !(again.content_json as Row).retryCode && !(again.content_json as Row).error,
  { status: again.status }
)
const oldLink = await call('GET', `${app}/api/public/quotes/${a.json.quoteId}?token=${tokenA}&poll=1`)
check('the link the customer already had still opens the quote', oldLink.ok && oldLink.json?.status === again.status, oldLink.status)

// =====================================================================================
section('4. The quote link page’s limit answers with a real 429')
const slug = String(((await sb.select('tenants', `id=eq.${tenantId}&select=slug`)) as Row[])[0]?.slug ?? '')
const perIp = RATE_LIMITS.quote_page[0].perIp
const firstView = await fetch(`${app}/quote/${slug}`)
if (!slug || upstashCalls === 0) {
  notChecked.push('The quote link page’s 429: the web app is not started with this script’s Upstash stand-in (UPSTASH_REDIS_REST_URL, top of this file), or the business has no quote link.')
} else {
  check('the page opens normally under the limit', firstView.status === 200)
  // start at a fresh minute, so all the views are counted in one window
  while (new Date().getSeconds() > 40) await new Promise((resolve) => setTimeout(resolve, 1000))
  pageCounts.clear()
  const statuses: number[] = []
  for (let i = 0; i < perIp + 5; i++) statuses.push((await fetch(`${app}/quote/${slug}`)).status)
  const firstBlocked = statuses.findIndex((s) => s === 429)
  check(`${perIp} views in a minute are served; the next ones get HTTP 429 (not a 200 page that says "too many")`, statuses.slice(0, perIp).every((s) => s === 200) && statuses.slice(perIp).every((s) => s === 429), { firstBlockedView: firstBlocked + 1 })
  const blocked = await fetch(`${app}/quote/${slug}`)
  const blockedBody = await blocked.text()
  check('the 429 says to wait, in plain words, and carries Retry-After', blocked.status === 429 && Number(blocked.headers.get('retry-after')) > 0 && /Too many tries/.test(blockedBody), blocked.headers.get('retry-after'))
  check('both counters were kept: the visitor’s address and the business’s link', [...pageCounts.keys()].some((k) => k.includes(':ip:')) && [...pageCounts.keys()].some((k) => k.includes(`:key:slug:${slug}`)), [...pageCounts.keys()].length)
}

// =====================================================================================
section('5. The customer’s and the business’s pages, in a browser')
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The customer’s waiting page and the business’s quote page in a browser (set PLAYWRIGHT_DIR).')
  finish()
}
const { browserDeps } = await import('./browser.mjs')
const { chromium } = browserDeps()
const browser = await chromium.launch()
try {
  // a quote that stays "queued": nothing is working on it (made by hand, never sent to the worker)
  const stuck = async (customer: { name: string; email: string; phone?: string }, phoneOnly = false) => {
    const res = await submit(plain.id, customer, [{ fieldId: '_project_description', value: 'VAGUE-ONE a standard visit please' }])
    const done = await settle(res.json.quoteId)
    // phone only: this business asks for an email on its form, so the address is taken off the saved quote instead
    await patch('quotes', `id=eq.${res.json.quoteId}`, { status: 'queued', ...(phoneOnly && { customer_json: { name: customer.name, phone: customer.phone } }) })
    return { id: res.json.quoteId as string, url: String(res.json.quoteViewUrl), was: done.status }
  }
  const withEmail = await stuck({ name: 'Rosa Delgado', email: 'rosa.delgado@example.com' })
  const phoneOnly = await stuck({ name: 'Theo Marsh', email: 'theo.marsh@example.com', phone: '(555) 201-0188' }, true)
  for (const [who, quote, hasEmail] of [['a customer who gave an email', withEmail, true], ['a customer who gave only a phone', phoneOnly, false]] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.clock.install()
    await page.goto(quote.url)
    await page.getByTestId('preparing').waitFor({ timeout: 30_000 })
    const first = (await page.getByTestId('preparing').innerText()).trim()
    check(`${who}: at first the page says it usually takes a minute or two`, /usually takes a minute or two/.test(first), first)
    await page.clock.fastForward(SLOW_PREPARING_MS - 2000)
    check(`${who}: at 58 seconds it still does`, (await page.getByTestId('preparing').count()) === 1)
    await page.clock.fastForward(3000)
    await page.getByTestId('preparing-slow').waitFor({ timeout: 10_000 })
    const slow = (await page.getByTestId('preparing-slow').innerText()).trim()
    check(`${who}: after 60 seconds, one plain line: "${slowPreparingLine(hasEmail)}"`, slow === slowPreparingLine(hasEmail), slow)
    check(`${who}: the heading is still "Preparing your estimate" (it keeps checking)`, (await page.locator('[role="status"] h1').innerText()).trim() === 'Preparing your estimate')
    if (hasEmail) await page.screenshot({ path: path.join(outDir, 'customer-slow-390.png'), fullPage: true })
    // … and when it fails, the same page says so without a reload
    await markQuoteFailed(db, {}, quote.id, REASON)
    await page.clock.fastForward(5000)
    await page.getByTestId('request-failed').waitFor({ timeout: 20_000 })
    const failedText = (await page.getByTestId('request-failed').innerText()).trim()
    const heading = (await page.locator('[role="status"] h1').innerText()).trim()
    check(`${who}: on failure the page says the business has the request and will be in touch`, heading === failedRequestTitle(businessName) && failedText === failedRequestLine(businessName), { heading, failedText })
    check(`${who}: … and no longer says "Preparing"`, !/Preparing/.test(await page.locator('body').innerText()))
    if (hasEmail) await page.screenshot({ path: path.join(outDir, 'customer-failed-390.png'), fullPage: true })
    await ctx.close()
  }

  // the business's quote page: the failed request with what the customer sent, and the held one with the suggestion
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await ctx.addCookies(cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: app })))
    const page = await ctx.newPage()
    await page.goto(`${app}/app/quotes/${withEmail.id}`)
    await page.getByTestId('customer-sent').waitFor({ timeout: 30_000 })
    const sentence = (await page.getByTestId('next-step-sentence').innerText()).trim()
    const sentText = await page.getByTestId('customer-sent').innerText()
    check(`business page at ${width}px: a failed request says what to do, with the customer’s words and how to reach them`, /could not work out a price/.test(sentence) && /a standard visit please/.test(sentText) && (await page.getByTestId('next-step-email').count()) === 1, sentence)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`business page at ${width}px: nothing runs off the side`, overflow <= 1, overflow)
    await page.screenshot({ path: path.join(outDir, `business-failed-${width}.png`), fullPage: true })

    await page.goto(`${app}/app/quotes/${b.json.quoteId}`)
    await page.getByTestId('service-suggestion').waitFor({ timeout: 30_000 })
    const note = await page.getByTestId('service-suggestion').innerText()
    check(`business page at ${width}px: the held request names the service chosen and the one suggested`, note.includes(plain.name) && note.includes(other.name), note.replace(/\s+/g, ' ').slice(0, 160))
    await page.screenshot({ path: path.join(outDir, `business-suggestion-${width}.png`), fullPage: true })
    await ctx.close()
  }
} finally {
  await browser.close()
}
notChecked.push('The request form’s own finish screen after 60 seconds (it uses the same line as the customer’s page, which is checked above).')
notChecked.push('The worker’s rate limiter against a real Upstash database (unit tests and the local wrangler proof cover it; see Docs/CHANGELOG.md, T-178).')
finish()
