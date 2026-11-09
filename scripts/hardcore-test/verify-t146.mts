// T-146 live check: business review by default, one-tap approval, and no
// confidence language on anything the customer sees.
// Run: npx tsx scripts/hardcore-test/verify-t146.mts   (local stack up, migration 30 applied)
//
// Garage-door pack service (form-priced, no AI quantities, so it's fast and
// the price is known): single steel door = $150 removal + $1,250 = $1,400.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { findConfidenceLanguageInPayload } from '../../packages/shared/src/customer-language'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t146-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const clean = (label: string, payload: unknown) => {
  const problems = findConfidenceLanguageInPayload(payload)
  check(`${label}: no grades / "exact" / "firm" / "preliminary"`, problems.length === 0, problems.slice(0, 3))
}

async function business(name: string) {
  const id = shortId()
  const email = `owner+t146-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, bearer: { Authorization: `Bearer ${session.access_token}` }, tenantKey: site.tenant_key as string, name }
}

const svc = garageDoorsPackUS.services[0]!
async function service(biz: Awaited<ReturnType<typeof business>>, autoSend?: boolean) {
  const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
      ...(autoSend !== undefined && { autoSend }),
    },
  }))
  return created.service.id as string
}

async function submit(biz: Awaited<ReturnType<typeof business>>, serviceId: string) {
  const res = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer: { name: 'Review Test', email: 'review@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'New garage door please, single steel one' }, { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  }))
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  const view = await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token, view }
}
const publicView = async (id: string, token: string) => http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}&poll=1`)

// 1. Default: review first
const a = await business('T146 Doors')
const reviewed = await service(a) // autoSend omitted → off
const q = await submit(a, reviewed)
check('default service → quote awaits business approval', q.view.status === 'pending_review', q.view.status)
// A flat-rate (Grade A) price has no measured range: the customer sees only
// "being prepared" — no number, and never an invented ±12% range
check('customer sees "being prepared", no price and no invented range', q.view.status === 'pending_review' && q.view.pricing.total === 0 && q.view.provisional === undefined, q.view.provisional)
check('customer state is "estimate"', q.view.review?.state === 'estimate', q.view.review)
clean('pending payload', q.view)

const detail = expectOk('detail', await http('GET', `${cfg.appUrl}/api/quotes/${q.id}`, { headers: a.cookie }))
check('business still sees the grade internally', ['A', 'B', 'C'].includes(detail.quote.pricing_json?.estimate?.grade), detail.quote.pricing_json?.estimate)
check('business sees the price ($1,400)', detail.quote.pricing_json?.total === 1400, detail.quote.pricing_json?.total)

// 2. Another business can't approve it
const rival = await business('T146 Rival')
const rivalTry = await http('POST', `${cfg.appUrl}/api/quotes/${q.id}/approve`, { headers: rival.cookie })
check("another business can't approve it", rivalTry.status === 404, rivalTry.status)

// 3. One-tap approval
const approved = await http('POST', `${cfg.appUrl}/api/quotes/${q.id}/approve`, { headers: a.cookie })
check('approve → sent', approved.ok && approved.json.status === 'sent', approved.json)
const again = await http('POST', `${cfg.appUrl}/api/quotes/${q.id}/approve`, { headers: a.cookie })
check('a second tap does not send twice', again.status === 400 || again.status === 409, again.status)

// 4. The link the customer already had still works, and shows the reviewed quote
const after = await publicView(q.id, q.token)
check('the pre-approval link still opens the quote', after.ok, after.status)
check('customer state is "quote" with the real price', after.json?.review?.state === 'quote' && after.json?.pricing?.total === 1400, { review: after.json?.review, total: after.json?.pricing?.total })
check('no range shown once the business confirmed it', after.json?.estimateRange === undefined, after.json?.estimateRange)
check('no grade in the customer payload', after.json?.pricing?.estimate === undefined, after.json?.pricing?.estimate)
clean('approved payload', after.json)
const row = (await sb.select('quotes', `id=eq.${q.id}&select=approved_at,approved_by,previous_token_hash,quote_token_hash`))[0]
check('approval recorded (approved_at/by, old link kept)', Boolean(row.approved_at && row.approved_by && row.previous_token_hash && row.previous_token_hash !== row.quote_token_hash), { approved: Boolean(row.approved_at) })

// 5. Opt-in: send automatically without review
const autoSvc = await service(a, true)
const q2 = await submit(a, autoSvc)
check('"send automatically" service → goes straight out', ['sent', 'viewed'].includes(q2.view.status), q2.view.status)
check('auto-sent quote is an "estimate" (not reviewed)', q2.view.review?.state === 'estimate', q2.view.review)
clean('auto-sent payload', q2.view)

// 6. Mobile app path: approve with a Bearer token
const q3 = await submit(a, reviewed)
const viaApp = await http('POST', `${cfg.appUrl}/api/quotes/${q3.id}/approve`, { headers: a.bearer })
check('approve from the app (Bearer)', viaApp.ok && viaApp.json.status === 'sent', viaApp.json)

// 7. Turning auto-send on for an existing service
const patched = await http('PATCH', `${cfg.appUrl}/api/services/${reviewed}`, { headers: a.cookie, body: { autoSend: true } })
const svcRow = (await sb.select('services', `id=eq.${reviewed}&select=auto_send`))[0]
check('the setting can be switched on later', patched.ok && svcRow.auto_send === true, svcRow)

saveJson(outDir, 't146.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
if (passed !== checks.length) process.exitCode = 1
