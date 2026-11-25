// T-203: a load test. Sends N quote requests at the same moment through the public route, spread
// across enough test businesses that none gets more than 15, and reports how they were priced.
//
//   npx tsx scripts/load-test/run.mts --url http://localhost:3000 [--n 25] [--keep]
//
// It never runs against production: the web address and the Supabase address are checked before
// anything is created, the target's own pages are read for production's database, and there is no
// flag that turns the refusal off (lib.mts, productionRefusal).
//
// The environment's database is needed to make the test businesses and to read the stored timings:
//   this machine      taken from apps/web/.env.local, as the checks do
//   anywhere else     LOAD_SUPABASE_URL, LOAD_SUPABASE_ANON_KEY, LOAD_SUPABASE_SERVICE_KEY
//
// The mix: about half text only, about half with photos from test-assets, of which a few are on a
// service priced from a measurement of the photos. Every request is a real customer request (not a
// "test estimate"), so the test businesses get a plan row when they are sent more than the free
// allowance. Customer and owner addresses are Postmark's sink address, which accepts mail and drops
// it: where the environment has an email provider, nothing bounces and nobody is written to.
//
// Without --keep the businesses made by the run are deleted at the end (their requests with them).
// The report is printed and written to scripts/load-test/results/ (git-ignored).
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, shortId, collectAssets, uploadAssets, runStamp } from '../hardcore-test/lib.mjs'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'
import { freeAllowance } from '../../packages/shared/src/plans'
import {
  parseArgs, appRefusal, productionRefusal, namesProduction, isLocalHost, planRun, summarise, reportText, outcomeOf,
  WAITING_STATUSES, KIND_WORDS, type Kind, type PlannedRequest, type RequestResult,
} from './lib.mjs'

type Row = Record<string, unknown>

const POLL_MS = 2_000
const CAP_MINUTES = 20
/** Postmark's sink: mail to it is accepted and dropped (no bounce, no reader) */
const MAIL_SINK = 'blackhole.postmarkapp.com'

function stop(message: string, code = 2): never {
  console.error(message)
  process.exit(code)
}

// ---------------------------------------------------------------------------
// Where it runs. Everything in this block happens before anything is created.
// ---------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2))
if ('error' in args) stop(`${args.error}\nUsage: npx tsx scripts/load-test/run.mts --url <web app address> [--n 25] [--keep]`)

const REFUSED = 'This script never runs against production, and there is no way to make it.'
const early = appRefusal(args.url)
if (early) stop(`Refused: ${early}. ${REFUSED}`)

const local = isLocalHost(args.url)
const fromEnv = { supabaseUrl: process.env.LOAD_SUPABASE_URL, anonKey: process.env.LOAD_SUPABASE_ANON_KEY, serviceKey: process.env.LOAD_SUPABASE_SERVICE_KEY }
let cfg: { appUrl: string; supabaseUrl: string; anonKey: string; serviceKey: string }
if (fromEnv.supabaseUrl || fromEnv.anonKey || fromEnv.serviceKey) {
  if (!fromEnv.supabaseUrl || !fromEnv.anonKey || !fromEnv.serviceKey) stop('Set all three: LOAD_SUPABASE_URL, LOAD_SUPABASE_ANON_KEY, LOAD_SUPABASE_SERVICE_KEY.')
  cfg = { appUrl: args.url, supabaseUrl: fromEnv.supabaseUrl.replace(/\/+$/, ''), anonKey: fromEnv.anonKey, serviceKey: fromEnv.serviceKey }
} else if (local) {
  // the local stack's own values, as the checks read them
  const own = loadEnv()
  cfg = { appUrl: args.url, supabaseUrl: own.supabaseUrl, anonKey: own.anonKey, serviceKey: own.serviceKey }
} else {
  stop('For an environment that is not this machine, set LOAD_SUPABASE_URL, LOAD_SUPABASE_ANON_KEY and LOAD_SUPABASE_SERVICE_KEY (that environment’s own).')
}

const refusal = productionRefusal(cfg.appUrl, cfg.supabaseUrl)
if (refusal) stop(`Refused: ${refusal}. ${REFUSED}`)

/** The target's own build says which database it uses: read its sign-in page and the scripts it loads */
async function targetNamesProduction(): Promise<boolean> {
  const page = await http('GET', `${cfg.appUrl}/login`, { timeoutMs: 60_000 })
  if (namesProduction(page.text)) return true
  const scripts = [...page.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!).slice(0, 60)
  for (const src of scripts) {
    const address = new URL(src, cfg.appUrl)
    if (address.host !== new URL(cfg.appUrl).host) continue
    const script = await http('GET', address.toString(), { timeoutMs: 60_000 }).catch(() => null)
    if (script && namesProduction(script.text)) return true
  }
  return false
}
try {
  if (await targetNamesProduction()) stop('Refused: the web app at that address is built for production’s database. This script never runs against production.')
} catch (error) {
  void error
  stop(`The web app at ${cfg.appUrl} did not answer. Start it first; nothing was created.`, 1)
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
const sb = makeSupabase(cfg)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const runId = shortId()
const plan = planRun(args.n)
const outDir = path.join(ROOT, 'scripts/load-test/results', `${runStamp()}-n${args.n}-${runId}`)
mkdirSync(outDir, { recursive: true })

console.log(`Load test ${runId}: ${args.n} requests to ${cfg.appUrl}, ${plan.businesses} test business${plan.businesses === 1 ? '' : 'es'}`)

interface Business {
  tenantId: string
  userId: string
  tenantKey: string
  cookie: { Cookie: string }
  textServiceId: string
  measured?: { serviceId: string; answers: Array<{ fieldId: string; value: unknown }> }
}

/** Priced from the form alone: no photo is needed, and a photo sent with it is still read */
const PAINT_STEPS = [
  { id: 'walls', name: 'Exterior walls', description: 'Prepare and paint the exterior walls', costType: 'per_unit', defaultCost: 18, optional: false, unitLabel: 'sq ft', quantitySource: { type: 'form_field', fieldId: 'wall_area' } },
  { id: 'trim', name: 'Trim and sills', description: 'Paint the trim and window sills', costType: 'per_unit', defaultCost: 7.35, optional: false, unitLabel: 'ft', quantitySource: { type: 'form_field', fieldId: 'trim_length' } },
]

async function makeBusiness(number: number, requests: PlannedRequest[]): Promise<Business> {
  const id = shortId()
  // the run id is in the name, so everything a run made can be found (and removed) by it
  const name = `Loadtest ${runId} Painters ${number + 1}`
  const email = `loadtest-${runId}-${id}@${MAIL_SINK}`
  const password = `Loadtest-${id}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok && setup.json?.tenantId ? setup.json.tenantId : ((await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`)) as Row[])[0]?.tenant_id) as string
  if (!tenantId) throw new Error('the test business could not be set up')
  expectOk('business settings', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: new URL(cfg.appUrl).hostname, tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const tenantKey = site.tenant_key as string

  // more than the free allowance: a plan row, with no Stripe customer (never billed), big enough for the run
  if (requests.length > freeAllowance('US').quotes) {
    const plans = (await sb.select('plans', `is_active=eq.true&monthly_estimate_limit=gte.${requests.length}&select=id,monthly_estimate_limit&order=monthly_estimate_limit.asc&limit=1`)) as Row[]
    if (!plans[0]) throw new Error(`no plan allows ${requests.length} requests`)
    await sb.insert('subscriptions', { tenant_id: tenantId, plan_id: plans[0].id, status: 'active' })
  }

  const text = expectOk('text service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: cookie,
    body: {
      name: 'Exterior wall painting', description: 'Painting of exterior walls, trim and sills, priced by measured area.', documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['Preparation and two coats on exterior walls', 'Trim and window sills'], scopeExcludes: ['Roofline replacement'], defaultAssumptions: ['Walls are sound and accessible from the ground'],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: 'A photo of each wall', requiredAngles: [] },
      workSteps: PAINT_STEPS, expectedSignals: [],
      suggestedFields: [
        { fieldId: 'wall_area', label: 'Wall area (square feet)', type: 'number', required: true, criticalForPricing: true },
        { fieldId: 'trim_length', label: 'Trim length (feet)', type: 'number', required: true, criticalForPricing: true },
      ],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: PAINT_STEPS },
    },
  }))
  const business: Business = { tenantId, userId: user.id as string, tenantKey, cookie, textServiceId: text.service.id as string }

  if (requests.some((r) => r.kind === 'measured')) {
    // the painting pack's exterior service, made as setup makes it: its wall area is measured from the photos
    const def = paintingPackUS.services.find((s) => /exterior/i.test(s.name))
    if (!def) throw new Error('the painting pack has no exterior service')
    const d = def.draft
    const made = expectOk('measured service', await http('POST', `${cfg.appUrl}/api/services`, {
      headers: cookie,
      body: {
        name: def.name, description: def.description, documentTypeDefault: 'instant_estimate',
        scopeIncludes: d.scope.included, scopeExcludes: d.scope.excluded, defaultAssumptions: d.scope.assumptions,
        mediaConfig: { minPhotos: 1, maxPhotos: d.media.maxPhotos, photoGuidance: d.media.photoGuidance, requiredAngles: [] },
        workSteps: d.pricing.workSteps, expectedSignals: d.expectedSignals,
        pricingRules: { baseFee: d.pricing.baseFee, minimumCharge: d.pricing.minimumCharge, addons: def.addons || [], multipliers: def.multipliers || [], workSteps: d.pricing.workSteps },
        draftConfig: d,
      },
    }))
    const serviceId = made.service.id as string
    const widget = expectOk('form settings', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${tenantKey}`))
    const fields = [...(widget.globalFields || []), ...((widget.serviceFields || {})[serviceId] || [])] as Array<{ fieldId: string; type?: string; required?: boolean; options?: Array<{ value?: string; label?: string } | string> }>
    const optionValue = (o: { value?: string; label?: string } | string) => (typeof o === 'string' ? o : (o.value ?? o.label ?? ''))
    const answers: Array<{ fieldId: string; value: unknown }> = [
      { fieldId: '_project_description', value: 'Please repaint the front of our two-story house. The paint is peeling in places. Front wall only.' },
    ]
    for (const f of fields) {
      if (f.fieldId.startsWith('_')) continue
      if (f.fieldId === 'stories') answers.push({ fieldId: f.fieldId, value: 2 })
      else if (f.options?.length && /side/i.test(f.fieldId)) {
        const front = f.options.find((o) => /front/i.test(typeof o === 'string' ? o : `${o.value ?? ''} ${o.label ?? ''}`))
        answers.push({ fieldId: f.fieldId, value: optionValue(front ?? f.options[0]!) })
      } else if (f.required) {
        if (f.type === 'number') answers.push({ fieldId: f.fieldId, value: 2 })
        else if (f.options?.length) answers.push({ fieldId: f.fieldId, value: optionValue(f.options[0]!) })
        else answers.push({ fieldId: f.fieldId, value: 'Front wall only' })
      }
    }
    business.measured = { serviceId, answers }
  }
  return business
}

/** Remove what the run made: the business's requests, the business (its services, site, plan row and files' rows go with it), its sign-in */
async function removeBusiness(business: { tenantId: string; userId: string }): Promise<boolean> {
  const gone = async (table: string, query: string) => (await http('DELETE', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: admin })).ok
  const quotes = await gone('quotes', `tenant_id=eq.${business.tenantId}`)
  const requests = await gone('quote_requests', `tenant_id=eq.${business.tenantId}`)
  const tenant = await gone('tenants', `id=eq.${business.tenantId}`)
  const user = (await http('DELETE', `${cfg.supabaseUrl}/auth/v1/admin/users/${business.userId}`, { headers: admin })).ok
  return quotes && requests && tenant && user
}

/** Photos for the "with photos" requests: house fronts and roofs from the test set, two a request */
const PHOTO_SETS = ['test-assets/hardcore/S01-painting', 'test-assets/hardcore/S02-roofing', 'test-assets/hardcore/S08-window-cleaning']
const scratch = path.join(outDir, '.scratch')
const photoFiles = PHOTO_SETS.flatMap((dir) => collectAssets(dir, scratch).files.filter((f: { contentType: string }) => f.contentType.startsWith('image/')))
const measuredFiles = collectAssets('test-assets/hardcore/S01-painting', scratch).files.filter((f: { contentType: string }) => f.contentType.startsWith('image/'))

const businesses: Business[] = []
let exitCode = 0
try {
  if (plan.requests.some((r) => r.kind !== 'text') && (photoFiles.length === 0 || measuredFiles.length === 0)) {
    throw new Error('no photos found under test-assets/hardcore (the folder is not in the repository; it is on the owner’s machine)')
  }

  // 1. The businesses, their services, and the photos (uploaded the way the form does), all before the burst
  for (let b = 0; b < plan.businesses; b++) {
    businesses.push(await makeBusiness(b, plan.requests.filter((r) => r.business === b)))
    console.log(`  business ${b + 1} ready (${plan.requests.filter((r) => r.business === b).length} requests)`)
  }
  const prepared: Array<{ request: PlannedRequest; body: Row; customerName: string }> = []
  let uploadErrors = 0
  for (const request of plan.requests) {
    const business = businesses[request.business]!
    const customerName = `Loadtest ${runId} Customer ${String(request.index + 1).padStart(3, '0')}`
    let assetIds: string[] = []
    if (request.kind !== 'text') {
      const files = request.kind === 'measured' ? measuredFiles.slice(0, 2) : [photoFiles[request.index % photoFiles.length]!, photoFiles[(request.index + 1) % photoFiles.length]!]
      const up = await uploadAssets(cfg, business.tenantKey, files)
      assetIds = up.assetIds
      uploadErrors += up.errors.length
    }
    const answers = request.kind === 'measured'
      ? business.measured!.answers
      : [
          { fieldId: '_project_description', value: request.kind === 'photos' ? 'Paint the outside walls and the trim. Photos of the house are attached.' : 'Paint the outside walls and the trim' },
          { fieldId: 'wall_area', value: 30 + (request.index % 40) },
          { fieldId: 'trim_length', value: 12 + (request.index % 25) },
        ]
    prepared.push({
      request,
      customerName,
      body: {
        tenantKey: business.tenantKey,
        serviceId: request.kind === 'measured' ? business.measured!.serviceId : business.textServiceId,
        customer: { name: customerName, email: `loadtest-${runId}-${request.index + 1}@${MAIL_SINK}`, phone: `(555) 203-${String(1000 + request.index).slice(-4)}` },
        job: { postcodeOrZip: '63021', answers },
        ...(assetIds.length > 0 && { assetIds }),
        source: { type: 'widget' },
      },
    })
  }
  if (uploadErrors > 0) console.log(`  ${uploadErrors} photo upload(s) were refused; those requests go without that photo`)

  // 2. The burst: every request leaves at the same moment. The checks of the database run beside
  //    it, because a web app that prices directly answers a request only once it is priced.
  const results: RequestResult[] = prepared.map(({ request }) => ({
    index: request.index, kind: request.kind, business: request.business, quoteId: null, httpStatus: 0, postMs: null, status: null, total: null,
    sendToDoneMs: null, totalMs: null, queueWaitMs: null, busyRetries: 0, overflowCalls: 0, busyRequeues: 0, aiCalls: 0, aiCostUsd: 0, unpricedModels: [], byTask: {},
  }))
  const byName = new Map(prepared.map((p, i) => [p.customerName, i]))
  const tenantList = businesses.map((b) => b.tenantId).join(',')
  const startedAt = Date.now()
  const deadline = startedAt + CAP_MINUTES * 60_000
  let answered = 0

  const posts = Promise.all(prepared.map(async ({ body }, i) => {
    const sentAt = Date.now()
    const res = await http('POST', `${cfg.appUrl}/api/public/quotes`, { body, timeoutMs: CAP_MINUTES * 60_000 }).catch(() => null)
    const result = results[i]!
    result.postMs = Date.now() - sentAt
    result.httpStatus = res?.status ?? 0
    if (res?.ok && res.json?.quoteId) result.quoteId = res.json.quoteId as string
    else result.refusedCode = (res?.json?.error?.code as string | undefined) ?? undefined
    answered++
  }))

  console.log(`  ${prepared.length} requests sent`)
  let lastSaid = 0
  for (;;) {
    const seen = (await sb.select('quotes', `tenant_id=in.(${tenantList})&select=id,status,name:customer_json->>name,total:pricing_json->total&limit=2000`).catch(() => [])) as Row[]
    const now = Date.now()
    for (const row of seen) {
      const i = byName.get(String(row.name))
      if (i === undefined) continue
      const result = results[i]!
      result.quoteId = result.quoteId ?? (row.id as string)
      result.status = row.status as string
      result.total = typeof row.total === 'number' ? row.total : null
      if (result.sendToDoneMs === null && !WAITING_STATUSES.includes(result.status)) result.sendToDoneMs = now - startedAt
    }
    // finished: seen priced or failed in the database, or the endpoint answered without taking it in
    const open = results.filter((r) => r.sendToDoneMs === null && !(r.postMs !== null && r.quoteId === null)).length
    const done = results.filter((r) => r.sendToDoneMs !== null).length
    if (now - lastSaid > 20_000) {
      console.log(`  ${Math.round((now - startedAt) / 1000)} s: ${done} finished, ${results.filter((r) => r.status !== null).length - done} being priced, ${answered} answered by the endpoint`)
      lastSaid = now
    }
    if (open === 0 || now > deadline) break
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  // a web app that prices directly may still be writing its answers; one that never answers is not waited for
  await Promise.race([posts, new Promise((resolve) => setTimeout(resolve, 15_000))])

  // 3. What the worker stored about each request
  const rows = (await sb.select('quotes', `tenant_id=in.(${tenantList})&select=id,status,name:customer_json->>name,total:pricing_json->total,timings:pricing_trace_json->timings,aiUsage:pricing_trace_json->aiUsage&limit=2000`)) as Row[]
  const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  for (const row of rows) {
    const i = byName.get(String(row.name))
    if (i === undefined) continue
    const result = results[i]!
    const timings = (row.timings ?? {}) as Row
    const usage = (row.aiUsage ?? {}) as { calls?: number; estimatedCostUsd?: number; unpricedModels?: string[]; byTask?: Array<{ task?: string; calls?: number }> }
    result.quoteId = row.id as string
    result.status = row.status as string
    result.total = number(row.total)
    result.totalMs = number(timings.totalMs)
    result.queueWaitMs = number(timings.queueWaitMs)
    result.busyRetries = number(timings.busyRetries) ?? 0
    result.overflowCalls = number(timings.overflowCalls) ?? 0
    result.busyRequeues = number(timings.busyRequeues) ?? 0
    result.aiCalls = number(usage.calls) ?? 0
    result.aiCostUsd = number(usage.estimatedCostUsd) ?? 0
    result.unpricedModels = Array.isArray(usage.unpricedModels) ? usage.unpricedModels : []
    result.byTask = {}
    for (const t of usage.byTask ?? []) if (t.task) result.byTask[t.task] = (result.byTask[t.task] ?? 0) + (number(t.calls) ?? 0)
  }

  // 4. The report
  const report = summarise(results)
  const pricedDirectly = results.every((r) => r.queueWaitMs === null)
  const text = reportText(report, { target: cfg.appUrl, businesses: plan.businesses, pricedDirectly, capMinutes: CAP_MINUTES })
  console.log(`\n${text}\n`)
  writeFileSync(path.join(outDir, 'report.txt'), `${text}\n`)
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ runId, target: cfg.appUrl, n: args.n, businesses: plan.businesses, startedAt: new Date(startedAt).toISOString(), report, requests: results.map((r) => ({ ...r, outcome: outcomeOf(r.status, r.total), kindWords: KIND_WORDS[r.kind as Kind] })) }, null, 2))
  console.log(`Report written to ${outDir}`)
  if (report.priced < report.sent) exitCode = 1
} catch (error) {
  console.error(`The run stopped: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`)
  exitCode = 1
} finally {
  if (args.keep) {
    console.log(`Kept ${businesses.length} test business(es) (their names start "Loadtest ${runId}").`)
  } else {
    let removed = 0
    for (const business of businesses) if (await removeBusiness(business).catch(() => false)) removed++
    console.log(`Removed ${removed} of ${businesses.length} test business(es) and their requests.${removed < businesses.length ? ` Look for names starting "Loadtest ${runId}".` : ''}`)
  }
}
process.exit(exitCode)
