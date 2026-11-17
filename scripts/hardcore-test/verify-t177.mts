// T-177 check: the silent WhatsApp assistant, the automatic template, the plan and subscription
// rule, Embedded Signup v5, small copies of chat photos, and the legal pages.
//
// Nothing here talks to Meta and no WhatsApp message is sent to anyone: the script runs a stand-in
// for Meta's Graph API on this machine, and the web app is started pointing at it, exactly as for
// verify-t175 and verify-t176 (same settings, same port, so one running web app serves all three,
// one after the other):
//
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//   WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8799 WHATSAPP_INTENT_BASE_URL=http://127.0.0.1:8799/ai \
//   NEXT_PUBLIC_WHATSAPP_APP_ID=900000000000175 NEXT_PUBLIC_WHATSAPP_CONFIG_ID=900000000000176 \
//   WHATSAPP_APP_SECRET=local-app-secret-t175 WHATSAPP_VERIFY_TOKEN=local-verify-t175 \
//   WHATSAPP_ENCRYPTION_KEY=local-encryption-key-t175 pnpm dev:web
//
// The worker must be running (requests are priced). Nothing is created on Meta: every template
// here lives in the stand-in.
//
// The AI model is stood in for as well (WHATSAPP_INTENT_BASE_URL): "is this a price request for
// one of this business's services?" is answered from a list in this script, so every run is the
// same. What the REAL model answers varies from run to run, so it is not part of this script: it
// has its own optional check, verify-t177-live.mts, which is never a gate.
//
// Run:  PLAYWRIGHT_DIR=<folder> WEB_LOG=<the web app's log file> npx tsx scripts/hardcore-test/verify-t177.mts
// Without PLAYWRIGHT_DIR the browser section is skipped; without WEB_LOG the log check is. Both say so.
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { PLANS, offeredPlansWithChannel } from '../../packages/shared/src/plans'

const jpeg = createRequire(path.join(ROOT, 'apps/web/package.json'))('jpeg-js') as {
  encode: (image: { width: number; height: number; data: Buffer }, quality: number) => { data: Buffer }
  decode: (bytes: Uint8Array, options?: Record<string, unknown>) => { width: number; height: number }
}

type Row = Record<string, unknown>
const MOCK_PORT = 8799
const APP_ID = '900000000000175'
const CONFIG_ID = '900000000000176'
const APP_SECRET = 'local-app-secret-t175'
const VERIFY_TOKEN = 'local-verify-t175'
const TEMPLATE_NAME = 'estimate_ready'
const WITH_WHATSAPP = offeredPlansWithChannel('whatsapp')[0]!.id
const WITHOUT_WHATSAPP = PLANS.find((p) => p.offered && !p.channels.includes('whatsapp'))!.id

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t177-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const notChecked: string[] = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const metaId = () => `9${Array.from({ length: 14 }, () => crypto.randomInt(0, 10)).join('')}`
/** Made-up customer numbers (the 555-01xx range is reserved for fiction) */
const customer = (n: number) => `1555555${String(100 + n).padStart(4, '0')}`
const secretsSeen = new Set<string>([APP_SECRET])

// =====================================================================================
// A stand-in for Meta's Graph API
// =====================================================================================
interface MockTemplate { id: string; name: string; language: string; status: string; category: string; rejected_reason: string; components: Row[] }
interface MockAccount {
  token: string
  wabaId: string
  businessId: string
  number: { id: string; display: string; name: string; onBizApp: boolean }
  expiresAt: number
  templates: MockTemplate[]
  refuseTemplatesWith: number | null
}
const accounts = new Map<string, MockAccount>()
const codes = new Map<string, string>()
interface MockCall { method: string; path: string; query: Record<string, string>; token: string | null; body: Row | null }
const calls: MockCall[] = []
interface Sent { token: string; to: string; type: string; text: string; id: string }
const sent: Sent[] = []
/**
 * A stand-in for the AI model. The assistant asks it one question about a message; the answer
 * comes from this list: the name of the service the message asks a price for, and whether it
 * already describes the job. A message that is not in the list is "not a price request".
 */
interface ScriptedAnswer { service: string | null; described?: boolean; confidence?: number; serviceId?: string }
const modelAnswers = new Map<string, ScriptedAnswer>()
/** every message the model was asked about */
const modelAsked: string[] = []
function modelReply(prompt: string): Row {
  const message = /<<<MESSAGE\n([\s\S]*?)\nMESSAGE>>>/.exec(prompt)?.[1] ?? ''
  modelAsked.push(message)
  const ids = new Map([...prompt.matchAll(/- id: (\S+)\n {2}name: (.+)/g)].map((m) => [m[2]!.trim(), m[1]!]))
  const answer = modelAnswers.get(message)
  const serviceId = answer?.serviceId ?? (answer?.service ? ids.get(answer.service) ?? null : null)
  const json = answer?.service || answer?.serviceId
    ? { wants_price: true, service_id: serviceId, confidence: answer.confidence ?? 0.95, job_described: answer.described ?? true }
    : { wants_price: false, service_id: null, confidence: 0.95, job_described: false }
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: 'STOP' }] }
}

/** photos and files "on Meta's servers", by media id */
const media = new Map<string, { bytes: Buffer; type: string }>()
const days = (n: number) => Math.floor(Date.now() / 1000) + n * 86_400

function newAccount(opts: { onBizApp?: boolean } = {}): MockAccount {
  const token = `EAAmock${crypto.randomBytes(18).toString('hex')}`
  secretsSeen.add(token)
  const account: MockAccount = {
    token,
    wabaId: metaId(),
    businessId: metaId(),
    number: { id: metaId(), display: `+1 415-555-01${String(crypto.randomInt(10, 99))}`, name: 'Kent Garage Doors', onBizApp: Boolean(opts.onBizApp) },
    expiresAt: days(60),
    templates: [],
    refuseTemplatesWith: null,
  }
  accounts.set(token, account)
  return account
}
function newCode(account: MockAccount): string {
  const code = `AQmock${crypto.randomBytes(24).toString('hex')}`
  secretsSeen.add(code)
  codes.set(code, account.token)
  return code
}
const template = (over: Partial<MockTemplate> = {}): MockTemplate => ({ id: metaId(), name: TEMPLATE_NAME, language: 'en_US', status: 'APPROVED', category: 'UTILITY', rejected_reason: 'NONE', components: [{ type: 'BODY', text: 'Your estimate from Bluum Painting is ready. Open it here: {{1}}\n\nThank you for asking Bluum Painting for a price.' }], ...over })

const mock = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${MOCK_PORT}`)
    const query = Object.fromEntries(url.searchParams)
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '') || null
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
    const refuse = (status: number, code: number, message: string) => send(status, { error: { message, type: 'OAuthException', code } })
    const parts = url.pathname.split('/').filter(Boolean)
    const version = parts.shift()
    // the AI model's stand-in
    if (version === 'ai') return send(200, modelReply(String(((body?.contents as Array<{ parts?: Array<{ text?: string }> }> | undefined)?.[0]?.parts?.[0]?.text) ?? '')))
    calls.push({ method: req.method ?? 'GET', path: `/${parts.join('/')}`, query, token, body })
    if (version !== 'v27.0') return refuse(400, 2635, `unexpected Graph API version ${version}`)

    if (parts[0] === 'oauth' && parts[1] === 'access_token') {
      if (query.client_id !== APP_ID || query.client_secret !== APP_SECRET) return refuse(400, 101, 'Error validating application.')
      const forToken = codes.get(query.code ?? '')
      if (!forToken) return refuse(400, 100, 'This authorization code has expired.')
      codes.delete(query.code as string)
      return send(200, { access_token: forToken, token_type: 'bearer' })
    }
    if (parts[0] === 'debug_token') {
      const account = accounts.get(query.input_token ?? '')
      if (!account) return send(200, { data: { is_valid: false, app_id: APP_ID } })
      return send(200, { data: { app_id: APP_ID, type: 'SYSTEM_USER', is_valid: true, expires_at: account.expiresAt, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'], granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: [account.wabaId] }, { scope: 'whatsapp_business_messaging', target_ids: [account.wabaId] }] } })
    }

    const account = token ? accounts.get(token) : undefined
    if (!account) return refuse(401, 190, 'Invalid OAuth access token.')
    const [node, edge] = parts
    const n = account.number
    const numberJson = { id: n.id, display_phone_number: n.display, verified_name: n.name, is_on_biz_app: n.onBizApp, platform_type: 'CLOUD_API', quality_rating: 'GREEN' }

    // a photo or file a customer sent: first its address, then its bytes
    if (node === '_media' && edge && media.has(edge)) {
      const file = media.get(edge)!
      res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': String(file.bytes.length) })
      return res.end(file.bytes)
    }
    if (node && media.has(node) && !edge) return send(200, { url: `http://127.0.0.1:${MOCK_PORT}/v27.0/_media/${node}`, mime_type: media.get(node)!.type, id: node })

    if (node === account.wabaId) {
      if (edge === 'phone_numbers') return send(200, { data: [numberJson] })
      if (edge === 'subscribed_apps') return send(200, { success: true })
      if (!edge) return send(200, { id: account.wabaId })
      if (edge === 'message_templates') {
        if (account.refuseTemplatesWith) return refuse(400, account.refuseTemplatesWith, 'Meta refused the template call. (stand-in)')
        if (req.method === 'GET') {
          const wanted = (query.fields ?? 'id,name').split(',')
          return send(200, { data: account.templates.filter((t) => !query.name || t.name === query.name).map((t) => Object.fromEntries(Object.entries(t).filter(([key]) => wanted.includes(key)))) })
        }
        if (req.method === 'POST') {
          if (account.templates.some((t) => t.name === body?.name && t.language === body?.language)) return refuse(400, 100, 'Content in This Language Already Exists')
          const created = template({ name: String(body?.name), language: String(body?.language), status: 'PENDING', components: (body?.components as Row[]) ?? [] })
          account.templates.push(created)
          return send(200, { id: created.id, status: created.status, category: created.category })
        }
      }
    }
    if (node === n.id) {
      if (!edge) return send(200, query.fields === 'name_status' ? { id: n.id, name_status: 'APPROVED' } : numberJson)
      if (edge === 'register') return send(200, { success: true })
      if (edge === 'smb_app_data') return send(200, { messaging_product: 'whatsapp', request_id: `req_${shortId()}` })
      if (edge === 'messages') {
        const id = `wamid.out.${shortId()}${shortId()}`
        sent.push({ token: account.token, to: String(body?.to ?? ''), type: String(body?.type ?? ''), text: (body?.text as { body?: string } | undefined)?.body ?? '', id })
        return send(200, { messaging_product: 'whatsapp', contacts: [{ input: body?.to, wa_id: body?.to }], messages: [{ id, message_status: 'accepted' }] })
      }
    }
    return refuse(400, 100, `Unsupported get request. Object with ID '${node}' does not exist, cannot be loaded due to missing permissions.`)
  })
})
await new Promise<void>((resolve, reject) => mock.once('error', reject).listen(MOCK_PORT, '127.0.0.1', resolve))
const templateCalls = (account: MockAccount, method: string) => calls.filter((c) => c.path === `/${account.wabaId}/message_templates` && c.method === method)

function finish(): never {
  mock.close()
  const failed = checks.filter((c) => !c.pass)
  if (notChecked.length) console.log(`\nNot checked:\n${notChecked.map((n) => `  - ${n}`).join('\n')}`)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}

// =====================================================================================
// Helpers
// =====================================================================================
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const rest = (method: string, pathAndQuery: string, body?: Row) => call(method, `${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`, { headers: { ...admin, Prefer: 'return=minimal' }, ...(body && { body }) })
/** Put a business on a plan (or on none) */
async function setPlan(tenantId: string, planId: string | null, status = 'active') {
  await rest('DELETE', `subscriptions?tenant_id=eq.${tenantId}`)
  if (planId) await sb.insert('subscriptions', { tenant_id: tenantId, plan_id: planId, status })
}
async function business(name: string, opts: { plan?: string | null; tenant?: Row } = {}) {
  const id = shortId()
  const email = `owner+t177-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [], ...opts.tenant } }))
  if (opts.plan !== null) await setPlan(tenantId, opts.plan ?? WITH_WHATSAPP)
  return { cookie, cookieHeader, tenantId, name }
}
type Biz = Awaited<ReturnType<typeof business>>
async function addService(biz: Biz, index: number, over: { minPhotos?: number } = {}) {
  const svc = garageDoorsPackUS.services[index]!
  const created = expectOk('service', await call('POST', `${app}/api/services`, {
    headers: biz.cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: over.minPhotos ?? 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft,
    },
  }))
  return created.service.id as string
}
const connect = (biz: Biz, account: MockAccount, extra: Row = {}) =>
  call('POST', `${app}/api/whatsapp/connect`, { headers: biz.cookie, body: { code: newCode(account), wabaId: account.wabaId, phoneNumberId: account.number.id, businessId: account.businessId, ...extra } })
const configOf = (biz: Biz) => call('GET', `${app}/api/whatsapp/config`, { headers: biz.cookie })
const templateOf = (biz: Biz) => call('GET', `${app}/api/whatsapp/template`, { headers: biz.cookie })
const rowOf = async (biz: Biz) => ((await sb.select('whatsapp_configs', `tenant_id=eq.${biz.tenantId}&select=phone_number_id,number_kind,is_active`)) as Row[])[0] ?? null

const sign = (raw: string, secret: string) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
async function webhook(account: MockAccount, field: string, value: Row, secret: string = APP_SECRET) {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: account.wabaId, changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { display_phone_number: account.number.display.replace(/\D/g, ''), phone_number_id: account.number.id }, ...value } }] }],
  })
  const res = await fetch(`${app}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw, secret) }, body: raw })
  return res.status
}
const messageId = () => `wamid.in.${shortId()}${shortId()}`
/** A customer writes to the business's number; resolves once the app has dealt with it. Returns what the assistant sent back. */
async function says(account: MockAccount, from: string, text: string, profileName: string | null = 'Megan Grant'): Promise<string[]> {
  const before = sent.length
  const status = await webhook(account, 'messages', { contacts: [{ ...(profileName && { profile: { name: profileName } }), wa_id: from }], messages: [{ id: messageId(), from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] })
  if (status !== 200) throw new Error(`webhook answered ${status}`)
  return sent.slice(before).filter((m) => m.to === from).map((m) => m.text)
}
async function sendsPhoto(account: MockAccount, from: string, mediaId: string, mimeType = 'image/jpeg', caption?: string): Promise<string[]> {
  const before = sent.length
  const image = { id: mediaId, mime_type: mimeType, ...(caption && { caption }) }
  const type = mimeType.startsWith('image/') ? 'image' : 'document'
  await webhook(account, 'messages', { contacts: [{ profile: { name: 'Megan Grant' }, wa_id: from }], messages: [{ id: messageId(), from, timestamp: String(Math.floor(Date.now() / 1000)), type, [type]: image }] })
  return sent.slice(before).filter((m) => m.to === from).map((m) => m.text)
}
/** The business itself replies to a customer from the WhatsApp Business app */
const ownerReplies = (account: MockAccount, to: string, id = `wamid.echo.${shortId()}`, secret: string = APP_SECRET) =>
  webhook(account, 'smb_message_echoes', { message_echoes: [{ from: account.number.display.replace(/\D/g, ''), to, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'I will call you this afternoon about the back door' } }] }, secret)

const chats = async (biz: Biz, phone: string) => (await sb.select('whatsapp_conversations', `tenant_id=eq.${biz.tenantId}&customer_phone=eq.${phone}&select=id,status,intake_state,intake_data,quote_request_id&order=created_at`)) as Row[]
const messagesOf = async (biz: Biz, phone: string) => (await sb.select('whatsapp_messages', `tenant_id=eq.${biz.tenantId}&or=(from_phone.eq.${phone},to_phone.eq.${phone})&select=direction,content,media_url,status&order=created_at`)) as Row[]
const linkIn = (text: string) => /https?:\/\/[^\s/]+\/q\/[A-Za-z0-9_-]+\?token=[A-Za-z0-9_-]+/.exec(text)?.[0] ?? null
const MENU = /reply (with|“|")|^\s*\d+[.)]\s|\n\s*\d+[.)]\s|press \d|option \d/i
/** A JPEG of this size (a made-up photo: two flat colours) */
function photo(width: number, height: number, quality = 85): Buffer {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const left = i % width < width / 2
    data[i * 4] = left ? 200 : 40
    data[i * 4 + 1] = 90
    data[i * 4 + 2] = left ? 40 : 200
    data[i * 4 + 3] = 255
  }
  return jpeg.encode({ width, height, data }, quality).data
}

// =====================================================================================
section('0. The web app is running against the stand-in')
const probe = await business(`Probe ${shortId()}`)
const probed = expectOk('config', await configOf(probe))
const handshake = await fetch(`${app}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4242`)
if (probed.connect?.appId !== APP_ID || probed.connect?.configId !== CONFIG_ID || !probed.connect?.available || handshake.status !== 200) {
  console.error('\nThe web app is not running with the local WhatsApp test settings. Start it as the top of this file says, then run again.')
  check('the web app runs with the local test settings', false, { connect: probed.connect, handshake: handshake.status })
  finish()
}
check('the web app runs with the local test settings', true)
const REPLACEMENT = garageDoorsPackUS.services[0]!.name
const SPRINGS = garageDoorsPackUS.services[1]!.name

// =====================================================================================
section('1. Items 5 and 7: only a plan with WhatsApp, with a live subscription')
const withNames = offeredPlansWithChannel('whatsapp').map((p) => p.name)
const F = await business(`Free Doors ${shortId()}`, { plan: null })
const accF = newAccount()
const freeConfig = expectOk('config', await configOf(F))
check('no plan (the free allowance): the page is told WhatsApp is not included, in one line that names the plans that have it', freeConfig.access?.allowed === false && freeConfig.access?.why === 'plan' && withNames.every((n) => String(freeConfig.access?.line).includes(n)), freeConfig.access)
const callsBefore = calls.length
const freeConnect = await connect(F, accF)
check('…and it cannot connect: 403, nothing is sent to Meta, nothing is saved', freeConnect.status === 403 && freeConnect.json?.error?.code === 'PLAN_REQUIRED' && calls.length === callsBefore && (await rowOf(F)) === null, freeConnect.json)
const freeManual = await call('PUT', `${app}/api/whatsapp/config`, { headers: F.cookie, body: { phoneNumberId: accF.number.id, accessToken: accF.token, appSecret: 'own-secret' } })
check('…by the manual method either', freeManual.status === 403 && (await rowOf(F)) === null, freeManual.status)

await setPlan(F.tenantId, WITHOUT_WHATSAPP)
const lowConfig = expectOk('config', await configOf(F))
check('a plan without WhatsApp: the same upgrade line, and no connect', lowConfig.access?.why === 'plan' && (await connect(F, accF)).status === 403, lowConfig.access)

await setPlan(F.tenantId, WITH_WHATSAPP)
const okConfig = expectOk('config', await configOf(F))
const okConnect = await connect(F, accF)
check('a plan with WhatsApp, subscription live: allowed, and it connects', okConfig.access?.allowed === true && okConfig.access?.line === null && okConnect.ok && (await rowOf(F))?.phone_number_id === accF.number.id, okConfig.access)

// lapsed: silent everywhere, the connection kept
await addService(F, 0)
const lapsedPhone = customer(1)
// the model WOULD say these are price requests: the silence below is the plan's doing, and the model is never asked
modelAnswers.set('Hi, how much would a new single steel garage door cost, 9 ft wide, installed?', { service: REPLACEMENT })
modelAnswers.set('How much for a new double garage door?', { service: REPLACEMENT })
// the one status the database has that is not live: cancelled
for (const status of ['canceled'] as const) {
  await setPlan(F.tenantId, WITH_WHATSAPP, status)
  const lapsed = expectOk('config', await configOf(F))
  const sentBefore = sent.length
  const reply = await says(accF, lapsedPhone, 'Hi, how much would a new single steel garage door cost, 9 ft wide, installed?')
  const test = await call('POST', `${app}/api/whatsapp/send`, { headers: F.cookie, body: { toPhone: `+${lapsedPhone}`, message: 'A test message.' } })
  check(`subscription ${status}: the page shows the one line, the assistant does not answer a price request, and no test message goes out`, lapsed.access?.allowed === false && lapsed.access?.why === 'subscription' && lapsed.access?.line === 'Your WhatsApp assistant is paused until your plan is active again.' && reply.length === 0 && test.status === 403 && test.json?.error?.code === 'ASSISTANT_PAUSED' && sent.length === sentBefore, { access: lapsed.access, replies: reply.length, test: test.status })
}
check('the connection is kept, not disconnected', (await rowOf(F))?.is_active === true && expectOk('config', await configOf(F)).configured === true)
const keptWhilePaused = await messagesOf(F, lapsedPhone)
check('a message that arrives while paused is kept without its text (the 24 hours still count from it)', keptWhilePaused.length === 1 && keptWhilePaused.every((m) => m.direction === 'inbound' && m.content === null), keptWhilePaused)
check('while paused the AI model is not even asked', modelAsked.length === 0, modelAsked.length)
await setPlan(F.tenantId, WITHOUT_WHATSAPP)
check('an existing connection on a plan without WhatsApp goes silent too, and is kept', (await says(accF, lapsedPhone, 'How much for a new double garage door?')).length === 0 && (await rowOf(F))?.is_active === true && modelAsked.length === 0)
await setPlan(F.tenantId, WITH_WHATSAPP, 'trialing')
check('a subscription on trial counts as active', expectOk('config', await configOf(F)).access?.allowed === true)
await setPlan(F.tenantId, WITH_WHATSAPP, 'past_due')
check('a payment that failed and is being retried (past due) does not pause WhatsApp: the same grace as the quote limit', expectOk('config', await configOf(F)).access?.allowed === true)
await setPlan(F.tenantId, WITH_WHATSAPP)

// =====================================================================================
section('2. Item 2: the template is automatic')
check('connecting created the template, once, with no button pressed', templateCalls(accF, 'POST').length === 1 && accF.templates.length === 1 && accF.templates[0]!.name === TEMPLATE_NAME && accF.templates[0]!.status === 'PENDING')
const shownF = (await templateOf(F)).json?.template
check('the page shows it as in review', shownF?.state === 'pending' && String(shownF?.text).includes(`Your estimate from ${F.name} is ready`), shownF)
check('connecting again (a reconnect) finds it and creates nothing', (await connect(F, accF)).ok && templateCalls(accF, 'POST').length === 1 && accF.templates.length === 1)

// a business whose account already has the template (Bluum's case)
const B = await business(`Bluum Painting ${shortId()}`)
const accB = newAccount()
accB.templates.push(template())
const connectB = await connect(B, accB)
const shownB = (await templateOf(B)).json?.template
check('an account that already has the template: it is used, nothing is created, and the page shows Meta’s own copy as Approved', connectB.ok && templateCalls(accB, 'POST').length === 0 && accB.templates.length === 1 && shownB?.state === 'approved' && String(shownB?.text).includes('Bluum Painting is ready'), { posts: templateCalls(accB, 'POST').length, state: shownB?.state })
for (let i = 0; i < 3; i++) await templateOf(B)
check('opening the page again and again creates nothing', templateCalls(accB, 'POST').length === 0 && accB.templates.length === 1)
check('there is no way to ask for a template to be created', [404, 405].includes((await call('POST', `${app}/api/whatsapp/template`, { headers: B.cookie })).status) && accB.templates.length === 1)

// rejected
const R = await business(`Rejected Doors ${shortId()}`)
const accR = newAccount()
accR.templates.push(template({ status: 'REJECTED', rejected_reason: 'PROMOTIONAL' }))
await connect(R, accR)
const shownR = (await templateOf(R)).json?.template
check('a rejected template is shown with Meta’s reason, and no second one is made', shownR?.state === 'rejected' && /advertising/.test(shownR?.reason ?? '') && templateCalls(accR, 'POST').length === 0 && accR.templates.length === 1, shownR)

// Meta cannot be asked at connect
const E = await business(`Erring Doors ${shortId()}`)
const accE = newAccount()
accE.refuseTemplatesWith = 80008
const connectE = await connect(E, accE)
check('if Meta cannot be asked about templates, the connection still succeeds and nothing is created blind', connectE.ok && templateCalls(accE, 'POST').length === 0 && accE.templates.length === 0 && (await rowOf(E)) !== null, connectE.status)
accE.refuseTemplatesWith = null
const shownE = (await templateOf(E)).json?.template
check('…and loading the page afterwards still creates nothing: it says it is not set up yet', shownE?.state === 'none' && templateCalls(accE, 'POST').length === 0, shownE?.state)

// =====================================================================================
section('3. Item 1: the assistant is silent unless a customer asks for a price for something the business offers')
const S = await business(`Kent Garage Doors ${shortId()}`)
await addService(S, 0)
await addService(S, 1)
const accS = newAccount()
expectOk('connect', await connect(S, accS))
const quiet = customer(11)
const silentMessages = [
  'What time do you open tomorrow?',
  'Are you coming tomorrow at 9?',
  'Thanks so much, the door looks great!',
  'I am not happy, the installer left a mess on the drive',
  'Can you call me back please',
  'Do you fit garage doors?',
  'ok',
  'How much would it cost to fix my leaking kitchen tap?',
  'How much to repaint my living room?',
]
// what the stand-in model answers "yes" to; everything else it calls "not a price request"
const firstAsk = 'Hi, how much would a new single steel garage door cost? 9 ft wide, 7 ft tall, installed.'
const secondAsk = 'Actually, how much to replace a broken torsion spring on that door? Just the one spring.'
const vagueAsk = 'Hello, can I get a quote for a new garage door please?'
const detailedAsk = 'How much for a new single steel garage door, 9 by 7, installed?'
const bareAsk = 'Hi, could I get a quote for a new garage door?'
modelAnswers.set(firstAsk, { service: REPLACEMENT, described: true })
modelAnswers.set(secondAsk, { service: SPRINGS, described: true })
modelAnswers.set(vagueAsk, { service: REPLACEMENT, described: false })
modelAnswers.set(detailedAsk, { service: REPLACEMENT, described: true })
modelAnswers.set(bareAsk, { service: REPLACEMENT, described: false })
// a "yes" the assistant must not act on: the model is not sure, or names a service that is not this business's
modelAnswers.set('Roughly what are we talking for the thing we discussed?', { service: REPLACEMENT, confidence: 0.5 })
modelAnswers.set('How much for your premium package?', { service: null, serviceId: 'svc_not_this_business' })
const askedBefore = modelAsked.length
const noise: string[] = []
for (const message of silentMessages) {
  const replies = await says(accS, quiet, message)
  if (replies.length > 0) noise.push(message)
}
check(`${silentMessages.length} messages the model calls "not a price request" get no reply at all (opening hours, timings, thanks, a complaint, a callback, "do you do X", "ok", two other trades)`, noise.length === 0 && modelAsked.length === askedBefore + silentMessages.length, noise)
const unsure = await says(accS, quiet, 'Roughly what are we talking for the thing we discussed?')
const notOurs = await says(accS, quiet, 'How much for your premium package?')
check('a "yes" the model is not sure of, and a "yes" for a service that is not this business’s, get no reply either', unsure.length === 0 && notOurs.length === 0, { unsure, notOurs })
const quietRows = await messagesOf(S, quiet)
check('they are kept without their text: only that each arrived, from whom and when', quietRows.length === silentMessages.length + 2 && quietRows.every((m) => m.direction === 'inbound' && m.content === null && m.media_url === null), quietRows.filter((m) => m.content !== null).length)
const quietChat = await chats(S, quiet)
check('nothing was started for them', quietChat.length === 1 && quietChat[0]!.intake_state === 'idle' && Object.keys((quietChat[0]!.intake_data ?? {}) as Row).length === 0 && quietChat[0]!.quote_request_id === null, quietChat)
media.set('media-quiet', { bytes: photo(640, 480), type: 'image/jpeg' })
const askedBeforePhoto = modelAsked.length
check('a photo with no question gets no reply, is not fetched from Meta, and is not put to the model', (await sendsPhoto(accS, quiet, 'media-quiet')).length === 0 && !calls.some((c) => c.path === '/media-quiet') && modelAsked.length === askedBeforePhoto)

// a price request, everything already known: one reply, with the link
const asker = customer(12)
const asked = await says(accS, asker, firstAsk)
const link = linkIn(asked[0] ?? '')
check('a price request for a service the business offers gets ONE reply, from its own number, with the link to the estimate', asked.length === 1 && Boolean(link) && sent.at(-1)!.token === accS.token && sent.at(-1)!.type === 'text', asked)
check('the reply says who is speaking, names the service, greets by the WhatsApp name, and asks nothing', /^Hi Megan, this is .+’s quoting assistant\. Your estimate for Garage Door Replacement will be here in a moment: /.test(asked[0] ?? '') && !/\?\s*$/.test((asked[0] ?? '').replace(link ?? '', '')), asked[0]?.slice(0, 110))
check('it is not a numbered menu and names no price', !MENU.test(asked[0] ?? '') && !/[$£€]\s?\d/.test(asked[0] ?? ''))
const askerChat = await chats(S, asker)
const askedQuote = ((askerChat[0]?.intake_data ?? {}) as { _quoteId?: string })._quoteId
check('the chat made a request, is finished, and names its quote', askerChat.length === 1 && askerChat[0]!.status === 'completed' && Boolean(askedQuote) && Boolean(askerChat[0]!.quote_request_id), askerChat[0]?.status)
if (link && askedQuote) {
  secretsSeen.add(new URL(link).searchParams.get('token')!)
  const request = ((await sb.select('quote_requests', `id=eq.${askerChat[0]!.quote_request_id}&select=customer_name,customer_email,customer_phone,job_answers,source_json`)) as Row[])[0]
  check('the request carries the WhatsApp name and number, the customer’s own words, and no invented email', request?.customer_name === 'Megan Grant' && request?.customer_phone === asker && request?.customer_email === null && JSON.stringify(request?.job_answers).includes('9 ft wide') && (request?.source_json as Row)?.type === 'whatsapp', { name: request?.customer_name, email: request?.customer_email })
  let status = ''
  for (let i = 0; i < 120 && !['pending_review', 'sent', 'failed'].includes(status); i++) {
    status = String(((await sb.select('quotes', `id=eq.${askedQuote}&select=status`)) as Row[])[0]?.status ?? '')
    if (!['pending_review', 'sent', 'failed'].includes(status)) await new Promise((r) => setTimeout(r, 3000))
  }
  const priced = ((await sb.select('quotes', `id=eq.${askedQuote}&select=status,pricing_json`)) as Row[])[0]
  check('the pricing engine priced it from the business’s price list, like any other request', ['pending_review', 'sent'].includes(String(priced?.status)) && Number((priced?.pricing_json as { total?: number })?.total) > 0, { status: priced?.status, total: (priced?.pricing_json as { total?: number })?.total })
  const opened = await call('GET', `${app}/api/public/quotes/${askedQuote}?token=${encodeURIComponent(new URL(link).searchParams.get('token')!)}`)
  check('the link in the reply opens that estimate', opened.ok, opened.status)
}
const askerRows = await messagesOf(S, asker)
check('the price request’s text is kept with the chat, and the reply is kept without the link’s token', askerRows.length === 2 && askerRows[0]!.content === firstAsk && askerRows[1]!.direction === 'outbound' && !/token=/.test(String(askerRows[1]!.content)) && /will be here in a moment/.test(String(askerRows[1]!.content)), askerRows.map((m) => String(m.content).slice(0, 40)))

// quiet again after the quote
const afterwards = await says(accS, asker, 'Brilliant, thank you!')
const afterChats = await chats(S, asker)
check('once the link is sent it goes quiet again in that chat', afterwards.length === 0 && afterChats.length === 2 && afterChats[1]!.intake_state === 'idle', afterChats.map((c) => `${c.status}/${c.intake_state}`))
const again = await says(accS, asker, secondAsk)
check('…until a new price request, which starts a new request for the service it is about', again.length === 1 && /Garage Door Spring Replacement/.test(again[0] ?? '') && Boolean(linkIn(again[0] ?? '')), again[0]?.slice(0, 100))
if (linkIn(again[0] ?? '')) secretsSeen.add(new URL(linkIn(again[0]!)!).searchParams.get('token')!)

// a price request that does not describe the job: one short question
const vague = customer(13)
const vagueFirst = await says(accS, vague, vagueAsk, null)
check('a price request that does not say what the job is gets one short question (and, with no WhatsApp name, no name in the greeting)', vagueFirst.length === 1 && /^Hi, this is .+’s quoting assistant\. I can get you a price for Garage Door Replacement\. What needs doing\? Sizes or quantities help\.$/.test(vagueFirst[0] ?? '') && !MENU.test(vagueFirst[0] ?? ''), vagueFirst)
const askedBeforeAnswer = modelAsked.length
const vagueSecond = await says(accS, vague, 'A double door, 16 ft wide by 7 ft, insulated steel', null)
check('with no name from WhatsApp, the name is the next and only other question', vagueSecond.length === 1 && vagueSecond[0] === 'What name should I put on the estimate?', vagueSecond)
const vagueThird = await says(accS, vague, 'Megan Grant', null)
check('an answer to the assistant’s own question is not put to the model', modelAsked.length === askedBeforeAnswer)
check('then the link: three short replies in all, and no confirmation step', vagueThird.length === 1 && Boolean(linkIn(vagueThird[0] ?? '')) && /^Thanks, Megan\. Your estimate from /.test(vagueThird[0] ?? ''), vagueThird[0]?.slice(0, 80))
if (linkIn(vagueThird[0] ?? '')) secretsSeen.add(new URL(linkIn(vagueThird[0]!)!).searchParams.get('token')!)

// an answer that cannot be used: asked once more, then silence
const mumbler = customer(14)
await says(accS, mumbler, vagueAsk)
const again1 = await says(accS, mumbler, 'yes')
const again2 = await says(accS, mumbler, 'hm')
const mumblerChat = (await chats(S, mumbler)).at(-1)
check('an answer it cannot use is asked for once more, then it goes quiet and keeps nothing of the request', again1.length === 1 && again2.length === 0 && mumblerChat?.intake_state === 'idle' && Object.keys((mumblerChat?.intake_data ?? {}) as Row).length === 0, { again1, again2: again2.length, state: mumblerChat?.intake_state })

// =====================================================================================
section('4. Item 1: a business whose settings ask for more (an email as well, a service area, photos)')
const D = await business(`Gateway Doors ${shortId()}`, { tenant: { serviceAreaMode: 'postcode_allowlist', serviceAreaValues: ['630', '631'], contactRequirement: 'both' } })
await addService(D, 0, { minPhotos: 2 })
const accD = newAccount()
expectOk('connect', await connect(D, accD))
const full = customer(21)
const step1 = await says(accD, full, detailedAsk)
check('it asks for an email, because this business requires both an email and a phone', step1.length === 1 && /What email address should the estimate go to\?$/.test(step1[0] ?? ''), step1)
const step2 = await says(accD, full, 'megan.grant@example.com')
check('then for the ZIP code, because this business limits where it works', step2.length === 1 && step2[0] === 'What’s the ZIP code for the job?', step2)
const step3 = await says(accD, full, '12 Elm Street, St Louis, MO 63021')
check('then for photos, because the service requires two', step3.length === 1 && /^Could you send 2 photos of the job\?/.test(step3[0] ?? ''), step3)
media.set('media-a', { bytes: photo(1600, 1200), type: 'image/jpeg' })
media.set('media-b', { bytes: photo(1200, 1600), type: 'image/jpeg' })
const photo1 = await sendsPhoto(accD, full, 'media-a')
const photo2 = await sendsPhoto(accD, full, 'media-b')
check('it waits quietly for the photos, and says so once there are enough', photo1.length === 0 && photo2.length === 1 && /Send any more photos now/.test(photo2[0] ?? ''), { photo1, photo2 })
const step4 = await says(accD, full, 'that’s all')
const fullLink = linkIn(step4[0] ?? '')
check('any word then sends the link', step4.length === 1 && Boolean(fullLink), step4[0]?.slice(0, 80))
const fullChat = (await chats(D, full))[0]
const fullData = (fullChat?.intake_data ?? {}) as { _quoteId?: string; assetIds?: string[]; customerEmail?: string; jobPostcode?: string }
check('the request carries the email, the ZIP code and both photos', fullData.customerEmail === 'megan.grant@example.com' && fullData.jobPostcode === '63021' && fullData.assetIds?.length === 2, { email: fullData.customerEmail, zip: fullData.jobPostcode, photos: fullData.assetIds?.length })
if (fullLink) secretsSeen.add(new URL(fullLink).searchParams.get('token')!)

const far = customer(22)
await says(accD, far, detailedAsk)
await says(accD, far, 'megan.far@example.com')
const outside = await says(accD, far, 'We are in 90210')
const farChat = (await chats(D, far)).at(-1)
check('a job outside the business’s area is turned away in one line, and nothing is kept of the request', outside.length === 1 && /doesn’t cover that area\.$/.test(outside[0] ?? '') && farChat?.intake_state === 'idle' && Object.keys((farChat?.intake_data ?? {}) as Row).length === 0, outside)

// =====================================================================================
section('5. Item 8: a photo sent in a chat is kept privately, within the upload limits, with a small copy')
if (fullData._quoteId && fullData.assetIds?.length === 2) {
  const assets = (await sb.select('assets', `id=in.(${fullData.assetIds.join(',')})&select=id,type,content_type,size_bytes,r2_key&order=created_at`)) as Row[]
  check('each photo is an asset of the business, stored under its own private folder', assets.length === 2 && assets.every((a) => a.type === 'image' && a.content_type === 'image/jpeg' && String(a.r2_key).startsWith(`whatsapp/${D.tenantId}/`)), assets.map((a) => a.content_type))
  const served = async (assetId: string, size?: string, cookie: Row = D.cookie) => {
    const res = await fetch(`${app}/api/quotes/${fullData._quoteId}/photos/${assetId}${size ? `?size=${size}` : ''}`, { headers: cookie as Record<string, string>, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status !== 302 || !location) return { status: res.status, key: null as string | null, bytes: null as Buffer | null }
    const file = await fetch(location)
    return { status: res.status, key: new URL(location).pathname, bytes: file.ok ? Buffer.from(await file.arrayBuffer()) : null }
  }
  for (const [index, asset] of assets.entries()) {
    const small = await served(String(asset.id), 'small')
    const original = await served(String(asset.id))
    const smallSize = small.bytes ? jpeg.decode(small.bytes, { useTArray: true }) : null
    const originalSize = original.bytes ? jpeg.decode(original.bytes, { useTArray: true }) : null
    check(
      `photo ${index + 1}: the small size is its own small copy (${smallSize?.width}×${smallSize?.height}, ${small.bytes?.length} bytes), the larger view the untouched original (${originalSize?.width}×${originalSize?.height}, ${original.bytes?.length} bytes)`,
      small.key?.endsWith(`${asset.r2_key}.small`) === true && original.key?.endsWith(String(asset.r2_key)) === true && !!smallSize && Math.max(smallSize.width, smallSize.height) === 480 && !!originalSize && Math.max(originalSize.width, originalSize.height) === 1600 && (small.bytes?.length ?? 0) <= 200 * 1024 && (small.bytes?.length ?? 0) < (original.bytes?.length ?? 0) && original.bytes?.length === asset.size_bytes
    )
  }
  const stranger = await fetch(`${app}/api/quotes/${fullData._quoteId}/photos/${assets[0]!.id}?size=small`, { redirect: 'manual' })
  const rival = await fetch(`${app}/api/quotes/${fullData._quoteId}/photos/${assets[0]!.id}?size=small`, { headers: S.cookie, redirect: 'manual' })
  check('storage stays private: signed out gets 401 and another business 404, for the small copy as for the original', stranger.status === 401 && rival.status === 404, { stranger: stranger.status, rival: rival.status })
} else check('the photos could be read back', false, fullData)

// the limits
const limits = customer(23)
await says(accD, limits, detailedAsk)
await says(accD, limits, 'megan.limits@example.com')
await says(accD, limits, '63021')
media.set('media-video', { bytes: Buffer.alloc(4000, 1), type: 'video/mp4' })
media.set('media-huge', { bytes: Buffer.concat([photo(64, 64), Buffer.alloc(10 * 1024 * 1024 + 1, 0)]), type: 'image/jpeg' })
const assetsBefore = ((await sb.select('assets', `tenant_id=eq.${D.tenantId}&select=id`)) as Row[]).length
const video = await sendsPhoto(accD, limits, 'media-video', 'video/mp4')
const huge = await sendsPhoto(accD, limits, 'media-huge')
const assetsAfter = ((await sb.select('assets', `tenant_id=eq.${D.tenantId}&select=id`)) as Row[]).length
check('a file of a type the request form does not take, and a photo over its 10 MB limit, are not kept, and the customer is told in one line', assetsAfter === assetsBefore && /couldn’t use that file/.test(video[0] ?? '') && /couldn’t use that file/.test(huge[0] ?? ''), { video, huge, kept: assetsAfter - assetsBefore })

// =====================================================================================
section('6. Item 1: the owner takes over (Meta’s echo of a message sent from the WhatsApp Business app)')
const O = await business(`Owner Doors ${shortId()}`)
await addService(O, 0)
const accO = newAccount({ onBizApp: true })
// v5's finish message: the account in messaging_account_ids, and is_on_biz_app
const v5Connect = await call('POST', `${app}/api/whatsapp/connect`, { headers: O.cookie, body: { code: newCode(accO), wabaId: accO.wabaId, phoneNumberId: accO.number.id, businessId: accO.businessId, onBusinessApp: true } })
check('item 6: a number that stays on the WhatsApp Business app connects (v5 turns that option on by default) and is not registered again', v5Connect.ok && (await rowOf(O))?.number_kind === 'business_app' && !calls.some((c) => c.path === `/${accO.number.id}/register`), v5Connect.status)
const talked = customer(31)
check('the echo arrives, signed', (await ownerReplies(accO, talked)) === 200)
const askedBeforePause = modelAsked.length
const pausedReply = await says(accO, talked, detailedAsk)
const askedDuringPause = modelAsked.length - askedBeforePause
const pausedChat = (await chats(O, talked)).at(-1)
check('after the owner replies to a customer from the app, a price request in that chat gets no reply (and is not put to the model)', pausedReply.length === 0 && askedDuringPause === 0 && Boolean(((pausedChat?.intake_data ?? {}) as { _ownerRepliedAt?: string })._ownerRepliedAt), pausedReply)
check('only the customer’s number and the time are kept of the owner’s message, never its words', !JSON.stringify(await chats(O, talked)).includes('back door') && !JSON.stringify(await messagesOf(O, talked)).includes('back door'))
// 24 hours later
await rest('PATCH', `whatsapp_conversations?id=eq.${pausedChat!.id}`, { intake_data: { _ownerRepliedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() } })
const resumed = await says(accO, talked, detailedAsk)
check('24 hours after the owner’s reply it listens again', resumed.length === 1 && Boolean(linkIn(resumed[0] ?? '')), resumed[0]?.slice(0, 60))
if (linkIn(resumed[0] ?? '')) secretsSeen.add(new URL(linkIn(resumed[0]!)!).searchParams.get('token')!)

// the owner steps in while the assistant is asking
const midway = customer(32)
const midFirst = await says(accO, midway, bareAsk)
await ownerReplies(accO, midway)
const midSecond = await says(accO, midway, 'A double door, 16 ft wide by 7 ft, insulated steel')
const midChat = (await chats(O, midway)).at(-1)
check('if the owner steps in while the assistant is asking, it stops asking and drops the request', midFirst.length === 1 && midSecond.length === 0 && midChat?.intake_state === 'idle' && !('serviceId' in ((midChat?.intake_data ?? {}) as Row)), { state: midChat?.intake_state })
// not signed by our app, and our own messages
const forged = customer(33)
check('an echo that is not signed by the app is refused (401) and pauses nothing', (await ownerReplies(accO, forged, undefined, 'someone-elses-secret')) === 401 && (await chats(O, forged)).length === 0)
const ours = customer(34)
const ourReply = await says(accO, ours, bareAsk)
await ownerReplies(accO, ours, sent.at(-1)!.id)
const carriedOn = await says(accO, ours, 'A double door, 16 ft wide by 7 ft, insulated steel')
check('a message the assistant sent is not mistaken for the owner taking over', ourReply.length === 1 && carriedOn.length === 1, { carriedOn })
if (linkIn(carriedOn[0] ?? '')) secretsSeen.add(new URL(linkIn(carriedOn[0]!)!).searchParams.get('token')!)

// =====================================================================================
section('7. Item 9: the Privacy and Terms pages')
const pageText = async (route: string) => (await (await fetch(`${app}${route}`)).text()).replace(/<!-- -->/g, '').replace(/&#x27;|&#39;|&rsquo;/g, '’').replace(/&amp;/g, '&')
const terms = await pageText('/terms')
const privacy = await pageText('/privacy')
const operator = /Qolumns is run by Billiom Limited, a company registered in England and Wales( \(company number [^)]+\))?\./
check('both pages say who runs the product', operator.test(terms) && operator.test(privacy))
check('both carry the new date', terms.includes('Last updated: 17 November 2026') && privacy.includes('Last updated: 17 November 2026'))
check('the Terms name the governing law', terms.includes('These terms are governed by the law of England and Wales.'))
check('the Terms have the WhatsApp section: a number the business owns, WhatsApp’s policies, and that the assistant may be paused', /10\. WhatsApp/.test(terms) && /a number your business owns and has the right to use/.test(terms) && /WhatsApp Business Messaging Policy and the WhatsApp Commerce Policy/.test(terms) && /may pause the assistant on your number if Meta restricts or suspends it/.test(terms))
check('the Privacy page says what happens to a WhatsApp message that is not a price request', /its text is not kept/.test(privacy))

// =====================================================================================
section('8. Nothing secret or personal in the web app’s log')
const logFile = process.env.WEB_LOG
if (logFile && existsSync(logFile)) {
  // The dev server prints the address of every request it serves; those lines are its own, not the app's logging.
  const log = readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S* \d{3} in \d+/.test(line))
    .join('\n')
  const leaked = [...secretsSeen].filter((s) => log.includes(s))
  check(`no token, code, secret or estimate link is in the log (${secretsSeen.size} values looked for)`, leaked.length === 0, leaked.map((s) => `${s.slice(0, 6)}…`))
  const phones = [quiet, asker, vague, mumbler, full, far, limits, talked, midway, ours, lapsedPhone].filter((p) => log.includes(p))
  // a two-letter message such as "ok" is in any log as part of other words, so only whole sentences are looked for
  const words = [...silentMessages.filter((m) => m.length >= 12), firstAsk, 'megan.grant@example.com', 'back door', '12 Elm Street'].filter((w) => log.includes(w))
  check('no customer’s number, message, email or address is in the log, and none of the owner’s own words', phones.length === 0 && words.length === 0, { phones, words })
} else notChecked.push('The web app’s log (set WEB_LOG to its file).')

// =====================================================================================
section('9. The page, in a browser (items 2, 3, 4, 5, 6 and 7)')
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The WhatsApp page in a browser (set PLAYWRIGHT_DIR).')
  finish()
}
const { browserDeps } = await import('./browser.mjs')
const { chromium } = browserDeps()
const browser = await chromium.launch()
const SDK_STUB = `
  window.__fb = { inits: [], logins: [] };
  window.FB = {
    init(options) { window.__fb.inits.push(options) },
    login(callback, options) {
      window.__fb.logins.push(options);
      const plan = window.__fbPlan || {};
      setTimeout(() => {
        if (plan.message) window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(plan.message), origin: 'https://www.facebook.com' }));
        setTimeout(() => callback(plan.code ? { authResponse: { code: plan.code } } : { authResponse: null, status: 'unknown' }), 40);
      }, 40);
    },
  };
  if (window.fbAsyncInit) window.fbAsyncInit();
`
const JUNIPER = 'rgb(32, 94, 86)'
const YELLOW = 'rgb(255, 197, 61)'
for (const width of [390, 1440]) {
  const P = await business(`Page Business ${shortId()}`, { plan: null })
  const accP = newAccount({ onBizApp: true })
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  await ctx.addInitScript('globalThis.__name = (f) => f')
  await ctx.addCookies(P.cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: app })))
  await ctx.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB }))
  const p = await ctx.newPage()
  const pageErrors: string[] = []
  p.on('pageerror', (error) => pageErrors.push(error.message))
  const flat = async (selector: string) => (await p.locator(selector).innerText()).replace(/\s+/g, ' ').trim()
  const sideways = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const open = async () => {
    await p.goto(`${app}/app/whatsapp`, { waitUntil: 'networkidle' })
    await p.locator('h1').first().waitFor({ timeout: 30_000 })
  }

  // --- item 7: a plan without WhatsApp
  await open()
  await p.locator('[data-testid=whatsapp-upgrade]').waitFor({ timeout: 15_000 })
  const upgrade = await flat('[data-testid=access-line]')
  check(`${width}: a plan without WhatsApp sees one upgrade line naming the plans that have it, a way to the plans, and no connect button`, withNames.every((n) => upgrade.includes(n)) && (await p.locator('[data-testid=connect-whatsapp]').count()) === 0 && (await p.locator('[data-testid=manual-section]').count()) === 0 && (await p.getByRole('link', { name: 'See plans' }).getAttribute('href')) === '/app/settings/billing', upgrade)
  await p.screenshot({ path: path.join(outDir, `whatsapp-upgrade-${width}.png`), fullPage: true })

  // --- item 4: before connecting
  await setPlan(P.tenantId, WITH_WHATSAPP)
  await open()
  const button = p.locator('[data-testid=connect-whatsapp]')
  await button.waitFor({ timeout: 30_000 })
  const notConnected = await flat('[data-testid=whatsapp-not-connected]')
  const warning = 'Use your business WhatsApp number. Don’t connect a personal number, it can stop working in the normal WhatsApp app.'
  check(`${width}: before connecting, the page says the personal number warning once, in the owner’s words, with the text about Meta’s window`, notConnected.split(warning).length === 2 && (await p.locator('body').innerText()).replace(/\s+/g, ' ').split(warning).length === 2 && notConnected.indexOf('Meta opens in a small window') < notConnected.indexOf(warning), notConnected.slice(0, 120))
  check(`${width}: there is no question to answer first, no popup, and the button is ready`, (await p.locator('[data-testid=number-question]').count()) === 0 && (await p.locator('input[type=radio]').count()) === 0 && (await p.locator('[role=dialog]').count()) === 0)
  await p.waitForFunction(() => !(document.querySelector('[data-testid=connect-whatsapp]') as HTMLButtonElement).disabled, null, { timeout: 15_000 })
  const look = await button.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, h: Math.round(el.getBoundingClientRect().height) }))
  check(`${width}: “Connect WhatsApp” is juniper, 44 high or more, and nothing scrolls sideways`, look.bg === JUNIPER && look.h >= 44 && (await sideways()) <= 0, look)
  await p.screenshot({ path: path.join(outDir, `whatsapp-not-connected-${width}.png`), fullPage: true })

  // --- item 6: v5
  await p.evaluate((v) => { (window as unknown as { __fbPlan: unknown }).__fbPlan = v }, { message: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { phone_number_id: accP.number.id, is_on_biz_app: true, messaging_account_ids: [accP.wabaId], primary_waac_ids: [], business_id: accP.businessId } }, code: newCode(accP) } as Row)
  await button.click()
  await p.locator('[data-testid=whatsapp-connected]').waitFor({ timeout: 30_000 })
  const login = (await p.evaluate(() => (window as unknown as { __fb: { logins: Array<{ config_id: string; extras: Row }> } }).__fb.logins)).at(-1)!
  check(`${width}: Meta’s window is opened as Embedded Signup v5 with our configuration, and v5’s finish message connects the number`, login.config_id === CONFIG_ID && login.extras.version === 'v5' && !('featureType' in login.extras) && (await rowOf(P))?.number_kind === 'business_app', login)

  // --- item 2: the template, with no button
  await p.locator('[data-testid=template-card]').waitFor({ timeout: 15_000 })
  await p.locator('[data-testid=template-status]').waitFor({ timeout: 15_000 })
  check(`${width}: connecting set the template up by itself: the page shows “In review with Meta”, and there is no button to create or refresh it`, (await flat('[data-testid=template-status]')) === 'In review with Meta' && accP.templates.length === 1 && (await p.locator('[data-testid=message-templates] button').count()) === 0)
  accP.templates[0]!.status = 'REJECTED'
  accP.templates[0]!.rejected_reason = 'INVALID_FORMAT'
  await open()
  await p.locator('[data-testid=template-reason]').waitFor({ timeout: 15_000 })
  check(`${width}: a rejection shows with Meta’s reason`, (await flat('[data-testid=template-status]')) === 'Rejected by Meta' && /laid out/.test(await flat('[data-testid=template-reason]')))
  accP.templates[0]!.status = 'APPROVED'
  accP.templates[0]!.rejected_reason = 'NONE'
  await open()
  await p.waitForFunction(() => document.querySelector('[data-testid=template-status]')?.textContent === 'Approved', null, { timeout: 15_000 })
  check(`${width}: opening the page shows Meta’s approval and creates nothing`, accP.templates.length === 1 && templateCalls(accP, 'POST').length === 1)

  // --- what the page says the assistant does
  const next = await flat('[data-testid=what-happens-next]')
  check(`${width}: the page says the assistant stays quiet and steps in only for a price request, and leaves a chat alone after the owner replies`, /stays quiet in your chats/.test(next) && /only when a customer asks for a price/.test(next) && /leaves that chat alone for 24 hours/.test(next), next.slice(0, 120))

  // --- item 3: the test message
  const tryIt = await flat('[data-testid=test-message-line]')
  const lineY = await p.locator('[data-testid=test-message-line]').evaluate((el) => el.getBoundingClientRect().top)
  const buttonY = await p.locator('[data-testid=send-test]').evaluate((el) => el.getBoundingClientRect().top)
  check(`${width}: one clear line sits before the test button`, tryIt === 'Send “Hi” to your business number from your phone first. WhatsApp only lets businesses reply within 24 hours of a customer’s last message.' && lineY < buttonY)
  const testsBefore = sent.length
  await p.getByLabel('Your own mobile number, with country code').fill('+1 555 555 0199')
  await p.locator('[data-testid=send-test]').click()
  await p.locator('[data-testid=test-note]').waitFor({ timeout: 15_000 })
  const note = await flat('[data-testid=test-note]')
  check(`${width}: after a test send the page says “Sent.” and nothing about it probably not arriving`, sent.length === testsBefore + 1 && note === 'Sent.' && !/probably|will not arrive/.test(await flat('[data-testid=whatsapp-connected]')), note)
  await p.screenshot({ path: path.join(outDir, `whatsapp-connected-${width}.png`), fullPage: true })

  // --- item 5: the subscription lapses
  await setPlan(P.tenantId, WITH_WHATSAPP, 'canceled')
  await open()
  await p.locator('[data-testid=access-line]').waitFor({ timeout: 15_000 })
  const paused = await flat('[data-testid=access-line]')
  check(`${width}: a lapsed subscription shows the one line, and the connection is still there`, paused.startsWith('Your WhatsApp assistant is paused until your plan is active again.') && (await p.locator('[data-testid=connected-number]').count()) === 1 && (await rowOf(P)) !== null, paused)
  await p.screenshot({ path: path.join(outDir, `whatsapp-paused-${width}.png`), fullPage: true })

  // --- item 7: an existing connection on a plan without WhatsApp
  await setPlan(P.tenantId, WITHOUT_WHATSAPP)
  await open()
  await p.locator('[data-testid=whatsapp-paused-connection]').waitFor({ timeout: 15_000 })
  check(`${width}: on a plan without WhatsApp an existing connection is shown as kept and paused, with no connect button`, /Connected, paused/.test(await flat('[data-testid=whatsapp-paused-connection]')) && (await p.locator('[data-testid=connect-whatsapp]').count()) === 0 && (await rowOf(P)) !== null)

  const html = await p.content()
  check(`${width}: no token is in the page, nothing in it is yellow, and it does not scroll sideways`, !html.includes(accP.token) && (await p.evaluate((yellow) => [...document.querySelectorAll('[data-testid=whatsapp-upgrade] *, [data-testid=whatsapp-paused-connection] *')].every((el) => getComputedStyle(el).backgroundColor !== yellow), YELLOW)) && (await sideways()) <= 0)
  check(`${width}: the page raised no error`, pageErrors.length === 0, pageErrors)
  await ctx.close()
}
await browser.close()
finish()
