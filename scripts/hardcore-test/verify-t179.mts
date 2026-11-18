// T-179 check: one request, several services (AD-061).
//
// A customer asks for another of the business's services in their note. The quote page offers it
// as a card; adding it puts it on the SAME quote as a section, priced by the rules engine from
// that service's own rules, with no AI call. One total, tax once, one accept.
//
// Two stand-ins run inside this script, so every run is the same (a live model's answers vary):
//   - the model that reads the customer's note for other services and for answers to their
//     questions (the worker asks this script instead: SECTION_AI_BASE_URL);
//   - the model that says whether a description fits the chosen service (T-178's matcher, on
//     the web app: SERVICE_MATCH_BASE_URL). Fixture services have generic names on purpose.
//
// Web app:   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//            SERVICE_MATCH_BASE_URL=http://127.0.0.1:8796/match pnpm dev:web
// Worker:    cd apps/worker && npx wrangler dev --var SECTION_AI_BASE_URL:http://127.0.0.1:8796/note
// (the worker honours that setting only when ENVIRONMENT=development, which local dev is)
//
// Run:  PLAYWRIGHT_DIR=<folder> npx tsx scripts/hardcore-test/verify-t179.mts
// Without PLAYWRIGHT_DIR the browser section is skipped, and the script says so.
import http from 'node:http'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { generateQuotePdfHtml } from '../../apps/web/src/lib/pdf-template'
import { sectionsEmailHtml } from '../../apps/web/src/lib/sections-email'
import { requestUpdatedEmail } from '../../apps/web/src/lib/request-updated-email'
import { notOfferedLine, questionsToAddLabel, willConfirmLine } from '../../packages/shared/src/quote-sections'

type Row = Record<string, unknown>
const MOCK_PORT = 8796
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t179-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const notChecked: string[] = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, values: Row) => call('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=minimal' }, body: values })
const money = (n: number) => Math.round(n * 100) / 100

// =====================================================================================
// Stand-ins: the model that reads the note (worker), and the service matcher (web)
// =====================================================================================
/** What the note-reading "model" answers, by a marker in the note */
const notePlan = new Map<string, { requests?: Row[]; answers?: Row }>()
const noteCalls: Array<{ kind: 'detect' | 'prefill'; prompt: string }> = []
const matchPlan = new Map<string, Row>()
const mock = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    let body: Row | null = null
    try {
      body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Row) : null
    } catch {
      body = null
    }
    const url = req.url ?? '/'
    if (url.startsWith('/note')) {
      const prompt = String(body?.prompt ?? '')
      const prefill = prompt.includes('The business asks these questions')
      noteCalls.push({ kind: prefill ? 'prefill' : 'detect', prompt })
      const marker = [...notePlan.keys()].find((m) => prompt.includes(m))
      const plan = marker ? notePlan.get(marker)! : {}
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end(JSON.stringify(prefill ? { answers: plan.answers ?? {} } : { requests: plan.requests ?? [] }))
    }
    if (url.startsWith('/match/')) {
      const prompt = String((body as { contents?: Array<{ parts?: Array<{ text?: string }> }> } | null)?.contents?.[0]?.parts?.[0]?.text ?? '')
      const marker = [...matchPlan.keys()].find((m) => prompt.includes(m))
      const answer = marker ? matchPlan.get(marker)! : { isMatch: true, confidence: 0.6, suggestedServiceId: null, reason: 'Fits.' }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] }))
    }
    res.writeHead(404)
    res.end('{}')
  })
})
await new Promise<void>((resolve, reject) => mock.once('error', reject).listen(MOCK_PORT, '127.0.0.1', resolve))
function finish(): never {
  mock.close()
  const failed = checks.filter((c) => !c.pass)
  if (notChecked.length) console.log(`\nNot checked:\n${notChecked.map((n) => `  - ${n}`).join('\n')}`)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}

// =====================================================================================
// A business with three services (generic names), 10% tax
//   Alpha: the main service. One fixed line, $200. Sends automatically.
//   Beta:  one fixed line, $150, with a $180 minimum. Reviewed before it is sent (the default).
//   Gamma: two questions of its own: how many (priced per unit, $40) and a size ("Large" adds $60). Sends automatically.
// =====================================================================================
const id = shortId()
const businessName = `Northside Services ${id}`
const ownerEmail = `owner+t179-${id}@hardcore.test`
const user = await sb.createUser(ownerEmail, `Hardcore-${id}-Aa1!`, businessName)
const session = await sb.signIn(ownerEmail, `Hardcore-${id}-Aa1!`)
const cookieHeader = sessionCookieHeader(cfg, session)
const cookie = { Cookie: cookieHeader }
const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName } })
const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: true, taxRate: 0.1, serviceAreaMode: 'none', serviceAreaValues: [] } }))
// T-180: this script sends more than ten requests. Until the usage counter was made exact, six sent
// together counted as two, so the business never reached the ten free quotes; now every request is
// counted and the eleventh would be held. The business is put on a plan (a free test account, as
// scripts/set-test-plan.sh makes), which is what a business sending this many requests has.
await sb.insert('subscriptions', { tenant_id: tenantId, plan_id: 'plan_us_pro', status: 'active', current_period_start: new Date().toISOString() })
const taxRow = ((await sb.select('tenants', `id=eq.${tenantId}&select=tax_enabled,tax_rate`)) as Row[])[0]!
const TAX = Number(taxRow.tax_rate) // stored as a decimal
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
const tenantKey = site.tenant_key as string

async function makeService(name: string, description: string, includes: string[], steps: Row[], minimumCharge = 0): Promise<string> {
  const created = expectOk(`service ${name}`, await call('POST', `${app}/api/services`, {
    headers: cookie,
    body: {
      name, description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: includes, scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
      workSteps: steps, expectedSignals: [],
      pricingRules: { baseFee: 0, minimumCharge, addons: [], multipliers: [], workSteps: steps },
    },
  }))
  return created.service.id as string
}
const ALPHA = { name: 'Service Alpha', price: 200 }
const BETA = { name: 'Service Beta', price: 150, minimum: 180 }
const GAMMA = { name: 'Service Gamma', unit: 40, large: 60 }
const alphaId = await makeService(ALPHA.name, 'The alpha visit', ['One alpha visit', 'Alpha inspection'], [{ id: 'alpha_visit', name: 'Alpha visit', description: 'One alpha visit', costType: 'fixed', defaultCost: ALPHA.price, optional: false }])
const betaId = await makeService(BETA.name, 'The beta job', ['One beta job'], [{ id: 'beta_job', name: 'Beta job', description: 'One beta job', costType: 'fixed', defaultCost: BETA.price, optional: false }], BETA.minimum)
const gammaId = await makeService(GAMMA.name, 'Gamma units fitted', ['Fitting gamma units'], [
  { id: 'gamma_units', name: 'Gamma units', description: 'Each gamma unit fitted', costType: 'per_unit', defaultCost: GAMMA.unit, optional: false, quantitySource: { type: 'form_field', fieldId: 'gamma_count' } },
  { id: 'gamma_large', name: 'Large size', description: 'Extra for the large size', costType: 'fixed', defaultCost: GAMMA.large, optional: true, when: { fieldId: 'gamma_size', operator: 'equals', equals: 'Large' } },
])
// Gamma's own questions (its row of the form's settings); Alpha and Beta ask none
for (const row of (await sb.select('widget_configs', `tenant_id=eq.${tenantId}&service_id=eq.${gammaId}&select=id`)) as Row[]) await call('DELETE', `${cfg.supabaseUrl}/rest/v1/widget_configs?id=eq.${row.id}`, { headers: admin })
await sb.insert('widget_configs', {
  tenant_id: tenantId,
  service_id: gammaId,
  config_json: {
    fields: [
      { fieldId: 'gamma_count', type: 'number', label: 'How many gamma units?', required: true },
      { fieldId: 'gamma_size', type: 'select', label: 'Which size?', required: true, options: [{ value: 'Small', label: 'Small' }, { value: 'Large', label: 'Large' }] },
    ],
    files: { minPhotos: 0, maxPhotos: 4, maxDocs: 0 },
  },
})
// How each reaches the customer: Alpha and Gamma send automatically; Beta is reviewed first (the default)
await patch('services', `id=eq.${alphaId}`, { auto_send: true, hold_until_approved: false })
await patch('services', `id=eq.${gammaId}`, { auto_send: true, hold_until_approved: false })

const submit = (customer: Row, note: string, serviceId = alphaId) =>
  call('POST', `${app}/api/public/quotes`, { body: { tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: note }] }, assetIds: [], source: { type: 'widget' } }, timeoutMs: 120_000 })
const quoteRow = async (quoteId: string) =>
  ((await sb.select('quotes', `id=eq.${quoteId}&select=status,service_id,pricing_json,content_json,pricing_trace_json,review_hold,approved_at,quality_gate_json`)) as Row[])[0]!
async function settle(quoteId: string, timeoutMs = 420_000): Promise<Row> {
  const until = Date.now() + timeoutMs
  let row = await quoteRow(quoteId)
  while (Date.now() < until && ['queued', 'generating'].includes(String(row?.status))) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    row = await quoteRow(quoteId)
  }
  return row
}
const tokenOf = (url: unknown) => new URL(String(url)).searchParams.get('token')!
const view = (quoteId: string, token: string) => call('GET', `${app}/api/public/quotes/${quoteId}?token=${token}&poll=1`)
const addSection = (quoteId: string, token: string, serviceId: string, answers?: Row[]) => call('POST', `${app}/api/public/quotes/${quoteId}/sections`, { body: { token, serviceId, ...(answers && { answers }) } })
const removeSection = (quoteId: string, token: string, serviceId: string) => call('DELETE', `${app}/api/public/quotes/${quoteId}/sections`, { body: { token, serviceId } })
const usage = async () => Number((((await sb.select('usage_counters', `tenant_id=eq.${tenantId}&select=estimates_created`)) as Row[])[0] ?? {}).estimates_created ?? 0)
type Asked = { id: string; words: string; serviceId: string | null; serviceName?: string; state: string; price?: number; priceOnApproval?: boolean; questions?: Array<{ key: string; label: string; type: string; prefill?: unknown }> }
const askedOf = (row: Row) => (((row.content_json as Row | null)?.alsoAsked as Asked[] | undefined) ?? [])
const pricingOf = (row: Row) => row.pricing_json as { subtotal: number; taxAmount: number; total: number; breakdown: Row[]; sections?: Array<{ serviceId: string; subtotal: number; breakdown: Array<{ label: string; amount: number; kind?: string }>; addedBy: string }> }

// The notes, each with a marker the stand-in knows
const WORDS = {
  beta: 'I also need service beta done while you are here',
  gamma: 'I also need service gamma, three gamma units fitted',
  boat: 'can you also repaint my boat',
  declined: 'service beta',
  inspection: 'I also need the alpha inspection',
}
notePlan.set('NOTE-BETA', { requests: [{ serviceId: betaId, serviceName: BETA.name, confidence: 0.96, matchedPhrase: WORDS.beta, reason: 'Asks for the beta job.' }] })
notePlan.set('NOTE-GAMMA', { requests: [{ serviceId: gammaId, serviceName: GAMMA.name, confidence: 0.95, matchedPhrase: WORDS.gamma, reason: 'Asks for gamma units.' }], answers: { gamma_count: 3, gamma_size: null } })
notePlan.set('NOTE-BOAT', { requests: [{ serviceId: null, serviceName: null, confidence: 0.95, matchedPhrase: WORDS.boat, reason: 'Not something this business does.' }] })
// a "model" that gets it wrong on purpose: the checks in code must still drop these
notePlan.set('NOTE-DECLINED', { requests: [{ serviceId: betaId, serviceName: BETA.name, confidence: 0.99, matchedPhrase: WORDS.declined, reason: 'Mentions the beta job.' }] })
notePlan.set('NOTE-QUESTION', { requests: [{ serviceId: betaId, serviceName: BETA.name, confidence: 0.99, matchedPhrase: WORDS.declined, reason: 'Mentions the beta job.' }] })
notePlan.set('NOTE-COVERED', { requests: [{ serviceId: null, serviceName: null, confidence: 0.99, matchedPhrase: WORDS.inspection, reason: 'Asks for an inspection.' }] })
// T-180 follow-up (AD-064): the customer's own words, with no word of any service's name in them
const OWN_WORDS = 'I would also like that other thing sorted out'
notePlan.set('NOTE-OWNWORDS', { requests: [{ serviceId: betaId, serviceName: BETA.name, confidence: 0.95, matchedPhrase: OWN_WORDS, reason: 'Asks for the beta job in other words.' }] })
notePlan.set('NOTE-BOTH', { requests: [{ serviceId: gammaId, serviceName: GAMMA.name, confidence: 0.95, matchedPhrase: WORDS.gamma, reason: 'Asks for gamma units.' }], answers: {} })

// =====================================================================================
section('0. The worker and the web app are asking the stand-ins')
const usageStart = await usage()
const who = (name: string) => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com` })
const submitted = await Promise.all([
  submit(who('Megan Grant'), `NOTE-BETA An alpha visit please. ${WORDS.beta}.`),
  submit(who('Dana Whitfield'), `NOTE-GAMMA An alpha visit please. ${WORDS.gamma}.`),
  submit(who('Sam Okafor'), `NOTE-BOAT An alpha visit please, and ${WORDS.boat}?`),
  submit(who('Lee Castellan'), `NOTE-DECLINED An alpha visit please. I don't need ${WORDS.declined} this time.`),
  submit(who('Rosa Delgado'), `NOTE-QUESTION An alpha visit please. Is ${WORDS.declined} included in the price?`),
  submit(who('Theo Marsh'), `NOTE-COVERED An alpha visit please. ${WORDS.inspection}.`),
])
if (!submitted.every((r) => r.ok)) {
  check('the requests could be made', false, submitted.map((r) => r.json?.error ?? r.status))
  finish()
}
console.log('   … waiting for the worker to price them')
const [qBeta, qGamma, qBoat, qDeclined, qQuestion, qCovered] = submitted.map((r) => ({ id: r.json.quoteId as string, token: tokenOf(r.json.quoteViewUrl) }))
const [rBeta, rGamma, rBoat, rDeclined, rQuestion, rCovered] = await Promise.all([qBeta, qGamma, qBoat, qDeclined, qQuestion, qCovered].map((q) => settle(q!.id)))
if (noteCalls.length === 0) {
  console.error('\nThe worker is not asking this script’s stand-in. Start it as the top of this file says (SECTION_AI_BASE_URL), then run again.')
  check('the worker runs with the local test settings', false, { statuses: [rBeta, rGamma].map((r) => r.status) })
  finish()
}
check('the worker runs with the local test settings (the note-reading model is stood in for)', true)
const detectPrompt = noteCalls.find((c) => c.kind === 'detect' && c.prompt.includes('NOTE-BETA'))?.prompt ?? ''
check(
  'the detection prompt is built from the business’s own configuration: the chosen service’s scope and the other services’',
  detectPrompt.includes(`name: ${ALPHA.name}`) && detectPrompt.includes('includes: One alpha visit; Alpha inspection') && detectPrompt.includes(`name: ${BETA.name}`) && detectPrompt.includes('includes: One beta job') && detectPrompt.includes(`id: ${gammaId}`)
)
const fixedText = detectPrompt.replace(/NOTE-[A-Z]+[^\n]*/g, '')
check('… and carries no trade examples', !/carpet|painting|window cleaning|gutter|fence|smart home/i.test(fixedText) && !/\bIT\b/.test(fixedText))

// =====================================================================================
section('1. The main service is priced exactly as before; the other service is offered, not added')
const A_TOTAL = money(ALPHA.price * (1 + TAX))
const pBeta = pricingOf(rBeta!)
check(`the quote is for ${ALPHA.name} alone: $${ALPHA.price} + tax = $${A_TOTAL}, with no sections`, rBeta!.status === 'sent' && pBeta.subtotal === ALPHA.price && pBeta.total === A_TOTAL && !pBeta.sections, { status: rBeta!.status, subtotal: pBeta.subtotal, total: pBeta.total })
const askedBeta = askedOf(rBeta!)
check(
  `it carries what else was asked for: ${BETA.name}, in the customer’s own words, with its price (its $${BETA.minimum} minimum applies to its own section)`,
  askedBeta.length === 1 && askedBeta[0]!.serviceId === betaId && askedBeta[0]!.state === 'offered' && askedBeta[0]!.words === WORDS.beta && askedBeta[0]!.price === BETA.minimum && !(askedBeta[0]!.questions?.length),
  askedBeta
)
check('no "other services you mentioned" estimate is made any more', !(rBeta!.content_json as Row).crossServicePricing)
const vBeta = await view(qBeta!.id, qBeta!.token)
check('the customer’s page is given the card and may add it', vBeta.ok && vBeta.json?.alsoAsked?.[0]?.serviceName === BETA.name && vBeta.json?.canChangeSections === true && !vBeta.json?.sections, vBeta.json?.alsoAsked)

// T-180 follow-up (AD-064). On production the real model named the right other service for a note
// that had no word of that service's name in it, and a check in code threw the answer away. The
// model is stood in for here, so this proves the checks in code: such an answer becomes a card.
const ownWords = await submit(who('Nadia Ferrand'), `NOTE-OWNWORDS An alpha visit please. ${OWN_WORDS}.`)
const rOwnWords = await settle(ownWords.json.quoteId as string)
const askedOwnWords = askedOf(rOwnWords)
check(
  `a request in the customer’s own words (no word of ${BETA.name}’s name in it) is a card for the service the model named`,
  ownWords.ok && askedOwnWords.length === 1 && askedOwnWords[0]!.serviceId === betaId && askedOwnWords[0]!.state === 'offered' && askedOwnWords[0]!.words === OWN_WORDS,
  askedOwnWords
)
check('… and the wording was not flagged as naming a service the quote has no card for', !(rOwnWords.pricing_trace_json as Row | null)?.detectionMiss)

// =====================================================================================
section('2. Test 1: everything known → add → total is A + B, tax once')
const usageBeforeAdds = await usage()
const noteCallsBeforeAdds = noteCalls.length
const added = await addSection(qBeta!.id, qBeta!.token, betaId)
const afterAdd = await quoteRow(qBeta!.id)
const pAdded = pricingOf(afterAdd)
const combinedSubtotal = ALPHA.price + BETA.minimum
check(`adding it: subtotal $${combinedSubtotal} = $${ALPHA.price} + $${BETA.minimum}`, added.status === 200 && pAdded.subtotal === combinedSubtotal, { status: added.status, subtotal: pAdded.subtotal, error: added.json?.error })
check(`tax is worked out once, on the combined subtotal: $${money(combinedSubtotal * TAX)}; total $${money(combinedSubtotal * (1 + TAX))}`, pAdded.taxAmount === money(combinedSubtotal * TAX) && pAdded.total === money(combinedSubtotal * (1 + TAX)), { tax: pAdded.taxAmount, total: pAdded.total })
const betaSection = pAdded.sections?.[0]
check(
  `the section is ${BETA.name}’s own: its line ($${BETA.price}) and its own minimum top-up ($${BETA.minimum - BETA.price}), added by the customer`,
  pAdded.sections?.length === 1 && betaSection?.serviceId === betaId && betaSection.subtotal === BETA.minimum && betaSection.addedBy === 'customer' &&
    betaSection.breakdown.some((l) => l.amount === BETA.price && l.kind !== 'minimum') && betaSection.breakdown.some((l) => l.kind === 'minimum' && l.amount === BETA.minimum - BETA.price),
  betaSection
)
check('the main service’s own lines are untouched', JSON.stringify(pAdded.breakdown) === JSON.stringify(pBeta.breakdown))
check('the same service cannot be added twice', (await addSection(qBeta!.id, qBeta!.token, betaId)).status === 409)
check('a service the customer did not ask for cannot be added', (await addSection(qBeta!.id, qBeta!.token, gammaId)).status === 404)
check('without the quote’s link nothing can be added or removed', (await addSection(qBeta!.id, 'not-the-token', betaId)).status === 401 && (await removeSection(qBeta!.id, 'not-the-token', betaId)).status === 401)

section('3. Test 11: review follows the strictest service on the quote')
check(
  `${ALPHA.name} sends automatically and ${BETA.name} is reviewed first, so the combined quote now waits for the business, still shown to the customer`,
  afterAdd.status === 'pending_review' && afterAdd.review_hold === 'shown' && afterAdd.approved_at === null,
  { status: afterAdd.status, hold: afterAdd.review_hold }
)
const vAdded = await view(qBeta!.id, qBeta!.token)
check(
  'the customer sees both sections with their subtotals, one total, and cannot accept until the business confirms',
  vAdded.json?.sections?.length === 2 && vAdded.json.sections[0].main === true && vAdded.json.sections[0].subtotal === ALPHA.price && vAdded.json.sections[1].subtotal === BETA.minimum &&
    vAdded.json.pricing.total === money(combinedSubtotal * (1 + TAX)) && vAdded.json.review?.confirmationPending === true && vAdded.json.acceptQuoteEnabled === false,
  { sections: vAdded.json?.sections?.map((s: Row) => [s.serviceName, s.subtotal]), accept: vAdded.json?.acceptQuoteEnabled }
)

section('4. Test 3: remove the added section → total back to A')
const removed = await removeSection(qBeta!.id, qBeta!.token, betaId)
const afterRemove = await quoteRow(qBeta!.id)
const pRemoved = pricingOf(afterRemove)
check(`removing it: total back to $${A_TOTAL}, no sections`, removed.status === 200 && pRemoved.subtotal === ALPHA.price && pRemoved.total === A_TOTAL && !pRemoved.sections, { total: pRemoved.total })
check('… and the quote is back where it stood (sent), not left waiting for a review of something that is gone', afterRemove.status === 'sent' && afterRemove.review_hold === null, { status: afterRemove.status, hold: afterRemove.review_hold })
check('the card is offered again', askedOf(afterRemove)[0]?.state === 'offered')

// =====================================================================================
section('5. Test 2: needs 2 answers → answer → priced, no AI call')
const askedGamma = askedOf(rGamma!)
const gq = askedGamma[0]?.questions ?? []
check(
  `${GAMMA.name} needs its own two questions answered; no price is shown until then`,
  askedGamma.length === 1 && askedGamma[0]!.serviceId === gammaId && askedGamma[0]!.price === undefined && gq.length === 2 && gq.map((q) => q.label).join('|') === 'How many gamma units?|Which size?',
  askedGamma[0]
)
check('the answer the note gave ("three") is filled in for the customer to confirm; the one it did not give is left empty', gq.find((q) => q.key === 'gamma_count')?.prefill === 3 && gq.find((q) => q.key === 'gamma_size')?.prefill === undefined, gq.map((q) => [q.key, q.prefill]))
check('the pre-fill came from one read of the note on the first pass', noteCalls.some((c) => c.kind === 'prefill' && c.prompt.includes('NOTE-GAMMA') && c.prompt.includes('How many gamma units?')))
const noAnswers = await addSection(qGamma!.id, qGamma!.token, gammaId)
check('adding it without answers is refused with the questions still to answer (a pre-filled value is not an answer until the customer sends it)', noAnswers.status === 422 && noAnswers.json?.error?.code === 'ANSWERS_NEEDED' && noAnswers.json.error.questions?.length === 2, noAnswers.json?.error?.code)
const half = await addSection(qGamma!.id, qGamma!.token, gammaId, [{ fieldId: 'gamma_count', value: 3 }])
check('one answer of two: still asked for the other', half.status === 422 && half.json?.error?.questions?.length === 1 && half.json.error.questions[0].key === 'gamma_size', half.json?.error?.questions)
const badChoice = await addSection(qGamma!.id, qGamma!.token, gammaId, [{ fieldId: 'gamma_count', value: 3 }, { fieldId: 'gamma_size', value: 'Enormous' }])
check('a choice that is not one of the question’s options is not an answer', badChoice.status === 422)
const answered = await addSection(qGamma!.id, qGamma!.token, gammaId, [{ fieldId: 'gamma_count', value: 3 }, { fieldId: 'gamma_size', value: 'Large' }])
const afterGamma = await quoteRow(qGamma!.id)
const pGamma = pricingOf(afterGamma)
const gammaPrice = 3 * GAMMA.unit + GAMMA.large
check(
  `with both answers it is priced by the rules: 3 × $${GAMMA.unit} + $${GAMMA.large} = $${gammaPrice}; total $${money((ALPHA.price + gammaPrice) * (1 + TAX))}`,
  answered.status === 200 && pGamma.sections?.[0]?.subtotal === gammaPrice && pGamma.subtotal === ALPHA.price + gammaPrice && pGamma.total === money((ALPHA.price + gammaPrice) * (1 + TAX)),
  { status: answered.status, section: pGamma.sections?.[0]?.subtotal, total: pGamma.total, error: answered.json?.error }
)
check('the answers are kept on the section, under the business’s own question wording', JSON.stringify((pGamma.sections?.[0] as Row | undefined)?.answers) === JSON.stringify([{ key: 'gamma_count', label: 'How many gamma units?', value: 3 }, { key: 'gamma_size', label: 'Which size?', value: 'Large' }]), (pGamma.sections?.[0] as Row | undefined)?.answers)
check('no AI call was made by any add or remove', noteCalls.length === noteCallsBeforeAdds, noteCalls.length - noteCallsBeforeAdds)
check(`every service on this quote sends automatically, so it is still sent (not held)`, afterGamma.status === 'sent' || afterGamma.status === 'viewed', afterGamma.status)

section('6. Test 10: one request is one quote, however many sections')
check('adding and removing sections counted nothing on the plan', (await usage()) === usageBeforeAdds && usageBeforeAdds > usageStart, { start: usageStart, afterRequests: usageBeforeAdds, now: await usage() })

// =====================================================================================
section('7. Test 4: something the business does not offer → no price, flagged to the business')
const askedBoat = askedOf(rBoat!)
check('it is recorded as not offered, with the customer’s words and no price', askedBoat.length === 1 && askedBoat[0]!.state === 'not_offered' && askedBoat[0]!.serviceId === null && askedBoat[0]!.words === WORDS.boat && askedBoat[0]!.price === undefined, askedBoat)
check('the quote’s price is the main service’s alone', pricingOf(rBoat!).total === A_TOTAL && !pricingOf(rBoat!).sections)
const vBoat = await view(qBoat!.id, qBoat!.token)
check('the customer is told it will be confirmed separately; nothing can be added', vBoat.json?.alsoAsked?.[0]?.state === 'not_offered' && vBoat.json?.canChangeSections === undefined, vBoat.json?.alsoAsked)

section('8. Tests 5 and 6: "I don’t need X", a question, and something the main service covers → nothing')
check('"I don’t need …" → nothing (the stand-in model named the service anyway; the check in code dropped it)', askedOf(rDeclined!).length === 0 && noteCalls.some((c) => c.kind === 'detect' && c.prompt.includes('NOTE-DECLINED')), askedOf(rDeclined!))
check('"Is … included?" → nothing', askedOf(rQuestion!).length === 0, askedOf(rQuestion!))
check('something the main service already covers (it is in its "includes") → nothing, not another service and not "not offered"', askedOf(rCovered!).length === 0, askedOf(rCovered!))
check('all three are priced as plain requests for the main service', [rDeclined, rQuestion, rCovered].every((r) => pricingOf(r!).total === A_TOTAL && !pricingOf(r!).sections))

// =====================================================================================
section('9. Test 12: held by "Check the service" AND asks for another service → both notices')
matchPlan.set('NOTE-BOTH', { isMatch: false, confidence: 0.96, suggestedServiceId: betaId, reason: 'They describe the beta job.' })
const both = await submit(who('Nadia Whitlock'), `NOTE-BOTH what I really want is the beta job. ${WORDS.gamma}.`)
const rBoth = await settle(both.json.quoteId)
check('the request is made on the chosen service and held for the business (T-178), not refused', both.status === 200 && rBoth.status === 'pending_review' && rBoth.review_hold === 'check', { status: rBoth.status, hold: rBoth.review_hold })
const dashBoth = await call('GET', `${app}/api/quotes/${both.json.quoteId}`, { headers: cookie })
check('the business is given both: the suggested service, and what else the customer asked for', dashBoth.json?.serviceSuggestion?.serviceName === BETA.name && askedOf(dashBoth.json?.quote as Row)[0]?.serviceId === gammaId, { suggestion: dashBoth.json?.serviceSuggestion?.serviceName, asked: askedOf(dashBoth.json?.quote as Row).map((a) => a.serviceName) })
const vBoth = await view(both.json.quoteId, tokenOf(both.json.quoteViewUrl))
check('the customer sees no price and no card while it is held', vBoth.json?.pricing?.total === 0 && !vBoth.json?.alsoAsked && !vBoth.json?.sections)
check('… and cannot add to a quote they cannot see', (await addSection(both.json.quoteId, tokenOf(both.json.quoteViewUrl), gammaId, [{ fieldId: 'gamma_count', value: 1 }, { fieldId: 'gamma_size', value: 'Small' }])).status === 409)

// =====================================================================================
section('10. Test 7: the business adds and removes a section in the editor')
const priceCall = (quoteId: string, serviceId: string, answers?: Row[]) => call('POST', `${app}/api/quotes/${quoteId}/sections/price`, { headers: cookie, body: { serviceId, ...(answers && { answers }) } })
const needs = await priceCall(qDeclined!.id, gammaId)
check('asking for a service’s price: one with questions answers with them first', needs.status === 422 && needs.json?.error?.questions?.length === 2, needs.json?.error?.code)
const pricedGamma = await priceCall(qDeclined!.id, gammaId, [{ fieldId: 'gamma_count', value: 2 }, { fieldId: 'gamma_size', value: 'Small' }])
check(`… then with its price from its own rules (2 × $${GAMMA.unit} = $${2 * GAMMA.unit})`, pricedGamma.status === 200 && pricedGamma.json?.section?.subtotal === 2 * GAMMA.unit, pricedGamma.json?.section?.subtotal)
check('the quote’s own service cannot be added to itself; signed out, nothing is priced', (await priceCall(qDeclined!.id, alphaId)).status === 404 && (await call('POST', `${app}/api/quotes/${qDeclined!.id}/sections/price`, { body: { serviceId: gammaId } })).status === 401)
const detail = await call('GET', `${app}/api/quotes/${qDeclined!.id}`, { headers: cookie })
const main = detail.json.quote.pricing_json as Row
const save = (pricing: Row, version: number) => call('PATCH', `${app}/api/quotes/${qDeclined!.id}`, { headers: cookie, body: { version, pricing_json: pricing, content_json: { scopeSummary: (detail.json.quote.content_json as Row).scopeSummary }, sendToCustomer: false } })
// the editor edits one of the section's lines, like any other line
const editedSection = { ...pricedGamma.json.section, breakdown: [{ label: 'Gamma units, two fitted', amount: 95 }] }
const saved = await save({ ...main, sections: [editedSection] }, detail.json.quote.version)
const afterSave = await quoteRow(qDeclined!.id)
const pSaved = pricingOf(afterSave)
check(
  'saved with the section: its edited line is kept, the totals are worked out on the server, and it is marked as added by the business',
  saved.status === 200 && pSaved.sections?.length === 1 && pSaved.sections[0]!.addedBy === 'business' && pSaved.sections[0]!.subtotal === 95 && pSaved.subtotal === ALPHA.price + 95 && pSaved.total === money((ALPHA.price + 95) * (1 + TAX)),
  { status: saved.status, subtotal: pSaved.subtotal, total: pSaved.total, error: saved.json?.error }
)
const savedWithout = await save({ ...main, sections: [] }, detail.json.quote.version + 1)
const pWithout = pricingOf(await quoteRow(qDeclined!.id))
check('saved without it: back to the main service alone', savedWithout.status === 200 && !pWithout.sections && pWithout.total === A_TOTAL, { status: savedWithout.status, total: pWithout.total })
const foreign = await save({ ...main, sections: [{ serviceId: 'svc_not_this_business', serviceName: 'Made up', breakdown: [{ label: 'x', amount: 1 }] }] }, detail.json.quote.version + 2)
check('a section that is not one of this business’s services is refused', foreign.status === 400, foreign.status)

// =====================================================================================
section('11. Test 8: accept covers every section; the PDF and the emails show them')
const accept = await call('POST', `${app}/api/public/quotes/${qGamma!.id}/accept`, { body: { token: qGamma!.token } })
const accepted = await quoteRow(qGamma!.id)
check('accepting the combined quote accepts the whole of it, at the combined total', accept.ok && accepted.status === 'accepted' && pricingOf(accepted).total === money((ALPHA.price + gammaPrice) * (1 + TAX)) && pricingOf(accepted).sections?.length === 1, { status: accepted.status })
check('once accepted, a section can no longer be added or removed', (await removeSection(qGamma!.id, qGamma!.token, gammaId)).status === 409)
const pdf = generateQuotePdfHtml({
  quoteId: qGamma!.id,
  businessName,
  branding: {} as never,
  template: { showLineItems: true, showAssumptions: true, showExclusions: true } as never,
  customer: { name: 'Dana Whitfield', email: 'dana.whitfield@example.com' },
  pricing: accepted.pricing_json as never,
  content: (accepted.content_json ?? {}) as never,
  createdAt: new Date().toISOString(),
  locale: 'en-US',
  serviceName: ALPHA.name,
})
check('the PDF shows each service as a section with its subtotal, then one total', pdf.includes(`${ALPHA.name} subtotal`) && pdf.includes(`${GAMMA.name} subtotal`) && pdf.includes('$200.00') && pdf.includes('$180.00') && pdf.includes('$418.00'), pdf.match(/subtotal/g)?.length)
const mailRows = sectionsEmailHtml(accepted.pricing_json as never, ALPHA.name, 'en-US')
check('the emails that state the price list both services, the tax and the one total', mailRows.includes(ALPHA.name) && mailRows.includes(GAMMA.name) && mailRows.includes('$200.00') && mailRows.includes('$180.00') && mailRows.includes('$38.00') && mailRows.includes('$418.00'))
const notice = requestUpdatedEmail({ customerName: 'Megan Grant', mainServiceName: ALPHA.name, changedServiceName: BETA.name, change: 'added', pricing: pAdded as never, locale: 'en-US', awaitingApproval: true, dashboardUrl: `${app}/app/quotes/${qBeta!.id}`, approveUrl: `${app}/approve/x` })
check('the business’s notice says "Request updated" (never a new quote), with both sections, the total and an approve button', /^Request updated: Megan Grant added Service Beta to their quote \(\$418\.00\)$/.test(notice.subject) && notice.html.includes('data-role="approve"') && notice.html.includes('$200.00') && notice.html.includes('$180.00') && notice.html.includes('It is still one quote'), notice.subject)

// =====================================================================================
section('12. Test 9: a quote made before this still renders')
const usageBeforeOne = await usage()
const old = await submit(who('Hattie Vane'), 'NOTE-NONE An alpha visit please, nothing else.')
await settle(old.json.quoteId)
check('one request counts as one quote on the plan (a request made on its own adds exactly 1)', (await usage()) === usageBeforeOne + 1, { before: usageBeforeOne, after: await usage() })
const oldRow = await quoteRow(old.json.quoteId)
await patch('quotes', `id=eq.${old.json.quoteId}`, {
  content_json: {
    ...(oldRow.content_json as Row),
    alsoAsked: undefined,
    crossServicePricing: [{ serviceId: betaId, serviceName: BETA.name, reason: 'You mentioned the beta job', baseFee: 0, estimatedTotal: 150, breakdown: ['Beta job: $150.00'], extractedDetails: [], isEstimate: false, note: 'An estimate only.' }],
  },
})
const vOld = await view(old.json.quoteId, tokenOf(old.json.quoteViewUrl))
check('its "other services you mentioned" box is still served; it has no sections and no cards', vOld.ok && vOld.json?.crossServicePricing?.length === 1 && !vOld.json?.sections && !vOld.json?.alsoAsked && vOld.json?.pricing?.total === A_TOTAL, { cross: vOld.json?.crossServicePricing?.length })

// =====================================================================================
section('12a. An added service that holds until approved: its part has no price, the rest stays as it was')
// the same key order every time, so two stored quotes can be compared exactly
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Row).sort(([a], [b]) => a.localeCompare(b))) : v))
const betaFigure = (text: string) => /"(amount|subtotal|price|total|minimumCharge|taxAmount)":\s*(180|150|30|380|38|418)\b/.test(text)
await patch('services', `id=eq.${betaId}`, { auto_send: false, hold_until_approved: true })
const heldReq = await submit(who('Greta Lindqvist'), `NOTE-BETA An alpha visit please. ${WORDS.beta}.`)
const qHeld = { id: heldReq.json.quoteId as string, token: tokenOf(heldReq.json.quoteViewUrl) }
const rHeld = await settle(qHeld.id)
const askedHeld = askedOf(rHeld)
check(
  `${ALPHA.name} still sends on its own, and the card for ${BETA.name} carries no price: the business confirms it first`,
  rHeld.status === 'sent' && pricingOf(rHeld).total === A_TOTAL && askedHeld.length === 1 && askedHeld[0]!.state === 'offered' && askedHeld[0]!.priceOnApproval === true && askedHeld[0]!.price === undefined,
  { status: rHeld.status, asked: askedHeld }
)
const vHeldBefore = await view(qHeld.id, qHeld.token)
const beforeHeldAdd = await quoteRow(qHeld.id)
const addHeld = await addSection(qHeld.id, qHeld.token, betaId)
const afterHeldAdd = await quoteRow(qHeld.id)
const pHeld = pricingOf(afterHeldAdd)
check('adding it works, and the answer to the customer’s browser carries no figures', addHeld.status === 200 && addHeld.json?.pricing === undefined && !betaFigure(JSON.stringify(addHeld.json)), addHeld.json)
check(
  'the business’s copy has the whole quote: both sections, the combined total, and the part marked as waiting for approval',
  pHeld.total === money(combinedSubtotal * (1 + TAX)) && pHeld.sections?.length === 1 && pHeld.sections[0]!.subtotal === BETA.minimum && (pHeld.sections[0] as Row).awaitingApproval === true,
  { total: pHeld.total, section: pHeld.sections?.[0] }
)
check('the quote waits for the business but is NOT hidden: still shown to the customer', afterHeldAdd.status === 'pending_review' && afterHeldAdd.review_hold === 'shown', { status: afterHeldAdd.status, hold: afterHeldAdd.review_hold })
const vHeld = await view(qHeld.id, qHeld.token)
check(
  `the customer still sees the main price exactly as it was ($${A_TOTAL}): same lines, subtotal, tax and total`,
  vHeld.ok && vHeld.json.pricing.total === A_TOTAL && vHeld.json.pricing.subtotal === ALPHA.price && vHeld.json.pricing.taxAmount === vHeldBefore.json.pricing.taxAmount && stable(vHeld.json.pricing.breakdown) === stable(vHeldBefore.json.pricing.breakdown),
  { total: vHeld.json?.pricing?.total, subtotal: vHeld.json?.pricing?.subtotal }
)
const heldParts = (vHeld.json?.sections ?? []) as Row[]
check(
  `the added part is named with no price: no lines, no subtotal (the page says "${willConfirmLine(businessName)}")`,
  heldParts.length === 2 && heldParts[0]!.main === true && heldParts[0]!.subtotal === ALPHA.price && heldParts[1]!.serviceName === BETA.name && heldParts[1]!.awaitingApproval === true && (heldParts[1]!.lines as Row[]).length === 0 && heldParts[1]!.subtotal === 0,
  heldParts.map((part) => [part.serviceName, part.subtotal, part.awaitingApproval])
)
check('nothing the customer’s page is given carries that part’s price, the combined total or a PDF link', !betaFigure(JSON.stringify(vHeld.json)) && !vHeld.json?.actions?.pdfUrl && !(vHeld.json?.alsoAsked as Asked[] | undefined)?.some((a) => a.price !== undefined))
const acceptHeld = await call('POST', `${app}/api/public/quotes/${qHeld.id}/accept`, { body: { token: qHeld.token } })
check('accepting is locked until the business approves', vHeld.json?.acceptQuoteEnabled === false && vHeld.json?.review?.confirmationPending === true && !acceptHeld.ok && (await quoteRow(qHeld.id)).status === 'pending_review', { accept: acceptHeld.status })
const rmHeld = await removeSection(qHeld.id, qHeld.token, betaId)
const afterHeldRemove = await quoteRow(qHeld.id)
check(
  'removing the part restores the quote exactly as it was: the same stored price, status, approval and card',
  rmHeld.status === 200 && stable(afterHeldRemove.pricing_json) === stable(beforeHeldAdd.pricing_json) && afterHeldRemove.status === beforeHeldAdd.status && afterHeldRemove.review_hold === beforeHeldAdd.review_hold &&
    afterHeldRemove.approved_at === beforeHeldAdd.approved_at && stable(askedOf(afterHeldRemove)) === stable(askedOf(beforeHeldAdd)) && (afterHeldRemove.content_json as Row).sectionsBefore === undefined,
  { status: [beforeHeldAdd.status, afterHeldRemove.status], same: stable(afterHeldRemove.pricing_json) === stable(beforeHeldAdd.pricing_json) }
)
const vHeldAfter = await view(qHeld.id, qHeld.token)
check('… and the customer’s page is as it was before they added it', stable(vHeldAfter.json?.pricing) === stable(vHeldBefore.json?.pricing) && !vHeldAfter.json?.sections && vHeldAfter.json?.alsoAsked?.[0]?.state === 'offered')
// added again, then the business approves: now the part shows with its price, and the customer can accept
await addSection(qHeld.id, qHeld.token, betaId)
const dashHeld = await call('GET', `${app}/api/quotes/${qHeld.id}`, { headers: cookie })
check('the business sees the full price of the waiting quote', (dashHeld.json?.quote?.pricing_json as Row | undefined)?.total === money(combinedSubtotal * (1 + TAX)), (dashHeld.json?.quote?.pricing_json as Row | undefined)?.total)
const heldNotice = requestUpdatedEmail({ customerName: 'Greta Lindqvist', mainServiceName: ALPHA.name, changedServiceName: BETA.name, change: 'added', pricing: (await quoteRow(qHeld.id)).pricing_json as never, locale: 'en-US', awaitingApproval: true, dashboardUrl: `${app}/app/quotes/${qHeld.id}` })
check('the business’s notice says the customer sees no price for that part until it approves', heldNotice.html.includes(`The customer sees no price for ${BETA.name} until you approve.`) && heldNotice.html.includes('$418.00'))
// a second quote is left waiting, for the pages in section 13
const heldPageReq = await submit(who('Oskar Brandt'), `NOTE-BETA An alpha visit please. ${WORDS.beta}.`)
const qHeldPage = { id: heldPageReq.json.quoteId as string, token: tokenOf(heldPageReq.json.quoteViewUrl), url: String(heldPageReq.json.quoteViewUrl) }
await settle(qHeldPage.id)
const approveHeld = await call('POST', `${app}/api/quotes/${qHeld.id}/approve`, { headers: cookie })
const vApproved = await view(qHeld.id, qHeld.token)
check(
  'once the business approves, the part shows with its price, the total is the combined one, and the customer can accept',
  approveHeld.ok && vApproved.json?.status !== 'pending_review' && vApproved.json?.pricing?.total === money(combinedSubtotal * (1 + TAX)) && vApproved.json?.sections?.length === 2 && vApproved.json.sections[1].subtotal === BETA.minimum &&
    vApproved.json.sections[1].awaitingApproval === undefined && vApproved.json?.acceptQuoteEnabled !== false,
  { approve: approveHeld.status, status: vApproved.json?.status, total: vApproved.json?.pricing?.total }
)
await patch('services', `id=eq.${betaId}`, { auto_send: false, hold_until_approved: false })

// =====================================================================================
section('13. The pages, in a browser')
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The customer’s quote page, the dashboard and the editor in a browser (set PLAYWRIGHT_DIR).')
  finish()
}
const { browserDeps } = await import('./browser.mjs')
const { chromium } = browserDeps()
const browser = await chromium.launch()
try {
  for (const width of [390, 1440]) {
    // ---- the customer's page: the card, add, both sections, remove ----
    const fresh = await submit(who(`Corin Hale ${width}`), `NOTE-BETA An alpha visit please. ${WORDS.beta}.`)
    await settle(fresh.json.quoteId)
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(String(fresh.json.quoteViewUrl))
    await page.getByTestId('also-asked-card').waitFor({ timeout: 60_000 })
    const card = (await page.getByTestId('also-asked-card').innerText()).replace(/\s+/g, ' ')
    check(`customer page at ${width}px: the card names the service, quotes the customer’s own words and shows its price`, card.includes(BETA.name) && card.includes(`You also asked for: “${WORDS.beta}”`) && card.includes('$180.00') && card.includes('Add to my quote'), card)
    check(`customer page at ${width}px: the total is still the main service’s until something is added`, (await page.locator('body').innerText()).includes('$220.00') && (await page.getByTestId('price-section').count()) === 0)
    await page.getByTestId('also-asked-add').click()
    await page.getByTestId('price-sections').waitFor({ timeout: 30_000 })
    const names = await page.getByTestId('price-section-name').allInnerTexts()
    const subtotals = await page.getByTestId('price-section-subtotal').allInnerTexts()
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    check(`customer page at ${width}px: after adding, each service is a section with its subtotal, then one total`, names.join('|') === `${ALPHA.name}|${BETA.name}` && subtotals.join('|') === '$200.00|$180.00' && bodyText.includes('$418.00') && bodyText.includes('Minimum charge of $180.00 applied'), { names, subtotals })
    check(`customer page at ${width}px: the card is gone (it is on the quote now)`, (await page.getByTestId('also-asked-card').count()) === 0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`customer page at ${width}px: nothing runs off the side`, overflow <= 1, overflow)
    await page.screenshot({ path: path.join(outDir, `customer-combined-${width}.png`), fullPage: true })
    await page.getByTestId('price-section-remove').click()
    await page.getByTestId('also-asked-card').waitFor({ timeout: 30_000 })
    check(`customer page at ${width}px: removing it brings the card and the first total back`, (await page.getByTestId('price-section').count()) === 0 && (await page.locator('body').innerText()).includes('$220.00'))
    await ctx.close()
  }

  // ---- a service with questions: pre-filled answer to confirm, then priced ----
  {
    const fresh = await submit(who('Imogen Rask'), `NOTE-GAMMA An alpha visit please. ${WORDS.gamma}.`)
    await settle(fresh.json.quoteId)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(String(fresh.json.quoteViewUrl))
    await page.getByTestId('also-asked-answer').waitFor({ timeout: 60_000 })
    check('a service with questions shows no price, only "Answer 2 questions to add it"', (await page.getByTestId('also-asked-answer').innerText()).trim() === questionsToAddLabel(2) && (await page.getByTestId('also-asked-price').count()) === 0)
    await page.getByTestId('also-asked-answer').click()
    const inputs = page.getByTestId('also-asked-input')
    check('the answer read from the note is filled in and marked as such, for the customer to confirm or change', (await inputs.nth(0).inputValue()) === '3' && (await page.getByTestId('also-asked-prefilled').count()) === 1 && (await inputs.nth(1).inputValue()) === '')
    check('the button waits for every answer', await page.getByTestId('also-asked-add').isDisabled())
    await inputs.nth(0).fill('2')
    await inputs.nth(1).selectOption('Large')
    await page.screenshot({ path: path.join(outDir, 'customer-questions-390.png'), fullPage: true })
    await page.getByTestId('also-asked-add').click()
    await page.getByTestId('price-sections').waitFor({ timeout: 30_000 })
    const subtotals = await page.getByTestId('price-section-subtotal').allInnerTexts()
    check('the customer changed the pre-filled 3 to 2: priced from what they sent (2 × $40 + $60 = $140)', subtotals.join('|') === '$200.00|$140.00' && (await page.locator('body').innerText()).includes('$374.00'), subtotals)
    await ctx.close()
  }

  // ---- a service that holds until approved: no price on the card or on its part; the main price stays ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(qHeldPage.url)
    await page.getByTestId('also-asked-card').waitFor({ timeout: 60_000 })
    const card = (await page.getByTestId('also-asked-card').innerText()).replace(/\s+/g, ' ')
    check('hold until approved: the card shows no price, only that the business will confirm this part', card.includes(BETA.name) && card.includes(willConfirmLine(businessName)) && !/\$\d/.test(card) && (await page.getByTestId('also-asked-price').count()) === 0, card)
    await patch('services', `id=eq.${betaId}`, { auto_send: false, hold_until_approved: true })
    await page.getByTestId('also-asked-add').click()
    await page.getByTestId('price-section-awaiting').waitFor({ timeout: 30_000 })
    await patch('services', `id=eq.${betaId}`, { auto_send: false, hold_until_approved: false })
    const names = await page.getByTestId('price-section-name').allInnerTexts()
    const subtotals = await page.getByTestId('price-section-subtotal').allInnerTexts()
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    check(
      'hold until approved: after adding, the main price is still there as it was, and the added part reads "<business> will confirm this part" with no price',
      names.join('|') === `${ALPHA.name}|${BETA.name}` && subtotals.join('|') === '$200.00' && (await page.getByTestId('price-section-awaiting').innerText()).trim() === willConfirmLine(businessName) &&
        bodyText.includes('$220.00') && !bodyText.includes('$418.00') && !bodyText.includes('$180.00') && !bodyText.includes('$380.00'),
      { names, subtotals }
    )
    check('hold until approved: the customer is told they can accept once the business confirms, and there is no accept button', bodyText.includes(`You can accept once ${businessName} confirms this estimate.`) && (await page.getByRole('button', { name: /accept/i }).count()) === 0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('hold until approved: nothing runs off the side at 390px', overflow <= 1, overflow)
    await page.screenshot({ path: path.join(outDir, 'customer-part-awaiting-390.png'), fullPage: true })
    await ctx.close()
  }

  // ---- not offered ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${app}/q/${qBoat!.id}?token=${qBoat!.token}`)
    await page.getByTestId('also-asked-not-offered').waitFor({ timeout: 60_000 })
    const line = (await page.getByTestId('also-asked-not-offered').innerText()).trim()
    check('something not offered: "We’ll confirm … with you separately.", no price and no button', line === notOfferedLine(WORDS.boat) && (await page.getByTestId('also-asked-add').count()) === 0 && !/\$\d/.test(line), line)
    await ctx.close()
  }

  // ---- an old quote ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(String(old.json.quoteViewUrl))
    await page.getByText('Other services you mentioned').waitFor({ timeout: 60_000 })
    check('an old quote still shows its "Other services you mentioned" box, and no card', (await page.getByTestId('also-asked').count()) === 0 && (await page.locator('body').innerText()).includes('$220.00'))
    await ctx.close()
  }

  // ---- the business: the notices at the top, and the editor ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await ctx.addCookies(cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: app })))
  const page = await ctx.newPage()
  await page.goto(`${app}/app/quotes/${both.json.quoteId}`)
  await page.getByTestId('customer-also-asked').waitFor({ timeout: 60_000 })
  check('dashboard: "Check the service" and "Customer also asked for" both show, one beside the other', (await page.getByTestId('service-suggestion').count()) === 1 && (await page.getByTestId('customer-also-asked').innerText()).includes(GAMMA.name) && (await page.getByTestId('also-asked-state').innerText()).trim() === 'Not added yet')
  await page.screenshot({ path: path.join(outDir, 'business-both-notices-1440.png'), fullPage: true })
  await page.goto(`${app}/app/quotes/${qGamma!.id}`)
  await page.getByTestId('customer-also-asked').waitFor({ timeout: 60_000 })
  check('dashboard: a service the customer added says so, and the price is shown in sections', (await page.getByTestId('also-asked-state').innerText()).trim() === 'Added by the customer' && (await page.getByTestId('quote-section').count()) === 2 && (await page.getByTestId('quote-section-subtotal').allInnerTexts()).join('|') === '$200.00|$180.00')
  await page.goto(`${app}/app/quotes/${qHeldPage.id}`)
  await page.getByTestId('also-asked-price-waits').waitFor({ timeout: 60_000 })
  check('dashboard: the business is told the customer sees no price for the waiting part, and sees the full price itself', (await page.getByTestId('also-asked-price-waits').innerText()).trim() === 'The customer sees no price for this part until you approve.' && (await page.getByTestId('quote-section').count()) === 2 && (await page.locator('body').innerText()).includes('$418.00'))
  await page.goto(`${app}/app/quotes/${qBoat!.id}`)
  await page.getByTestId('customer-also-asked').waitFor({ timeout: 60_000 })
  check('dashboard: something not offered is flagged at the top of the quote', (await page.getByTestId('also-asked-state').innerText()).trim() === 'Not one of your services' && (await page.getByTestId('customer-also-asked').innerText()).includes(WORDS.boat))

  // the editor: add a service at its price, see the totals, save; then remove it
  await page.goto(`${app}/app/quotes/${qCovered!.id}`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByTestId('editor-add-service').click()
  await page.getByTestId('editor-add-service-select').selectOption({ label: BETA.name })
  await page.getByTestId('editor-add-service-price').click()
  await page.getByTestId('editor-section').waitFor({ timeout: 30_000 })
  check('editor: adding a service brings its lines at its own price, with its minimum', (await page.getByTestId('editor-section-subtotal').innerText()).trim() === '$180.00' && (await page.getByTestId('editor-section-minimum').count()) === 1 && (await page.getByTestId('editor-total').innerText()).trim() === '$418.00', await page.getByTestId('editor-total').innerText())
  await page.screenshot({ path: path.join(outDir, 'business-editor-1440.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await page.getByTestId('quote-sections').waitFor({ timeout: 30_000 })
  const savedRow = pricingOf(await quoteRow(qCovered!.id))
  check('editor: saved, the quote carries the section and the combined total', savedRow.sections?.length === 1 && savedRow.sections[0]!.subtotal === BETA.minimum && savedRow.total === 418, { total: savedRow.total })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByTestId('editor-section-remove').click()
  check('editor: removing it takes the total back', (await page.getByTestId('editor-total').innerText()).trim() === '$220.00')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await page.getByTestId('pricing').waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="quote-section"]').length === 0, undefined, { timeout: 30_000 })
  check('editor: saved without it, the quote is the main service alone again', !pricingOf(await quoteRow(qCovered!.id)).sections && pricingOf(await quoteRow(qCovered!.id)).total === A_TOTAL)
  await ctx.close()
} finally {
  await browser.close()
}
notChecked.push('The emails as delivered: no email leaves this machine. Their content is built and read here.')
notChecked.push('A PDF file: the PDF service is not called locally; the page it prints is built and read here.')
notChecked.push('The on-site app and WhatsApp screens: not opened here. What they are given is described in Docs/CHANGELOG.md (T-179).')
finish()
