// T-147 live check: show, then confirm.
// Run: npx tsx scripts/hardcore-test/verify-t147.mts   (local stack up, migration 31 applied)
//
// Garage-door pack service (form-priced, no AI quantities, so it's fast and
// the price is known): single steel door = $150 removal + $1,250 = $1,400.
//
// The measured-range case is checked at the API: a real measured range is
// written onto a shown estimate's stored pricing (what the engine stores for a
// photo-measured quantity) and the public payload must carry it unlabelled.
// The photo measurement itself is covered by the gauntlet, not here.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { findConfidenceLanguageInPayload } from '../../packages/shared/src/customer-language'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t147-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const clean = (label: string, payload: unknown) => {
  const problems = findConfidenceLanguageInPayload(payload)
  check(`${label}: passes the customer language guard`, problems.length === 0, problems.slice(0, 3))
}

async function business(name: string) {
  const id = shortId()
  const email = `owner+t147-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, tenantKey: site.tenant_key as string, name }
}
type Biz = Awaited<ReturnType<typeof business>>

const svc = garageDoorsPackUS.services[0]!
async function service(biz: Biz, mode: { autoSend?: boolean; holdUntilApproved?: boolean } = {}) {
  const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
      ...mode,
    },
  }))
  return created.service.id as string
}

const SINGLE = 'Single (8 or 9 ft wide, 7 ft tall)'
async function submit(biz: Biz, serviceId: string, doorSize = SINGLE) {
  const res = await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer: { name: 'Show Test', email: 'show@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'New garage door please, single steel one' }, { fieldId: 'door_size', value: doorSize }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  })
  if (!res.ok) return { ok: false as const, res }
  const token = new URL(res.json.quoteViewUrl).searchParams.get('token')!
  const view = await pollQuote(cfg, res.json.quoteId, token)
  return { ok: true as const, id: res.json.quoteId as string, token, view }
}
const publicView = (id: string, token: string, poll = true) =>
  http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}${poll ? '&poll=1' : ''}`)
const quoteRow = async (id: string, cols: string) => (await sb.select('quotes', `id=eq.${id}&select=${cols}`))[0]
const patchQuote = (id: string, body: unknown) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/quotes?id=eq.${id}`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }, body })

const a = await business('T147 Doors')

// 1. Default service, flat price: shown at once as an estimate, Accept locked
const defaultSvc = await service(a) // no mode sent → show, then confirm
const svcRow = (await sb.select('services', `id=eq.${defaultSvc}&select=auto_send,hold_until_approved`))[0]
check('a new service defaults to show, then confirm', svcRow.auto_send === false && svcRow.hold_until_approved === false, svcRow)
const q = await submit(a, defaultSvc)
if (!q.ok) throw new Error(`submit failed: ${JSON.stringify(q.res.json)}`)
check('default service → status stays pending_review', q.view.status === 'pending_review', q.view.status)
check('customer sees the real price ($1,400) and breakdown', q.view.pricing?.total === 1400 && (q.view.pricing?.breakdown?.length ?? 0) > 0, { total: q.view.pricing?.total, lines: q.view.pricing?.breakdown?.length })
check('it is an estimate awaiting confirmation', q.view.review?.state === 'estimate' && q.view.review?.confirmationPending === true, q.view.review)
check('Accept is locked', q.view.acceptQuoteEnabled === false, q.view.acceptQuoteEnabled)
check('flat price: no range, none invented', q.view.estimateRange === undefined && q.view.provisional === undefined, { estimateRange: q.view.estimateRange, provisional: q.view.provisional })
check('scope travels with the estimate', Boolean(q.view.notes?.scopeSummary), q.view.notes?.scopeSummary?.slice(0, 60))
check('no grade in the customer payload', q.view.pricing?.estimate === undefined)
clean('shown-early payload', q.view)
check('hold kind recorded as "shown"', (await quoteRow(q.id, 'review_hold')).review_hold === 'shown')

// Viewing (a real view, not a poll) must not move it off pending_review
const viewed = await publicView(q.id, q.token, false)
const afterView = await quoteRow(q.id, 'status,viewed_at')
check('viewing does not change the status', viewed.ok && afterView.status === 'pending_review' && Boolean(afterView.viewed_at), afterView.status)

// Accept is refused server-side too
const acceptEarly = await http('POST', `${cfg.appUrl}/api/public/quotes/${q.id}/accept`, { body: { token: q.token } })
check('accepting before approval is refused', acceptEarly.status === 400, acceptEarly.status)

// Ask a question works and leaves the quote awaiting approval
const question = await http('POST', `${cfg.appUrl}/api/public/quotes/${q.id}/feedback`, { body: { token: q.token, feedbackType: 'feedback', feedbackText: 'Does this include taking the old door away?' } })
check('ask a question works before approval', question.ok, question.status)
check('…and the quote still awaits approval', (await quoteRow(q.id, 'status')).status === 'pending_review')

// 2. Measured quantity: the stored measured range is returned, unlabelled
const q2 = await submit(a, defaultSvc)
if (!q2.ok) throw new Error('submit 2 failed')
const stored = (await quoteRow(q2.id, 'pricing_json')).pricing_json
await patchQuote(q2.id, { pricing_json: { ...stored, estimate: { ...(stored.estimate || {}), grade: 'B', label: 'Measured', rangeLow: 1250, rangeHigh: 1550 } } })
const ranged = (await publicView(q2.id, q2.token)).json
check('measured quantity → estimate shown with its measured range', ranged?.pricing?.total === 1400 && ranged?.estimateRange?.low === 1250 && ranged?.estimateRange?.high === 1550 && ranged?.provisional === undefined, { total: ranged?.pricing?.total, estimateRange: ranged?.estimateRange })
clean('measured-range payload', ranged)

// 3. Held by a check → hidden. Deterministic check: the service's own rule
// "review estimates above $1,000" (low_confidence_mode = require_review).
const checkedSvc = await service(a)
await http('PATCH', `${cfg.supabaseUrl}/rest/v1/services?id=eq.${checkedSvc}`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }, body: { low_confidence_mode: 'require_review', high_value_threshold: 1000 } })
const held = await submit(a, checkedSvc)
if (!held.ok) throw new Error('submit 3 failed')
const heldRow = await quoteRow(held.id, 'status,review_hold,pricing_json')
check('a quote held by a check is recorded as "check"', heldRow.status === 'pending_review' && heldRow.review_hold === 'check' && heldRow.pricing_json?.total === 1400, { status: heldRow.status, review_hold: heldRow.review_hold })
check('…and the customer sees "being prepared", no price', held.view.pricing?.total === 0 && held.view.provisional === undefined && held.view.review?.confirmationPending !== true && held.view.acceptQuoteEnabled === false && (held.view.takeoff ?? []).length === 0, { total: held.view.pricing?.total, review: held.view.review })
clean('check-held payload', held.view)

// 4. Hold until I approve: identical to T-146
const holdSvc = await service(a, { holdUntilApproved: true })
const q4 = await submit(a, holdSvc)
if (!q4.ok) throw new Error('submit 4 failed')
check('hold-until-approved service → hidden: no price, no range', q4.view.status === 'pending_review' && q4.view.pricing?.total === 0 && q4.view.provisional === undefined && q4.view.review?.confirmationPending !== true, { status: q4.view.status, total: q4.view.pricing?.total })
check('…recorded as "held"', (await quoteRow(q4.id, 'review_hold')).review_hold === 'held')
clean('held payload', q4.view)

// 5. Send automatically: unchanged
const autoSvc = await service(a, { autoSend: true })
const q5 = await submit(a, autoSvc)
if (!q5.ok) throw new Error('submit 5 failed')
check('auto-send service → goes straight out, Accept enabled', ['sent', 'viewed'].includes(q5.view.status) && q5.view.pricing?.total === 1400 && q5.view.acceptQuoteEnabled === true && q5.view.review?.confirmationPending === undefined, { status: q5.view.status, accept: q5.view.acceptQuoteEnabled })
check('…no hold recorded', (await quoteRow(q5.id, 'review_hold')).review_hold === null)

// 6. Approve: the same link becomes the confirmed quote
const rival = await business('T147 Rival')
const rivalTry = await http('POST', `${cfg.appUrl}/api/quotes/${q.id}/approve`, { headers: rival.cookie })
check('a rival business gets 404', rivalTry.status === 404, rivalTry.status)
const approved = await http('POST', `${cfg.appUrl}/api/quotes/${q.id}/approve`, { headers: a.cookie })
check('approve → sent', approved.ok && approved.json.status === 'sent', approved.json?.status ?? approved.status)
const again = await http('POST', `${cfg.appUrl}/api/quotes/${q.id}/approve`, { headers: a.cookie })
check('a second tap returns 400', again.status === 400, again.status)
const after = (await publicView(q.id, q.token, false)).json
check('same link now shows the confirmed quote with Accept enabled', after?.review?.state === 'quote' && after?.review?.confirmationPending === undefined && after?.pricing?.total === 1400 && after?.acceptQuoteEnabled === true, { review: after?.review, accept: after?.acceptQuoteEnabled })
clean('approved payload', after)
check('the first view after approval records sent → viewed', (await quoteRow(q.id, 'status')).status === 'viewed')
const accepted = await http('POST', `${cfg.appUrl}/api/public/quotes/${q.id}/accept`, { body: { token: q.token } })
check('the customer can now accept', accepted.ok, accepted.status)

// The measured-range quote: once confirmed, the price is the price
await http('POST', `${cfg.appUrl}/api/quotes/${q2.id}/approve`, { headers: a.cookie })
const rangedAfter = (await publicView(q2.id, q2.token)).json
check('no range once the business confirmed it', rangedAfter?.review?.state === 'quote' && rangedAfter?.estimateRange === undefined, rangedAfter?.estimateRange)

// 7. Switching modes later
const toHold = await http('PATCH', `${cfg.appUrl}/api/services/${defaultSvc}`, { headers: a.cookie, body: { autoSend: false, holdUntilApproved: true } })
const r1 = (await sb.select('services', `id=eq.${defaultSvc}&select=auto_send,hold_until_approved`))[0]
const toAuto = await http('PATCH', `${cfg.appUrl}/api/services/${defaultSvc}`, { headers: a.cookie, body: { autoSend: true, holdUntilApproved: false } })
const r2 = (await sb.select('services', `id=eq.${defaultSvc}&select=auto_send,hold_until_approved`))[0]
check('the mode can be changed later (hold, then send automatically)', toHold.ok && r1.hold_until_approved === true && r1.auto_send === false && toAuto.ok && r2.auto_send === true && r2.hold_until_approved === false, { r1, r2 })

saveJson(outDir, 't147.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
console.log('Emails are not checked here (no Postmark locally): the estimate email is unit-tested; check one live send after deploy.')
if (passed !== checks.length) process.exitCode = 1
