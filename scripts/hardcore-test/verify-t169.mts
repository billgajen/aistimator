// T-169 live check: the dashboard shows what the AI understood and the
// customer's photos, and works on a phone.
// Run (local stack up: supabase, web, worker):
//   PLAYWRIGHT_DIR=~/qolumns-browser npx tsx scripts/hardcore-test/verify-t169.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
// Optional: WEB_LOG=<the web server's log file> also checks that no signed
// photo address and no customer email was written to it.
//
// What is real and what is set by hand:
// - REAL: one water heater request with the sample label photo goes through
//   the real pipeline (upload, label reading, the question, the customer's
//   answer, the re-price), and one garage door request with no photo.
// - BY HAND: copies of the garage door quote with the stored fields set, so
//   each case is known exactly: a quote the AI produced nothing for, and a
//   quote with a detected extra, a "may also need" note and a quote checker
//   log row (written the way the worker writes it; the checker itself is
//   not changed and not called here).
//
// 1. the data: the quote API's `understanding` and `photos`, for each case;
// 2. the photos: signed-in only, this business only, a signed address that
//    is not ours, and nothing for another business;
// 3. nothing changed a price (AD-001) and the checker's log changed no quote (AD-049);
// 4. the pages at 390 and 1440: the quote page's order and total, the photos
//    and their larger view from the keyboard, the panel absent, another
//    business's quote not visible, Home and the quotes list thumbnails, the
//    small lines on Home, Services on a phone, names and tap targets, and the
//    home page demo's frame headers.
import path from 'node:path'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, uploadAssets, shortId, saveJson, runStamp } from './lib.mjs'
import { browserDeps } from './browser.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { waterHeaterPackUS } from '../../apps/web/src/lib/vertical-packs/water-heater-us'
import { UNDERSTOOD_COPY, SHOW_WORTH_CHECKING } from '../../apps/web/src/lib/quote-understanding'
import { formatMoney } from '../../packages/shared/src/format'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t169-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)
const sha = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const origin = new URL(cfg.appUrl).origin

async function business(name: string) {
  const id = shortId()
  const email = `owner+t169-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: cookie,
    body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name }
}
type Biz = Awaited<ReturnType<typeof business>>

type PackService = (typeof waterHeaterPackUS.services)[number]
async function serviceFrom(biz: Biz, svc: PackService) {
  const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
    },
  }))
  return created.service.id as string
}
// Made-up people (never a real name, never "Claude")
const customerOf = (n: string) => ({ name: n, email: `${n.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-1212' })

async function submit(biz: Biz, serviceId: string, customer: ReturnType<typeof customerOf>, answers: unknown[], assetIds: string[] = []) {
  const post = () => http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers }, ...(assetIds.length > 0 && { assetIds }), source: { type: 'widget' } },
    timeoutMs: 300_000,
  })
  let posted
  try {
    posted = await post()
  } catch {
    console.log(`⏳ the submission for ${customer.name} stalled; retrying once`)
    posted = await post()
  }
  const res = expectOk('submit', posted)
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token }
}
type Row = Record<string, unknown>
type QuoteRow = Row & { id: string; status: string; customer_json: Row; pricing_json: { total: number; breakdown: Row[] } & Row; content_json: Row; signals_json: Row }
const fullRow = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=*`))[0] as QuoteRow
/** A copy of a real quote under a new customer, with stored fields set by hand */
async function copyOf(sourceId: string, customerName: string, overrides: Row = {}) {
  const { id: _id, ...source } = await fullRow(sourceId)
  const created = await sb.insert('quotes', {
    ...source,
    customer_json: { ...source.customer_json, ...customerOf(customerName) },
    quote_token_hash: sha(newToken()),
    previous_token_hash: null,
    link_token_hashes: [],
    reminder_sent_at: null,
    ...overrides,
  })
  return created.id as string
}
const detail = async (biz: Biz | null, id: string) => {
  const res = await http('GET', `${cfg.appUrl}/api/quotes/${id}`, biz ? { headers: biz.cookie } : {})
  return { status: res.status, json: res.json as (Row & { photos?: Array<{ id: string; url: string }>; understanding?: { photos: Row[]; words: Row[]; alsoNoted: Row[]; asked: Row[]; checks: Row[]; checksBeforeChange: boolean } }) | null }
}
const raw = (url: string, cookie?: { Cookie: string }) => fetch(url, { headers: cookie, redirect: 'manual' })

// ====================================================================
section('Setup: a business, its two services, and a rival')
// ====================================================================
const a = await business('Ridgeway Home Services')
const rival = await business('Hollow Lane Plumbing')
const heaterSvc = await serviceFrom(a, waterHeaterPackUS.services[0]!)
const doorSvc = await serviceFrom(a, garageDoorsPackUS.services[0]! as unknown as PackService)

// REAL 1: a water heater request with the sample label photo
const labelPath = path.join(ROOT, 'apps/web/public/demo/sample-water-heater-label.png')
const upload = await uploadAssets(cfg, a.tenantKey, [{ path: labelPath, fileName: 'sample-water-heater-label.png', contentType: 'image/png' }])
check('(the sample label photo uploaded)', upload.assetIds.length === 1 && upload.errors.length === 0, upload.errors)
const heater = await submit(
  a,
  heaterSvc,
  customerOf('Marta Okafor'),
  [
    { fieldId: '_project_description', value: 'The water heater in my garage is leaking at the bottom. Please replace it. Photo of the label attached.' },
    { fieldId: 'heater_location', value: 'Garage' },
  ],
  upload.assetIds
)
const heaterFirst = await fullRow(heater.id)
const firstQuestions = ((heaterFirst.clarification_questions_json as Row[] | null) ?? []) as Array<Row & { id: string; question: string; aiValue?: unknown; evidence?: string }>
check('(real pipeline) the label was read and the customer was asked to confirm it', heaterFirst.status === 'awaiting_clarification' && firstQuestions.some((q) => String(q.evidence ?? '').startsWith('Read from ')), {
  status: heaterFirst.status,
  questions: firstQuestions.map((q) => q.question),
})
// the customer answers what was read
if (heaterFirst.status === 'awaiting_clarification' && firstQuestions.length > 0) {
  const answers = firstQuestions.map((q) => ({ questionId: q.id, answer: String(q.aiValue ?? '50 gal') }))
  expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${heater.id}/clarify`, { body: { token: heater.token, answers }, timeoutMs: 300_000 }))
  const deadline = Date.now() + 300_000
  while (['queued', 'generating', 'awaiting_clarification'].includes((await fullRow(heater.id)).status) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000))
}
const heaterRow = await fullRow(heater.id)
check('(real pipeline) the answer re-priced the quote', ['pending_review', 'sent'].includes(heaterRow.status) && heaterRow.pricing_json.total > 0, { status: heaterRow.status, total: heaterRow.pricing_json.total })

// REAL 2: a garage door request with no photo
const door = await submit(a, doorSvc, customerOf('Dev Raman'), [
  { fieldId: '_project_description', value: 'New garage door please, single steel one' },
  { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' },
  { fieldId: 'door_style', value: 'Steel, non-insulated' },
])
const doorRow = await fullRow(door.id)

// BY HAND: a quote the AI produced nothing for
const formOnly = { ...(doorRow.signals_json ?? {}), signals: (((doorRow.signals_json?.signals as Row[] | undefined) ?? []) as Row[]).filter((s) => s.source === 'form') }
const { signalRecommendations: _recs, ...contentPlain } = doorRow.content_json as Row
const plainBreakdown = doorRow.pricing_json.breakdown.map(({ autoRecommended: _a, recommendationReason: _r, ...line }) => line)
const plain = await copyOf(door.id, 'Priya Lindqvist', {
  status: 'pending_review',
  signals_json: formOnly,
  content_json: contentPlain,
  pricing_json: { ...doorRow.pricing_json, breakdown: plainBreakdown },
  clarification_questions_json: null,
  clarification_answers_json: null,
})
// BY HAND: a quote with a detected extra, a "may also need" note and a checker log row
const extraLabel = 'Old door haul-away'
const FINDING = 'T-169 test finding: the scope mentions haul-away of the old door, check that it is priced.'
const noted = await copyOf(door.id, 'Tomas Albrecht', {
  status: 'pending_review',
  signals_json: formOnly,
  clarification_questions_json: null,
  clarification_answers_json: null,
  content_json: { ...contentPlain, signalRecommendations: [{ signalKey: 'opener_age', signalValue: 'old', workDescription: 'Opener replacement', costBreakdown: 'A new opener unit', confidence: 0.7, evidence: 'The customer said the opener is original to the house.', isEstimate: true }] },
  pricing_json: { ...doorRow.pricing_json, breakdown: [...plainBreakdown.slice(0, -1), { ...plainBreakdown[plainBreakdown.length - 1]!, label: extraLabel, autoRecommended: true, recommendationReason: 'Detected from your description' }] },
})
const notedBefore = await fullRow(noted)
// the row the worker writes when the checker finds something (apps/worker/src/quote-processor.ts, logValidation)
await sb.insert('quote_validation_logs', {
  quote_id: noted,
  tenant_id: a.tenantId,
  service_id: doorSvc,
  input_snapshot: { formAnswers: [], photoCount: 0 },
  original_quote_snapshot: { total: notedBefore.pricing_json.total, breakdown: notedBefore.pricing_json.breakdown },
  validation_result: {
    overallStatus: 'REVIEW_NEEDED',
    confidenceScore: 0.9,
    issues: [{ id: 'ISSUE-001', category: 'scope', severity: 'medium', check: 'CHECK 2: SCOPE TEXT VALIDATION', description: FINDING, found: 'x', expected: 'A total of $9,999', autoFixable: false, suggestedConfigFix: 'Add a $9,999 step' }],
    summary: { criticalCount: 0, highCount: 0, mediumCount: 1, lowCount: 0, autoFixableCount: 0, configIssueCount: 0 },
  },
  outcome: 'passed_with_issues',
})
// a waiting row with a photo for Home, whatever the real quote's status ended as
const waitingWithPhoto = heaterRow.status === 'pending_review' ? heater.id : await copyOf(heater.id, 'Wanda Pemberton', { status: 'pending_review', approved_at: null, sent_at: null })
// two periods for the small lines: one accepted quote in the 30 days before
const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
await copyOf(door.id, 'Olive Hartwell', { status: 'accepted', created_at: ago(40 * DAY), approved_at: ago(39 * DAY), sent_at: ago(39 * DAY), viewed_at: ago(38 * DAY), accepted_at: ago(35 * DAY) })
await copyOf(door.id, 'Noor Castellan', { status: 'accepted', created_at: ago(8 * DAY), approved_at: ago(8 * DAY), sent_at: ago(8 * DAY), viewed_at: ago(7 * DAY), accepted_at: ago(6 * DAY) })

// ====================================================================
section('1. The data: what the quote API says the AI understood')
// ====================================================================
const heaterDetail = await detail(a, heater.id)
const hu = heaterDetail.json?.understanding
const stored = JSON.stringify([heaterRow.signals_json, heaterRow.content_json, heaterRow.clarification_questions_json])
check('the quote API answers with the understanding and the photos', heaterDetail.status === 200 && Boolean(hu) && Array.isArray(heaterDetail.json?.photos))
check('a label reading is shown, in plain words, with the words it was read from', (hu?.photos ?? []).some((p) => /^From the tank's rating label: /.test(String(p.text)) && /^It read “.+” in photo 1\.$/.test(String(p.detail ?? ''))), hu?.photos)
check('every reading shown is one the pipeline stored for this quote', (hu?.photos ?? []).filter((p) => String(p.text).startsWith('From the tank')).every((p) => {
  const words = /“(.+)”/.exec(String(p.detail ?? ''))?.[1]
  return Boolean(words) && stored.includes(JSON.stringify(words).slice(1, -1))
}))
check('the question and the customer’s answer are shown', (hu?.asked ?? []).length === firstQuestions.length && (hu?.asked ?? []).every((q, i) => q.question === firstQuestions[i]!.question && typeof q.answer === 'string' && q.answer.length > 0), hu?.asked)
check('the photo is listed as a path on our own site, never a storage address', (heaterDetail.json?.photos ?? []).length === 1 && heaterDetail.json!.photos![0]!.url === `/api/quotes/${heater.id}/photos/${upload.assetIds[0]}`, heaterDetail.json?.photos)
check('the API response carries no storage key and no signed address', !JSON.stringify(heaterDetail.json).includes('r2_key') && !/X-Amz-|r2\.cloudflarestorage/.test(JSON.stringify(heaterDetail.json)))

const plainDetail = await detail(a, plain)
const pu = plainDetail.json?.understanding
check('a quote the AI produced nothing for: every list is empty and there are no photos', plainDetail.status === 200 && Boolean(pu) && [pu!.photos, pu!.words, pu!.alsoNoted, pu!.asked, pu!.checks].every((l) => l.length === 0) && (plainDetail.json?.photos ?? []).length === 0, pu)

const notedDetail = await detail(a, noted)
const nu = notedDetail.json?.understanding
check('an extra picked up from the customer’s words is named, with no amount', (nu?.words ?? []).length === 1 && nu!.words[0]!.text === UNDERSTOOD_COPY.extra(extraLabel), nu?.words)
check('work the customer may also need is listed', (nu?.alsoNoted ?? []).length === 1 && nu!.alsoNoted[0]!.text === 'Opener replacement', nu?.alsoNoted)
if (SHOW_WORTH_CHECKING) {
  check('the checker’s finding is listed as it was written, and nothing else of the log', (nu?.checks ?? []).length === 1 && nu!.checks[0]!.text === FINDING && !JSON.stringify(nu).includes('9,999'), nu?.checks)
} else {
  // "Worth checking" is switched off: the quote has a stored finding, and the API sends none of it
  check('"Worth checking" is off: the quote with a stored finding gets no finding from the API, and nothing of the log', (nu?.checks ?? []).length === 0 && nu?.checksBeforeChange === false && !JSON.stringify(notedDetail.json).includes('T-169 test finding') && !JSON.stringify(notedDetail.json).includes('9,999'), nu?.checks)
  check('"Worth checking" is off: no quote in this run carries a finding', [hu, pu, nu].every((u) => (u?.checks ?? []).length === 0))
}
check('the checker’s log is read per quote: the other quotes carry no finding', (hu?.checks ?? []).every((c) => c.text !== FINDING) && pu!.checks.length === 0)
const realLogs = await sb.select('quote_validation_logs', `tenant_id=eq.${a.tenantId}&quote_id=in.(${heater.id},${door.id})&select=quote_id,outcome`)
check('(the real pipeline wrote a checker log row for each real quote, by quote id)', (realLogs as Row[]).length >= 2, realLogs)

// ====================================================================
section('2. The photos: signed in, this business only')
// ====================================================================
const photoUrl = `${cfg.appUrl}/api/quotes/${heater.id}/photos/${upload.assetIds[0]}`
const signedOut = await raw(photoUrl)
check('signed out: no photo', signedOut.status === 401, signedOut.status)
const asOwner = await raw(photoUrl, a.cookie)
const location = asOwner.headers.get('location') ?? ''
check('the owner is redirected to a signed address that is not ours and runs out', asOwner.status === 302 && !location.startsWith(origin) && /X-Amz-Signature=/.test(location) && /X-Amz-Expires=300\b/.test(location), { status: asOwner.status, host: location ? new URL(location).host.replace(/^[^.]+/, '…') : null })
check('the browser may keep the answer privately, for less time than the address lasts', /private/.test(asOwner.headers.get('cache-control') ?? '') && !/public/.test(asOwner.headers.get('cache-control') ?? ''), asOwner.headers.get('cache-control'))
const bytes = location ? await fetch(location) : null
check('the signed address serves the photo', Boolean(bytes?.ok) && (bytes!.headers.get('content-type') ?? '').startsWith('image/'), bytes?.status)
const asRival = await raw(photoUrl, rival.cookie)
check('another business: 404, and no address', asRival.status === 404 && !asRival.headers.get('location'), asRival.status)
const wrongQuote = await raw(`${cfg.appUrl}/api/quotes/${door.id}/photos/${upload.assetIds[0]}`, a.cookie)
check('a photo asked for through a quote it does not belong to: 404', wrongQuote.status === 404, wrongQuote.status)
const madeUp = await raw(`${cfg.appUrl}/api/quotes/${heater.id}/photos/ast_does_not_exist`, a.cookie)
check('an id that is not a photo of this quote: 404', madeUp.status === 404, madeUp.status)
const rivalDetail = await detail(rival, heater.id)
check('another business cannot read the quote, its understanding or its photos', rivalDetail.status === 404 && !JSON.stringify(rivalDetail.json).includes('understanding'), rivalDetail.status)
const rivalList = await http('GET', `${cfg.appUrl}/api/quotes?group=all`, { headers: rival.cookie })
check('another business’s list is empty', rivalList.ok && ((rivalList.json as { items?: unknown[] }).items ?? []).length === 0)
const list = await http('GET', `${cfg.appUrl}/api/quotes?group=all`, { headers: a.cookie })
const items = ((list.json as { items?: Array<{ quoteId: string; photoUrl?: string | null }> }).items ?? [])
check('the quotes list carries one small photo for a quote that has one, and none for one that has none', items.find((i) => i.quoteId === heater.id)?.photoUrl === `/api/quotes/${heater.id}/photos/${upload.assetIds[0]}` && items.find((i) => i.quoteId === door.id)?.photoUrl === null)

// ====================================================================
section('3. Nothing changed a price, and the checker’s log changed no quote')
// ====================================================================
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
const notedAfter = await fullRow(noted)
check('AD-049: the quote with a checker finding is exactly as it was before the finding was logged and read', same(notedBefore, notedAfter))
const heaterAfter = await fullRow(heater.id)
check('AD-001: reading the quote and its photos changed nothing on it', same(heaterRow.pricing_json, heaterAfter.pricing_json) && same(heaterRow.content_json, heaterAfter.content_json) && heaterRow.status === heaterAfter.status)
check('the quote page’s total is the pricing engine’s total', (heaterDetail.json as { quote?: { pricing_json?: { total?: number } } }).quote?.pricing_json?.total === heaterRow.pricing_json.total)

// ====================================================================
section('4. The pages (browser, 390 and 1440)')
// ====================================================================
// Runs in the page: every visible control in <main>, with its size and name
const CONTROLS = `(() => {
  const main = document.querySelector('main') || document.body
  const out = { small: [], tiny: [], unnamed: [], sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  for (const el of main.querySelectorAll('a[href], button, input, select, textarea, [role=tab], summary')) {
    if (el.closest('[inert]')) continue
    const b = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    if (b.width === 0 || b.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue
    if (el.closest('details:not([open])') && el.tagName !== 'SUMMARY') continue
    const img = el.querySelector('img[alt]')
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || (img ? img.getAttribute('alt') : '') || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
    const labelled = name.length > 0 || (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest('label')
    const tag = el.tagName.toLowerCase() + '[' + (name || el.getAttribute('data-testid') || '') + '] ' + Math.round(b.width) + 'x' + Math.round(b.height)
    if (!labelled) out.unnamed.push(tag)
    if (b.height < 24 || b.width < 24) out.tiny.push(tag)
    else if (b.height < 44) out.small.push(tag)
  }
  return out
})()`
type Controls = { small: string[]; tiny: string[]; unnamed: string[]; sideways: number }

if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('the pages in a browser (set PLAYWRIGHT_DIR)')
} else {
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const contextFor = async (biz: Biz | null, width: number) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 } })
    // tsx names the helper functions inside page.evaluate with a helper the page does not have
    await ctx.addInitScript('globalThis.__name = (f) => f')
    if (biz) {
      await ctx.addCookies(biz.cookieHeader.split('; ').map((pair) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      }))
    }
    return ctx
  }
  const money = (n: number) => formatMoney(n, 'USD')

  for (const width of [390, 1440]) {
    const phone = width < 700
    const ctx = await contextFor(a, width)
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
    const dialogs: string[] = []
    p.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss() })
    const open = async (url: string, ready: string) => {
      await p.goto(`${origin}${url}`, { waitUntil: 'load' })
      await p.waitForSelector(ready, { timeout: 30_000 })
      await p.waitForLoadState('networkidle').catch(() => undefined)
    }
    const controls = () => p.evaluate(CONTROLS) as Promise<Controls>
    const tapChecks = async (name: string) => {
      const c = await controls()
      check(`${width} ${name}: nothing scrolls sideways`, c.sideways <= 0, c.sideways)
      check(`${width} ${name}: every control has a name`, c.unnamed.length === 0, c.unnamed)
      check(`${width} ${name}: no control is under 24 px`, c.tiny.length === 0, c.tiny)
      if (phone) check(`${width} ${name}: every control is at least 44 px tall`, c.small.length === 0, c.small)
    }

    // ---- the quote page, with a real reading and a real photo
    await open(`/app/quotes/${heater.id}`, '[data-testid=understood-panel]')
    await p.waitForFunction(() => {
      const img = document.querySelector('[data-testid=customer-photo] img') as HTMLImageElement | null
      return Boolean(img && img.complete && img.naturalWidth > 0)
    }, undefined, { timeout: 30_000 }).catch(() => undefined)
    const q = await p.evaluate(() => {
      const top = (sel: string) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null }
      const total = document.querySelector('[data-testid=quote-total]') as HTMLElement | null
      const img = document.querySelector('[data-testid=customer-photo] img') as HTMLImageElement | null
      const back = document.querySelector('[data-testid=back-to-quotes]') as HTMLElement | null
      const panel = document.querySelector('[data-testid=understood-panel]') as HTMLElement | null
      return {
        order: [top('[data-testid=next-step]'), top('[data-testid=understood-panel]'), top('[data-testid=pricing]'), top('[data-testid=quote-rest]')],
        photosTop: top('[data-testid=customer-photos]'),
        readingTop: top('[data-testid=understood-photos]'),
        totalText: total?.innerText.replace(/\s+/g, '') ?? '',
        totalFont: total ? getComputedStyle(total).fontFamily : '',
        totalSize: total ? parseFloat(getComputedStyle(total).fontSize) : 0,
        lineSize: (() => { const el = document.querySelector('[data-testid=price-line]'); return el ? parseFloat(getComputedStyle(el).fontSize) : 0 })(),
        photoLoaded: Boolean(img && img.complete && img.naturalWidth > 0),
        photoSrc: img?.getAttribute('src') ?? '',
        thumbs: document.querySelectorAll('[data-testid=customer-photo]').length,
        thumbName: document.querySelector('[data-testid=customer-photo]')?.getAttribute('aria-label') ?? '',
        backName: back?.getAttribute('aria-label') ?? '',
        backSize: back ? [Math.round(back.getBoundingClientRect().width), Math.round(back.getBoundingClientRect().height)] : null,
        panelText: panel?.innerText ?? '',
        boxes: document.querySelectorAll('main div.mb-6.bg-surface.border, main section.bg-surface.border').length,
        html: document.documentElement.outerHTML.includes('X-Amz-') || document.documentElement.outerHTML.includes('r2.cloudflarestorage'),
      }
    })
    check(`${width} quote: the order is next step, what the AI understood, pricing, the rest`, q.order.every((y) => y !== null) && [...q.order].sort((x, y) => (x as number) - (y as number)).join() === q.order.join(), q.order)
    check(`${width} quote: the customer's photo is at the top of the panel, above what was read`, q.thumbs === 1 && q.photosTop !== null && q.readingTop !== null && q.photosTop < q.readingTop && q.photosTop > (q.order[1] as number), { photos: q.photosTop, reading: q.readingTop })
    check(`${width} quote: the photo loaded, from a path on our site`, q.photoLoaded && q.photoSrc === `/api/quotes/${heater.id}/photos/${upload.assetIds[0]}`, q.photoSrc)
    check(`${width} quote: the page holds no storage address`, !q.html)
    check(`${width} quote: the panel says what was read, the question and the answer`, q.panelText.includes(UNDERSTOOD_COPY.title) && /From the tank's rating label: /.test(q.panelText) && q.panelText.includes(firstQuestions[0]?.question ?? '∅') && q.panelText.includes(UNDERSTOOD_COPY.answered))
    check(`${width} quote: the total stands out: the mono figure, 36 px, over 14 px lines`, q.totalText === money(heaterRow.pricing_json.total).replace(/\s+/g, '') && /Spline|mono/i.test(q.totalFont) && q.totalSize >= 36 && q.lineSize <= 14, { text: q.totalText, size: q.totalSize, font: q.totalFont.split(',')[0] })
    check(`${width} quote: the grey look-alike boxes are gone`, q.boxes === 0, q.boxes)
    check(`${width} quote: the back arrow has a name and is 44 px`, q.backName === 'Back to quotes' && Boolean(q.backSize) && q.backSize![0] >= 44 && q.backSize![1] >= 44, q.backSize)
    check(`${width} quote: the photo's button has a name`, q.thumbName === 'Photo 1 of 1. Open larger.', q.thumbName)
    await tapChecks('quote')
    await p.screenshot({ path: path.join(outDir, `quote-${width}.png`), fullPage: true })

    // the larger view, from the keyboard
    await p.focus('[data-testid=customer-photo]')
    await p.keyboard.press('Enter')
    await p.waitForSelector('dialog[open] [data-testid=photo-viewer-image]', { timeout: 10_000 })
    await p.waitForFunction(() => { const i = document.querySelector('[data-testid=photo-viewer-image]') as HTMLImageElement | null; return Boolean(i && i.complete && i.naturalWidth > 0) }, undefined, { timeout: 30_000 }).catch(() => undefined)
    const viewer = await p.evaluate(() => {
      const d = document.querySelector('dialog[data-testid=photo-viewer]') as HTMLDialogElement
      const i = d.querySelector('[data-testid=photo-viewer-image]') as HTMLImageElement
      const b = d.getBoundingClientRect()
      return {
        open: d.open,
        modal: d.matches(':modal'),
        label: d.getAttribute('aria-label'),
        alt: i.alt,
        loaded: i.complete && i.naturalWidth > 0,
        inside: Boolean(document.activeElement && d.contains(document.activeElement)),
        fits: b.left >= 0 && b.right <= innerWidth + 1 && b.top >= 0 && b.bottom <= innerHeight + 1,
        larger: i.getBoundingClientRect().width > 150,
        animated: getComputedStyle(d).animationName !== 'none' || parseFloat(getComputedStyle(d).transitionDuration) > 0,
      }
    })
    check(`${width} photo: Enter opens a modal dialog with the photo, larger, and focus inside it`, viewer.open && viewer.modal && viewer.loaded && viewer.inside && viewer.larger && viewer.fits, viewer)
    check(`${width} photo: the dialog and the picture are named for a screen reader`, viewer.label === 'Photos from Marta Okafor' && viewer.alt === 'Photo 1 of 1 sent by Marta Okafor', { label: viewer.label, alt: viewer.alt })
    check(`${width} photo: nothing animates (dashboard motion is feedback only)`, !viewer.animated)
    await p.screenshot({ path: path.join(outDir, `quote-photo-open-${width}.png`) })
    await p.keyboard.press('Escape')
    const closed = await p.evaluate(() => ({
      open: (document.querySelector('dialog[data-testid=photo-viewer]') as HTMLDialogElement).open,
      back: document.activeElement?.getAttribute('data-testid') ?? '',
    }))
    check(`${width} photo: Escape closes it and focus returns to the photo`, !closed.open && closed.back === 'customer-photo', closed)
    await p.click('[data-testid=customer-photo]')
    await p.waitForSelector('dialog[open]')
    await p.click('[data-testid=photo-viewer-close]')
    check(`${width} photo: a tap opens it and Close closes it`, !(await p.evaluate(() => (document.querySelector('dialog[data-testid=photo-viewer]') as HTMLDialogElement).open)))

    // ---- a quote the AI produced nothing for
    await open(`/app/quotes/${plain}`, '[data-testid=pricing]')
    const absent = await p.evaluate(() => ({
      panel: document.querySelectorAll('[data-testid=understood-panel], [data-testid=photos-only], [data-testid=customer-photos]').length,
      text: (document.querySelector('main') as HTMLElement).innerText,
    }))
    check(`${width} quote with no AI output: no panel, no photos, no empty heading`, absent.panel === 0 && !absent.text.includes(UNDERSTOOD_COPY.title) && !absent.text.includes(UNDERSTOOD_COPY.checksTitle))
    await p.screenshot({ path: path.join(outDir, `quote-no-ai-${width}.png`), fullPage: true })

    // ---- a quote with a detected extra, a note and a checker finding
    await open(`/app/quotes/${noted}`, '[data-testid=understood-panel]')
    const n = await p.evaluate(() => ({
      checks: (document.querySelector('[data-testid=understood-checks]') as HTMLElement | null)?.innerText ?? '',
      groups: document.querySelectorAll('[data-testid=understood-checks]').length,
      page: document.body.innerText,
      words: (document.querySelector('[data-testid=understood-words]') as HTMLElement | null)?.innerText ?? '',
      also: (document.querySelector('[data-testid=understood-also]') as HTMLElement | null)?.innerText ?? '',
      photos: document.querySelectorAll('[data-testid=customer-photos]').length,
      total: (document.querySelector('[data-testid=quote-total]') as HTMLElement).innerText.replace(/\s+/g, ''),
      panel: (document.querySelector('[data-testid=understood-panel]') as HTMLElement).innerText,
    }))
    if (SHOW_WORTH_CHECKING) {
      check(`${width} quote: the checker's finding shows under "Worth checking", with the note that it changed nothing`, /worth checking/i.test(n.checks) && n.checks.includes(FINDING) && n.checks.includes(UNDERSTOOD_COPY.checksNote), n.checks.slice(0, 90))
    } else {
      check(`${width} quote: "Worth checking" is off: no such group, heading or finding on a quote that has a stored finding`, n.groups === 0 && !/worth checking/i.test(n.page) && !n.page.includes(FINDING) && !n.page.includes(UNDERSTOOD_COPY.checksNote), n.checks.slice(0, 90))
    }
    check(`${width} quote: the detected extra and the "may also need" note show, with no amount in the panel`, n.words.includes(extraLabel) && n.also.includes('Opener replacement') && !/\$\s?\d/.test(n.panel) && n.photos === 0)
    check(`${width} quote: the total is still the stored total`, n.total === money(notedBefore.pricing_json.total).replace(/\s+/g, ''), n.total)
    await p.screenshot({ path: path.join(outDir, `quote-extra-and-note-${width}.png`), fullPage: true })

    // ---- Home
    await open('/app', '[data-testid=waiting-for-you]')
    await p.waitForFunction(() => { const i = document.querySelector('[data-testid=waiting-quote] [data-testid=quote-thumb]') as HTMLImageElement | null; return Boolean(i && i.complete && i.naturalWidth > 0) }, undefined, { timeout: 30_000 }).catch(() => undefined)
    const h = await p.evaluate((ids: { withPhoto: string; without: string }) => {
      const row = (id: string) => Array.from(document.querySelectorAll('[data-testid=waiting-quote]')).find((li) => li.querySelector(`a[href="/app/quotes/${id}"]`))
      const thumb = row(ids.withPhoto)?.querySelector('[data-testid=quote-thumb]') as HTMLImageElement | null
      const tiles = Array.from(document.querySelectorAll('[data-testid=home-number]')).map((t) => {
        const change = t.querySelector('[data-testid=number-change]')
        const mark = t.querySelector('[data-testid=trend-mark]')
        const spark = t.querySelector('[data-testid=sparkline]')
        const line = spark?.querySelector('polyline[data-part=now]')
        return {
          value: (t.querySelector('.figure') as HTMLElement).innerText,
          words: (change as HTMLElement | null)?.innerText.trim() ?? null,
          direction: mark?.getAttribute('data-direction') ?? null,
          markShape: mark?.firstElementChild?.tagName ?? null,
          markColour: mark ? getComputedStyle(mark).color : null,
          wordsColour: change ? getComputedStyle(change).color : null,
          spark: Boolean(spark),
          sparkHidden: spark?.querySelector('svg')?.getAttribute('aria-hidden') ?? null,
          summary: (spark?.querySelector('[data-testid=sparkline-summary]') as HTMLElement | null)?.textContent ?? null,
          stroke: line ? getComputedStyle(line).stroke : null,
          points: line?.getAttribute('points')?.split(' ').length ?? 0,
        }
      })
      return {
        thumbLoaded: Boolean(thumb && thumb.complete && thumb.naturalWidth > 0),
        thumbSize: thumb ? [Math.round(thumb.getBoundingClientRect().width), Math.round(thumb.getBoundingClientRect().height)] : null,
        thumbAlt: thumb?.alt ?? '',
        noThumb: row(ids.without)?.querySelectorAll('[data-testid=quote-thumb]').length ?? -1,
        rows: document.querySelectorAll('[data-testid=waiting-quote]').length,
        tiles,
      }
    }, { withPhoto: waitingWithPhoto, without: plain })
    check(`${width} Home: a waiting row with a photo shows one small picture, loaded and named`, h.thumbLoaded && Boolean(h.thumbSize) && h.thumbSize![0] === 48 && h.thumbSize![1] === 48 && /^Photo sent by /.test(h.thumbAlt), { size: h.thumbSize, alt: h.thumbAlt })
    check(`${width} Home: a waiting row with no photo shows none`, h.noThumb === 0, { rows: h.rows })
    const moved = h.tiles.filter((t) => t.direction === 'up' || t.direction === 'down')
    check(`${width} Home: each of the four figures says which way it moved, in words and with a shape`, h.tiles.length === 4 && h.tiles.every((t) => t.words !== null && t.direction !== null && (t.direction === 'same' ? t.markShape === 'rect' && /same/i.test(t.words!) : t.markShape === 'path' && new RegExp(`^${t.direction}\\b`).test(t.words!))), h.tiles.map((t) => [t.value, t.words, t.direction]))
    check(`${width} Home: the direction does not rest on colour (the mark and the words share one text colour)`, moved.length > 0 && h.tiles.every((t) => t.markColour === t.wordsColour), moved.length)
    check(`${width} Home: a figure with something in either period has a small line, hidden from screen readers, with the numbers as a sentence`, h.tiles.some((t) => t.spark) && h.tiles.filter((t) => t.spark).every((t) => t.sparkHidden === 'true' && /^In 5-day steps\. The 30 days before: .+\. The last 30 days: .+\.$/.test(t.summary ?? '') && t.points === 6), h.tiles.map((t) => t.spark))
    check(`${width} Home: the line is drawn in a token colour (juniper)`, h.tiles.filter((t) => t.spark).every((t) => t.stroke === 'rgb(32, 94, 86)'), h.tiles.find((t) => t.spark)?.stroke)
    await tapChecks('Home')
    await p.screenshot({ path: path.join(outDir, `home-${width}.png`), fullPage: true })

    // ---- the quotes list
    await open('/app/quotes?tab=all', '[data-testid=quote-row]')
    await p.waitForFunction(() => { const i = document.querySelector('[data-testid=quote-row] [data-testid=quote-thumb]') as HTMLImageElement | null; return Boolean(i && i.complete && i.naturalWidth > 0) }, undefined, { timeout: 30_000 }).catch(() => undefined)
    const l = await p.evaluate((ids: { withPhoto: string; without: string }) => {
      const row = (id: string) => document.querySelector(`[data-testid=quote-row][data-quote-id="${id}"]`)
      const thumb = row(ids.withPhoto)?.querySelector('[data-testid=quote-thumb]') as HTMLImageElement | null
      return { loaded: Boolean(thumb && thumb.complete && thumb.naturalWidth > 0), without: row(ids.without)?.querySelectorAll('[data-testid=quote-thumb]').length ?? -1 }
    }, { withPhoto: heater.id, without: door.id })
    check(`${width} quotes list: one small photo on the row that has one, none on the row that has none`, l.loaded && l.without === 0, l)
    await tapChecks('quotes list')
    await p.screenshot({ path: path.join(outDir, `quotes-${width}.png`), fullPage: true })

    // ---- Services
    await open('/app/services', '[data-testid=service-row]')
    const s = await p.evaluate(() => Array.from(document.querySelectorAll('[data-testid=service-row]')).map((row) => {
      const box = (id: string) => { const b = (row.querySelector(`[data-testid=${id}]`) as HTMLElement).getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width), t: Math.round(b.top) } }
      const edit = box('service-edit'), toggle = box('service-toggle'), del = box('service-delete')
      const rule = getComputedStyle((row.querySelector('[data-testid=service-delete]') as HTMLElement).parentElement as HTMLElement)
      return {
        onScreen: [edit, toggle, del].every((b) => b.l >= 0 && b.r <= innerWidth && b.w > 0),
        heights: [edit.h, toggle.h, del.h],
        gapToDelete: del.l - toggle.r,
        gapBetween: toggle.l - edit.r,
        rule: parseFloat(rule.borderLeftWidth) >= 1,
        deleteColour: getComputedStyle(row.querySelector('[data-testid=service-delete]') as HTMLElement).color,
        editColour: getComputedStyle(row.querySelector('[data-testid=service-edit]') as HTMLElement).color,
        names: ['service-edit', 'service-toggle', 'service-delete'].map((id) => row.querySelector(`[data-testid=${id}]`)?.getAttribute('aria-label') ?? ''),
      }
    }))
    check(`${width} Services: Edit, Disable and Delete are on screen for every service`, s.length === 2 && s.every((r) => r.onScreen), s.map((r) => r.heights))
    check(`${width} Services: the three are ${phone ? '44' : '24'} px or taller, and never closer than 8 px`, s.every((r) => r.heights.every((hgt) => hgt >= (phone ? 44 : 24)) && r.gapBetween >= 8), s.map((r) => [r.heights, r.gapBetween]))
    check(`${width} Services: Delete is set apart: a rule, a wider gap than between the other two, and the only red one`, s.every((r) => r.rule && r.gapToDelete >= 24 && r.gapToDelete > r.gapBetween && r.deleteColour === 'rgb(162, 61, 47)' && r.editColour !== r.deleteColour), s.map((r) => [r.gapBetween, r.gapToDelete]))
    check(`${width} Services: each action names its service`, s.every((r) => r.names.every((nm) => /^(Edit|Disable|Enable|Delete) .+/.test(nm))), s[0]?.names)
    await tapChecks('Services')
    await p.screenshot({ path: path.join(outDir, `services-${width}.png`), fullPage: true })
    // Disable works from the row, and back; Delete asks first and a "no" keeps the service
    const firstRow = p.locator('[data-testid=service-row]').first()
    await firstRow.locator('[data-testid=service-toggle]').click()
    await p.waitForFunction(() => document.querySelector('[data-testid=service-row]')?.getAttribute('data-active') === 'false', undefined, { timeout: 15_000 }).catch(() => undefined)
    const disabled = await firstRow.getAttribute('data-active')
    await firstRow.locator('[data-testid=service-toggle]').click()
    await p.waitForFunction(() => document.querySelector('[data-testid=service-row]')?.getAttribute('data-active') === 'true', undefined, { timeout: 15_000 }).catch(() => undefined)
    check(`${width} Services: Disable and Enable work from the row`, disabled === 'false' && (await firstRow.getAttribute('data-active')) === 'true')
    await firstRow.locator('[data-testid=service-delete]').click()
    await p.waitForTimeout(400)
    check(`${width} Services: Delete asks first, and answering no keeps the service`, dialogs.some((m) => /delete/i.test(m)) && (await p.locator('[data-testid=service-row]').count()) === 2, dialogs.slice(-1))

    // ---- Quote link
    await open('/app/quote-link', 'main h1')
    await tapChecks('Quote link')

    check(`${width}: no error in the console on any dashboard page`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()

    // ---- another business cannot see the quote
    const rctx = await contextFor(rival, width)
    const rp = await rctx.newPage()
    await rp.goto(`${origin}/app/quotes/${heater.id}`, { waitUntil: 'load' })
    await rp.waitForFunction(() => /not found/i.test((document.querySelector('main') as HTMLElement | null)?.innerText ?? ''), undefined, { timeout: 30_000 }).catch(() => undefined)
    const r = await rp.evaluate(() => ({
      text: (document.querySelector('main') as HTMLElement).innerText,
      parts: document.querySelectorAll('[data-testid=understood-panel], [data-testid=customer-photos], [data-testid=pricing], img[src*="/photos/"]').length,
    }))
    check(`${width} another business opening the quote sees "not found": no panel, no photo, no price`, /not found/i.test(r.text) && r.parts === 0 && !r.text.includes('Marta'), r.text.slice(0, 60))
    await rctx.close()
  }

  // ---- the home page demo: every frame header fits, at every width
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await pub.addInitScript('globalThis.__name = (f) => f')
  const hp = await pub.newPage()
  for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
    await hp.setViewportSize({ width, height: 900 })
    await hp.goto(`${origin}/`, { waitUntil: 'load' })
    await hp.waitForSelector('[data-testid=demo-frame]')
    const d = await hp.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('[data-testid=demo-frame]'))
      const headers = Array.from(document.querySelectorAll('[data-testid=demo-frame-header], [data-testid=demo-frame] .demo-caption'))
      const cut = headers.flatMap((el) => [el, ...Array.from(el.querySelectorAll('p'))]).filter((el) => {
        const st = getComputedStyle(el)
        return el.scrollWidth > el.clientWidth + 1 || st.textOverflow === 'ellipsis' || st.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth
      }).map((el) => (el as HTMLElement).innerText.slice(0, 30))
      const outside = headers.filter((el) => {
        const frame = el.closest('[data-testid=demo-frame]') as HTMLElement
        const b = el.getBoundingClientRect(), f = frame.getBoundingClientRect()
        return b.left < f.left - 1 || b.right > f.right + 1
      }).length
      const names = Array.from(document.querySelectorAll('[data-testid=demo-business-name]')).map((el) => (el as HTMLElement).innerText.trim())
      // anything in a frame that runs past the frame's own edge (a line cut on purpose with an ellipsis stays inside it)
      const spills = frames.flatMap((f) => {
        const card = (f.querySelector('[data-testid=demo-card]') as HTMLElement).getBoundingClientRect()
        return Array.from(f.querySelectorAll('[data-testid=demo-card] p, [data-testid=demo-card] span, [data-testid=demo-card] img')).filter((el) => {
          const b = el.getBoundingClientRect()
          return b.width > 0 && (b.right > card.right - 8 || b.left < card.left + 8)
        }).map((el) => ((el as HTMLElement).innerText || el.tagName).slice(0, 24))
      })
      return {
        frames: frames.length,
        heights: frames.map((f) => Math.round((f.querySelector('[data-testid=demo-card]') as HTMLElement).getBoundingClientRect().height)),
        headers: headers.length,
        cut,
        outside,
        spills,
        names,
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    check(`home demo ${width}: all three frame headers fit (nothing cut, nothing outside its frame), and the business name is whole`, d.frames === 3 && d.headers === 6 && d.cut.length === 0 && d.outside === 0 && d.names.length === 2 && d.names.every((nm) => nm === d.names[0] && !nm.includes('…') && nm.length > 10), { cut: d.cut, names: d.names[0] })
    check(`home demo ${width}: nothing in a frame runs past the frame's edge`, d.spills.length === 0, d.spills)
    check(`home demo ${width}: the three frames are still one height, and nothing scrolls sideways`, new Set(d.heights).size === 1 && d.sideways <= 0, d.heights)
    if (width === 768 || width === 390) await hp.locator('[data-testid=hero-demo-stage]').screenshot({ path: path.join(outDir, `home-demo-${width}.png`) })
  }
  await pub.close()
  await browser.close()
}

// ====================================================================
section('5. The log')
// ====================================================================
const logPath = process.env.WEB_LOG
if (logPath && existsSync(logPath)) {
  const log = readFileSync(logPath, 'utf8')
  check('the web server’s log holds no signed photo address and no storage key', !/X-Amz-Signature|X-Amz-Credential/.test(log) && !log.includes('r2.cloudflarestorage'))
  check('the web server’s log holds no customer email or phone from this run', !log.includes('marta.okafor@example.com') && !log.includes('(555) 201-1212'))
} else {
  notChecked.push('the web server’s log (set WEB_LOG to its file)')
}

const failed = checks.filter((c) => !c.pass)
saveJson(outDir, 'report.json', { checks, notChecked, quotes: { heater: heater.id, door: door.id, plain, noted }, tenant: a.tenantId })
console.log(`\n${checks.length - failed.length}/${checks.length} pass`)
if (notChecked.length > 0) console.log(`Not checked: ${notChecked.join('; ')}`)
console.log(`Screenshots and report: ${outDir}`)
process.exit(failed.length ? 1 : 0)
