// T-172 live check: the checker knows the business's settings, small photo
// copies, time limits on AI calls, and the request form's step count.
// Run with the local stack, the web app and the worker up:
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t172.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
//   1  The checker. Four correct quotes go through the real pipeline: one
//      under the business's minimum charge, one with a base fee, one with
//      tax, one in pounds. Each must be priced by the configuration and come
//      back with no finding about money the settings explain. Then the
//      checker is shown two wrong quotes, to prove it still flags. Then the
//      dashboard: a finding from before this change is not shown, a finding
//      made with the settings is, and only to the business it belongs to.
//   2  Small photo copies. A customer adds a photo in a real browser: the
//      browser makes the small copy, the server gives it a private address,
//      and small pictures on the quote page and the dashboard load it. An
//      older photo, a copy that is not an image and a copy that is too big
//      all fall back to the original.
//   3  Time limits. A second worker is started with every limit at 1 ms and
//      prices a request: the quote is sent, at the configured price, with the
//      wording a failed call falls back to, and its log lines carry no
//      customer text.
//   5  The step count, for a form where some services have questions, where
//      none has, where every one has, and with one service.
//
// (Item 4, the colour classes, is checked by the unit tests and by eye:
// before and after screenshots are in the ticket's report.)
//
// Test data uses made-up names.
import path from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, uploadAssets, shortId, saveJson, runStamp } from './lib.mjs'
import { runCheckerCases, isSettingsFlag } from './t172-checker-cases.mts'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { servicePayload } from '../../apps/web/src/lib/onboarding-service'
import { SHOW_WORTH_CHECKING } from '../../apps/web/src/lib/quote-understanding'
import { SMALL_PHOTO_MAX_BYTES, SMALL_PHOTO_MAX_EDGE } from '../../apps/web/src/lib/small-photo'
import { CHECKER_SETTINGS_VERSION } from '../../packages/shared/src/checker'
import { validateQuote, type GeneratedQuoteForValidation, type ServiceConfigForValidation } from '../../apps/worker/src/ai/quote-validator'
import { createAiClient } from '../../apps/worker/src/ai/factory'
import { AI_CALL_TIMEOUTS } from '../../apps/worker/src/ai/timeouts'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t172-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)
const origin = new URL(cfg.appUrl).origin
type Row = Record<string, unknown>
type Draft = Parameters<typeof servicePayload>[0]
const SPRING = garageDoorsPackUS.services.find((s) => s.name === 'Garage Door Spring Replacement')! as unknown as Draft
const LABEL = path.join(ROOT, 'apps/web/public/demo/sample-water-heater-label.png')
const ROOM = path.join(ROOT, 'apps/web/public/demo/sample-room-to-paint.webp')
const raw = (url: string, cookie?: { Cookie: string }) => fetch(url, { headers: cookie, redirect: 'manual' })
/** Where a photo route sends the browser: the object's key, and never the signed address itself */
const servedKey = async (url: string, cookie?: { Cookie: string }) => {
  const res = await raw(url, cookie)
  const location = res.headers.get('location')
  return { status: res.status, key: location ? decodeURIComponent(new URL(location).pathname) : null, location }
}
const bytesAt = async (location: string) => {
  const res = await fetch(location)
  return { status: res.status, type: res.headers.get('content-type') ?? '', bytes: new Uint8Array(await res.arrayBuffer()) }
}

async function business(name: string, settings: { currency?: string; region?: string } = {}) {
  const id = shortId()
  const email = `owner+t172v-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: settings.region ?? 'US', currency: settings.currency ?? 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const slug = (await sb.select('tenants', `id=eq.${tenantId}&select=slug`))[0].slug as string
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, slug }
}
type Biz = Awaited<ReturnType<typeof business>>
/** A service made the way setup makes it. `plain` gives one with no question of its own (a fixed price). */
async function addService(biz: Biz, svc: Draft, opts: { name?: string; plain?: boolean } = {}) {
  const draft = opts.plain
    ? { ...svc.draft, suggestedFields: [], pricing: { ...svc.draft.pricing, workSteps: [{ id: 'visit', name: 'Safety check', description: 'A fixed-price visit', costType: 'fixed' as const, defaultCost: 95, optional: false }] } }
    : svc.draft
  const body = servicePayload({ ...svc, name: opts.name ?? svc.name, draft: draft as Draft['draft'], addons: svc.addons ?? [], multipliers: svc.multipliers ?? [] })
  const created = expectOk(`service ${opts.name ?? svc.name}`, await http('POST', `${cfg.appUrl}/api/services`, { headers: biz.cookie, body: { ...body, mediaConfig: { ...body.mediaConfig, minPhotos: 0 }, autoSend: true, holdUntilApproved: false } }))
  return created.service.id as string
}
const customerOf = (name: string) => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-1212' })
async function submit(biz: Biz, serviceId: string, name: string, answers: unknown[], assetIds: string[] = []) {
  const posted = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer: customerOf(name), job: { postcodeOrZip: '63021', answers }, ...(assetIds.length > 0 && { assetIds }), source: { type: 'widget' } },
    timeoutMs: 300_000,
  }))
  const token = new URL(posted.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, posted.quoteId, token)
  return { id: posted.quoteId as string, token }
}
const quoteRow = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=*`))[0] as Row & { status: string; quote_request_id: string; tenant_id: string; pricing_json: { total: number; subtotal: number; breakdown: Array<{ label: string; amount: number }> }; content_json: Row }
const logsOf = async (id: string) => (await sb.select('quote_validation_logs', `quote_id=eq.${id}&select=id,outcome,input_snapshot,validation_result&order=created_at.asc`)) as Array<Row & { input_snapshot: { serviceConfigVersion?: string } }>
const detail = async (biz: Biz | null, id: string) => {
  const res = await http('GET', `${cfg.appUrl}/api/quotes/${id}`, biz ? { headers: biz.cookie } : {})
  return { status: res.status, json: res.json as (Row & { photos?: Array<{ id: string; url: string; smallUrl?: string }>; understanding?: { checks: Array<{ text: string }> } }) | null }
}

// ====================================================================
section('1. The checker knows the business’s settings')
// ====================================================================
const cases = await runCheckerCases(cfg, sb, 1)
saveJson(outDir, 'checker-cases.json', cases)
for (const c of cases) {
  check(`${c.case}: the quote is priced by the business's configuration (${c.currency} ${c.total})`, c.priceIsRight && c.status === 'sent', { total: c.total, expected: c.expectedTotal, status: c.status })
  check(`${c.case}: the check is marked as made with the settings`, c.settingsVersion === CHECKER_SETTINGS_VERSION && c.settingsVersion === 'v2', c.settingsVersion)
  const falseFlags = c.findings.filter(isSettingsFlag)
  check(`${c.case}: a correct quote gets no finding about its minimum, base fee, tax, currency or total`, c.outcome !== null && falseFlags.length === 0, falseFlags.map((f) => `${f.check}: ${f.description.slice(0, 140)}`))
  if (c.findings.length > falseFlags.length) console.log(`   (other findings on this quote: ${c.findings.filter((f) => !isSettingsFlag(f)).map((f) => f.check).join('; ')})`)
}
check('the four cases cover the minimum, a base fee, tax and a currency other than USD', cases.map((c) => c.case).join(',') === 'minimum,base_fee,tax,currency' && cases[3]!.currency === 'GBP' && cases[2]!.taxAmount > 0 && cases[0]!.total === 400)

// The checker still flags: the same call the worker makes, on quotes that are wrong
{
  const ai = createAiClient('wording', { GEMINI_API_KEY: cfg.geminiKey } as Parameters<typeof createAiClient>[1])
  if (!ai) notChecked.push('1: "the checker still flags a wrong quote" (no AI key in the local env)')
  else {
    const service: ServiceConfigForValidation = {
      serviceName: SPRING.name,
      serviceDescription: SPRING.description,
      scopeIncludes: SPRING.draft.scope.included,
      scopeExcludes: SPRING.draft.scope.excluded,
      workSteps: SPRING.draft.pricing.workSteps as ServiceConfigForValidation['workSteps'],
      addons: SPRING.addons,
      multipliers: [],
      pricingSettings: { currency: 'USD', locale: 'en-US', baseFee: 0, minimumCharge: 400, tax: { enabled: true, label: 'Sales Tax', ratePercent: 8.25 } },
    }
    const content = { scopeSummary: 'Replace both torsion springs as a matched pair and tune up the door.', assumptions: [], exclusions: [], notes: '' } as unknown as GeneratedQuoteForValidation['content']
    const request = { formAnswers: [{ fieldId: 'spring_count', value: 'Two' }], customerDescription: '', photoCount: 0 }
    const pricing = (breakdown: Array<{ label: string; amount: number }>, subtotal: number): GeneratedQuoteForValidation['pricing'] => ({ currency: 'USD', subtotal, taxLabel: 'Sales Tax', taxRate: 8.25, taxAmount: Math.round(subtotal * 8.25) / 100, total: Math.round(subtotal * 108.25) / 100, breakdown, confidence: 1, notes: [] })
    const flagged = async (quote: GeneratedQuoteForValidation, about: RegExp) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = JSON.stringify(quote)
        const result = await validateQuote(ai, quote, request, service)
        if (JSON.stringify(quote) !== before) return { ok: false, why: 'the checker changed the quote it was given' }
        const hit = result.issues.filter((i) => about.test(`${i.check} ${i.description} ${i.found}`))
        if (hit.length > 0) return { ok: true, why: hit[0]!.description.slice(0, 160) }
      }
      return { ok: false, why: 'no finding' }
    }
    // a: the right quote, as a control (the pair of springs is $375, under the $400 minimum, plus tax)
    const right = await validateQuote(ai, { pricing: pricing([{ label: 'Torsion spring replacement (pair)', amount: 375 }, { label: 'Minimum charge applied', amount: 25, kind: 'minimum', minimumCharge: 400 } as { label: string; amount: number }], 400), content }, request, service)
    check('control: the same quote priced correctly (minimum applied, tax added) gets no finding about money', right.issues.filter((i) => isSettingsFlag({ check: i.check, category: i.category, severity: i.severity, description: i.description })).length === 0, right.issues.map((i) => i.description.slice(0, 120)))
    // b: a line the business never configured
    const invented = await flagged({ pricing: pricing([{ label: 'Torsion spring replacement (pair)', amount: 375 }, { label: 'Administration fee', amount: 60 }], 435), content }, /administration fee|invented|not (found )?in (the )?config|unconfigured|unauthori[sz]ed/i)
    check('the checker still flags a line the business never configured (it is told the settings, not told to pass everything)', invented.ok, invented.why)
    // c: a total under the business's minimum charge
    const under = await flagged({ pricing: pricing([{ label: 'Torsion spring replacement (pair)', amount: 200 }], 200), content }, /minimum|underpric|expected|less than|below|375|400/i)
    check('the checker still flags a quote priced under the configuration (a $200 pair, under the $400 minimum)', under.ok, under.why)
  }
}

// The dashboard shows a finding only from a check made with the settings
const a = await business('Ridgeway Home Services')
const rival = await business('Hollow Lane Plumbing')
const springId = await addService(a, SPRING)
const shown = await submit(a, springId, 'Marta Okafor', [{ fieldId: 'spring_count', value: 'Two' }])
{
  const row = await quoteRow(shown.id)
  const OLD = 'T-172 test finding made before the settings were known.'
  const NEW = 'T-172 test finding made with the settings.'
  const logRow = (text: string, version: string | undefined) => ({
    quote_id: shown.id,
    tenant_id: a.tenantId,
    service_id: springId,
    input_snapshot: { formAnswers: [], photoCount: 0, ...(version && { serviceConfigVersion: version }) },
    original_quote_snapshot: { total: row.pricing_json.total, breakdown: row.pricing_json.breakdown },
    validation_result: { overallStatus: 'REVIEW_NEEDED', confidenceScore: 0.9, issues: [{ id: 'ISSUE-001', category: 'scope', severity: 'medium', check: 'CHECK 2: SCOPE TEXT VALIDATION', description: text, found: 'x', expected: 'y', autoFixable: false }], summary: { criticalCount: 0, highCount: 0, mediumCount: 1, lowCount: 0 } },
    outcome: 'passed_with_issues',
  })
  check('"Worth checking" is switched on (correct quotes came back with no false flag)', SHOW_WORTH_CHECKING === true)
  await sb.insert('quote_validation_logs', logRow(OLD, 'v1'))
  let d = await detail(a, shown.id)
  check('a finding from a check made before this change (marked v1) is not shown', d.status === 200 && (d.json?.understanding?.checks ?? []).length === 0 && !JSON.stringify(d.json).includes(OLD), d.json?.understanding?.checks)
  await sb.insert('quote_validation_logs', logRow(OLD, undefined))
  d = await detail(a, shown.id)
  check('nor is one with no mark at all', (d.json?.understanding?.checks ?? []).length === 0 && !JSON.stringify(d.json).includes(OLD))
  await sb.insert('quote_validation_logs', logRow(NEW, CHECKER_SETTINGS_VERSION))
  d = await detail(a, shown.id)
  check('a finding from a check made with the settings is shown under "Worth checking"', (d.json?.understanding?.checks ?? []).length === 1 && d.json!.understanding!.checks[0]!.text === NEW && !JSON.stringify(d.json).includes(OLD), d.json?.understanding?.checks)
  // a newer old-style row does not hide it, and is not shown in its place
  await sb.insert('quote_validation_logs', logRow(OLD, 'v1'))
  d = await detail(a, shown.id)
  check('an older-style row written later changes nothing', (d.json?.understanding?.checks ?? []).length === 1 && d.json!.understanding!.checks[0]!.text === NEW)
  const other = await detail(rival, shown.id)
  check('another business cannot read the quote or its findings', other.status === 404 && !JSON.stringify(other.json).includes(NEW), other.status)
  const after = await quoteRow(shown.id)
  check('AD-049: showing a finding changed nothing on the quote', JSON.stringify(after.pricing_json) === JSON.stringify(row.pricing_json) && after.status === row.status)
}

// ====================================================================
section('3. Time limits on the wording, add-on and checker calls')
// ====================================================================
{
  const PORT = 8799
  const DESCRIPTION = 'Zebra-striped garage door, the spring snapped loudly at breakfast.'
  const NAME = 'Tomas Albrecht'
  // first, as usual, on the normal worker: the price to hold the capped run to, and wording from the AI
  const first = await submit(a, springId, NAME, [{ fieldId: 'spring_count', value: 'Two' }, { fieldId: '_project_description', value: DESCRIPTION }])
  const before = await quoteRow(first.id)
  const logsBefore = await logsOf(first.id)
  check('(a request with the customer’s own words is priced at the configured $375 by the normal worker, and checked)', before.pricing_json.total === 375 && before.status === 'sent' && logsBefore.length === 1, { total: before.pricing_json.total, logs: logsBefore.length })

  let output = ''
  const worker = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--inspector-port', '9339', ...Object.values(AI_CALL_TIMEOUTS).flatMap((t) => ['--var', `${t.env}:1`])], { cwd: path.join(ROOT, 'apps/worker'), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  worker.stdout.on('data', (d: Buffer) => { output += d.toString() })
  worker.stderr.on('data', (d: Buffer) => { output += d.toString() })
  const stop = () => { try { process.kill(-worker.pid!, 'SIGTERM') } catch { /* already gone */ } }
  process.on('exit', stop)
  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      up = await fetch(`http://localhost:${PORT}/health`).then((r) => r.ok).catch(() => false)
    }
    check('(a second worker started with each of the three limits set to 1 ms by its env var)', up, up ? undefined : output.slice(-300))
    if (up) {
      const res = await http('POST', `http://localhost:${PORT}/process`, { body: { quoteId: first.id, quoteRequestId: before.quote_request_id, tenantId: before.tenant_id, quoteToken: first.token }, timeoutMs: 120_000 })
      await new Promise((r) => setTimeout(r, 1500))
      const after = await quoteRow(first.id)
      const timedOut = (call: string) => output.includes(`[AI] ${call} timed out after 1 ms; continuing with the fallback`)
      check('every one of the three calls timed out', timedOut('wording') && timedOut('addons') && timedOut('checker'), { wording: timedOut('wording'), addons: timedOut('addons'), checker: timedOut('checker') })
      check('the quote was not blocked and did not fail: the worker answered success and the quote is sent', res.status === 200 && res.json?.success === true && after.status === 'sent', { http: res.status, status: after.status })
      check('the price is the configured one, to the cent, with the same lines', after.pricing_json.total === 375 && JSON.stringify(after.pricing_json.breakdown.map((b) => [b.label, b.amount])) === JSON.stringify(before.pricing_json.breakdown.map((b) => [b.label, b.amount])) && after.pricing_json.subtotal === before.pricing_json.subtotal, { before: before.pricing_json.total, after: after.pricing_json.total })
      const scope = String((after.content_json as { scopeSummary?: string }).scopeSummary ?? '')
      check('the wording is the fallback a failed call already uses: the quote still has a scope, and it is not the AI’s text', scope.length > 20 && scope !== String((before.content_json as { scopeSummary?: string }).scopeSummary ?? '') && output.includes('Wording generation failed, using fallback'), scope.slice(0, 90))
      const logsAfter = await logsOf(first.id)
      check('a check that did not finish writes no log row (so it is never shown as "passed")', logsAfter.length === logsBefore.length, { before: logsBefore.length, after: logsAfter.length })
      const lines = output.split('\n').filter((l) => /timed out|failed/i.test(l))
      const leaks = lines.filter((l) => /zebra|breakfast|snapped|albrecht|tomas|example\.com|555/i.test(l))
      check(`the ${lines.length} log lines about a timeout or a failed call carry no customer text`, lines.length >= 3 && leaks.length === 0, leaks.map((l) => l.slice(0, 120)))
      saveJson(outDir, 'timeout-log-lines.json', lines.map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 200)))
    }
  } finally {
    stop()
  }
}

// ====================================================================
section('2 and 5 need a browser')
// ====================================================================
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Items 2 and 5: they are a browser pass. Set PLAYWRIGHT_DIR to run them.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  type Ctx = Awaited<ReturnType<typeof browser.newContext>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  const contextFor = async (width: number, cookie?: string) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 900 } })
    await ctx.addInitScript('globalThis.__name = (f) => f')
    if (cookie) await ctx.addCookies(cookie.split('; ').map((pair) => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: origin } }))
    return ctx
  }
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
  /** Click until the page answers: a click before the form is live does nothing */
  const choose = async (p: Page, name: string, then: string) => {
    for (let i = 0; i < 6; i++) {
      await p.getByRole('button', { name, exact: true }).click().catch(() => {})
      if (await p.getByText(then).first().isVisible().catch(() => false)) return
      await p.waitForTimeout(700)
    }
    await p.getByText(then).first().waitFor({ timeout: 10_000 })
  }
  const bar = (p: Page) => p.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel) as HTMLElement | null
    const visible = (el: HTMLElement | null) => !!el && el.getBoundingClientRect().height > 0
    const full = q('[data-testid=step-bar-full]')
    return {
      unknown: q('[data-testid=step-bar]')?.getAttribute('data-count') === 'unknown',
      count: visible(q('[data-testid=step-count]')) ? q('[data-testid=step-count]')!.innerText : null,
      name: visible(q('[data-testid=step-name]')) ? q('[data-testid=step-name]')!.innerText : null,
      labels: visible(full) ? [...full!.querySelectorAll('[data-testid=step-label]')].map((l) => (l as HTMLElement).innerText.toLowerCase()) : null,
      parts: visible(q('[data-testid=step-bar-compact]')) ? q('[data-testid=step-bar-compact]')!.querySelectorAll('[aria-hidden=true] > span').length : null,
      words: (q('[data-testid=step-bar]')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  // ------------------------------------------------------------------
  section('2. Small photo copies')
  // ------------------------------------------------------------------
  {
    const original = readFileSync(LABEL)
    const ctx = await contextFor(390)
    const p = await ctx.newPage()
    await p.goto(`${cfg.appUrl}/quote/${a.slug}`, { waitUntil: 'networkidle' })
    await p.getByLabel('Your name').waitFor({ timeout: 30_000 })
    await p.getByLabel('Your name').fill('Wanda Pemberton')
    await p.getByLabel('Email').fill('wanda.pemberton@example.com')
    await p.getByLabel('Phone').fill('(555) 201-5656')
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('About the job').waitFor({ timeout: 15_000 })
    for (const group of await p.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').nth(1).click()
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('Photos & Documents').waitFor({ timeout: 15_000 })
    const sent: Array<{ method: string; type: string | undefined; size: number; small: boolean; status?: number }> = []
    let init: { request: Row; response: Row } | null = null
    p.on('requestfinished', async (req) => {
      if (req.url().includes('/api/public/uploads/init')) init = { request: req.postDataJSON() as Row, response: (await (await req.response())!.json()) as Row }
      else if (req.method() === 'PUT') sent.push({ method: 'PUT', type: req.headers()['content-type'], size: Number((await req.allHeaders())['content-length'] ?? 0), small: decodeURIComponent(new URL(req.url()).pathname).endsWith('.small'), status: (await req.response())?.status() })
    })
    await p.locator('[data-testid=photo-input]').setInputFiles(LABEL)
    await p.waitForFunction(() => document.querySelectorAll('[data-testid=request-form] img[src^="blob:"]').length >= 1, undefined, { timeout: 30_000 })
    for (let i = 0; i < 40 && sent.length < 2; i++) await p.waitForTimeout(500)
    const file = ((init as { request: Row } | null)?.request.files as Row[] | undefined)?.[0] as { sizeBytes: number; small?: { contentType: string; sizeBytes: number } } | undefined
    const up = ((init as { response: Row } | null)?.response.uploads as Row[] | undefined)?.[0] as { assetId: string; uploadUrl: string; smallUploadUrl?: string } | undefined
    check('the browser made a small copy and told the server its type and size', !!file?.small && ['image/webp', 'image/jpeg'].includes(file.small.contentType) && file.small.sizeBytes > 0 && file.small.sizeBytes <= SMALL_PHOTO_MAX_BYTES, file?.small)
    check('the server gave the small copy its own signed address, beside the original’s, in the same tenant folder', !!up?.smallUploadUrl && decodeURIComponent(new URL(up.smallUploadUrl).pathname) === `${decodeURIComponent(new URL(up.uploadUrl).pathname)}.small` && decodeURIComponent(new URL(up.uploadUrl).pathname).includes(`/${a.tenantId}/`) && /X-Amz-Signature=/.test(up.smallUploadUrl))
    const big = sent.find((s) => !s.small)
    const small = sent.find((s) => s.small)
    check(`the original went up whole (${big?.size} bytes) and the small copy beside it (${small?.size} bytes, ${small?.type})`, sent.length === 2 && big?.size === original.byteLength && big.status === 200 && !!small && small.status === 200 && small.size === file?.small?.sizeBytes && small.size < original.byteLength / 3, sent)
    await shot(p, 'photo-step-390')
    await ctx.close()
    const assetId = up!.assetId
    const older = await uploadAssets(cfg, a.tenantKey, [{ path: ROOM, fileName: 'room.webp', contentType: 'image/webp' }])
    check('(a second photo was uploaded the old way, with no small copy)', older.assetIds.length === 1, older.errors)

    // Refusals at the upload route: the photo still uploads, the small copy gets no address
    const initWith = async (small: unknown) => (expectOk('init', await http('POST', `${cfg.appUrl}/api/public/uploads/init`, { body: { tenantKey: a.tenantKey, files: [{ fileName: 'room.webp', contentType: 'image/webp', sizeBytes: readFileSync(ROOM).byteLength, small }] } })).uploads as Array<{ assetId: string; uploadUrl: string; smallUploadUrl?: string }>)[0]!
    const refused: Record<string, boolean> = {}
    for (const [why, small] of [['too big', { contentType: 'image/webp', sizeBytes: SMALL_PHOTO_MAX_BYTES + 1 }], ['a PNG', { contentType: 'image/png', sizeBytes: 9000 }], ['an HTML page', { contentType: 'text/html', sizeBytes: 300 }], ['an SVG', { contentType: 'image/svg+xml', sizeBytes: 300 }], ['no size', { contentType: 'image/webp' }]] as const) {
      const u = await initWith(small)
      refused[why] = Boolean(u.assetId && u.uploadUrl) && u.smallUploadUrl === undefined
    }
    check('a small copy declared too big, or as anything but a WebP or JPEG, gets no address; the photo itself is accepted as before', Object.values(refused).every(Boolean), refused)
    const pdf = expectOk('init pdf', await http('POST', `${cfg.appUrl}/api/public/uploads/init`, { body: { tenantKey: a.tenantKey, files: [{ fileName: 'plan.pdf', contentType: 'application/pdf', sizeBytes: 5000, small: { contentType: 'image/webp', sizeBytes: 300 } }] } })).uploads[0] as { smallUploadUrl?: string }
    check('a document gets no small copy', pdf.smallUploadUrl === undefined)
    const limits = await http('POST', `${cfg.appUrl}/api/public/uploads/init`, { body: { tenantKey: a.tenantKey, files: [{ fileName: 'huge.jpg', contentType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 }] } })
    const many = await http('POST', `${cfg.appUrl}/api/public/uploads/init`, { body: { tenantKey: a.tenantKey, files: Array.from({ length: 11 }, (_, i) => ({ fileName: `p${i}.jpg`, contentType: 'image/jpeg', sizeBytes: 1000 })) } })
    check('upload limits are unchanged: a photo over 10 MB and an 11th file are refused', limits.status === 400 && many.status === 400 && many.json?.error?.code === 'TOO_MANY_FILES', { tooBig: limits.status, tooMany: many.json?.error?.code })

    // What is in storage is checked before it is served: two lying uploads
    const lieHtml = await initWith({ contentType: 'image/webp', sizeBytes: 300 })
    const roomBytes = new Uint8Array(readFileSync(ROOM))
    await http('PUT', lieHtml.uploadUrl, { headers: { 'Content-Type': 'image/webp' }, body: roomBytes })
    const putHtml = await http('PUT', lieHtml.smallUploadUrl!, { headers: { 'Content-Type': 'image/webp' }, body: new TextEncoder().encode('<!doctype html><script>document.title="not a photo"</script>') })
    const lieBig = await initWith({ contentType: 'image/webp', sizeBytes: 300 })
    await http('PUT', lieBig.uploadUrl, { headers: { 'Content-Type': 'image/webp' }, body: roomBytes })
    const padded = new Uint8Array(SMALL_PHOTO_MAX_BYTES + 4096)
    padded.set(roomBytes.slice(0, 4096))
    const putBig = await http('PUT', lieBig.smallUploadUrl!, { headers: { 'Content-Type': 'image/webp' }, body: padded })
    check('(two dishonest small copies were stored: an HTML page sent as WebP, and a WebP over the size limit)', putHtml.status === 200 && putBig.status === 200, { html: putHtml.status, big: putBig.status })

    const q = await submit(a, springId, 'Wanda Pemberton', [{ fieldId: 'spring_count', value: 'Two' }], [assetId, older.assetIds[0]!, lieHtml.assetId, lieBig.assetId])
    const keyOf = async (id: string) => (await sb.select('assets', `id=eq.${id}&select=r2_key,size_bytes`))[0] as { r2_key: string; size_bytes: number }
    const [k1, k2, k3, k4] = await Promise.all([assetId, older.assetIds[0]!, lieHtml.assetId, lieBig.assetId].map(keyOf))
    const assetRows = await sb.select('assets', `tenant_id=eq.${a.tenantId}&select=id,r2_key`)
    check('a small copy is not an asset: no row of its own, so it counts toward no limit and the AI is never given it', (assetRows as Array<{ r2_key: string }>).every((r) => !r.r2_key.endsWith('.small')))

    // the customer's quote page
    const pub = (id: string, size?: string) => `${cfg.appUrl}/api/public/assets/${id}?token=${q.token}${size ? `&size=${size}` : ''}`
    const s1 = await servedKey(pub(assetId, 'small'))
    const f1 = await servedKey(pub(assetId))
    check('customer page: the small size is the small copy; the photo’s own link is still the original', s1.status >= 300 && s1.status < 400 && s1.key?.endsWith(`${k1!.r2_key}.small`) === true && f1.key?.endsWith(k1!.r2_key) === true && !f1.key!.endsWith('.small'), { small: s1.status, full: f1.status })
    const smallBytes = s1.location ? await bytesAt(s1.location) : null
    const fullBytes = f1.location ? await bytesAt(f1.location) : null
    const isWebp = !!smallBytes && String.fromCharCode(...smallBytes.bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...smallBytes.bytes.slice(8, 12)) === 'WEBP'
    const isJpeg = !!smallBytes && smallBytes.bytes[0] === 0xff && smallBytes.bytes[1] === 0xd8
    check(`the small copy is a real image of ${smallBytes?.bytes.length} bytes; the original is ${fullBytes?.bytes.length} bytes, untouched`, !!smallBytes && smallBytes.status === 200 && (isWebp || isJpeg) && smallBytes.bytes.length <= SMALL_PHOTO_MAX_BYTES && fullBytes?.bytes.length === original.byteLength && Buffer.from(fullBytes.bytes).equals(original), { small: smallBytes?.bytes.length, original: fullBytes?.bytes.length })
    const s2 = await servedKey(pub(older.assetIds[0]!, 'small'))
    check('a photo uploaded without a small copy falls back to the original', s2.key?.endsWith(k2!.r2_key) === true && !s2.key!.endsWith('.small'))
    const s3 = await servedKey(pub(lieHtml.assetId, 'small'))
    const s4 = await servedKey(pub(lieBig.assetId, 'small'))
    check('a small copy that is not an image is never served: the original is', s3.key?.endsWith(k3!.r2_key) === true && !s3.key!.endsWith('.small'))
    check('a small copy over the size limit is never served: the original is', s4.key?.endsWith(k4!.r2_key) === true && !s4.key!.endsWith('.small'))
    const noToken = await raw(`${cfg.appUrl}/api/public/assets/${assetId}?size=small`)
    const wrongToken = await raw(`${cfg.appUrl}/api/public/assets/${assetId}?token=${'0'.repeat(64)}&size=small`)
    check('the token check is unchanged for the small size: none is 401, a wrong one 403', noToken.status === 401 && wrongToken.status === 403, { none: noToken.status, wrong: wrongToken.status })
    check('storage stays private: every address a photo route answers with is signed and short-lived', [s1, f1, s2, s3, s4].every((s) => /X-Amz-Signature=/.test(s.location ?? '') && /X-Amz-Expires=\d+/.test(s.location ?? '')))
    const unsigned = s1.location ? await fetch(s1.location.split('?')[0]!) : null
    check('the small copy cannot be read without its signature', !!unsigned && unsigned.status >= 400, unsigned?.status)

    // the dashboard
    const dash = (id: string, size?: string) => `${cfg.appUrl}/api/quotes/${q.id}/photos/${id}${size ? `?size=${size}` : ''}`
    const d1 = await servedKey(dash(assetId, 'small'), a.cookie)
    const d1full = await servedKey(dash(assetId), a.cookie)
    const d2 = await servedKey(dash(older.assetIds[0]!, 'small'), a.cookie)
    check('dashboard: the small size is the small copy, the larger view the original, and an older photo the original', d1.status === 302 && d1.key?.endsWith(`${k1!.r2_key}.small`) === true && d1full.key?.endsWith(k1!.r2_key) === true && !d1full.key!.endsWith('.small') && d2.key?.endsWith(k2!.r2_key) === true && !d2.key!.endsWith('.small'))
    const signedOut = await raw(dash(assetId, 'small'))
    const asRival = await raw(dash(assetId, 'small'), rival.cookie)
    check('dashboard: signed out gets 401 and another business 404, for the small size as for the full one', signedOut.status === 401 && asRival.status === 404, { signedOut: signedOut.status, rival: asRival.status })
    const det = await detail(a, q.id)
    check('the quote API lists each photo with the address of its small size, both paths on our own site', (det.json?.photos ?? []).length === 4 && det.json!.photos!.every((ph) => ph.smallUrl === `${ph.url}?size=small` && ph.url.startsWith('/api/quotes/')) && !/X-Amz-|r2\.cloudflarestorage|r2_key/.test(JSON.stringify(det.json)), det.json?.photos?.[0])

    // in a browser: what a small picture actually loads
    for (const width of [390, 1440]) {
      const c = await contextFor(width, a.cookieHeader)
      const page = await c.newPage()
      await page.goto(`${cfg.appUrl}/q/${q.id}?token=${q.token}`, { waitUntil: 'networkidle' })
      await page.locator('img[alt="Attached photo"]').first().waitFor({ timeout: 20_000 })
      await page.waitForFunction(() => [...document.querySelectorAll('img[alt="Attached photo"]')].every((i) => (i as HTMLImageElement).complete), undefined, { timeout: 30_000 })
      const grid = await page.locator('img[alt="Attached photo"]').evaluateAll((imgs) => imgs.map((i) => { const im = i as HTMLImageElement; const r = im.getBoundingClientRect(); return { src: im.getAttribute('src') ?? '', href: im.closest('a')?.getAttribute('href') ?? '', w: im.naturalWidth, h: im.naturalHeight, shown: Math.round(r.width) } }))
      check(`${width} quote page: every small picture asks for the small size, and its link opens the original`, grid.length === 4 && grid.every((g) => /[?&]size=small$/.test(g.src) && !/size=small/.test(g.href) && g.href.length > 0), grid.map((g) => g.shown))
      // the grid is in the page's own order: find each photo by its id
      const withCopy = grid.find((g) => g.src.includes(assetId))
      const olderOne = grid.find((g) => g.src.includes(older.assetIds[0]!))
      check(`${width} quote page: the photo with a small copy loads at ${withCopy?.w}×${withCopy?.h} (at most ${SMALL_PHOTO_MAX_EDGE} px a side), sharp for the ${withCopy?.shown} px it is shown at; the older photo still loads, as the original`, !!withCopy && withCopy.w > 0 && Math.max(withCopy.w, withCopy.h) <= SMALL_PHOTO_MAX_EDGE && withCopy.w >= Math.min(withCopy.shown, 240) && !!olderOne && olderOne.w > SMALL_PHOTO_MAX_EDGE, grid.map((g) => `${g.w}x${g.h}`))
      await shot(page, `quote-page-photos-${width}`)

      await page.goto(`${cfg.appUrl}/app/quotes/${q.id}`, { waitUntil: 'networkidle' })
      await page.locator('[data-testid=customer-photo] img').first().waitFor({ timeout: 20_000 })
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=customer-photo] img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0), undefined, { timeout: 30_000 })
      const thumbs = await page.locator('[data-testid=customer-photo] img').evaluateAll((imgs) => imgs.map((i) => ({ src: i.getAttribute('src') ?? '', w: (i as HTMLImageElement).naturalWidth, h: (i as HTMLImageElement).naturalHeight })))
      await page.locator('[data-testid=customer-photo]').first().click()
      await page.locator('[data-testid=photo-viewer-image]').waitFor({ timeout: 10_000 })
      await page.waitForFunction(() => (document.querySelector('[data-testid=photo-viewer-image]') as HTMLImageElement | null)?.naturalWidth, undefined, { timeout: 30_000 })
      const viewer = await page.locator('[data-testid=photo-viewer-image]').evaluate((i) => ({ src: i.getAttribute('src') ?? '', w: (i as HTMLImageElement).naturalWidth }))
      check(`${width} dashboard: the small pictures load the small size (${thumbs[0]?.w}×${thumbs[0]?.h}); opened larger, the photo is the original (${viewer.w} px wide)`, thumbs.length === 4 && thumbs.every((t) => /\?size=small$/.test(t.src)) && Math.max(thumbs[0]!.w, thumbs[0]!.h) <= SMALL_PHOTO_MAX_EDGE && !/size=small/.test(viewer.src) && viewer.w > SMALL_PHOTO_MAX_EDGE, { thumbs: thumbs.map((t) => t.w), viewer: viewer.w })
      await page.keyboard.press('Escape')
      await page.goto(`${cfg.appUrl}/app/quotes`, { waitUntil: 'networkidle' })
      await page.locator('[data-testid=quote-thumb]').first().waitFor({ timeout: 20_000 })
      const rowThumb = await page.locator('[data-testid=quote-thumb]').first().getAttribute('src')
      check(`${width} quotes list: a row's 48 px photo asks for the small size`, /\?size=small$/.test(rowThumb ?? ''), rowThumb?.replace(/qte_\w+|ast_\w+/g, '…'))
      await c.close()
    }
    saveJson(outDir, 'small-photo.json', { originalBytes: original.byteLength, smallBytes: smallBytes?.bytes.length, type: smallBytes?.type })
  }

  // ------------------------------------------------------------------
  section('5. The form’s step count')
  // ------------------------------------------------------------------
  {
    // some services have questions and some do not
    const mixed = await business('Kestrel Door Company')
    await addService(mixed, SPRING)
    await addService(mixed, SPRING, { name: 'Garage Door Safety Check', plain: true })
    // no service has questions
    const none = await business('Larch Lane Doors')
    await addService(none, SPRING, { name: 'Garage Door Safety Check', plain: true })
    await addService(none, SPRING, { name: 'Garage Door Tune-Up', plain: true })
    // every service has questions: business `a` gets a second service with the spring question
    await addService(a, SPRING, { name: 'Garage Door Spring Check' })
    // one service
    const one = await business('Hartwell Garage Doors')
    await addService(one, SPRING)
    const cfgOf = async (b: Biz) => expectOk('widget config', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${b.tenantKey}`)) as { services: Array<{ id: string; name: string }>; globalFields?: unknown[]; serviceFields?: Record<string, unknown[]> }
    const asking = async (b: Biz) => { const c = await cfgOf(b); return c.services.map((s) => (c.globalFields ?? []).length + ((c.serviceFields ?? {})[s.id] ?? []).length > 0) }
    check('(the four forms: some services with questions, none, every one, and a single service)', JSON.stringify([await asking(mixed), await asking(none), await asking(a), await asking(one)]) === JSON.stringify([[true, false], [false, false], [true, true], [true]]) || JSON.stringify((await asking(mixed)).sort()) === JSON.stringify([false, true]), [await asking(mixed), await asking(none), await asking(a), await asking(one)])

    for (const width of [390, 1440]) {
      const ctx = await contextFor(width)
      const p = await ctx.newPage()
      const open = async (b: Biz, waitFor: string) => {
        await p.goto(`${cfg.appUrl}/quote/${b.slug}`, { waitUntil: 'networkidle' })
        await p.getByRole(waitFor === 'Your name' ? 'textbox' : 'button', { name: waitFor, exact: waitFor !== 'Your name' }).first().waitFor({ timeout: 30_000 })
        return bar(p)
      }
      const CONTACT = 'Where should we send your estimate?'

      // some: the first step shows only its name
      let b = await open(mixed, 'Garage Door Safety Check')
      check(`${width} some services have questions: the first step shows only its name, "Service": no "Step 1 of", no bar parts, no numbered steps`, b.unknown && b.name === 'Service' && b.count === null && b.labels === null && b.parts === null && b.words === 'Service' && !/\d/.test(b.words) && b.sideways <= 0, b)
      await shot(p, `steps-some-first-${width}`)
      await choose(p, 'Garage Door Spring Replacement', CONTACT)
      b = await bar(p)
      if (width < 640) check(`${width} ... then the service with a question: the count starts at "Step 2 of 5"`, !b.unknown && b.count === 'Step 2 of 5' && b.name === 'Contact' && b.parts === 5, b)
      else check(`${width} ... then the service with a question: five numbered steps, Questions among them`, !b.unknown && b.labels?.join(',') === 'service,contact,questions,photos,details', b.labels)
      await shot(p, `steps-some-second-${width}`)
      // back to the first step: a service is highlighted now, and the total is still not promised
      await p.getByRole('button', { name: /^Back$/ }).click()
      await p.getByRole('button', { name: 'Garage Door Safety Check', exact: true }).waitFor({ timeout: 10_000 })
      b = await bar(p)
      check(`${width} ... back on the first step, with a service already chosen, it still shows only its name`, b.unknown && b.count === null && b.words === 'Service', b)
      await choose(p, 'Garage Door Safety Check', CONTACT)
      b = await bar(p)
      if (width < 640) check(`${width} ... and the service with no question: "Step 2 of 4"`, b.count === 'Step 2 of 4' && b.name === 'Contact' && b.parts === 4, b)
      else check(`${width} ... and the service with no question: four numbered steps, no Questions`, b.labels?.join(',') === 'service,contact,photos,details', b.labels)

      // none: the total is known from the first step
      b = await open(none, 'Garage Door Safety Check')
      if (width < 640) check(`${width} no service has questions: the first step reads "Step 1 of 4"`, !b.unknown && b.count === 'Step 1 of 4' && b.name === 'Service' && b.parts === 4, b)
      else check(`${width} no service has questions: the first step shows four numbered steps`, !b.unknown && b.labels?.join(',') === 'service,contact,photos,details', b.labels)
      await choose(p, 'Garage Door Tune-Up', CONTACT)
      const none2 = await bar(p)
      check(`${width} ... and the second step shows the same total`, width < 640 ? none2.count === 'Step 2 of 4' : none2.labels?.length === 4, width < 640 ? none2.count : none2.labels)

      // every: the total is known from the first step, and counts Questions
      b = await open(a, 'Garage Door Spring Check')
      if (width < 640) check(`${width} every service has questions: the first step reads "Step 1 of 5" (it read "Step 1 of 4")`, !b.unknown && b.count === 'Step 1 of 5' && b.name === 'Service' && b.parts === 5, b)
      else check(`${width} every service has questions: the first step shows five numbered steps, Questions among them`, !b.unknown && b.labels?.join(',') === 'service,contact,questions,photos,details', b.labels)
      await shot(p, `steps-every-first-${width}`)
      await choose(p, 'Garage Door Spring Check', CONTACT)
      const every2 = await bar(p)
      check(`${width} ... and the second step shows the same total`, width < 640 ? every2.count === 'Step 2 of 5' : every2.labels?.length === 5, width < 640 ? every2.count : every2.labels)

      // one service: no first step to choose on
      b = await open(one, 'Your name')
      if (width < 640) check(`${width} one service: the form starts at "Step 1 of 4" with Contact, as before`, !b.unknown && b.count === 'Step 1 of 4' && b.name === 'Contact', b)
      else check(`${width} one service: four numbered steps from the start (contact, questions, photos, details)`, !b.unknown && b.labels?.join(',') === 'contact,questions,photos,details', b.labels)
      await ctx.close()
    }
  }
  await browser.close()
}

saveJson(outDir, 'checks.json', checks)
if (notChecked.length) console.log(`\nNot checked:\n- ${notChecked.join('\n- ')}`)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
