// T-133 live verification — the region layer end to end for a NEW US tenant.
// Run: node scripts/hardcore-test/verify-t133.mjs
//
// Checks, in order:
//  1. A new signup defaults to region US / USD (DB default, no PUT).
//  2. Tax enabled with no label → "Sales tax" from region data.
//  3. The compiler parses "$3.20 per sqft walls, $450 minimum" for a US tenant.
//  4. A photo-measured exterior quote prices in sq ft against the US reference
//     table and renders with the en-US locale (uses the S01 painting photos).
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId,
  collectAssets, uploadAssets, saveJson, runStamp,
} from './lib.mjs'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const runId = shortId()
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t133-${runId}`)
mkdirSync(outDir, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const business = 'T133 Sunbelt Painters'
const email = `owner+t133-${runId}@hardcore.test`
const password = `Hardcore-${runId}-Aa1!`
const user = await sb.createUser(email, password, business)
const session = await sb.signIn(email, password)
const authed = { Cookie: sessionCookieHeader(cfg, session) }
const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: business } })
const tenantId = setupRes.ok
  ? setupRes.json.tenantId
  : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id

// 1. Region defaults for a brand-new tenant
const me = expectOk('tenant GET', await http('GET', `${cfg.appUrl}/api/tenant`, { headers: authed }))
check('new tenant defaults to region US', me.tenant.region === 'US', `region=${me.tenant.region}`)
check('new tenant defaults to USD', me.tenant.currency === 'USD', `currency=${me.tenant.currency}`)

// 2. Tax label from region data (no label set by the business)
expectOk('tenant PUT', await http('PUT', `${cfg.appUrl}/api/tenant`, {
  headers: authed,
  body: { taxEnabled: true, taxRate: 0.0825, serviceAreaMode: 'none', serviceAreaValues: [] },
}))
const site = await sb.insert('tenant_sites', {
  tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true,
})

// 3. Compiler with US units and dollars
const compile = expectOk('compile', await http('POST', `${cfg.appUrl}/api/services/ai-draft/compile`, {
  headers: authed,
  body: {
    description: '$3.20 per sqft walls, $450 minimum',
    serviceName: 'Exterior House Painting',
    serviceDescription: 'Exterior walls of single-family homes painted, two coats.',
  },
  timeoutMs: 180_000,
}))
saveJson(outDir, 'compile.json', compile)
const draft = compile.updatedConfig || {}
const steps = draft.pricing?.workSteps || []
const wallStep = steps.find((s) => s.costType === 'per_unit' && Math.abs((s.defaultCost ?? 0) - 3.2) < 1e-9)
check('compiler: per-unit wall step at $3.20', Boolean(wallStep), steps.map((s) => `${s.name}=${s.defaultCost}/${s.unitLabel}`).join(', '))
check('compiler: wall step billed per sqft', /sq\s*_?ft|square\s*f(oo|ee)t/i.test(wallStep?.unitLabel || ''), `unitLabel=${wallStep?.unitLabel}`)
check('compiler: $450 minimum', draft.pricing?.minimumCharge === 450, `minimumCharge=${draft.pricing?.minimumCharge}`)
const measuredKey = wallStep?.quantitySource?.type === 'ai_signal' ? wallStep.quantitySource.signalKey : null
const measuredSignal = (draft.expectedSignals || []).find((e) => e.signalKey === measuredKey)
check('compiler: wall area measured from photos (ai_signal)', Boolean(measuredKey), `quantitySource=${JSON.stringify(wallStep?.quantitySource)}`)
check('compiler: measured signal declares unit sqft', measuredSignal?.unit === 'sqft', `unit=${measuredSignal?.unit}`)

// 4. Photo-measured US quote
const scratch = path.join(outDir, '.scratch')
const collected = collectAssets('test-assets/hardcore/S01-painting', scratch)
const svc = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: authed,
  body: {
    name: 'Exterior House Painting',
    documentTypeDefault: 'instant_estimate',
    scopeIncludes: draft.scope?.included || [],
    scopeExcludes: draft.scope?.excluded || [],
    defaultAssumptions: draft.scope?.assumptions || [],
    mediaConfig: {
      minPhotos: Math.min(draft.media?.minPhotos ?? 1, collected.files.length),
      maxPhotos: draft.media?.maxPhotos ?? 8,
      photoGuidance: draft.media?.photoGuidance ?? null,
      requiredAngles: draft.media?.requiredAngles ?? [],
    },
    workSteps: steps,
    expectedSignals: draft.expectedSignals || [],
    pricingRules: {
      baseFee: draft.pricing?.baseFee ?? 0,
      minimumCharge: draft.pricing?.minimumCharge ?? 0,
      addons: compile.addons || [],
      multipliers: compile.multipliers || [],
      workSteps: steps,
    },
    draftConfig: draft,
  },
}))
const serviceId = svc.service.id
const widgetCfg = expectOk('widget config', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${site.tenant_key}`))
check('widget: postal label is "ZIP code"', widgetCfg.region?.postalCodeLabel === 'ZIP code', JSON.stringify(widgetCfg.region))
const fields = [...(widgetCfg.globalFields || []), ...((widgetCfg.serviceFields || {})[serviceId] || [])]
const answers = [{ fieldId: '_project_description', value: 'Repaint the front of our two-story house, the white siding is peeling. Front wall only.' }]
for (const f of fields) {
  if (!f.required || f.fieldId.startsWith('_')) continue
  if (f.type === 'number') answers.push({ fieldId: f.fieldId, value: 2 })
  else if (f.type === 'boolean' || f.type === 'checkbox') answers.push({ fieldId: f.fieldId, value: false })
  else if (f.options?.length) answers.push({ fieldId: f.fieldId, value: f.options[0].value ?? f.options[0] })
  else answers.push({ fieldId: f.fieldId, value: 'Front wall only' })
}
const up = await uploadAssets(cfg, site.tenant_key, collected.files)
check('photos uploaded', up.assetIds.length > 0, `${up.assetIds.length}/${collected.files.length} ${up.errors.join('; ')}`)
const t0 = Date.now()
const submit = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
  body: {
    tenantKey: site.tenant_key,
    serviceId,
    customer: { name: 'T133 Probe', email: 't133-customer@example.com' },
    job: { postcodeOrZip: '78701', answers },
    assetIds: up.assetIds,
    source: { type: 'widget', pageUrl: 'http://localhost:3000/t133' },
  },
  timeoutMs: 600_000,
}))
const token = new URL(submit.quoteViewUrl).searchParams.get('token')
const quote = await pollQuote(cfg, submit.quoteId, token)
saveJson(outDir, 'quote.json', quote)
const seconds = Math.round((Date.now() - t0) / 1000)
check('quote: currency USD', quote.pricing?.currency === 'USD', `status=${quote.status}, ${seconds}s`)
check('quote: locale en-US', quote.locale === 'en-US', `locale=${quote.locale}`)
const detail = await http('GET', `${cfg.appUrl}/api/quotes/${submit.quoteId}`, { headers: authed })
if (detail.ok) saveJson(outDir, 'quote-detail-internal.json', detail.json)
const pricingJson = detail.json?.quote?.pricing_json || detail.json?.pricing_json || quote.pricing
check('quote: tax line labelled "Sales tax"', pricingJson?.taxLabel === 'Sales tax', `taxLabel=${pricingJson?.taxLabel}`)
const signals = detail.json?.quote?.signals_json?.signals || detail.json?.signals_json?.signals || []
const measured = signals.find((s) => s.key === measuredKey)
check(
  'measurement: wall area in sensible sq ft for one 2-story front elevation (150–3,000)',
  Boolean(measured) && measured.value >= 150 && measured.value <= 3000,
  measured ? `${measured.value} sq ft — ${measured.evidence}` : 'no measured signal (photos may have been skipped)'
)

saveJson(outDir, 'checks.json', results)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed — artifacts in ${outDir}`)
process.exit(failed.length ? 1 : 0)
