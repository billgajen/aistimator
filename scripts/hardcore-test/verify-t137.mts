// T-137 live check: the business app's API, driven exactly as the Expo app
// drives it (apps/mobile/src/lib/api.ts), with a real Supabase sign-in and a
// bearer token — no cookies. Local stack.
// Run: npx tsx scripts/hardcore-test/verify-t137.mts
//
// 1. bearer auth works on an existing dashboard API (GET /api/quotes) and on
//    the new /api/app/* routes; a service-role key as bearer is refused
// 2. on-site quote: EV charger pack + panel-label photo → priced, Grade B,
//    confirmation question → business confirms in the app → Grade A
// 3. tenant isolation: another business's token can't read or answer it
import path from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, shortId, collectAssets, saveJson, runStamp } from './lib.mjs'
import { electricalPackUS } from '../../apps/web/src/lib/vertical-packs/electrical-us'
import { createApi } from '../../apps/mobile/src/lib/api'
import { fieldsForService } from '../../apps/mobile/src/lib/api'
import { toSubmissionAnswers } from '../../apps/mobile/src/lib/answers'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t137-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

async function business(name: string) {
  const runId = shortId()
  const email = `owner+t137-${runId}@hardcore.test`
  const password = `Hardcore-${runId}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const authed = { Cookie: sessionCookieHeader(cfg, session) }
  const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: name } })
  const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant PUT', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: authed,
    body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { authed, accessToken: session.access_token as string }
}

const a = await business('T137 Electric')
const b = await business('T137 Rival Co')

// The EV service, created as onboarding does (cookie session, like the dashboard)
const svc = electricalPackUS.services[1]!
const created = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: a.authed,
  body: {
    name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
    scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
    mediaConfig: { minPhotos: svc.draft.media.minPhotos, maxPhotos: svc.draft.media.maxPhotos, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: svc.draft.media.requiredAngles },
    workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
    draftConfig: svc.draft,
  },
}))
const serviceId: string = created.service.id

// The app's own client, with node's fetch and file reads
const apiFor = (token: string) =>
  createApi({
    baseUrl: cfg.appUrl,
    getAccessToken: async () => token,
    readFile: async (uri) => new Blob([readFileSync(uri)]),
  })
const api = apiFor(a.accessToken)
const rival = apiFor(b.accessToken)

// 1. bearer auth
const list = await api.listQuotes().then(() => true, (e) => e)
check('bearer works on an existing dashboard API (GET /api/quotes)', list === true, list === true ? undefined : String(list))
const svcRole = await http('GET', `${cfg.appUrl}/api/app/bootstrap`, { headers: { Authorization: `Bearer ${cfg.serviceKey}` } })
check('service-role key as bearer is refused', svcRole.status === 401, svcRole.status)
const noAuth = await http('GET', `${cfg.appUrl}/api/app/bootstrap`)
check('no auth → 401', noAuth.status === 401, noAuth.status)

const boot = await api.bootstrap()
check('bootstrap returns the tenant key and region', Boolean(boot.tenantKey) && boot.region.code === 'US', { tenantName: boot.tenantName, postal: boot.region.postalCodeLabel })

// 2. on-site quote, as app/new.tsx builds it
const widget = await api.widgetConfig(boot.tenantKey)
const fields = fieldsForService(widget, serviceId)
const answers = toSubmissionAnswers(fields, { run_length_ft: '60', charger_supply: 'Please supply one' }, 'Level 2 charger in the garage, panel in the hallway')
const photo = collectAssets('test-assets/hardcore2/T141-labels', path.join(outDir, '.scratch')).files.find((f: { fileName: string }) => f.fileName === 'panel-label.jpg')
const assetIds = await api.uploadPhotos(boot.tenantKey, [{ uri: photo.path, fileName: photo.fileName, contentType: photo.contentType, sizeBytes: readFileSync(photo.path).byteLength }])
const t0 = Date.now()
const quote = await api.createQuote({
  serviceId,
  customer: { name: 'Pat Onsite', email: 'pat.onsite@example.com' },
  job: { address: '12 Elm St', postcodeOrZip: '78701', answers },
  assetIds,
})
check('on-site quote created via /api/app/quotes', Boolean(quote.quoteId) && quote.status === 'queued', quote.status)
const source = (await sb.select('quote_requests', `id=eq.${(await sb.select('quotes', `id=eq.${quote.quoteId}&select=quote_request_id`))[0].quote_request_id}&select=source_json`))[0].source_json
check('quote request is marked source app', source?.type === 'app', source)

let view = await api.getQuote(quote.quoteId)
while ((view.status === 'queued' || view.status === 'generating') && Date.now() - t0 < 300_000) {
  await new Promise((r) => setTimeout(r, 1000))
  view = await api.getQuote(quote.quoteId)
}
const firstMs = Date.now() - t0
check('priced with a confirmation question (panel identified)', view.status === 'awaiting_clarification' && view.questions.length > 0, {
  firstMs, status: view.status, total: view.pricing.total, grade: view.pricing.estimate?.grade, questions: view.questions.map((q) => q.question),
})

// 3. isolation before answering
const peek = await rival.getQuote(quote.quoteId).then(() => 'read', (e) => e.status)
check("another business can't read the quote", peek === 404, peek)
const meddle = await rival.answerQuestions(quote.quoteId, view.questions.map((q) => ({ questionId: q.id, answer: '60 A' }))).then(() => 'answered', (e) => e.status)
check("another business can't answer it", meddle === 404, meddle)

// The business confirms on site (what quote/[id].tsx sends), with the stored token
const token = new URL(quote.quoteViewUrl).searchParams.get('token')!
await api.answerQuestions(quote.quoteId, view.questions.map((q) => ({ questionId: q.id, answer: q.aiValue !== undefined ? String(q.aiValue) : '100 A' })), token)
const t1 = Date.now()
view = await api.getQuote(quote.quoteId)
while (['queued', 'generating', 'awaiting_clarification'].includes(view.status) && Date.now() - t1 < 120_000) {
  await new Promise((r) => setTimeout(r, 500))
  view = await api.getQuote(quote.quoteId)
}
check('confirmed on site → sent, Grade A, $2,880', view.status === 'sent' && view.pricing.estimate?.grade === 'A' && view.pricing.total === 2880, {
  confirmMs: Date.now() - t1, status: view.status, total: view.pricing.total, grade: view.pricing.estimate?.grade,
})
check('takeoff returned for the app', view.takeoff.length >= 3, view.takeoff.map((t) => `${t.item}: ${t.method}`))

saveJson(outDir, 't137.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass — artifacts in ${outDir}`)
if (passed !== checks.length) process.exit(1)
