// T-157 live check: quote actions that always work.
// Run (local stack up: supabase with migration 38, web, worker):
//   npx tsx scripts/hardcore-test/verify-t157.mts
// With the page checks (buttons, the customer page, the editor) as well:
//   PLAYWRIGHT_DIR=~/estimator-browser npx tsx scripts/hardcore-test/verify-t157.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
// Start the web app with CRON_SECRET=local-cron-t153 (as for verify-t153) so the
// reminder check can call the daily cron.
//
// 1. the business email rule, against the real database rows;
// 2. each action route refuses and allows by the shared rule;
// 3. the first link still opens after approval, a re-send, a copied link, a
//    text and a reminder; the list keeps the newest 10; expiry is unchanged;
// 4. a customer question never blocks Accept, "Mark as answered" is saved and
//    survives a reload, edit-and-send resolves every pending question;
// 5. revised stays revised;
// 6. a 34.6 x 18 line stores 622.8, lines add up to the subtotal, the editor
//    route rounds and drops stale label maths.
//
// What needs real email is listed at the end under "Not checked". Locally
// there is no Postmark, so no email is sent: "Send again" stops at
// EMAIL_NOT_CONFIGURED (after its own checks) and the cron skips reminders.
// Where that happens the token is replaced the way the route does it (a
// service-role update of quote_token_hash), which is what the trigger guards.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { resolveBusinessEmail } from '../../apps/web/src/lib/business-email'
import { loadBusinessEmail } from '../../apps/worker/src/business-email'
import { quoteActions, statusAfterResend } from '../../packages/shared/src/quote-status'
import { roundMoney, splitLabelMath } from '../../packages/shared/src/money'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t157-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
/** Quote submissions that stalled and were retried once */
const stalls: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)

const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patchRow = (table: string, query: string, body: unknown) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=representation' }, body })
const sha = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const CRON = process.env.CRON_SECRET || 'local-cron-t153'

// The service-role client the web app and the worker use for the email rule
const requireWeb = createRequire(path.join(ROOT, 'apps/web/package.json'))
const { createClient } = requireWeb('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
const adminClient = createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function business(name: string, region: 'US' | 'GB' = 'US') {
  const id = shortId()
  const email = `owner+t157-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: cookie,
    body: region === 'GB'
      ? { region: 'GB', currency: 'GBP', taxEnabled: true, taxRate: 0.2, serviceAreaMode: 'none', serviceAreaValues: [] }
      : { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, email }
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

// A per-unit service priced from the form: 34.6 sqm at 18 is the float case
const paintSteps = [
  { id: 'walls', name: 'Exterior walls', description: 'Prepare and paint the exterior walls', costType: 'per_unit', defaultCost: 18, optional: false, unitLabel: 'sqm', quantitySource: { type: 'form_field', fieldId: 'wall_area' } },
  { id: 'trim', name: 'Trim and sills', description: 'Paint the trim and window sills', costType: 'per_unit', defaultCost: 7.35, optional: false, unitLabel: 'm', quantitySource: { type: 'form_field', fieldId: 'trim_length' } },
]
async function paintService(biz: Biz) {
  const created = expectOk('paint service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: 'Exterior wall painting', description: 'Painting of exterior walls, trim and sills, priced by measured area.', documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['Preparation and two coats on exterior walls', 'Trim and window sills'], scopeExcludes: ['Roofline replacement'], defaultAssumptions: ['Walls are sound and accessible from the ground'],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: 'A photo of each wall', requiredAngles: [] },
      workSteps: paintSteps, expectedSignals: [],
      suggestedFields: [
        { fieldId: 'wall_area', label: 'Wall area (square metres)', type: 'number', required: true, criticalForPricing: true },
        { fieldId: 'trim_length', label: 'Trim length (metres)', type: 'number', required: true, criticalForPricing: true },
      ],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: paintSteps },
    },
  }))
  return created.service.id as string
}

async function submit(biz: Biz, serviceId: string, customer: { name: string; email?: string; phone?: string }, answers: unknown[] = doorAnswers, postcode = '63021') {
  // Locally the request waits for the whole pipeline, and an AI call there can
  // stall. One retry, then carry on; a second stall fails the run.
  const post = () => http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer, job: { postcodeOrZip: postcode, answers }, source: { type: 'widget' } },
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
  const view = await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token, view }
}
const row = async (id: string, cols = 'status,quote_token_hash,previous_token_hash,link_token_hashes,token_expires_at,sent_at,reminder_sent_at,version') =>
  (await sb.select('quotes', `id=eq.${id}&select=${cols}`))[0]
/** The customer's link, opened quietly (poll=1 records no view) */
const open = (id: string, token: string) => http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}&poll=1`)
/** The customer opening the page for real (records the view) */
const view = (id: string, token: string) => http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}`)
const opens = async (id: string, token: string) => (await open(id, token)).status === 200
const approve = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/approve`, { headers: biz.cookie })
const detail = async (biz: Biz, id: string) => (await http('GET', `${cfg.appUrl}/api/quotes/${id}`, { headers: biz.cookie })).json
const resend = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/resend`, { headers: biz.cookie })
const copyLink = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/link`, { headers: biz.cookie, body: { force: true } })
const pdfPost = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/pdf`, { headers: biz.cookie })
const pdfGet = (biz: Biz, id: string) => http('GET', `${cfg.appUrl}/api/quotes/${id}/pdf`, { headers: biz.cookie })
const textLink = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/sms/send-quote`, { headers: biz.cookie, body: { quoteId: id } })
const ask = (id: string, token: string, text: string, type = 'feedback') =>
  http('POST', `${cfg.appUrl}/api/public/quotes/${id}/feedback`, { body: { token, feedbackType: type, feedbackText: text } })
const answered = (biz: Biz | null, quoteId: string, feedbackId: string) =>
  http('POST', `${cfg.appUrl}/api/quotes/${quoteId}/feedback/${feedbackId}/answered`, biz ? { headers: biz.cookie } : {})
const accept = (id: string, token: string) =>
  http('POST', `${cfg.appUrl}/api/public/quotes/${id}/accept`, { body: { token, details: { timing: 'asap', timingNote: '', address: '12 Oak Lane, Ballwin, MO 63021', phone: '(555) 201-1212' } } })
const feedbackRows = (quoteId: string) => sb.select('quote_feedback', `quote_id=eq.${quoteId}&select=id,status,feedback_type&order=created_at.asc`)
const code = (res: { json: { error?: { code?: string } } | null }) => res.json?.error?.code
/** Replace the token the way a route does: quote_token_hash and nothing about the old one */
async function replaceToken(id: string, extra: Record<string, unknown> = {}) {
  const token = newToken()
  await patchRow('quotes', `id=eq.${id}`, { quote_token_hash: sha(token), ...extra })
  return token
}
const noDuplicates = (list: string[]) => new Set(list).size === list.length
const customerOf = (n: string) => ({ name: n, email: `${n.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-1212' })

const a = await business('T157 Doors')
const b = await business('T157 Rival')
const svcA = await doorService(a)
const svcB = await doorService(b)

// ====================================================================
section('1. The business always gets its emails')
// ====================================================================
const tenantRow = async (id: string) => (await sb.select('tenants', `id=eq.${id}&select=notification_email,is_demo`))[0] as { notification_email: string | null; is_demo: boolean }
const before = await tenantRow(a.tenantId)
check('a new business has no notification email in Settings (the default)', before.notification_email === null)
check('setting empty: the web rule gives the first user’s account email', (await resolveBusinessEmail(adminClient, a.tenantId)) === a.email)
check('…and the worker rule gives the same address', (await loadBusinessEmail(adminClient, a.tenantId, before)) === a.email)
const office = `office+t157-${shortId()}@hardcore.test`
expectOk('set notification email', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { notificationEmail: office } }))
const withSetting = await tenantRow(a.tenantId)
check('setting filled: both rules give the Settings address', (await resolveBusinessEmail(adminClient, a.tenantId)) === office && (await loadBusinessEmail(adminClient, a.tenantId, withSetting)) === office)
check('…another business still gets its own', (await resolveBusinessEmail(adminClient, b.tenantId)) === b.email)
expectOk('clear notification email', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: a.cookie, body: { notificationEmail: '' } }))
check('setting cleared: back to the account email', (await resolveBusinessEmail(adminClient, a.tenantId)) === a.email)
const demo = (await sb.select('tenants', 'is_demo=eq.true&select=id,notification_email,is_demo&limit=1'))[0] as { id: string; notification_email: string | null; is_demo: boolean } | undefined
if (demo) {
  check('the demo business emails no one (web and worker rule)', (await resolveBusinessEmail(adminClient, demo.id)) === null && (await loadBusinessEmail(adminClient, demo.id, demo)) === undefined)
} else {
  notChecked.push('The demo business emailing no one, live: there is no demo tenant in this database (run scripts/seed-demo-tenant.mts). The rule is unit-tested.')
}

// ====================================================================
section('2. A button only shows when it will work  ·  3. A link keeps working')
// ====================================================================
const q1 = await submit(a, svcA, customerOf('Jordan First'))
check('a default-service quote waits for approval, shown to the customer', q1.view.status === 'pending_review', q1.view.status)
const first = q1.token // the link in the customer's first email
const d0 = await detail(a, q1.id)
check('the quote’s own load says SMS is not connected', d0?.smsActive === false, d0?.smsActive)

// awaiting approval: none of the customer-link actions work, and none are offered
const pend = { resend: await resend(a, q1.id), link: await copyLink(a, q1.id), pdfPost: await pdfPost(a, q1.id), pdfGet: await pdfGet(a, q1.id), text: await textLink(a, q1.id) }
const pendRule = quoteActions('pending_review', { hasEmail: true, smsActive: false })
check('awaiting approval: Send again, Copy link, PDF and Text link are refused (INVALID_STATUS)',
  [pend.resend, pend.link, pend.pdfPost, pend.pdfGet, pend.text].every((r) => r.status === 400 && code(r) === 'INVALID_STATUS'),
  Object.fromEntries(Object.entries(pend).map(([k, r]) => [k, `${r.status} ${code(r)}`])))
check('…and the rule the page reads offers none of them', !pendRule.sendAgain && !pendRule.copyLink && !pendRule.downloadPdf && !pendRule.textLink && pendRule.edit)

expectOk('approve', await approve(a, q1.id))
const r1 = await row(q1.id)
check('approving kept the first link (trigger): it is in link_token_hashes', r1.status === 'sent' && r1.link_token_hashes.includes(sha(first)) && !r1.link_token_hashes.includes(r1.quote_token_hash), r1.link_token_hashes.length)
check('the first link opens the confirmed quote', (await open(q1.id, first)).json?.review?.state === 'quote')

// sent: every action passes its status rule
const sentRule = quoteActions('sent', { hasEmail: true, smsActive: false })
const linkSent = await copyLink(a, q1.id)
const copied = linkSent.ok ? new URL(linkSent.json.quoteViewUrl).searchParams.get('token')! : ''
check('sent: Copy link gives a link, and the rule offers it', linkSent.ok && sentRule.copyLink && Boolean(copied))
check('…the copied link opens the quote', await opens(q1.id, copied))
check('…and the first link still opens it after a copied link', await opens(q1.id, first))
const pdfSent = { post: await pdfPost(a, q1.id), get: await pdfGet(a, q1.id) }
check('sent: Download PDF passes the status rule (what stops it locally is storage/PDF setup, not the status)', code(pdfSent.post) !== 'INVALID_STATUS' && code(pdfSent.get) !== 'INVALID_STATUS' && sentRule.downloadPdf, { post: `${pdfSent.post.status} ${code(pdfSent.post) ?? 'ok'}`, get: `${pdfSent.get.status} ${code(pdfSent.get) ?? 'ok'}` })
const textOff = await textLink(a, q1.id)
check('sent, no SMS number: Text link is refused (SMS_NOT_CONFIGURED) and the rule hides it', textOff.status === 400 && code(textOff) === 'SMS_NOT_CONFIGURED' && !sentRule.textLink)

// Send again
const beforeResend = await row(q1.id)
const re = await resend(a, q1.id)
let emailOn = false
if (re.ok) {
  emailOn = true
  const after = await row(q1.id)
  check('Send again sent the email and issued a new link', after.quote_token_hash !== beforeResend.quote_token_hash && after.status === 'sent')
} else {
  const after = await row(q1.id)
  check('Send again passes its own checks and stops only at "email not configured", having written nothing',
    re.status === 503 && code(re) === 'EMAIL_NOT_CONFIGURED' && after.quote_token_hash === beforeResend.quote_token_hash && after.status === beforeResend.status && after.sent_at === beforeResend.sent_at, `${re.status} ${code(re)}`)
  await replaceToken(q1.id, { status: statusAfterResend('sent'), sent_at: new Date().toISOString() })
  notChecked.push('"Send again" delivering the email, its new link, and a revised quote staying revised through that route: email is not configured here, so the route stops at EMAIL_NOT_CONFIGURED after its own checks. The token was replaced the way the route does it; the rule is unit-tested, and "Text link" proves the same status rule through a real route below.')
}
check('the first link still opens the quote after a re-send', await opens(q1.id, first))
check('…and so does the copied link', await opens(q1.id, copied))

// The 3-day reminder
await patchRow('quotes', `id=eq.${q1.id}`, { sent_at: new Date(Date.now() - 4 * 86400_000).toISOString() })
const beforeReminder = await row(q1.id)
const cron = await http('GET', `${cfg.appUrl}/api/cron/lifecycle`, { headers: { Authorization: `Bearer ${CRON}` } })
const afterCron = await row(q1.id)
if (cron.ok && afterCron.reminder_sent_at) {
  check('the daily cron sent the reminder with a new link', afterCron.quote_token_hash !== beforeReminder.quote_token_hash)
} else {
  await replaceToken(q1.id, { reminder_sent_at: new Date().toISOString() })
  notChecked.push(cron.ok
    ? 'The reminder email itself: the cron skips reminders without Postmark. The token was replaced the way the cron does it (quote_token_hash + reminder_sent_at).'
    : `The reminder through the cron: it answered ${cron.status} (start the web app with CRON_SECRET=${CRON}). The token was replaced the way the cron does it.`)
}
const r2 = await row(q1.id)
check('the first link still opens the quote after a reminder', await opens(q1.id, first))
check('…and so does the copied link', await opens(q1.id, copied))
check('link_token_hashes: no duplicates, never the current link, newest first', noDuplicates(r2.link_token_hashes) && !r2.link_token_hashes.includes(r2.quote_token_hash) && r2.link_token_hashes[0] === beforeReminderHash(afterCron, beforeReminder), r2.link_token_hashes.length)
function beforeReminderHash(after: { quote_token_hash: string; reminder_sent_at: string | null }, beforeRow: { quote_token_hash: string }) {
  // whichever link the reminder replaced is now the newest entry
  return after.reminder_sent_at ? beforeRow.quote_token_hash : after.quote_token_hash
}

// a token for another quote, or nonsense, opens nothing
const qb = await submit(b, svcB, customerOf('Rival Customer'))
check('another quote’s link, and a made-up one, open nothing (404)', (await open(q1.id, qb.token)).status === 404 && (await open(q1.id, newToken())).status === 404 && (await open(qb.id, first)).status === 404)

// expiry is unchanged: token_expires_at covers every link
const keepExpiry = r2.token_expires_at
await patchRow('quotes', `id=eq.${q1.id}`, { token_expires_at: new Date(Date.now() - 60_000).toISOString() })
const expiredOld = await open(q1.id, first)
const expiredCopied = await open(q1.id, copied)
check('once the quote’s links expire, an earlier link expires with them (410, not 404)', expiredOld.status === 410 && expiredCopied.status === 410 && code(expiredOld) === 'TOKEN_EXPIRED', [expiredOld.status, expiredCopied.status])
await patchRow('quotes', `id=eq.${q1.id}`, { token_expires_at: keepExpiry })
check('…and they open again when the expiry is restored', await opens(q1.id, first))

// the newest 10 are kept
const many: string[] = []
for (let i = 0; i < 12; i++) many.push(new URL(expectOk('copy link', await copyLink(a, q1.id)).quoteViewUrl).searchParams.get('token')!)
const r3 = await row(q1.id)
check('after 12 more copied links the list holds exactly the newest 10, no duplicates', r3.link_token_hashes.length === 10 && noDuplicates(r3.link_token_hashes) && r3.link_token_hashes[0] === sha(many[10]!) && r3.quote_token_hash === sha(many[11]!))
check('…the current link and the 10 before it open; the 11th-oldest has aged out', (await opens(q1.id, many[1]!)) && (await opens(q1.id, many[11]!)) && !(await opens(q1.id, many[0]!)))
// T-146 keeps the link from before approval on its own (previous_token_hash), outside the list of 10
check('…and the first link, the one in the customer’s first email, still opens', r3.previous_token_hash === sha(first) && (await opens(q1.id, first)))

// no email address: Send again is refused before anything changes; the link still works
const q2 = await submit(a, svcA, customerOf('Pat Phoneonly'))
expectOk('approve q2', await approve(a, q2.id))
const q2customer = (await row(q2.id, 'customer_json')).customer_json
await patchRow('quotes', `id=eq.${q2.id}`, { customer_json: { ...q2customer, email: null } })
const q2before = await row(q2.id)
const noEmail = await resend(a, q2.id)
const q2after = await row(q2.id)
check('a customer with no email: Send again is refused (NO_EMAIL) and nothing changed', noEmail.status === 400 && code(noEmail) === 'NO_EMAIL' && q2after.quote_token_hash === q2before.quote_token_hash && q2after.status === q2before.status, `${noEmail.status} ${code(noEmail)}`)
check('…the rule hides Send again for them, and Copy link still works', !quoteActions('sent', { hasEmail: false, smsActive: false }).sendAgain && (await copyLink(a, q2.id)).ok)
check('…and the message does not point at Text link', !/text/i.test(noEmail.json?.error?.message ?? ''), noEmail.json?.error?.message)

// tenant isolation on the action routes
const cross = { resend: await resend(b, q1.id), link: await copyLink(b, q1.id), pdf: await pdfPost(b, q1.id), text: await textLink(b, q1.id) }
check('another business can do none of this to the quote (404)', Object.values(cross).every((r) => r.status === 404) && (await row(q1.id)).quote_token_hash === r3.quote_token_hash, Object.fromEntries(Object.entries(cross).map(([k, r]) => [k, r.status])))

// ====================================================================
section('5. Revised stays revised  ·  Text link')
// ====================================================================
const q1row = await row(q1.id, 'version,pricing_json,content_json,status')
const edit1 = await http('PATCH', `${cfg.appUrl}/api/quotes/${q1.id}`, { headers: a.cookie, body: { version: q1row.version, pricing_json: q1row.pricing_json, content_json: { ...q1row.content_json, notes: 'We can start the week after next.' }, sendToCustomer: true } })
check('editing and sending a sent quote makes it revised', edit1.ok && edit1.json?.status === 'revised' && (await row(q1.id)).status === 'revised', edit1.json)
const q1row2 = await row(q1.id, 'version,pricing_json,content_json,status')
const edit2 = await http('PATCH', `${cfg.appUrl}/api/quotes/${q1.id}`, { headers: a.cookie, body: { version: q1row2.version, pricing_json: q1row2.pricing_json, content_json: { ...q1row2.content_json, notes: 'We can start next Monday.' }, sendToCustomer: true } })
check('editing and sending it again keeps it revised (it used to flip back to sent)', edit2.ok && edit2.json?.status === 'revised' && (await row(q1.id)).status === 'revised', edit2.json)
check('a link from before both edits still opens the quote', await opens(q1.id, many[5]!))
const revisedRule = quoteActions('revised', { hasEmail: true, smsActive: false })
const revisedResend = await resend(a, q1.id)
check('revised: Send again and Copy link pass their rules (they used to be refused or hidden)', revisedRule.sendAgain && revisedRule.copyLink && code(revisedResend) !== 'INVALID_STATUS' && (await copyLink(a, q1.id)).ok, `${revisedResend.status} ${code(revisedResend) ?? 'ok'}`)

// SMS connected: the quote's load says so, and texting keeps a revised quote revised
const smsMode = (await http('GET', `${cfg.appUrl}/api/sms/config`, { headers: a.cookie })).json?.setup?.testMode === true
await sb.insert('sms_configs', { tenant_id: a.tenantId, phone_number: `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, is_active: true })
check('with an active SMS number the quote’s load says SMS is connected', (await detail(a, q1.id))?.smsActive === true && (await detail(b, qb.id))?.smsActive === false)
if (smsMode) {
  const beforeText = await row(q1.id)
  const texted = await textLink(a, q1.id)
  const afterText = await row(q1.id)
  check('Text link (test mode, nothing sent) issues a new link and keeps the quote revised', texted.ok && texted.json?.test === true && afterText.quote_token_hash !== beforeText.quote_token_hash && afterText.status === 'revised', texted.json)
  check('…and the links the customer already has still open it', (await opens(q1.id, many[11]!)) && afterText.link_token_hashes[0] === beforeText.quote_token_hash)
} else {
  notChecked.push('Text link through the SMS route: Twilio is configured here, so the script does not send a real text.')
}

// ====================================================================
section('4. A customer question can be closed and never blocks the customer')
// ====================================================================
const q3 = await submit(a, svcA, customerOf('Morgan Question'))
expectOk('approve q3', await approve(a, q3.id))
await view(q3.id, q3.token)
const asked = await ask(q3.id, q3.token, 'Does this include taking the old door away?')
const v3 = (await open(q3.id, q3.token)).json
check('a question is saved; the page is told it is open', asked.ok && v3?.status === 'feedback_received' && v3?.questionPending === true, { status: v3?.status, questionPending: v3?.questionPending })
check('…and Accept stays available to the customer', v3?.acceptQuoteEnabled === true)
const second = await ask(q3.id, q3.token, 'And one more thing?')
check('a second question while one is open stays off', second.status === 400 && (await feedbackRows(q3.id)).length === 1, second.status)
const fb3 = (await feedbackRows(q3.id))[0] as { id: string; status: string }
const d3 = await detail(a, q3.id)
check('the business sees one pending question', d3?.feedback?.length === 1 && d3.feedback[0].status === 'pending' && d3.quote.status === 'feedback_received')

// tenant scope and auth on the new route
const rivalPress = await answered(b, q3.id, fb3.id)
const anon = await answered(null, q3.id, fb3.id)
const wrongQuote = await answered(a, q2.id, fb3.id)
check('mark as answered: another business 404, signed out 401, the wrong quote 404; nothing changed', rivalPress.status === 404 && anon.status === 401 && wrongQuote.status === 404 && (await feedbackRows(q3.id))[0].status === 'pending' && (await row(q3.id)).status === 'feedback_received', [rivalPress.status, anon.status, wrongQuote.status])

const done = await answered(a, q3.id, fb3.id)
check('mark as answered is saved: the question is acknowledged and the quote is back to viewed', done.ok && done.json?.feedbackStatus === 'acknowledged' && done.json?.quoteStatus === 'viewed' && done.json?.pendingLeft === 0, done.json)
const d3reload = await detail(a, q3.id) // what a reload of the quote page reads
check('…it survives a reload (it used to come back)', d3reload?.feedback?.[0]?.status === 'acknowledged' && d3reload.quote.status === 'viewed')
check('…pressing it again changes nothing', (await answered(a, q3.id, fb3.id)).json?.quoteStatus === 'viewed')
const v3after = (await open(q3.id, q3.token)).json
check('the customer page is no longer told a question is open', v3after?.status === 'viewed' && v3after?.questionPending === undefined)
const acc3 = await accept(q3.id, q3.token)
check('the customer can then accept', acc3.ok && acc3.json?.status === 'accepted' && (await row(q3.id)).status === 'accepted', acc3.json)

// accepted: what still works
const accRule = quoteActions('accepted', { hasEmail: true, smsActive: true })
const accResend = await resend(a, q3.id)
const accEdit = await http('PATCH', `${cfg.appUrl}/api/quotes/${q3.id}`, { headers: a.cookie, body: { version: (await row(q3.id)).version, pricing_json: (await row(q3.id, 'pricing_json')).pricing_json, content_json: {} } })
const accText = await textLink(a, q3.id)
check('accepted: Send again, Text link and Edit are refused, and the rule hides them (Send used to show and always fail)', accResend.status === 400 && code(accResend) === 'INVALID_STATUS' && accText.status === 400 && accEdit.status === 400 && !accRule.sendAgain && !accRule.textLink && !accRule.edit)
check('accepted: Copy link still works and the rule shows it', (await copyLink(a, q3.id)).ok && accRule.copyLink && accRule.downloadPdf)

// a question never blocks accepting
const q4 = await submit(a, svcA, customerOf('Riley Decides'))
expectOk('approve q4', await approve(a, q4.id))
await ask(q4.id, q4.token, 'Can you do Saturdays?')
const acc4 = await accept(q4.id, q4.token)
check('with the question still open the customer can accept', acc4.ok && (await row(q4.id)).status === 'accepted', acc4.json ?? acc4.status)

// declining with a question open
const q4b = await submit(a, svcA, customerOf('Devon Declines'))
expectOk('approve q4b', await approve(a, q4b.id))
await ask(q4b.id, q4b.token, 'Is the price fixed?')
const dec = await http('POST', `${cfg.appUrl}/api/public/quotes/${q4b.id}/decline`, { body: { token: q4b.token } })
check('…or decline', dec.ok && (await row(q4b.id)).status === 'declined', dec.json ?? dec.status)

// edit and send resolves every pending question
const q5 = await submit(a, svcA, customerOf('Casey Twice'))
expectOk('approve q5', await approve(a, q5.id))
await ask(q5.id, q5.token, 'Do you remove the old tracks?')
// an old review request, from when customers could still send them
await sb.insert('quote_feedback', { quote_id: q5.id, tenant_id: a.tenantId, feedback_type: 'approval_request', feedback_text: null, status: 'pending' })
const fbs5 = (await feedbackRows(q5.id)) as Array<{ id: string; status: string; feedback_type: string }>
const q5row = await row(q5.id, 'version,pricing_json,content_json')
const edit5 = await http('PATCH', `${cfg.appUrl}/api/quotes/${q5.id}`, { headers: a.cookie, body: { version: q5row.version, pricing_json: q5row.pricing_json, content_json: { ...q5row.content_json, notes: 'Old tracks are removed and taken away.' }, sendToCustomer: true, feedbackId: fbs5[0]!.id } })
const after5 = (await feedbackRows(q5.id)) as Array<{ status: string }>
check('edit and send resolves every pending question on the quote, not only the linked one', edit5.ok && fbs5.length === 2 && after5.every((f) => f.status === 'resolved') && (await row(q5.id)).status === 'revised', after5.map((f) => f.status))
check('…and the customer page is told nothing is open', (await open(q5.id, q5.token)).json?.questionPending === undefined)
// an old review request gets the same button
const q5b = await submit(a, svcA, customerOf('Avery Review'))
expectOk('approve q5b', await approve(a, q5b.id))
const oldReview = await sb.insert('quote_feedback', { quote_id: q5b.id, tenant_id: a.tenantId, feedback_type: 'approval_request', feedback_text: null, status: 'pending' })
await patchRow('quotes', `id=eq.${q5b.id}`, { status: 'feedback_received' })
const oldDone = await answered(a, q5b.id, oldReview.id as string)
check('an old review request closes with the same button', oldDone.ok && oldDone.json?.quoteStatus === 'viewed' && (await feedbackRows(q5b.id))[0].status === 'acknowledged', oldDone.json)

// an estimate shown before approval: the question never unlocks Accept
const q6 = await submit(a, svcA, customerOf('Sam Early'))
const asked6 = await ask(q6.id, q6.token, 'How soon could you come?')
const v6 = (await open(q6.id, q6.token)).json
const acc6 = await accept(q6.id, q6.token)
check('before approval a question keeps the estimate waiting and Accept locked', asked6.ok && v6?.status === 'pending_review' && v6?.questionPending === true && v6?.acceptQuoteEnabled === false && acc6.status === 400 && (await row(q6.id)).status === 'pending_review', { status: v6?.status, accept: acc6.status })

// ====================================================================
section('6. Money is always rounded')
// ====================================================================
const c = await business('T157 Decorating', 'GB')
const svcC = await paintService(c)
const q7 = await submit(c, svcC, customerOf('Harper Walls'), [
  { fieldId: '_project_description', value: 'Front and side walls of the house repainted, plus the window sills.' },
  { fieldId: 'wall_area', value: 34.6 },
  { fieldId: 'trim_length', value: 12.7 },
], 'SW1A 1AA')
type Line = { label: string; amount: number }
type Pricing = { subtotal: number; taxAmount: number; total: number; breakdown: Line[] }
const p7 = (await row(q7.id, 'pricing_json,pricing_trace_json,status,version,content_json')) as { pricing_json: Pricing; pricing_trace_json: { trace?: Array<{ type: string; amount: number; runningTotal: number }> }; status: string; version: number; content_json: Record<string, unknown> }
const pricing7 = p7.pricing_json
const walls = pricing7.breakdown.find((l) => l.label.startsWith('Exterior walls'))
const isTwoDp = (n: number) => n === roundMoney(n) && String(n).replace(/^-?\d+\.?/, '').length <= 2
const lineSum = (lines: Line[]) => roundMoney(lines.reduce((s, l) => s + l.amount, 0))
check('18 x 34.6 in plain floating point is not 622.8 (what used to be stored)', 18 * 34.6 !== 622.8, 18 * 34.6)
check('the 34.6 x 18 line stores exactly 622.8', walls?.amount === 622.8, walls)
check('the engine’s label format is unchanged', walls?.label === 'Exterior walls  £18 x 34.6(Sqm)' && splitLabelMath(walls.label)[1] === '£18 × 34.6 Sqm', walls?.label)
check('every line has at most 2 decimals', pricing7.breakdown.length >= 2 && pricing7.breakdown.every((l) => isTwoDp(l.amount)), pricing7.breakdown.map((l) => l.amount))
check('the lines add up to the subtotal', lineSum(pricing7.breakdown) === pricing7.subtotal, { lines: lineSum(pricing7.breakdown), subtotal: pricing7.subtotal })
check('tax and total as before: 20% of the subtotal, total = subtotal + tax', pricing7.taxAmount === Math.round(pricing7.subtotal * 0.2 * 100) / 100 && pricing7.total === Math.round((pricing7.subtotal + pricing7.taxAmount) * 100) / 100, { tax: pricing7.taxAmount, total: pricing7.total })
const traceLines = (p7.pricing_trace_json.trace ?? []).filter((s) => s.type !== 'tax')
check('the pricing trace carries the same rounded amounts', traceLines.length === pricing7.breakdown.length && traceLines.every((s) => isTwoDp(s.amount) && isTwoDp(s.runningTotal)), traceLines.map((s) => s.amount))
const pub7 = (await open(q7.id, q7.token)).json
if (pub7?.pricing?.breakdown?.length) {
  check('the customer is shown the rounded lines', pub7.pricing.breakdown.every((l: Line) => isTwoDp(l.amount)) && pub7.pricing.subtotal === pricing7.subtotal)
}

// the editor's save: rounded, and stale maths dropped only from an untouched generated label
const trim = pricing7.breakdown.find((l) => l.label.startsWith('Trim and sills'))!
const others = pricing7.breakdown.filter((l) => l !== walls && l !== trim)
const save1 = await http('PATCH', `${cfg.appUrl}/api/quotes/${q7.id}`, {
  headers: c.cookie,
  body: {
    version: p7.version,
    content_json: p7.content_json,
    pricing_json: {
      ...pricing7,
      breakdown: [
        { ...walls!, amount: 600.005 }, // amount changed, label left alone
        trim, // untouched
        ...others,
        { label: 'Extra coat  £5 x 10(Sqm)', amount: 55.555 }, // typed by the business: looks like maths, stays as typed
      ],
    },
  },
})
const s1 = (await row(q7.id, 'pricing_json,version')) as { pricing_json: Pricing; version: number }
const b1 = s1.pricing_json.breakdown
check('saving an edit rounds each amount (600.005 → 600.01, 55.555 → 55.56)', save1.ok && b1[0]!.amount === 600.01 && b1[b1.length - 1]!.amount === 55.56, b1.map((l) => l.amount))
check('the changed line lost its generated maths', b1[0]!.label === 'Exterior walls', b1[0]!.label)
check('the untouched line kept its maths', b1[1]!.label === trim.label && b1[1]!.amount === trim.amount, b1[1]!.label)
check('text the business typed is not rewritten, even when it looks like maths', b1[b1.length - 1]!.label === 'Extra coat  £5 x 10(Sqm)')
check('the saved lines add up to the saved subtotal', lineSum(b1) === s1.pricing_json.subtotal && s1.pricing_json.total === Math.round((s1.pricing_json.subtotal + s1.pricing_json.taxAmount) * 100) / 100, { lines: lineSum(b1), subtotal: s1.pricing_json.subtotal })

// a quote stored before the engine rounded: no data migration, the next save cleans it
const raw: Line[] = [{ label: 'Exterior walls  £18 x 34.6(Sqm)', amount: 18 * 34.6 }, { label: 'Trim and sills  £7.35 x 12.7(M)', amount: 0.1 + 0.2 }]
await patchRow('quotes', `id=eq.${q7.id}`, { pricing_json: { ...s1.pricing_json, breakdown: raw, subtotal: raw[0]!.amount + raw[1]!.amount } })
const stored = (await row(q7.id, 'pricing_json')) as { pricing_json: Pricing }
check('(an old quote is stored unrounded: 622.8000000000001)', stored.pricing_json.breakdown[0]!.amount !== 622.8, stored.pricing_json.breakdown[0]!.amount)
const save2 = await http('PATCH', `${cfg.appUrl}/api/quotes/${q7.id}`, { headers: c.cookie, body: { version: s1.version, content_json: p7.content_json, pricing_json: stored.pricing_json } })
const s2 = (await row(q7.id, 'pricing_json')) as { pricing_json: Pricing }
check('saving it unchanged stores 622.8 and 0.3, and the subtotal 623.1', save2.ok && s2.pricing_json.breakdown[0]!.amount === 622.8 && s2.pricing_json.breakdown[1]!.amount === 0.3 && s2.pricing_json.subtotal === 623.1, { lines: s2.pricing_json.breakdown.map((l) => l.amount), subtotal: s2.pricing_json.subtotal })
check('…and its labels keep their maths (only float dust was removed, the amount was not changed)', s2.pricing_json.breakdown[0]!.label === raw[0]!.label && s2.pricing_json.breakdown[1]!.label === raw[1]!.label)

// ====================================================================
// The pages (needs PLAYWRIGHT_DIR)
// ====================================================================
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The pages themselves (which buttons show, errors on the page instead of alert(), "Message sent" after a reload, the editor’s amount boxes): set PLAYWRIGHT_DIR to run the browser pass. The rules behind them are checked above and in the unit tests.')
} else {
  section('The pages (browser)')
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const origin = new URL(cfg.appUrl).origin
  const contextFor = async (biz: Biz | null) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    if (biz) {
      await ctx.addCookies(biz.cookieHeader.split('; ').map((pair) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      }))
    }
    return ctx
  }
  type Page = Awaited<ReturnType<Awaited<ReturnType<typeof contextFor>>['newPage']>>
  const dialogs: string[] = []
  const watch = (p: Page) => p.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss() })
  const button = (p: Page, name: string | RegExp) => p.getByRole('button', { name, exact: typeof name === 'string' })
  const shown = async (p: Page, name: string | RegExp) => (await button(p, name).count()) > 0
  const dash = async (ctx: Awaited<ReturnType<typeof contextFor>>, id: string) => {
    const p = await ctx.newPage()
    watch(p)
    await p.goto(`${cfg.appUrl}/app/quotes/${id}`, { waitUntil: 'networkidle' })
    await p.getByTestId('quote-tracker').waitFor({ timeout: 30_000 }) // T-158: the tracker replaced the plain timeline
    return p
  }
  const buttonsOn = async (p: Page) => ({
    edit: await shown(p, 'Edit'), sendAgain: await shown(p, 'Send again'), send: await shown(p, 'Send'), copyLink: await shown(p, 'Copy link'),
    textLink: await shown(p, 'Text link'), approve: await shown(p, 'Approve & send'),
  })

  // ---- dashboard quote page, business B (no SMS number) ----
  const ctxB = await contextFor(b)
  const pPending = await dash(ctxB, qb.id)
  const onPending = await buttonsOn(pPending)
  check('page, awaiting approval: Approve & send and Edit only', onPending.approve && onPending.edit && !onPending.sendAgain && !onPending.send && !onPending.copyLink && !onPending.textLink, onPending)
  await button(pPending, 'Approve & send').click()
  await pPending.getByTestId('action-note').waitFor({ timeout: 30_000 })
  const approveNote = await pPending.getByTestId('action-note').innerText()
  await button(pPending, 'Copy link').waitFor({ timeout: 30_000 }) // the page re-reads the quote after approving
  const onSent = await buttonsOn(pPending)
  check('page, sent, no SMS number: Send again, Copy link and Edit; no "Send", no Text link', onSent.sendAgain && onSent.copyLink && onSent.edit && !onSent.send && !onSent.textLink && !onSent.approve, onSent)
  if (/No email went out/.test(approveNote)) {
    check('page: "Approved. No email went out" does not mention Text link when it is hidden', !/text link/i.test(approveNote) && /Copy link/.test(approveNote), approveNote)
  } else {
    check('page: approving says the customer was sent it', /Sent to the customer/.test(approveNote), approveNote)
  }

  // Send again: any failure shows on the page, never in an alert
  await button(pPending, 'Send again').click()
  await pPending.waitForFunction(() => /again|configured|Could not/i.test(document.querySelector('[data-testid="action-note"]')?.textContent ?? ''), null, { timeout: 30_000 })
  const resendNote = pPending.getByTestId('action-note')
  const resendText = await resendNote.innerText()
  if (emailOn) {
    check('page: Send again confirms on the page', /Sent to the customer again/.test(resendText), resendText)
  } else {
    check('page: a Send again failure shows on the page (role alert), not in a browser alert()', (await resendNote.getAttribute('role')) === 'alert' && /not configured/i.test(resendText) && dialogs.length === 0, { text: resendText, dialogs })
  }

  // Copy link
  await button(pPending, 'Copy link').click()
  await pPending.waitForFunction(() => /Link copied|Copy this link/.test(document.querySelector('[data-testid="action-note"]')?.textContent ?? ''), null, { timeout: 30_000 })
  const copiedText = await pPending.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  const fromNote = /https?:\/\/\S+/.exec(await pPending.getByTestId('action-note').innerText())?.[0] ?? ''
  const pageLink = copiedText || fromNote
  const pageToken = pageLink ? new URL(pageLink).searchParams.get('token') ?? '' : ''
  check('page: Copy link puts a working link on the clipboard', pageLink.includes(`/q/${qb.id}?token=`) && (await opens(qb.id, pageToken)), pageLink.replace(/token=.*/, 'token=…'))
  check('page: the customer’s first link still opens the quote after approve and copy', await opens(qb.id, qb.token))
  await pPending.close()

  // ---- business A (SMS number active) ----
  const ctxA = await contextFor(a)
  const pRevised = await dash(ctxA, q1.id)
  const onRevised = await buttonsOn(pRevised)
  check('page, revised, SMS connected: Send again, Copy link, Text link and Edit', onRevised.sendAgain && onRevised.copyLink && onRevised.textLink && onRevised.edit && !onRevised.send, onRevised)
  await pRevised.close()
  const pAccepted = await dash(ctxA, q3.id)
  const onAccepted = await buttonsOn(pAccepted)
  check('page, accepted: Copy link only (Send used to show here and always fail)', onAccepted.copyLink && !onAccepted.sendAgain && !onAccepted.send && !onAccepted.edit && !onAccepted.textLink && !onAccepted.approve, onAccepted)
  await pAccepted.close()
  const pNoEmail = await dash(ctxA, q2.id)
  const onNoEmail = await buttonsOn(pNoEmail)
  check('page, a customer with no email: no Send again, Copy link is there', !onNoEmail.sendAgain && onNoEmail.copyLink, onNoEmail)
  await pNoEmail.close()

  // ---- the customer page and the question banner ----
  const q8 = await submit(a, svcA, customerOf('Quinn Browser'))
  expectOk('approve q8', await approve(a, q8.id))
  const ctxCustomer = await contextFor(null)
  const cust = await ctxCustomer.newPage()
  watch(cust)
  const custUrl = `${cfg.appUrl}/q/${q8.id}?token=${q8.token}`
  const custState = async () => {
    await cust.getByText('Price breakdown').first().waitFor({ timeout: 30_000 })
    return {
      // T-158: q8 is approved, so its buttons say "quote" (they said "estimate")
      accept: await shown(cust, /Accept this quote/), ask: await shown(cust, 'Ask a question'),
      decline: await shown(cust, /Decline this quote/), sent: (await cust.getByText('Message sent').count()) > 0,
    }
  }
  await cust.goto(custUrl, { waitUntil: 'networkidle' })
  const c0 = await custState()
  check('customer page: Accept, Ask a question and Decline', c0.accept && c0.ask && c0.decline && !c0.sent, c0)
  await button(cust, 'Ask a question').click()
  await cust.getByPlaceholder(/Questions, changes/).fill('Is the old door taken away?')
  await button(cust, 'Send message').click()
  await cust.getByText('Message sent').waitFor({ timeout: 30_000 })
  const c1 = await custState()
  check('customer page, after asking: "Message sent", and Accept and Decline are still there (they used to vanish)', c1.sent && c1.accept && c1.decline && !c1.ask, c1)
  await cust.reload({ waitUntil: 'networkidle' })
  const c2 = await custState()
  check('customer page, after a reload: the same (the note stays, a second question stays off)', c2.sent && c2.accept && c2.decline && !c2.ask, c2)

  // the business closes it on its quote page
  const pQuestion = await dash(ctxA, q8.id)
  const banner = pQuestion.getByText('Customer question', { exact: true })
  check('page: the banner reads "Customer question" with "Mark as answered"', (await banner.count()) === 1 && (await shown(pQuestion, 'Mark as answered')) && (await pQuestion.getByText(/Customer Feedback|Acknowledge/).count()) === 0)
  await button(pQuestion, 'Mark as answered').click()
  await banner.waitFor({ state: 'detached', timeout: 30_000 })
  await pQuestion.reload({ waitUntil: 'networkidle' })
  await pQuestion.getByTestId('quote-tracker').waitFor({ timeout: 30_000 }) // T-158: the tracker replaced the plain timeline
  // T-158: a viewed quote reads "Waiting for customer … They opened it <when>" (it used to read "Viewed")
  check('page: after a reload the question is still closed and the quote reads as viewed again', (await pQuestion.getByText('Customer question', { exact: true }).count()) === 0 && !(await shown(pQuestion, 'Mark as answered')) && (await pQuestion.getByTestId('turn-label').first().innerText()) === 'Waiting for customer' && /They opened it/.test(await pQuestion.getByTestId('next-step-sentence').innerText()) && (await row(q8.id)).status === 'viewed')
  await pQuestion.close()
  await cust.reload({ waitUntil: 'networkidle' })
  const c3 = await custState()
  check('customer page, once answered: the note is gone and a new question can be asked', !c3.sent && c3.accept && c3.ask && c3.decline, c3)
  await button(cust, /Accept this quote/).click()
  check('customer page: Accept opens the next-step form', (await cust.getByText(/When would you like|When suits/i).count()) > 0 || (await cust.locator('form, [data-testid="accept-details"]').count()) > 0)

  // an estimate shown before approval: a question must not unlock Accept
  const q9 = await submit(a, svcA, customerOf('Early Browser'))
  const early = await ctxCustomer.newPage()
  await early.goto(`${cfg.appUrl}/q/${q9.id}?token=${q9.token}`, { waitUntil: 'networkidle' })
  await early.getByText('Price breakdown').first().waitFor({ timeout: 30_000 })
  await button(early, 'Ask a question').click()
  await early.getByPlaceholder(/Questions, changes/).fill('How soon could you come?')
  await button(early, 'Send message').click()
  await early.getByText('Message sent').waitFor({ timeout: 30_000 })
  const e1 = { accept: await shown(early, /Accept this estimate/), ask: await shown(early, 'Ask a question'), note: (await early.getByText(/You can accept once/).count()) > 0 }
  await early.reload({ waitUntil: 'networkidle' })
  await early.getByText('Price breakdown').first().waitFor({ timeout: 30_000 })
  const e2 = { accept: await shown(early, /Accept this estimate/), ask: await shown(early, 'Ask a question'), sent: (await early.getByText('Message sent').count()) > 0, note: (await early.getByText(/You can accept once/).count()) > 0 }
  check('customer page, estimate before approval: a question never shows Accept, before or after a reload', !e1.accept && !e1.ask && e1.note && !e2.accept && !e2.ask && e2.sent && e2.note, { e1, e2 })

  // ---- the editor shows 2 decimals for a quote stored unrounded ----
  await patchRow('quotes', `id=eq.${q7.id}`, { pricing_json: { ...s2.pricing_json, breakdown: raw, subtotal: raw[0]!.amount + raw[1]!.amount } })
  const ctxC = await contextFor(c)
  const pEdit = await dash(ctxC, q7.id)
  const rawOnPage = await pEdit.getByText('622.8000000000001').count()
  await button(pEdit, 'Edit').click()
  await pEdit.getByText('Editing Quote').waitFor({ timeout: 30_000 })
  const amounts = await pEdit.locator('input[type="number"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
  const bodyText = await pEdit.locator('body').innerText()
  check('editor: a quote stored as 622.8000000000001 shows 622.8 and 0.3, subtotal 623.10', amounts[0] === '622.8' && amounts[1] === '0.3' && rawOnPage === 0 && !bodyText.includes('0000000') && bodyText.includes('623.10'), amounts.slice(0, 2))
  // change the amount, leave the label, save: the customer no longer sees the old maths
  await pEdit.locator('input[type="number"]').first().fill('600')
  await pEdit.getByRole('button', { name: 'Save', exact: true }).first().click()
  await pEdit.getByTestId('quote-tracker').waitFor({ timeout: 30_000 }) // T-158: the tracker replaced the plain timeline
  const s3 = (await row(q7.id, 'pricing_json')) as { pricing_json: Pricing }
  check('editor: changing the amount and saving drops that label’s maths; the other line keeps its own', s3.pricing_json.breakdown[0]!.label === 'Exterior walls' && s3.pricing_json.breakdown[0]!.amount === 600 && s3.pricing_json.breakdown[1]!.label === raw[1]!.label && s3.pricing_json.breakdown[1]!.amount === 0.3 && s3.pricing_json.subtotal === 600.3, s3.pricing_json.breakdown)

  // ---- the quotes list uses the same rules ----
  const list = await ctxA.newPage()
  await list.goto(`${cfg.appUrl}/app/quotes`, { waitUntil: 'networkidle' })
  // T-158: the list opens on "Needs you"; these quotes are spread over the tabs
  await list.getByTestId('tab-all').click()
  await list.getByText('Morgan Question').first().waitFor({ timeout: 30_000 })
  // T-158: the actions are words now, on the row's next-step button or in its
  // More menu (they were icons found by title). What is checked is the same:
  // which of Copy link, Download PDF and Send again a row offers.
  const icons = async (customerName: string) => {
    const tr = list.locator('[data-testid="quote-row"]', { hasText: customerName }).first()
    await tr.getByTestId('more-button').click()
    const words = await tr.locator('[data-testid="more-menu"] [role="menuitem"]').allInnerTexts()
    await list.keyboard.press('Escape')
    await tr.getByTestId('more-menu').waitFor({ state: 'detached' })
    const nextStep = (await tr.getByTestId('next-step-button').count()) ? await tr.getByTestId('next-step-button').innerText() : ''
    const count = (word: string) => words.filter((w) => w === word).length + (nextStep === word ? 1 : 0)
    return { copy: count('Copy link'), pdf: count('Download PDF'), send: count('Send again') }
  }
  const li = { accepted: await icons('Morgan Question'), revised: await icons('Jordan First'), noEmail: await icons('Pat Phoneonly'), pending: await icons('Sam Early') }
  check('quotes list: the same rules for its actions',
    li.accepted.copy === 1 && li.accepted.pdf === 1 && li.accepted.send === 0 &&
    li.revised.copy === 1 && li.revised.pdf === 1 && li.revised.send === 1 &&
    li.noEmail.copy === 1 && li.noEmail.send === 0 &&
    li.pending.copy === 0 && li.pending.pdf === 0 && li.pending.send === 0, li)
  check('no browser alert() fired anywhere', dialogs.length === 0, dialogs)
  await browser.close()
}

// ---------------------------------------------------------------------
notChecked.unshift('That an email actually reaches the business at the resolved address (quote accepted, customer question, quote declined), and the reply-to header on customer emails: nothing is sent without Postmark. The address each sender resolves is checked above against the real rows, and the senders are unit-tested.')
console.log('\nNot checked here (needs real email or a missing local piece):')
for (const line of notChecked) console.log(`  • ${line}`)

if (stalls.length) {
  console.log('\nStalled and retried once (the worker’s pipeline, not this ticket):')
  for (const line of stalls) console.log(`  • ${line}`)
}

saveJson(outDir, 'checks.json', { checks, notChecked, stalls })
const failed = checks.filter((x) => !x.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
