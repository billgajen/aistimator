// Speed check — the production smoke test, timed per stage, on the local stack.
// Run: npx tsx scripts/hardcore-test/verify-speed.mts [--region GB|US|both] [--label before]
//
// For each region: a new tenant with that region's painting pack, an exterior
// job with the S01 house-front photos, then the customer CONFIRMS the measured
// value (the smoke-test path). Records time to first price (range shown),
// confirm → final price, per-stage timings and AI calls from
// pricing_trace_json, and the final grade.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId,
  collectAssets, uploadAssets, saveJson, runStamp,
} from './lib.mjs'
import { paintingPack } from '../../apps/web/src/lib/vertical-packs/painting'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'

const args = process.argv.slice(2)
const argValue = (name: string, fallback: string) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}
const regionArg = argValue('--region', 'both')
const label = argValue('--label', 'run')
// --photos 0: no photos, so the wall area is missing and the customer is
// always asked for it (exercises the confirm → reprice path every time)
const photoCount = Number(argValue('--photos', '2'))
const regions = regionArg === 'both' ? ['GB', 'US'] : [regionArg]

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-speed-${label}-${shortId()}`)
mkdirSync(outDir, { recursive: true })

const REGION = {
  GB: { pack: paintingPack, currency: 'GBP', taxRate: 0.2, postcode: 'SW1A 1AA', storeysField: 'storeys' },
  US: { pack: paintingPackUS, currency: 'USD', taxRate: 0.0825, postcode: '78701', storeysField: 'stories' },
} as const

type Row = Record<string, unknown>

async function quoteRow(quoteId: string): Promise<Row> {
  const rows = await sb.select(
    'quotes',
    `id=eq.${quoteId}&select=status,pricing_json,pricing_trace_json,clarification_questions_json,signals_json`
  )
  return rows[0]
}

function summarise(row: Row) {
  const trace = (row.pricing_trace_json || {}) as Row
  const usage = (trace.aiUsage || {}) as { calls?: number; byTask?: Array<Row> }
  const pricing = (row.pricing_json || {}) as Row
  const estimate = (pricing.estimate || {}) as Row
  return {
    status: row.status,
    total: pricing.total,
    grade: estimate.grade,
    range: estimate.rangeLow !== undefined ? `${estimate.rangeLow}–${estimate.rangeHigh}` : null,
    // AI calls made by THIS run (a reprice keeps the first pass's usage record)
    aiCalls: (trace.timings as Row | undefined)?.repriceOnly ? 0 : usage.calls ?? 0,
    byTask: (usage.byTask || []).map((t) => `${t.task}×${t.calls} (${t.totalMs ?? '?'}ms)`),
    timings: trace.timings ?? null,
  }
}

async function runRegion(region: 'GB' | 'US') {
  const r = REGION[region]
  const runId = shortId()
  const business = `Speed ${region} Painters`
  const email = `owner+speed-${region.toLowerCase()}-${runId}@hardcore.test`
  const password = `Hardcore-${runId}-Aa1!`
  const user = await sb.createUser(email, password, business)
  const session = await sb.signIn(email, password)
  const authed = { Cookie: sessionCookieHeader(cfg, session) }
  const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: business } })
  const tenantId = setupRes.ok
    ? setupRes.json.tenantId
    : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant PUT', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: authed,
    body: { region, currency: r.currency, taxEnabled: true, taxRate: r.taxRate, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  const site = await sb.insert('tenant_sites', {
    tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true,
  })

  // The pack's exterior service, created exactly as onboarding does
  const svcDef = r.pack.services.find((s) => /exterior/i.test(s.name))
  if (!svcDef) throw new Error(`${region} pack has no exterior service`)
  const d = svcDef.draft
  const svc = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: authed,
    body: {
      name: svcDef.name,
      description: svcDef.description,
      documentTypeDefault: 'instant_estimate',
      scopeIncludes: d.scope.included,
      scopeExcludes: d.scope.excluded,
      defaultAssumptions: d.scope.assumptions,
      mediaConfig: { minPhotos: photoCount > 0 ? 1 : 0, maxPhotos: d.media.maxPhotos, photoGuidance: d.media.photoGuidance, requiredAngles: [] },
      workSteps: d.pricing.workSteps,
      expectedSignals: d.expectedSignals,
      pricingRules: {
        baseFee: d.pricing.baseFee,
        minimumCharge: d.pricing.minimumCharge,
        addons: svcDef.addons || [],
        multipliers: svcDef.multipliers || [],
        workSteps: d.pricing.workSteps,
      },
      draftConfig: d,
    },
  }))
  const serviceId = svc.service.id

  const widgetCfg = expectOk('widget config', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${site.tenant_key}`))
  const fields = [...(widgetCfg.globalFields || []), ...((widgetCfg.serviceFields || {})[serviceId] || [])]
  const answers: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: '_project_description', value: 'Please repaint the front of our two-storey house. The paint is peeling in places. Front wall only.' },
  ]
  for (const f of fields) {
    if (f.fieldId.startsWith('_')) continue
    if (f.fieldId === r.storeysField) answers.push({ fieldId: f.fieldId, value: 2 })
    else if (f.options?.length && /side/i.test(f.fieldId)) {
      const front = f.options.find((o: { value?: string; label?: string }) => /front/i.test(`${o.value ?? o} ${o.label ?? ''}`))
      answers.push({ fieldId: f.fieldId, value: (front ?? f.options[0]).value ?? front ?? f.options[0] })
    } else if (f.required) {
      if (f.type === 'number') answers.push({ fieldId: f.fieldId, value: 2 })
      else if (f.options?.length) answers.push({ fieldId: f.fieldId, value: f.options[0].value ?? f.options[0] })
      else answers.push({ fieldId: f.fieldId, value: 'Front wall only' })
    }
  }

  const collected = collectAssets('test-assets/hardcore/S01-painting', path.join(outDir, '.scratch'))
  const up = await uploadAssets(cfg, site.tenant_key, collected.files.slice(0, photoCount))

  const t0 = Date.now()
  const submit = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: {
      tenantKey: site.tenant_key,
      serviceId,
      customer: { name: `Speed ${region}`, email: `speed-${region.toLowerCase()}@example.com` },
      job: { postcodeOrZip: r.postcode, answers },
      assetIds: up.assetIds,
      source: { type: 'widget', pageUrl: 'http://localhost:3000/speed' },
    },
    timeoutMs: 600_000,
  }))
  const submitMs = Date.now() - t0
  const token = new URL(submit.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, submit.quoteId, token)
  const firstPriceMs = Date.now() - t0
  const first = await quoteRow(submit.quoteId)
  const result: Row = { region, quoteId: submit.quoteId, submitMs, firstPriceMs, first: summarise(first) }

  // Confirm the measured value, as the smoke test did
  const questions = (first.clarification_questions_json || []) as Array<{ id: string; type?: string; aiValue?: unknown }>
  if (first.status === 'awaiting_clarification' && questions.length > 0) {
    const clarifyAnswers = questions.map((q) => ({
      questionId: q.id,
      answer: q.aiValue !== undefined && q.aiValue !== null ? String(q.aiValue) : 'Front wall only',
    }))
    const t1 = Date.now()
    expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${submit.quoteId}/clarify`, {
      body: { token, answers: clarifyAnswers },
      timeoutMs: 600_000,
    }))
    // Settled again once it leaves the processing states
    const deadline = Date.now() + 600_000
    let row = await quoteRow(submit.quoteId)
    while (['queued', 'generating', 'awaiting_clarification'].includes(String(row.status)) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 250))
      row = await quoteRow(submit.quoteId)
    }
    result.confirmMs = Date.now() - t1
    result.confirmed = clarifyAnswers
    result.final = summarise(row)
  }
  return result
}

const results = []
for (const region of regions) {
  console.log(`\n=== ${region} ===`)
  const res = await runRegion(region as 'GB' | 'US')
  console.log(JSON.stringify(res, null, 2))
  results.push(res)
}
saveJson(outDir, 'speed.json', results)
console.log(`\nartifacts in ${outDir}`)
