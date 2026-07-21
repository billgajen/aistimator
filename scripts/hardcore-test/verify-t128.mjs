// T-128 live verification: a quote sent WITH a defaulted ×1 quantity must
// grade C (was: Grade A "this price is exact"). Path: fence probe → gate asks
// (T-127) → customer answers unhelpfully → round spent → sent → grade C.
// Run: node scripts/hardcore-test/verify-t128.mjs
import {
  loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId,
} from './lib.mjs'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const runId = shortId()

const email = `owner+t128-${runId}@hardcore.test`
const password = `Hardcore-${runId}-Aa1!`
const user = await sb.createUser(email, password, 'T128 Fencing Co')
const session = await sb.signIn(email, password)
const authed = { Cookie: sessionCookieHeader(cfg, session) }

const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: 'T128 Fencing Co' } })
const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
expectOk('tenant settings', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: authed, body: { currency: 'GBP', taxEnabled: false, serviceAreaMode: 'none', serviceAreaValues: [] } }))
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })

const step = { id: 'fencing', name: 'Closeboard fencing', description: 'Supply and install', costType: 'per_unit', defaultCost: 85, optional: false, unitLabel: 'metres', quantitySource: { type: 'form_field', fieldId: 'fence_length_m' } }
const svc = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: authed,
  body: {
    name: 'Fence Repair',
    documentTypeDefault: 'instant_estimate',
    scopeIncludes: ['Closeboard fence supply and installation'],
    scopeExcludes: [],
    defaultAssumptions: [],
    mediaConfig: { minPhotos: 0, maxPhotos: 8, photoGuidance: null, requiredAngles: [] },
    workSteps: [step],
    expectedSignals: [],
    suggestedFields: [
      { fieldId: 'fence_length_m', label: 'Fence length in metres (if known)', type: 'number', required: false, criticalForPricing: false },
    ],
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [step] },
  },
}))

const submit = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
  body: {
    tenantKey: site.tenant_key,
    serviceId: svc.service.id,
    customer: { name: 'T128 Probe', email: 't128-customer@example.com' },
    job: { postcodeOrZip: 'BS1 1AA', answers: [{ fieldId: '_project_description', value: 'Fence blew down along the left side of the garden, needs replacing. No idea how long it is.' }] },
    assetIds: [],
    source: { type: 'widget', pageUrl: 'http://localhost:3000/t128' },
  },
  timeoutMs: 300_000,
}))
const token = new URL(submit.quoteViewUrl).searchParams.get('token')
let quote = await pollQuote(cfg, submit.quoteId, token)
console.log(`AFTER SUBMIT: status=${quote.status}`)
if (quote.status !== 'awaiting_clarification') {
  console.log('FAIL: expected the T-127 question first')
  process.exit(1)
}
const q = quote.clarificationQuestions[0]
expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${submit.quoteId}/clarify`, {
  body: { token, answers: [{ questionId: q.id, answer: "Not sure at all — it blew down in the storm, you tell me" }] },
  timeoutMs: 300_000,
}))
quote = await pollQuote(cfg, submit.quoteId, token)
const est = quote.pricing?.estimate
console.log(`AFTER UNHELPFUL CLARIFY: status=${quote.status} total=£${quote.pricing?.total} grade=${est?.grade} (${est?.label})`)
for (const l of quote.pricing?.breakdown || []) console.log(`   ${l.label}: £${l.amount}`)
const pass = ['sent', 'viewed', 'pending_review'].includes(quote.status) && est?.grade === 'C'
console.log(pass ? '\nT-128 VERIFIED: defaulted quantity → Grade C (was Grade A "exact")' : '\nFAIL: expected grade C')
process.exit(pass ? 0 : 1)
