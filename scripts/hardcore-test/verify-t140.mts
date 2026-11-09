// T-140 live check: the HVAC and water-heater packs, created exactly as
// onboarding does, each quoted from one rating-plate photo on the local stack.
// Run: npx tsx scripts/hardcore-test/verify-t140.mts
//
// Photos: test-assets/hardcore2/T140-labels/ (synthetic renders, gitignored).
// Real nameplate accuracy is a separate check (OWNER-TODO T-139).
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId,
  collectAssets, uploadAssets, saveJson, runStamp,
} from './lib.mjs'
import { hvacPackUS } from '../../apps/web/src/lib/vertical-packs/hvac-us'
import { waterHeaterPackUS } from '../../apps/web/src/lib/vertical-packs/water-heater-us'
import type { VerticalPackService } from '../../apps/web/src/lib/vertical-packs/types'

type Row = Record<string, unknown>
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t140-${shortId()}`)
mkdirSync(outDir, { recursive: true })

const CASES = [
  { service: hvacPackUS.services.find((s) => /Central AC/.test(s.name))!, photo: 'ac-plate.jpg', expect: { values: { ac_tonnage: '3 ton' }, total: 5450 } },
  { service: hvacPackUS.services.find((s) => /Furnace/.test(s.name))!, photo: 'furnace-plate.jpg', expect: { values: { furnace_input_btu: '80,000' }, total: 3900 } },
  { service: waterHeaterPackUS.services[0]!, photo: 'water-heater-label.jpg', expect: { values: { tank_capacity: '50 gal', water_heater_fuel: 'Natural gas' }, total: 2150 } },
]

async function quoteRow(quoteId: string): Promise<Row> {
  return (await sb.select('quotes', `id=eq.${quoteId}&select=status,pricing_json,content_json,clarification_questions_json,signals_json,pricing_trace_json`))[0]
}

const runId = shortId()
const email = `owner+t140-${runId}@hardcore.test`
const password = `Hardcore-${runId}-Aa1!`
const user = await sb.createUser(email, password, 'T140 Home Services')
const session = await sb.signIn(email, password)
const authed = { Cookie: sessionCookieHeader(cfg, session) }
const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: 'T140 Home Services' } })
const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
expectOk('tenant PUT', await http('PUT', `${cfg.appUrl}/api/tenant`, {
  headers: authed,
  body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
}))
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })

// Same body as OnboardingFlow's pack apply
async function createService(svc: VerticalPackService): Promise<string> {
  const res = expectOk(`create ${svc.name}`, await http('POST', `${cfg.appUrl}/api/services`, {
    headers: authed,
    body: {
      name: svc.name,
      description: svc.description,
      documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included,
      scopeExcludes: svc.draft.scope.excluded,
      defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: svc.draft.media.minPhotos, maxPhotos: svc.draft.media.maxPhotos, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: svc.draft.media.requiredAngles },
      workSteps: svc.draft.pricing.workSteps,
      expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: svc.draft.pricing.baseFee, minimumCharge: svc.draft.pricing.minimumCharge, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
    },
  }))
  return res.service.id
}

const results: Row[] = []
for (const c of CASES) {
  const serviceId = await createService(c.service)
  const collected = collectAssets('test-assets/hardcore2/T140-labels', path.join(outDir, '.scratch'))
  const file = collected.files.find((f: { fileName: string }) => f.fileName === c.photo)
  if (!file) throw new Error(`missing ${c.photo}`)
  const up = await uploadAssets(cfg, site.tenant_key, [file])
  const t0 = Date.now()
  const submit = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: {
      tenantKey: site.tenant_key,
      serviceId,
      customer: { name: 'T140 Customer', email: 't140@example.com' },
      job: { postcodeOrZip: '78701', answers: [{ fieldId: '_project_description', value: 'Our old unit needs replacing. Photo of the label attached.' }] },
      assetIds: up.assetIds,
      source: { type: 'widget', pageUrl: 'http://localhost:3000/t140' },
    },
    timeoutMs: 600_000,
  }))
  const token = new URL(submit.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, submit.quoteId, token)
  const first = await quoteRow(submit.quoteId)
  const signals = ((first.signals_json as Row)?.signals || []) as Row[]
  const questions = (first.clarification_questions_json || []) as Row[]
  const r: Row = {
    service: c.service.name,
    quoteId: submit.quoteId,
    firstPriceMs: Date.now() - t0,
    firstStatus: first.status,
    firstGrade: ((first.pricing_json as Row)?.estimate as Row)?.grade,
    firstTotal: (first.pricing_json as Row)?.total,
    identified: Object.fromEntries(Object.keys(c.expect.values).map((k) => [k, signals.find((s) => s.key === k)?.value ?? null])),
    evidence: Object.fromEntries(Object.keys(c.expect.values).map((k) => [k, signals.find((s) => s.key === k)?.evidence ?? null])),
    questions: questions.map((q) => q.question),
  }
  if (first.status === 'awaiting_clarification' && questions.length > 0) {
    // The customer confirms what was read (or, if nothing was read, gives the true value)
    const answers = questions.map((q) => ({
      questionId: q.id,
      answer: q.aiValue !== undefined ? String(q.aiValue) : String((c.expect.values as Record<string, string>)[String(q.targetSignalKey)] ?? ''),
    }))
    expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${submit.quoteId}/clarify`, { body: { token, answers }, timeoutMs: 600_000 }))
    const deadline = Date.now() + 600_000
    let row = await quoteRow(submit.quoteId)
    while (['queued', 'generating', 'awaiting_clarification'].includes(String(row.status)) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 250))
      row = await quoteRow(submit.quoteId)
    }
    r.finalStatus = row.status
    r.finalTotal = (row.pricing_json as Row)?.total
    r.finalGrade = ((row.pricing_json as Row)?.estimate as Row)?.grade
  }
  const total = Number(r.finalTotal ?? r.firstTotal)
  r.pass =
    Object.entries(c.expect.values).every(([k, v]) => (r.identified as Row)[k] === v) && total === c.expect.total
  console.log(JSON.stringify(r, null, 2))
  results.push(r)
}
saveJson(outDir, 't140.json', results)
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — artifacts in ${outDir}`)
