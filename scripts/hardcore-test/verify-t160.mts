// T-160 live check: a sectioned menu, a fuller Home, unfinished requests that
// clear, and the sign-in line.
// Run (local stack up: supabase with migration 39, web, worker):
//   npx tsx scripts/hardcore-test/verify-t160.mts
// With the page checks as well (the menu on desktop and phone, the banner and
// badge clearing, Done, Home with data and with none, the sign-in line):
//   PLAYWRIGHT_DIR=~/estimator-browser npx tsx scripts/hardcore-test/verify-t160.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. the renames: /app/services and /app/quote-link are the pages; the old
//    addresses redirect and keep their query string;
// 2. unfinished requests: new, seen, done, and that another business can
//    neither see nor mark them;
// 3. Home's data, from the real rows: where the quotes stand, the latest
//    activity, the last 30 days against the 30 before;
// 4. the pages (browser): the three menu sections on desktop and phone, the
//    banner and the badge clearing and coming back, Done, Home blocks d to g
//    with data and with none, the sign-in line, the settings label.
//
// One quote goes through the real pipeline (approve, customer view, question,
// accept). The other rows are copies of it with dates and a status set by
// hand, so the two 30-day periods and each activity line are known exactly.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { QUOTE_TURN_COPY } from '../../packages/shared/src/quote-turn'
import { HERO } from '../../apps/web/src/lib/marketing/home-copy'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t160-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const stalls: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)

const sha = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

async function business(name: string) {
  const id = shortId()
  const email = `owner+t160-${id}@hardcore.test`
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
  const slug = (await sb.select('tenants', `id=eq.${tenantId}&select=slug`))[0].slug as string
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, email, slug }
}
type Biz = Awaited<ReturnType<typeof business>>

const door = garageDoorsPackUS.services[0]!
async function doorService(biz: Biz) {
  const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: door.name, description: door.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
      draftConfig: door.draft,
    },
  }))
  return created.service.id as string
}
const doorAnswers = [
  { fieldId: '_project_description', value: 'New garage door please, single steel one' },
  { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' },
  { fieldId: 'door_style', value: 'Steel, non-insulated' },
]
const customerOf = (n: string) => ({ name: n, email: `${n.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-1212' })

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
type QuoteRow = Record<string, unknown> & { id: string; status: string; customer_json: Record<string, unknown>; pricing_json: { total: number } & Record<string, unknown> }
const fullRow = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=*`))[0] as QuoteRow
/** A copy of a real quote under a new customer, with dates and a status set by hand */
async function copyOf(sourceId: string, customerName: string, overrides: Record<string, unknown> = {}) {
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
const approve = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/approve`, { headers: biz.cookie })
const viewAsCustomer = (id: string, token: string) => http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}`)
const accept = (id: string, token: string) =>
  http('POST', `${cfg.appUrl}/api/public/quotes/${id}/accept`, { body: { token, details: { timing: 'asap', timingNote: '', address: '12 Oak Lane, Ballwin, MO 63021', phone: '(555) 201-1212' } } })
const ask = (id: string, token: string, text: string) =>
  http('POST', `${cfg.appUrl}/api/public/quotes/${id}/feedback`, { body: { token, feedbackType: 'feedback', feedbackText: text } })

// unfinished requests
const startLead = (biz: Biz, serviceId: string, name: string) =>
  http('POST', `${cfg.appUrl}/api/public/leads`, { body: { tenantKey: biz.tenantKey, serviceId, customer: customerOf(name) } })
type LeadItem = { leadId: string; customerName: string; isNew?: boolean }
const leadList = async (biz: Biz | null) => {
  const res = await http('GET', `${cfg.appUrl}/api/leads?days=30`, biz ? { headers: biz.cookie } : {})
  return { status: res.status, items: ((res.json as { items?: LeadItem[] } | null)?.items ?? []) as LeadItem[], asOf: (res.json as { asOf?: string } | null)?.asOf }
}
const newCount = async (biz: Biz | null) => {
  const res = await http('GET', `${cfg.appUrl}/api/leads/new-count`, biz ? { headers: biz.cookie } : {})
  return { status: res.status, count: (res.json as { count?: number } | null)?.count }
}
const markSeen = (biz: Biz | null, asOf?: string) =>
  http('POST', `${cfg.appUrl}/api/leads/seen`, { ...(biz && { headers: biz.cookie }), body: { asOf } })
const markDone = (biz: Biz | null, leadId: string) => http('POST', `${cfg.appUrl}/api/leads/${leadId}/done`, biz ? { headers: biz.cookie } : {})
const leadRow = async (leadId: string) => (await sb.select('request_leads', `id=eq.${leadId}&select=seen_at,handled_at,completed_at`))[0] as { seen_at: string | null; handled_at: string | null }
const page = async (url: string, cookie?: { Cookie: string }) => {
  const res = await fetch(url, { headers: cookie, redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location') ?? '', html: await res.text() }
}

// ====================================================================
section('Setup: a business with quotes, a rival, and a brand-new business')
// ====================================================================
const a = await business('Ridgeway Doors')
const rival = await business('Hollow Lane Doors')
const fresh = await business('Northgate Doors')
const svcA = await doorService(a)
const svcRival = await doorService(rival)
await doorService(fresh) // a service, so Home shows instead of setup; no quotes

// One real quote: approved, opened, a question, accepted. Copies are taken
// right after approval, before the customer does anything.
const q1 = await submit(a, svcA, customerOf('Sarah Okafor'))
expectOk('approve', await approve(a, q1.id))
const total = (await fullRow(q1.id)).pricing_json.total
// waiting for approval, received 5 hours ago
const pending = await copyOf(q1.id, 'Avery Approve', { status: 'pending_review', created_at: ago(5 * HOUR), approved_at: null, sent_at: null })
// sent 6 hours ago, not opened
const sent = await copyOf(q1.id, 'Emery Sent', { created_at: ago(6 * HOUR), approved_at: ago(6 * HOUR), sent_at: ago(6 * HOUR) })
// declined 3 hours ago, received 2 days ago
const declined = await copyOf(q1.id, 'Dev Patel', { status: 'declined', created_at: ago(2 * DAY), approved_at: ago(2 * DAY), sent_at: ago(2 * DAY), declined_at: ago(3 * HOUR) })
// the 30 days before: received 40 days ago, sent 39, accepted 35
const before = await copyOf(q1.id, 'Olive Before', { status: 'accepted', created_at: ago(40 * DAY), approved_at: ago(39 * DAY), sent_at: ago(39 * DAY), viewed_at: ago(38 * DAY), accepted_at: ago(35 * DAY) })
// a setup test, waiting for approval right now: it must not count anywhere on Home
const test = await copyOf(q1.id, 'Tess Tester', { status: 'pending_review', is_test: true, created_at: ago(60_000), approved_at: null, sent_at: null })
// the customer's side of the real quote
expectOk('customer view', await viewAsCustomer(q1.id, q1.token))
expectOk('customer question', await ask(q1.id, q1.token, 'Is the old door taken away?'))
expectOk('accept', await accept(q1.id, q1.token))
check('(the real quote was approved, opened, asked about and accepted)', (await fullRow(q1.id)).status === 'accepted')
void [pending, sent, declined, before, test]

// ====================================================================
section('1. Services and Quote link: the pages and the old addresses')
// ====================================================================
for (const [from, to] of [
  ['/app/prices', '/app/services'],
  ['/app/share', '/app/quote-link'],
  ['/app/widget', '/app/quote-link'],
  ['/app/prices?x=1', '/app/services?x=1'],
] as const) {
  const res = await page(`${cfg.appUrl}${from}`, a.cookie)
  check(`${from} redirects to ${to}`, [307, 308].includes(res.status) && res.location.endsWith(to), { status: res.status, location: res.location })
}
for (const p of ['/app/services', '/app/quote-link', '/app/analytics', '/app/whatsapp', '/app/sms', '/app/settings', '/app/quotes']) {
  const res = await page(`${cfg.appUrl}${p}`, a.cookie)
  check(`${p} opens`, res.status === 200, res.status)
}
const linkPage = await page(`${cfg.appUrl}/app/quote-link`, a.cookie)
check('the Quote link page: its title and "Give customers this link, or put the form on your website."', />Quote link</.test(linkPage.html) && linkPage.html.includes('Give customers this link, or put the form on your website.') && linkPage.html.includes(`/quote/${a.slug}`))
const login = await page(`${cfg.appUrl}/login`)
const signup = await page(`${cfg.appUrl}/signup`)
check('sign-in and sign-up show the home page headline, not "AI-powered estimates for your business"',
  login.html.includes(HERO.headline) && signup.html.includes(HERO.headline) && !login.html.includes('AI-powered estimates for your business') && !signup.html.includes('AI-powered estimates for your business'), HERO.headline)
const homePublic = await page(`${cfg.appUrl}/`)
check('…and it is the same line as on the home page', homePublic.html.includes(HERO.headline))

// ====================================================================
section('2. Unfinished requests: new, seen, done')
// ====================================================================
check('signed out: the count, "seen" and "done" all answer 401', (await newCount(null)).status === 401 && (await markSeen(null)).status === 401 && (await markDone(null, 'lead_x')).status === 401)
check('(no unfinished requests yet: count 0)', (await newCount(a)).count === 0)
const tatum = expectOk('lead', await startLead(a, svcA, 'Tatum Unfinished')).leadId as string
const uma = expectOk('lead', await startLead(a, svcA, 'Uma Halfway')).leadId as string
check('two people start and do not finish: 2 new', (await newCount(a)).count === 2)
const first = await leadList(a)
check('the list shows both, each marked new, with the moment it was read', first.items.length === 2 && first.items.every((l) => l.isNew === true) && typeof first.asOf === 'string', first.items.map((l) => [l.customerName, l.isNew]))
check('reading the list marks nobody (a read never writes)', (await newCount(a)).count === 2 && !(await leadRow(tatum)).seen_at)
const homeNew = await page(`${cfg.appUrl}/app`, a.cookie)
check('Home says "2 new people started a request but didn’t finish…" with "See who"', /data-testid="unfinished-count"[\s\S]{0,400}>2<[\s\S]{0,60}new people started a request but didn(&#x27;|')t finish\. A quick call often wins the job\.[\s\S]{0,200}See who/.test(homeNew.html) && !homeNew.html.includes('in the last 7 days'))

// another business
check('another business has no new requests and none in its list', (await newCount(rival)).count === 0 && (await leadList(rival)).items.length === 0)
const rivalSeen = await markSeen(rival)
check('another business marking "seen" touches only its own (0 here)', rivalSeen.ok && rivalSeen.json.marked === 0 && (await newCount(a)).count === 2 && !(await leadRow(uma)).seen_at, rivalSeen.json)
const rivalDone = await markDone(rival, tatum)
check('another business pressing Done on this one gets 404 and changes nothing', rivalDone.status === 404 && !(await leadRow(tatum)).handled_at && (await leadList(a)).items.length === 2, rivalDone.status)
check('a made-up or malformed id is 404', (await markDone(a, 'lead_doesnotexist')).status === 404 && (await markDone(a, 'not%20an%20id')).status === 404)

// only the people who were on the screen are marked
const vic = expectOk('lead', await startLead(a, svcA, 'Vic Later')).leadId as string
const seenRes = await markSeen(a, first.asOf)
check('marking seen with the time the list was read marks those two, not the person who started after', seenRes.ok && seenRes.json.marked === 2 && Boolean((await leadRow(tatum)).seen_at) && Boolean((await leadRow(uma)).seen_at) && !(await leadRow(vic)).seen_at, seenRes.json)
check('…so the count is 1: the new person', (await newCount(a)).count === 1)
const afterSeen = await leadList(a)
check('the list still shows all three; only the new one is marked new', afterSeen.items.length === 3 && afterSeen.items.filter((l) => l.isNew).map((l) => l.customerName).join() === 'Vic Later', afterSeen.items.map((l) => [l.customerName, l.isNew]))
const futureSeen = await markSeen(a, new Date(Date.now() + DAY).toISOString())
check('a made-up future time is treated as now', futureSeen.ok && futureSeen.json.marked === 1 && (await newCount(a)).count === 0, futureSeen.json)
const homeSeen = await page(`${cfg.appUrl}/app`, a.cookie)
check('once seen, Home’s banner is gone', !homeSeen.html.includes('data-testid="unfinished-count"'))

// Done
const done = await markDone(a, uma)
check('Done: 200, and the person has handled_at', done.ok && Boolean((await leadRow(uma)).handled_at), done.status)
const afterDone = await leadList(a)
check('…they leave the list, and the Unfinished tab count drops with it', afterDone.items.length === 2 && !afterDone.items.some((l) => l.leadId === uma) && ((await http('GET', `${cfg.appUrl}/api/quotes?group=all&limit=1`, { headers: a.cookie })).json as { counts: { unfinished: number } }).counts.unfinished === 2, afterDone.items.map((l) => l.customerName))
check('pressing Done again is fine', (await markDone(a, uma)).ok)
const wren = expectOk('lead', await startLead(a, svcA, 'Wren Unseen')).leadId as string
check('a new person brings the count back: 1', (await newCount(a)).count === 1)
check('Done on someone never seen also clears them from the count', (await markDone(a, wren)).ok && (await newCount(a)).count === 0 && Boolean((await leadRow(wren)).seen_at))
// the rival's own lead is its own
const rivalLead = expectOk('lead', await startLead(rival, svcRival, 'Rowan Rivalside')).leadId as string
check('each business counts and lists only its own', (await newCount(rival)).count === 1 && (await newCount(a)).count === 0 && (await leadList(rival)).items.map((l) => l.leadId).join() === rivalLead && !(await leadList(a)).items.some((l) => l.leadId === rivalLead))
check('…and cannot press Done on the other’s', (await markDone(a, rivalLead)).status === 404 && !(await leadRow(rivalLead)).handled_at)

// ====================================================================
section('3. Home, from the real rows (server-rendered)')
// ====================================================================
const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const block = (html: string, testid: string) => new RegExp(`data-testid="${testid}"([\\s\\S]*?)</section>`).exec(html)?.[1] ?? ''
const home = (await page(`${cfg.appUrl}/app`, a.cookie)).html
const standTiles = [...block(home, 'home-stand').matchAll(/data-testid="stand-tile" data-group="(\w+)"[\s\S]*?data-testid="stand-count">(\d+)</g)].map((m) => `${m[1]} ${m[2]}`)
check('Where your quotes stand: Needs you 1, Waiting for customer 1, Accepted 1 (the test quote is not counted)', JSON.stringify(standTiles) === JSON.stringify(['needs_you 1', 'waiting 1', 'accepted 1']), standTiles)
const standText = text(block(home, 'home-stand'))
check('…named as on the quotes list, with "in the last 30 days" on Accepted', standText.includes('Where your quotes stand') && standText.includes('Needs you') && standText.includes('Waiting for customer') && /Accepted in the last 30 days/.test(standText), standText.trim())
const activityLines = [...block(home, 'home-activity').matchAll(/data-testid="activity-line" data-kind="(\w+)"><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ kind: m[1]!, href: m[2]!, words: text(m[3]!).trim() }))
check('Latest activity: the last six events, newest first',
  JSON.stringify(activityLines.map((l) => l.kind)) === JSON.stringify(['accepted', 'question', 'opened', 'approved', 'request', 'declined']), activityLines.map((l) => l.words))
check('…worded "Sarah accepted the quote", "Sarah asked a question", "Sarah opened the quote", "You approved Sarah’s quote", "Sarah sent a request", "Dev declined the quote"',
  activityLines.length === 6 && activityLines[0]!.words.startsWith('Sarah accepted the quote') && activityLines[1]!.words.startsWith('Sarah asked a question') && activityLines[2]!.words.startsWith('Sarah opened the quote') &&
    activityLines[3]!.words.startsWith("You approved Sarah's quote") && activityLines[4]!.words.startsWith('Sarah sent a request') && activityLines[5]!.words.startsWith('Dev declined the quote'))
check('…each with how long ago ("just now" or minutes for today’s, "3 hours ago" for the decline)', activityLines.slice(0, 5).every((l) => /(just now|\d+ minutes? ago)$/.test(l.words)) && activityLines[5]!.words.endsWith('3 hours ago'), activityLines.map((l) => l.words.split(' ').slice(-3).join(' ')))
check('…each linking to its quote', activityLines.slice(0, 5).every((l) => l.href === `/app/quotes/${q1.id}`) && activityLines[5]!.href === `/app/quotes/${declined}`)
check('…with no "his" or "her", and nothing from the test quote', !/\b(his|her)\b/i.test(text(block(home, 'home-activity'))) && !home.includes('Tess'))
const numbersBlock = block(home, 'home-numbers')
const numberCards = [...numbersBlock.matchAll(/data-testid="home-number">([\s\S]*?)<\/div>/g)].map((m) => text(m[1]!).trim())
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
check('Last 30 days: Requests 4, Estimates sent 3, Accepted 1, Value accepted (the real quote’s total)',
  numberCards.length === 4 && numberCards[0]!.startsWith('Requests 4') && numberCards[1]!.startsWith('Estimates sent 3') && numberCards[2]!.startsWith('Accepted 1') && numberCards[3]!.startsWith(`Value accepted ${money(total)}`), numberCards)
check('…each against the 30 days before: "up 3", "up 2", "same", "same"', numberCards[0]!.endsWith('up 3') && numberCards[1]!.endsWith('up 2') && numberCards[2]!.endsWith('same') && numberCards[3]!.endsWith('same') && text(numbersBlock).includes('Compared with the 30 days before.'), numberCards)
// a bigger job accepted in the period before: the value goes down by a money amount
const bigBefore = await copyOf(q1.id, 'Piper Before', { status: 'accepted', created_at: ago(50 * DAY), approved_at: ago(50 * DAY), sent_at: ago(50 * DAY), viewed_at: ago(48 * DAY), accepted_at: ago(45 * DAY), pricing_json: { ...(await fullRow(q1.id)).pricing_json, total: total + 1200 } })
void bigBefore
const numberCards2 = [...block((await page(`${cfg.appUrl}/app`, a.cookie)).html, 'home-numbers').matchAll(/data-testid="home-number">([\s\S]*?)<\/div>/g)].map((m) => text(m[1]!).trim())
check('…and money changes read "down $2,600" (and counts follow: accepted "down 1")', numberCards2[3]!.endsWith(`down ${money(total + 1200)}`) && numberCards2[2]!.endsWith('down 1') && numberCards2[0]!.endsWith('up 2'), numberCards2)
const linkBlock = block(home, 'home-quote-link')
check('Your quote link: the link, Copy, Open, and "QR code and website form" to the Quote link page', text(linkBlock).includes('Your quote link') && linkBlock.includes(`/quote/${a.slug}`) && />Copy</.test(linkBlock) && />Open</.test(linkBlock) && /href="\/app\/quote-link"[^>]*>QR code and website form</.test(linkBlock))
const order = ['data-testid="waiting-for-you"', 'data-testid="home-stand"', 'data-testid="home-activity"', 'data-testid="home-quote-link"', 'data-testid="home-numbers"'].map((s) => home.indexOf(s))
check('Home order: waiting for you, where quotes stand, latest activity, quote link, numbers', order.every((i) => i > 0) && [...order].sort((x, y) => x - y).join() === order.join(), order)
check('"Waiting for you" is as T-158 left it (the quote to approve, with Approve & send)', /data-testid="waiting-quote"[\s\S]*?Avery Approve[\s\S]*?Approve &(amp;)? send/.test(home) && /data-testid="waiting-count"[\s\S]{0,80}>1<[\s\S]{0,40}needs you/.test(home))

// a brand-new business: friendly lines, not zeros and an empty box
const emptyHome = (await page(`${cfg.appUrl}/app`, fresh.cookie)).html
check('new business, where your quotes stand: one friendly line, no counts', text(block(emptyHome, 'home-stand')).includes(QUOTE_TURN_COPY.home.stand.empty) && !emptyHome.includes('data-testid="stand-tile"'), text(block(emptyHome, 'home-stand')).trim())
check('new business, latest activity: one friendly line', text(block(emptyHome, 'home-activity')).includes(QUOTE_TURN_COPY.home.activity.empty) && !emptyHome.includes('data-testid="activity-line"'))
check('new business: its quote link is there to copy', block(emptyHome, 'home-quote-link').includes(`/quote/${fresh.slug}`))
check('new business: the four numbers with no "same" lines and no comparison note', (emptyHome.match(/data-testid="home-number"/g) ?? []).length === 4 && !emptyHome.includes('data-testid="number-change"') && !emptyHome.includes('data-testid="numbers-note"'))
check('new business: no "Waiting for you", no unfinished banner, and the setup checklist shows', !emptyHome.includes('data-testid="waiting-for-you"') && !emptyHome.includes('data-testid="unfinished-count"') && emptyHome.includes('data-testid="setup-checklist"'))
const stepTag = (id: string) => new RegExp(`<a[^>]*data-testid="checklist-${id}"[^>]*>`).exec(emptyHome)?.[0] ?? ''
check('the checklist keeps its words and points at the renamed pages', stepTag('service').includes('href="/app/services"') && stepTag('prices').includes('href="/app/services"') && stepTag('share').includes('href="/app/quote-link"') &&
  emptyHome.includes('Check your prices') && emptyHome.includes('Share your quote link') && !/href="\/app\/(prices|share|widget)"/.test(emptyHome), [stepTag('service'), stepTag('share')].map((t) => /href="[^"]+"/.exec(t)?.[0]))
check('another business’s Home shows none of this business’s customers', !(await page(`${cfg.appUrl}/app`, rival.cookie)).html.match(/Sarah|Dev Patel|Avery Approve/))

// ====================================================================
// The pages (needs PLAYWRIGHT_DIR)
// ====================================================================
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The pages themselves (the menu on desktop and phone, the badge, the banner clearing when the list is opened, the Done button, clicking a count on Home, Copy, the settings label): set PLAYWRIGHT_DIR to run the browser pass. The rules and the server-rendered Home are checked above.')
} else {
  section('4. The pages (browser)')
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const origin = new URL(cfg.appUrl).origin
  const contextFor = async (biz: Biz | null, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] })
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
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
  const menuOf = (p: Page) => p.locator('[data-testid="nav-section"]').evaluateAll((els) => els.map((el) => ({
    section: el.getAttribute('data-section'),
    heading: el.querySelector('p')?.textContent ?? '',
    items: Array.from(el.querySelectorAll('[data-testid="nav-item"]')).map((a) => ({
      label: a.querySelector('span')?.textContent ?? '', href: a.getAttribute('href'), active: a.getAttribute('aria-current') === 'page',
      badge: a.querySelector('[data-testid="nav-badge"]')?.textContent ?? null,
    })),
  })))
  type Menu = Awaited<ReturnType<typeof menuOf>>
  const badgeOf = (m: Menu) => m.flatMap((s) => s.items).find((i) => i.label === 'Unfinished requests')?.badge ?? null
  const activeOf = (m: Menu) => m.flatMap((s) => s.items).filter((i) => i.active).map((i) => i.label)
  const wantMenu = [
    ['work', 'Work', 'Home|/app', 'Quotes|/app/quotes', 'Unfinished requests|/app/quotes?filter=unfinished', 'Analytics|/app/analytics'],
    ['set-up', 'Set up', 'Services|/app/services', 'Quote link|/app/quote-link', 'WhatsApp|/app/whatsapp'],
    ['account', 'Account', 'Settings|/app/settings'],
  ]
  const sameMenu = (m: Menu) => JSON.stringify(m.map((s) => [s.section, s.heading, ...s.items.map((i) => `${i.label}|${i.href}`)])) === JSON.stringify(wantMenu)

  // ---- desktop: the menu and Home with data ----
  const ctxA = await contextFor(a)
  const p = await ctxA.newPage()
  watch(p)
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await p.getByTestId('home-numbers').waitFor({ timeout: 30_000 })
  const menu = await menuOf(p)
  check('menu, desktop: three sections — Work (Home, Quotes, Unfinished requests, Analytics), Set up (Services, Quote link, WhatsApp), Account (Settings)', sameMenu(menu), menu.map((s) => [s.heading, ...s.items.map((i) => i.label)]))
  check('menu: no SMS, Prices or Share item', !menu.flatMap((s) => s.items).some((i) => /^(SMS|Prices|Share)$/.test(i.label)))
  check('menu: Home is the item marked as the current page', JSON.stringify(activeOf(menu)) === JSON.stringify(['Home']), activeOf(menu))
  check('menu: the section headings read WORK, SET UP, ACCOUNT', JSON.stringify(await p.locator('[data-testid="nav-section"] > p').evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText))) === JSON.stringify(['WORK', 'SET UP', 'ACCOUNT']))
  await shot(p, 'home-with-data')

  // a count on Home opens its tab
  await p.locator('[data-testid="stand-tile"][data-group="waiting"]').click()
  await p.waitForURL('**/app/quotes?tab=waiting', { timeout: 30_000 })
  await p.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  check('Home: "Waiting for customer" opens that tab of the quotes list', (await p.getByTestId('tab-waiting').getAttribute('aria-selected')) === 'true' && (await p.getByTestId('quote-row').count()) === 1 && (await p.getByText('Emery Sent').count()) > 0)
  check('menu: on the quotes list, Quotes is the current item (not Unfinished requests)', JSON.stringify(activeOf(await menuOf(p))) === JSON.stringify(['Quotes']))
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await p.locator('[data-testid="stand-tile"][data-group="needs_you"]').click()
  await p.waitForURL('**/app/quotes?tab=needs_you', { timeout: 30_000 })
  await p.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  check('Home: "Needs you" opens that tab', (await p.getByTestId('tab-needs_you').getAttribute('aria-selected')) === 'true')
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await p.locator('[data-testid="stand-tile"][data-group="accepted"]').click()
  await p.waitForURL('**/app/quotes?tab=accepted', { timeout: 30_000 })
  await p.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  check('Home: "Accepted" opens that tab', (await p.getByTestId('tab-accepted').getAttribute('aria-selected')) === 'true')

  // an activity line opens its quote
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await p.getByTestId('activity-line').last().locator('a').click()
  await p.waitForURL(`**/app/quotes/${declined}`, { timeout: 30_000 })
  check('Home: a latest-activity line opens its quote', p.url().endsWith(`/app/quotes/${declined}`))

  // Copy on Home
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  const linkOnHome = await p.getByTestId('home-quote-link-url').innerText()
  await p.getByTestId('home-quote-link').getByRole('button', { name: 'Copy', exact: true }).click()
  await p.getByTestId('home-quote-link').getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 10_000 })
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  check('Home: Copy puts the quote link on the clipboard and says "Copied"', linkOnHome === `${origin}/quote/${a.slug}` && (clip === linkOnHome || clip === ''), { linkOnHome, clip })
  check('Home: Open and "QR code and website form" go to the public page and the Quote link page',
    (await p.getByTestId('home-quote-link').getByRole('link', { name: 'Open', exact: true }).getAttribute('href')) === linkOnHome &&
      (await p.getByTestId('home-quote-link').getByRole('link', { name: 'QR code and website form' }).getAttribute('href')) === '/app/quote-link')

  // ---- the banner and the badge clear, and come back ----
  const yara = expectOk('lead', await startLead(a, svcA, 'Yara Newcomer')).leadId as string
  const zed = expectOk('lead', await startLead(a, svcA, 'Zed Newcomer')).leadId as string
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await p.getByTestId('nav-badge').waitFor({ timeout: 30_000 })
  const bannerText = (await p.getByTestId('unfinished-count').innerText()).replace(/\s+/g, ' ')
  check('two new people: Home’s banner says "2 new people started a request but didn’t finish…" and the menu badge says 2', /^2 new people started a request but didn.t finish\. A quick call often wins the job\. See who$/.test(bannerText) && badgeOf(await menuOf(p)) === '2', { bannerText, badge: badgeOf(await menuOf(p)) })
  await shot(p, 'home-banner-and-badge')
  await p.getByTestId('unfinished-count').click()
  await p.waitForURL('**/app/quotes?filter=unfinished', { timeout: 30_000 })
  await p.getByTestId('unfinished-lead').first().waitFor({ timeout: 30_000 })
  const listed = await p.getByTestId('unfinished-lead').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-lead-id'), isNew: el.getAttribute('data-new') === 'true', text: (el as HTMLElement).innerText.replace(/\s+/g, ' ') })))
  check('"See who" opens the Unfinished tab: everyone from the last 30 days, the two new people tagged "New"',
    (await p.getByTestId('tab-unfinished').getAttribute('aria-selected')) === 'true' && listed.length === 4 && listed.filter((l) => l.isNew).map((l) => l.id).sort().join() === [yara, zed].sort().join() &&
      listed.filter((l) => l.isNew).every((l) => / New /.test(` ${l.text} `)) && listed.filter((l) => !l.isNew).every((l) => !/ New /.test(` ${l.text} `)), listed.map((l) => [l.text.slice(0, 24), l.isNew]))
  check('each person has a "Done" button', (await p.getByTestId('unfinished-done').count()) === 4)
  await p.waitForFunction(() => !document.querySelector('[data-testid="nav-badge"]'), null, { timeout: 30_000 })
  check('opening the list clears the menu badge straight away', badgeOf(await menuOf(p)) === null && (await newCount(a)).count === 0)
  check('menu: on the Unfinished tab, "Unfinished requests" is the current item (not Quotes)', JSON.stringify(activeOf(await menuOf(p))) === JSON.stringify(['Unfinished requests']), activeOf(await menuOf(p)))
  await shot(p, 'unfinished-list')
  await p.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await p.getByTestId('home-numbers').waitFor({ timeout: 30_000 })
  check('…and Home’s banner is gone', (await p.getByTestId('unfinished-count').count()) === 0 && (await p.getByTestId('nav-badge').count()) === 0)
  // a new person
  const quin = expectOk('lead', await startLead(a, svcA, 'Quin Latest')).leadId as string
  await p.reload({ waitUntil: 'networkidle' })
  await p.getByTestId('nav-badge').waitFor({ timeout: 30_000 })
  const bannerOne = (await p.getByTestId('unfinished-count').innerText()).replace(/\s+/g, ' ')
  check('a new person brings both back: "1 new person started a request…" and badge 1', bannerOne.startsWith('1 new person started a request') && badgeOf(await menuOf(p)) === '1', { bannerOne })
  // through the menu this time
  await p.locator('[data-testid="nav-item"][data-key="unfinished"]').click()
  await p.waitForURL('**/app/quotes?filter=unfinished', { timeout: 30_000 })
  await p.getByTestId('unfinished-lead').first().waitFor({ timeout: 30_000 })
  await p.waitForFunction(() => !document.querySelector('[data-testid="nav-badge"]'), null, { timeout: 30_000 })
  const listed2 = await p.getByTestId('unfinished-lead').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-lead-id'), isNew: el.getAttribute('data-new') === 'true' })))
  check('the menu item opens the Unfinished tab: all five, only the newest tagged "New", and the badge clears', listed2.length === 5 && listed2.filter((l) => l.isNew).map((l) => l.id).join() === quin && (await p.getByTestId('tab-count-unfinished').innerText()) === '5', listed2)

  // Done
  const yaraRow = p.locator(`[data-testid="unfinished-lead"][data-lead-id="${yara}"]`)
  await yaraRow.getByTestId('unfinished-done').click()
  await yaraRow.waitFor({ state: 'detached', timeout: 30_000 })
  const doneNote = await p.getByTestId('unfinished-note').innerText()
  await p.waitForFunction(() => document.querySelector('[data-testid="tab-count-unfinished"]')?.textContent === '4', null, { timeout: 30_000 })
  check('Done removes the person, says so, and the tab count drops to 4', doneNote === "Marked as done. They won't show here again." && (await p.getByTestId('unfinished-lead').count()) === 4 && Boolean((await leadRow(yara)).handled_at), doneNote)
  await p.reload({ waitUntil: 'networkidle' })
  await p.getByTestId('unfinished-lead').first().waitFor({ timeout: 30_000 })
  check('…and they stay gone after a reload', (await p.locator(`[data-lead-id="${yara}"]`).count()) === 0 && (await p.getByTestId('unfinished-lead').count()) === 4)

  // the tabs and the menu keep in step
  await p.getByTestId('tab-all').click()
  await p.waitForURL('**/app/quotes?tab=all', { timeout: 30_000 })
  await p.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  check('leaving the Unfinished tab makes Quotes the current menu item again', JSON.stringify(activeOf(await menuOf(p))) === JSON.stringify(['Quotes']))
  await p.locator('[data-testid="nav-item"][data-key="unfinished"]').click()
  await p.getByTestId('unfinished-lead').first().waitFor({ timeout: 30_000 })
  await p.locator('[data-testid="nav-item"][data-key="quotes"]').click()
  await p.getByTestId('quote-row').first().waitFor({ timeout: 30_000 })
  check('from the Unfinished tab, the menu’s "Quotes" goes back to the quotes', (await p.getByTestId('tab-unfinished').getAttribute('aria-selected')) === 'false' && (await p.getByTestId('unfinished-lead').count()) === 0)

  // ---- the renamed pages and the settings label ----
  for (const [key, url, title] of [['services', '/app/services', 'Services'], ['quote-link', '/app/quote-link', 'Quote link'], ['analytics', '/app/analytics', 'Analytics'], ['whatsapp', '/app/whatsapp', 'WhatsApp'], ['settings', '/app/settings', 'Settings']] as const) {
    await p.locator(`[data-testid="nav-item"][data-key="${key}"]`).click()
    await p.waitForURL(`**${url}`, { timeout: 30_000 })
    await p.getByRole('heading', { name: title, exact: true }).first().waitFor({ timeout: 30_000 })
    const activeNow = activeOf(await menuOf(p))
    check(`menu: "${title}" opens ${url}, the page is titled "${title}", and it is the current item`, activeNow.length === 1 && activeNow[0] === title, activeNow)
  }
  await p.goto(`${cfg.appUrl}/app/prices`, { waitUntil: 'networkidle' })
  check('an old bookmark to /app/prices lands on Services', p.url().endsWith('/app/services') && (await p.getByRole('heading', { name: 'Services', exact: true }).count()) > 0)
  await p.goto(`${cfg.appUrl}/app/share`, { waitUntil: 'networkidle' })
  check('an old bookmark to /app/share lands on Quote link, with the new description', p.url().endsWith('/app/quote-link') && (await p.getByText('Give customers this link, or put the form on your website.').count()) > 0)
  await p.goto(`${cfg.appUrl}/app/settings/notifications`, { waitUntil: 'networkidle' })
  await p.getByLabel('Send notifications to').waitFor({ timeout: 30_000 })
  const settingsTabs = await p.locator('main a[href^="/app/settings"]').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()))
  check('Settings: the field is labelled "Send notifications to"; the tabs are still Business, Branding, Billing, Notifications', (await p.getByText('Notification Email (Override)').count()) === 0 &&
    ['Business', 'Branding', 'Billing', 'Notifications'].every((tab) => settingsTabs.includes(tab)), settingsTabs)
  await p.goto(`${cfg.appUrl}/app/sms`, { waitUntil: 'networkidle' })
  check('/app/sms still opens by its address', p.url().endsWith('/app/sms') && (await p.locator('[data-testid="nav-item"]').count()) === 8)

  // ---- a brand-new business ----
  const ctxFresh = await contextFor(fresh)
  const pf = await ctxFresh.newPage()
  await pf.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await pf.getByTestId('home-numbers').waitFor({ timeout: 30_000 })
  check('new business, in the browser: friendly lines in "Where your quotes stand" and "Latest activity", its quote link, no badge',
    (await pf.getByTestId('stand-empty').innerText()) === QUOTE_TURN_COPY.home.stand.empty && (await pf.getByTestId('activity-empty').innerText()) === QUOTE_TURN_COPY.home.activity.empty &&
      (await pf.getByTestId('home-quote-link-url').innerText()).endsWith(`/quote/${fresh.slug}`) && (await pf.getByTestId('nav-badge').count()) === 0 && (await pf.getByTestId('number-change').count()) === 0)
  await shot(pf, 'home-new-business')
  await ctxFresh.close()

  // ---- another business cannot see them ----
  const ctxRival = await contextFor(rival)
  const pr = await ctxRival.newPage()
  await pr.goto(`${cfg.appUrl}/app/quotes?filter=unfinished`, { waitUntil: 'networkidle' })
  await pr.getByTestId('unfinished-lead').first().waitFor({ timeout: 30_000 })
  check('another business’s Unfinished tab lists only its own person', (await pr.getByTestId('unfinished-lead').count()) === 1 && (await pr.getByText('Rowan Rivalside').count()) > 0 && (await pr.getByText(/Tatum|Vic Later|Zed|Quin/).count()) === 0)
  await ctxRival.close()

  // ---- a phone ----
  const ctxPhone = await contextFor(a, { width: 390, height: 844 })
  const ph = await ctxPhone.newPage()
  await ph.goto(`${cfg.appUrl}/app`, { waitUntil: 'networkidle' })
  await ph.getByTestId('home-numbers').waitFor({ timeout: 30_000 })
  // (no helper functions inside evaluate: the bundler's name helper is not defined in the page)
  const phoneHome = await ph.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('[data-testid="stand-tile"]')).map((el) => el.getBoundingClientRect())
    const activity = document.querySelector('[data-testid="home-activity"]')?.getBoundingClientRect()
    const link = document.querySelector('[data-testid="home-quote-link"]')?.getBoundingClientRect()
    const numbers = Array.from(document.querySelectorAll('[data-testid="home-number"]')).map((el) => el.getBoundingClientRect())
    return {
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      tilesStacked: tiles.every((r, i) => i === 0 || r.top >= tiles[i - 1]!.bottom - 1),
      linkUnderActivity: Boolean(activity && link && link.top >= activity.bottom - 1),
      numbersTwoByTwo: numbers.length === 4 && Math.abs(numbers[0]!.top - numbers[1]!.top) < 2 && numbers[2]!.top > numbers[0]!.bottom - 1,
      order: ['waiting-for-you', 'home-stand', 'home-activity', 'home-quote-link', 'home-numbers'].map((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? -1),
    }
  })
  check('phone, Home: one column in the same order, the three counts stacked, the numbers two by two, nothing wider than the screen',
    !phoneHome.pageOverflow && phoneHome.tilesStacked && phoneHome.linkUnderActivity && phoneHome.numbersTwoByTwo && [...phoneHome.order].sort((x, y) => x - y).join() === phoneHome.order.join(), phoneHome)
  await shot(ph, 'phone-home')
  const menuHidden = await ph.locator('aside').evaluate((el) => el.getBoundingClientRect().right <= 0)
  await ph.getByRole('button', { name: 'Open menu' }).click()
  await ph.waitForFunction(() => (document.querySelector('aside')?.getBoundingClientRect().left ?? -1) >= 0)
  const phoneMenu = await menuOf(ph)
  check('phone: the menu is closed until opened, then shows the same three sections and items', menuHidden && sameMenu(phoneMenu), phoneMenu.map((s) => [s.heading, ...s.items.map((i) => i.label)]))
  await ph.screenshot({ path: path.join(outDir, 'phone-menu.png') })
  await ph.locator('[data-testid="nav-item"][data-key="unfinished"]').click()
  await ph.waitForURL('**/app/quotes?filter=unfinished', { timeout: 30_000 })
  await ph.getByTestId('unfinished-lead').first().waitFor({ timeout: 30_000 })
  await ph.waitForFunction(() => (document.querySelector('aside')?.getBoundingClientRect().right ?? 1) <= 0, null, { timeout: 10_000 })
  const phoneList = await ph.evaluate(() => ({
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    done: document.querySelectorAll('[data-testid="unfinished-done"]').length,
  }))
  check('phone: tapping "Unfinished requests" opens the list and closes the menu; the list fits, with Done on each person', !phoneList.pageOverflow && phoneList.done === 4, phoneList)
  await ctxPhone.close()

  // ---- the sign-in line ----
  const ctxOut = await contextFor(null)
  const po = await ctxOut.newPage()
  await po.goto(`${cfg.appUrl}/login`, { waitUntil: 'networkidle' })
  const loginLine = await po.getByTestId('auth-line').innerText()
  await po.goto(`${cfg.appUrl}/signup`, { waitUntil: 'networkidle' })
  const signupLine = await po.getByTestId('auth-line').innerText()
  await po.goto(`${cfg.appUrl}/`, { waitUntil: 'networkidle' })
  const heroLine = (await po.locator('h1').first().innerText()).replace(/\s+/g, ' ').trim()
  check('sign-in and sign-up read "Instant quotes on your website, in your prices.", the same as the home page’s headline', loginLine === HERO.headline && signupLine === HERO.headline && heroLine === HERO.headline, { loginLine, heroLine })
  await ctxOut.close()

  check('no browser alert() fired anywhere', dialogs.length === 0, dialogs)
  await browser.close()
}

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
