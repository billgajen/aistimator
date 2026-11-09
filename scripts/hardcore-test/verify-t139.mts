// T-139 live check: identification from a label photo, on the local stack.
// Run: npx tsx scripts/hardcore-test/verify-t139.mts
//
// A test-only service (NOT a pack — synthetic data) whose price depends on a
// unit size printed in a model number. Two customers:
//   sharp   — legible label → decoded "Medium", Grade B, a confirmation
//             question → confirm → Grade A, takeoff cites the label
//   blurred — unreadable label → direct question with the options → answer
//             "large" → snapped to "Large", priced, Grade A
// Photos: test-assets/hardcore2/T139-labels/ (synthetic renders, gitignored).
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import {
  ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId,
  collectAssets, uploadAssets, saveJson, runStamp,
} from './lib.mjs'

type Row = Record<string, unknown>
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t139-${shortId()}`)
mkdirSync(outDir, { recursive: true })

const expectedSignals = [
  {
    signalKey: 'unit_size',
    type: 'enum',
    possibleValues: ['Small', 'Medium', 'Large'],
    description: 'size of the existing unit',
    identify: {
      readFrom: "the unit's rating plate",
      transcribe: 'the model number (after "MODEL NO.")',
      decode: [{ pattern: '[A-Z]{2}(\\d{2})-', map: { '24': 'Small', '36': 'Medium', '48': 'Large' }, label: 'size digits in the model number' }],
    },
  },
]
const workSteps = [
  { id: 'callout', name: 'Removal and disposal', description: '', costType: 'fixed', defaultCost: 300, optional: false },
  ...(['Small', 'Medium', 'Large'] as const).map((size, i) => ({
    id: `unit_${size.toLowerCase()}`,
    name: `${size} replacement unit`,
    description: '',
    costType: 'fixed',
    defaultCost: 2000 + i * 900,
    optional: true,
    triggerSignal: 'unit_size',
    triggerCondition: { operator: 'equals', value: size },
  })),
]

async function quoteRow(quoteId: string): Promise<Row> {
  return (await sb.select('quotes', `id=eq.${quoteId}&select=status,pricing_json,content_json,clarification_questions_json,signals_json,pricing_trace_json`))[0]
}

async function setupTenant() {
  const runId = shortId()
  const email = `owner+t139-${runId}@hardcore.test`
  const password = `Hardcore-${runId}-Aa1!`
  const user = await sb.createUser(email, password, 'T139 Replacement Co')
  const session = await sb.signIn(email, password)
  const authed = { Cookie: sessionCookieHeader(cfg, session) }
  const setupRes = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: 'T139 Replacement Co' } })
  const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant PUT', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: authed,
    body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const svc = expectOk('create service', await http('POST', `${cfg.appUrl}/api/services`, {
    headers: authed,
    body: {
      name: 'Unit replacement',
      description: 'Remove the existing unit and install a like-for-like replacement.',
      documentTypeDefault: 'instant_estimate',
      scopeIncludes: ['Removal of the old unit', 'Like-for-like replacement unit'],
      scopeExcludes: [],
      defaultAssumptions: [],
      mediaConfig: { minPhotos: 1, maxPhotos: 4, photoGuidance: 'A clear photo of the rating plate', requiredAngles: [] },
      workSteps,
      expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps },
    },
  }))
  return { tenantKey: site.tenant_key as string, serviceId: svc.service.id as string }
}

async function runCase(t: { tenantKey: string; serviceId: string }, photo: string, answerFor: (q: Row) => string) {
  const collected = collectAssets('test-assets/hardcore2/T139-labels', path.join(outDir, '.scratch'))
  const file = collected.files.find((f: { fileName: string }) => f.fileName === photo)
  if (!file) throw new Error(`missing ${photo} in test-assets/hardcore2/T139-labels`)
  const up = await uploadAssets(cfg, t.tenantKey, [file])
  const t0 = Date.now()
  const submit = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: {
      tenantKey: t.tenantKey,
      serviceId: t.serviceId,
      customer: { name: 'T139 Customer', email: 't139@example.com' },
      job: { postcodeOrZip: '78701', answers: [{ fieldId: '_project_description', value: 'Please replace my old unit. Photo of the label attached.' }] },
      assetIds: up.assetIds,
      source: { type: 'widget', pageUrl: 'http://localhost:3000/t139' },
    },
    timeoutMs: 600_000,
  }))
  const token = new URL(submit.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, submit.quoteId, token)
  const first = await quoteRow(submit.quoteId)
  const firstSignals = ((first.signals_json as Row)?.signals || []) as Row[]
  const questions = (first.clarification_questions_json || []) as Row[]
  const result: Row = {
    photo,
    quoteId: submit.quoteId,
    firstPriceMs: Date.now() - t0,
    firstStatus: first.status,
    firstGrade: ((first.pricing_json as Row)?.estimate as Row)?.grade,
    firstTotal: (first.pricing_json as Row)?.total,
    unitSize: firstSignals.find((s) => s.key === 'unit_size') ?? null,
    questions,
    identificationTask: (((first.pricing_trace_json as Row)?.aiUsage as Row)?.byTask as Row[] | undefined)?.find((b) => b.task === 'identification') ?? null,
  }
  if (first.status === 'awaiting_clarification' && questions.length > 0) {
    const answers = questions.map((q) => ({ questionId: q.id, answer: answerFor(q) }))
    expectOk('clarify', await http('POST', `${cfg.appUrl}/api/public/quotes/${submit.quoteId}/clarify`, { body: { token, answers }, timeoutMs: 600_000 }))
    const deadline = Date.now() + 600_000
    let row = await quoteRow(submit.quoteId)
    while (['queued', 'generating', 'awaiting_clarification'].includes(String(row.status)) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 250))
      row = await quoteRow(submit.quoteId)
    }
    result.answers = answers
    result.finalStatus = row.status
    result.finalTotal = (row.pricing_json as Row)?.total
    result.finalGrade = ((row.pricing_json as Row)?.estimate as Row)?.grade
    result.finalTakeoff = (row.content_json as Row)?.takeoff
  }
  return result
}

const tenant = await setupTenant()
const results = []
// Sharp: confirm what was read (one tap)
results.push(await runCase(tenant, 'label-sharp.jpg', (q) => (q.aiValue !== undefined ? String(q.aiValue) : 'Medium')))
// Blurred: the customer types the size in lower case
results.push(await runCase(tenant, 'label-blurred.jpg', () => 'large'))
for (const r of results) console.log(JSON.stringify(r, null, 2))
saveJson(outDir, 't139.json', results)
console.log(`\nartifacts in ${outDir}`)
