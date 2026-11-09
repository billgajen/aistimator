// Hardcore E2E runner — drives the full stack over HTTP, no browser.
// Usage: node scripts/hardcore-test/run.mjs [--only S01,S05] [--skip-clarify] [--round2]
// --round2: 20 blind-authored scenarios (scenarios2.mjs + requests2.json),
// customer answers simulated in-character via Gemini (customer-sim.mjs).
import path from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { scenarios } from './scenarios.mjs'
import { simulateFieldAnswers, simulateClarifyAnswers } from './customer-sim.mjs'
import {
  ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk,
  collectAssets, uploadAssets, buildAnswers, pollQuote, answerClarifications,
  runStamp, shortId, saveJson,
} from './lib.mjs'
import { commonChecks, scenarioChecks } from './checks.mjs'

const args = process.argv.slice(2)
const onlyArg = args.find((a) => a.startsWith('--only'))
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',') : null
const skipClarify = args.includes('--skip-clarify')
const round2 = args.includes('--round2')
// --round3: the US launch trades (scenarios3.mjs + requests3.json). Run with
// `npx tsx` — pack scenarios import the TypeScript packs.
const round3 = args.includes('--round3')

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const stamp = runStamp()
const runId = shortId()
const outRoot = path.join(ROOT, 'scripts/hardcore-test/results', `${stamp}-${runId}`)
mkdirSync(outRoot, { recursive: true })
const scratch = path.join(outRoot, '.scratch')

const log = (s, msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s} ${msg}`)

async function runScenario(scenario) {
  const dir = path.join(outRoot, scenario.id)
  const result = { id: scenario.id, business: scenario.business, currency: scenario.currency || 'GBP', steps: {}, checks: [], error: null }
  try {
    // 1. Owner account + tenant (cookie-authed session for dashboard APIs)
    const email = `owner+${scenario.slug}-${runId}@hardcore.test`
    const password = `Hardcore-${runId}-Aa1!`
    const user = await sb.createUser(email, password, scenario.business)
    const session = await sb.signIn(email, password)
    const cookie = sessionCookieHeader(cfg, session)
    const authed = { Cookie: cookie }

    // The signup trigger may have already created the tenant; setup-tenant is the fallback.
    let tenantId
    const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, {
      headers: authed, body: { businessName: scenario.business },
    })
    if (setupRes.ok) {
      tenantId = setupRes.json.tenantId
    } else if (setupRes.status === 409) {
      const profiles = await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`)
      tenantId = profiles[0]?.tenant_id
      if (!tenantId) throw new Error('409 from setup-tenant but no user_profiles row found')
    } else {
      throw new Error(`setup-tenant failed (HTTP ${setupRes.status}): ${JSON.stringify(setupRes.json)}`)
    }
    log(scenario.id, `tenant ${tenantId} (${scenario.business})`)

    expectOk('tenant settings', await http('PUT', `${cfg.appUrl}/api/tenant`, {
      headers: authed,
      // T-133: new signups default to region US; rounds 1–2 are GB businesses,
      // so they pin GB explicitly (scenario.region/currency override for US sets)
      body: {
        region: scenario.region || 'GB',
        currency: scenario.currency || 'GBP',
        taxEnabled: false,
        serviceAreaMode: 'none',
        serviceAreaValues: [],
      },
    }))

    // 2. Public widget key (no API exists — direct insert, same shape the dashboard uses)
    const site = await sb.insert('tenant_sites', {
      tenant_id: tenantId, domain: 'localhost',
      tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true,
    })
    const tenantKey = site.tenant_key

    // 3. Plain-language pricing compiler (T-104)
    const compileOnce = async (description) => {
      // one transparent retry on 5xx — Gemini flakiness/truncation, recorded below
      for (let attempt = 1; ; attempt++) {
        const res = await http('POST', `${cfg.appUrl}/api/services/ai-draft/compile`, {
          headers: authed,
          body: { description, serviceName: scenario.service, currency: scenario.currency || 'GBP' },
          timeoutMs: 180_000,
        })
        if (res.ok) return res.json
        if (res.status >= 500 && attempt < 3) {
          result.checks.push({ level: 'warn', name: `compile HTTP ${res.status} (attempt ${attempt})`, detail: JSON.stringify(res.json).slice(0, 200) })
          log(scenario.id, `compile HTTP ${res.status}, retrying (attempt ${attempt + 1})`)
          continue
        }
        throw new Error(`compile failed (HTTP ${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`)
      }
    }
    // Round 3 pack scenarios: onboarding's "Start from a template" path — the
    // pack service exactly as OnboardingFlow applies it, no compiler
    let compile
    if (scenario.pack) {
      const mod = await import(`../../apps/web/src/lib/vertical-packs/${scenario.pack.file}.ts`)
      const svc = mod[scenario.pack.export].services.find((x) => x.name === scenario.pack.service)
      if (!svc) throw new Error(`pack ${scenario.pack.file} has no service "${scenario.pack.service}"`)
      compile = { updatedConfig: svc.draft, addons: svc.addons || [], multipliers: svc.multipliers || [], ambiguities: [] }
      result.steps.pack = `${scenario.pack.file} / ${svc.name}`
    } else {
      compile = await compileOnce(scenario.pricingPlainLanguage)
    }
    saveJson(dir, 'compile.json', compile)
    const compiledEmpty = (c) =>
      !(c.updatedConfig?.pricing?.workSteps?.length) && !(c.addons?.length) &&
      !(c.updatedConfig?.pricing?.baseFee > 0)
    // A real owner seeing an empty pricing preview would push back and recompile.
    if (compiledEmpty(compile)) {
      result.checks.push({ level: 'fail', name: 'compiler produced EMPTY pricing model on first pass', detail: 'no work steps, no addons, no base fee — retrying once with a corrective nudge' })
      log(scenario.id, 'compiler returned empty pricing — retrying once')
      compile = await compileOnce(
        `${scenario.pricingPlainLanguage}\n\nIMPORTANT: your previous attempt produced no priced work steps at all. Every priced rule above must become a work step or addon with its exact price.`
      )
      saveJson(dir, 'compile-retry.json', compile)
      result.steps.compileRetried = true
      if (compiledEmpty(compile)) result.checks.push({ level: 'fail', name: 'compiler STILL empty after retry', detail: '' })
    }
    result.steps.compileAmbiguities = compile.ambiguities || []
    const draft = compile.updatedConfig || {}
    const scope = draft.scope || {}
    const media = draft.media || {}
    const pricing = draft.pricing || {}

    // 4. Assets first (so minPhotos can be capped at what actually exists)
    const collected = scenario.assetsDir ? collectAssets(scenario.assetsDir, scratch) : { files: [], skipped: [] }
    if (Array.isArray(scenario.assetFiles)) collected.files = collected.files.filter((f) => scenario.assetFiles.includes(f.fileName))
    result.steps.assets = { used: collected.files.map((f) => f.fileName), skipped: collected.skipped }
    const draftMin = media.minPhotos ?? 0
    const minPhotos = Math.min(draftMin, collected.files.length)
    if (minPhotos !== draftMin) result.steps.minPhotosCapped = { compiler: draftMin, used: minPhotos }

    // 5. Create the service — same payload shape as OnboardingFlow.tsx handleFinish
    const svcRes = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
      headers: authed,
      body: {
        name: scenario.service,
        description: null,
        documentTypeDefault: 'instant_estimate',
        scopeIncludes: scope.included || [],
        scopeExcludes: scope.excluded || [],
        defaultAssumptions: scope.assumptions || [],
        mediaConfig: {
          minPhotos,
          maxPhotos: media.maxPhotos ?? 8,
          photoGuidance: media.photoGuidance ?? null,
          requiredAngles: media.requiredAngles ?? [],
        },
        workSteps: pricing.workSteps || [],
        expectedSignals: draft.expectedSignals || [],
        pricingRules: {
          baseFee: pricing.baseFee ?? 0,
          minimumCharge: pricing.minimumCharge ?? 0,
          addons: compile.addons || [],
          multipliers: compile.multipliers || [],
          workSteps: pricing.workSteps || [],
        },
        draftConfig: draft,
      },
    }))
    const serviceId = svcRes.service.id
    saveJson(dir, 'service.json', svcRes)
    log(scenario.id, `service ${serviceId} compiled+created (${(pricing.workSteps || []).length} steps, ${(compile.addons || []).length} addons)`)

    // 6. Widget config → required fields → answers
    const widgetCfg = expectOk('widget config', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${tenantKey}`))
    saveJson(dir, 'widget-config.json', widgetCfg)
    const fields = [...(widgetCfg.globalFields || []), ...((widgetCfg.serviceFields || {})[serviceId] || [])]
    let answers, answerLog
    if (scenario.sim) {
      const simmed = await simulateFieldAnswers({
        apiKey: cfg.geminiKey,
        persona: scenario.persona,
        request: scenario.request,
        fields: fields.filter((f) => f.fieldId !== '_project_description'),
      })
      answers = [{ fieldId: '_project_description', value: scenario.request }, ...simmed.answers]
      answerLog = simmed.log
    } else {
      ;({ answers, log: answerLog } = buildAnswers(scenario, fields))
    }
    result.steps.answerLog = answerLog

    // 7. Upload assets
    const up = await uploadAssets(cfg, tenantKey, collected.files)
    if (up.errors.length) result.steps.uploadErrors = up.errors
    log(scenario.id, `uploaded ${up.assetIds.length}/${collected.files.length} assets`)

    // 8. Submit — local dev processes synchronously, so this call runs the whole AI pipeline
    const t0 = Date.now()
    const submitRes = await http('POST', `${cfg.appUrl}/api/public/quotes`, {
      body: {
        tenantKey,
        serviceId,
        customer: scenario.customer,
        job: { postcodeOrZip: scenario.customer.postcode, answers },
        assetIds: up.assetIds,
        source: { type: 'widget', pageUrl: 'http://localhost:3000/hardcore-test' },
      },
      timeoutMs: 600_000,
    })
    // Round 2 plants deliberately mismatched requests — a service-match
    // rejection is a correct OUTCOME there, not a harness failure.
    if (!submitRes.ok && ['SERVICE_MISMATCH', 'SERVICE_NOT_AVAILABLE'].includes(submitRes.json?.error?.code)) {
      saveJson(dir, 'submission.json', submitRes.json)
      result.finalStatus = `rejected:${submitRes.json.error.code}`
      result.checks.push({ level: 'info', name: 'service matching rejected the request', detail: submitRes.json.error.message?.slice(0, 160) })
      log(scenario.id, `service matching rejected: ${submitRes.json.error.code}`)
      saveJson(dir, 'result.json', result)
      return result
    }
    const submit = expectOk('submit quote', submitRes)
    saveJson(dir, 'submission.json', submit)
    result.steps.processingSeconds = Math.round((Date.now() - t0) / 1000)
    const quoteId = submit.quoteId
    const token = new URL(submit.quoteViewUrl).searchParams.get('token')
    result.steps.quoteViewUrl = submit.quoteViewUrl
    log(scenario.id, `quote ${quoteId} processed in ${result.steps.processingSeconds}s`)

    // 9. Poll to a settled state
    let quote = await pollQuote(cfg, quoteId, token)
    saveJson(dir, 'quote-initial.json', quote)
    result.steps.initialStatus = quote.status

    // 10. Clarification round (T-108/T-121, bug #11 path)
    const clarificationLog = []
    if (quote.status === 'awaiting_clarification' && !skipClarify) {
      const questions = quote.clarificationQuestions || []
      let clarifyAnswers, cl
      if (scenario.sim) {
        ;({ answers: clarifyAnswers, log: cl } = await simulateClarifyAnswers({
          apiKey: cfg.geminiKey,
          persona: scenario.persona,
          request: scenario.request,
          questions,
        }))
      } else {
        ;({ answers: clarifyAnswers, log: cl } = answerClarifications(scenario, questions))
      }
      clarificationLog.push(...cl)
      log(scenario.id, `answering ${clarifyAnswers.length} clarification question(s)`)
      expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${quoteId}/clarify`, {
        body: { token, answers: clarifyAnswers },
        timeoutMs: 600_000,
      }))
      quote = await pollQuote(cfg, quoteId, token)
    }
    result.steps.clarificationLog = clarificationLog
    saveJson(dir, 'quote-final.json', quote)

    // 11. Internal detail (signals, pricing trace, quality gate) for deep verification
    const detailRes = await http('GET', `${cfg.appUrl}/api/quotes/${quoteId}`, { headers: authed })
    if (detailRes.ok) saveJson(dir, 'quote-detail-internal.json', detailRes.json)

    // 12. Checks
    result.finalStatus = quote.status
    result.total = quote?.pricing?.total ?? null
    result.grade = quote?.pricing?.estimate?.grade ?? null
    result.range = quote?.pricing?.estimate ? [quote.pricing.estimate.rangeLow, quote.pricing.estimate.rangeHigh] : null
    result.provisional = quote?.provisional ?? null
    result.reference = quote?.reference ?? null
    result.checks = [
      ...commonChecks(scenario, quote),
      ...scenarioChecks(scenario, quote, { clarificationLog }),
    ]
  } catch (err) {
    result.error = String(err?.message || err)
    result.checks.push({ level: 'fail', name: 'scenario aborted', detail: result.error })
    log(scenario.id, `ERROR: ${result.error}`)
  }
  saveJson(dir, 'result.json', result)
  return result
}

function writeReport(results) {
  const lines = []
  lines.push(`# Hardcore E2E Run — ${stamp} (${runId})`, '')
  lines.push('| # | Business | Status | Total | Grade | Range | Checks | Quote page |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    const c = { pass: 0, warn: 0, fail: 0 }
    for (const ch of r.checks) c[ch.level] = (c[ch.level] || 0) + 1
    const c$ = r.currency === 'USD' ? '$' : '£'
    const range = r.range && r.range[0] != null ? `${c$}${r.range[0]}–${c$}${r.range[1]}` : (r.provisional ? `~${c$}${r.provisional.rangeLow}–${c$}${r.provisional.rangeHigh}` : '—')
    lines.push(`| ${r.id} | ${r.business} | ${r.finalStatus || 'ERROR'} | ${r.total != null && r.total > 0 ? c$ + r.total : '—'} | ${r.grade || '—'} | ${range} | ✅${c.pass} ⚠️${c.warn} ❌${c.fail} | ${r.steps?.quoteViewUrl || '—'} |`)
  }
  lines.push('', '## Check details', '')
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.business}`)
    if (r.error) lines.push(`- ❌ ABORTED: ${r.error}`)
    for (const ch of r.checks) {
      const icon = ch.level === 'pass' ? '✅' : ch.level === 'warn' ? '⚠️' : ch.level === 'fail' ? '❌' : 'ℹ️'
      lines.push(`- ${icon} ${ch.name}${ch.detail ? ` — ${ch.detail}` : ''}`)
    }
    if (r.steps?.compileAmbiguities?.length) lines.push(`- ℹ️ compiler ambiguities: ${r.steps.compileAmbiguities.join(' / ')}`)
    if (r.steps?.clarificationLog?.length) for (const q of r.steps.clarificationLog) lines.push(`- 💬 clarified: "${q.question}" → "${q.answer}"`)
    if (r.steps?.processingSeconds) lines.push(`- ⏱ processed in ${r.steps.processingSeconds}s`)
    lines.push('')
  }
  writeFileSync(path.join(outRoot, 'REPORT.md'), lines.join('\n'))
}

let allScenarios = scenarios
if (round2) {
  const { businesses } = await import('./scenarios2.mjs')
  const requests = JSON.parse(readFileSync(path.join(ROOT, 'scripts/hardcore-test/requests2.json'), 'utf8'))
  allScenarios = businesses.map((b) => {
    const r = requests[b.id]
    if (!r) throw new Error(`requests2.json is missing ${b.id}`)
    return {
      ...b,
      sim: true,
      expect: { needsPhotos: false },
      request: r.request,
      persona: r.persona,
      customer: { name: r.customerName, email: r.email, postcode: r.postcode },
    }
  })
}

if (round3) {
  const { businesses } = await import('./scenarios3.mjs')
  const requests = JSON.parse(readFileSync(path.join(ROOT, 'scripts/hardcore-test/requests3.json'), 'utf8'))
  allScenarios = businesses.map((b) => {
    const r = requests[b.id]
    if (!r) throw new Error(`requests3.json is missing ${b.id}`)
    return {
      ...b,
      region: 'US',
      currency: 'USD',
      sim: true,
      expect: { needsPhotos: false, approxTotalRange: b.band },
      request: r.request,
      persona: r.persona,
      customer: { name: r.customerName, email: r.email, postcode: r.postcode },
    }
  })
}

const selected = allScenarios.filter((s) => !only || only.includes(s.id))
console.log(`Running ${selected.length} scenario(s) → ${outRoot}`)
const results = []
for (const s of selected) {
  log(s.id, `=== ${s.business} — ${s.service} ===`)
  results.push(await runScenario(s))
  writeReport(results) // incremental — report is readable mid-run
}
console.log(`\nDone. Report: ${path.join(outRoot, 'REPORT.md')}`)
const failed = results.filter((r) => r.error || r.checks.some((c) => c.level === 'fail'))
if (failed.length) console.log(`Scenarios with hard failures: ${failed.map((r) => r.id).join(', ')}`)
