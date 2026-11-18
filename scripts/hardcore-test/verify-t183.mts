// T-183 check: approval the business can trust, line names, quote wording (local stack).
//
// What it proves, against the real web app, worker and database:
//   A. a price line is named from the business's own labels, never from the customer's answer
//      text: main pricing, a service added as a section, the editor's save, the on-site app's
//      price screen, the dashboard and the customer's page
//   B. each line says where its quantity came from, and keeps or loses that when the quote is edited
//   C. the approval page shows, in order: warnings, every line with its amount and source, each
//      service's subtotal, the one total, the customer's photos; one "Approve & send"; the
//      dashboard link
//   D. a photo is shown only through the link, only for the link's own quote, as a small copy, and
//      stops when the link is used
//   E. the "Review and approve" email, built by the worker's own builder from the stored quote
//   F. how the stored scope summary opens
//   G. in a browser: the approval page on a phone; the business's name beside its logo on the
//      quote page, and alone when there is no logo; sentence case on the quote page
//
// It asks no AI model for anything it checks, so it runs at the quick level (pnpm check:quick) as
// well as the full one. Prices are from the rules engine. The wording a live model writes is
// printed at the full level for a person to read, and is never a pass-or-fail check.
//
// Run by the runner:   pnpm check:quick --only t183
// Or by hand, with the web app and the worker started the usual way:
//   PLAYWRIGHT_DIR=.checks/browser npx tsx scripts/hardcore-test/verify-t183.mts
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, pollQuote, shortId, runStamp } from './lib.mjs'
import { generateApprovalToken, approvalLinkExpiry } from '../../packages/shared/src/approval-link'
import { approvalDetail } from '../../packages/shared/src/approval-detail'
import { CHECKER_SETTINGS_VERSION } from '../../packages/shared/src/checker'
import { PRODUCT_NAME } from '../../packages/shared/src/brand'
import { buildReviewRequestEmail } from '../../apps/worker/src/email'

type Row = Record<string, unknown>
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t183-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, values: Row) => call('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=minimal' }, body: values })
function finish(): never {
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}
const inOrder = (positions: number[]) => positions.every((p) => p > -1) && positions.every((p, i) => i === 0 || p > positions[i - 1]!)

// =====================================================================================
// Two businesses. The first has 10% tax and two services with made-up names:
//   Service Alpha: $2 a square foot (the customer's number) and a $60 set-up; a question with
//                  two options, and a rule that adds 15% for one of them. The rule has no label.
//   Service Beta:  an $80 visit; a question whose options are stored as ids with their own
//                  labels, and a rule that adds 25% for one of them.
// Every word below is made up for this check; none is known to the product.
// =====================================================================================
interface Business {
  name: string
  tenantId: string
  cookie: { Cookie: string }
  accessToken: string
  tenantKey: string
}
async function business(label: string): Promise<Business> {
  const id = shortId()
  const name = `${label} ${id}`
  const email = `owner+t183-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: true, taxRate: 0.1, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { name, tenantId, cookie, accessToken: session.access_token as string, tenantKey: site.tenant_key as string }
}
async function makeService(b: Business, name: string, description: string, steps: Row[], multipliers: Row[], fields: Row[]): Promise<string> {
  const created = expectOk(`service ${name}`, await call('POST', `${app}/api/services`, {
    headers: b.cookie,
    body: {
      name, description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: [`One ${name} visit`], scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
      workSteps: steps, expectedSignals: [],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers, workSteps: steps },
    },
  }))
  const serviceId = created.service.id as string
  for (const row of (await sb.select('widget_configs', `tenant_id=eq.${b.tenantId}&service_id=eq.${serviceId}&select=id`)) as Row[]) await call('DELETE', `${cfg.supabaseUrl}/rest/v1/widget_configs?id=eq.${row.id}`, { headers: admin })
  await sb.insert('widget_configs', { tenant_id: b.tenantId, service_id: serviceId, config_json: { fields, files: { minPhotos: 0, maxPhotos: 4, maxDocs: 0 } } })
  return serviceId
}

const ANSWER = 'Please supply it' // the customer's answer text: it must never start a line's name
const ALPHA = { name: 'Service Alpha', question: 'Who provides the materials?', line: 'Who provides the materials: Please supply it (+15%)' }
const BETA = { name: 'Service Beta', question: 'When do you need it?', line: 'When do you need it: Within 48 hours (+25%)' }
const TAX = 0.1
const money = (n: number) => Math.round(n * 100) / 100

const a = await business('Approval Works')
const rival = await business('Rival Works')
const alphaId = await makeService(
  a,
  ALPHA.name,
  'Preparation and two coats on the surfaces listed in the request.',
  [
    { id: 'alpha_area', name: 'Surfaces', description: 'Per square foot', costType: 'per_unit', defaultCost: 2, optional: false, unitLabel: 'sq ft', quantitySource: { type: 'form_field', fieldId: 'alpha_size' } },
    { id: 'alpha_setup', name: 'Set-up', description: 'Once per job', costType: 'fixed', defaultCost: 60, optional: false },
  ],
  [{ when: { fieldId: 'alpha_materials', operator: 'equals', equals: ANSWER }, multiplier: 1.15 }],
  [
    { fieldId: 'alpha_size', type: 'number', label: 'How many square feet?', required: true },
    { fieldId: 'alpha_materials', type: 'select', label: ALPHA.question, required: true, options: [{ value: 'We have them', label: 'We have them' }, { value: ANSWER, label: ANSWER }] },
  ]
)
const betaId = await makeService(
  a,
  BETA.name,
  'One visit to the address in the request.',
  [{ id: 'beta_visit', name: 'Visit', description: 'One visit', costType: 'fixed', defaultCost: 80, optional: false }],
  [{ when: { fieldId: 'beta_timing', operator: 'equals', equals: 'rush_48h' }, multiplier: 1.25 }],
  [{ fieldId: 'beta_timing', type: 'select', label: BETA.question, required: true, options: [{ value: 'any_time', label: 'Any time' }, { value: 'rush_48h', label: 'Within 48 hours' }] }]
)
const rivalServiceId = await makeService(rival, 'Service Alpha', 'One visit.', [{ id: 'one_visit', name: 'Visit', description: 'One visit', costType: 'fixed', defaultCost: 50, optional: false }], [], [])

// a real photo, uploaded the way the request form uploads one
const photosDir = path.join(ROOT, 'apps/web/public/photos')
const picture = readdirSync(photosDir).map((n) => path.join(photosDir, n)).find((p) => /\.(webp|jpe?g|png|avif)$/i.test(p) && statSync(p).size > 2000)!
const jpg = path.join(outDir, 'job-photo.jpg')
execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '640', picture, '--out', jpg], { stdio: 'pipe' })
async function upload(b: Business, fileName: string): Promise<string> {
  const bytes = new Uint8Array(readFileSync(jpg))
  const init = expectOk('upload', await call('POST', `${app}/api/public/uploads/init`, { body: { tenantKey: b.tenantKey, files: [{ fileName, contentType: 'image/jpeg', sizeBytes: bytes.byteLength }] } }))
  const file = init.uploads[0] as { assetId: string; uploadUrl: string }
  const put = await fetch(file.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes })
  if (!put.ok) throw new Error(`photo upload failed (${put.status})`)
  return file.assetId
}
const photoOne = await upload(a, 'front.jpg')
const photoTwo = await upload(a, 'side.jpg')
const rivalPhoto = await upload(rival, 'theirs.jpg')

/**
 * A request priced from the customer's answers alone. Its photos are put on the request after it
 * is priced: this check is about showing a request's photos to the business, and a real model
 * given a stock picture may ask the customer about it, which would make the run depend on a
 * model's reading. (That a photo sent with a request is stored on it is T-182's and T-169's check.)
 */
async function submit(b: Business, serviceId: string, name: string, answers: Row[], assetIds: string[] = []) {
  // The customer's words agree with their answers. (They once said "two rooms" beside an answer of
  // 100 square feet, and the real model, rightly, asked the customer which was meant.)
  const res = expectOk('submit', await call('POST', `${app}/api/public/quotes`, {
    body: { tenantKey: b.tenantKey, serviceId, customer: { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com` }, job: { answers: [{ fieldId: '_project_description', value: 'One wall in the hallway, 100 square feet, as in my answers.' }, ...answers] } },
  }))
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  let view = await pollQuote(cfg, res.quoteId, token)
  // A live model may still ask the customer to confirm a figure. The customer keeps what they said,
  // and the quote is priced again from the same number. (At the quick level no model asks anything.)
  for (let round = 0; round < 2 && view.status === 'awaiting_clarification'; round++) {
    const asked = (((await sb.select('quotes', `id=eq.${res.quoteId}&select=clarification_questions_json`)) as Row[])[0]!.clarification_questions_json ?? []) as Array<{ id: string }>
    console.log(`   (a live model asked ${asked.length} question${asked.length === 1 ? '' : 's'}; answered with the customer's own figure)`)
    expectOk('clarify', await call('POST', `${app}/api/public/quotes/${res.quoteId}/clarify`, { body: { token, answers: asked.map((question) => ({ questionId: question.id, answer: '100' })) }, timeoutMs: 300_000 }))
    view = await pollQuote(cfg, res.quoteId, token)
  }
  if (assetIds.length > 0) {
    const requestId = ((await sb.select('quotes', `id=eq.${res.quoteId}&select=quote_request_id`)) as Row[])[0]!.quote_request_id as string
    await patch('quote_requests', `id=eq.${requestId}`, { asset_ids: assetIds })
  }
  return { id: res.quoteId as string, token, view }
}
const quoteRow = async (id: string, cols = '*') => ((await sb.select('quotes', `id=eq.${id}&select=${cols}`)) as Row[])[0]!
type Line = { label: string; amount: number; source?: string; kind?: string }
const linesOf = (row: Row) => ((row.pricing_json as { breakdown?: Line[] } | null)?.breakdown ?? []) as Line[]

// =====================================================================================
section('A. A price line is named from the business’s own labels')
const q = await submit(a, alphaId, 'Megan Grant', [{ fieldId: 'alpha_size', value: 100 }, { fieldId: 'alpha_materials', value: ANSWER }], [photoOne, photoTwo])
const stored = await quoteRow(q.id)
const lines = linesOf(stored)
const A_SUB = money(100 * 2 + 60 + (100 * 2 + 60) * 0.15) // 299
check('the request is priced and waits for the business (review by default)', stored.status === 'pending_review' && (stored.pricing_json as Row).subtotal === A_SUB, { status: stored.status, subtotal: (stored.pricing_json as Row).subtotal })
check(`the option's line is "${ALPHA.line}", worth 15% of the lines before it ($39)`, lines.some((l) => l.label === ALPHA.line && l.amount === 39), lines.map((l) => [l.label, l.amount]))
check('no line is named from the answer text', !lines.some((l) => l.label.startsWith(ANSWER) || /surcharge/i.test(l.label)), lines.map((l) => l.label))
check('the other lines are the business’s names for its steps', lines.some((l) => l.label.startsWith('Surfaces')) && lines.some((l) => l.label === 'Set-up'))

const dash = await call('GET', `${app}/api/quotes/${q.id}`, { headers: a.cookie })
check('the dashboard shows the same names', ((dash.json?.quote?.pricing_json as { breakdown?: Line[] })?.breakdown ?? []).some((l) => l.label === ALPHA.line))
const appView = await call('GET', `${app}/api/app/quotes/${q.id}`, { headers: { Authorization: `Bearer ${a.accessToken}` } })
check('the on-site app’s price screen shows the same names', ((appView.json?.lines ?? []) as Line[]).some((l) => l.label === ALPHA.line) && !((appView.json?.lines ?? []) as Line[]).some((l) => l.label.startsWith(ANSWER)), (appView.json?.lines as Line[] | undefined)?.map((l) => l.label))
const customerView = await call('GET', `${app}/api/public/quotes/${q.id}?token=${q.token}`)
check('the customer’s page gets the same names', JSON.stringify(customerView.json?.pricing?.breakdown ?? []).includes(ALPHA.line) && !JSON.stringify(customerView.json?.pricing?.breakdown ?? []).includes(`${ANSWER} surcharge`))

// a second service, added in the editor as a section: its option is stored as an id with its own label
const pricedBeta = await call('POST', `${app}/api/quotes/${q.id}/sections/price`, { headers: a.cookie, body: { serviceId: betaId, answers: [{ fieldId: 'beta_timing', value: 'rush_48h' }] } })
const betaLines = ((pricedBeta.json?.section?.breakdown ?? []) as Line[])
check(`a service added as a section is named the same way: "${BETA.line}" ($20), from the option's label and not its stored id`, pricedBeta.status === 200 && betaLines.some((l) => l.label === BETA.line && l.amount === 20) && !betaLines.some((l) => /rush_48h|Rush 48h/i.test(l.label)), { status: pricedBeta.status, lines: betaLines.map((l) => [l.label, l.amount]) })

// =====================================================================================
section('B. Where each quantity came from')
check('the main service’s lines carry it: the customer’s number, a fixed price, the customer’s answer', lines.find((l) => l.label.startsWith('Surfaces'))?.source === 'answer' && lines.find((l) => l.label === 'Set-up')?.source === 'fixed' && lines.find((l) => l.label === ALPHA.line)?.source === 'answer', lines.map((l) => [l.label, l.source]))
check('the section’s lines carry it too (it has no takeoff of its own)', betaLines.find((l) => l.label === 'Visit')?.source === 'fixed' && betaLines.find((l) => l.label === BETA.line)?.source === 'answer', betaLines.map((l) => [l.label, l.source]))

// the business saves the quote from the editor: the section is added, one main line is changed
const before = dash.json.quote as Row
const mainPricing = before.pricing_json as { breakdown: Line[] }
const edited = mainPricing.breakdown.map((l) => (l.label === 'Set-up' ? { label: 'Set-up and protection', amount: 75 } : { label: l.label, amount: l.amount, ...(l.kind && { kind: l.kind }) }))
const saved = await call('PATCH', `${app}/api/quotes/${q.id}`, {
  headers: a.cookie,
  body: { version: before.version, pricing_json: { ...mainPricing, breakdown: edited, sections: [pricedBeta.json.section] }, content_json: { scopeSummary: (before.content_json as Row).scopeSummary }, sendToCustomer: false },
})
const afterSave = await quoteRow(q.id)
const savedLines = linesOf(afterSave)
const savedSections = ((afterSave.pricing_json as { sections?: Array<{ serviceName: string; subtotal: number; breakdown: Line[]; addedBy: string }> }).sections ?? [])
check('the editor’s save keeps the section, as added by the business', saved.status === 200 && savedSections.length === 1 && savedSections[0]!.addedBy === 'business' && savedSections[0]!.subtotal === 100, { status: saved.status, error: saved.json?.error })
check('a line the business left alone keeps its source, though the editor sent none', savedLines.find((l) => l.label.startsWith('Surfaces'))?.source === 'answer' && savedLines.find((l) => l.label === ALPHA.line)?.source === 'answer', savedLines.map((l) => [l.label, l.source]))
check('a line the business changed has none: the figure is now its own', savedLines.find((l) => l.label === 'Set-up and protection')?.source === undefined)
check('the names survive the save', savedLines.some((l) => l.label === ALPHA.line) && savedSections[0]!.breakdown.some((l) => l.label === BETA.line))

// What the worker stores when it measured a quantity from the photos (its unit tests prove it
// stores this from a photo reading; no model is asked here). Put on the stored line directly.
const withMeasured = savedLines.map((l) => (l.label.startsWith('Surfaces') ? { ...l, source: 'photos' } : l))
await patch('quotes', `id=eq.${q.id}`, { pricing_json: { ...(afterSave.pricing_json as Row), breakdown: withMeasured } })

// =====================================================================================
section('C. The approval page')
// the three warnings, stored the way the pipeline stores them
const requestId = (afterSave.quote_request_id as string)
const requestRow = ((await sb.select('quote_requests', `id=eq.${requestId}&select=source_json`)) as Row[])[0]!
await patch('quote_requests', `id=eq.${requestId}`, { source_json: { ...(requestRow.source_json as Row), serviceSuggestion: { serviceId: betaId, serviceName: BETA.name, reason: 'They describe a single visit.' } } })
await patch('quotes', `id=eq.${q.id}`, {
  content_json: {
    ...((await quoteRow(q.id, 'content_json')).content_json as Row),
    alsoAsked: [
      { id: 'asked_1', words: 'a visit this week', serviceId: betaId, serviceName: BETA.name, state: 'offered' },
      { id: 'asked_2', words: 'something else entirely', serviceId: null, state: 'not_offered' },
    ],
  },
})
const FINDING = 'the set-up line is higher than the configured set-up price'
const priced = await quoteRow(q.id)
await sb.insert('quote_validation_logs', {
  quote_id: q.id,
  tenant_id: a.tenantId,
  service_id: alphaId,
  input_snapshot: { formAnswers: [], photoCount: 2, serviceConfigVersion: CHECKER_SETTINGS_VERSION },
  original_quote_snapshot: { total: (priced.pricing_json as Row).total, breakdown: (priced.pricing_json as Row).breakdown },
  validation_result: { overallStatus: 'REVIEW_NEEDED', confidenceScore: 0.9, issues: [{ id: 'ISSUE-001', category: 'pricing', severity: 'medium', check: 'CHECK 1', description: FINDING, found: 'x', expected: 'y', autoFixable: false }], summary: { criticalCount: 0, highCount: 0, mediumCount: 1, lowCount: 0, autoFixableCount: 0, configIssueCount: 0 } },
  outcome: 'passed_with_issues',
})

/** A link made the way the worker makes it. Made after the changes above: a change to a quote ends its open links (T-156). */
async function mint(quoteId: string, tenantId: string) {
  const { token, hash } = await generateApprovalToken()
  await sb.insert('quote_approval_tokens', { quote_id: quoteId, tenant_id: tenantId, token_hash: hash, expires_at: approvalLinkExpiry().toISOString() })
  return { token, hash }
}
const openPage = async (token: string) => {
  const res = await fetch(`${app}/approve/${token}`, { redirect: 'manual' })
  const html = (await res.text()).replace(/<!-- -->/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  return { status: res.status, html, outcome: /data-outcome="([a-z_]+)"/.exec(html)?.[1] }
}
const link = await mint(q.id, a.tenantId)
const rowBefore = JSON.stringify(await quoteRow(q.id, 'status,approved_at,version,pricing_json'))
const page = await openPage(link.token)
const at = (needle: string) => page.html.indexOf(needle)
const MAIN_SUB = money(200 + 75 + 39) // the main service after the edit: 314
const SUBTOTAL = money(MAIN_SUB + 100) // 414
const TOTAL = money(SUBTOTAL * (1 + TAX)) // 455.40
check('it opens without a sign-in and is ready to approve', page.status === 200 && page.outcome === 'ready', { status: page.status, outcome: page.outcome })
check('warnings come first, in order: "Check the service", "Customer also asked for", "Worth checking"', inOrder([at('Check the service'), at('Customer also asked for'), at('Worth checking'), at('data-testid="approve-lines"')]), [at('Check the service'), at('Customer also asked for'), at('Worth checking'), at('data-testid="approve-lines"')])
check('…each says what it is about', page.html.includes(`reads more like "${BETA.name}"`) && page.html.includes('“a visit this week”. Added by you.') && page.html.includes('“something else entirely”. Not one of your services.') && page.html.includes('The set-up line is higher than the configured set-up price'))
check('every line is shown with its amount', ['$200.00', '$75.00', '$39.00', '$80.00', '$20.00'].every((m) => page.html.includes(m)) && [ALPHA.line, BETA.line, 'Set-up and protection', 'Visit'].every((l) => page.html.includes(l)))
check('…and where its quantity came from: "Measured from photos", "The customer\'s answer", "Your fixed price"', ['Measured from photos', "The customer's answer", 'Your fixed price'].every((s) => page.html.includes(s)))
check('…a line the business typed says nothing about a source', (() => {
  const row = page.html.slice(at('Set-up and protection'), at('Set-up and protection') + 400)
  return !row.slice(0, row.indexOf('</li>')).includes('approve-source')
})())
check(`each service is a part with its subtotal ($${MAIN_SUB.toFixed(2)} and $100.00), then tax, then one total ($${TOTAL.toFixed(2)})`, (page.html.match(/data-testid="approve-part-subtotal"/g) ?? []).length === 2 && page.html.includes(`$${MAIN_SUB.toFixed(2)}`) && page.html.includes('$100.00') && (page.html.match(/data-testid="approve-total"/g) ?? []).length === 1 && page.html.includes(`$${TOTAL.toFixed(2)}`) && inOrder([at('data-testid="approve-part-subtotal"'), at('data-testid="approve-tax"'), at('data-testid="approve-total"')]), { MAIN_SUB, TOTAL })
check('the customer’s two photos are shown small, after the total and before the button', (page.html.match(/data-testid="approve-photo"/g) ?? []).length === 2 && page.html.includes('2 photos from the customer') && page.html.includes(`/photos/${photoOne}?size=small`) && inOrder([at('data-testid="approve-total"'), at('data-testid="approve-photos"'), at('data-testid="approve-button"')]))
check('one "Approve & send" button, and "Open in dashboard to edit" stays', (page.html.match(/data-testid="approve-button"/g) ?? []).length === 1 && page.html.includes('Approve & send') && page.html.includes('Open in dashboard to edit') && page.html.includes(`href="/app/quotes/${q.id}"`))
check('no customer email address, no storage address on the page', !page.html.includes('megan.grant@example.com') && !/r2\.cloudflarestorage|X-Amz-Signature/i.test(page.html))
check('opening it changed nothing', JSON.stringify(await quoteRow(q.id, 'status,approved_at,version,pricing_json')) === rowBefore)

// =====================================================================================
section('D. Photos behind the link')
const photoUrl = (token: string, assetId: string, small = true) => `${app}/api/public/approval/${token}/photos/${assetId}${small ? '?size=small' : ''}`
const small = await fetch(photoUrl(link.token, photoOne), { redirect: 'manual' })
const signed = small.headers.get('location') ?? ''
const bytes = signed ? await fetch(signed) : null
check('a photo answers with a redirect to a short-lived signed address, which is the photo', small.status === 302 && /X-Amz-Expires=300\b/.test(signed) && bytes?.status === 200 && /^image\//.test(bytes.headers.get('content-type') ?? ''), { status: small.status, type: bytes?.headers.get('content-type') })
check('…that may be kept by the browser only, for less than it lasts', /private/.test(small.headers.get('cache-control') ?? '') && small.headers.get('referrer-policy') === 'no-referrer')
check('the full photo is served the same way', (await fetch(photoUrl(link.token, photoTwo, false), { redirect: 'manual' })).status === 302)
// another business's quote, with its own link and photo
const rq = await submit(rival, rivalServiceId, 'Dana Whitfield', [], [rivalPhoto])
const rivalLink = await mint(rq.id, rival.tenantId)
const locked = await Promise.all([
  fetch(photoUrl(rivalLink.token, photoOne), { redirect: 'manual' }), // another business's link, this business's photo
  fetch(photoUrl(link.token, rivalPhoto), { redirect: 'manual' }), // this link, another business's photo
  fetch(photoUrl('x'.repeat(43), photoOne), { redirect: 'manual' }), // a made-up link
  fetch(photoUrl(link.token, 'ast_does_not_exist'), { redirect: 'manual' }),
])
check('a link shows only its own quote’s photos: another business’s link, another business’s photo, a made-up link and a made-up photo are all 404', locked.every((r) => r.status === 404), locked.map((r) => r.status))
check('…while the other business’s link does show its own', (await fetch(photoUrl(rivalLink.token, rivalPhoto), { redirect: 'manual' })).status === 302)
const linkAfterPhotos = ((await sb.select('quote_approval_tokens', `token_hash=eq.${link.hash}&select=attempts,used_at`)) as Row[])[0]!
check('opening photos is not a press: nothing was counted against the link', linkAfterPhotos.attempts === 0 && linkAfterPhotos.used_at === null, linkAfterPhotos)

// =====================================================================================
section('E. The "Review and approve" email')
// Locally there is no Postmark, so the worker sends none. This is the worker's own builder, given
// the stored quote exactly as the worker gives it when it sends (apps/worker/src/quote-processor.ts).
const forEmail = await quoteRow(q.id)
const sourceNow = ((await sb.select('quote_requests', `id=eq.${requestId}&select=source_json`)) as Row[])[0]!.source_json
const email = buildReviewRequestEmail(app, {
  quoteId: q.id,
  ownerEmail: 'owner@example.com',
  businessName: a.name,
  customerName: 'Megan Grant',
  customerEmail: 'megan.grant@example.com',
  serviceName: ALPHA.name,
  total: (forEmail.pricing_json as { total: number }).total,
  currency: 'USD',
  locale: 'en-US',
  reviewHold: 'shown',
  approveUrl: `${app}/approve/${link.token}`,
  detail: approvalDetail({ pricing: forEmail.pricing_json, content: forEmail.content_json, mainServiceName: ALPHA.name, requestSource: sourceNow, checkerIssues: [{ check: 'CHECK 1', description: FINDING }], photoCount: 2, currency: 'USD', locale: 'en-US' }),
})
const em = (needle: string) => email.html.indexOf(needle)
check('it reads in order: warnings, the lines, the total, the photos, then Approve & send, then the dashboard link', inOrder([em('data-role="warning"'), em('data-role="price-lines"'), em('data-role="total"'), em('data-role="photos"'), em('data-role="approve"'), em('data-role="dashboard"')]))
check('the three warnings, every line with its amount and source, both subtotals and the one total', ['Check the service', 'Customer also asked for', 'Worth checking', ALPHA.line, BETA.line, '$200.00', '$39.00', '$20.00', 'Measured from photos', 'Your fixed price', `$${MAIN_SUB.toFixed(2)}`, '$100.00', `$${TOTAL.toFixed(2)}`].every((t) => email.html.includes(t)) && (email.html.match(/data-role="part-subtotal"/g) ?? []).length === 2)
check('the photos are one line pointing at the approval page; no photo is put in the email', email.html.includes('2 photos: view them on the approval page') && !/<img/i.test(email.html))
check('no "Powered by" line, and the spot for the product’s logo is at the top', !email.html.includes('Powered by') && em('data-role="product-logo"') > -1 && em('data-role="product-logo"') < em('Estimate ready for your approval') && email.html.includes(`>${PRODUCT_NAME}</td>`))
check('the subject carries the customer, the service and the price', email.subject === `Review and approve: Megan Grant - ${ALPHA.name} - $${TOTAL.toFixed(2)}`, email.subject)

// =====================================================================================
section('F. How the scope summary opens')
const scope = String((forEmail.content_json as Row).scopeSummary ?? '')
const firstSentence = scope.split(/(?<=[.!?])\s/)[0] ?? ''
// A greeting, an introduction or a remark about the estimate itself, in any wording: the first
// sentence must be about the work, so it may not be about "this estimate", "your quote", or "we".
const informal = /^(hi|hello|hey|thanks|thank you|here'?s|here is|please find|we are pleased|we'?re pleased|based on what)\b/i.test(firstSentence) || /\b(quick|ballpark) (estimate|quote)\b/i.test(firstSentence)
if (process.env.CHECK_LEVEL === 'full') {
  // A live model's sentences are for a person to read, never a pass-or-fail check (the prompt is unit-tested)
  console.log(`   Written by the real model, for a person to read. Opens informally: ${informal ? 'YES' : 'no'}.\n   "${scope}"`)
  check('the quote has a scope summary', scope.length > 0)
} else {
  check('the stored scope summary does not open with a greeting or a remark about the estimate', scope.length > 0 && !informal, firstSentence)
}

// =====================================================================================
section('G. In a browser')
if (!process.env.PLAYWRIGHT_DIR) {
  check('the browser checks ran (PLAYWRIGHT_DIR is set)', false, 'Run "pnpm check:setup" once, then use the runner, or set PLAYWRIGHT_DIR')
  finish()
}
const { browserDeps } = await import('./browser.mjs')
const { chromium } = browserDeps()
const browser = await chromium.launch()
try {
  // ---- the approval page on a phone ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const p = await phone.newPage()
  await p.goto(`${app}/approve/${link.token}`, { waitUntil: 'networkidle' })
  const loaded = await p.$$eval('[data-testid="approve-photo"]', (imgs) => imgs.map((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))
  check('on a phone the two thumbnails load', loaded.length === 2 && loaded.every(Boolean), loaded)
  check('…nothing scrolls sideways at 390 px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  const button = await p.locator('[data-testid="approve-button"]').boundingBox()
  check('…and the button is a full-width target at least 44 px tall', Boolean(button) && button!.height >= 44 && button!.width >= 300, button)
  // (no named function inside evaluate: the script runner adds a helper the page does not have)
  const order = await p.evaluate(
    (selectors) => selectors.map((sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1),
    ['[data-testid="approve-warning"]', '[data-testid="approve-lines"]', '[data-testid="approve-total"]', '[data-testid="approve-photos"]', '[data-testid="approve-button"]', '[data-testid="approve-dashboard"]']
  )
  check('…top to bottom: warnings, lines, total, photos, Approve & send, the dashboard link', order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1]!)), order)
  await p.screenshot({ path: path.join(outDir, 'approve-390.png'), fullPage: true })

  // ---- one tap approves ----
  await p.click('[data-testid="approve-button"]')
  await p.waitForSelector('[data-outcome="approved"]', { timeout: 60_000 })
  const approved = await quoteRow(q.id, 'status,approved_via,sent_at')
  check('one tap approves and sends: the quote is sent, recorded as approved from the email link', approved.status === 'sent' && approved.approved_via === 'email_link' && Boolean(approved.sent_at), approved)
  const afterUse = await fetch(photoUrl(link.token, photoOne), { redirect: 'manual' })
  const linkUsed = ((await sb.select('quote_approval_tokens', `token_hash=eq.${link.hash}&select=attempts,used_at,invalidated_at`)) as Row[])[0]
  check('once the link is used, its photos stop (404)', afterUse.status === 404, { status: afterUse.status, link: linkUsed })
  const used = await openPage(link.token)
  check('…and the used link shows no detail and no photos, only that it is approved', used.outcome === 'already_approved' && !used.html.includes('data-testid="approve-detail"') && !used.html.includes('data-testid="approve-photo"'), used.outcome)
  await phone.close()

  // ---- the customer's quote page: the business's name, with and without a logo ----
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // the link the customer was given when they asked (every link issued for a quote keeps working, AD-042)
  const quoteUrl = `${app}/q/${q.id}?token=${q.token}`
  const cp = await desk.newPage()
  await cp.goto(quoteUrl, { waitUntil: 'networkidle' })
  await cp.waitForSelector('[data-testid="business-name"]', { timeout: 60_000 })
  check('with no logo, the quote page shows the business’s name alone', (await cp.locator('[data-testid="business-name"]').innerText()).trim() === a.name && (await cp.locator('[data-testid="business-logo"]').count()) === 0)
  // sentence case: every heading and button on the page (names and money aside)
  const texts = await cp.$$eval('h1, h2, h3, h4, button, a', (els) => els.map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 0 && t.length < 60))
  const nameWords = new Set([...a.name.split(' '), ...ALPHA.name.split(' '), ...BETA.name.split(' '), 'Megan', 'Grant', PRODUCT_NAME, 'PDF'])
  const titleCased = texts.filter((t) => {
    const words = t.split(' ')
    return words.length >= 2 && words.length <= 5 && !/[.,:!?$]/.test(t) && words.slice(1).some((w) => /^[A-Z][a-z]+$/.test(w) && !nameWords.has(w))
  })
  check('every heading and button on the quote page is sentence case', titleCased.length === 0, titleCased)

  // a logo is uploaded in Settings
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(readFileSync(jpg))], { type: 'image/jpeg' }), 'logo.jpg')
  const logo = await fetch(`${app}/api/tenant/logo`, { method: 'POST', headers: a.cookie, body: form })
  check('a logo is uploaded', logo.status === 200, logo.status)
  await cp.goto(quoteUrl, { waitUntil: 'networkidle' })
  await cp.waitForSelector('[data-testid="business-logo"]', { timeout: 60_000 })
  const logoBox = await cp.locator('[data-testid="business-logo"]').boundingBox()
  const nameBox = await cp.locator('[data-testid="business-name"]').boundingBox()
  const logoLoaded = await cp.$eval('[data-testid="business-logo"]', (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)
  check('with a logo, the name is still there, in words', (await cp.locator('[data-testid="business-name"]').innerText()).trim() === a.name)
  check('…beside the logo: to its right, on the same row', Boolean(logoBox && nameBox) && logoLoaded && nameBox!.x >= logoBox!.x + logoBox!.width && Math.abs(nameBox!.y + nameBox!.height / 2 - (logoBox!.y + logoBox!.height / 2)) < logoBox!.height / 2, { logoBox, nameBox, logoLoaded })
  await cp.screenshot({ path: path.join(outDir, 'quote-with-logo-1280.png') })
  const phoneQuote = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pq = await phoneQuote.newPage()
  await pq.goto(quoteUrl, { waitUntil: 'networkidle' })
  await pq.waitForSelector('[data-testid="business-logo"]', { timeout: 60_000 })
  check('…and on a phone the logo and the name fit with nothing scrolling sideways', await pq.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await pq.screenshot({ path: path.join(outDir, 'quote-with-logo-390.png') })
  await phoneQuote.close()
  await desk.close()
} finally {
  await browser.close()
}

finish()
