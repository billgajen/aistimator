// T-143 live check: final invoice + accuracy report through the real API.
// Run: npx tsx scripts/hardcore-test/verify-t143.mts
// Two garage-door quotes (form-priced, no AI quantities) are invoiced at
// +5% and −20%; the report must say median |error| 12.5%, 50% within ±10%.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t143-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}

async function business(name: string) {
  const id = shortId()
  const email = `owner+t143-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, bearer: { Authorization: `Bearer ${session.access_token}` }, tenantKey: site.tenant_key as string }
}

const a = await business('T143 Doors')
const b = await business('T143 Rival')
const svc = garageDoorsPackUS.services[0]!
const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: a.cookie,
  body: {
    name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
    scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
    workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
    draftConfig: svc.draft,
  },
}))
const serviceId = created.service.id

async function quote(size: string) {
  const res = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: a.tenantKey, serviceId, customer: { name: 'Invoice Test', email: 'inv@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'New garage door please' }, { fieldId: 'door_size', value: size }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  }))
  const final = await pollQuote(cfg, res.quoteId, new URL(res.quoteViewUrl).searchParams.get('token')!)
  return { id: res.quoteId as string, total: final.pricing.total as number }
}
const q1 = await quote('Single (8 or 9 ft wide, 7 ft tall)') // 150 + 1250 = 1400
const q2 = await quote('Double (16 ft wide, 7 ft tall)') // 150 + 1950 = 2100
check('quotes priced', q1.total === 1400 && q2.total === 2100, [q1.total, q2.total])

const put = (q: string, body: unknown, headers: Record<string, string>) => http('PUT', `${cfg.appUrl}/api/quotes/${q}/final-invoice`, { headers, body })
const r1 = await put(q1.id, { amount: '$1,470.00', note: 'added weather seal' }, a.bearer) // +5%
check('invoice recorded via bearer (app)', r1.ok && r1.json.finalInvoiceAmount === 1470, r1.json)
const r2 = await put(q2.id, { amount: 1680 }, a.cookie) // −20%
check('invoice recorded via cookie (dashboard)', r2.ok && r2.json.finalInvoiceAmount === 1680, r2.json)
const bad = await put(q1.id, { amount: 'lots' }, a.cookie)
check('nonsense amount → 400', bad.status === 400, bad.status)
const rival = await put(q1.id, { amount: 1 }, b.bearer)
check("another business can't record on it", rival.status === 404, rival.status)

const report = expectOk('accuracy', await http('GET', `${cfg.appUrl}/api/analytics/accuracy`, { headers: a.cookie }))
check('accuracy: 2 invoiced, median |error| 12.5%, 50% within ±10%, bias −7.5%', report.overall?.count === 2 && report.overall.medianAbsError === 0.125 && report.overall.withinTenPct === 0.5 && report.overall.medianBias === -0.075, report.overall)
check('grouped by service and grade', report.byService[0]?.key === svc.name && report.byGrade[0]?.key === 'Grade A', { byService: report.byService.map((g: { key: string }) => g.key), byGrade: report.byGrade.map((g: { key: string }) => g.key) })
const rivalReport = expectOk('rival accuracy', await http('GET', `${cfg.appUrl}/api/analytics/accuracy`, { headers: b.bearer }))
check("rival's report doesn't see them", rivalReport.overall === null, rivalReport.overall)
const clear = await put(q1.id, { amount: null }, a.cookie)
check('null clears the invoice', clear.ok && clear.json.finalInvoiceAmount === null, clear.json)

saveJson(outDir, 't143.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
if (passed !== checks.length) process.exit(1)
