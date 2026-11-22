// T-182 check: the business's on-site app against the real server (local stack).
//
// The app's own code is what runs here: its API client (apps/mobile/src/lib/api.ts), its sending
// queue (outbox.ts), its price and status rules (price.ts, status.ts). Only the phone is pretended:
// the queue's storage is a variable, a photo is sent with Node's fetch, and "the signal drops" is a
// switch on the fetch the client is given.
//
// What it proves:
//   A. sign-in by bearer, the form, the quotes list
//   B. the on-site path: only a name is needed; a lost signal loses nothing; a repeat never makes
//      (or counts) a second quote; another business's same id is its own
//   C. the price as the app shows it: hidden from the customer until approved, the minimum charge
//      as a note, tax, then approve and a link to share
//   D. typed answers (yes/no, tick boxes, numbers) and a refused request coming back in the
//      server's own words
//   E. a combined quote: one total, sections, one quote on the plan
//   F. the plan limit: saved not priced, with its photo; the limit stands until there is a plan
//   G. a paused account; H. a request that could not be priced; I. another business is locked out
//
// Needs the web app and the worker, started the usual way (the main batch's settings are fine):
//   pnpm dev:worker     and     pnpm dev:web
// Run:  npx tsx scripts/hardcore-test/verify-t182.mts
// Prices are from the rules engine; the wording a live model writes is never asserted.
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { createApi, ApiError, fieldsForService, type Api } from '../../apps/mobile/src/lib/api'
import { toSubmissionAnswers, visibleFields, fieldKind, missingRequired } from '../../apps/mobile/src/lib/answers'
import { createOutbox, type DraftPhoto, type DraftRequest, type Outbox } from '../../apps/mobile/src/lib/outbox'
import { headlinePrice, mainAction, minimumNote, priceLines } from '../../apps/mobile/src/lib/price'
import { turnOfListItem, turnOfQuote } from '../../apps/mobile/src/lib/status'
import { QUOTE_TURN_COPY } from '../../packages/shared/src/quote-turn'
import { getPlan } from '../../packages/shared/src/plans'
import type { AppQuoteView } from '../../packages/shared/src/api.types'

type Row = Record<string, unknown>
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t182-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, values: Row) => call('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=minimal' }, body: values })
const money = (n: number) => Math.round(n * 100) / 100
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function finish(): never {
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}

// =====================================================================================
// A pretend phone around the app's real client and queue
// =====================================================================================
interface Phone {
  api: Api
  outbox: Outbox
  /** 'on' = normal · 'off' = no signal · 'answer-lost' = the request arrives, its answer does not */
  signal: 'on' | 'off' | 'answer-lost'
  links: Map<string, string>
  posts: number
}
function phone(accessToken: string, userId: string): Phone {
  let ids = 0
  const self = { signal: 'on', links: new Map<string, string>(), posts: 0 } as Phone
  const fetchLike = async (input: string, init?: RequestInit) => {
    if (self.signal === 'off') throw new TypeError('Network request failed')
    const res = await fetch(input, init)
    if (input.endsWith('/api/app/quotes') && init?.method === 'POST') {
      self.posts++
      if (self.signal === 'answer-lost') {
        await res.text()
        throw new TypeError('Network request failed')
      }
    }
    return res
  }
  self.api = createApi({ baseUrl: app, getAccessToken: async () => accessToken, fetch: fetchLike })
  let saved: string | null = null
  self.outbox = createOutbox({
    api: self.api,
    tenantKey: async () => (await self.api.bootstrap()).tenantKey,
    store: { read: async () => saved, write: async (json) => void (saved = json) },
    files: {
      // the phone sends the file itself to the signed address, with its type
      async put(uploadUrl: string, photo: DraftPhoto, onProgress: (fraction: number) => void) {
        if (self.signal === 'off') throw new ApiError(0, 'NETWORK', 'No signal')
        const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': photo.contentType }, body: new Uint8Array(readFileSync(photo.uri)) })
        if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'The photo could not be uploaded')
        onProgress(1)
      },
      remove: async () => undefined,
    },
    saveQuoteLink: async (quoteId, url) => void self.links.set(quoteId, url),
    owner: () => userId,
    now: () => Date.now(),
    newId: () => `app-t182-${shortId()}-${++ids}`,
  })
  return self
}
/** Run the queue until this draft has become a quote (the waits between tries are skipped, as "Try now" does) */
async function sendNow(p: Phone, draftId: string, tries = 6): Promise<{ quoteId: string; held: boolean } | null> {
  for (let i = 0; i < tries; i++) {
    p.outbox.retryNow()
    await p.outbox.pump()
    const sent = p.outbox.takeSent(draftId)
    if (sent) return sent
    if (p.outbox.find(draftId)?.send === 'editing') return null
  }
  return null
}
/** The quote as the app loads it, asked again while the price is worked out (the app does the same) */
async function priced(api: Api, quoteId: string, timeoutMs = 420_000): Promise<AppQuoteView> {
  const until = Date.now() + timeoutMs
  let view = await api.getQuote(quoteId)
  while (Date.now() < until && (view.status === 'queued' || view.status === 'generating')) {
    await sleep(3000)
    view = await api.getQuote(quoteId)
  }
  return view
}

// =====================================================================================
// Two businesses. The first has 10% tax and two services with generic names:
//   Service One: one fixed line of $90 and a $120 minimum charge; asks nothing; photos optional
//   Service Two: $40 a unit; asks how many (required), a yes/no question and a tick-box question
// =====================================================================================
interface Business {
  name: string
  tenantId: string
  userId: string
  cookie: { Cookie: string }
  accessToken: string
  tenantKey: string
}
async function business(label: string): Promise<Business> {
  const id = shortId()
  const name = `${label} ${id}`
  const email = `owner+t182-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: true, taxRate: 0.1, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { name, tenantId, userId: user.id as string, cookie, accessToken: session.access_token as string, tenantKey: site.tenant_key as string }
}
async function makeService(b: Business, name: string, steps: Row[], minimumCharge = 0): Promise<string> {
  const created = expectOk(`service ${name}`, await call('POST', `${app}/api/services`, {
    headers: b.cookie,
    body: {
      name, description: `${name} for the on-site check`, documentTypeDefault: 'instant_estimate',
      scopeIncludes: [`One ${name} visit`], scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
      workSteps: steps, expectedSignals: [],
      pricingRules: { baseFee: 0, minimumCharge, addons: [], multipliers: [], workSteps: steps },
    },
  }))
  return created.service.id as string
}
const ONE = { name: 'Service One', price: 90, minimum: 120 }
const TWO = { name: 'Service Two', unit: 40 }
const TAX = 0.1

const a = await business('Onsite Works')
const rival = await business('Rival Works')
const oneId = await makeService(a, ONE.name, [{ id: 'one_visit', name: 'Visit', description: 'One visit', costType: 'fixed', defaultCost: ONE.price, optional: false }], ONE.minimum)
const twoId = await makeService(a, TWO.name, [{ id: 'two_units', name: 'Units', description: 'Each unit', costType: 'per_unit', defaultCost: TWO.unit, optional: false, quantitySource: { type: 'form_field', fieldId: 'unit_count' } }])
const rivalServiceId = await makeService(rival, 'Service One', [{ id: 'one_visit', name: 'Visit', description: 'One visit', costType: 'fixed', defaultCost: 50, optional: false }])
for (const row of (await sb.select('widget_configs', `tenant_id=eq.${a.tenantId}&service_id=eq.${twoId}&select=id`)) as Row[]) await call('DELETE', `${cfg.supabaseUrl}/rest/v1/widget_configs?id=eq.${row.id}`, { headers: admin })
await sb.insert('widget_configs', {
  tenant_id: a.tenantId,
  service_id: twoId,
  config_json: {
    fields: [
      { fieldId: 'unit_count', type: 'number', label: 'How many units?', required: true },
      { fieldId: 'easy_access', type: 'boolean', label: 'Is access easy?', required: false },
      { fieldId: 'extras_wanted', type: 'checkbox', label: 'Which extras?', required: false, options: [{ value: 'First', label: 'First' }, { value: 'Second', label: 'Second' }, { value: 'Third', label: 'Third' }] },
    ],
    files: { minPhotos: 0, maxPhotos: 4, maxDocs: 0 },
  },
})

const usedTotal = async (tenantId: string) => ((await sb.select('usage_counters', `tenant_id=eq.${tenantId}&select=estimates_created`)) as Row[]).reduce((sum, r) => sum + Number(r.estimates_created), 0)
const requestsWith = async (tenantId: string, clientRequestId: string) => ((await sb.select('quote_requests', `tenant_id=eq.${tenantId}&source_json->>clientRequestId=eq.${clientRequestId}&select=id,customer_email,customer_name,asset_ids,job_answers,source_json`)) as Row[])
const publicView = (quoteId: string, token: string) => call('GET', `${app}/api/public/quotes/${quoteId}?token=${token}&poll=1`)
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!
const requestFor = (serviceId: string, name: string, description = '', answers: Row[] = []): DraftRequest => ({
  serviceId,
  customer: { name },
  job: { answers: [...(description ? [{ fieldId: '_project_description', value: description }] : []), ...answers] as never },
})

const pa = phone(a.accessToken, a.userId)
const pr = phone(rival.accessToken, rival.userId)

// =====================================================================================
section('A. Sign-in, the form, the list')
// =====================================================================================
const boot = await pa.api.bootstrap()
check('the app signs in with a bearer and learns the business, its currency and its form key', boot.tenantName === a.name && boot.currency === 'USD' && boot.tenantKey === a.tenantKey, { name: boot.tenantName })
const widget = await pa.api.widgetConfig(boot.tenantKey)
const fieldsTwo = visibleFields(fieldsForService(widget, twoId))
check(
  'the form gives the two services and Service Two’s questions, each drawn as the website draws it (number, yes/no, tick boxes)',
  widget.services.length === 2 && JSON.stringify(fieldsTwo.map((f) => fieldKind(f))) === JSON.stringify(['number', 'yesno', 'multi']),
  fieldsTwo.map((f) => `${f.fieldId}:${fieldKind(f)}`)
)
check('signed out, the app’s routes refuse (401): sign-in is never skipped', (await call('GET', `${app}/api/app/bootstrap`)).status === 401 && (await call('POST', `${app}/api/app/quotes`, { body: { serviceId: oneId, customer: { name: 'Megan Grant' } } })).status === 401)

// =====================================================================================
section('B. The on-site path: a name is enough, and a lost signal loses nothing')
// =====================================================================================
const usedAtStart = await usedTotal(a.tenantId)
const d1 = pa.outbox.start()!
pa.outbox.update(d1.id, { serviceId: oneId, serviceName: ONE.name, customer: { name: 'Megan Grant', email: '', phone: '' }, description: 'The back room' })
pa.signal = 'off'
pa.outbox.queue(d1.id, requestFor(oneId, 'Megan Grant', 'The back room'), [])
await pa.outbox.pump()
const waiting = pa.outbox.find(d1.id)
check('"Price this job" with no signal: the quote waits on the phone and says so', waiting?.send === 'queued' && waiting.problem?.kind === 'offline' && (await requestsWith(a.tenantId, d1.id)).length === 0, waiting?.problem)

pa.signal = 'answer-lost'
pa.outbox.retryNow()
await pa.outbox.pump()
const madeButUnheard = await requestsWith(a.tenantId, d1.id)
check('the request reaches the server but its answer is lost: the quote exists, and the phone still holds it as unsent', madeButUnheard.length === 1 && pa.outbox.find(d1.id)?.send === 'queued')

pa.signal = 'on'
const sent1 = await sendNow(pa, d1.id)
const afterRetry = await requestsWith(a.tenantId, d1.id)
check('back online it sends again with the same id: the same quote is answered, and there is still exactly one request', Boolean(sent1) && afterRetry.length === 1 && pa.posts === 2, { posts: pa.posts, requests: afterRetry.length })
check('…and it counted as one quote on the plan, not two', (await usedTotal(a.tenantId)) === usedAtStart + 1, { used: await usedTotal(a.tenantId) })
check(
  'the request was made by the app, for a customer with a name and no email address',
  afterRetry[0]?.customer_name === 'Megan Grant' && afterRetry[0]?.customer_email === null && (afterRetry[0]?.source_json as Row)?.type === 'app',
  { email: afterRetry[0]?.customer_email }
)
const q1 = sent1!.quoteId
const again = await pa.api.createQuote({ ...requestFor(oneId, 'Megan Grant', 'The back room'), clientRequestId: d1.id })
check('asked a third time, the server says it was already made and gives no new link', again.quoteId === q1 && again.alreadyCreated === true && again.quoteViewUrl === undefined)

const rivalSame = await pr.api.createQuote({ ...requestFor(rivalServiceId, 'Megan Grant'), clientRequestId: d1.id })
check('another business sending the very same id gets a quote of its own (the lookup never crosses businesses)', rivalSame.quoteId !== q1 && rivalSame.alreadyCreated !== true && (await requestsWith(rival.tenantId, d1.id)).length === 1)

const refusals = await Promise.all([
  pa.api.createQuote({ serviceId: oneId, customer: { name: '  ' } }).catch((e: ApiError) => e),
  pa.api.createQuote({ serviceId: oneId, customer: { name: 'Megan Grant', email: 'not-an-address' } }).catch((e: ApiError) => e),
  pa.api.createQuote({ serviceId: oneId, customer: { name: 'Megan Grant' }, clientRequestId: 'bad id!' }).catch((e: ApiError) => e),
  pa.api.createQuote({ serviceId: rivalServiceId, customer: { name: 'Megan Grant' } }).catch((e: ApiError) => e),
])
check(
  'refused with a plain reason, and never retried: no name, a broken email address, a malformed id, another business’s service',
  refusals.every((r) => r instanceof ApiError && r.status === 400 && !r.retryable),
  refusals.map((r) => (r instanceof ApiError ? `${r.status} ${r.message}` : 'made'))
)

// =====================================================================================
section('C. The price, as the app shows it')
// =====================================================================================
// (the phone has no link for the first quote: the answer that carried it was lost. It asks for one after approval.)
check('the phone holds no link for a quote whose answer was lost', pa.links.get(q1) === undefined)
const dC = pa.outbox.start()!
pa.outbox.update(dC.id, { serviceId: oneId, serviceName: ONE.name, customer: { name: 'Megan Grant', email: '', phone: '' }, description: 'The back room' })
pa.outbox.queue(dC.id, requestFor(oneId, 'Megan Grant', 'The back room'), [])
const sentC = await sendNow(pa, dC.id)
const qC = sentC!.quoteId
check('with a signal, "Price this job" sends at once and the phone keeps the customer’s link', Boolean(sentC) && sentC!.held === false && /[?&]token=/.test(pa.links.get(qC) ?? ''))
const v1 = await priced(pa.api, qC)
const expected1 = money(ONE.minimum * (1 + TAX))
check(`priced by the rules: $${ONE.price} raised to the $${ONE.minimum} minimum, plus 10% tax = $${expected1}`, v1.pricing.total === expected1, { status: v1.status, total: v1.pricing.total })
check('it waits for the business: a quote made on site is not sent by itself', v1.status === 'pending_review' && v1.held === false, v1.status)
check('the minimum charge is a note in the web’s words, never a line', priceLines(v1).length === 1 && priceLines(v1)[0]!.amount === ONE.price && !/minimum/i.test(JSON.stringify(priceLines(v1))) && minimumNote(v1.minimum, 'USD') === 'Minimum charge of $120.00 applied', { lines: priceLines(v1), minimum: v1.minimum })
check('the money rows: subtotal, tax by its own label, total', v1.totals?.subtotal === ONE.minimum && v1.totals.tax?.amount === money(ONE.minimum * TAX) && v1.totals.total === expected1, v1.totals)
const turn1 = turnOfQuote(v1)
check('status and next step are the dashboard’s words; the screen’s one action is "Approve & send"', turn1.label === QUOTE_TURN_COPY.labels.needsApproval && turn1.action === 'approve' && mainAction(v1) === 'send' && headlinePrice(v1) === '$132.00', { label: turn1.label })
check('what was sent travels with it: the note, and the customer with no email', v1.request?.description === 'The back room' && v1.customer?.email === null && v1.customer?.name === 'Megan Grant')

const firstLink = pa.links.get(qC)
const hidden = firstLink ? await publicView(qC, tokenOf(firstLink)) : null
check('until it is approved the customer’s link shows no price (so the app shares the link only after approving)', Boolean(hidden?.ok) && Number((hidden!.json?.pricing as Row | undefined)?.total ?? 0) === 0, { status: hidden?.status, total: (hidden?.json?.pricing as Row | undefined)?.total })
const linkTooEarly = await pa.api.quoteLink(qC).catch((e: ApiError) => e)
check('a link cannot be made for a quote that is not approved yet', linkTooEarly instanceof ApiError && linkTooEarly.status === 400)

const approved = await pa.api.approveQuote(qC)
const v1sent = await pa.api.getQuote(qC)
check('"Approve & send": sent, and no email goes because there is no address', approved.status === 'sent' && approved.emailed === false && v1sent.status === 'sent' && mainAction(v1sent) === 'share')
const shown = firstLink ? await publicView(qC, tokenOf(firstLink)) : null
check('the link the phone kept now shows the customer the price', Number((shown?.json?.pricing as Row | undefined)?.total) === expected1, { total: (shown?.json?.pricing as Row | undefined)?.total })
const fresh = await pa.api.quoteLink(qC)
const viaFresh = await publicView(qC, tokenOf(fresh.quoteViewUrl))
const viaFirst = firstLink ? await publicView(qC, tokenOf(firstLink)) : null
check('a phone that did not make the quote gets a new link, and the earlier link keeps working', Number((viaFresh.json?.pricing as Row | undefined)?.total) === expected1 && Number((viaFirst?.json?.pricing as Row | undefined)?.total) === expected1)
const list = await pa.api.listQuotes('all')
const row1 = list.items.find((i) => i.quoteId === qC)
check('in the list it reads "Waiting for customer", not a raw status', Boolean(row1) && turnOfListItem(row1!).label === QUOTE_TURN_COPY.labels.waiting, row1 && turnOfListItem(row1).label)

// =====================================================================================
section('D. The service’s own questions, typed as the server prices them')
// =====================================================================================
const raw = { unit_count: '3', easy_access: false, extras_wanted: ['First', 'Third'] }
check('nothing required is missing', missingRequired(fieldsTwo, raw).length === 0)
const d2 = pa.outbox.start()!
pa.outbox.update(d2.id, { serviceId: twoId, serviceName: TWO.name, customer: { name: 'Dana Whitfield', email: '', phone: '' } })
pa.outbox.queue(d2.id, { serviceId: twoId, customer: { name: 'Dana Whitfield' }, job: { answers: toSubmissionAnswers(fieldsTwo, raw, '') } }, [])
const sent2 = await sendNow(pa, d2.id)
const stored2 = (await requestsWith(a.tenantId, d2.id))[0]?.job_answers as Array<{ fieldId: string; value: unknown }> | undefined
const answer = (id: string) => stored2?.find((x) => x.fieldId === id)?.value
check('a number is sent as a number, "No" as false, tick boxes as a list', answer('unit_count') === 3 && answer('easy_access') === false && JSON.stringify(answer('extras_wanted')) === JSON.stringify(['First', 'Third']), stored2)
const v2 = sent2 ? await priced(pa.api, sent2.quoteId) : null
const expected2 = money(3 * TWO.unit * (1 + TAX))
check(`priced from the answer: 3 × $${TWO.unit} plus tax = $${expected2}`, v2?.pricing.total === expected2 && v2.status === 'pending_review', { status: v2?.status, total: v2?.pricing.total })
check('the request shows each answer under the business’s own question', JSON.stringify(v2?.request?.answers.map((x) => [x.label, x.value])) === JSON.stringify([['How many units?', '3'], ['Is access easy?', 'No'], ['Which extras?', 'First, Third']]), v2?.request?.answers)

const d3 = pa.outbox.start()!
pa.outbox.queue(d3.id, { serviceId: twoId, customer: { name: 'Dana Whitfield' }, job: { answers: [] } }, [])
await sendNow(pa, d3.id)
const back = pa.outbox.find(d3.id)
check('a required answer left out: the server refuses, and the quote comes back to be put right with the server’s own words', back?.send === 'editing' && back.problem?.kind === 'refused' && /How many units\?/.test(back.problem.message), back?.problem)
pa.outbox.discard(d3.id)

// =====================================================================================
section('E. A combined quote: one total, sections, one quote')
// =====================================================================================
const usedBeforeSection = await usedTotal(a.tenantId)
const pricedSection = await call('POST', `${app}/api/quotes/${qC}/sections/price`, { headers: a.cookie, body: { serviceId: twoId, answers: [{ fieldId: 'unit_count', value: 2 }] } })
const detail = await call('GET', `${app}/api/quotes/${qC}`, { headers: a.cookie })
const saved = await call('PATCH', `${app}/api/quotes/${qC}`, {
  headers: a.cookie,
  body: { version: detail.json?.quote?.version, pricing_json: { ...(detail.json?.quote?.pricing_json as Row), sections: [pricedSection.json?.section] }, content_json: { scopeSummary: (detail.json?.quote?.content_json as Row | undefined)?.scopeSummary }, sendToCustomer: false },
})
const v1combined = await pa.api.getQuote(qC)
const combinedTotal = money((ONE.minimum + 2 * TWO.unit) * (1 + TAX))
check('the business adds Service Two to the quote in the dashboard', pricedSection.status === 200 && saved.status === 200, { price: pricedSection.status, save: saved.status, error: saved.json?.error })
check(`the app shows one total for everything ($${combinedTotal}) and names both services`, v1combined.pricing.total === combinedTotal && v1combined.serviceName === `${ONE.name} + ${TWO.name}` && v1combined.mainServiceName === ONE.name, { total: v1combined.pricing.total, name: v1combined.serviceName })
const sec = v1combined.sections?.[0]
check('the added service is a section with its own lines and subtotal, marked as added by the business', v1combined.sections?.length === 1 && sec?.serviceName === TWO.name && sec.subtotal === 2 * TWO.unit && sec.addedBy === 'business' && sec.lines.length >= 1, sec)
check('the main service keeps its own line, its minimum note and its subtotal; the section’s lines are not mixed into it', priceLines(v1combined).length === 1 && v1combined.minimum?.minimumCharge === ONE.minimum && v1combined.mainSubtotal === ONE.minimum, { lines: priceLines(v1combined).length, mainSubtotal: v1combined.mainSubtotal })
check('it is still one quote on the plan', (await usedTotal(a.tenantId)) === usedBeforeSection)

// =====================================================================================
section('F. The plan limit: saved, not priced; the limit stands until there is a plan')
// =====================================================================================
// The ten free quotes are used up (the count is the server's; the check sets it as verify-t180 does)
const period = `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`
await patch('usage_counters', `tenant_id=eq.${a.tenantId}&period_yyyymm=eq.${period}`, { estimates_created: 10 })

// T-199: with the free quotes used and no plan, the business no longer has on-site quotes. The app is open to it
// (its quotes, its account), but a new quote is not started: the app is told so, and the server refuses in the
// same words, so an older build cannot get round it. Nothing is saved and nothing is counted.
const requestsBefore = ((await sb.select('quote_requests', `tenant_id=eq.${a.tenantId}&select=id`)) as Row[]).length
const bootUsedUp = await pa.api.bootstrap()
const refusedOnsite = await call('POST', `${app}/api/app/quotes`, { headers: { Authorization: `Bearer ${a.accessToken}` }, body: { ...requestFor(oneId, 'Jordan Reyes', 'Front step'), assetIds: [] } })
check('T-199: free quotes used, no plan: the app is told on-site quotes are not included, with the screen\'s words and no price or link in them', bootUsedUp.onsiteQuotes === false && /^On-site quotes are part of \w+$/.test(bootUsedUp.onsiteNotInPlan?.heading ?? '') && bootUsedUp.onsiteNotInPlan?.button === 'OK' && !/[$£€]|https?:|upgrade|buy/i.test(JSON.stringify(bootUsedUp.onsiteNotInPlan)), bootUsedUp.onsiteNotInPlan)
check('T-199: …and the server refuses a new on-site quote in the same words: 403, nothing saved, nothing counted', refusedOnsite.status === 403 && refusedOnsite.json?.error?.code === 'ONSITE_QUOTES_NOT_IN_PLAN' && String(refusedOnsite.json?.error?.message).startsWith(bootUsedUp.onsiteNotInPlan?.heading ?? 'x') && ((await sb.select('quote_requests', `tenant_id=eq.${a.tenantId}&select=id`)) as Row[]).length === requestsBefore && (await usedTotal(a.tenantId)) === 10, refusedOnsite.json)
check('T-199: …while the rest of the app still answers (its quotes and its account)', (await pa.api.listQuotes()).items.length > 0 && Boolean((await pa.api.account()).businessName))

// The plan limit itself is shown on a plan that includes on-site quotes, with that plan's quotes for the month used
// (a plan row with no Stripe customer, as a free test account has)
const ONSITE_PLAN = getPlan('plan_us_pro')!
await sb.insert('subscriptions', { tenant_id: a.tenantId, plan_id: ONSITE_PLAN.id, status: 'active', current_period_start: new Date().toISOString() })
await patch('usage_counters', `tenant_id=eq.${a.tenantId}&period_yyyymm=eq.${period}`, { estimates_created: ONSITE_PLAN.quoteLimit })
const bootOnPlan = await pa.api.bootstrap()
check('T-199: on a plan that includes them, the app is told on-site quotes are on', bootOnPlan.onsiteQuotes === true)
const usedAtLimit = await usedTotal(a.tenantId)

// a photo, sent as the phone sends it: its real size first, then the file to the signed address
const photosDir = path.join(ROOT, 'apps/web/public/photos')
const picture = readdirSync(photosDir).map((n) => path.join(photosDir, n)).find((p) => /\.(webp|jpe?g|png|avif)$/i.test(p) && statSync(p).size > 2000)!
const jpg = path.join(outDir, 'site-photo.jpg')
execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '640', picture, '--out', jpg], { stdio: 'pipe' })
const d4 = pa.outbox.start()!
pa.outbox.update(d4.id, { serviceId: oneId, serviceName: ONE.name, customer: { name: 'Jordan Reyes', email: '', phone: '' } })
pa.outbox.addPhoto(d4.id, { uri: jpg, fileName: 'site-photo.jpg', contentType: 'image/jpeg', sizeBytes: statSync(jpg).size, angleId: null })
await pa.outbox.pump()
const up = pa.outbox.find(d4.id)?.photos[0]
check('a photo uploads in the background while the quote is still being written (the signed address takes its exact size)', up?.state === 'done' && Boolean(up.assetId) && pa.outbox.find(d4.id)?.send === 'editing', { state: up?.state, error: up?.error })
pa.outbox.queue(d4.id, { ...requestFor(oneId, 'Jordan Reyes', 'Front step'), customer: { name: 'Jordan Reyes', phone: '+14155550142' } }, [up?.id ?? ''])
const sent4 = await sendNow(pa, d4.id)
check('at the limit the request is saved, not lost, and the app is told it is held', sent4?.held === true, sent4)
const v4 = sent4 ? await pa.api.getQuote(sent4.quoteId) : null
const turn4 = v4 ? turnOfQuote(v4) : null
check('the app shows no figure at all (never 0.00) and says "Saved, not priced yet"', Boolean(v4) && v4!.held === true && headlinePrice(v4!) === null && turn4?.label === QUOTE_TURN_COPY.labels.held && mainAction(v4!) === 'price_request', { label: turn4?.label, headline: v4 && headlinePrice(v4) })
check('a held request did not use a quote', (await usedTotal(a.tenantId)) === usedAtLimit)
const photoUrl = v4?.photos?.[0]?.url
const photoGet = photoUrl ? await fetch(photoUrl) : null
check('its photo comes as a signed address that opens with no sign-in header, and is the photo that was sent', v4?.photos?.length === 1 && v4.photos[0]!.id === up?.assetId && photoGet?.status === 200 && /^image\//.test(photoGet.headers.get('content-type') ?? ''), { photos: v4?.photos?.length, status: photoGet?.status })
check('the photo’s address is a storage address made for the moment, never a path that would need the business’s sign-in', Boolean(photoUrl) && /^https:\/\//.test(photoUrl!) && !photoUrl!.includes('/api/quotes/') && /[?&]X-Amz-Signature=/.test(photoUrl!))
const stillLimited = await pa.api.priceHeldRequest(sent4!.quoteId).catch((e: ApiError) => e)
check('"Price this request" while the limit stands: refused with 402 and the server’s reason. The app does not get round the limit.', stillLimited instanceof ApiError && stillLimited.status === 402 && stillLimited.code === 'PLAN_LIMIT_REACHED' && !stillLimited.retryable, stillLimited instanceof ApiError ? stillLimited.message : 'priced')

// =====================================================================================
section('G. A paused account')
// =====================================================================================
const platformAdmin = await business('Platform Admin')
await patch('user_profiles', `id=eq.${platformAdmin.userId}`, { role: 'admin' })
const suspendUrl = `${app}/api/admin/tenants/${a.tenantId}/suspend`
expectOk('suspend', await call('POST', suspendUrl, { headers: platformAdmin.cookie, body: { suspended: true, reason: 'verify-t182 check' } }))
const notice = await pa.api.accountNotice()
check('the app shows the same account line the dashboard shows, and never the admin’s reason', notice?.kind === 'suspended' && /paused/i.test(notice.line) && !JSON.stringify(notice).includes('verify-t182'), notice?.line)
// the plan row is already there (section F); the month's count goes back under the plan's limit, so only the pause is in the way
await patch('usage_counters', `tenant_id=eq.${a.tenantId}&period_yyyymm=eq.${period}`, { estimates_created: 10 })
const paused = await pa.api.priceHeldRequest(sent4!.quoteId).catch((e: ApiError) => e)
check('"Price this request" on a paused account: refused with 403 (the pause stands)', paused instanceof ApiError && paused.status === 403 && paused.code === 'ACCOUNT_PAUSED', paused instanceof ApiError ? paused.message : 'priced')
const d5 = pa.outbox.start()!
pa.outbox.queue(d5.id, requestFor(oneId, 'Sam Carter'), [])
const sent5 = await sendNow(pa, d5.id)
check('a new on-site quote while paused is saved, not priced', sent5?.held === true)
expectOk('restore', await call('POST', suspendUrl, { headers: platformAdmin.cookie, body: { suspended: false } }))
check('restored: the account line goes', (await pa.api.accountNotice()) === null)

const nowPriced = await pa.api.priceHeldRequest(sent4!.quoteId).catch((e: ApiError) => e)
const v4priced = await priced(pa.api, sent4!.quoteId)
check(`a free test account with no pause: "Price this request" prices it like any plan: $${expected1}`, !(nowPriced instanceof ApiError) && v4priced.pricing.total === expected1 && v4priced.held === false, { status: v4priced.status, total: v4priced.pricing.total })

// =====================================================================================
section('H. A request that could not be priced')
// =====================================================================================
// The held request from the pause is marked failed, as the worker marks one it cannot price
await patch('quotes', `id=eq.${sent5!.quoteId}`, { status: 'failed', content_json: { error: 'verify-t182 internal reason', failedAt: new Date().toISOString() } })
const v5 = await pa.api.getQuote(sent5!.quoteId)
const turn5 = turnOfQuote(v5)
check('the app says "Could not be priced" and what to do, with no figure', turn5.label === QUOTE_TURN_COPY.labels.failed && /Contact Sam/.test(turn5.sentence) && headlinePrice(v5) === null && mainAction(v5) === 'contact', { label: turn5.label })
check('the platform’s internal reason is not shown to the business', !JSON.stringify(v5).includes('internal reason'))
await patch('quotes', `id=eq.${sent4!.quoteId}`, { status: 'failed' })
const v4failed = await pa.api.getQuote(sent4!.quoteId)
check('a failed request still shows what was sent: the note, how to reach the customer, and the photo', v4failed.request?.description === 'Front step' && v4failed.customer?.phone === '+14155550142' && v4failed.photos?.length === 1, { photos: v4failed.photos?.length, phone: v4failed.customer?.phone })
const failedRow = (await pa.api.listQuotes('needs_you')).items.find((i) => i.quoteId === sent4!.quoteId)
check('it is under "Needs you" in the list', Boolean(failedRow) && turnOfListItem(failedRow!).label === QUOTE_TURN_COPY.labels.failed)

// =====================================================================================
section('I. Another business is locked out')
// =====================================================================================
const locked = await Promise.all([
  pr.api.getQuote(qC).catch((e: ApiError) => e),
  pr.api.quoteLink(qC).catch((e: ApiError) => e),
  pr.api.approveQuote(sent2!.quoteId).catch((e: ApiError) => e),
  pr.api.priceHeldRequest(sent5!.quoteId).catch((e: ApiError) => e),
  pr.api.answerQuestions(q1, [{ questionId: 'c1', answer: 'x' }]).catch((e: ApiError) => e),
])
check('another business cannot read, link, approve, price or answer this business’s quotes (404 each)', locked.every((r) => r instanceof ApiError && r.status === 404), locked.map((r) => (r instanceof ApiError ? r.status : 'allowed')))
check('…and its own list holds none of them', !(await pr.api.listQuotes('all')).items.some((i) => [q1, qC, sent2!.quoteId, sent4!.quoteId, sent5!.quoteId].includes(i.quoteId)))
const serviceKeyBearer = await call('GET', `${app}/api/app/quotes/${q1}`, { headers: { Authorization: `Bearer ${cfg.serviceKey}` } })
check('a server key sent as the bearer is refused: only a signed-in person’s token is a sign-in', serviceKeyBearer.status === 401)

finish()
