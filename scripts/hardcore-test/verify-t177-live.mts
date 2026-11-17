// T-177, OPTIONAL: what the REAL AI model says about real-sounding WhatsApp messages.
//
// This is not part of the regression set and is never a gate. A live model's answers vary a
// little from run to run, so a check on them cannot be pass-or-fail: this script reports what the
// model did, and always exits 0 once it has run. The rules themselves are pinned by the unit
// tests (mocked model) and by verify-t177.mts (model stood in for).
//
// It needs the web app started WITHOUT the model stand-in, so the question goes to the real model
// (and with its AI key set):
//
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//   WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8799 \
//   NEXT_PUBLIC_WHATSAPP_APP_ID=900000000000175 NEXT_PUBLIC_WHATSAPP_CONFIG_ID=900000000000176 \
//   WHATSAPP_APP_SECRET=local-app-secret-t175 WHATSAPP_VERIFY_TOKEN=local-verify-t175 \
//   WHATSAPP_ENCRYPTION_KEY=local-encryption-key-t175 pnpm dev:web
//
// Meta is still stood in for: nothing is sent to Meta and no WhatsApp message goes to anyone.
// The worker should be running (a price request makes a real local request).
//
// Run:  npx tsx scripts/hardcore-test/verify-t177-live.mts
import http from 'node:http'
import crypto from 'node:crypto'
import { loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { offeredPlansWithChannel } from '../../packages/shared/src/plans'

type Row = Record<string, unknown>
const MOCK_PORT = 8799
const APP_ID = '900000000000175'
const APP_SECRET = 'local-app-secret-t175'
const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const metaId = () => `9${Array.from({ length: 14 }, () => crypto.randomInt(0, 10)).join('')}`

// ---------- a stand-in for Meta (the least this script needs) ----------
const token = `EAAmock${crypto.randomBytes(18).toString('hex')}`
const account = { wabaId: metaId(), businessId: metaId(), number: { id: metaId(), display: `+1 415-555-01${crypto.randomInt(10, 99)}` }, templates: [] as Row[] }
const codes = new Set<string>()
const sent: Array<{ to: string; text: string }> = []
let modelStandInHit = false
const mock = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${MOCK_PORT}`)
    const query = Object.fromEntries(url.searchParams)
    let body: Row | null = null
    try {
      body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Row) : null
    } catch {
      body = null
    }
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(json))
    }
    const [version, node, edge] = url.pathname.split('/').filter(Boolean)
    if (version === 'ai') {
      // the web app is asking THIS script instead of the real model
      modelStandInHit = true
      return send(503, { error: { message: 'not a model' } })
    }
    if (node === 'oauth') return codes.delete(query.code ?? '') ? send(200, { access_token: token }) : send(400, { error: { code: 100, message: 'expired' } })
    if (node === 'debug_token') return send(200, { data: { app_id: APP_ID, is_valid: true, expires_at: Math.floor(Date.now() / 1000) + 60 * 86_400, granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: [account.wabaId] }] } })
    const numberJson = { id: account.number.id, display_phone_number: account.number.display, verified_name: 'Kent Garage Doors', is_on_biz_app: false }
    if (node === account.wabaId) {
      if (edge === 'phone_numbers') return send(200, { data: [numberJson] })
      if (edge === 'subscribed_apps') return send(200, { success: true })
      if (edge === 'message_templates') {
        if (req.method === 'POST') account.templates.push({ id: metaId(), name: body?.name, language: body?.language, status: 'PENDING', category: 'UTILITY', rejected_reason: 'NONE', components: body?.components })
        return req.method === 'POST' ? send(200, { id: account.templates.at(-1)!.id, status: 'PENDING', category: 'UTILITY' }) : send(200, { data: account.templates })
      }
      return send(200, { id: account.wabaId })
    }
    if (node === account.number.id) {
      if (edge === 'messages') {
        sent.push({ to: String(body?.to ?? ''), text: (body?.text as { body?: string } | undefined)?.body ?? '' })
        return send(200, { messaging_product: 'whatsapp', messages: [{ id: `wamid.out.${shortId()}${shortId()}` }] })
      }
      return edge ? send(200, { success: true }) : send(200, query.fields === 'name_status' ? { id: account.number.id, name_status: 'APPROVED' } : numberJson)
    }
    return send(400, { error: { code: 100, message: 'unknown' } })
  })
})
await new Promise<void>((resolve, reject) => mock.once('error', reject).listen(MOCK_PORT, '127.0.0.1', resolve))
const stop = (code: number): never => {
  mock.close()
  process.exit(code)
}

// ---------- a business with two services, on a plan with WhatsApp ----------
const id = shortId()
const name = `Kent Garage Doors ${id}`
const email = `owner+t177live-${id}@hardcore.test`
const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
const cookie = { Cookie: sessionCookieHeader(cfg, session) }
const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
await sb.insert('subscriptions', { tenant_id: tenantId, plan_id: offeredPlansWithChannel('whatsapp')[0]!.id, status: 'active' })
for (const svc of garageDoorsPackUS.services.slice(0, 2)) {
  expectOk('service', await call('POST', `${app}/api/services`, {
    headers: cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
    },
  }))
}
const code = `AQmock${crypto.randomBytes(24).toString('hex')}`
codes.add(code)
const connected = await call('POST', `${app}/api/whatsapp/connect`, { headers: cookie, body: { code, wabaId: account.wabaId, phoneNumberId: account.number.id, businessId: account.businessId } })
if (!connected.ok) {
  console.error('Could not connect the test business. Is the web app running with the local WhatsApp test settings (the top of this file)?', connected.status)
  stop(2)
}

async function says(from: string, text: string): Promise<string[]> {
  const before = sent.length
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: account.wabaId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: account.number.display.replace(/\D/g, ''), phone_number_id: account.number.id }, contacts: [{ profile: { name: 'Megan Grant' }, wa_id: from }], messages: [{ id: `wamid.in.${shortId()}${shortId()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }],
  })
  await fetch(`${app}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` }, body: raw })
  return sent.slice(before).filter((m) => m.to === from).map((m) => m.text)
}

// ---------- the messages ----------
const SILENT = [
  'What time do you open tomorrow?',
  'Are you coming tomorrow at 9?',
  'Thanks so much, the door looks great!',
  'I am not happy, the installer left a mess on the drive',
  'Can you call me back please',
  'Do you fit garage doors?',
  'ok',
  'See you Friday then 👍',
  'Did you get my payment for the last job?',
  'How much would it cost to fix my leaking kitchen tap?',
  'How much to repaint my living room?',
  'What do you charge for a new opener? I only need the opener replaced, nothing else.',
]
const PRICE: Array<[string, string]> = [
  ['Hi, how much would a new single steel garage door cost? 9 ft wide, 7 ft tall, installed.', garageDoorsPackUS.services[0]!.name],
  ['Can you give me a price to swap my old double garage door for a new insulated one, 16 by 7?', garageDoorsPackUS.services[0]!.name],
  ['My garage door spring snapped. How much to replace one torsion spring?', garageDoorsPackUS.services[1]!.name],
  ['Hello, can I get a quote for a new garage door please?', garageDoorsPackUS.services[0]!.name],
]

console.log('\n== Messages that should get NO reply')
let phone = 0
let silentAsExpected = 0
for (const message of SILENT) {
  const replies = await says(`1555555${String(300 + ++phone).padStart(4, '0')}`, message)
  if (modelStandInHit) {
    console.error('\nThe web app is asking a stand-in, not the real model (WHATSAPP_INTENT_BASE_URL is set). Start it without that setting, as the top of this file says.')
    stop(2)
  }
  const ok = replies.length === 0
  if (ok) silentAsExpected++
  console.log(`${ok ? 'silent ' : 'REPLIED'}  ${message}${ok ? '' : `\n         → ${replies[0]?.slice(0, 120)}`}`)
}
console.log('\n== Price requests for a service this business offers, which should get a reply')
let priceAsExpected = 0
for (const [message, service] of PRICE) {
  const replies = await says(`1555555${String(300 + ++phone).padStart(4, '0')}`, message)
  const ok = replies.length === 1 && replies[0]!.includes(service)
  if (ok) priceAsExpected++
  console.log(`${ok ? 'replied' : replies.length === 0 ? 'SILENT ' : 'OTHER  '}  ${message}\n         → ${replies[0]?.replace(/\?token=[A-Za-z0-9_-]+/, '?token=…').slice(0, 150) ?? '(nothing)'}`)
}

console.log(`\nLive model, this run: ${silentAsExpected} of ${SILENT.length} stayed silent as expected; ${priceAsExpected} of ${PRICE.length} price requests were answered for the right service.`)
console.log('This is a report, not a gate: answers vary between runs. A reply to a message in the first list matters more than a miss in the second.')
stop(0)
