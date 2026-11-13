// T-158 live check: quotes say whose turn it is and what to do next.
// Run (local stack up: supabase with migration 38, web, worker):
//   npx tsx scripts/hardcore-test/verify-t158.mts
// With the page checks (tabs, next-step buttons, the tracker, the customer
// page wording, a phone-width pass) as well:
//   PLAYWRIGHT_DIR=~/estimator-browser npx tsx scripts/hardcore-test/verify-t158.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. the list API: groups, counts in the same request, the default tab, the
//    "declined" status filter, tenant isolation, the mobile app's call;
// 2. the shared map against real rows: label, detail line and next step for a
//    quote in every group;
// 3. Home's "Waiting for you": approvals, customer questions and requests that
//    could not be priced, with the same labels;
// 4. the pages (browser): tabs and counts, one worded next-step button per
//    group, the More menu, the Next step box, the tracker for approved,
//    automatic, accepted and declined quotes, the customer wording for a
//    reviewed and an unreviewed quote, and the list at phone width.
//
// Five quotes go through the real pipeline (approve, automatic send, a
// customer view, accept, decline, a customer question). The other rows are
// copies of those with a status set by hand: this ticket is how each status
// reads, not how a quote gets there.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { QUOTE_GROUP_STATUSES, QUOTE_TURN_COPY, quoteGroupOf, quoteTurn } from '../../packages/shared/src/quote-turn'
import type { QuoteListGroup } from '../../packages/shared/src/quote-turn'
import { findConfidenceLanguage } from '../../packages/shared/src/customer-language'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t158-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const stalls: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)

const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patchRow = (table: string, query: string, body: unknown) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=representation' }, body })
const sha = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

async function business(name: string) {
  const id = shortId()
  const email = `owner+t158-${id}@hardcore.test`
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
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, email }
}
type Biz = Awaited<ReturnType<typeof business>>

const door = garageDoorsPackUS.services[0]!
async function doorService(biz: Biz, mode: { autoSend?: boolean } = {}) {
  const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: mode.autoSend ? `${door.name} (automatic)` : door.name, description: door.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
      draftConfig: door.draft,
      ...mode,
    },
  }))
  return created.service.id as string
}
const doorAnswers = [
  { fieldId: '_project_description', value: 'New garage door please, single steel one' },
  { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' },
  { fieldId: 'door_style', value: 'Steel, non-insulated' },
]
const customerOf = (n: string, withEmail = true) => ({
  name: n,
  ...(withEmail && { email: `${n.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com` }),
  phone: '(555) 201-1212',
})

async function submit(biz: Biz, serviceId: string, customer: { name: string; email?: string; phone?: string }) {
  // Locally the request waits for the whole pipeline, and an AI call there can
  // stall. One retry, then carry on; a second stall fails the run.
  const post = () => http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers: doorAnswers }, source: { type: 'widget' } },
    timeoutMs: 150_000,
  })
  let posted
  try {
    posted = await post()
  } catch (error) {
    stalls.push(`${customer.name}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`⏳ the submission for ${customer.name} stalled; retrying once`)
    posted = await post()
  }
  const res = expectOk('submit', posted)
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token }
}
type QuoteRow = Record<string, unknown> & { id: string; status: string; customer_json: { name: string; email?: string; phone?: string }; pricing_json: { total: number } & Record<string, unknown>; content_json: Record<string, unknown> | null }
const fullRow = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=*`))[0] as QuoteRow
/** A copy of a real quote under a new customer, with its own link, then set by hand */
async function copyOf(sourceId: string, customerName: string, overrides: Record<string, unknown> = {}, withEmail = true) {
  const { id: _id, ...source } = await fullRow(sourceId)
  const token = newToken()
  const created = await sb.insert('quotes', {
    ...source,
    customer_json: { ...source.customer_json, ...customerOf(customerName, withEmail), ...(withEmail ? {} : { email: '' }) },
    quote_token_hash: sha(token),
    previous_token_hash: null,
    link_token_hashes: [],
    token_expires_at: new Date(Date.now() + 30 * DAY).toISOString(),
    reminder_sent_at: null,
    ...overrides,
  })
  return { id: created.id as string, token }
}
const approve = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/approve`, { headers: biz.cookie })
const viewAsCustomer = (id: string, token: string) => http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}`)
const accept = (id: string, token: string) =>
  http('POST', `${cfg.appUrl}/api/public/quotes/${id}/accept`, { body: { token, details: { timing: 'asap', timingNote: '', address: '12 Oak Lane, Ballwin, MO 63021', phone: '(555) 201-1212' } } })
const decline = (id: string, token: string) => http('POST', `${cfg.appUrl}/api/public/quotes/${id}/decline`, { body: { token } })
const ask = (id: string, token: string, text: string) =>
  http('POST', `${cfg.appUrl}/api/public/quotes/${id}/feedback`, { body: { token, feedbackType: 'feedback', feedbackText: text } })
type ListItem = { quoteId: string; customerName: string; customerEmail: string; status: string; total: number; held?: boolean; isTest?: boolean; createdAt: string; sentAt: string | null; viewedAt: string | null; acceptedAt: string | null; paidAt: string | null; declinedAt?: string | null; expiresAt?: string | null }
type ListJson = { items: ListItem[]; nextCursor: string | null; counts?: Record<string, number>; group?: string }
const list = async (biz: Biz | null, query = '') => {
  const res = await http('GET', `${cfg.appUrl}/api/quotes${query ? `?${query}` : ''}`, biz ? { headers: biz.cookie } : {})
  return { status: res.status, ok: res.ok, json: res.json as ListJson & { error?: { code?: string } } }
}
const statusOf = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=status`))[0].status as string

// ====================================================================
section('Setup: two businesses, five real quotes, the rest copies')
// ====================================================================
const a = await business('Ridgeway Doors')
const rival = await business('Hollow Lane Doors')
const svcA = await doorService(a)
const svcAuto = await doorService(a, { autoSend: true })
const svcRival = await doorService(rival)

// 1. waits for approval (stays that way for the list; approved later in the browser)
const qApprove = await submit(a, svcA, customerOf('Avery Approve'))
check('(a new request waits for the business: pending_review, priced)', (await statusOf(qApprove.id)) === 'pending_review' && (await fullRow(qApprove.id)).pricing_json.total > 0)

// 2. approved, opened by the customer, then accepted
const qAccept = await submit(a, svcA, customerOf('Blake Accept'))
expectOk('approve', await approve(a, qAccept.id))
// 3. approved, then declined
const qDecline = await submit(a, svcA, customerOf('Casey Decline'))
expectOk('approve', await approve(a, qDecline.id))
// 4. a service that sends automatically
const qAuto = await submit(a, svcAuto, customerOf('Devon Auto'))
const autoRow = await fullRow(qAuto.id)
check('(the automatic service sends without approval: sent, approved_at empty)', autoRow.status === 'sent' && !autoRow.approved_at && Boolean(autoRow.sent_at), { status: autoRow.status, approved_at: autoRow.approved_at })
// 5. the other business's quote
const qRival = await submit(rival, svcRival, customerOf('Rowan Rival'))

// Copies of the approved quote (sent, reviewed) and of the pending one
const sentToday = await copyOf(qAccept.id, 'Emery Senttoday')
const sentOld = await copyOf(qAccept.id, 'Finley Sentold', { sent_at: daysAgo(4) })
const sentOldNoEmail = await copyOf(qAccept.id, 'Gray Noemail', { sent_at: daysAgo(4) }, false)
const viewed = await copyOf(qAccept.id, 'Harper Viewed')
expectOk('customer view', await viewAsCustomer(viewed.id, viewed.token))
const revised = await copyOf(qAccept.id, 'Indy Revised', { status: 'revised' })
const question = await copyOf(qAccept.id, 'Jules Question')
expectOk('customer view', await viewAsCustomer(question.id, question.token)) // a customer reads the quote before asking
expectOk('customer question', await ask(question.id, question.token, 'Is the old door taken away?'))
const expired = await copyOf(qAccept.id, 'Kit Expired', { status: 'expired', token_expires_at: daysAgo(1) })
const clarifying = await copyOf(qApprove.id, 'Lane Clarify', { status: 'awaiting_clarification' })
const paid = await copyOf(qAccept.id, 'Mika Paid', { status: 'paid', accepted_at: daysAgo(2), paid_at: daysAgo(1) })
const failed = await copyOf(qApprove.id, 'Noor Failed', { status: 'failed', pricing_json: { ...(await fullRow(qApprove.id)).pricing_json, total: 0, subtotal: 0, breakdown: [] } })
const pendingRow = await fullRow(qApprove.id)
const held = await copyOf(qApprove.id, 'Oakley Held', { content_json: { ...(pendingRow.content_json ?? {}), limitHold: true }, pricing_json: { ...pendingRow.pricing_json, total: 0, subtotal: 0, breakdown: [] } })
const noPrice = await copyOf(qApprove.id, 'Perry Noprice', { pricing_json: { ...pendingRow.pricing_json, total: 0, subtotal: 0, breakdown: [] } })
const working = await copyOf(qApprove.id, 'Quinn Working', { status: 'generating' })
const testQuote = await copyOf(qAccept.id, 'Reese Testquote', { is_test: true })
// the automatic quote again, for the customer's decline wording
const autoDecline = await copyOf(qAuto.id, 'Sage Autodecline')

// the real flows on the approved quotes
expectOk('customer view', await viewAsCustomer(qAccept.id, qAccept.token))
check('(a customer question moves the quote to feedback_received)', (await statusOf(question.id)) === 'feedback_received')
check('(a customer view moves the quote to viewed)', (await statusOf(viewed.id)) === 'viewed')

const everyId = [qApprove, qAccept, qDecline, qAuto, sentToday, sentOld, sentOldNoEmail, viewed, revised, question, expired, clarifying, paid, failed, held, noPrice, working, testQuote, autoDecline].map((q) => q.id)
const statusesBefore = Object.fromEntries(await Promise.all(everyId.map(async (id) => [id, await statusOf(id)] as const)))

// ====================================================================
section('1. The list API: groups, counts, the default tab')
// ====================================================================
const dbRows = (await sb.select('quotes', `tenant_id=eq.${a.tenantId}&select=id,status`)) as Array<{ id: string; status: string }>
const expectCount = (group: QuoteListGroup) => (group === 'all' ? dbRows.length : dbRows.filter((r) => quoteGroupOf(r.status) === group).length)

const first = await list(a, 'group=default')
check('group=default opens on "Needs you" when it has any', first.ok && first.json.group === 'needs_you', first.json.group)
check('the counts come back in the same request, one per tab', first.ok && ['needs_you', 'waiting', 'accepted', 'closed', 'unfinished', 'all'].every((k) => typeof first.json.counts?.[k] === 'number'), first.json.counts)
for (const group of ['needs_you', 'waiting', 'accepted', 'closed', 'all'] as const) {
  const res = await list(a, `group=${group}`)
  const allowed = group === 'all' ? null : (QUOTE_GROUP_STATUSES[group] as readonly string[])
  check(
    `group=${group}: only that group's quotes, and the count matches the database (${expectCount(group)})`,
    res.ok && res.json.group === group && res.json.items.length === expectCount(group) && res.json.counts?.[group] === expectCount(group) &&
      res.json.items.every((i) => !allowed || allowed.includes(i.status)),
    { items: res.json.items?.length, count: res.json.counts?.[group] }
  )
}
const needsYou = (await list(a, 'group=needs_you')).json.items
check('"Needs you" holds the approval, the question, the failed one, the held one and the one with no price', [qApprove.id, question.id, failed.id, held.id, noPrice.id].every((id) => needsYou.some((i) => i.quoteId === id)) && needsYou.length === 5, needsYou.map((i) => i.customerName))
const allItems = (await list(a, 'group=all')).json.items
check('"Working out the price" has no tab: it shows under All only', allItems.some((i) => i.quoteId === working.id) && !(await Promise.all(['needs_you', 'waiting', 'accepted', 'closed'].map(async (g) => (await list(a, `group=${g}`)).json.items.some((i) => i.quoteId === working.id)))).some(Boolean))

// the "declined" status filter (it was missing from the valid statuses, so it returned every quote)
expectOk('decline', await decline(qDecline.id, qDecline.token))
const declinedOnly = await list(a, 'status=declined')
check('status=declined returns the declined quote only (it used to return everything)', declinedOnly.ok && declinedOnly.json.items.length === 1 && declinedOnly.json.items[0]!.quoteId === qDecline.id, declinedOnly.json.items?.map((i) => i.status))
const closedNow = await list(a, 'group=closed')
check('…and a declined quote is in "Closed" with its date', closedNow.json.items.some((i) => i.quoteId === qDecline.id && Boolean(i.declinedAt)) && closedNow.json.counts?.closed === 2, closedNow.json.counts)

// accept the approved one
expectOk('accept', await accept(qAccept.id, qAccept.token))
const acceptedNow = await list(a, 'group=accepted')
check('an accepted quote moves to "Accepted"', acceptedNow.json.items.some((i) => i.quoteId === qAccept.id) && acceptedNow.json.counts?.accepted === 2, acceptedNow.json.counts)

// the mobile app's call, bad input, and who may ask
const plain = await list(a, 'limit=30')
check('without a group the route answers as before: every quote, no counts (the mobile app’s call)', plain.ok && plain.json.counts === undefined && plain.json.group === undefined && plain.json.items.length === dbRows.length, { items: plain.json.items?.length, counts: plain.json.counts })
check('an unknown group is refused', (await list(a, 'group=everything')).status === 400)
check('signed out: 401', (await list(null, 'group=default')).status === 401)
const searched = await list(a, `group=all&search=${encodeURIComponent('Jules')}`)
check('the counts follow the search text', searched.ok && searched.json.items.length === 1 && searched.json.counts?.all === 1 && searched.json.counts?.needs_you === 1 && searched.json.counts?.waiting === 0, searched.json.counts)
const commaSearch = await list(a, `group=all&search=${encodeURIComponent('Question, Jules (x)')}`)
check('a search with a comma or a bracket is answered, not an error', commaSearch.ok && commaSearch.json.items.length === 0 && commaSearch.json.counts?.all === 0, commaSearch.status)
const byEmail = await list(a, `group=all&search=${encodeURIComponent('jules.question@')}`)
check('search finds a customer by email too', byEmail.ok && byEmail.json.items.length === 1 && byEmail.json.items[0]!.quoteId === question.id)
check('the test quote keeps its flag', allItems.find((i) => i.quoteId === testQuote.id)?.isTest === true && allItems.filter((i) => i.isTest).length === 1)
check('the held request is flagged, and only it', allItems.find((i) => i.quoteId === held.id)?.held === true && allItems.filter((i) => i.held).length === 1)

// tenant isolation
const rivalList = await list(rival, 'group=all')
check('another business sees only its own quote and its own counts', rivalList.ok && rivalList.json.items.length === 1 && rivalList.json.items[0]!.quoteId === qRival.id && rivalList.json.counts?.all === 1 && !rivalList.json.items.some((i) => everyId.includes(i.quoteId)), rivalList.json.counts)
check('…and none of its quotes are in this business’s list', !allItems.some((i) => i.quoteId === qRival.id))
const rivalDefault = await list(rival, 'group=default')
check('group=default with one quote waiting opens on "Needs you"; with none it would open on All', rivalDefault.json.group === 'needs_you' && rivalDefault.json.counts?.needs_you === 1, rivalDefault.json)
expectOk('approve rival', await approve(rival, qRival.id))
const rivalAfter = await list(rival, 'group=default')
check('group=default opens on All once nothing needs the business', rivalAfter.json.group === 'all' && rivalAfter.json.counts?.needs_you === 0 && rivalAfter.json.items.length === 1, rivalAfter.json.counts)

// unfinished requests are counted in the same request
const lead = await http('POST', `${cfg.appUrl}/api/public/leads`, { body: { tenantKey: a.tenantKey, serviceId: svcA, customer: { name: 'Tatum Unfinished', email: 'tatum.unfinished@example.com', phone: '(555) 201-7777' } } })
const leadsListed = (await http('GET', `${cfg.appUrl}/api/leads?days=30`, { headers: a.cookie })).json as { items: unknown[] }
const withLead = await list(a, 'group=all')
check('the Unfinished count matches the unfinished requests list', lead.ok && withLead.json.counts?.unfinished === leadsListed.items.length && leadsListed.items.length === 1, { count: withLead.json.counts?.unfinished, listed: leadsListed.items.length })
check('…and another business’s count does not include it', (await list(rival, 'group=all')).json.counts?.unfinished === 0)

// ====================================================================
section('2. Label, detail line and next step, from the real rows')
// ====================================================================
const items = (await list(a, 'group=all')).json.items
const turnFor = (id: string) => {
  const i = items.find((x) => x.quoteId === id)!
  return quoteTurn({
    status: i.status, customerName: i.customerName, hasEmail: Boolean(i.customerEmail), total: i.total, held: i.held === true,
    createdAt: i.createdAt, sentAt: i.sentAt, viewedAt: i.viewedAt, acceptedAt: i.acceptedAt, paidAt: i.paidAt, declinedAt: i.declinedAt, expiresAt: i.expiresAt,
  })
}
const reads = (name: string, id: string, want: { label: string; detail?: string | RegExp; button: string | null }) => {
  const t = turnFor(id)
  const detailOk = want.detail === undefined || (typeof want.detail === 'string' ? t.detail === want.detail : want.detail.test(t.detail))
  check(`${name}: "${want.label}"${want.detail ? `, "${typeof want.detail === 'string' ? want.detail : t.detail}"` : ''}, button ${want.button ? `"${want.button}"` : 'none'}`, t.label === want.label && detailOk && t.buttonLabel === want.button, { label: t.label, detail: t.detail, button: t.buttonLabel })
}
reads('waiting for approval', qApprove.id, { label: 'Needs your approval', detail: 'Received today', button: 'Check and approve' })
reads('pending with no price', noPrice.id, { label: 'Needs your approval', detail: 'No price yet', button: 'Add the price' })
reads('held by the plan limit', held.id, { label: 'Saved, not priced yet', detail: 'Your plan limit was reached', button: 'Price this request' })
reads('customer question', question.id, { label: 'Customer asked a question', detail: 'Waiting for your answer', button: 'Answer question' })
reads('could not be priced', failed.id, { label: 'Could not be priced', detail: 'Received today', button: 'Contact customer' })
reads('sent today', sentToday.id, { label: 'Waiting for customer', detail: 'Sent today, not opened yet', button: null })
reads('sent 4 days ago, unopened', sentOld.id, { label: 'Waiting for customer', detail: 'Sent 4 days ago, not opened yet', button: 'Send again' })
reads('sent 4 days ago, unopened, no email address', sentOldNoEmail.id, { label: 'Waiting for customer', detail: 'Sent 4 days ago, not opened yet', button: 'Contact customer' })
reads('opened', viewed.id, { label: 'Waiting for customer', detail: 'Opened today', button: null })
reads('revised', revised.id, { label: 'Waiting for customer', detail: 'Updated quote sent today', button: null })
reads('awaiting clarification', clarifying.id, { label: 'Waiting for customer', detail: 'Waiting for their answers', button: null })
reads('sent automatically', qAuto.id, { label: 'Waiting for customer', detail: 'Sent today, not opened yet', button: null })
reads('accepted', qAccept.id, { label: 'Customer accepted', detail: /^Accepted on \S+ \S+$/, button: 'Contact customer' })
reads('paid', paid.id, { label: 'Paid', detail: /^Paid on \S+ \S+$/, button: null })
reads('declined', qDecline.id, { label: 'Customer declined', detail: /^Declined on \S+ \S+$/, button: null })
reads('expired', expired.id, { label: 'Expired', detail: /^Expired on \S+ \S+$/, button: 'Send again' })
reads('still being priced', working.id, { label: 'Working out the price', detail: 'Received today', button: null })
check('no quote reads "Sent", "Viewed" or "Revised"', items.every((i) => !['Sent', 'Viewed', 'Revised', 'Feedback'].includes(turnFor(i.quoteId).label)))

const detailJson = (await http('GET', `${cfg.appUrl}/api/quotes/${qDecline.id}`, { headers: a.cookie })).json as { quote: { declined_at?: string | null; token_expires_at?: string | null } }
check('the quote page’s data carries the decline date and the link’s expiry (for the tracker)', Boolean(detailJson.quote.declined_at) && Boolean(detailJson.quote.token_expires_at))

// ====================================================================
section('3. Home: Waiting for you')
// ====================================================================
const home = await (await fetch(`${cfg.appUrl}/app`, { headers: a.cookie, redirect: 'manual' })).text()
const waitingSection = /data-testid="waiting-for-you"([\s\S]*?)<\/section>/.exec(home)?.[1] ?? ''
const waitingRows = waitingSection.split('data-testid="waiting-quote"').slice(1)
const homeRow = (name: string) => waitingRows.find((r) => r.includes(name)) ?? ''
check('Home lists the quote to approve, with "Needs your approval" and Approve & send', homeRow('Avery Approve').includes('Needs your approval') && /Approve &(amp;)? send/.test(homeRow('Avery Approve')))
check('Home lists the customer question, with "Customer asked a question" and "Answer question"', homeRow('Jules Question').includes('Customer asked a question') && homeRow('Jules Question').includes('Answer question') && homeRow('Jules Question').includes(`/app/quotes/${question.id}`))
check('Home lists the request that could not be priced, with "Could not be priced" and "Contact customer"', homeRow('Noor Failed').includes('Could not be priced') && homeRow('Noor Failed').includes('Contact customer'))
check('Home leaves out the held request, the one with no price, and everything waiting for a customer', waitingRows.length === 3, waitingRows.length)
check('Home counts them: "3 need you"', /data-testid="waiting-count"[^>]*>(<[^>]+>)*3(<[^>]+>)*\s*(<!-- -->)?\s*need you/.test(waitingSection), /data-testid="waiting-count"[\s\S]{0,120}/.exec(waitingSection)?.[0])

// ====================================================================
// The pages (needs PLAYWRIGHT_DIR)
// ====================================================================
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The pages themselves (tabs, the next-step button on each row, the More menu, the Next step box, the tracker, the customer wording, the phone width): set PLAYWRIGHT_DIR to run the browser pass. The wording behind them is checked above and in the unit tests.')
} else {
  section('4. The pages (browser)')
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const origin = new URL(cfg.appUrl).origin
  const contextFor = async (biz: Biz | null, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport })
    if (biz) {
      await ctx.addCookies(biz.cookieHeader.split('; ').map((pair) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      }))
    }
    return ctx
  }
  type Ctx = Awaited<ReturnType<typeof contextFor>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  const dialogs: string[] = []
  const watch = (p: Page) => p.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss() })
  const button = (p: Page, name: string | RegExp) => p.getByRole('button', { name, exact: typeof name === 'string' })

  // ---- the quotes list ----
  const ctxA = await contextFor(a)
  const listPage = await ctxA.newPage()
  watch(listPage)
  await listPage.goto(`${cfg.appUrl}/app/quotes`, { waitUntil: 'networkidle' })
  await listPage.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  const tabNames = await listPage.locator('[data-testid="quote-tabs"] [role="tab"]').evaluateAll((els) => els.map((el) => (el.childNodes[0]?.textContent ?? '').trim()))
  check('list: six tabs, in order, and no status dropdown', JSON.stringify(tabNames) === JSON.stringify(['Needs you', 'Waiting for customer', 'Accepted', 'Closed', 'Unfinished', 'All']) && (await listPage.locator('select').count()) === 0, tabNames)
  check('list: it opens on "Needs you"', (await listPage.getByTestId('tab-needs_you').getAttribute('aria-selected')) === 'true')
  const apiCounts = (await list(a, 'group=all')).json.counts!
  const tabCounts: Record<string, number> = {}
  for (const key of ['needs_you', 'waiting', 'accepted', 'closed', 'unfinished', 'all']) tabCounts[key] = Number(await listPage.getByTestId(`tab-count-${key}`).innerText())
  check('list: each tab shows its count', Object.keys(tabCounts).every((k) => tabCounts[k] === apiCounts[k]), tabCounts)

  const rowsOn = async () => {
    await listPage.waitForLoadState('networkidle')
    return listPage.getByTestId('quote-row').evaluateAll((els) => els.map((el) => ({
      id: el.getAttribute('data-quote-id') ?? '',
      group: el.getAttribute('data-group') ?? '',
      text: (el as HTMLElement).innerText,
      label: el.querySelector('[data-testid="turn-label"]')?.textContent ?? '',
      detail: el.querySelector('[data-testid="turn-detail"]')?.textContent ?? '',
      next: el.querySelector('[data-testid="next-step-button"]')?.textContent ?? null,
      wordless: Array.from(el.querySelectorAll('button, a')).filter((b) => !(b.textContent ?? '').trim()).length,
      test: Array.from(el.querySelectorAll('span')).some((s) => s.textContent === 'Test'),
    })))
  }
  type RowOnPage = Awaited<ReturnType<typeof rowsOn>>[number]
  const openTab = async (key: string) => {
    await listPage.getByTestId(`tab-${key}`).click()
    await listPage.waitForFunction((k) => document.querySelector(`[data-testid="tab-${k}"]`)?.getAttribute('aria-selected') === 'true', key)
    await listPage.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 30_000 })
  }
  const nextOf = (rows: RowOnPage[], id: string) => rows.find((r) => r.id === id)?.next ?? null
  const seen: RowOnPage[] = []

  const rNeeds = await rowsOn()
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
  await shot(listPage, 'list-needs-you')
  seen.push(...rNeeds)
  check('list, Needs you: every row is in that group', rNeeds.length === 5 && rNeeds.every((r) => r.group === 'needs_you'), rNeeds.map((r) => r.label))
  check('list, Needs you: one worded next-step button per row',
    nextOf(rNeeds, qApprove.id) === 'Check and approve' && nextOf(rNeeds, question.id) === 'Answer question' && nextOf(rNeeds, failed.id) === 'Contact customer' &&
      nextOf(rNeeds, held.id) === 'Price this request' && nextOf(rNeeds, noPrice.id) === 'Add the price',
    Object.fromEntries(rNeeds.map((r) => [r.label, r.next])))
  const approveRow = rNeeds.find((r) => r.id === qApprove.id)!
  check('list: a row shows the customer, the service, the total, the label and its detail line', approveRow.text.includes('Avery Approve') && approveRow.text.includes(door.name) && /\$[\d,]+/.test(approveRow.text) && approveRow.label === 'Needs your approval' && approveRow.detail === 'Received today', approveRow.text.replace(/\n+/g, ' | '))

  await openTab('waiting')
  const rWaiting = await rowsOn()
  seen.push(...rWaiting)
  check('list, Waiting for customer: sent, opened, updated and "waiting for their answers" all read "Waiting for customer"', rWaiting.length === apiCounts.waiting && rWaiting.every((r) => r.label === 'Waiting for customer' && r.group === 'waiting'), rWaiting.map((r) => r.detail))
  check('list, Waiting for customer: the detail line says where it stands',
    rWaiting.find((r) => r.id === sentToday.id)?.detail === 'Sent today, not opened yet' && rWaiting.find((r) => r.id === viewed.id)?.detail === 'Opened today' &&
      rWaiting.find((r) => r.id === revised.id)?.detail === 'Updated quote sent today' && rWaiting.find((r) => r.id === clarifying.id)?.detail === 'Waiting for their answers' &&
      rWaiting.find((r) => r.id === sentOld.id)?.detail === 'Sent 4 days ago, not opened yet')
  check('list, Waiting for customer: no button while there is nothing to do; "Send again" after 3 days unopened; "Contact customer" when there is no email',
    nextOf(rWaiting, sentToday.id) === null && nextOf(rWaiting, viewed.id) === null && nextOf(rWaiting, revised.id) === null && nextOf(rWaiting, clarifying.id) === null &&
      nextOf(rWaiting, sentOld.id) === 'Send again' && nextOf(rWaiting, sentOldNoEmail.id) === 'Contact customer',
    Object.fromEntries(rWaiting.map((r) => [r.detail, r.next])))
  check('list: the test quote keeps its "Test" tag', rWaiting.find((r) => r.id === testQuote.id)?.test === true && rWaiting.filter((r) => r.test).length === 1)

  // the More menu: words, by the T-157 rules
  const menuOf = async (id: string) => {
    const rowEl = listPage.locator(`[data-testid="quote-row"][data-quote-id="${id}"]`)
    await rowEl.getByTestId('more-button').click()
    const words = await rowEl.locator('[data-testid="more-menu"] [role="menuitem"]').allInnerTexts()
    await listPage.keyboard.press('Escape')
    await rowEl.getByTestId('more-menu').waitFor({ state: 'detached' })
    return words
  }
  await listPage.locator(`[data-testid="quote-row"][data-quote-id="${sentToday.id}"]`).getByTestId('more-button').click()
  await shot(listPage, 'list-waiting-more-menu')
  await listPage.keyboard.press('Escape')
  const menuSent = await menuOf(sentToday.id)
  check('list, More on a sent quote: Open quote, Send again, Copy link, Download PDF, Pricing trace', JSON.stringify(menuSent) === JSON.stringify(['Open quote', 'Send again', 'Copy link', 'Download PDF', 'Pricing trace']), menuSent)
  const menuOld = await menuOf(sentOld.id)
  check('list, More: "Send again" is not repeated when it is already the row’s button', !menuOld.includes('Send again') && menuOld.includes('Copy link'), menuOld)
  const menuNoEmail = await menuOf(sentOldNoEmail.id)
  check('list, More, a customer with no email: no "Send again" (it would not work), Copy link is there', !menuNoEmail.includes('Send again') && menuNoEmail.includes('Copy link'), menuNoEmail)

  await openTab('accepted')
  const rAccepted = await rowsOn()
  seen.push(...rAccepted)
  check('list, Accepted: "Customer accepted" with "Contact customer"; "Paid" with no button',
    rAccepted.length === 2 && rAccepted.find((r) => r.id === qAccept.id)?.label === 'Customer accepted' && nextOf(rAccepted, qAccept.id) === 'Contact customer' &&
      rAccepted.find((r) => r.id === paid.id)?.label === 'Paid' && nextOf(rAccepted, paid.id) === null,
    rAccepted.map((r) => [r.label, r.detail, r.next]))
  const menuAccepted = await menuOf(qAccept.id)
  check('list, More on an accepted quote: no "Send again"', JSON.stringify(menuAccepted) === JSON.stringify(['Open quote', 'Copy link', 'Download PDF', 'Pricing trace']), menuAccepted)

  await openTab('closed')
  const rClosed = await rowsOn()
  seen.push(...rClosed)
  check('list, Closed: "Customer declined" with no button; "Expired" with "Send again"',
    rClosed.length === 2 && rClosed.find((r) => r.id === qDecline.id)?.label === 'Customer declined' && nextOf(rClosed, qDecline.id) === null &&
      rClosed.find((r) => r.id === expired.id)?.label === 'Expired' && nextOf(rClosed, expired.id) === 'Send again',
    rClosed.map((r) => [r.label, r.detail, r.next]))

  await openTab('unfinished')
  await listPage.getByText('Tatum Unfinished').first().waitFor({ timeout: 30_000 })
  check('list, Unfinished: the unfinished requests list', (await listPage.getByTestId('quote-row').count()) === 0 && (await listPage.getByText('Tatum Unfinished').count()) > 0)

  await openTab('all')
  const rAll = await rowsOn()
  seen.push(...rAll)
  check('list, All: every quote, including the one still being priced', rAll.length === apiCounts.all && rAll.find((r) => r.id === working.id)?.label === 'Working out the price' && nextOf(rAll, working.id) === null, rAll.length)
  const menuPending = await menuOf(qApprove.id)
  check('list, More on a quote awaiting approval: "Open quote" only', JSON.stringify(menuPending) === JSON.stringify(['Open quote']), menuPending)
  check('list: no icon-only action anywhere (every button and link has words)', seen.every((r) => r.wordless === 0) && (await listPage.locator('[data-testid="quote-row"] [title]').evaluateAll((els) => els.filter((el) => el.tagName === 'BUTTON' || el.tagName === 'A').length)) === 0)
  check('list: no row reads "Sent", "Viewed", "Revised" or "Feedback"', rAll.every((r) => !['Sent', 'Viewed', 'Revised', 'Feedback', 'Awaiting your approval'].includes(r.label)))

  // search keeps the tab counts in step
  await listPage.getByPlaceholder(/Search by customer/).fill('Jules')
  await listPage.waitForFunction(() => document.querySelector('[data-testid="tab-count-all"]')?.textContent === '1', null, { timeout: 30_000 })
  check('list: searching updates the counts with the list', (await listPage.getByTestId('tab-count-needs_you').innerText()) === '1' && (await listPage.getByTestId('quote-row').count()) === 1)
  await listPage.getByPlaceholder(/Search by customer/).fill('')
  await listPage.waitForFunction((n) => document.querySelector('[data-testid="tab-count-all"]')?.textContent === String(n), apiCounts.all, { timeout: 30_000 })

  // "Check and approve" opens the quote page
  await openTab('needs_you')
  await listPage.locator(`[data-testid="quote-row"][data-quote-id="${qApprove.id}"]`).getByTestId('next-step-button').click()
  await listPage.waitForURL(`**/app/quotes/${qApprove.id}`, { timeout: 30_000 })
  await listPage.getByTestId('next-step').waitFor({ timeout: 30_000 })
  check('list: "Check and approve" opens the quote', listPage.url().endsWith(`/app/quotes/${qApprove.id}`))

  // Home's link still lands on the unfinished requests
  const unfinishedPage = await ctxA.newPage()
  await unfinishedPage.goto(`${cfg.appUrl}/app/quotes?filter=unfinished`, { waitUntil: 'networkidle' })
  await unfinishedPage.getByText('Tatum Unfinished').first().waitFor({ timeout: 30_000 })
  check('list: Home’s link opens straight on the Unfinished tab, with the counts', (await unfinishedPage.getByTestId('tab-unfinished').getAttribute('aria-selected')) === 'true' && (await unfinishedPage.getByTestId('tab-count-unfinished').innerText()) === '1')
  await unfinishedPage.close()

  // ---- the quote page: Next step box and tracker ----
  const quotePage = async (ctx: Ctx, id: string) => {
    const p = await ctx.newPage()
    watch(p)
    await p.goto(`${cfg.appUrl}/app/quotes/${id}`, { waitUntil: 'networkidle' })
    await p.getByTestId('quote-tracker').waitFor({ timeout: 30_000 })
    return p
  }
  const boxOf = async (p: Page) => ({
    sentence: await p.getByTestId('next-step-sentence').innerText(),
    action: await p.getByTestId('next-step').getAttribute('data-action'),
    buttons: await p.locator('[data-testid="next-step"] button, [data-testid="next-step"] a').allInnerTexts(),
    label: await p.getByTestId('turn-label').first().innerText(),
  })
  const trackerOf = (p: Page) => p.getByTestId('tracker-step').evaluateAll((els) => els.map((el) => ({
    step: el.getAttribute('data-step'), done: el.getAttribute('data-done') === 'true',
    label: el.querySelector('p')?.textContent ?? '', lines: Array.from(el.querySelectorAll('p')).slice(1).map((x) => x.textContent ?? ''),
  })))
  const labelsOf = (steps: Awaited<ReturnType<typeof trackerOf>>) => steps.map((s) => s.label)
  const dated = (s: { lines: string[] }) => /^\d{1,2} \w{3}|^\w{3} \d{1,2}/.test(s.lines[0] ?? '')

  // awaiting approval (the page the list button opened)
  const boxPending = await boxOf(listPage)
  await shot(listPage, 'quote-awaiting-approval')
  check('page, awaiting approval: the Next step sentence and one main button, "Approve & send"',
    boxPending.sentence === 'Check the price and approve. The customer can accept only after you approve.' && JSON.stringify(boxPending.buttons) === JSON.stringify(['Approve & send']) && boxPending.label === 'Needs your approval' &&
      (await button(listPage, 'Approve & send').count()) === 1, boxPending)
  const tPending = await trackerOf(listPage)
  check('page, awaiting approval: tracker reads Request received (dated), Waiting for your approval, Not opened yet, Not accepted yet',
    JSON.stringify(labelsOf(tPending)) === JSON.stringify(['Request received', 'Waiting for your approval', 'Not opened yet', 'Not accepted yet']) && tPending[0]!.done && dated(tPending[0]!) && tPending.slice(1).every((s) => !s.done && s.lines.length === 0), tPending)
  check('page: the plain timeline is gone', (await listPage.getByText('Timeline', { exact: true }).count()) === 0)
  await button(listPage, 'Approve & send').click()
  await listPage.waitForFunction(() => /Nothing for you to do/.test(document.querySelector('[data-testid="next-step-sentence"]')?.textContent ?? ''), null, { timeout: 30_000 })
  const boxApproved = await boxOf(listPage)
  const tApproved = await trackerOf(listPage)
  check('page, after approving: "Nothing for you to do. Waiting for Avery. Sent today, not opened yet." and no main button',
    boxApproved.sentence === 'Nothing for you to do. Waiting for Avery. Sent today, not opened yet.' && boxApproved.buttons.length === 0 && boxApproved.label === 'Waiting for customer', boxApproved)
  check('page, approved: tracker step two reads "You approved" with its date', tApproved[1]!.label === 'You approved' && tApproved[1]!.done && dated(tApproved[1]!) && tApproved[2]!.label === 'Not opened yet', tApproved)
  check('page, approved: the other buttons are as T-157 left them (Edit, Send again, Copy link)', (await button(listPage, 'Edit').count()) === 1 && (await button(listPage, 'Send again').count()) === 1 && (await button(listPage, 'Copy link').count()) === 1)
  check('(approving through the box really approved it)', (await statusOf(qApprove.id)) === 'sent' && Boolean((await fullRow(qApprove.id)).approved_at))
  await listPage.close()

  // sent automatically
  const pAuto = await quotePage(ctxA, qAuto.id)
  const tAuto = await trackerOf(pAuto)
  check('page, automatic service: tracker step two reads "Sent automatically" with its date', tAuto[1]!.label === 'Sent automatically' && tAuto[1]!.done && dated(tAuto[1]!) && !labelsOf(tAuto).includes('You approved'), tAuto)
  await pAuto.close()

  // accepted
  const pAccepted = await quotePage(ctxA, qAccept.id)
  const boxAccepted = await boxOf(pAccepted)
  await shot(pAccepted, 'quote-accepted')
  const tAccepted = await trackerOf(pAccepted)
  check('page, accepted: "Blake accepted on <date>. Contact them to book the job." with Email and Call links',
    /^Blake accepted on \S+ \S+\. Contact them to book the job\.$/.test(boxAccepted.sentence) && JSON.stringify(boxAccepted.buttons) === JSON.stringify(['Email Blake', 'Call Blake']) &&
      ((await pAccepted.getByTestId('next-step-email').getAttribute('href')) ?? '').startsWith('mailto:blake.accept@example.com') && ((await pAccepted.getByTestId('next-step-call').getAttribute('href')) ?? '').startsWith('tel:'), boxAccepted)
  check('page, accepted: all four tracker steps are done and dated', JSON.stringify(labelsOf(tAccepted)) === JSON.stringify(['Request received', 'You approved', 'Customer opened', 'Customer accepted']) && tAccepted.every((s) => s.done && dated(s)), tAccepted)
  check('page, accepted: Copy link only, as T-157 left it', (await button(pAccepted, 'Copy link').count()) === 1 && (await button(pAccepted, 'Send again').count()) === 0 && (await button(pAccepted, 'Edit').count()) === 0)
  await pAccepted.close()

  // declined
  const pDeclined = await quotePage(ctxA, qDecline.id)
  const boxDeclined = await boxOf(pDeclined)
  const tDeclined = await trackerOf(pDeclined)
  check('page, declined: "Casey declined on <date>. Nothing for you to do." and no button', /^Casey declined on \S+ \S+\. Nothing for you to do\.$/.test(boxDeclined.sentence) && boxDeclined.buttons.length === 0 && boxDeclined.label === 'Customer declined', boxDeclined)
  check('page, declined: the final tracker step reads "Customer declined" with its date', tDeclined[3]!.label === 'Customer declined' && dated(tDeclined[3]!) && !labelsOf(tDeclined).includes('Customer accepted') && !labelsOf(tDeclined).includes('Not accepted yet'), tDeclined)
  await pDeclined.close()

  // expired, a question, held, no price, failed, paid
  const pExpired = await quotePage(ctxA, expired.id)
  const boxExpired = await boxOf(pExpired)
  const tExpired = await trackerOf(pExpired)
  check('page, expired: the final step reads "Expired"; the main button is "Send again", once on the page', tExpired[3]!.label === 'Expired' && JSON.stringify(boxExpired.buttons) === JSON.stringify(['Send again']) && (await button(pExpired, 'Send again').count()) === 1 && /^This quote expired on \S+ \S+ without an answer\. Send it again to give Kit a new link\.$/.test(boxExpired.sentence), boxExpired)
  await pExpired.close()

  const pQuestion = await quotePage(ctxA, question.id)
  const boxQuestion = await boxOf(pQuestion)
  check('page, customer question: "Jules asked a question. …" with Email and Call, and "Mark as answered" on the question',
    boxQuestion.sentence === 'Jules asked a question. Answer them, then mark it as answered, or edit the quote and send it again.' && JSON.stringify(boxQuestion.buttons) === JSON.stringify(['Email Jules', 'Call Jules']) && (await button(pQuestion, 'Mark as answered').count()) === 1, boxQuestion)
  await button(pQuestion, 'Mark as answered').click()
  await pQuestion.waitForFunction(() => /Nothing for you to do/.test(document.querySelector('[data-testid="next-step-sentence"]')?.textContent ?? ''), null, { timeout: 30_000 })
  const boxAnswered = await boxOf(pQuestion)
  check('page, once answered: back to "Waiting for customer"', boxAnswered.label === 'Waiting for customer' && boxAnswered.buttons.length === 0 && /^Nothing for you to do\. Waiting for Jules\. They opened it today\.$/.test(boxAnswered.sentence), boxAnswered)
  await pQuestion.close()

  const pHeld = await quotePage(ctxA, held.id)
  const boxHeld = await boxOf(pHeld)
  check('page, held by the plan limit: "Price this request" and "Upgrade plan"; the old "Lead saved" box is gone', boxHeld.label === 'Saved, not priced yet' && JSON.stringify(boxHeld.buttons) === JSON.stringify(['Price this request', 'Upgrade plan']) && (await pHeld.getByText(/Lead saved/).count()) === 0 && (await button(pHeld, 'Approve & send').count()) === 0, boxHeld)
  await pHeld.close()

  const pNoPrice = await quotePage(ctxA, noPrice.id)
  const boxNoPrice = await boxOf(pNoPrice)
  check('page, no price yet: "Add the price, then send it to Perry." with "Edit quote", and no Approve', boxNoPrice.sentence === 'This quote has no price yet. Add the price, then send it to Perry.' && JSON.stringify(boxNoPrice.buttons) === JSON.stringify(['Edit quote']) && (await button(pNoPrice, 'Approve & send').count()) === 0, boxNoPrice)
  await pNoPrice.close()

  const pFailed = await quotePage(ctxA, failed.id)
  const boxFailed = await boxOf(pFailed)
  check('page, could not be priced: contact the customer', boxFailed.label === 'Could not be priced' && boxFailed.sentence === 'We could not work out a price for this request. Contact Noor and quote it yourself.' && JSON.stringify(boxFailed.buttons) === JSON.stringify(['Email Noor', 'Call Noor']), boxFailed)
  await pFailed.close()

  const pNoEmail = await quotePage(ctxA, sentOldNoEmail.id)
  const boxNoEmail = await boxOf(pNoEmail)
  check('page, unopened, no email address: Call only, and Copy link is on the page', JSON.stringify(boxNoEmail.buttons) === JSON.stringify(['Call Gray']) && /copy the link and send it another way/.test(boxNoEmail.sentence) && (await button(pNoEmail, 'Copy link').count()) === 1 && (await button(pNoEmail, 'Send again').count()) === 0, boxNoEmail)
  await pNoEmail.close()

  const pPaid = await quotePage(ctxA, paid.id)
  const tPaid = await trackerOf(pPaid)
  check('page, paid: step four keeps "Customer accepted" and adds "Paid <date>"', tPaid[3]!.label === 'Customer accepted' && /^Paid /.test(tPaid[3]!.lines[1] ?? ''), tPaid[3])
  await pPaid.close()

  // tenant isolation on the page: the rival cannot open this business's quote
  const ctxRival = await contextFor(rival)
  const pRival = await ctxRival.newPage()
  await pRival.goto(`${cfg.appUrl}/app/quotes/${qAccept.id}`, { waitUntil: 'networkidle' })
  check('page: another business cannot open the quote', (await pRival.getByTestId('next-step').count()) === 0 && (await pRival.getByText('Blake Accept').count()) === 0)
  await ctxRival.close()

  // ---- the customer page wording ----
  const ctxCustomer = await contextFor(null)
  const customerPage = async (id: string, token: string) => {
    const p = await ctxCustomer.newPage()
    watch(p)
    await p.goto(`${cfg.appUrl}/q/${id}?token=${token}`, { waitUntil: 'networkidle' })
    await p.getByText('Price breakdown').first().waitFor({ timeout: 30_000 })
    return p
  }
  const wordsOn = async (p: Page) => ({
    acceptQuote: (await button(p, /^Accept this quote — /).count()) > 0, acceptEstimate: (await button(p, /^Accept this estimate — /).count()) > 0,
    declineQuote: (await button(p, 'No longer need this? Decline this quote').count()) > 0, declineEstimate: (await button(p, 'No longer need this? Decline this estimate').count()) > 0,
    yourQuote: (await p.getByText(/^Your quote/).count()) > 0, yourEstimate: (await p.getByText(/^Your estimate/).count()) > 0,
  })
  const body = (p: Page) => p.locator('body').innerText()

  // reviewed: the copy approved earlier (sent, approved_at set)
  const cReviewed = await customerPage(sentToday.id, sentToday.token)
  const wReviewed = await wordsOn(cReviewed)
  check('customer page, reviewed: "Your quote", "Accept this quote — $…", "Decline this quote"; no "estimate" on those', wReviewed.yourQuote && wReviewed.acceptQuote && wReviewed.declineQuote && !wReviewed.acceptEstimate && !wReviewed.declineEstimate, wReviewed)
  await button(cReviewed, 'No longer need this? Decline this quote').click()
  check('customer page, reviewed: the decline box says "Decline this quote", "Keep the quote", "Decline quote"', (await cReviewed.getByText('Decline this quote', { exact: true }).count()) > 0 && (await button(cReviewed, 'Keep the quote').count()) === 1 && (await button(cReviewed, 'Decline quote').count()) === 1)
  await button(cReviewed, 'Decline quote').click()
  await cReviewed.getByText('Quote declined').waitFor({ timeout: 30_000 })
  check('customer page, reviewed: declining reads "Quote declined"', (await cReviewed.getByText('Estimate declined').count()) === 0 && (await statusOf(sentToday.id)) === 'declined')
  await cReviewed.close()

  const cAccepted = await customerPage(qAccept.id, qAccept.token)
  check('customer page, reviewed and accepted: "Quote accepted"', (await cAccepted.getByText('Quote accepted', { exact: true }).count()) > 0 && (await cAccepted.getByText('Estimate accepted').count()) === 0)
  check('customer page: no grade or confidence word (the T-146 guard)', findConfidenceLanguage(await body(cAccepted)).length === 0, findConfidenceLanguage(await body(cAccepted)))
  await cAccepted.close()

  // not reviewed: sent automatically
  const cAuto = await customerPage(qAuto.id, qAuto.token)
  const wAuto = await wordsOn(cAuto)
  check('customer page, sent automatically: "Your estimate", "Accept this estimate — $…", "Decline this estimate"; no "quote" on those', wAuto.yourEstimate && wAuto.acceptEstimate && wAuto.declineEstimate && !wAuto.acceptQuote && !wAuto.declineQuote && !wAuto.yourQuote, wAuto)
  await cAuto.close()
  expectOk('accept auto', await accept(qAuto.id, qAuto.token))
  const cAutoAccepted = await customerPage(qAuto.id, qAuto.token)
  check('customer page, sent automatically and accepted: "Estimate accepted"', (await cAutoAccepted.getByText('Estimate accepted', { exact: true }).count()) > 0 && (await cAutoAccepted.getByText('Quote accepted').count()) === 0)
  await cAutoAccepted.close()
  const cAutoDecline = await customerPage(autoDecline.id, autoDecline.token)
  await button(cAutoDecline, 'No longer need this? Decline this estimate').click()
  check('customer page, sent automatically: the decline box says "Decline this estimate", "Keep the estimate", "Decline estimate"', (await cAutoDecline.getByText('Decline this estimate', { exact: true }).count()) > 0 && (await button(cAutoDecline, 'Keep the estimate').count()) === 1 && (await button(cAutoDecline, 'Decline estimate').count()) === 1)
  await button(cAutoDecline, 'Decline estimate').click()
  await cAutoDecline.getByText('Estimate declined').waitFor({ timeout: 30_000 })
  check('customer page, sent automatically: declining reads "Estimate declined"', (await cAutoDecline.getByText('Quote declined').count()) === 0 && (await statusOf(autoDecline.id)) === 'declined')
  await cAutoDecline.close()

  // ---- a phone ----
  const ctxPhone = await contextFor(a, { width: 390, height: 844 })
  const phone = await ctxPhone.newPage()
  await phone.goto(`${cfg.appUrl}/app/quotes`, { waitUntil: 'networkidle' })
  await phone.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  const phoneShape = await phone.evaluate(() => {
    const tabs = document.querySelector('[data-testid="quote-tabs"]') as HTMLElement
    const rowEl = document.querySelector('[data-testid="quote-row"]') as HTMLElement
    const parts = Array.from(rowEl.children).map((el) => el.getBoundingClientRect())
    return {
      tabsScroll: tabs.scrollWidth > tabs.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      stacked: parts.every((r, i) => i === 0 || r.top >= parts[i - 1]!.bottom - 1),
      rowFits: rowEl.getBoundingClientRect().right <= window.innerWidth + 1,
    }
  })
  await shot(phone, 'phone-list')
  check('phone: the tabs scroll sideways and the page itself does not', phoneShape.tabsScroll && !phoneShape.pageOverflow, phoneShape)
  check('phone: a row stacks (customer, service, total, status, next step, one under the other)', phoneShape.stacked && phoneShape.rowFits, phoneShape)
  await phone.getByTestId('tab-all').scrollIntoViewIfNeeded()
  await phone.getByTestId('tab-all').click()
  await phone.waitForFunction(() => document.querySelector('[data-testid="tab-all"]')?.getAttribute('aria-selected') === 'true')
  check('phone: the last tab can be reached and opened', (await phone.getByTestId('tab-all').getAttribute('aria-selected')) === 'true')
  await phone.goto(`${cfg.appUrl}/app/quotes/${qAccept.id}`, { waitUntil: 'networkidle' })
  await phone.getByTestId('quote-tracker').waitFor({ timeout: 30_000 })
  const phoneQuote = await phone.evaluate(() => {
    const steps = Array.from(document.querySelectorAll('[data-testid="tracker-step"]')).map((el) => el.getBoundingClientRect())
    return { pageOverflow: document.documentElement.scrollWidth > window.innerWidth, stacked: steps.every((r, i) => i === 0 || r.top >= steps[i - 1]!.bottom - 1) }
  })
  await shot(phone, 'phone-quote-accepted')
  check('phone: the quote page fits and the tracker steps stack', !phoneQuote.pageOverflow && phoneQuote.stacked, phoneQuote)
  await ctxPhone.close()

  check('no browser alert() fired anywhere', dialogs.length === 0, dialogs)
  await browser.close()
}

// ====================================================================
section('5. Nothing but wording changed')
// ====================================================================
// Reading the list, Home and the pages moved no quote. The only moves are the
// ones this script made on purpose (decline, accept, approve, answer).
const moved: Record<string, string> = {
  [qDecline.id]: 'declined', [qAccept.id]: 'accepted',
  ...(process.env.PLAYWRIGHT_DIR && { [qApprove.id]: 'sent', [question.id]: 'viewed', [sentToday.id]: 'declined', [qAuto.id]: 'accepted', [autoDecline.id]: 'declined' }),
}
const statusesAfter = Object.fromEntries(await Promise.all(everyId.map(async (id) => [id, await statusOf(id)] as const)))
const unexpected = everyId.filter((id) => statusesAfter[id] !== (moved[id] ?? statusesBefore[id]))
check('no status changed except through the actions this script took', unexpected.length === 0, unexpected.map((id) => ({ id, before: statusesBefore[id], after: statusesAfter[id] })))
check('the list buttons are the six agreed, with words', JSON.stringify(Object.values(QUOTE_TURN_COPY.listButtons)) === JSON.stringify(['Check and approve', 'Add the price', 'Price this request', 'Answer question', 'Send again', 'Contact customer']))

// ---------------------------------------------------------------------
if (notChecked.length) {
  console.log('\nNot checked here:')
  for (const line of notChecked) console.log(`  • ${line}`)
}
if (stalls.length) {
  console.log('\nStalled and retried once (the worker’s pipeline, not this ticket):')
  for (const line of stalls) console.log(`  • ${line}`)
}

saveJson(outDir, 'checks.json', { checks, notChecked, stalls })
const failedChecks = checks.filter((x) => !x.pass)
console.log(`\n${checks.length - failedChecks.length}/${checks.length} pass — ${outDir}`)
process.exit(failedChecks.length ? 1 : 0)
