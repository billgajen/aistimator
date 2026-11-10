// T-151 live check: contact first, unfinished requests, the contact setting,
// the optional description, and the next step after accept.
// Run: npx tsx scripts/hardcore-test/verify-t151.mts   (local stack up, migration 34 applied)
//
// API level. The screens (order on the quote link and embed, both modes) are
// driven by a Playwright pass using the browser-input.json this writes.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t151-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const period = () => { const d = new Date(); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const usage = async (tenantId: string) => {
  const row = (await sb.select('usage_counters', `tenant_id=eq.${tenantId}&period_yyyymm=eq.${period()}&select=estimates_created,estimates_sent`))[0]
  return { created: row?.estimates_created ?? 0, sent: row?.estimates_sent ?? 0 }
}
const count = async (table: string, query: string) => (await sb.select(table, `${query}&select=id`)).length

async function business(name: string) {
  const id = shortId()
  const email = `owner+t151-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const tenantId = (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, tenantId, tenantKey: site.tenant_key as string, email, password }
}
type Biz = Awaited<ReturnType<typeof business>>

const door = garageDoorsPackUS.services[0]!
async function doorService(biz: Biz) {
  const created = expectOk('door service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: door.name, description: door.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
      draftConfig: door.draft, autoSend: true,
    },
  }))
  return created.service.id as string
}
/** A service that asks nothing of its own: the description is required */
async function plainService(biz: Biz) {
  const step = { id: 'visit', name: 'Call-out visit', description: 'Visit and quote', costType: 'fixed', defaultCost: 95, optional: false }
  const created = expectOk('plain service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: { name: 'General Handyman', documentTypeDefault: 'instant_estimate', scopeIncludes: ['Small household repairs'], scopeExcludes: [], defaultAssumptions: [], mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: null, requiredAngles: [] }, workSteps: [step], expectedSignals: [], pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [step] }, autoSend: true },
  }))
  return created.service.id as string
}
const doorAnswers = [{ fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }]
const submit = (biz: Biz, serviceId: string, customer: Record<string, unknown>, answers: unknown[], extra: Record<string, unknown> = {}) =>
  http('POST', `${cfg.appUrl}/api/public/quotes`, { body: { tenantKey: biz.tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers }, source: { type: 'widget' }, ...extra } })
const startLead = (biz: Biz, serviceId: string, customer: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  http('POST', `${cfg.appUrl}/api/public/leads`, { body: { tenantKey: biz.tenantKey, serviceId, customer, ...extra } })
const patchLead = (biz: Biz, leadId: string, body: Record<string, unknown>) =>
  http('PATCH', `${cfg.appUrl}/api/public/leads/${leadId}`, { body: { tenantKey: biz.tenantKey, ...body } })
const openLeads = async (biz: Biz) => expectOk('leads', await http('GET', `${cfg.appUrl}/api/leads`, { headers: biz.cookie })).items as Array<Record<string, unknown>>

const a = await business(`T151 Doors ${shortId()}`)
const rival = await business(`T151 Rival ${shortId()}`)
const doorId = await doorService(a)
const plainId = await plainService(a)

// ---------- 1. the contact setting ----------
check('the default is email required', expectOk('tenant', await http('GET', `${cfg.appUrl}/api/tenant`, { headers: a.cookie })).tenant.contactRequirement === 'email')
check('an unknown setting is refused', (await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { contactRequirement: 'none' } })).status === 400)
const phoneOnly = { name: 'Pat Phone', phone: '(555) 201-3344' }
check('email-only business: a phone-only request is refused', (await submit(a, doorId, phoneOnly, doorAnswers)).status === 400)
expectOk('set phone', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { contactRequirement: 'phone' } }))
const phoneQuote = await submit(a, doorId, phoneOnly, doorAnswers)
check('phone-only business: a phone-only request is accepted', phoneQuote.ok, phoneQuote.json?.error)
if (phoneQuote.ok) {
  const qr = (await sb.select('quotes', `id=eq.${phoneQuote.json.quoteId}&select=quote_request_id`))[0]
  const req = (await sb.select('quote_requests', `id=eq.${qr.quote_request_id}&select=customer_email,customer_phone`))[0]
  check('…stored with no email and the phone as typed', req.customer_email === null && req.customer_phone === '(555) 201-3344', req)
  const priced = await pollQuote(cfg, phoneQuote.json.quoteId, new URL(phoneQuote.json.quoteViewUrl).searchParams.get('token')!)
  check('…and priced like any other quote ($1,400)', priced.pricing?.total === 1400, priced.status)
  check('…the quote page can offer that phone back on accept', priced.customer?.phone === '(555) 201-3344')
}
check('phone-only business: an email-only request is refused', (await submit(a, doorId, { name: 'Em Mail', email: 'em@example.com' }, doorAnswers)).status === 400)
expectOk('set both', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { contactRequirement: 'both' } }))
check('both required: email alone is refused', (await submit(a, doorId, { name: 'Em Mail', email: 'em@example.com' }, doorAnswers)).status === 400)
check('both required: email and phone are accepted', (await submit(a, doorId, { name: 'Bo Th', email: 'both@example.com', phone: '(555) 201-9999' }, doorAnswers)).ok)
expectOk('back to email', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { contactRequirement: 'email' } }))

// ---------- 2. the description ----------
check('a service with its own questions accepts no description', (await submit(a, doorId, { name: 'No Words', email: 'nowords@example.com' }, doorAnswers)).ok)
const noDesc = await submit(a, plainId, { name: 'No Words', email: 'nowords2@example.com' }, [])
check('a service with no questions needs a description', noDesc.status === 400 && /describe the job/i.test(noDesc.json?.error?.message), noDesc.json?.error)
check('…and takes one', (await submit(a, plainId, { name: 'Words', email: 'words@example.com' }, [{ fieldId: '_project_description', value: 'Fix a sticking door and two shelves' }])).ok)

// ---------- 3. unfinished requests ----------
const before = { usage: await usage(a.tenantId), quotes: await count('quotes', `tenant_id=eq.${a.tenantId}`) }
check('the honeypot stops a bot at the contact step', (await startLead(a, doorId, { name: 'Bot', email: 'bot@example.com' }, { website: 'spam.example' })).status === 400)
const badLead = await startLead(a, doorId, { name: 'Sam', email: 'not-an-email' })
check('invalid contact details are refused with the field', badLead.status === 400 && Boolean(badLead.json?.error?.fields?.email))
const started = await startLead(a, doorId, { name: 'Sam Lead', email: 'sam.lead@example.com', phone: '(555) 201-7777' })
check('completing the contact step saves a lead', started.ok && Boolean(started.json.leadId && started.json.leadToken), started.json)
const leadId = started.json.leadId as string
const leadToken = started.json.leadToken as string
check('no quote is created and nothing counts toward usage', (await count('quotes', `tenant_id=eq.${a.tenantId}`)) === before.quotes && JSON.stringify(await usage(a.tenantId)) === JSON.stringify(before.usage))
check('progress updates with the lead’s token', (await patchLead(a, leadId, { leadToken, progress: 'questions', answers: doorAnswers })).ok)
check('…a wrong token can’t touch it', (await patchLead(a, leadId, { leadToken: 'guess', progress: 'details' })).status === 404)
check('…nor another business’s key', (await http('PATCH', `${cfg.appUrl}/api/public/leads/${leadId}`, { body: { tenantKey: rival.tenantKey, leadToken, progress: 'details' } })).status === 404)
await patchLead(a, leadId, { leadToken, progress: 'contact' })
let list = await openLeads(a)
const mine = list.find((l) => l.leadId === leadId)
check('the business sees it under "Started, didn’t finish", with how far they got', mine?.progress === 'questions' && mine?.customerPhone === '(555) 201-7777' && mine?.customerEmail === 'sam.lead@example.com' && mine?.answerCount === 2, mine)
check('another business can’t see it', (await openLeads(rival)).length === 0)
const home = await fetch(`${cfg.appUrl}/app`, { headers: a.cookie })
check('the dashboard home shows the 7-day count', (await home.text()).includes('data-testid="unfinished-count"'))

const finished = await submit(a, doorId, { name: 'Sam Lead', email: 'sam.lead@example.com', phone: '(555) 201-7777' }, doorAnswers, { leadId, leadToken })
check('finishing the request makes a normal quote', finished.ok, finished.json?.error)
const leadRow = (await sb.select('request_leads', `id=eq.${leadId}&select=quote_id,completed_at`))[0]
check('…the lead is closed and points at the quote', leadRow.quote_id === finished.json.quoteId && Boolean(leadRow.completed_at), leadRow)
list = await openLeads(a)
check('…and no longer shows as unfinished (no duplicate)', !list.some((l) => l.leadId === leadId))

// A reload loses the token: the same customer and service still close the lead
const lost = expectOk('lost lead', await startLead(a, doorId, { name: 'Reload Ray', email: 'ray@example.com' }))
expectOk('ray submits', await submit(a, doorId, { name: 'Reload Ray', email: 'ray@example.com' }, doorAnswers))
check('a lead whose token was lost is still closed by the same customer finishing', !(await openLeads(a)).some((l) => l.leadId === lost.leadId))

// Test mode never creates a lead
const link = expectOk('test link', await http('POST', `${cfg.appUrl}/api/onboarding/test-link`, { headers: a.cookie }))
const testToken = new URL(link.url).searchParams.get('test')
const leadsBefore = await count('request_leads', `tenant_id=eq.${a.tenantId}`)
const testLead = await startLead(a, doorId, { name: 'Owner Test', email: 'owner-test@example.com' }, { testToken })
check('a test request from setup never creates an unfinished lead', testLead.ok && testLead.json.skipped === true && (await count('request_leads', `tenant_id=eq.${a.tenantId}`)) === leadsBefore)
check('…and a forged test token is refused', (await startLead(a, doorId, { name: 'Faker', email: 'fake@example.com' }, { testToken: 'forged.token' })).status === 403)

// ---------- 4. accept asks for the next step ----------
const toAccept = expectOk('to accept', await submit(a, doorId, { name: 'Acey Accept', email: 'acey@example.com', phone: '(555) 201-1212' }, doorAnswers))
const acceptToken = new URL(toAccept.quoteViewUrl).searchParams.get('token')!
await pollQuote(cfg, toAccept.quoteId, acceptToken)
const badAccept = await http('POST', `${cfg.appUrl}/api/public/quotes/${toAccept.quoteId}/accept`, { body: { token: acceptToken, details: { timing: 'someday', address: '', phone: '' } } })
check('accepting without timing, address and phone is refused', badAccept.status === 400 && Boolean(badAccept.json?.error?.fields?.timing && badAccept.json?.error?.fields?.address))
check('…and the quote is not accepted', (await sb.select('quotes', `id=eq.${toAccept.quoteId}&select=status`))[0].status !== 'accepted')
const details = { timing: 'two_weeks', timingNote: 'Weekday mornings', address: '12 Oak Lane, Springfield, MO 63021', phone: '(555) 201-1212' }
const accepted = await http('POST', `${cfg.appUrl}/api/public/quotes/${toAccept.quoteId}/accept`, { body: { token: acceptToken, details } })
check('accept with the next step works', accepted.ok, accepted.json)
const saved = (await sb.select('quotes', `id=eq.${toAccept.quoteId}&select=status,acceptance_json`))[0]
check('…the details are saved on the quote', saved.status === 'accepted' && saved.acceptance_json?.timing === 'two_weeks' && saved.acceptance_json?.address === details.address && saved.acceptance_json?.phone === details.phone && saved.acceptance_json?.timingNote === details.timingNote, saved.acceptance_json)
const dash = expectOk('dashboard quote', await http('GET', `${cfg.appUrl}/api/quotes/${toAccept.quoteId}`, { headers: a.cookie }))
check('…and the dashboard quote API returns them', dash.quote?.acceptance_json?.address === details.address)
check('…the other business can’t read the quote', (await http('GET', `${cfg.appUrl}/api/quotes/${toAccept.quoteId}`, { headers: rival.cookie })).status === 404)

// For the Playwright pass
writeFileSync(path.join(outDir, 'browser-input.json'), JSON.stringify({ appUrl: cfg.appUrl, cookie: a.cookie.Cookie, tenantKey: a.tenantKey, slug: (await sb.select('tenants', `id=eq.${a.tenantId}&select=slug`))[0].slug, doorId, acceptedQuote: { id: toAccept.quoteId } }))
console.log(`\nbrowser input: ${path.join(outDir, 'browser-input.json')}`)

saveJson(outDir, 't151.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
if (passed !== checks.length) process.exitCode = 1
