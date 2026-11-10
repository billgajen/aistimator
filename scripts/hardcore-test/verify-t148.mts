// T-148 live check: banned customer words are repaired in code, not hidden.
// Run: npx tsx scripts/hardcore-test/verify-t148.mts   (local stack up: supabase, web, worker)
//
// The model can't be made to write a banned word on demand, so each path is
// driven the way it really runs, with the dirty wording placed where that
// path reads it:
//   1. rewrite (step a): the real wording model, through the worker's rewriter
//   2. generation: a real quote whose business assumptions contain "firm" —
//      business text, so it is shown early and left as typed (T-147 held it)
//   3. clarification stage + reprice (step b, no AI): a quote waiting for an
//      answer gets dirty stored wording; answering reprices it, the sentence
//      is removed and the estimate is still shown early
//   4. auto-send: the same through an auto-send service
//   5. approve without editing: dirty stored wording is cleaned on approval,
//      the business's own text stays; unrepairable wording → 400; an edited
//      quote is sent as written
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { findConfidenceLanguageInPayload, findConfidenceLanguage } from '../../packages/shared/src/customer-language'
import { repairCustomerWording, maskBusinessText } from '../../packages/shared/src/wording-repair'
import { createAiClient } from '../../apps/worker/src/ai/factory'
import { createSentenceRewriter } from '../../apps/worker/src/ai/wording-repair'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t148-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const BUSINESS_ASSUMPTION = 'Price is firm for 30 days'
/** The guard on a public payload, with the business's own text masked (rule 5) */
const generatedClean = (payload: unknown) =>
  findConfidenceLanguageInPayload(JSON.parse(maskBusinessText(JSON.stringify(payload), [BUSINESS_ASSUMPTION])))
const clean = (label: string, payload: unknown) => {
  const problems = generatedClean(payload)
  check(`${label}: generated wording passes the guard`, problems.length === 0, problems.slice(0, 3))
}
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patchQuote = (id: string, body: unknown) => http('PATCH', `${cfg.supabaseUrl}/rest/v1/quotes?id=eq.${id}`, { headers: admin, body })
const quoteRow = async (id: string, cols: string) => (await sb.select('quotes', `id=eq.${id}&select=${cols}`))[0]
const publicView = async (id: string, token: string) =>
  (await http('GET', `${cfg.appUrl}/api/public/quotes/${id}?token=${encodeURIComponent(token)}&poll=1`)).json

// ---------- 1. step a against the real wording model ----------
const textAi = createAiClient('wording', { GEMINI_API_KEY: cfg.geminiKey } as never)
if (!textAi) throw new Error('GEMINI_API_KEY missing in apps/web/.env.local')
const started = Date.now()
const live = await repairCustomerWording(
  {
    scopeSummary: 'Replace your single garage door with a new steel sectional door. We will confirm the exact dimensions before ordering.',
    assumptions: ['This firm price assumes the opening is a standard size.'],
    notes: 'Thanks for your request. This is a preliminary figure based on your photos.',
  },
  { businessPhrases: [], path: 'generation', rewrite: createSentenceRewriter(textAi) }
)
check('step a: the real model rewrites every banned sentence (none removed)', live.record.rewritten.length === 3 && live.record.removed.length === 0, live.record.rewritten.map((r) => r.after))
check('step a: the rewritten wording passes the guard', findConfidenceLanguageInPayload(live.wording).length === 0 && live.unresolved.length === 0)
check('step a: one call, under the timeout', live.record.rewriteCalled && Date.now() - started < 15_000, `${Date.now() - started} ms`)

// ---------- tenant + services ----------
async function business(name: string) {
  const id = shortId()
  const email = `owner+t148-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  return { cookie, tenantKey: site.tenant_key as string }
}
const biz = await business('T148 Doors')

const door = garageDoorsPackUS.services[0]!
async function doorService(mode: { autoSend?: boolean; holdUntilApproved?: boolean } = {}) {
  const created = expectOk('door service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: door.name, description: door.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded,
      defaultAssumptions: [BUSINESS_ASSUMPTION, ...door.draft.scope.assumptions],
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
      draftConfig: door.draft,
      ...mode,
    },
  }))
  return created.service.id as string
}
async function submitDoor(serviceId: string, description = 'New garage door please, single steel one') {
  const res = expectOk('submit door', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer: { name: 'Wording Test', email: 'wording@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: description }, { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  }))
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  return { id: res.quoteId as string, token, view: await pollQuote(cfg, res.quoteId, token) }
}

// Fence service: an optional length → the engine asks for it (clarification round)
async function fenceService(autoSend: boolean) {
  const step = { id: 'fencing', name: 'Closeboard fencing', description: 'Supply and install', costType: 'per_unit', defaultCost: 85, optional: false, unitLabel: 'feet', quantitySource: { type: 'form_field', fieldId: 'fence_length_ft' } }
  const created = expectOk('fence service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: biz.cookie,
    body: {
      name: 'Fence Repair', documentTypeDefault: 'instant_estimate', scopeIncludes: ['Closeboard fence supply and installation'], scopeExcludes: [], defaultAssumptions: [],
      mediaConfig: { minPhotos: 0, maxPhotos: 8, photoGuidance: null, requiredAngles: [] },
      workSteps: [step], expectedSignals: [],
      suggestedFields: [{ fieldId: 'fence_length_ft', label: 'Fence length in feet (if known)', type: 'number', required: false, criticalForPricing: false }],
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [step] },
      autoSend,
    },
  }))
  return created.service.id as string
}
const DIRTY_NOTE = 'Thanks for getting in touch. This is a preliminary figure until we see the fence.'

async function clarifyThenReprice(label: string, autoSend: boolean) {
  const serviceId = await fenceService(autoSend)
  const res = expectOk('submit fence', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer: { name: 'Fence Test', email: 'fence@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'My garden fence blew down in the storm, needs replacing along the left side. How much roughly?' }] }, assetIds: [], source: { type: 'widget' } },
    timeoutMs: 300_000,
  }))
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  const asked = await pollQuote(cfg, res.quoteId, token)
  if (asked.status !== 'awaiting_clarification') {
    check(`${label}: reached a clarification round`, false, asked.status)
    return
  }
  clean(`${label} clarification-stage payload`, asked)
  // The stored wording a reprice reuses, as an older or unrepaired first pass left it
  const stored = await quoteRow(res.quoteId, 'content_json')
  await patchQuote(res.quoteId, { content_json: { ...stored.content_json, notes: DIRTY_NOTE } })
  const question = asked.clarificationQuestions?.[0]
  expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${res.quoteId}/clarify`, { body: { token, answers: [{ questionId: question.id, answer: '40' }] }, timeoutMs: 300_000 }))
  let after = await pollQuote(cfg, res.quoteId, token)
  for (let i = 0; i < 20 && after.status === 'awaiting_clarification'; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    after = await publicView(res.quoteId, token)
  }
  const row = await quoteRow(res.quoteId, 'status,review_hold,pricing_trace_json')
  const wanted = autoSend ? ['sent', 'viewed'].includes(after.status) : after.status === 'pending_review' && row.review_hold === 'shown'
  check(`${label}: repriced and ${autoSend ? 'sent' : 'shown early'} (not held)`, wanted && after.pricing?.total > 0, { status: after.status, review_hold: row.review_hold, total: after.pricing?.total })
  check(`${label}: the banned sentence was removed, the rest kept`, after.notes?.notes === 'Thanks for getting in touch.', after.notes?.notes)
  check(`${label}: the trace records it (reprice, removed)`, row.pricing_trace_json?.wordingRepair?.path === 'reprice' && row.pricing_trace_json.wordingRepair.removed?.length === 1, row.pricing_trace_json?.wordingRepair?.removed)
  clean(`${label} final payload`, after)
  check(`${label}: the repair record never reaches the customer`, !JSON.stringify(after).includes('wordingRepair') && !JSON.stringify(after).includes(DIRTY_NOTE))
}

// ---------- 2. generation: business text with a banned word is not repaired, not held ----------
const shownSvc = await doorService()
const gen = await submitDoor(shownSvc, 'New garage door please, single steel one. Can you give me an exact, firm price rather than a preliminary one?')
const genRow = await quoteRow(gen.id, 'review_hold,content_json,pricing_trace_json')
check('generation: shown early despite the business\'s own "firm" assumption', gen.view.status === 'pending_review' && genRow.review_hold === 'shown', { status: gen.view.status, review_hold: genRow.review_hold })
const echoed = (gen.view.notes?.assumptions ?? []).filter((a: string) => /price is firm/i.test(a))
check('generation: the business assumption, if echoed, is word for word', echoed.every((a: string) => a.replace(/\.$/, '') === BUSINESS_ASSUMPTION), echoed)
clean('generation payload', gen.view)
console.log(`   (generation repair record: ${JSON.stringify(genRow.pricing_trace_json?.wordingRepair ?? 'none — the model wrote clean wording')})`)

// ---------- 3 + 4. clarification stage → reprice, shown early and auto-send ----------
await clarifyThenReprice('show-then-confirm reprice', false)
await clarifyThenReprice('auto-send reprice', true)

// ---------- 5. approve without editing ----------
const holdSvc = await doorService({ holdUntilApproved: true })
const held = await submitDoor(holdSvc)
const heldRow = await quoteRow(held.id, 'content_json')
await patchQuote(held.id, {
  content_json: {
    ...heldRow.content_json,
    scopeSummary: `${heldRow.content_json.scopeSummary} We will confirm the exact opening size on the day.`,
    assumptions: [BUSINESS_ASSUMPTION, 'This is a preliminary figure.'],
  },
})
const approved = await http('POST', `${cfg.appUrl}/api/quotes/${held.id}/approve`, { headers: biz.cookie })
check('approve without editing → sent', approved.ok && approved.json.status === 'sent', approved.json)
const sent = await publicView(held.id, held.token)
check('approve: the generated banned sentences are gone', !/exact opening size|preliminary figure/.test(JSON.stringify(sent.notes)), sent.notes?.assumptions)
check('approve: the business assumption is untouched', (sent.notes?.assumptions ?? []).includes(BUSINESS_ASSUMPTION), sent.notes?.assumptions)
check('approve: the scope keeps its clean sentences', typeof sent.notes?.scopeSummary === 'string' && sent.notes.scopeSummary.length > 20 && findConfidenceLanguage(sent.notes.scopeSummary).length === 0)
clean('approved payload', sent)
const trace = (await quoteRow(held.id, 'pricing_trace_json')).pricing_trace_json
check('approve: the trace records it (approval, removed 2)', trace?.wordingRepair?.path === 'approval' && trace.wordingRepair.removed?.length === 2, trace?.wordingRepair?.removed?.map((r: { field: string }) => r.field))
const dashboard = expectOk('dashboard quote', await http('GET', `${cfg.appUrl}/api/quotes/${held.id}`, { headers: biz.cookie }))
check('the dashboard API returns the record (trace page)', dashboard.quote?.pricing_trace_json?.wordingRepair?.path === 'approval')
check('the public payload never carries it', !JSON.stringify(sent).includes('wordingRepair'))

// Unrepairable: the whole scope is one banned sentence
const stuck = await submitDoor(holdSvc)
await patchQuote(stuck.id, { content_json: { ...(await quoteRow(stuck.id, 'content_json')).content_json, scopeSummary: 'An exact replacement of your garage door.' } })
const refused = await http('POST', `${cfg.appUrl}/api/quotes/${stuck.id}/approve`, { headers: biz.cookie })
check('approve: wording only deletion could fix → 400 WORDING_NEEDS_EDIT', refused.status === 400 && refused.json?.error?.code === 'WORDING_NEEDS_EDIT', refused.json?.error)
check('…and the quote still awaits approval', (await quoteRow(stuck.id, 'status')).status === 'pending_review')

// Edited by the business (version 2): its own words, sent as written
const edited = await submitDoor(holdSvc)
const editedContent = { ...(await quoteRow(edited.id, 'content_json')).content_json, notes: 'Our price is firm, as agreed on the phone.' }
await patchQuote(edited.id, { content_json: editedContent, version: 2 })
const editedApprove = await http('POST', `${cfg.appUrl}/api/quotes/${edited.id}/approve`, { headers: biz.cookie })
const editedView = await publicView(edited.id, edited.token)
check('approve an edited quote: the business\'s text is sent as written', editedApprove.ok && editedView.notes?.notes === editedContent.notes, editedView.notes?.notes)

saveJson(outDir, 't148.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
if (passed !== checks.length) process.exitCode = 1
