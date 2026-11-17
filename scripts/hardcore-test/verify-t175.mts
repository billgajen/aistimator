// T-175 check: connect WhatsApp in one click (Meta Embedded Signup), with Meta's calls mocked.
//
// Nothing here talks to Meta and no WhatsApp message is sent to anyone: the
// script runs a stand-in for Meta's Graph API on this machine, and the web app
// is started pointing at it. Start the web app like this (the values are local
// test values, not secrets):
//
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//   WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8799 WHATSAPP_INTENT_BASE_URL=http://127.0.0.1:8799/ai \
//   NEXT_PUBLIC_WHATSAPP_APP_ID=900000000000175 NEXT_PUBLIC_WHATSAPP_CONFIG_ID=900000000000176 \
//   WHATSAPP_APP_SECRET=local-app-secret-t175 WHATSAPP_VERIFY_TOKEN=local-verify-t175 \
//   WHATSAPP_ENCRYPTION_KEY=local-encryption-key-t175 pnpm dev:web
//
// Run:  PLAYWRIGHT_DIR=<folder> WEB_LOG=<the web app's log file> npx tsx scripts/hardcore-test/verify-t175.mts
// Without PLAYWRIGHT_DIR the browser section is skipped; without WEB_LOG the log check is. Both say so.
//
// Covers: connect (new number, a WhatsApp Business app number, a number with a PIN), the token
// exchange, what is stored, the guards against claiming another business's number, the payment
// step, the webhook (signature, routing to the right business, repeats, the quiet rule, account
// removal), the expiry warning and renewal, reconnect, disconnect, the manual method, and the page.
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { offeredPlansWithChannel } from '../../packages/shared/src/plans'

type Row = Record<string, unknown>
const MOCK_PORT = 8799
const APP_ID = '900000000000175'
const CONFIG_ID = '900000000000176'
const APP_SECRET = 'local-app-secret-t175'
const VERIFY_TOKEN = 'local-verify-t175'
const ENCRYPTION_KEY = 'local-encryption-key-t175'
const CRON = process.env.CRON_SECRET || 'local-cron-t153'
process.env.WHATSAPP_ENCRYPTION_KEY = ENCRYPTION_KEY
const { decryptSecret } = await import('../../apps/web/src/lib/whatsapp-crypto')

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t175-${shortId()}`)
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
/** Everything that must never reach a log */
const secretsSeen = new Set<string>([APP_SECRET, ENCRYPTION_KEY])

// =====================================================================================
// A stand-in for Meta's Graph API
// =====================================================================================
interface MockNumber { id: string; display: string; name: string; onBizApp: boolean; pin: string | null; registered: boolean }
interface MockAccount {
  token: string
  wabaId: string
  businessId: string
  numbers: MockNumber[]
  expiresAt: number
  funding: string | null
  refuseSendsWith: number | null
  allowRenew: boolean
  /** a manual connection: a token of the business's own Meta app, with no account listing */
  manual?: boolean
}
const accounts = new Map<string, MockAccount>()
const codes = new Map<string, string>()
interface MockCall { method: string; path: string; query: Record<string, string>; token: string | null; body: Row | null }
const calls: MockCall[] = []
const sentMessages: Array<{ phoneNumberId: string; token: string; to: string; text: string }> = []
const days = (n: number) => Math.floor(Date.now() / 1000) + n * 86_400

function newAccount(opts: { onBizApp?: boolean; pin?: string | null; manual?: boolean; numbers?: number } = {}): MockAccount {
  const token = `EAAmock${crypto.randomBytes(18).toString('hex')}`
  secretsSeen.add(token)
  const account: MockAccount = {
    token,
    wabaId: metaId(),
    businessId: metaId(),
    numbers: Array.from({ length: opts.numbers ?? 1 }, (_, i) => ({
      id: metaId(),
      display: `+1 555-01${String(crypto.randomInt(10, 99))}${i}`,
      name: 'Kent Garage Doors',
      onBizApp: Boolean(opts.onBizApp),
      pin: opts.pin ?? null,
      registered: Boolean(opts.onBizApp),
    })),
    expiresAt: days(60),
    funding: null,
    refuseSendsWith: null,
    allowRenew: true,
    manual: opts.manual,
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
    // T-177: a stand-in for the AI model that decides whether a message is a price request (WHATSAPP_INTENT_BASE_URL).
    // This script is about routing and signatures, so its "model" is one line: a message that asks for a quote, an
    // estimate or a price is one, for the business's first service. verify-t177 covers the assistant itself.
    if (version === 'ai') {
      const prompt = String(((body?.contents as Array<{ parts?: Array<{ text?: string }> }> | undefined)?.[0]?.parts?.[0]?.text) ?? '')
      const message = /<<<MESSAGE\n([\s\S]*?)\nMESSAGE>>>/.exec(prompt)?.[1] ?? ''
      const serviceId = /- id: (\S+)/.exec(prompt)?.[1] ?? null
      const yes = /quote|estimate|price|how much/i.test(message) && Boolean(serviceId)
      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ wants_price: yes, service_id: yes ? serviceId : null, confidence: 0.95, job_described: false }) }] } }] })
    }
    calls.push({ method: req.method ?? 'GET', path: `/${parts.join('/')}`, query, token, body })
    if (version !== 'v27.0') return refuse(400, 2635, `unexpected Graph API version ${version}`)

    // --- OAuth
    if (parts[0] === 'oauth' && parts[1] === 'access_token') {
      if (query.client_id !== APP_ID || query.client_secret !== APP_SECRET) return refuse(400, 101, 'Error validating application.')
      if (query.grant_type === 'fb_exchange_token') {
        const account = accounts.get(query.fb_exchange_token ?? '')
        if (!account || !account.allowRenew || account.expiresAt * 1000 <= Date.now()) return refuse(400, 190, 'Error validating access token.')
        const renewed = `EAAmock${crypto.randomBytes(18).toString('hex')}`
        secretsSeen.add(renewed)
        accounts.delete(account.token)
        account.token = renewed
        account.expiresAt = days(60)
        accounts.set(renewed, account)
        return send(200, { access_token: renewed, token_type: 'bearer', expires_in: 60 * 86_400 })
      }
      const forToken = codes.get(query.code ?? '')
      if (!forToken) return refuse(400, 100, 'This authorization code has expired.')
      codes.delete(query.code as string) // a code works once
      return send(200, { access_token: forToken, token_type: 'bearer' })
    }
    if (parts[0] === 'debug_token') {
      if (token !== `${APP_ID}|${APP_SECRET}`) return refuse(400, 190, 'Invalid app access token.')
      const account = accounts.get(query.input_token ?? '')
      if (!account) return send(200, { data: { is_valid: false, app_id: APP_ID } })
      return send(200, {
        data: {
          app_id: APP_ID,
          type: 'SYSTEM_USER',
          is_valid: account.expiresAt * 1000 > Date.now(),
          expires_at: account.expiresAt,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [
            { scope: 'whatsapp_business_management', target_ids: [account.wabaId] },
            { scope: 'whatsapp_business_messaging', target_ids: [account.wabaId] },
          ],
        },
      })
    }

    // --- everything else is called with a business's token
    const account = token ? accounts.get(token) : undefined
    if (!account) return refuse(401, 190, 'Invalid OAuth access token.')
    if (account.expiresAt * 1000 <= Date.now()) return refuse(401, 190, 'Error validating access token: Session has expired.')
    const [node, edge] = parts
    const number = account.numbers.find((n) => n.id === node)
    const numberJson = (n: MockNumber) => ({ id: n.id, display_phone_number: n.display, verified_name: n.name, is_on_biz_app: n.onBizApp, platform_type: 'CLOUD_API', quality_rating: 'GREEN' })

    if (node === account.wabaId && !account.manual) {
      if (edge === 'phone_numbers') return send(200, { data: account.numbers.map(numberJson) })
      if (edge === 'subscribed_apps') return send(200, { success: true })
      // T-176: the page also asks for the account's message templates; this script has none (verify-t176 covers them)
      if (edge === 'message_templates' && req.method === 'GET') return send(200, { data: [] })
      // T-177: connecting sets the template up when Meta has none
      if (edge === 'message_templates' && req.method === 'POST') return send(200, { id: metaId(), status: 'PENDING', category: 'UTILITY' })
      if (!edge) return send(200, account.funding ? { id: account.wabaId, primary_funding_id: account.funding } : { id: account.wabaId })
    }
    if (number) {
      if (!edge) return send(200, numberJson(number))
      if (edge === 'register') {
        if (number.pin && body?.pin !== number.pin) return refuse(400, 133005, 'Two-step verification PIN mismatch.')
        number.registered = true
        return send(200, { success: true })
      }
      if (edge === 'smb_app_data') return send(200, { messaging_product: 'whatsapp', request_id: `req_${shortId()}` })
      if (edge === 'deregister') return send(200, { success: true })
      if (edge === 'messages') {
        if (account.refuseSendsWith) return refuse(400, account.refuseSendsWith, 'There was an error related to your payment method.')
        const text = (body?.text as { body?: string } | undefined)?.body ?? ''
        sentMessages.push({ phoneNumberId: number.id, token: account.token, to: String(body?.to ?? ''), text })
        return send(200, { messaging_product: 'whatsapp', contacts: [{ input: body?.to, wa_id: body?.to }], messages: [{ id: `wamid.out.${shortId()}` }] })
      }
    }
    // someone else's account or number
    return refuse(400, 100, `Unsupported get request. Object with ID '${node}' does not exist, cannot be loaded due to missing permissions.`)
  })
})
await new Promise<void>((resolve, reject) => mock.once('error', reject).listen(MOCK_PORT, '127.0.0.1', resolve))
const callsTo = (pathname: string, method?: string) => calls.filter((c) => c.path === pathname && (!method || c.method === method))

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
async function business(name: string) {
  const id = shortId()
  const email = `owner+t175-${id}@hardcore.test`
  const password = `Hardcore-${id}-Aa1!`
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await call('PUT', `${app}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  // T-177: WhatsApp is for a plan that includes it, with a live subscription
  await sb.insert('subscriptions', { tenant_id: tenantId, plan_id: offeredPlansWithChannel('whatsapp')[0]!.id, status: 'active' })
  return { cookie, cookieHeader, tenantId, name, bearer: session.access_token as string }
}
type Biz = Awaited<ReturnType<typeof business>>
const svc = garageDoorsPackUS.services[0]!
async function addService(biz: Biz) {
  expectOk('service', await call('POST', `${app}/api/services`, {
    headers: biz.cookie,
    body: {
      name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
      scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
      mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
      workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
      pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
      draftConfig: svc.draft, autoSend: true,
    },
  }))
}
const row = async (tenantId: string) => ((await sb.select('whatsapp_configs', `tenant_id=eq.${tenantId}&select=*`)) as Row[])[0] ?? null
const configOf = async (biz: Biz) => expectOk('config', await call('GET', `${app}/api/whatsapp/config`, { headers: biz.cookie }))
const connect = (biz: Biz, body: Row) => call('POST', `${app}/api/whatsapp/connect`, { headers: biz.cookie, body })
const conversations = async (tenantId: string) => (await sb.select('whatsapp_conversations', `tenant_id=eq.${tenantId}&select=id,customer_phone,intake_state&order=created_at`)) as Row[]
const messagesOf = async (tenantId: string) => (await sb.select('whatsapp_messages', `tenant_id=eq.${tenantId}&select=direction,content,wa_message_id&order=created_at`)) as Row[]
const patchRow = (tenantId: string, values: Row) =>
  call('PATCH', `${cfg.supabaseUrl}/rest/v1/whatsapp_configs?tenant_id=eq.${tenantId}`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, Prefer: 'return=minimal' }, body: values })

const sign = (raw: string, secret: string) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
function messagePayload(account: MockAccount, number: MockNumber, from: string, text: string, id = `wamid.in.${shortId()}${shortId()}`) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: account.wabaId,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: number.display.replace(/\D/g, ''), phone_number_id: number.id },
          contacts: [{ profile: { name: 'Megan Grant' }, wa_id: from }],
          messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
        },
      }],
    }],
  }
}
async function webhook(payload: unknown, opts: { secret?: string | null; signature?: string; tamper?: boolean } = {}) {
  const raw = JSON.stringify(payload)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const secret = opts.secret === undefined ? APP_SECRET : opts.secret
  if (opts.signature) headers['X-Hub-Signature-256'] = opts.signature
  else if (secret) headers['X-Hub-Signature-256'] = sign(raw, secret)
  const res = await fetch(`${app}/api/whatsapp/webhook`, { method: 'POST', headers, body: opts.tamper ? raw.replace('"whatsapp"', '"whatsapp" ') : raw })
  return res.status
}

// =====================================================================================
section('0. The web app is running against the stand-in')
const probe = await business(`Probe ${shortId()}`)
const probed = await configOf(probe)
const handshake = await fetch(`${app}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4242`)
if (probed.connect?.appId !== APP_ID || probed.connect?.configId !== CONFIG_ID || !probed.connect?.available || handshake.status !== 200) {
  console.error('\nThe web app is not running with the local WhatsApp test settings. Start it as the top of this file says, then run again.')
  check('the web app runs with the local test settings', false, { connect: probed.connect, handshake: handshake.status })
  finish()
}
check('one-click connect is available, on Graph v27.0 and Embedded Signup v5', probed.connect.graphVersion === 'v27.0' && probed.connect.signupVersion === 'v5' && probed.configured === false, probed.connect)

// =====================================================================================
section('1. Connect: a business with a new number')
const A = await business(`Kent Garage Doors ${shortId()}`)
await addService(A)
const accA = newAccount()
const numA = accA.numbers[0]!
const before = calls.length
const connectedA = await connect(A, { code: newCode(accA), wabaId: accA.wabaId, phoneNumberId: numA.id, businessId: accA.businessId })
const viewA = connectedA.json?.config as Row | undefined
check('connect succeeds and shows the number', connectedA.ok && viewA?.method === 'embedded' && viewA?.displayPhoneNumber === numA.display && viewA?.verifiedName === numA.name, viewA)
const order = calls.slice(before).map((c) => `${c.method} ${c.path.replace(accA.wabaId, '<account>').replace(numA.id, '<number>')}`)
check('on the server, in order: exchange the code, ask whose token it is, read the account’s numbers, subscribe, register', JSON.stringify(order.slice(0, 5)) === JSON.stringify(['GET /oauth/access_token', 'GET /debug_token', 'GET /<account>/phone_numbers', 'POST /<account>/subscribed_apps', 'POST /<number>/register']), order)
const exchange = calls.slice(before)[0]!
check('the exchange sends the app id, the app secret and the code, and no redirect address', exchange.query.client_id === APP_ID && exchange.query.client_secret === APP_SECRET && Boolean(exchange.query.code) && !('redirect_uri' in exchange.query))
const registration = callsTo(`/${numA.id}/register`, 'POST')[0]
check('the number is registered with a six-digit PIN', /^\d{6}$/.test(String(registration?.body?.pin)) && registration?.body?.messaging_product === 'whatsapp' && registration?.token === accA.token && numA.registered)
if (registration?.body?.pin) secretsSeen.add(String(registration.body.pin))
check('the response carries no token, code or PIN', ![accA.token, String(registration?.body?.pin)].some((s) => JSON.stringify(connectedA.json).includes(s)))
const rowA = (await row(A.tenantId))!
check('the token is stored encrypted, and decrypts to the business’s token', String(rowA.access_token_encrypted).startsWith('v2:') && !JSON.stringify(rowA).includes(accA.token) && decryptSecret(String(rowA.access_token_encrypted)) === accA.token)
check('the row records the account, the method, the expiry (60 days) and the registration', rowA.connection_method === 'embedded' && rowA.waba_id === accA.wabaId && rowA.business_id === accA.businessId && rowA.number_kind === 'new_number' && Boolean(rowA.registered_at) && Math.abs(new Date(String(rowA.token_expires_at)).getTime() / 1000 - accA.expiresAt) < 5, { expires: rowA.token_expires_at })
check('the PIN is stored encrypted too', String(rowA.registration_pin_encrypted).startsWith('v2:') && decryptSecret(String(rowA.registration_pin_encrypted)) === String(registration?.body?.pin))
const shownA = await configOf(A)
check('the page is told: connected, registered, the payment step still to do, with a link to WhatsApp Manager', shownA.configured && shownA.config.registered === true && shownA.config.messagesReady === false && String(shownA.config.paymentUrl).includes(accA.wabaId) && shownA.config.token.state === 'ok', shownA.config)
check('nothing the page is given holds a secret', !/encrypted|access_token|EAAmock/i.test(JSON.stringify(shownA)))

// =====================================================================================
section('2. Connect: the guards')
const B = await business(`Other Business ${shortId()}`)
const accB = newAccount()
check('a code Meta does not know is refused, and nothing is saved', (await connect(B, { code: 'AQnot-a-real-code-000000', wabaId: accB.wabaId, phoneNumberId: accB.numbers[0]!.id })).status === 422 && (await row(B.tenantId)) === null)
const usedCode = newCode(accB)
codes.delete(usedCode)
check('a code that was already used is refused', (await connect(B, { code: usedCode, wabaId: accB.wabaId, phoneNumberId: accB.numbers[0]!.id })).status === 422)
const claimAccount = await connect(B, { code: newCode(accB), wabaId: accA.wabaId, phoneNumberId: numA.id })
check('a business cannot claim another business’s WhatsApp account with its own sign-in (403)', claimAccount.status === 403 && claimAccount.json?.error?.code === 'NOT_YOUR_ACCOUNT', claimAccount.json?.error)
const claimNumber = await connect(B, { code: newCode(accB), wabaId: accB.wabaId, phoneNumberId: numA.id })
check('nor another business’s number inside its own account (403)', claimNumber.status === 403 && claimNumber.json?.error?.code === 'NOT_YOUR_NUMBER', claimNumber.json?.error)
check('nothing was saved for it, and the first business’s row is untouched', (await row(B.tenantId)) === null && (await row(A.tenantId))?.phone_number_id === numA.id)
check('ids that are not Meta ids never reach Meta (400)', (await connect(B, { code: newCode(accB), wabaId: '../oauth', phoneNumberId: accB.numbers[0]!.id })).status === 400 && (await connect(B, { code: newCode(accB), wabaId: accB.wabaId, phoneNumberId: '12; drop' })).status === 400)
check('signed out: nothing connects (401)', (await call('POST', `${app}/api/whatsapp/connect`, { body: { code: newCode(accB), wabaId: accB.wabaId, phoneNumberId: accB.numbers[0]!.id } })).status === 401)
const direct = await fetch(`${cfg.supabaseUrl}/rest/v1/whatsapp_configs?select=*`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${A.bearer}` } })
const directRows = direct.ok ? ((await direct.json()) as unknown[]) : []
check('the stored row cannot be read from a browser session, even the business’s own', !direct.ok || directRows.length === 0, direct.status)
const directWrite = await fetch(`${cfg.supabaseUrl}/rest/v1/whatsapp_configs?tenant_id=eq.${A.tenantId}`, { method: 'PATCH', headers: { apikey: cfg.anonKey, Authorization: `Bearer ${A.bearer}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ phone_number_id: accB.numbers[0]!.id }) })
check('nor written from one', (!directWrite.ok || ((await directWrite.json()) as unknown[]).length === 0) && (await row(A.tenantId))?.phone_number_id === numA.id, directWrite.status)
// when Meta's message did not arrive, the server works the account and number out from the token
const connectedB = await connect(B, { code: newCode(accB) })
check('with only the code, the server finds the account from the token and its one number', connectedB.ok && connectedB.json.config.phoneNumberId === accB.numbers[0]!.id && (await row(B.tenantId))?.waba_id === accB.wabaId, connectedB.json?.error)

// =====================================================================================
section('3. Connect: a number already on the WhatsApp Business app')
const C = await business(`Vale Painting ${shortId()}`)
await addService(C)
const accC = newAccount({ onBizApp: true })
const numC = accC.numbers[0]!
const connectedC = await connect(C, { code: newCode(accC), wabaId: accC.wabaId, onBusinessApp: true })
check('it connects, with the number found in the account (Meta’s message names only the account)', connectedC.ok && connectedC.json.config.phoneNumberId === numC.id && connectedC.json.config.alsoOnBusinessApp === true, connectedC.json?.error)
check('the number is NOT registered again (Meta: it already is)', callsTo(`/${numC.id}/register`).length === 0 && connectedC.json.config.registered === true)
const syncs = callsTo(`/${numC.id}/smb_app_data`, 'POST').map((c) => c.body?.sync_type)
check('the two sync requests Meta requires within 24 hours are made', JSON.stringify(syncs) === JSON.stringify(['smb_app_state_sync', 'history']), syncs)
check('our app is subscribed to its account', callsTo(`/${accC.wabaId}/subscribed_apps`, 'POST').length === 1)

// =====================================================================================
section('4. Connect: a number Meta will not register yet')
const D = await business(`Pin Business ${shortId()}`)
const accD = newAccount({ pin: '482913' })
const numD = accD.numbers[0]!
secretsSeen.add('482913')
const connectedD = await connect(D, { code: newCode(accD), wabaId: accD.wabaId, phoneNumberId: numD.id })
check('the connection is saved, and the page is told registration is still to do', connectedD.ok && connectedD.json.config.registered === false && /two-step PIN/i.test(String(connectedD.json.registrationProblem)), connectedD.json?.registrationProblem)
check('a wrong PIN is refused (422)', (await call('POST', `${app}/api/whatsapp/register`, { headers: D.cookie, body: { pin: '000000' } })).status === 422 && !numD.registered)
check('a PIN that is not six digits never reaches Meta (400)', (await call('POST', `${app}/api/whatsapp/register`, { headers: D.cookie, body: { pin: '12ab' } })).status === 400)
const registeredD = await call('POST', `${app}/api/whatsapp/register`, { headers: D.cookie, body: { pin: '482913' } })
check('the number’s own PIN finishes the registration', registeredD.ok && registeredD.json.config.registered === true && numD.registered)

// =====================================================================================
section('5. The payment step')
const status1 = await call('POST', `${app}/api/whatsapp/status`, { headers: A.cookie })
check('while Meta shows no payment method, the step stays', status1.ok && status1.json.config.messagesReady === false && status1.json.problem === null, status1.json)
accA.funding = metaId()
const status2 = await call('POST', `${app}/api/whatsapp/status`, { headers: A.cookie })
check('once Meta reports one, the step is done', status2.ok && status2.json.config.messagesReady === true)
check('a business with no connection has nothing to check (404)', (await call('POST', `${app}/api/whatsapp/status`, { headers: probe.cookie })).status === 404)

// =====================================================================================
section('6. The webhook')
check('handshake: the right verify token gets the challenge back', handshake.status === 200 && (await handshake.text()) === '4242')
check('handshake: a wrong verify token is refused (403)', (await fetch(`${app}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status === 403)

const cust1 = customer(1)
const text1 = 'Hi, I need a quote for a new garage door'
const payload1 = messagePayload(accA, numA, cust1, text1)
check('a call with no signature is refused (401)', (await webhook(payload1, { secret: null })) === 401)
check('a call signed with another secret is refused (401)', (await webhook(payload1, { secret: 'someone-elses-secret' })) === 401)
check('a call whose body was changed after signing is refused (401)', (await webhook(payload1, { tamper: true })) === 401)
check('nothing was stored or answered for those', (await conversations(A.tenantId)).length === 0 && sentMessages.length === 0)

check('a properly signed call is accepted', (await webhook(payload1)) === 200)
const convA = await conversations(A.tenantId)
const outA = sentMessages.filter((m) => m.phoneNumberId === numA.id)
check('a price request starts a request: a conversation for that business, moved on by the assistant', convA.length === 1 && convA[0]!.customer_phone === cust1 && convA[0]!.intake_state === 'awaiting_description', convA)
check('the reply is sent from that business’s number with that business’s token, to that customer', outA.length === 1 && outA[0]!.token === accA.token && outA[0]!.to === cust1 && /price/i.test(outA[0]!.text), outA.map((m) => m.text.slice(0, 50)))
check('no other business has a conversation or a message', (await conversations(B.tenantId)).length === 0 && (await conversations(C.tenantId)).length === 0 && (await messagesOf(B.tenantId)).length === 0)
check('Meta sending the same message again changes nothing', (await webhook(payload1)) === 200 && (await messagesOf(A.tenantId)).filter((m) => m.direction === 'inbound').length === 1 && sentMessages.filter((m) => m.phoneNumberId === numA.id).length === 1)

// routing by phone number id: a message for C's number, while A's is untouched
const cust2 = customer(2)
const beforeC = sentMessages.length
check('a message for another business’s number is accepted', (await webhook(messagePayload(accC, numC, cust2, 'How much to paint a fence?'))) === 200)
const convC = await conversations(C.tenantId)
check('it goes to that business only, answered with its own token', convC.length === 1 && convC[0]!.customer_phone === cust2 && sentMessages.slice(beforeC).every((m) => m.token === accC.token && m.to === cust2) && sentMessages.length === beforeC + 1 && (await conversations(A.tenantId)).length === 1)
// the account id in the call is not what routes it: C's account id with A's number still goes to A
const cust3 = customer(3)
check('a call naming one account and another business’s number goes by the number', (await webhook(messagePayload(accC, numA, cust3, 'price for a spring repair please'))) === 200 && (await conversations(A.tenantId)).some((c) => c.customer_phone === cust3) && !(await conversations(C.tenantId)).some((c) => c.customer_phone === cust3))
check('a signed call for a number nobody has connected is acknowledged and stores nothing', (await webhook(messagePayload(accA, { ...numA, id: metaId() }, customer(4), 'quote please'))) === 200 && !(await conversations(A.tenantId)).some((c) => c.customer_phone === customer(4)))

// T-177: every number is quiet unless a customer asks for a price (the T-175 rule applied to Business app numbers only)
const cust5 = customer(5)
const quietBefore = sentMessages.length
await webhook(messagePayload(accC, numC, cust5, 'See you at 5 then'))
const quietRows = await messagesOf(C.tenantId)
check('on a WhatsApp Business app number, a message that is not about a price is not answered, and its text is not kept', sentMessages.length === quietBefore && !quietRows.some((m) => m.content === 'See you at 5 then') && quietRows.some((m) => m.direction === 'inbound' && m.content === null))
await webhook(messagePayload(accC, numC, cust5, 'Actually, can I get an estimate for the hallway?'))
check('and one that asks for an estimate is answered', sentMessages.length === quietBefore + 1 && sentMessages.at(-1)!.to === cust5)
const cust6 = customer(6)
const anyBefore = sentMessages.length
await webhook(messagePayload(accA, numA, cust6, 'Hello, are you open on Saturdays?'))
check('on a number connected just for Qolumns, a message that is not about a price is not answered either (T-177)', sentMessages.length === anyBefore)

// a message going out settles the payment step; Meta refusing for payment brings it back
check('a reply going out marks the number as working', Boolean((await row(C.tenantId))?.messages_ready_at))
accA.refuseSendsWith = 131042
await webhook(messagePayload(accA, numA, customer(7), 'quote for a door opener'))
check('Meta refusing a reply for the payment method brings the payment step back', (await row(A.tenantId))?.messages_ready_at === null && (await configOf(A)).config.messagesReady === false)
accA.refuseSendsWith = null

// the account left
const accountGone = (wabaId: string, event = 'PARTNER_REMOVED') => ({ object: 'whatsapp_business_account', entry: [{ id: metaId(), changes: [{ field: 'account_update', value: { event, waba_info: { waba_id: wabaId, owner_business_id: metaId() } } }] }] })
check('an unsigned "the business removed the app" call changes nothing', (await webhook(accountGone(accD.wabaId), { secret: null })) === 401 && (await row(D.tenantId)) !== null)
check('other account events leave the connection alone', (await webhook(accountGone(accD.wabaId, 'PARTNER_ADDED'))) === 200 && (await row(D.tenantId)) !== null)
check('when Meta says the business removed the app, its stored token is removed', (await webhook(accountGone(accD.wabaId))) === 200 && (await row(D.tenantId)) === null && (await row(A.tenantId)) !== null)
check('the number is never deregistered by us', calls.every((c) => !c.path.endsWith('/deregister')))

// =====================================================================================
section('7. Sixty days: the warning, the renewal, reconnect')
await patchRow(A.tenantId, { token_expires_at: new Date(Date.now() + 5.5 * 86_400_000).toISOString() })
const warn = (await configOf(A)).config.token
check('with five days left the page is told the connection is running out', warn.state === 'expiring' && warn.daysLeft === 5, warn)
accA.expiresAt = days(5)
const tokenBefore = accA.token
const cron1 = await call('GET', `${app}/api/cron/lifecycle`, { headers: { Authorization: `Bearer ${CRON}` } })
const rowA2 = (await row(A.tenantId))!
check('the daily job renews it with Meta: a new token, stored encrypted, good for 60 days again', cron1.ok && cron1.json.whatsapp?.renewed >= 1 && accA.token !== tokenBefore && decryptSecret(String(rowA2.access_token_encrypted)) === accA.token && (await configOf(A)).config.token.state === 'ok', cron1.json?.whatsapp)
// Meta declines to renew: the warning stays, and reconnecting fixes it
accC.allowRenew = false
accC.expiresAt = days(3)
await patchRow(C.tenantId, { token_expires_at: new Date(Date.now() + 3.5 * 86_400_000).toISOString() })
const tokenC = accC.token
const cron2 = await call('GET', `${app}/api/cron/lifecycle`, { headers: { Authorization: `Bearer ${CRON}` } })
check('when Meta will not renew, the token is left as it is and the warning stays', cron2.ok && decryptSecret(String((await row(C.tenantId))!.access_token_encrypted)) === tokenC && (await configOf(C)).config.token.state === 'expiring', cron2.json?.whatsapp)
await patchRow(C.tenantId, { token_expires_at: new Date(Date.now() - 3_600_000).toISOString() })
check('a connection past its date is shown as run out', (await configOf(C)).config.token.state === 'expired')
// reconnect: the same number, a fresh token
const accC2 = newAccount({ onBizApp: true })
accC2.wabaId = accC.wabaId
accC2.numbers = accC.numbers
const reconnected = await connect(C, { code: newCode(accC2), wabaId: accC.wabaId, onBusinessApp: true })
const rowC2 = (await row(C.tenantId))!
check('reconnecting in one go gives the same number a fresh 60 days', reconnected.ok && rowC2.phone_number_id === numC.id && decryptSecret(String(rowC2.access_token_encrypted)) === accC2.token && (await configOf(C)).config.token.state === 'ok' && Boolean(rowC2.messages_ready_at))
check('the daily job needs its secret (401 without)', (await call('GET', `${app}/api/cron/lifecycle`)).status === 401)

// =====================================================================================
section('8. Disconnect')
check('another business’s disconnect does not touch this one', (await call('DELETE', `${app}/api/whatsapp/config`, { headers: probe.cookie })).ok && (await row(A.tenantId)) !== null)
const unsubBefore = callsTo(`/${accA.wabaId}/subscribed_apps`, 'DELETE').length
const gone = await call('DELETE', `${app}/api/whatsapp/config`, { headers: A.cookie })
check('disconnect asks Meta to stop sending us the account’s messages, with the business’s token', gone.ok && callsTo(`/${accA.wabaId}/subscribed_apps`, 'DELETE').length === unsubBefore + 1 && callsTo(`/${accA.wabaId}/subscribed_apps`, 'DELETE').at(-1)!.token === accA.token)
check('and removes the stored token: the row is gone', (await row(A.tenantId)) === null && (await configOf(A)).configured === false)
const afterGone = sentMessages.length
check('a message for that number afterwards is acknowledged, stored nowhere and not answered', (await webhook(messagePayload(accA, numA, customer(8), 'quote please'))) === 200 && sentMessages.length === afterGone && !(await conversations(A.tenantId)).some((c) => c.customer_phone === customer(8)))
check('signed out: no disconnect (401)', (await call('DELETE', `${app}/api/whatsapp/config`)).status === 401)

// =====================================================================================
section('9. The manual method still works')
const M = await business(`Manual Business ${shortId()}`)
await addService(M)
const accM = newAccount({ manual: true })
const numM = accM.numbers[0]!
const OWN_SECRET = `own-app-secret-${shortId()}`
secretsSeen.add(OWN_SECRET)
const put = (biz: Biz, body: Row) => call('PUT', `${app}/api/whatsapp/config`, { headers: biz.cookie, body })
check('without the app secret a manual connection is not saved (400)', (await put(M, { phoneNumberId: numM.id, accessToken: accM.token })).status === 400 && (await row(M.tenantId)) === null)
check('a token Meta does not accept for the number is not saved (422)', (await put(M, { phoneNumberId: numM.id, accessToken: 'EAAnot-a-token', appSecret: OWN_SECRET })).status === 422 && (await row(M.tenantId)) === null)
const savedM = await put(M, { phoneNumberId: numM.id, accessToken: accM.token, appSecret: OWN_SECRET, isActive: true })
const rowM = (await row(M.tenantId))!
check('with the number id, a permanent token and the app secret it connects, checked with Meta on the server', savedM.ok && savedM.json.config.method === 'manual' && savedM.json.config.displayPhoneNumber === numM.display && rowM.connection_method === 'manual' && rowM.token_expires_at === null)
check('its token and app secret are stored encrypted', decryptSecret(String(rowM.access_token_encrypted)) === accM.token && decryptSecret(String(rowM.app_secret_encrypted)) === OWN_SECRET && !JSON.stringify(rowM).includes(OWN_SECRET))
const updated = await put(M, { phoneNumberId: numM.id, displayPhoneNumber: numM.display, isActive: true })
check('saving again without retyping the token keeps the stored token (it used to be overwritten)', updated.ok && decryptSecret(String((await row(M.tenantId))!.access_token_encrypted)) === accM.token)
check('"Test the connection" works on the stored token', (await call('POST', `${app}/api/whatsapp/verify`, { headers: M.cookie, body: { useStored: true } })).json?.verified === true)
const custM = customer(9)
const payloadM = messagePayload(accM, numM, custM, 'Hi there, quote for a new door?')
const beforeM = sentMessages.length
check('its webhook calls are signed by its OWN app: the platform’s signature is not enough', (await webhook(payloadM)) === 200 && sentMessages.length === beforeM && (await conversations(M.tenantId)).length === 0)
check('signed with its own app secret, the message is handled for that business', (await webhook(payloadM, { secret: OWN_SECRET })) === 200 && sentMessages.length === beforeM + 1 && sentMessages.at(-1)!.token === accM.token && (await conversations(M.tenantId)).length === 1)
check('its own secret does not open another business’s number', (await webhook(messagePayload(accC, numC, customer(10), 'quote please'), { secret: OWN_SECRET })) === 401)
const M2 = await business(`Second Manual ${shortId()}`)
check('a number another business holds cannot be taken by hand (409)', (await put(M2, { phoneNumberId: numM.id, accessToken: accM.token, appSecret: 'x-secret' })).status === 409 && (await row(M2.tenantId)) === null)
check('manual disconnect removes the row', (await call('DELETE', `${app}/api/whatsapp/config`, { headers: M.cookie })).ok && (await row(M.tenantId)) === null)

// =====================================================================================
section('10. Nothing secret or personal in the web app’s log')
const logFile = process.env.WEB_LOG
if (logFile && existsSync(logFile)) {
  const log = readFileSync(logFile, 'utf8')
  const leaked = [...secretsSeen].filter((s) => log.includes(s))
  check(`no token, code, PIN or secret is in the log (${secretsSeen.size} values looked for)`, leaked.length === 0, leaked.map((s) => `${s.slice(0, 6)}…`))
  const phones = Array.from({ length: 10 }, (_, i) => customer(i + 1)).filter((p) => log.includes(p))
  check('no customer’s phone number or message is in the log', phones.length === 0 && !log.includes('See you at 5 then') && !log.includes(text1), phones)
} else notChecked.push('The web app’s log (set WEB_LOG to its file).')

// =====================================================================================
section('11. The page, in a browser')
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The WhatsApp page in a browser (set PLAYWRIGHT_DIR).')
  finish()
}
const { browserDeps } = await import('./browser.mjs')
const { chromium } = browserDeps()
const browser = await chromium.launch()
/** A stand-in for Meta's JavaScript SDK: its window "finishes" as the test plans */
const SDK_STUB = `
  window.__fb = { inits: [], logins: [] };
  window.FB = {
    init(options) { window.__fb.inits.push(options) },
    login(callback, options) {
      window.__fb.logins.push(options);
      const plan = window.__fbPlan || {};
      setTimeout(() => {
        if (plan.message) window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(plan.message), origin: plan.origin || 'https://www.facebook.com' }));
        setTimeout(() => callback(plan.code ? { authResponse: { code: plan.code } } : { authResponse: null, status: 'unknown' }), 40);
      }, 40);
    },
  };
  if (window.fbAsyncInit) window.fbAsyncInit();
`
const JUNIPER = 'rgb(32, 94, 86)'
for (const width of [390, 1440]) {
  const P = await business(`Page Business ${shortId()}`)
  const accP = newAccount()
  const numP = accP.numbers[0]!
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  await ctx.addInitScript('globalThis.__name = (f) => f')
  await ctx.addCookies(P.cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: app })))
  await ctx.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB }))
  const p = await ctx.newPage()
  const plan = (value: Row) => p.evaluate((v) => { (window as unknown as { __fbPlan: unknown }).__fbPlan = v }, value)
  await p.goto(`${app}/app/whatsapp`, { waitUntil: 'networkidle' })
  const button = p.locator('[data-testid=connect-whatsapp]')
  await button.waitFor({ timeout: 30_000 })
  await p.waitForFunction(() => !(document.querySelector('[data-testid=connect-whatsapp]') as HTMLButtonElement).disabled, null, { timeout: 15_000 })
  const first = await p.evaluate(() => ({
    mainButtons: [...document.querySelectorAll('main button')].filter((b) => (b as HTMLElement).offsetParent !== null).map((b) => (b as HTMLElement).innerText.trim()),
    manualOpen: (document.querySelector('[data-testid=manual-section]') as HTMLDetailsElement | null)?.open,
    manualBelow: (document.querySelector('[data-testid=manual-section]')?.getBoundingClientRect().top ?? 0) > (document.querySelector('[data-testid=connect-whatsapp]')?.getBoundingClientRect().bottom ?? 0),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  const look = await button.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, h: Math.round(el.getBoundingClientRect().height), text: (el as HTMLElement).innerText.trim() }))
  check(`${width}: not connected, the page has one main button, "Connect WhatsApp", and "Connect manually" closed below it`, look.text === 'Connect WhatsApp' && first.manualOpen === false && first.manualBelow && first.mainButtons.filter((b) => b === 'Connect WhatsApp').length === 1, first)
  check(`${width}: the button is juniper (no yellow), 44 high or more, and nothing scrolls sideways`, look.bg === JUNIPER && look.h >= 44 && first.sideways <= 0, { ...look, sideways: first.sideways })
  await p.screenshot({ path: path.join(outDir, `whatsapp-not-connected-${width}.png`), fullPage: true })

  // closing Meta's window early connects nothing
  await plan({ message: { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } } })
  await button.click()
  await p.locator('[data-testid=connect-note]').waitFor({ timeout: 10_000 })
  check(`${width}: closing Meta’s window early connects nothing, and says so`, /nothing was connected/.test(await p.locator('[data-testid=connect-note]').innerText()) && (await row(P.tenantId)) === null)
  // a message that only looks like Meta's is ignored
  await plan({ origin: 'https://evilfacebook.com', message: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: numA.id, waba_id: accA.wabaId } }, code: null })
  await button.click()
  await p.waitForFunction(() => !(document.querySelector('[data-testid=connect-whatsapp]') as HTMLButtonElement).disabled, null, { timeout: 10_000 })
  check(`${width}: a message from an address that only looks like Meta’s is ignored`, (await row(P.tenantId)) === null && (await p.locator('[data-testid=whatsapp-connected]').count()) === 0)

  // the real thing
  await plan({ message: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: numP.id, waba_id: accP.wabaId, business_id: accP.businessId } }, code: newCode(accP) })
  await button.click()
  await p.locator('[data-testid=whatsapp-connected]').waitFor({ timeout: 30_000 })
  const sdk = await p.evaluate(() => (window as unknown as { __fb: { inits: Row[]; logins: Array<{ config_id: string; response_type: string; override_default_response_type: boolean; extras: Row }> } }).__fb)
  const login = sdk.logins.at(-1)!
  check(`${width}: Meta’s window is opened with our app, our configuration and the current settings`, sdk.inits[0]?.appId === APP_ID && sdk.inits[0]?.version === 'v27.0' && login.config_id === CONFIG_ID && login.response_type === 'code' && login.override_default_response_type === true && login.extras.version === 'v5', { init: sdk.inits[0], login })
  const connectedText = (await p.locator('[data-testid=whatsapp-connected]').innerText()).replace(/\s+/g, ' ')
  check(`${width}: connected, the page shows the number and what happens next`, (await p.locator('[data-testid=connected-number]').innerText()).trim() === numP.display && /stays quiet in your chats/.test((await p.locator('[data-testid=what-happens-next]').innerText()).replace(/\s+/g, ' ')))
  // T-176: a payment method is a note, not a step
  check(`${width}: nothing is left to do; the payment note links to WhatsApp Manager`, /Nothing left to do/.test(connectedText) && !/step left|steps left/i.test(connectedText) && (await p.locator('[data-testid=payment-link]').getAttribute('href'))?.includes(accP.wabaId) === true && (await p.locator('[data-testid=register-step]').count()) === 0)
  check(`${width}: no token is anywhere in the page`, !(await p.content()).includes(accP.token))
  const sidewaysConnected = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${width}: the connected page does not scroll sideways`, sidewaysConnected <= 0, sidewaysConnected)
  await p.screenshot({ path: path.join(outDir, `whatsapp-connected-${width}.png`), fullPage: true })

  // "Check again" once Meta reports a payment method
  accP.funding = metaId()
  await p.getByRole('button', { name: 'Check again' }).click()
  await p.waitForFunction(() => /Meta has a card for this account/.test(document.querySelector('[data-testid=payment-note]')?.textContent ?? ''), null, { timeout: 15_000 })
  check(`${width}: once Meta reports a payment method, "Check again" says so`, /Nothing left to do/.test(await p.locator('[data-testid=steps-left]').innerText()) && (await p.locator('[data-testid=payment-link]').count()) === 0)

  // the test message (to the stand-in: nobody is messaged)
  const testsBefore = sentMessages.length
  await p.getByLabel('Your own mobile number, with country code').fill('+1 555 555 0199')
  await p.locator('[data-testid=send-test]').click()
  await p.locator('[data-testid=test-note]').waitFor({ timeout: 15_000 })
  check(`${width}: a test message goes out from the business’s own number`, sentMessages.length === testsBefore + 1 && sentMessages.at(-1)!.to === '15555550199' && sentMessages.at(-1)!.token === accP.token && /^Sent\./.test((await p.locator('[data-testid=test-note]').innerText()).trim()))

  // the 60-day warning and one-click reconnect
  await patchRow(P.tenantId, { token_expires_at: new Date(Date.now() + 4.5 * 86_400_000).toISOString() })
  // T-176: the page asks Meta how the connection stands when it opens, so Meta's answer has to carry the same date
  accP.expiresAt = Math.floor((Date.now() + 4.5 * 86_400_000) / 1000)
  await p.reload({ waitUntil: 'networkidle' })
  await p.locator('[data-testid=token-warning]').waitFor({ timeout: 15_000 })
  const warning = (await p.locator('[data-testid=token-warning]').innerText()).replace(/\s+/g, ' ')
  check(`${width}: with four days left the page warns, and offers "Reconnect WhatsApp"`, /runs out in 4 days/.test(warning) && /Reconnect WhatsApp/.test(warning), warning.slice(0, 120))
  await p.locator('[data-testid=token-warning]').screenshot({ path: path.join(outDir, `whatsapp-expiry-warning-${width}.png`) })
  const accP2 = newAccount()
  accP2.wabaId = accP.wabaId
  accP2.numbers = accP.numbers
  accP2.funding = accP.funding
  await p.waitForFunction(() => !(document.querySelector('[data-testid=token-warning] [data-testid=connect-whatsapp]') as HTMLButtonElement).disabled, null, { timeout: 15_000 })
  await plan({ message: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: numP.id, waba_id: accP.wabaId, business_id: accP.businessId } }, code: newCode(accP2) })
  await p.locator('[data-testid=token-warning] [data-testid=connect-whatsapp]').click()
  await p.locator('[data-testid=token-warning]').waitFor({ state: 'detached', timeout: 30_000 })
  check(`${width}: one click reconnects: the warning goes and the stored token is the new one`, decryptSecret(String((await row(P.tenantId))!.access_token_encrypted)) === accP2.token && (await p.locator('[data-testid=connected-number]').innerText()).trim() === numP.display)

  // disconnect
  await p.locator('[data-testid=disconnect]').click()
  await p.locator('[data-testid=disconnect-confirm]').getByRole('button', { name: 'Yes, disconnect' }).click()
  await p.locator('[data-testid=whatsapp-not-connected]').waitFor({ timeout: 15_000 })
  check(`${width}: disconnect asks first, then removes the connection and says so`, (await row(P.tenantId)) === null && /no longer has access/.test(await p.locator('[data-testid=disconnected-note]').innerText()))

  // the manual method, under "Connect manually"
  const accPM = newAccount({ manual: true })
  await p.locator('[data-testid=manual-section] summary').click()
  const manual = p.locator('[data-testid=manual-connect]')
  await manual.getByLabel('Phone Number ID').fill(accPM.numbers[0]!.id)
  await manual.getByLabel(/^Access token/).fill(accPM.token)
  await manual.getByLabel(/^App Secret/).fill('page-own-secret')
  await manual.getByRole('button', { name: 'Connect manually' }).click()
  await p.locator('[data-testid=whatsapp-manual-connected]').waitFor({ timeout: 20_000 })
  check(`${width}: "Connect manually" still connects a business with its own Meta app`, (await row(P.tenantId))?.connection_method === 'manual' && (await p.locator('[data-testid=whatsapp-manual-connected]').innerText()).includes(accPM.numbers[0]!.display))
  await p.screenshot({ path: path.join(outDir, `whatsapp-manual-${width}.png`), fullPage: true })
  await ctx.close()
}
await browser.close()
finish()
