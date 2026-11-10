// T-156 live check: approve a quote from the review email in one tap, no login.
// Run: npx tsx scripts/hardcore-test/verify-t156.mts   (local stack up: supabase with
// migration 37, web, worker)
//
// Locally there is no Postmark, so the worker sends no review email and issues
// no link. The links here are made the way the worker makes them (the shared
// generateApprovalToken, the hash stored, 72 hours); the worker's issuing and
// the email itself are unit-tested (apps/worker/src/__tests__/review-email.test.ts).
// Everything after the email is real: the page, the endpoint, the shared
// approval function, the database trigger and the customer's link.
//
// Garage-door pack service, single steel door = $1,400 (form-priced, fast).
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { generateApprovalToken, approvalLinkExpiry, APPROVAL_LINK_MAX_ATTEMPTS } from '../../packages/shared/src/approval-link'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t156-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patchRow = (table: string, query: string, body: unknown) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=representation' }, body })

async function business(name: string) {
  const id = shortId()
  const email = `owner+t156-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, tenantId, tenantKey: site.tenant_key as string, name }
}
type Biz = Awaited<ReturnType<typeof business>>

const svc = garageDoorsPackUS.services[0]!
async function service(biz: Biz) {
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

async function submit(biz: Biz, serviceId: string, customerName = 'Link Test') {
  const res = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer: { name: customerName, email: 'link-test@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'New garage door please, single steel one' }, { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  }))
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  const view = await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token, view }
}

/** A link made the way the worker makes it */
async function mint(quoteId: string, tenantId: string, over: Record<string, unknown> = {}) {
  const { token, hash } = await generateApprovalToken()
  await sb.insert('quote_approval_tokens', { quote_id: quoteId, tenant_id: tenantId, token_hash: hash, expires_at: approvalLinkExpiry().toISOString(), ...over })
  return { token, hash }
}
const linkRow = async (hash: string) => (await sb.select('quote_approval_tokens', `token_hash=eq.${hash}&select=used_at,invalidated_at,invalidated_reason,attempts`))[0]
const quoteRow = async (id: string, cols = 'status,approved_at,approved_by,approved_via,sent_at,version,quote_token_hash,previous_token_hash') => (await sb.select('quotes', `id=eq.${id}&select=${cols}`))[0]
const page = async (token: string) => {
  const res = await fetch(`${cfg.appUrl}/approve/${token}`, { redirect: 'manual' })
  const html = (await res.text()).replace(/<!-- -->/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
  const outcome = /data-outcome="([a-z_]+)"/.exec(html)?.[1]
  return { status: res.status, html, outcome, headers: res.headers }
}
const press = (token: string, body?: unknown) => http('POST', `${cfg.appUrl}/api/public/approval/${token}`, body ? { body } : {})

const a = await business('T156 Doors')
const b = await business('T156 Rival')
const svcA = await service(a)
const svcB = await service(b)

// ---------- 1. opening the link changes nothing ----------
const q1 = await submit(a, svcA, 'Jordan Link')
check('a default-service quote waits for approval, shown to the customer', q1.view.status === 'pending_review' && (await quoteRow(q1.id, 'review_hold')).review_hold === 'shown')
const l1 = await mint(q1.id, a.tenantId)
const before1 = await quoteRow(q1.id)
const p1 = await page(l1.token)
const p1again = await page(l1.token) // a scanner, then a preview
check('the page opens without logging in (200) and is ready to approve', p1.status === 200 && p1.outcome === 'ready', { status: p1.status, outcome: p1.outcome })
check('…it shows the business, customer, service, price and scope', ['T156 Doors', 'Jordan Link', svc.name, '$1,400.00'].every((s) => p1.html.includes(s)) && p1.html.includes(q1.view.notes?.scopeSummary?.slice(0, 40) ?? '§'))
check('…one "Approve & send" button and the dashboard link', (p1.html.match(/data-testid="approve-button"/g) ?? []).length === 1 && p1.html.includes('Approve & send') && p1.html.includes('Open in dashboard to edit') && p1.html.includes(`href="/app/quotes/${q1.id}"`))
check('…no customer email address on the page', !p1.html.includes('link-test@example.com'))
check('…no-referrer, noindex, no-store', p1.headers.get('referrer-policy') === 'no-referrer' && /noindex/.test(p1.headers.get('x-robots-tag') ?? '') && /no-store/.test(p1.headers.get('cache-control') ?? ''), [p1.headers.get('referrer-policy'), p1.headers.get('x-robots-tag'), p1.headers.get('cache-control')])
check('opening it twice approved nothing and counted nothing', p1again.outcome === 'ready' && JSON.stringify(await quoteRow(q1.id)) === JSON.stringify(before1) && (await linkRow(l1.hash)).attempts === 0)
const getApi = await http('GET', `${cfg.appUrl}/api/public/approval/${l1.token}`)
check('the endpoint has no GET (a fetch can’t approve)', getApi.status === 405 && (await quoteRow(q1.id)).status === 'pending_review', getApi.status)

// ---------- 2. a token can't reach another quote or tenant ----------
const qb = await submit(b, svcB, 'Rival Customer')
const pressWithIds = await press(l1.token, { quoteId: qb.id, tenantId: b.tenantId })
check('pressing approves the link’s own quote (ids in the body are ignored)', pressWithIds.status === 200 && pressWithIds.json?.outcome === 'approved', pressWithIds.json)
check('…the rival’s quote is untouched', (await quoteRow(qb.id)).status === 'pending_review')
const mismatched = await mint(qb.id, a.tenantId) // a row whose tenant doesn't own the quote
const pm = await page(mismatched.token)
const pressMismatch = await press(mismatched.token)
check('a link whose tenant doesn’t own the quote shows and does nothing', pm.outcome === 'not_found' && !pm.html.includes('Rival Customer') && pressMismatch.status === 404 && (await quoteRow(qb.id)).status === 'pending_review', { page: pm.outcome, press: pressMismatch.status })
const bogus = await press('A'.repeat(43))
check('an unknown token: 404, nothing changes', bogus.status === 404 && bogus.json?.outcome === 'not_found')

// ---------- 3. what the press did ----------
const after1 = await quoteRow(q1.id)
check('approved through the shared function: sent, approved_at, by email link, no user', after1.status === 'sent' && Boolean(after1.approved_at) && after1.approved_via === 'email_link' && after1.approved_by === null, after1)
check('the customer has a new link and the old one is kept', after1.previous_token_hash === before1.quote_token_hash && after1.quote_token_hash !== before1.quote_token_hash)
const custView = (await http('GET', `${cfg.appUrl}/api/public/quotes/${q1.id}?token=${encodeURIComponent(q1.token)}&poll=1`)).json
check('the customer’s existing link shows the confirmed quote, Accept enabled', custView?.review?.state === 'quote' && custView?.acceptQuoteEnabled === true, { review: custView?.review, accept: custView?.acceptQuoteEnabled })
check('the link is now used', Boolean((await linkRow(l1.hash)).used_at))
check('the response says the customer has been told (or that no email went out locally)', pressWithIds.json?.title && (pressWithIds.json?.emailed === false ? /No email went out/.test(pressWithIds.json.body) : /has been told/.test(pressWithIds.json.body)), pressWithIds.json?.body)

// a second press: refused, nothing changes
const second = await press(l1.token)
check('a second press: "already approved", nothing changes', second.status === 409 && second.json?.outcome === 'already_approved' && (await quoteRow(q1.id)).sent_at === after1.sent_at, second.json?.outcome)
check('…and the page says so', (await page(l1.token)).outcome === 'already_approved')

// ---------- 4. approving elsewhere ends the link ----------
const q2 = await submit(a, svcA)
const l2 = await mint(q2.id, a.tenantId)
expectOk('dashboard approve', await http('POST', `${cfg.appUrl}/api/quotes/${q2.id}/approve`, { headers: a.cookie }))
check('approving in the dashboard invalidates the link (trigger)', (await linkRow(l2.hash)).invalidated_reason === 'quote_changed' && (await quoteRow(q2.id)).approved_via === 'dashboard')
const p2 = await press(l2.token)
check('…the link then says "already approved" and changes nothing', p2.status === 409 && p2.json?.outcome === 'already_approved' && (await page(l2.token)).outcome === 'already_approved')

// editing ends the link
const q3 = await submit(a, svcA)
const l3 = await mint(q3.id, a.tenantId)
const q3row = await quoteRow(q3.id, 'version,pricing_json,content_json')
expectOk('edit', await http('PATCH', `${cfg.appUrl}/api/quotes/${q3.id}`, { headers: a.cookie, body: { version: q3row.version, pricing_json: q3row.pricing_json, content_json: { ...q3row.content_json, scopeSummary: 'Edited by the owner: new single steel door, fitted.' } } }))
const l3row = await linkRow(l3.hash)
const p3 = await press(l3.token)
check('editing the quote invalidates the link; the press says it expired', l3row.invalidated_reason === 'quote_changed' && p3.status === 410 && p3.json?.outcome === 'link_expired' && (await quoteRow(q3.id)).status === 'pending_review', { reason: l3row.invalidated_reason, status: p3.status })

// a newer email replaces the older link (as the worker does)
const q4 = await submit(a, svcA)
const l4a = await mint(q4.id, a.tenantId)
await patchRow('quote_approval_tokens', `quote_id=eq.${q4.id}&used_at=is.null&invalidated_at=is.null`, { invalidated_at: new Date().toISOString(), invalidated_reason: 'replaced' })
const l4b = await mint(q4.id, a.tenantId)
check('a replaced link says it expired; nothing changes', (await press(l4a.token)).json?.outcome === 'link_expired' && (await quoteRow(q4.id)).status === 'pending_review')
// expired
const l4c = await mint(q4.id, a.tenantId, { expires_at: new Date(Date.now() - 60_000).toISOString() })
const pe = await press(l4c.token)
check('an expired link: 410 "link expired", nothing changes', pe.status === 410 && pe.json?.outcome === 'link_expired' && (await quoteRow(q4.id)).status === 'pending_review')
check('…while the newest link still works', (await page(l4b.token)).outcome === 'ready')

// ---------- 5. no longer awaiting approval ----------
const q5 = await submit(a, svcA)
const l5 = await mint(q5.id, a.tenantId)
await patchRow('quotes', `id=eq.${q5.id}`, { status: 'expired' })
const p5 = await press(l5.token)
check('a quote that expired: "no longer waiting for approval", nothing changes', p5.json?.outcome === 'not_awaiting' && (await page(l5.token)).outcome === 'not_awaiting' && (await quoteRow(q5.id)).status === 'expired', p5.json?.outcome)

// ---------- 6. wording needs editing (T-148) ----------
const q6 = await submit(a, svcA)
const q6content = (await quoteRow(q6.id, 'content_json')).content_json
await patchRow('quotes', `id=eq.${q6.id}`, { content_json: { ...q6content, scopeSummary: 'An exact replacement of your door.' } })
const l6 = await mint(q6.id, a.tenantId)
const p6 = await press(l6.token)
check('WORDING_NEEDS_EDIT: a clear message with the dashboard link, nothing sent', p6.status === 400 && p6.json?.outcome === 'wording_needs_edit' && /Edit the wording/.test(p6.json?.body) && p6.json?.dashboardPath === `/app/quotes/${q6.id}` && (await quoteRow(q6.id)).status === 'pending_review' && !(await linkRow(l6.hash)).used_at, p6.json)

// the per-link limit (counted in the database, so it holds without Redis)
for (let i = (await linkRow(l6.hash)).attempts; i < APPROVAL_LINK_MAX_ATTEMPTS; i++) await press(l6.token)
const capped = await press(l6.token)
check(`after ${APPROVAL_LINK_MAX_ATTEMPTS} presses the link refuses (429 "too many")`, capped.status === 429 && (capped.json?.outcome === 'too_many' || capped.json?.error?.code === 'RATE_LIMITED'), { status: capped.status, outcome: capped.json?.outcome })

// ---------- 7. held at the plan limit, no price ----------
const q7 = await submit(a, svcA)
const q7row = await quoteRow(q7.id, 'content_json,pricing_json')
await patchRow('quotes', `id=eq.${q7.id}`, { content_json: { ...q7row.content_json, limitHold: true }, pricing_json: { ...q7row.pricing_json, total: 0 } })
const l7 = await mint(q7.id, a.tenantId)
const pg7 = await page(l7.token)
const p7 = await press(l7.token)
check('plan-limit hold with no price: "no price yet", no button, nothing changes', pg7.outcome === 'not_priced' && !pg7.html.includes('data-testid="approve-button"') && p7.status === 400 && p7.json?.outcome === 'not_priced' && (await quoteRow(q7.id)).status === 'pending_review')

// ---------- 8. a test request: approving works and counts toward nothing ----------
const q8 = await submit(a, svcA)
await patchRow('quotes', `id=eq.${q8.id}`, { is_test: true })
const usage = async () => (await sb.select('usage_counters', `tenant_id=eq.${a.tenantId}&select=estimates_sent,estimates_created`)).reduce((s: number, r: { estimates_sent?: number; estimates_created?: number }) => s + (r.estimates_sent ?? 0) + (r.estimates_created ?? 0), 0)
const usageBefore = await usage()
const l8 = await mint(q8.id, a.tenantId)
const p8 = await press(l8.token)
check('a test request approves through its link like any other', p8.status === 200 && p8.json?.outcome === 'approved' && (await quoteRow(q8.id)).approved_via === 'email_link')
check('…and counts toward nothing', (await usage()) === usageBefore, { before: usageBefore, after: await usage() })

saveJson(outDir, 'checks.json', checks)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
