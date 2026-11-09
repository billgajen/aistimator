// T-138 live check: LiDAR room scans → scanned quantities, on the local stack.
// Run: npx tsx scripts/hardcore-test/verify-t138.mts
//
// The scan is synthetic but RoomPlan-shaped (what modules/room-scan sends).
// 1. app quote, US interior painting, 3 scanned rooms, room count left blank
//    → room_count = 3 from the scan, $75 + 3 × $375 = $1,200, Grade A,
//    takeoff "Scanned on site with LiDAR"
// 2. an invalid scan → 400 INVALID_SCAN
// 3. the same scan smuggled in through the PUBLIC widget route is ignored
//    (the customer typed 1 room → $450, no "scanned" claim)
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'
import { createApi } from '../../apps/mobile/src/lib/api'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t138-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

const room = (w: number, l: number) => ({
  walls: [{ widthM: w, heightM: 2.44 }, { widthM: l, heightM: 2.44 }, { widthM: w, heightM: 2.44 }, { widthM: l, heightM: 2.44 }],
  openings: [{ type: 'door', widthM: 0.81, heightM: 2.03 }, { type: 'window', widthM: 1.2, heightM: 1.2 }],
  floors: [{ polygon: [[0, 0], [w, 0], [w, l], [0, l]], widthM: w, lengthM: l }],
})
const SCAN = { version: 1, device: 'iPhone 15 Pro', rooms: [room(4, 3.5), room(3.2, 3), room(2.5, 2)] }

const runId = shortId()
const email = `owner+t138-${runId}@hardcore.test`
const password = `Hardcore-${runId}-Aa1!`
const user = await sb.createUser(email, password, 'T138 Painters')
const session = await sb.signIn(email, password)
const authed = { Cookie: sessionCookieHeader(cfg, session) }
const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: 'T138 Painters' } })
const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
expectOk('tenant PUT', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: authed, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })

const svc = paintingPackUS.services.find((s) => /Interior/.test(s.name))!
const created = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: authed,
  body: {
    name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
    scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
    mediaConfig: { minPhotos: 0, maxPhotos: svc.draft.media.maxPhotos, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
    workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
    pricingRules: { baseFee: svc.draft.pricing.baseFee, minimumCharge: svc.draft.pricing.minimumCharge, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
    draftConfig: svc.draft,
  },
}))
const serviceId: string = created.service.id
const api = createApi({ baseUrl: cfg.appUrl, getAccessToken: async () => session.access_token })

async function settle(quoteId: string) {
  const t0 = Date.now()
  let view = await api.getQuote(quoteId)
  while (['queued', 'generating'].includes(view.status) && Date.now() - t0 < 300_000) {
    await new Promise((r) => setTimeout(r, 1000))
    view = await api.getQuote(quoteId)
  }
  return { view, ms: Date.now() - t0 }
}

// 1. scanned on site
const description = { fieldId: '_project_description', value: 'Repaint three rooms, walls and ceilings' }
const q1 = await api.createQuote({ serviceId, customer: { name: 'Sam Scan', email: 'sam.scan@example.com' }, job: { postcodeOrZip: '78701', answers: [description] }, assetIds: [], scan: SCAN })
const r1 = await settle(q1.quoteId)
const roomsLine = r1.view.takeoff.find((t) => /Walls/.test(t.item))
check('scan fills room_count = 3 → $1,200 Grade A', r1.view.pricing.total === 1200 && r1.view.pricing.estimate?.grade === 'A', { ms: r1.ms, status: r1.view.status, total: r1.view.pricing.total, grade: r1.view.pricing.estimate?.grade })
check('takeoff cites the scan', Boolean(roomsLine?.method.startsWith('Scanned on site with LiDAR')), roomsLine)
const answers = (await sb.select('quote_requests', `id=eq.${(await sb.select('quotes', `id=eq.${q1.quoteId}&select=quote_request_id`))[0].quote_request_id}&select=job_answers`))[0].job_answers as Array<{ fieldId: string; value: unknown }>
check('raw scan stored with the request for audit', answers.some((a) => a.fieldId === '_room_scan'), answers.map((a) => a.fieldId))

// 2. invalid scan
const bad = await api.createQuote({ serviceId, customer: { name: 'Bad', email: 'bad@example.com' }, job: { answers: [description] }, scan: { version: 1, rooms: [{ walls: [{ widthM: 900, heightM: 2 }], openings: [], floors: [] }] } }).then(() => 'accepted', (e) => `${e.status} ${e.code}`)
check('invalid scan → 400 INVALID_SCAN', bad === '400 INVALID_SCAN', bad)

// 3. smuggled through the public widget route
const pub = expectOk('public submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
  body: {
    tenantKey: site.tenant_key, serviceId,
    customer: { name: 'Wendy Widget', email: 'wendy@example.com' },
    job: { postcodeOrZip: '78701', answers: [description, { fieldId: 'room_count', value: 1 }, { fieldId: '_room_scan', value: SCAN }] },
    source: { type: 'widget', pageUrl: 'http://localhost:3000/t138' },
  },
}))
const token = new URL(pub.quoteViewUrl).searchParams.get('token')!
await pollQuote(cfg, pub.quoteId, token)
const r3 = await settle(pub.quoteId)
const line3 = r3.view.takeoff.find((t) => /Walls/.test(t.item))
check('widget-route scan ignored: priced on the typed 1 room ($450), no scan claim', r3.view.pricing.total === 450 && !line3?.method.includes('LiDAR'), { total: r3.view.pricing.total, method: line3?.method })

saveJson(outDir, 't138.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass — artifacts in ${outDir}`)
if (passed !== checks.length) process.exit(1)
