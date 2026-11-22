// T-197 check: the Help button, problem and estimate reports, feature requests and the support
// inbox, against the real server (local stack) and the REAL model.
//
// No email is sent: the local web app has no Postmark token, so a reply is delivered to the
// business's Help panel only (the email rules are unit tests). Nothing here touches production.
//
// What it proves:
//   A. migration 47: a business reads and writes only its own reports, threads and votes; the
//      owner's side (the AI's sorting, the note) is closed to every user; the routes refuse a
//      signed-out caller, another business, and a non-admin on the inbox
//   B. three sample problems are sorted sensibly by the model (kind, severity, a title, a draft
//      fix ticket in the house format), a duplicate from another business is found and only
//      suggested, and a customer's details typed into the box reach neither the model's answer
//      nor the ticket
//   C. an estimate report on a quote with a plainly wrong rate comes back as "Your price setup",
//      with the hint written from the business's own setup; the "should have been" figure
//      changes no price; a test estimate is marked; a quote can be reported twice
//   D. two feature requests: the second is recognised as the first (the business decides), one
//      vote per business, a different request is saved as new, a plain title replaces the
//      business's own words
//   E. the inbox: priority order, merge and undo, reply and the unread dot, "Fixed" and
//      "Shipped" (confirmed first, each business once), rename, split, the count
//   F. the daily limit, with its plain message
//   G. the screens (a real browser), saved to .checks/t197/
//
// Needs the web app and the worker with the real model: `pnpm check:full --only t197`.
// Run by hand:  PLAYWRIGHT_DIR=~/qolumns-browser npx tsx scripts/hardcore-test/verify-t197.mts
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId } from './lib.mjs'
import { browserDeps } from './browser.mjs'
import { SUPPORT_COPY, SUPPORT_DAILY_LIMIT } from '../../packages/shared/src/support'
import { TICKET_SAFETY_LINE } from '../../packages/shared/src/support-sort'
import { featureShippedEmail, supportDailyEmail, supportFixedEmail, supportReplyEmail } from '../../packages/shared/src/support-emails'

type Row = Record<string, unknown>
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const shots = path.join(ROOT, '.checks/t197')
mkdirSync(shots, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
/** What the model got wrong, for the report: not a pass or a fail of ours */
const modelNotes: string[] = []
const section = (title: string) => console.log(`\n== ${title}`)
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rest = (pathAndQuery: string) => `${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`
const asUser = (accessToken: string) => ({ apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` })
const rows = async (table: string, query: string) => (await sb.select(table, query)) as Row[]

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(cfg.supabaseUrl)) {
  console.error('verify-t197 runs against the local database only.')
  process.exit(2)
}

function finish(): never {
  const failed = checks.filter((c) => !c.pass)
  if (modelNotes.length) console.log(`\nWhat the model got wrong:\n${modelNotes.map((n) => `  - ${n}`).join('\n')}`)
  else console.log('\nWhat the model got wrong: nothing in this run.')
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (screens: ${shots})`)
  process.exit(failed.length ? 1 : 0)
}

// Earlier runs leave open reports and requests behind. The model is offered every open one as a
// possible look-alike, so they are closed first: this run then sees only its own.
await call('PATCH', rest('support_reports?status=in.(new,looking)'), { headers: { ...admin, Prefer: 'return=minimal' }, body: { status: 'answered' } })
await call('PATCH', rest('feature_requests?status=in.(under_review,planned)'), { headers: { ...admin, Prefer: 'return=minimal' }, body: { status: 'not_planned' } })
await call('DELETE', rest('support_reports?body=like.filler*'), { headers: admin })
await call('DELETE', rest('feature_requests?title=like.Filler%20request*'), { headers: admin })

// =====================================================================================
// Two businesses and the platform's admin
// =====================================================================================
interface Person { userId: string; email: string; cookie: { Cookie: string }; cookieHeader: string; accessToken: string }
interface Business extends Person { name: string; tenantId: string; tenantKey: string; serviceId: string }
async function person(email: string, name: string): Promise<Person> {
  const password = `Hardcore-${shortId()}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookieHeader = sessionCookieHeader(cfg, session)
  return { userId: user.id as string, email, cookie: { Cookie: cookieHeader }, cookieHeader, accessToken: session.access_token as string }
}
/** A plainly wrong rate: a room is priced at ten times what the business means */
const WRONG = { line: 'Rooms painted', rate: 3750, rooms: 2, meant: 750 }
async function business(label: string): Promise<Business> {
  const id = shortId()
  const name = `${label} ${id}`
  const owner = await person(`owner+t197-${id}@hardcore.test`, name)
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: owner.cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await rows('user_profiles', `id=eq.${owner.userId}&select=tenant_id`))[0]!.tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: owner.cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const steps = [{ id: 'rooms', name: WRONG.line, description: 'Prepare and paint each room', costType: 'per_unit', defaultCost: WRONG.rate, optional: false, unitLabel: 'room', quantitySource: { type: 'form_field', fieldId: 'room_count' } }]
  const created = expectOk('service', await call('POST', `${app}/api/services`, {
    headers: owner.cookie,
    body: {
      name: 'Room refresh', description: 'Painting rooms, for the T-197 check', documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['Painting walls'], scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: '', requiredAngles: [] },
      workSteps: steps, expectedSignals: [],
      suggestedFields: [{ fieldId: 'room_count', label: 'How many rooms?', type: 'number', required: true }],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: steps },
    },
  }))
  return { ...owner, name, tenantId, tenantKey: site.tenant_key as string, serviceId: created.service.id as string }
}

const a = await business('Harbour Painting')
const rival = await business('Rival Decorating')
const third = await business('Limit Works')
// a second user of the first business, and the platform's own admin (a profile's role, set by the service role)
const second = await person(`second+t197-${shortId()}@hardcore.test`, 'Second user')
await call('DELETE', rest(`user_profiles?id=eq.${second.userId}`), { headers: admin })
await sb.insert('user_profiles', { id: second.userId, tenant_id: a.tenantId, role: 'owner', display_name: 'Second user' })
const owner = await business('Platform Owner')
await call('PATCH', rest(`user_profiles?id=eq.${owner.userId}`), { headers: { ...admin, Prefer: 'return=minimal' }, body: { role: 'admin' } })

const CUSTOMER = { name: 'Megan Grant', email: `megan.grant.${shortId()}@hardcore.test`, phone: '+1 314 555 0142' }
const submit = (b: Business, customer: Row, rooms: number) =>
  call('POST', `${app}/api/public/quotes`, {
    body: { tenantKey: b.tenantKey, serviceId: b.serviceId, customer, job: { postcodeOrZip: '63021', answers: [{ fieldId: 'room_count', value: rooms }] }, source: { type: 'widget' } },
    timeoutMs: 150_000,
  })
const quoteRow = async (quoteId: string) => (await rows('quotes', `id=eq.${quoteId}&select=*`))[0]!
async function priced(quoteId: string, timeoutMs = 420_000): Promise<Row> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const quote = await quoteRow(quoteId)
    if (!['queued', 'generating'].includes(quote.status as string) || Date.now() > until) return quote
    await sleep(2000)
  }
}
const internalOf = async (reportId: string) => (await rows('support_report_internal', `report_id=eq.${reportId}&select=*`))[0] ?? null
const reportOf = async (reportId: string) => (await rows('support_reports', `id=eq.${reportId}&select=*`))[0]!
/** Wait for the worker to sort a report (or to give up on it) */
async function sorted(reportId: string, timeoutMs = 120_000): Promise<Row | null> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const internal = await internalOf(reportId)
    if ((internal && internal.sort_state !== 'waiting') || Date.now() > until) return internal
    await sleep(1500)
  }
}
const report = (who: Person, body: Row) => call('POST', `${app}/api/support/reports`, { headers: who.cookie, body })
const feature = (who: Person, body: Row) => call('POST', `${app}/api/support/features`, { headers: who.cookie, body, timeoutMs: 30_000 })
const inbox = (pathAndQuery: string, who: Person = owner, method = 'GET', body?: Row) => call(method, `${app}/api/admin/support${pathAndQuery}`, { headers: who.cookie, ...(body && { body }) })
const problemAct = (id: string, body: Row) => inbox(`/problems/${id}`, owner, 'POST', body)
const featureAct = (id: string, body: Row) => inbox(`/features/${id}`, owner, 'POST', body)

// =====================================================================================
section('B. Three sample problems, sorted by the real model')
// =====================================================================================
// A quote for the first business, so that a problem can be reported from its page with the customer's details typed in
const submitted = expectOk('quote', await submit(a, CUSTOMER, WRONG.rooms))
const quoteId = submitted.quoteId as string
const quote = await priced(quoteId)
check('the fixture quote is priced from the business’s own (wrong) rate', (quote.pricing_json as { total?: number })?.total === WRONG.rate * WRONG.rooms, (quote.pricing_json as { total?: number })?.total)

const SAMPLES = {
  blocked: `Megan Grant (${CUSTOMER.email}, ${CUSTOMER.phone}) never got her estimate. When I press Send again on a quote nothing happens at all, on every quote, so I cannot send any estimate to any customer today.`,
  howTo: 'How do I change the logo that shows at the top of the estimate my customers see? I cannot find where to upload it.',
  billing: 'I think I was charged twice for my plan this month. There are two payments on my card statement.',
  same: 'The Send again button does nothing when I click it. None of my customers are receiving their estimates and I have no way to send them.',
}
const sentBlocked = await report(a, { kind: 'problem', body: SAMPLES.blocked, context: { page: `/app/quotes/${quoteId}`, quoteId, browser: 'Chrome 141 on macOS', screen: '1440 × 900', lastError: 'Could not send this quote again', tenantId: rival.tenantId, secret: 'x' } })
const blockedId = (expectOk('report', sentBlocked).report as Row).id as string
check('a report is thanked at once, with no promise of a time', sentBlocked.json.message === SUPPORT_COPY.problem.thanks && !/\b(hour|day|minute|soon)\b/i.test(sentBlocked.json.message as string), sentBlocked.json.message)
const blockedRow = await reportOf(blockedId)
const blockedContext = blockedRow.context_json as Row
check('saved as the signed-in user’s own business, with the quote, the page, the browser, the screen, the last error and the plan; nothing else a browser sent', blockedRow.tenant_id === a.tenantId && blockedRow.user_id === a.userId && blockedRow.quote_id === quoteId && blockedContext.page === `/app/quotes/${quoteId}` && typeof blockedContext.plan === 'string' && blockedContext.lastError === 'Could not send this quote again' && !('tenantId' in blockedContext) && !('secret' in blockedContext), blockedContext)
const howToId = (expectOk('report', await report(a, { kind: 'problem', body: SAMPLES.howTo, context: { page: '/app/settings' } })).report as Row).id as string
const billingId = (expectOk('report', await report(a, { kind: 'problem', body: SAMPLES.billing, context: { page: '/app/settings' } })).report as Row).id as string
check('a report with no words is refused, with a plain message', (await report(a, { kind: 'problem', body: '   ' })).json?.error?.message === SUPPORT_COPY.problem.required)

const [blocked, howTo, billing] = await Promise.all([sorted(blockedId), sorted(howToId), sorted(billingId)])
check('all three were sorted by the worker', [blocked, howTo, billing].every((r) => r?.sort_state === 'sorted'), [blocked?.sort_state, howTo?.sort_state, billing?.sort_state])
const sensible = (name: string, row: Row | null, kinds: string[], severities: string[]) => {
  const ok = Boolean(row) && kinds.includes(row!.ai_kind as string) && severities.includes(row!.severity as string)
  check(`${name}: sorted as ${kinds.join(' or ')}, ${severities.join(' or ')}`, ok, { kind: row?.ai_kind, severity: row?.severity, title: row?.title })
  if (!ok) modelNotes.push(`${name}: the model said kind "${row?.ai_kind}", severity "${row?.severity}" (expected ${kinds.join('/')}, ${severities.join('/')})`)
}
sensible('“nothing can be sent” (quoting is blocked)', blocked, ['fault'], ['high'])
sensible('“how do I change my logo”', howTo, ['how_to'], ['low', 'medium'])
sensible('“charged twice”', billing, ['billing'], ['high', 'medium', 'low'])
check('each has a one-line title and a plain summary', [blocked, howTo, billing].every((r) => typeof r?.title === 'string' && (r.title as string).length > 5 && (r.title as string).length <= 120 && typeof r?.summary === 'string' && (r.summary as string).length > 10), [blocked?.title, howTo?.title, billing?.title])
const ticket = String(blocked?.fix_ticket ?? '')
check('the draft fix ticket is in the house format: a title line, the SAFETY line, RULES, what is wrong, the evidence, what should happen, how to check', /^T-NNN: .+/.test(ticket) && ticket.includes(TICKET_SAFETY_LINE) && ['RULES', '- Build only. Do not deploy.', 'pnpm check:quick once', 'pnpm check:failed', 'WHAT IS WRONG', 'EVIDENCE', 'WHAT SHOULD HAPPEN INSTEAD', 'HOW TO CHECK IT'].every((part) => ticket.includes(part)), ticket.split('\n').slice(0, 3))
const namesFiles = /\.(tsx?|mjs|sql)\b|apps\/|packages\/|src\//.test(ticket)
check('the ticket names no files and guesses at no code', !namesFiles, namesFiles ? ticket : undefined)
if (namesFiles) modelNotes.push('the fix ticket named a file or a path')
const everything = JSON.stringify([blocked, howTo, billing])
check('the customer’s name, email and phone number typed into the box are in nothing the model wrote (title, summary, evidence, ticket)', !/megan|grant/i.test(everything) && !everything.includes(CUSTOMER.email) && !/555\s?0142/.test(everything), undefined)

// The same problem from another business: found, and only suggested
const sameId = (expectOk('report', await report(rival, { kind: 'problem', body: SAMPLES.same, context: { page: '/app/quotes' } })).report as Row).id as string
const same = await sorted(sameId)
const similar = (same?.similar_json ?? []) as Array<{ id: string; confidence: number }>
const found = similar.find((s) => s.id === blockedId)
check('the duplicate is found: the second business’s report points at the first, with a confidence', Boolean(found) && found!.confidence >= 0.5, similar)
if (!found) modelNotes.push('the duplicate "Send again does nothing" report was not matched to the first one')
check('…and it is not merged by itself', same?.merged_into === null && !similar.some((s) => s.id === howToId || s.id === billingId), same?.merged_into)
if (similar.some((s) => s.id === howToId || s.id === billingId)) modelNotes.push('an unrelated open problem was offered as a look-alike')

// =====================================================================================
section('A. Who can read and write what')
// =====================================================================================
const seen = async (table: string, who: Person | null, query = 'select=*') => ((await call('GET', rest(`${table}?${query}`), { headers: who ? asUser(who.accessToken) : { apikey: cfg.anonKey } })).json ?? []) as Row[]
const mine = await seen('support_reports', a)
check('a business reads its own reports through the database', mine.length === 3 && mine.every((r) => r.tenant_id === a.tenantId), mine.length)
check('every user of the business sees the business’s reports', (await seen('support_reports', second)).length === 3)
const rivalSees = await seen('support_reports', rival)
check('another business reads only its own', rivalSees.length === 1 && rivalSees[0]!.id === sameId, rivalSees.length)
const anonSees = await call('GET', rest('support_reports?select=id'), { headers: { apikey: cfg.anonKey } })
check('signed out, the table gives nothing', !anonSees.ok || (anonSees.json as Row[]).length === 0, anonSees.status)
for (const [who, name] of [[a, 'the business that reported'], [rival, 'another business']] as const) {
  const got = await call('GET', rest('support_report_internal?select=report_id,owner_note,fix_ticket'), { headers: asUser(who.accessToken) })
  check(`the owner’s side (the AI’s sorting, the fix ticket, the note) is closed to ${name}`, !got.ok || (got.json as Row[]).length === 0, got.status)
}
const plant = (who: Person, body: Row) => call('POST', rest('support_reports'), { headers: { ...asUser(who.accessToken), Prefer: 'return=minimal' }, body })
const planted = await Promise.all([
  plant(rival, { tenant_id: a.tenantId, user_id: rival.userId, kind: 'problem', body: 'planted' }),
  plant(rival, { tenant_id: rival.tenantId, user_id: a.userId, kind: 'problem', body: 'planted' }),
  plant(rival, { tenant_id: rival.tenantId, user_id: rival.userId, kind: 'estimate', body: 'planted', quote_id: quoteId }),
  plant(rival, { tenant_id: rival.tenantId, user_id: rival.userId, kind: 'problem', body: 'planted', status: 'fixed' }),
  plant(rival, { tenant_id: rival.tenantId, user_id: rival.userId, kind: 'problem', body: 'planted', setup_hint: { line: 'x', rate: 'y' } }),
])
check('a business cannot add a report to another business, in another user’s name, on another business’s estimate, already "fixed", or with our hint on it', planted.every((r) => !r.ok) && (await rows('support_reports', 'body=eq.planted&select=id')).length === 0, planted.map((r) => r.status))
const changed = await call('PATCH', rest(`support_reports?id=eq.${blockedId}`), { headers: { ...asUser(a.accessToken), Prefer: 'return=representation' }, body: { status: 'fixed', body: 'changed' } })
check('a business cannot change a report once it is sent (its own included)', (!changed.ok || (changed.json as Row[]).length === 0) && (await reportOf(blockedId)).status === 'new', changed.status)
const plantedMessage = await call('POST', rest('support_messages'), { headers: { ...asUser(rival.accessToken), Prefer: 'return=minimal' }, body: { report_id: blockedId, tenant_id: rival.tenantId, author: 'business', user_id: rival.userId, body: 'planted' } })
const asTeam = await call('POST', rest('support_messages'), { headers: { ...asUser(a.accessToken), Prefer: 'return=minimal' }, body: { report_id: blockedId, tenant_id: a.tenantId, author: 'team', user_id: a.userId, body: 'planted' } })
check('a business cannot write on another business’s thread, or write as us on its own', !plantedMessage.ok && !asTeam.ok && (await rows('support_messages', 'body=eq.planted&select=id')).length === 0, [plantedMessage.status, asTeam.status])
const writeVote = await call('POST', rest('feature_votes'), { headers: { ...asUser(a.accessToken), Prefer: 'return=minimal' }, body: { request_id: '00000000-0000-4000-8000-000000000000', tenant_id: a.tenantId, user_id: a.userId, body: 'x' } })
const writeRequest = await call('POST', rest('feature_requests'), { headers: { ...asUser(a.accessToken), Prefer: 'return=minimal' }, body: { title: 'planted' } })
check('a business cannot write a feature request or a vote directly', !writeVote.ok && !writeRequest.ok, [writeVote.status, writeRequest.status])

const signedOut = await Promise.all([
  call('GET', `${app}/api/support`), call('GET', `${app}/api/support/unread`), call('POST', `${app}/api/support/reports`, { body: { kind: 'problem', body: 'x' } }),
  call('GET', `${app}/api/support/reports/${blockedId}`), call('POST', `${app}/api/support/reports/${blockedId}/messages`, { body: { body: 'x' } }), call('POST', `${app}/api/support/features`, { body: { text: 'x' } }),
])
check('signed out, every support route refuses (401)', signedOut.every((r) => r.status === 401), signedOut.map((r) => r.status))
check('another business cannot open the report or its thread (404), or reply on it (404)', (await call('GET', `${app}/api/support/reports/${blockedId}`, { headers: rival.cookie })).status === 404 && (await call('POST', `${app}/api/support/reports/${blockedId}/messages`, { headers: rival.cookie, body: { body: 'hello' } })).status === 404)
const notAdmin = await Promise.all([inbox('', a), inbox('?count=1', a), inbox(`/problems/${blockedId}`, a), inbox(`/problems/${blockedId}`, a, 'POST', { action: 'reply', body: 'x' }), inbox('/features/00000000-0000-4000-8000-000000000000', a), call('GET', `${app}/api/admin/support`)])
check('the inbox refuses a business and a signed-out caller on every route (403)', notAdmin.every((r) => r.status === 403), notAdmin.map((r) => r.status))
check('…and a business’s reply was not written by that refused call', (await rows('support_messages', `report_id=eq.${blockedId}&select=id`)).length === 0)

// =====================================================================================
section('C. A report on an estimate with a plainly wrong rate')
// =====================================================================================
const before = await quoteRow(quoteId)
const refused = await Promise.all([
  report(a, { kind: 'estimate', quoteId, choices: [] }),
  report(a, { kind: 'estimate', quoteId, choices: ['other'] }),
  report(a, { kind: 'estimate', quoteId, choices: ['too_high'], expectedTotal: 'lots' }),
  report(rival, { kind: 'estimate', quoteId, choices: ['too_high'] }),
])
check('no choice, "Something else" with no words, a figure that is not a number (400), and another business’s estimate (404), are refused', refused.slice(0, 3).every((r) => r.status === 400) && refused[3]!.status === 404, refused.map((r) => r.status))
const sentEstimate = await report(a, { kind: 'estimate', quoteId, choices: ['too_high'], body: `Two rooms should come to about $${WRONG.meant}, not this.`, expectedTotal: WRONG.meant })
const estimateId = (expectOk('estimate report', sentEstimate).report as Row).id as string
const estimateRow = await reportOf(estimateId)
check('the report links to the estimate by id and copies nothing out of it', estimateRow.quote_id === quoteId && estimateRow.kind === 'estimate' && Number(estimateRow.expected_total) === WRONG.meant && estimateRow.currency === 'USD' && !JSON.stringify(estimateRow).includes(CUSTOMER.email) && !JSON.stringify(estimateRow).toLowerCase().includes('megan'), { choices: estimateRow.choices, expected: estimateRow.expected_total })
const estimateSort = await sorted(estimateId)
const cause = estimateSort?.likely_cause
check('the likely cause comes back as "Your price setup"', cause === 'setup', { cause, evidence: estimateSort?.evidence })
if (cause !== 'setup') modelNotes.push(`the estimate with a rate ten times too high came back as "${cause}", not "setup"`)
check('…with evidence that names the line and the rate, and no customer details', typeof estimateSort?.evidence === 'string' && /room/i.test(estimateSort.evidence as string) && !/megan|grant/i.test(JSON.stringify(estimateSort)), estimateSort?.evidence)
const hinted = await reportOf(estimateId)
const hint = hinted.setup_hint as { line?: string; rate?: string } | null
check('the business is shown a possibility, written from its own setup: the line’s name and its rate', hint?.line === WRONG.line && hint?.rate === '$3,750.00 per room', hint)
if (cause === 'setup' && !hint) modelNotes.push('the cause was "setup" but the model named no price line, so the business is shown no hint')
const onQuote = expectOk('reports on the quote', await call('GET', `${app}/api/support?quoteId=${quoteId}`, { headers: a.cookie }))
check('the quote page’s own read gives the report, its status and the hint, and nothing of the owner’s', (onQuote.reports as Row[]).length === 1 && (onQuote.reports as Row[])[0]!.statusLabel === 'Sent' && JSON.stringify((onQuote.reports as Row[])[0]!.setupHint) === JSON.stringify(hint) && !/fix_ticket|owner_note|similar|severity/.test(JSON.stringify(onQuote)), (onQuote.reports as Row[])[0])
const after = await quoteRow(quoteId)
check('the "should have been" figure changed no price: the estimate, its total and its trace are exactly as before', JSON.stringify(after.pricing_json) === JSON.stringify(before.pricing_json) && JSON.stringify(after.pricing_trace_json) === JSON.stringify(before.pricing_trace_json) && after.status === before.status && after.version === before.version)
const serviceAfter = (await rows('services', `id=eq.${a.serviceId}&select=work_steps`))[0]!
check('…and the business’s own rate is untouched (nothing is changed for them)', (serviceAfter.work_steps as Array<{ defaultCost: number }>)[0]!.defaultCost === WRONG.rate)
// a second report on the same quote, now a test estimate
await call('PATCH', rest(`quotes?id=eq.${quoteId}`), { headers: { ...admin, Prefer: 'return=minimal' }, body: { is_test: true } })
const again = expectOk('second estimate report', await report(a, { kind: 'estimate', quoteId, choices: ['wording', 'other'], body: 'The wording of the scope reads oddly.' }))
check('a quote can be reported more than once, and a test estimate is marked as one', (again.report as Row).isTest === true && ((await call('GET', `${app}/api/support?quoteId=${quoteId}`, { headers: a.cookie })).json.reports as Row[]).length === 2)
await call('PATCH', rest(`quotes?id=eq.${quoteId}`), { headers: { ...admin, Prefer: 'return=minimal' }, body: { is_test: false } })

// =====================================================================================
section('D. Two feature requests')
// =====================================================================================
const WISH = {
  first: `At Harbour Painting we need to export all our quotes to a spreadsheet (a CSV file) each month for our accountant.`,
  sameThing: 'Please add a way to download my quotes as a CSV file so I can open them in Excel.',
  different: 'Let my customers pay a deposit by card at the moment they accept an estimate.',
}
const first = expectOk('first request', await feature(a, { text: WISH.first }))
check('a request with nothing like it is saved at once', first.step === 'saved' && first.message === SUPPORT_COPY.feature.thanks, first)
const firstVote = (await rows('feature_votes', `tenant_id=eq.${a.tenantId}&select=id,request_id,body`))[0]!
const firstRequestId = firstVote.request_id as string
// the worker gives it a plain title in place of the business's own words
let titled: Row | undefined
for (let i = 0; i < 40 && titled?.title_source !== 'ai'; i++) {
  await sleep(1500)
  titled = (await rows('feature_requests', `id=eq.${firstRequestId}&select=*`))[0]
}
check('the worker gives it a plain title and one line, without the business’s name or who it is for', titled?.title_source === 'ai' && !/harbour|accountant/i.test(`${titled?.title} ${titled?.summary}`) && /csv|spreadsheet|export/i.test(`${titled?.title} ${titled?.summary}`), { title: titled?.title, summary: titled?.summary })
if (titled?.title_source !== 'ai') modelNotes.push('the first feature request was not given a title in a minute')

const offered = expectOk('second request', await feature(rival, { text: WISH.sameThing }))
const matches = (offered.matches ?? []) as Row[]
check('the same thing asked by another business is recognised: it is offered the first request, and nothing is saved yet', offered.step === 'match' && matches.some((m) => m.id === firstRequestId) && (await rows('feature_votes', `tenant_id=eq.${rival.tenantId}&select=id`)).length === 0, offered)
if (offered.step !== 'match') modelNotes.push('"download my quotes as a CSV" was not matched to "export quotes to a spreadsheet"')
check('the business is shown the title and one line, and never who asked or how many', matches.every((m) => JSON.stringify(Object.keys(m).sort()) === JSON.stringify(['id', 'summary', 'title'])) && !/harbour|vote|business/i.test(JSON.stringify(offered)), matches)
const voted = expectOk('vote', await feature(rival, { text: WISH.sameThing, voteFor: firstRequestId }))
check('"Yes, add my vote" adds one vote, with the business’s own words', voted.step === 'saved' && voted.message === SUPPORT_COPY.feature.voted && (await rows('feature_votes', `request_id=eq.${firstRequestId}&select=tenant_id`)).length === 2)
const twice = await feature(rival, { text: 'again', voteFor: firstRequestId })
check('voting again says "You’ve already asked for this." and adds nothing', twice.status === 409 && twice.json?.error?.message === SUPPORT_COPY.feature.already && (await rows('feature_votes', `request_id=eq.${firstRequestId}&select=tenant_id`)).length === 2, twice.json)
const other = expectOk('different request', await feature(rival, { text: WISH.different }))
check('a different request is not taken for the first: it is saved as new', other.step === 'saved', other)
if (other.step !== 'saved') {
  modelNotes.push('"pay a deposit by card" was offered the CSV export request as a match')
  expectOk('different, said so', await feature(rival, { text: WISH.different, different: true }))
}
const rivalVotes = await rows('feature_votes', `tenant_id=eq.${rival.tenantId}&select=id,request_id,body&order=created_at.asc`)
const depositRequestId = rivalVotes.find((v) => v.request_id !== firstRequestId)?.request_id as string
check('"No, mine is different" saves the request as its own', expectOk('mine is different', await feature(third, { text: WISH.sameThing, different: true })).step === 'saved' && (await rows('feature_votes', `tenant_id=eq.${third.tenantId}&select=request_id`))[0]?.request_id !== firstRequestId)
const thirdRequestId = (await rows('feature_votes', `tenant_id=eq.${third.tenantId}&select=request_id`))[0]!.request_id as string
check('a vote for a request that was never offered (still in a business’s own words, or made up) is refused', (await feature(a, { text: 'x', voteFor: '00000000-0000-4000-8000-000000000000' })).status === 404)

// what each business can read of it
const votesSeenByA = await seen('feature_votes', a)
const requestsSeenByA = await seen('feature_requests', a)
check('a business reads only its own vote, and only the request it voted for', votesSeenByA.length === 1 && votesSeenByA[0]!.tenant_id === a.tenantId && requestsSeenByA.length === 1 && requestsSeenByA[0]!.id === firstRequestId, [votesSeenByA.length, requestsSeenByA.length])
const mineA = expectOk('mine', await call('GET', `${app}/api/support`, { headers: a.cookie }))
check('"Your reports and requests" lists the business’s own reports and requests, newest first, each with a status', (mineA.reports as Row[]).length === 5 && (mineA.requests as Row[]).length === 1 && (mineA.requests as Row[])[0]!.statusLabel === 'Under review' && (mineA.requests as Row[])[0]!.text === WISH.first && typeof mineA.plan === 'string', { reports: (mineA.reports as Row[]).length, requests: mineA.requests })
check('…and nothing about other businesses or the owner’s side', !JSON.stringify(mineA).includes(rival.tenantId) && !/owner_note|fix_ticket|severity|similar|votes/i.test(JSON.stringify(mineA)))

// =====================================================================================
section('E. The inbox')
// =====================================================================================
const list = expectOk('inbox', await inbox(''))
const problems = list.problems as Row[]
const ours = problems.filter((p) => [blockedId, howToId, billingId, sameId, estimateId].includes(p.id as string))
check('the inbox lists every business’s problems, problem and estimate reports together', ours.length === 5 && ours.some((p) => p.reportKind === 'estimate'), ours.length)
check('by priority: the high-severity one is first', problems[0]?.severity === 'high', problems.slice(0, 3).map((p) => [p.severity, p.title]))
check('each row has a title, kind, severity, businesses affected, status and age', ours.every((p) => typeof p.title === 'string' && p.reportKind && 'severity' in p && p.businesses === 1 && p.status && p.createdAt))
check('the count of new items is at least this run’s', (expectOk('count', await inbox('?count=1')).count as number) >= 7, list.count)
check('the estimate report is found by its likely cause', problems.some((p) => p.id === estimateId && p.likelyCause === cause))

// merge, undo, merge
check('the look-alike is flagged for the owner, not merged', problems.find((p) => p.id === sameId)?.mergeSuggested === (found ? found.confidence >= 0.85 : false) && (await internalOf(sameId))?.merged_into === null)
expectOk('merge', await problemAct(sameId, { action: 'merge', into: blockedId }))
const afterMerge = expectOk('inbox', await inbox(''))
check('merged: the second business counts towards the problem it joined, and its own row leaves the list', (afterMerge.problems as Row[]).find((p) => p.id === blockedId)?.businesses === 2 && !(afterMerge.problems as Row[]).some((p) => p.id === sameId))
expectOk('undo', await problemAct(sameId, { action: 'unmerge' }))
check('the merge can be undone', ((expectOk('inbox', await inbox('')).problems as Row[]).find((p) => p.id === blockedId)?.businesses === 1) && (await internalOf(sameId))?.merged_into === null)
expectOk('merge again', await problemAct(sameId, { action: 'merge', into: blockedId }))
check('a problem cannot be merged into itself', (await problemAct(blockedId, { action: 'merge', into: blockedId })).status === 400)

// the problem's page
const detail = expectOk('problem', await inbox(`/problems/${blockedId}`)).problem as Row
check('a problem’s page has the business and plan, its words, what was attached, the AI’s sorting, the ticket and the merged report', (detail.business as Row).name === a.name && 'plan' in (detail.business as Row) && detail.body === SAMPLES.blocked && (detail.context as Row[]).length >= 4 && (detail.sorting as Row).state === 'sorted' && typeof (detail.sorting as Row).fixTicket === 'string' && (detail.merged as Row[]).length === 1, { context: (detail.context as Row[]).length })
const estimateDetail = expectOk('estimate problem', await inbox(`/problems/${estimateId}`)).problem as Row
check('an estimate report’s page has the choices, the "should have been" figure, the quote’s id and its trace', JSON.stringify(estimateDetail.choices) === JSON.stringify(['too_high']) && estimateDetail.expectedTotal === WRONG.meant && estimateDetail.quoteId === quoteId && ((estimateDetail.estimate as Row).steps as Row[]).some((s) => s.id === 'rooms'))

// note, approve, status
expectOk('note', await problemAct(blockedId, { action: 'note', note: 'Owner only: check the resend route first.' }))
expectOk('approve', await problemAct(blockedId, { action: 'approve', approved: true }))
expectOk('status', await problemAct(howToId, { action: 'status', status: 'looking' }))
const noted = await internalOf(blockedId)
check('the private note and "Approved for fixing" (with its date) are saved on the owner’s side', noted?.owner_note === 'Owner only: check the resend route first.' && typeof noted?.approved_at === 'string')
check('…and the business cannot read the note any way it has', !JSON.stringify(await call('GET', `${app}/api/support/reports/${blockedId}`, { headers: a.cookie }).then((r) => r.json)).includes('Owner only') && !JSON.stringify(await seen('support_reports', a)).includes('Owner only'))
check('a status is shown to the business in its own words', ((await call('GET', `${app}/api/support/reports/${howToId}`, { headers: a.cookie })).json.report as Row).statusLabel === 'Looking into it')

// reply, and the dot
const REPLY = 'Thanks for telling us. We can see the fault and are fixing it today.'
const replied = expectOk('reply', await problemAct(blockedId, { action: 'reply', body: REPLY }))
check('a reply is delivered to the Help panel (no email is sent here: this machine has no email token)', replied.ok === true && replied.emailed === false, replied)
check('the dot: one unread reply for the business', expectOk('unread', await call('GET', `${app}/api/support/unread`, { headers: a.cookie })).count === 1 && expectOk('unread', await call('GET', `${app}/api/support/unread`, { headers: second.cookie })).count === 1)
check('…and none for another business', expectOk('unread', await call('GET', `${app}/api/support/unread`, { headers: rival.cookie })).count === 0)
const opened = expectOk('open', await call('GET', `${app}/api/support/reports/${blockedId}`, { headers: second.cookie }))
check('opening the report shows the reply and clears the dot', (opened.messages as Row[]).length === 1 && (opened.messages as Row[])[0]!.from === 'team' && (opened.messages as Row[])[0]!.body === REPLY && expectOk('unread', await call('GET', `${app}/api/support/unread`, { headers: a.cookie })).count === 0)
expectOk('answer', await problemAct(blockedId, { action: 'status', status: 'answered' }))
const back = expectOk('business replies', await call('POST', `${app}/api/support/reports/${blockedId}/messages`, { headers: a.cookie, body: { body: 'It still happens on the quote I had open.' } }))
check('the business replies in its dashboard, and a reply on a closed report opens it for the owner again', (back.message as Row).from === 'business' && (await reportOf(blockedId)).status === 'new' && (await rows('support_messages', `report_id=eq.${blockedId}&select=author&order=created_at.asc`)).map((m) => m.author).join() === 'team,business')

// Fixed: confirmed first, every business attached, once
const fixedDirect = await problemAct(blockedId, { action: 'status', status: 'fixed' })
check('"Fixed" cannot be set without the confirmation step', fixedDirect.status === 400 && (await reportOf(blockedId)).status === 'new')
const preview = expectOk('preview', await problemAct(blockedId, { action: 'fixed', message: 'Send again works now.', confirm: false })).preview as Row
check('the confirmation shows the email and how many businesses get it, and sends nothing', preview.businesses === 2 && String(preview.html).includes('Send again works now.') && preview.subject === 'The problem you reported is fixed' && (await reportOf(blockedId)).status === 'new' && (await rows('support_messages', `report_id=eq.${sameId}&select=id`)).length === 0, { businesses: preview.businesses })
const fixed = expectOk('fixed', await problemAct(blockedId, { action: 'fixed', message: 'Send again works now.', confirm: true }))
const [fixedA, fixedRival] = await Promise.all([reportOf(blockedId), reportOf(sameId)])
check('confirmed: every report attached to the problem is fixed, and both businesses are told in their Help panel', fixed.businesses === 2 && fixedA.status === 'fixed' && fixedRival.status === 'fixed' && fixedRival.reply_unread === true && (await rows('support_messages', `report_id=eq.${sameId}&select=author,body`)).some((m) => m.author === 'team' && m.body === 'Send again works now.'))
const fixedAgain = expectOk('fixed again', await problemAct(blockedId, { action: 'fixed', message: 'Send again works now.', confirm: true }))
check('each business is told once: a second "Fixed" tells nobody again', fixedAgain.businesses === 0 && (await rows('support_messages', `report_id=eq.${sameId}&author=eq.team&select=id`)).length === 1 && (expectOk('preview', await problemAct(blockedId, { action: 'fixed', confirm: false })).preview as Row).businesses === 0, fixedAgain)

// Sort again
await call('PATCH', rest(`support_report_internal?report_id=eq.${billingId}`), { headers: { ...admin, Prefer: 'return=minimal' }, body: { sort_state: 'failed', title: null, severity: null, ai_kind: null } })
check('an unsorted report is still in the inbox, as "New", with nothing lost', (expectOk('inbox', await inbox('')).problems as Row[]).some((p) => p.id === billingId && p.sortState === 'failed' && p.status === 'new' && p.severity === null))
expectOk('sort again', await problemAct(billingId, { action: 'sort' }))
const resorted = await sorted(billingId)
check('"Sort again" sorts it', resorted?.sort_state === 'sorted' && resorted?.ai_kind === 'billing' && (resorted?.sort_attempts as number) >= 2, { state: resorted?.sort_state, attempts: resorted?.sort_attempts })

// Feature requests in the inbox
const features = expectOk('inbox', await inbox('')).features as Row[]
const top = features[0]!
check('feature requests are sorted by votes: the one two businesses asked for is first', top.id === firstRequestId && top.votes === 2 && typeof top.paying === 'number', features.slice(0, 3).map((f) => [f.votes, f.title]))
const featureDetail = expectOk('feature', await inbox(`/features/${firstRequestId}`)).feature as Row
check('a request’s page has the businesses that asked and their own words', (featureDetail.votes as Row[]).length === 2 && (featureDetail.votes as Row[]).some((v) => v.business === a.name && v.body === WISH.first) && (featureDetail.votes as Row[]).some((v) => v.business === rival.name && v.body === WISH.sameThing))
expectOk('rename', await featureAct(firstRequestId, { action: 'rename', title: 'Export quotes to a spreadsheet', summary: 'Download every quote as a CSV file.' }))
expectOk('planned', await featureAct(firstRequestId, { action: 'status', status: 'planned' }))
check('renamed and set to "Planned": the business sees the new status', ((await rows('feature_requests', `id=eq.${firstRequestId}&select=title,title_source,status`))[0] as Row).title_source === 'owner' && (expectOk('mine', await call('GET', `${app}/api/support`, { headers: rival.cookie })).requests as Row[]).some((r) => r.statusLabel === 'Planned'))
// merge the third business's own copy in, then split it out again
expectOk('merge request', await featureAct(thirdRequestId, { action: 'merge', into: firstRequestId }))
check('merged: its vote moves across (three businesses), and the merged request leaves the list', (await rows('feature_votes', `request_id=eq.${firstRequestId}&select=id`)).length === 3 && !(expectOk('inbox', await inbox('')).features as Row[]).some((f) => f.id === thirdRequestId))
const thirdVote = (await rows('feature_votes', `tenant_id=eq.${third.tenantId}&select=id`))[0]!.id as string
const split = expectOk('split', await featureAct(firstRequestId, { action: 'split', voteId: thirdVote }))
check('split: that business’s ask is a request of its own again', (await rows('feature_votes', `request_id=eq.${firstRequestId}&select=id`)).length === 2 && (await rows('feature_votes', `id=eq.${thirdVote}&select=request_id`))[0]!.request_id === split.newId)
// Shipped: confirmed first, every business that voted, once
check('"Shipped" cannot be set without the confirmation step', (await featureAct(firstRequestId, { action: 'status', status: 'shipped' })).status === 400)
const shipPreview = expectOk('ship preview', await featureAct(firstRequestId, { action: 'shipped', confirm: false })).preview as Row
check('the confirmation shows the email and that two businesses get it', shipPreview.businesses === 2 && String(shipPreview.html).includes('Export quotes to a spreadsheet') && ((await rows('feature_requests', `id=eq.${firstRequestId}&select=status`))[0] as Row).status === 'planned')
const shipped = expectOk('shipped', await featureAct(firstRequestId, { action: 'shipped', confirm: true }))
const shippedAgain = expectOk('shipped again', await featureAct(firstRequestId, { action: 'shipped', confirm: true }))
check('confirmed: the request is shipped, both businesses are marked as told, and a second time tells nobody', shipped.businesses === 2 && shippedAgain.businesses === 0 && (await rows('feature_votes', `request_id=eq.${firstRequestId}&select=shipped_emailed_at`)).every((v) => typeof v.shipped_emailed_at === 'string') && (expectOk('mine', await call('GET', `${app}/api/support`, { headers: a.cookie })).requests as Row[])[0]!.statusLabel === 'Shipped', [shipped, shippedAgain])

// =====================================================================================
section('F. The daily limit')
// =====================================================================================
const fill = Array.from({ length: SUPPORT_DAILY_LIMIT }, (_, i) => ({ tenant_id: third.tenantId, user_id: third.userId, kind: 'problem', body: `filler ${i}`, status: 'answered' }))
await call('POST', rest('support_reports'), { headers: { ...admin, Prefer: 'return=minimal' }, body: fill as unknown as Row })
const over = await report(third, { kind: 'problem', body: 'One more.' })
check(`the ${SUPPORT_DAILY_LIMIT + 1}th report in a day is refused with a plain message, and not saved`, over.status === 429 && over.json?.error?.message === SUPPORT_COPY.limit && (await rows('support_reports', `tenant_id=eq.${third.tenantId}&body=eq.One%20more.&select=id`)).length === 0, over.json?.error)
check('another business is not held by it', (await report(rival, { kind: 'problem', body: 'The quotes list is slow to open on my phone.', context: { page: '/app/quotes' } })).ok)
const fillerRequest = await sb.insert('feature_requests', { title: 'Filler request', status: 'not_planned' })
// one vote per business per request is the table's own rule, so the day's votes are spread over requests
const fillerRequests = [fillerRequest]
for (let i = 1; i < SUPPORT_DAILY_LIMIT - 1; i++) fillerRequests.push(await sb.insert('feature_requests', { title: `Filler request ${i}`, status: 'not_planned' }))
await call('POST', rest('feature_votes'), { headers: { ...admin, Prefer: 'return=minimal' }, body: fillerRequests.map((r) => ({ request_id: (r as Row).id, tenant_id: third.tenantId, user_id: third.userId, body: 'filler' })) as unknown as Row })
const overFeature = await feature(third, { text: 'One more idea.', different: true })
check(`the ${SUPPORT_DAILY_LIMIT + 1}th feature request in a day is refused with the same plain message`, overFeature.status === 429 && overFeature.json?.error?.message === SUPPORT_COPY.limit, overFeature.json?.error)
const dupVote = await call('POST', rest('feature_votes'), { headers: { ...admin, Prefer: 'return=minimal' }, body: { request_id: (fillerRequest as Row).id, tenant_id: third.tenantId, body: 'twice' } })
check('one vote per business per request is the database’s own rule', dupVote.status === 409, dupVote.status)
// the fillers are this check's own; they are taken away so that the inbox shows real reports
await call('DELETE', rest(`support_reports?tenant_id=eq.${third.tenantId}&body=like.filler*`), { headers: admin })
await call('DELETE', rest('feature_requests?title=like.Filler%20request*'), { headers: admin })

// =====================================================================================
section('G. The screens')
// =====================================================================================
const { chromium } = browserDeps()
const browser = await chromium.launch()
const origin = new URL(app).origin
const contextFor = async (who: Person, viewport = { width: 1440, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies(who.cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
  return ctx
}
type Ctx = Awaited<ReturnType<typeof contextFor>>
type Page = Awaited<ReturnType<Ctx['newPage']>>
const shot = (p: Page, name: string, fullPage = false) => p.screenshot({ path: path.join(shots, `${name}.png`), fullPage })
const pageErrors: string[] = []
const watch = (p: Page) => p.on('pageerror', (e) => pageErrors.push(e.message))

// a reply waiting for the business, so the dot and the thread show
await problemAct(estimateId, { action: 'reply', body: 'We looked at this estimate. The price follows from the rate set for Rooms painted.' })

for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['390', { width: 390, height: 844 }]] as const) {
  const ctx = await contextFor(a, viewport)
  const p = await ctx.newPage()
  watch(p)
  await p.goto(`${app}/app/quotes/${quoteId}`, { waitUntil: 'networkidle' })
  if (label === '390') await p.getByLabel('Open menu').click()
  const helpButton = p.getByTestId('help-button')
  await helpButton.waitFor()
  if (label === 'desktop') {
    const menu = await p.evaluate(() => {
      const help = document.querySelector('[data-testid="help-button"]')!
      const signOut = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Sign out')!
      return { above: help.getBoundingClientRect().bottom <= signOut.getBoundingClientRect().top, dot: Boolean(document.querySelector('[data-testid="help-dot"]')) }
    })
    check('Help is in the menu above Sign out, with a dot while a reply is unread', menu.above && menu.dot, menu)
    await shot(p, 'menu-help-item')
  }
  await helpButton.click()
  await p.getByTestId('help-menu').waitFor()
  const panel = await p.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!.getBoundingClientRect()
    return { entries: Array.from(document.querySelectorAll('[data-testid="help-entry"]')).map((e) => e.querySelector('span span')?.textContent), email: document.querySelector('[data-testid="help-email"]')?.textContent, width: dialog.width, height: dialog.height, vw: window.innerWidth, vh: window.innerHeight, scrolls: document.documentElement.scrollWidth > window.innerWidth }
  })
  if (label === 'desktop') {
    check('the panel has the three entries and the email line, and nothing for a chatbot', JSON.stringify(panel.entries) === JSON.stringify(['Report a problem', 'Suggest a feature', 'Your reports and requests']) && panel.email === 'Or email hello@qolumns.com' && !/ask/i.test(panel.entries.join(' ')), panel)
    check('on a wide screen it is a side panel', panel.width < panel.vw / 2)
  } else {
    check('on a phone it is a full-screen sheet, and nothing scrolls sideways', panel.width === panel.vw && panel.height === panel.vh && !panel.scrolls, panel)
  }
  await shot(p, `help-panel-${label}`)

  await p.locator('[data-testid="help-entry"][data-view="problem"]').click()
  await p.getByTestId('problem-form').waitFor()
  // the plan is read from the server when the panel opens; the list shows it as soon as it is known
  await p.getByTestId('problem-include').getByText('Your plan').waitFor({ timeout: 10_000 }).catch(() => undefined)
  const include = await p.getByTestId('problem-include').innerText()
  if (label === 'desktop') check('"We’ll include" lists the page, the quote, the plan, the browser and the screen size before sending', ['The page you were on', `/app/quotes/${quoteId}`, 'The quote', 'Your plan', 'Your browser', 'Screen size'].every((part) => include.includes(part)), include.replace(/\n/g, ' | '))
  await p.getByTestId('problem-text').fill('The total on this page is cut off on my screen.')
  await shot(p, `help-problem-form-${label}`)
  if (label === 'desktop') {
    await p.getByTestId('problem-send').click()
    await p.getByTestId('help-thanks').waitFor()
    check('sending from the panel thanks the business at once', (await p.getByTestId('help-thanks').innerText()).includes(SUPPORT_COPY.problem.thanks))
    await shot(p, 'help-problem-sent')
    await p.getByRole('button', { name: 'Done' }).click()
  } else {
    await p.getByTestId('help-back').click()
  }

  await p.locator('[data-testid="help-entry"][data-view="feature"]').click()
  await p.getByTestId('feature-form').waitFor()
  await p.getByTestId('feature-text').fill('A way to pay a deposit when the customer accepts.')
  await shot(p, `help-feature-form-${label}`)
  await p.getByTestId('help-back').click()

  await p.locator('[data-testid="help-entry"][data-view="list"]').click()
  await p.getByTestId('help-items').waitFor()
  await shot(p, `help-your-items-${label}`)
  await p.locator('[data-testid="help-item"][data-kind="report"]').filter({ has: p.getByTestId('help-item-unread') }).first().click()
  await p.getByTestId('report-thread').waitFor()
  await p.getByTestId('thread-message').first().waitFor()
  if (label === 'desktop') check('a report opens to its thread with our reply and the note about the business’s own prices', (await p.getByTestId('thread').innerText()).includes('We looked at this estimate') && (await p.getByTestId('report-thread').getByTestId('setup-hint').innerText()).includes(SUPPORT_COPY.setupHint(WRONG.line, '$3,750.00 per room')))
  await shot(p, `help-report-with-reply-${label}`)
  await p.getByTestId('help-close').click()
  if (label === 'desktop') check('closing the panel leaves the quote page as it was', (await p.getByTestId('quote-total').count()) === 1 && (await p.getByTestId('help-panel').count()) === 0)

  // the estimate report on the quote page
  const link = p.getByTestId('estimate-report-link')
  await link.scrollIntoViewIfNeeded()
  const reported = await p.getByTestId('estimate-reported').innerText()
  // T-198: the quote was reported twice above, so the page shows one line for both
  if (label === 'desktop') check('the quote page says "Reported 2 times, latest …" with the status, and the "may be down to your prices" note', /Reported 2 times, latest (\d{1,2} \w{3}|\w{3} \d{1,2})/.test(reported.replace(/\s+/g, ' ')) && reported.includes(SUPPORT_COPY.setupHint(WRONG.line, '$3,750.00 per room')), reported.replace(/\n/g, ' | '))
  await shot(p, `quote-reported-and-price-note-${label}`)
  await link.click()
  await p.getByTestId('estimate-report-form').waitFor()
  await p.locator('[data-testid="estimate-choice"][data-choice="too_high"]').check()
  await p.getByTestId('estimate-expected').fill('750')
  if (label === 'desktop') {
    const form = await p.getByTestId('estimate-report-form').innerText()
    check('the estimate form has the seven choices, "Tell us more", the figure and the line about what we look at', Object.values(SUPPORT_COPY.choices).every((c) => form.includes(c)) && form.includes(SUPPORT_COPY.estimate.expected) && form.includes(SUPPORT_COPY.estimate.investigate), undefined)
  }
  await p.getByTestId('estimate-report-form').scrollIntoViewIfNeeded()
  await shot(p, `quote-estimate-report-form-${label}`)
  await ctx.close()
}

// the feature match step, as the business that has not asked yet sees it
{
  await featureAct(firstRequestId, { action: 'status', status: 'planned' })
  const ctx = await contextFor(owner)
  const p = await ctx.newPage()
  watch(p)
  await p.goto(`${app}/app`, { waitUntil: 'networkidle' })
  await p.getByTestId('help-button').click()
  await p.locator('[data-testid="help-entry"][data-view="feature"]').click()
  await p.getByTestId('feature-text').fill('Could I download all of my quotes as a CSV file?')
  await p.getByTestId('feature-send').click()
  const matched = await p.getByTestId('feature-match').waitFor({ timeout: 15_000 }).then(() => true, () => false)
  check('the match step shows in the panel: "Others have asked for something similar", the request’s title and line, and the two choices', matched && (await p.getByTestId('feature-match').innerText()).includes(SUPPORT_COPY.feature.similar) && (await p.getByTestId('feature-match').innerText()).includes('Export quotes to a spreadsheet') && (await p.getByTestId('feature-vote').count()) >= 1 && (await p.getByTestId('feature-different').count()) === 1)
  if (!matched) modelNotes.push('in the browser, "download all of my quotes as a CSV" was not matched to the export request')
  await shot(p, 'help-feature-match')
  await ctx.close()
}

// the inbox
{
  const ctx = await contextFor(owner)
  const p = await ctx.newPage()
  watch(p)
  await p.goto(`${app}/admin/support`, { waitUntil: 'networkidle' })
  await p.getByTestId('problem-row').first().waitFor()
  check('the admin menu has Support with a count of new items', (await p.getByTestId('admin-support-count').innerText()).trim() !== '')
  await shot(p, 'inbox-problems', true)
  await p.locator('[data-testid="inbox-tab"][data-tab="features"]').click()
  await p.getByTestId('feature-row').first().waitFor()
  await shot(p, 'inbox-feature-requests', true)
  await p.locator('[data-testid="inbox-tab"][data-tab="all"]').click()
  check('the All tab shows both', (await p.getByTestId('problems-table').count()) === 1 && (await p.getByTestId('features-table').count()) === 1)

  await p.goto(`${app}/admin/support/problems/${estimateId}`, { waitUntil: 'networkidle' })
  await p.getByTestId('problem-sorting').waitFor()
  const sorting = await p.getByTestId('problem-sorting').innerText()
  // T-198: a fix ticket is drafted only for a fault; any other kind gets a draft reply instead
  const estimateKind = (await internalOf(estimateId))?.ai_kind
  const hasTicket = (await p.getByTestId('fix-ticket-text').count()) === 1
  const hasDraft = (await p.getByTestId('draft-reply-text').count()) === 1
  const rightOne = estimateKind === 'fault' ? hasTicket && !hasDraft && (await p.getByTestId('fix-ticket-text').innerText()).includes(TICKET_SAFETY_LINE) : !hasTicket
  if (estimateKind !== 'fault' && !hasDraft) modelNotes.push('the estimate report (not a fault) has no draft reply: the model wrote none, or used a figure that was not sent')
  check('a problem’s page shows the AI’s sorting, the likely cause, and a fix ticket only when it is a fault', sorting.includes(SUPPORT_COPY.cause[(cause as 'setup') ?? 'unknown']) && rightOne && (await p.getByTestId('problem-trace').innerText()).includes(WRONG.line), { kind: estimateKind, hasTicket, hasDraft })
  await shot(p, 'inbox-problem-page', true)

  // the "Fixed" confirmation, on a problem with two businesses not yet told (a fresh pair)
  const pairA = (expectOk('report', await report(a, { kind: 'problem', body: 'The PDF button gives a blank page.', context: { page: '/app/quotes' } })).report as Row).id as string
  const pairB = (expectOk('report', await report(rival, { kind: 'problem', body: 'Downloading the PDF shows an empty page.', context: { page: '/app/quotes' } })).report as Row).id as string
  await Promise.all([sorted(pairA), sorted(pairB)])
  expectOk('merge', await problemAct(pairB, { action: 'merge', into: pairA }))
  await p.goto(`${app}/admin/support/problems/${pairA}`, { waitUntil: 'networkidle' })
  await p.getByTestId('fixed-message').fill('The PDF downloads properly again.')
  await p.getByTestId('set-fixed').click()
  await p.getByTestId('confirm-send').waitFor()
  check('"Set to fixed" shows the email and "goes to 2 businesses" before anything is sent', (await p.getByTestId('confirm-count').innerText()).includes('2 businesses') && (await reportOf(pairA)).status === 'new')
  await p.getByTestId('confirm-send').scrollIntoViewIfNeeded()
  // the email inside the confirmation is drawn in its own frame, with the brand fonts: give them a moment
  await p.waitForTimeout(4000)
  // T-198: there is a ticket only when the model sorted the blank PDF as a fault
  if ((await p.getByTestId('fix-ticket-text').count()) === 1) check('the draft fix ticket counts the businesses as they stand now, after the merge', (await p.getByTestId('fix-ticket-text').innerText()).includes('Reported by 2 businesses'))
  else modelNotes.push('the blank PDF report was not sorted as a fault, so it has no fix ticket to count businesses on')
  await shot(p, 'inbox-fixed-confirmation', true)
  await ctx.close()
}
await browser.close()
check('no page raised an error while the screens were used', pageErrors.length === 0, pageErrors)

// the emails, as they are written (none is sent from this machine)
{
  const link = `${app}/app?help=report:${blockedId}`
  const emails = {
    'email-reply': supportReplyEmail({ businessName: a.name, reply: REPLY, yourWords: 'When I press Send again on a quote nothing happens.', link }),
    'email-fixed': supportFixedEmail({ businessName: a.name, message: 'Send again works now.', yourWords: 'When I press Send again on a quote nothing happens.', link }),
    'email-shipped': featureShippedEmail({ businessName: a.name, title: 'Export quotes to a spreadsheet', summary: 'Download every quote as a CSV file.', link: `${app}/app?help=open` }),
    'email-daily-summary': supportDailyEmail({ problems: { fault: 2, how_to: 1, billing: 1 }, featureRequests: 2, top: [{ title: 'Send again does nothing', severity: 'high', businesses: 2 }, { title: 'Charged twice for a plan', severity: 'medium', businesses: 1 }, { title: 'Where to change the logo', severity: 'low', businesses: 1 }], inboxUrl: `${app}/admin/support` })!,
  }
  const b2 = await chromium.launch()
  const p = await (await b2.newContext({ viewport: { width: 700, height: 900 } })).newPage()
  for (const [name, email] of Object.entries(emails)) {
    writeFileSync(path.join(shots, `${name}.html`), email.html)
    await p.setContent(email.html, { waitUntil: 'load' })
    await p.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true })
  }
  await b2.close()
  check('the reply email says to reply in the dashboard, with a link that opens the report', emails['email-reply'].html.includes('To reply, open it in your dashboard') && emails['email-reply'].html.includes(`help=report:${blockedId}`))
}

finish()
