// T-127 live verification: defaulted quantity → in-flow clarification →
// answer → repriced final quote. Run: node scripts/hardcore-test/verify-t127.mjs
import {
  loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId,
} from './lib.mjs'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const runId = shortId()

const email = `owner+t127-${runId}@hardcore.test`
const password = `Hardcore-${runId}-Aa1!`
const user = await sb.createUser(email, password, 'T127 Fencing Co')
const session = await sb.signIn(email, password)
const authed = { Cookie: sessionCookieHeader(cfg, session) }

const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: 'T127 Fencing Co' } })
const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
expectOk('tenant settings', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: authed, body: { currency: 'GBP', taxEnabled: false, serviceAreaMode: 'none', serviceAreaValues: [] } }))
const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })

// Service with a per-unit step whose quantity field is OPTIONAL — so the
// submission passes T-129 validation and the engine hits the ×1 default.
const svc = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: authed,
  body: {
    name: 'Fence Repair',
    documentTypeDefault: 'instant_estimate',
    scopeIncludes: ['Closeboard fence supply and installation'],
    scopeExcludes: [],
    defaultAssumptions: [],
    mediaConfig: { minPhotos: 0, maxPhotos: 8, photoGuidance: null, requiredAngles: [] },
    workSteps: [
      { id: 'fencing', name: 'Closeboard fencing', description: 'Supply and install', costType: 'per_unit', defaultCost: 85, optional: false, unitLabel: 'metres', quantitySource: { type: 'form_field', fieldId: 'fence_length_m' } },
    ],
    expectedSignals: [],
    suggestedFields: [
      { fieldId: 'fence_length_m', label: 'Fence length in metres (if known)', type: 'number', required: false, criticalForPricing: false },
    ],
    pricingRules: {
      baseFee: 0,
      minimumCharge: 0,
      addons: [],
      multipliers: [],
      workSteps: [
        { id: 'fencing', name: 'Closeboard fencing', description: 'Supply and install', costType: 'per_unit', defaultCost: 85, optional: false, unitLabel: 'metres', quantitySource: { type: 'form_field', fieldId: 'fence_length_m' } },
      ],
    },
  },
}))
const serviceId = svc.service.id
console.log(`tenant ${tenantId} service ${serviceId}`)

// Submit WITHOUT the fence length
const submit = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
  body: {
    tenantKey: site.tenant_key,
    serviceId,
    customer: { name: 'T127 Probe', email: 't127-customer@example.com' },
    job: { postcodeOrZip: 'BS1 1AA', answers: [{ fieldId: '_project_description', value: 'My garden fence blew down in the storm, needs replacing along the left side. How much roughly?' }] },
    assetIds: [],
    source: { type: 'widget', pageUrl: 'http://localhost:3000/t127' },
  },
  timeoutMs: 300_000,
}))
const token = new URL(submit.quoteViewUrl).searchParams.get('token')
let quote = await pollQuote(cfg, submit.quoteId, token)
console.log(`\nAFTER SUBMIT: status=${quote.status} total=£${quote.pricing?.total}`)
console.log('questions:', (quote.clarificationQuestions || []).map((q) => `[${q.targetSignalKey || q.id}] ${q.question}`))

if (quote.status !== 'awaiting_clarification') {
  console.log('FAIL: expected awaiting_clarification — T-127 did not ask')
  process.exit(1)
}
const q = (quote.clarificationQuestions || []).find((x) => (x.targetSignalKey || '').includes('fence')) || quote.clarificationQuestions[0]

expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${submit.quoteId}/clarify`, {
  body: { token, answers: [{ questionId: q.id, answer: '20' }] },
  timeoutMs: 300_000,
}))
quote = await pollQuote(cfg, submit.quoteId, token)
console.log(`\nAFTER CLARIFY: status=${quote.status} total=£${quote.pricing?.total}`)
for (const l of quote.pricing?.breakdown || []) console.log(`   ${l.label}: £${l.amount}`)
const pass = ['sent', 'viewed'].includes(quote.status) && quote.pricing?.total === 1700
console.log(pass ? '\nT-127 VERIFIED: asked, answered, repriced £85 → £1,700' : '\nFAIL: unexpected final state')
process.exit(pass ? 0 : 1)
