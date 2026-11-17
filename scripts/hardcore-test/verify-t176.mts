// T-176 check: WhatsApp review-ready, with Meta's calls mocked.
//
// Nothing here talks to Meta and no WhatsApp message is sent to anyone: the
// script runs a stand-in for Meta's Graph API on this machine, and the web app
// is started pointing at it, exactly as for verify-t175 (same settings, same
// port, so one running web app serves both scripts, one after the other):
//
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//   WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8799 WHATSAPP_INTENT_BASE_URL=http://127.0.0.1:8799/ai \
//   NEXT_PUBLIC_WHATSAPP_APP_ID=900000000000175 NEXT_PUBLIC_WHATSAPP_CONFIG_ID=900000000000176 \
//   WHATSAPP_APP_SECRET=local-app-secret-t175 WHATSAPP_VERIFY_TOKEN=local-verify-t175 \
//   WHATSAPP_ENCRYPTION_KEY=local-encryption-key-t175 pnpm dev:web
//
// The worker must be running too (section 4 prices real requests).
//
// Run:  PLAYWRIGHT_DIR=<folder> WEB_LOG=<the web app's log file> npx tsx scripts/hardcore-test/verify-t176.mts
// Without PLAYWRIGHT_DIR the browser section is skipped; without WEB_LOG the log check is. Both say so.
//
// Covers: the message template (create once, Meta's review read live, refresh, rejection, two
// businesses kept apart), the display name's review and a card on the account (read live), the
// test message telling the truth about the 24-hour window and about delivery, an approved
// estimate announced on WhatsApp (a plain message inside the 24 hours, the approved template
// after them, nothing otherwise, and never able to fail an approval), the question asked before
// Meta's window, and the page in a browser.
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
const TEMPLATE_NAME = 'estimate_ready'
/** The one message in this script that the stand-in model calls a price request */
const PRICE_REQUEST = 'How much for a new single steel garage door, 9 ft wide, installed?'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t176-${shortId()}`)
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
const secretsSeen = new Set<string>([APP_SECRET])
const HOUR = 3_600_000

// =====================================================================================
// A stand-in for Meta's Graph API
// =====================================================================================
interface MockTemplate { id: string; name: string; language: string; status: string; category: string; rejected_reason: string; components: Row[] }
interface MockAccount {
  token: string
  wabaId: string
  businessId: string
  number: { id: string; display: string; name: string }
  expiresAt: number
  funding: string | null
  /** Meta's review of the display name */
  nameStatus: string
  /** Meta refuses to read name_status at all (the field is asked on its own, so nothing else may break) */
  refuseNameStatus: boolean
  refuseSendsWith: number | null
  templates: MockTemplate[]
  /** Meta ignores the `name` filter and lists every template */
  ignoreNameFilter: boolean
  /** the next template listing comes back empty (someone else is creating it at that moment) */
  hideTemplatesOnce: boolean
  /** Meta refuses every template call */
  refuseTemplatesWith: number | null
}
const accounts = new Map<string, MockAccount>()
const codes = new Map<string, string>()
interface MockCall { method: string; path: string; query: Record<string, string>; token: string | null; body: Row | null }
const calls: MockCall[] = []
interface Sent { phoneNumberId: string; token: string; to: string; type: string; text: string; template: Row | null; id: string }
const sent: Sent[] = []
const days = (n: number) => Math.floor(Date.now() / 1000) + n * 86_400

function newAccount(display?: string): MockAccount {
  const token = `EAAmock${crypto.randomBytes(18).toString('hex')}`
  secretsSeen.add(token)
  const account: MockAccount = {
    token,
    wabaId: metaId(),
    businessId: metaId(),
    number: { id: metaId(), display: display ?? `+1 415-555-01${String(crypto.randomInt(10, 99))}`, name: 'Kent Garage Doors' },
    expiresAt: days(60),
    funding: null,
    nameStatus: 'APPROVED',
    refuseNameStatus: false,
    refuseSendsWith: null,
    templates: [],
    ignoreNameFilter: false,
    hideTemplatesOnce: false,
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
    const refuse = (status: number, code: number, message: string, subcode?: number) => send(status, { error: { message, type: 'OAuthException', code, ...(subcode && { error_subcode: subcode }) } })
    const parts = url.pathname.split('/').filter(Boolean)
    const version = parts.shift()
    // T-177: a stand-in for the AI model that decides whether a message is a price request (WHATSAPP_INTENT_BASE_URL).
    // Here its answer is fixed: the one message this script uses to ask for a price is one, with the job described,
    // for the business's first service. verify-t177 covers the assistant itself.
    if (version === 'ai') {
      const prompt = String(((body?.contents as Array<{ parts?: Array<{ text?: string }> }> | undefined)?.[0]?.parts?.[0]?.text) ?? '')
      const message = /<<<MESSAGE\n([\s\S]*?)\nMESSAGE>>>/.exec(prompt)?.[1] ?? ''
      const serviceId = /- id: (\S+)/.exec(prompt)?.[1] ?? null
      const yes = message === PRICE_REQUEST && Boolean(serviceId)
      return send(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ wants_price: yes, service_id: yes ? serviceId : null, confidence: 0.95, job_described: true }) }] } }] })
    }
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
    const n = account.number
    const numberJson = { id: n.id, display_phone_number: n.display, verified_name: n.name, is_on_biz_app: false, platform_type: 'CLOUD_API', quality_rating: 'GREEN' }

    if (node === account.wabaId) {
      if (edge === 'phone_numbers') return send(200, { data: [numberJson] })
      if (edge === 'subscribed_apps') return send(200, { success: true })
      if (!edge) return send(200, account.funding ? { id: account.wabaId, primary_funding_id: account.funding } : { id: account.wabaId })
      if (edge === 'message_templates') {
        if (account.refuseTemplatesWith) return refuse(account.refuseTemplatesWith === 190 ? 401 : 400, account.refuseTemplatesWith, 'Meta refused the template call. (stand-in)')
        if (req.method === 'GET') {
          if (account.hideTemplatesOnce) {
            account.hideTemplatesOnce = false
            return send(200, { data: [] })
          }
          const wanted = (query.fields ?? 'id,name').split(',')
          const list = account.templates.filter((t) => account.ignoreNameFilter || !query.name || t.name === query.name)
          return send(200, { data: list.map((t) => Object.fromEntries(Object.entries(t).filter(([key]) => wanted.includes(key)))), paging: { cursors: { before: 'a', after: 'b' } } })
        }
        if (req.method === 'POST') {
          const name = String(body?.name ?? '')
          const language = String(body?.language ?? '')
          const components = Array.isArray(body?.components) ? (body.components as Row[]) : []
          const bodyComponent = components.find((c) => String(c.type).toUpperCase() === 'BODY')
          const text = String(bodyComponent?.text ?? '')
          // Meta's own rules, as its docs give them
          if (!/^[a-z0-9_]+$/.test(name)) return refuse(400, 100, 'Invalid parameter', 2388072)
          if (!bodyComponent || !text) return refuse(400, 100, 'Invalid parameter', 2388072)
          if (/^\s*\{\{/.test(text) || /\}\}\s*$/.test(text)) return refuse(400, 100, 'Variables cannot be at the start or end of the template.', 2388299)
          const variables = text.match(/\{\{\d+\}\}/g) ?? []
          const examples = ((bodyComponent.example as { body_text?: unknown[][] } | undefined)?.body_text ?? [])[0] ?? []
          if (variables.length !== examples.length) return refuse(400, 100, 'Missing example values for the variables.', 2388072)
          if (account.templates.some((t) => t.name === name && t.language === language)) return refuse(400, 100, 'Content in This Language Already Exists', 2388024)
          const created: MockTemplate = { id: metaId(), name, language, status: 'PENDING', category: String(body?.category ?? 'UTILITY').toUpperCase(), rejected_reason: 'NONE', components }
          account.templates.push(created)
          return send(200, { id: created.id, status: created.status, category: created.category })
        }
      }
    }
    if (node === n.id) {
      if (!edge) {
        if (query.fields === 'name_status') return account.refuseNameStatus ? refuse(400, 100, '(#100) Tried accessing nonexisting field (name_status)') : send(200, { id: n.id, name_status: account.nameStatus })
        return send(200, numberJson)
      }
      if (edge === 'register') return send(200, { success: true })
      if (edge === 'messages') {
        if (account.refuseSendsWith) return refuse(400, account.refuseSendsWith, 'Meta refused the message. (stand-in)')
        const type = String(body?.type ?? '')
        const template = (body?.template as Row | undefined) ?? null
        if (type === 'template') {
          const language = (template?.language as { code?: string } | undefined)?.code
          const match = account.templates.find((t) => t.name === template?.name && t.language === language)
          if (!match || match.status !== 'APPROVED') return refuse(404, 132001, 'Template name does not exist in the translation')
        }
        const id = `wamid.out.${shortId()}${shortId()}`
        sent.push({ phoneNumberId: n.id, token: account.token, to: String(body?.to ?? ''), type, text: (body?.text as { body?: string } | undefined)?.body ?? '', template, id })
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
async function business(name: string) {
  const id = shortId()
  const email = `owner+t176-${id}@hardcore.test`
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
  return { cookie, cookieHeader, tenantId, name }
}
type Biz = Awaited<ReturnType<typeof business>>
const svc = garageDoorsPackUS.services[0]!
/** A service whose quotes wait for the business's approval (the default) */
async function addService(biz: Biz) {
  const created = expectOk('service', await call('POST', `${app}/api/services`, {
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
const connect = async (biz: Biz, account: MockAccount) =>
  expectOk('connect', await call('POST', `${app}/api/whatsapp/connect`, { headers: biz.cookie, body: { code: newCode(account), wabaId: account.wabaId, phoneNumberId: account.number.id, businessId: account.businessId } }))
const templateOf = (biz: Biz) => call('GET', `${app}/api/whatsapp/template`, { headers: biz.cookie })
const statusOf = (biz: Biz) => call('POST', `${app}/api/whatsapp/status`, { headers: biz.cookie })
const sendTest = (biz: Biz, toPhone: string) => call('POST', `${app}/api/whatsapp/send`, { headers: biz.cookie, body: { toPhone, message: 'This is a test message from your connection. It is working.' } })
const deliveryOf = (biz: Biz | null, messageId: string) => call('GET', `${app}/api/whatsapp/send?messageId=${encodeURIComponent(messageId)}`, biz ? { headers: biz.cookie } : {})
const patch = (table: string, query: string, values: Row) => call('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=minimal' }, body: values })

const sign = (raw: string, secret: string) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`
async function webhook(account: MockAccount, value: Row) {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: account.wabaId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: account.number.display.replace(/\D/g, ''), phone_number_id: account.number.id }, ...value } }] }],
  })
  const res = await fetch(`${app}/api/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw, APP_SECRET) }, body: raw })
  return res.status
}
/** A customer writes to the business's number */
const says = (account: MockAccount, from: string, text: string) =>
  webhook(account, { contacts: [{ profile: { name: 'Megan Grant' }, wa_id: from }], messages: [{ id: `wamid.in.${shortId()}${shortId()}`, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] })
/** Meta reports what became of a message the business sent */
const reports = (account: MockAccount, messageId: string, to: string, status: string, errorCode?: number) =>
  webhook(account, { statuses: [{ id: messageId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: to, ...(errorCode && { errors: [{ code: errorCode, title: 'Re-engagement message', message: 'Re-engagement message' }] }) }] })

/**
 * A customer asks for a price on WhatsApp. T-177: the assistant asks only for what is missing, and here
 * nothing is (the message describes the job, WhatsApp gives the name), so one message makes the request.
 * Returns the quote's id.
 */
async function chatToQuote(biz: Biz, account: MockAccount, from: string): Promise<string | null> {
  if ((await says(account, from, PRICE_REQUEST)) !== 200) return null
  const rows = (await sb.select('whatsapp_conversations', `tenant_id=eq.${biz.tenantId}&customer_phone=eq.${from}&select=intake_state,intake_data&order=created_at.desc&limit=1`)) as Row[]
  const data = (rows[0]?.intake_data ?? {}) as { _quoteId?: string }
  return rows[0]?.intake_state === 'completed' && data._quoteId ? data._quoteId : null
}
const quoteRow = async (id: string) => ((await sb.select('quotes', `id=eq.${id}&select=status,sent_at,approved_at,pricing_json`)) as Row[])[0]
async function waitForReview(id: string, timeoutMs = 420_000): Promise<string> {
  const until = Date.now() + timeoutMs
  let status = ''
  while (Date.now() < until) {
    status = String((await quoteRow(id))?.status ?? '')
    if (status === 'pending_review' || status === 'failed' || status === 'sent') return status
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  return status
}
const approve = (biz: Biz, quoteId: string) => call('POST', `${app}/api/quotes/${quoteId}/approve`, { headers: biz.cookie })
/** The customer's last message is made to look this old */
const ageInbound = (biz: Biz, from: string, hours: number) =>
  patch('whatsapp_messages', `tenant_id=eq.${biz.tenantId}&from_phone=eq.${from}&direction=eq.inbound`, { created_at: new Date(Date.now() - hours * HOUR).toISOString() })
const linkIn = (text: string) => /https?:\/\/[^\s/]+\/q\/[A-Za-z0-9_-]+\?token=[A-Za-z0-9_-]+/.exec(text)?.[0] ?? null

// =====================================================================================
section('0. The web app is running against the stand-in')
const probe = await business(`Probe ${shortId()}`)
const probed = expectOk('config', await call('GET', `${app}/api/whatsapp/config`, { headers: probe.cookie }))
const handshake = await fetch(`${app}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4242`)
if (probed.connect?.appId !== APP_ID || probed.connect?.configId !== CONFIG_ID || !probed.connect?.available || handshake.status !== 200) {
  console.error('\nThe web app is not running with the local WhatsApp test settings. Start it as the top of this file says, then run again.')
  check('the web app runs with the local test settings', false, { connect: probed.connect, handshake: handshake.status })
  finish()
}
check('the web app runs with the local test settings', true)

// =====================================================================================
section('1. The message template: set up once, and Meta’s review read live')
// T-177: there is no button. Connecting sets the template up (used if Meta has it, created if not).
const A = await business(`Kent Garage Doors ${shortId()}`)
const accA = newAccount()
await connect(A, accA)
const posted = templateCalls(accA, 'POST')
const definition = posted[0]?.body ?? {}
const bodyComponent = ((definition.components as Row[] | undefined) ?? [])[0] ?? {}
const bodyText = String(bodyComponent.text ?? '')
check('connecting sends Meta one utility template, in the business’s language', posted.length === 1 && posted[0]!.token === accA.token && definition.name === TEMPLATE_NAME && definition.language === 'en_US' && definition.category === 'UTILITY', { definition })
check('its wording names the business, has one variable (the link), and does not start or end with it', bodyText.includes(`Your estimate from ${A.name} is ready`) && (bodyText.match(/\{\{\d+\}\}/g) ?? []).join() === '{{1}}' && !/^\s*\{\{/.test(bodyText) && !/\}\}\s*$/.test(bodyText), bodyText)
const example = String(((bodyComponent.example as { body_text?: string[][] } | undefined)?.body_text ?? [[]])[0]?.[0] ?? '')
check('Meta is given an example of the variable: a link of the right shape, to no real estimate', /\/q\/example\?token=example$/.test(example), example)
const getsBefore = templateCalls(accA, 'GET').length
const t1 = await templateOf(A)
check('the page is shown the wording, with the business’s name and a sample link, and that it is in review', t1.ok && t1.json.template.state === 'pending' && t1.json.template.metaStatus === 'PENDING' && t1.json.template.category === 'UTILITY' && t1.json.template.name === TEMPLATE_NAME && String(t1.json.template.text).includes(`Your estimate from ${A.name} is ready`) && /\/q\/…/.test(t1.json.template.text) && !String(t1.json.template.text).includes('{{'), t1.json?.template)
check('reading it asks Meta with the business’s own token, on its own account', templateCalls(accA, 'GET').length === getsBefore + 1 && templateCalls(accA, 'GET').at(-1)!.token === accA.token && templateCalls(accA, 'GET').at(-1)!.query.name === TEMPLATE_NAME)
check('no response carries the token', !JSON.stringify(t1.json).includes(accA.token))
await connect(A, accA)
check('connecting again makes no second template', templateCalls(accA, 'POST').length === 1 && accA.templates.length === 1)

accA.templates[0]!.status = 'APPROVED'
check('once Meta approves it, the page says so', (await templateOf(A)).json?.template?.state === 'approved')
accA.templates[0]!.status = 'REJECTED'
accA.templates[0]!.rejected_reason = 'PROMOTIONAL'
accA.templates[0]!.category = 'MARKETING'
const rejected = (await templateOf(A)).json?.template
check('a rejection is shown with Meta’s reason in plain words, and the category Meta filed it under', rejected?.state === 'rejected' && /advertising/.test(rejected?.reason ?? '') && rejected?.category === 'MARKETING', rejected)
accA.templates[0]!.status = 'PAUSED'
accA.templates[0]!.rejected_reason = 'NONE'
check('a template Meta paused is shown as paused', (await templateOf(A)).json?.template?.state === 'paused')
accA.templates[0]!.status = 'APPROVED'
accA.templates[0]!.category = 'UTILITY'

// Meta's two reference pages disagree on whether `name` still filters the list
accA.templates.unshift({ id: metaId(), name: 'another_template', language: 'en_US', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'SCAM', components: [{ type: 'BODY', text: 'Something else entirely' }] })
accA.ignoreNameFilter = true
const narrowed = (await templateOf(A)).json?.template
check('if Meta ignores the name filter, another template is never mistaken for ours', narrowed?.state === 'approved' && String(narrowed?.text).includes('Your estimate from'), narrowed)
accA.ignoreNameFilter = false

// two businesses
const B = await business(`Rival Doors ${shortId()}`)
const accB = newAccount()
// someone made the template at the very moment B connects: Meta's list is empty, then its "create" says "already exists"
accB.hideTemplatesOnce = true
accB.templates.push({ id: metaId(), name: TEMPLATE_NAME, language: 'en_US', status: 'PENDING', category: 'UTILITY', rejected_reason: 'NONE', components: [{ type: 'BODY', text: 'Your estimate from Rival is ready. Open it here: {{1}}\n\nThank you.' }] })
await connect(B, accB)
const tB = (await templateOf(B)).json?.template
check('when Meta says the template already exists, the one that exists is used: no second one, no error', accB.templates.length === 1 && templateCalls(accB, 'POST').length === 1 && tB?.state === 'pending', { templates: accB.templates.length, state: tB?.state })
check('another business sees its own account only: A’s approved template is not B’s', tB?.state === 'pending' && String(tB?.text).includes('Rival') && !String(tB?.text).includes(A.name) && templateCalls(accB, 'GET').every((c) => c.token === accB.token), tB)

// who may not
check('signed out: 401 for reading; and there is no way to ask for one to be created', (await call('GET', `${app}/api/whatsapp/template`)).status === 401 && [404, 405].includes((await call('POST', `${app}/api/whatsapp/template`, { headers: A.cookie })).status) && accA.templates.filter((t) => t.name === TEMPLATE_NAME).length === 1)
const notConnected = await templateOf(probe)
check('a business with no connection has no template to read (404)', notConnected.status === 404, notConnected.json)

// Meta refusing
accA.refuseTemplatesWith = 190
const expired = await templateOf(A)
check('when Meta says the connection has expired, the page is told to reconnect, in plain words', expired.status === 502 && /Reconnect WhatsApp/.test(expired.json?.error?.message ?? '') && !JSON.stringify(expired.json).includes(accA.token), expired.json)
accA.refuseTemplatesWith = null

// =====================================================================================
section('2. The display name’s review, and a card on the account: read live, never stored')
accA.nameStatus = 'PENDING_REVIEW'
const live1 = await statusOf(A)
check('while Meta reviews the name, the page is told so (and that Meta shows no card)', live1.ok && live1.json.live?.nameStatus === 'PENDING_REVIEW' && live1.json.live?.hasPaymentMethod !== true && live1.json.problem === null, live1.json?.live)
accA.nameStatus = 'APPROVED'
accA.funding = metaId()
const live2 = await statusOf(A)
check('once Meta approves the name and shows a card, the page is told that', live2.json.live?.nameStatus === 'APPROVED' && live2.json.live?.hasPaymentMethod === true, live2.json?.live)
accA.refuseNameStatus = true
const live3 = await statusOf(A)
check('if Meta will not give the name’s review, everything else still reads', live3.ok && live3.json.live?.nameStatus === null && live3.json.problem === null && live3.json.config?.displayPhoneNumber === accA.number.display, live3.json)
accA.refuseNameStatus = false
accA.funding = null
const rowA = ((await sb.select('whatsapp_configs', `tenant_id=eq.${A.tenantId}&select=*`)) as Row[])[0]!
check('nothing about the name’s review or the template is stored', !Object.keys(rowA).some((k) => /name_status|template/.test(k)))

// =====================================================================================
section('3. The test message says what really happened')
const phone = customer(1)
const before = sent.length
const cold = await sendTest(A, `+${phone}`)
check('to a phone that has not written, Meta still accepts it, and the page is told it will probably not arrive', cold.ok && cold.json.windowOpen === false && sent.length === before + 1 && sent.at(-1)!.to === phone && sent.at(-1)!.token === accA.token, cold.json)
check('what became of it can be read: accepted, not yet delivered', (await deliveryOf(A, cold.json.messageId)).json?.status === 'sent')
await reports(accA, cold.json.messageId, phone, 'failed', 131047)
check('when Meta reports it could not deliver, the page can read that', (await deliveryOf(A, cold.json.messageId)).json?.status === 'failed')

check('a customer’s message arrives (signed) and is kept', (await says(accA, phone, 'See you at five then')) === 200)
const warm = await sendTest(A, `+${phone}`)
check('to a phone that wrote in the last 24 hours, the page is told it should arrive', warm.ok && warm.json.windowOpen === true, warm.json)
await reports(accA, warm.json.messageId, phone, 'delivered')
check('when Meta reports it delivered, the page can read that', (await deliveryOf(A, warm.json.messageId)).json?.status === 'delivered')
await ageInbound(A, phone, 30)
check('a day and more later the window has closed again', (await sendTest(A, `+${phone}`)).json?.windowOpen === false)

check('one business cannot read what became of another’s message', (await deliveryOf(B, warm.json.messageId)).status === 404)
check('signed out: 401', (await deliveryOf(null, warm.json.messageId)).status === 401)
check('a message that does not exist: 404', (await deliveryOf(A, 'wamid.nothing')).status === 404 && (await deliveryOf(A, '')).status === 400)

accA.refuseSendsWith = 131037
const held = await sendTest(A, `+${phone}`)
check('Meta refusing because the name is not approved yet is said plainly', held.status === 422 && held.json?.error?.code === 'NAME_IN_REVIEW' && /Nothing is broken/.test(held.json.error.message), held.json)
accA.refuseSendsWith = null

// =====================================================================================
section('4. An approved estimate is announced on WhatsApp')
const C = await business(`Gateway Doors ${shortId()}`)
const serviceC = await addService(C)
const accC = newAccount()
await connect(C, accC)
const site = await sb.insert('tenant_sites', { tenant_id: C.tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
const [c1, c2, c3, c4, c5] = [customer(11), customer(12), customer(13), customer(14), customer(15)]
const sentBeforeChats = sent.length
// five customers ask on WhatsApp at once; one more asks on the request form
const [q1, q2, q3, q4, q5, web] = await Promise.all([
  chatToQuote(C, accC, c1),
  chatToQuote(C, accC, c2),
  chatToQuote(C, accC, c3),
  chatToQuote(C, accC, c4),
  chatToQuote(C, accC, c5),
  call('POST', `${app}/api/public/quotes`, {
    body: { tenantKey: site.tenant_key, serviceId: serviceC, customer: { name: 'Form Customer', email: 'form.customer@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'New garage door please, single steel one' }, { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  }),
])
const qWeb = web.ok ? (web.json.quoteId as string) : null
check('five customers ask for a price on WhatsApp and each chat ends in a request that names its quote', [q1, q2, q3, q4, q5].every(Boolean), { q1, q2, q3, q4, q5 })
const chatReplies = sent.slice(sentBeforeChats)
check('every reply in those chats went out as an ordinary message, from the business’s own number', chatReplies.length === 5 && chatReplies.every((m) => m.type === 'text' && m.token === accC.token), chatReplies.length)
for (const reply of chatReplies) {
  const first = linkIn(reply.text)
  if (first) secretsSeen.add(new URL(first).searchParams.get('token')!)
}
if (![q1, q2, q3, q4, q5, qWeb].every(Boolean)) {
  check('the requests could be made', false, { web: web.status })
  finish()
}
const waited = await Promise.all([q1, q2, q3, q4, q5, qWeb].map((id) => waitForReview(id as string)))
check('each is priced and waits for the business’s approval', waited.every((s) => s === 'pending_review'), waited)
if (!waited.every((s) => s === 'pending_review')) finish()

// (a) inside the 24 hours: an ordinary message
let mark = sent.length
const a1 = await approve(C, q1 as string)
const m1 = sent.slice(mark)
const link1 = linkIn(m1[0]?.text ?? '')
check('approved within the 24 hours: the customer gets one ordinary message, from the business’s number', a1.ok && a1.json.status === 'sent' && a1.json.whatsapp === 'message' && m1.length === 1 && m1[0]!.type === 'text' && m1[0]!.to === c1 && m1[0]!.token === accC.token, { status: a1.status, json: a1.json, sent: m1.length })
check('it says the estimate is ready and carries the customer’s own link', (m1[0]?.text ?? '').startsWith(`Your estimate from ${C.name} is ready. Open it here: `) && Boolean(link1) && link1!.includes(`/q/${q1}`), m1[0]?.text?.slice(0, 80))
if (link1) {
  secretsSeen.add(new URL(link1).searchParams.get('token')!)
  const opened = await call('GET', `${app}/api/public/quotes/${q1}?token=${encodeURIComponent(new URL(link1).searchParams.get('token')!)}`)
  check('the link in the message opens that estimate', opened.ok && opened.json?.status === 'sent', opened.status)
}
const kept1 = ((await sb.select('whatsapp_messages', `tenant_id=eq.${C.tenantId}&wa_message_id=eq.${m1[0]?.id}&select=direction,message_type,content,to_phone`)) as Row[])[0]
check('the message is kept with the chat, without the link (it carries the estimate’s token)', kept1?.direction === 'outbound' && kept1?.message_type === 'text' && kept1?.to_phone === c1 && !/token=/.test(String(kept1?.content)) && /Your estimate from/.test(String(kept1?.content)), kept1)

// (b) after the 24 hours, with no template: nothing is sent, and the approval stands
await ageInbound(C, c2, 30)
mark = sent.length
const a2 = await approve(C, q2 as string)
check('approved after the 24 hours while the template is still in review: the estimate is sent as ever, and nothing goes out on WhatsApp', a2.ok && a2.json.status === 'sent' && !('whatsapp' in a2.json) && sent.length === mark && (await quoteRow(q2 as string))?.status === 'sent', a2.json)

// (c) after the 24 hours, with the approved template
// the template was set up when C connected; Meta now approves it
const madeC = { ok: accC.templates.length === 1 && accC.templates[0]!.status === 'PENDING' }
accC.templates[0]!.status = 'APPROVED'
await ageInbound(C, c3, 30)
mark = sent.length
const a3 = await approve(C, q3 as string)
const m3 = sent.slice(mark)
const templateSent = m3[0]?.template as { name?: string; language?: { code?: string }; components?: Array<{ type?: string; parameters?: Array<{ type?: string; text?: string }> }> } | null
const link3 = templateSent?.components?.[0]?.parameters?.[0]?.text ?? ''
check('approved after the 24 hours with the approved template: the template is sent, to that customer', madeC.ok && a3.ok && a3.json.whatsapp === 'template' && m3.length === 1 && m3[0]!.type === 'template' && m3[0]!.to === c3 && m3[0]!.token === accC.token, { json: a3.json, sent: m3.length })
check('it is our template in the language Meta has it in, with the customer’s link as its one parameter', templateSent?.name === TEMPLATE_NAME && templateSent?.language?.code === 'en_US' && templateSent?.components?.length === 1 && templateSent.components[0]!.type === 'body' && templateSent.components[0]!.parameters?.length === 1 && linkIn(link3) === link3 && link3.includes(`/q/${q3}`), { name: templateSent?.name, language: templateSent?.language })
if (linkIn(link3)) secretsSeen.add(new URL(link3).searchParams.get('token')!)
const kept3 = ((await sb.select('whatsapp_messages', `tenant_id=eq.${C.tenantId}&wa_message_id=eq.${m3[0]?.id}&select=message_type,content`)) as Row[])[0]
check('it is kept as a template message, without the link', kept3?.message_type === 'template' && !/token=/.test(String(kept3?.content)), kept3)

// (d) Meta refuses: the approval is not affected
await ageInbound(C, c4, 30)
accC.refuseSendsWith = 131042
mark = sent.length
const a4 = await approve(C, q4 as string)
check('when Meta refuses the message (no card), the approval still goes through', a4.ok && a4.json.status === 'sent' && !('whatsapp' in a4.json) && sent.length === mark && (await quoteRow(q4 as string))?.status === 'sent', a4.json)
accC.refuseSendsWith = null

// (e) "edit, then send" is an approval too
const q5row = ((await sb.select('quotes', `id=eq.${q5}&select=version,pricing_json,content_json`)) as Row[])[0]!
mark = sent.length
const edited = await call('PATCH', `${app}/api/quotes/${q5}`, { headers: C.cookie, body: { version: q5row.version, pricing_json: q5row.pricing_json, content_json: { ...(q5row.content_json as Row), notes: 'We can start the week after next.' }, sendToCustomer: true } })
const m5 = sent.slice(mark)
const link5 = linkIn(m5[0]?.text ?? '')
check('editing an estimate and sending it announces it on WhatsApp as well, once', edited.ok && (await quoteRow(q5 as string))?.status === 'sent' && m5.length === 1 && m5[0]!.type === 'text' && m5[0]!.to === c5 && Boolean(link5) && link5!.includes(`/q/${q5}`), { status: edited.status, sent: m5.length })
if (link5) secretsSeen.add(new URL(link5).searchParams.get('token')!)
const q5row2 = ((await sb.select('quotes', `id=eq.${q5}&select=version,pricing_json,content_json`)) as Row[])[0]!
mark = sent.length
const revised = await call('PATCH', `${app}/api/quotes/${q5}`, { headers: C.cookie, body: { version: q5row2.version, pricing_json: q5row2.pricing_json, content_json: { ...(q5row2.content_json as Row), notes: 'We can start next Monday.' }, sendToCustomer: true } })
check('a later revision of a sent estimate is not announced as “ready” again', revised.ok && sent.length === mark, { status: revised.status, sent: sent.length - mark })

// (f) a request from the form is not announced on WhatsApp
mark = sent.length
const a5 = await approve(C, qWeb as string)
check('an estimate asked for on the request form is not announced on WhatsApp', a5.ok && a5.json.status === 'sent' && !('whatsapp' in a5.json) && sent.length === mark, a5.json)
const again = await approve(C, q1 as string)
check('a second approval of the same estimate is refused and sends nothing more', !again.ok && [400, 409].includes(again.status) && sent.length === mark, again.status)

// =====================================================================================
section('5. Nothing secret or personal in the web app’s log')
const logFile = process.env.WEB_LOG
if (logFile && existsSync(logFile)) {
  // The dev server prints the address of every request it serves, and this script itself opened an
  // estimate by its link. Those lines are the dev server's, not the app's logging, so they are left out.
  const log = readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/\S* \d{3} in \d+/.test(line))
    .join('\n')
  const leaked = [...secretsSeen].filter((s) => log.includes(s))
  check(`no token, code, secret or estimate link is in the log (${secretsSeen.size} values looked for)`, leaked.length === 0, leaked.map((s) => `${s.slice(0, 6)}…`))
  const phones = [phone, c1, c2, c3, c4, c5].filter((p) => log.includes(p))
  check('no customer’s phone number or message is in the log', phones.length === 0 && !log.includes('See you at five then') && !log.includes(PRICE_REQUEST), phones)
  check('Meta’s reason for an undelivered message is logged by its code alone', /\[WhatsApp Webhook\] Meta did not deliver a message: code 131047/.test(log))
} else notChecked.push('The web app’s log (set WEB_LOG to its file).')

// =====================================================================================
section('6. The page, in a browser')
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
  const P = await business(`Page Business ${shortId()}`)
  // at 390 the number is one of Meta's own 555 numbers; at 1440 an ordinary one
  const metaNumber = width === 390
  const accP = newAccount(metaNumber ? `+1 555-555-01${String(crypto.randomInt(10, 99))}` : undefined)
  accP.nameStatus = 'PENDING_REVIEW'
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  await ctx.addInitScript('globalThis.__name = (f) => f')
  await ctx.addCookies(P.cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: app })))
  await ctx.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SDK_STUB }))
  const p = await ctx.newPage()
  const pageErrors: string[] = []
  p.on('pageerror', (error) => pageErrors.push(error.message))
  await p.goto(`${app}/app/whatsapp`, { waitUntil: 'networkidle' })
  const button = p.locator('[data-testid=connect-whatsapp]')
  await button.waitFor({ timeout: 30_000 })
  const flat = async (selector: string) => (await p.locator(selector).innerText()).replace(/\s+/g, ' ')
  const sideways = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  // --- before Meta's window (T-177: one warning line; the three-answer question is gone, verify-t177 covers the line)
  await p.waitForFunction(() => !(document.querySelector('[data-testid=connect-whatsapp]') as HTMLButtonElement).disabled, null, { timeout: 15_000 })
  const look = await button.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, h: Math.round(el.getBoundingClientRect().height) }))
  check(`${width}: “Connect WhatsApp” is ready with no question to answer first; it is juniper and 44 high or more`, (await p.locator('[data-testid=number-question]').count()) === 0 && look.bg === JUNIPER && look.h >= 44, look)

  // --- connect
  await p.evaluate((v) => { (window as unknown as { __fbPlan: unknown }).__fbPlan = v }, { message: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: accP.number.id, waba_id: accP.wabaId, business_id: accP.businessId } }, code: newCode(accP) } as Row)
  await button.click()
  await p.locator('[data-testid=whatsapp-connected]').waitFor({ timeout: 30_000 })

  // --- the display name in review
  await p.locator('[data-testid=name-in-review]').waitFor({ timeout: 15_000 })
  const nameNote = await flat('[data-testid=name-in-review]')
  check(`${width}: a display name in review is said plainly, with “up to five working days”`, /Meta is reviewing the name on this number/.test(nameNote) && /up to five working days/.test(nameNote) && /Nothing is broken/.test(nameNote), nameNote.slice(0, 160))
  check(
    metaNumber ? `${width}: for one of Meta’s own 555 numbers it says the number cannot send until then` : `${width}: for an ordinary number it says the number works in the meantime`,
    metaNumber ? /cannot send messages/.test(nameNote) && /555/.test(nameNote) : /In the meantime the number works/.test(nameNote) && !/cannot send/.test(nameNote)
  )

  // --- payment is a note, not a step
  const steps = await flat('[data-testid=steps-left]')
  const paymentNote = await flat('[data-testid=payment-note]')
  check(`${width}: payment is not a step: “Nothing left to do”`, /Nothing left to do/.test(steps) && !/step left|steps left/i.test(steps) && (await p.locator('[data-testid=register-step]').count()) === 0, steps.slice(0, 80))
  check(`${width}: and it does not promise answers the number cannot give yet`, metaNumber ? /once Meta approves its name/.test(steps) && !/is listening for price requests/.test(steps) : /is listening for price requests/.test(steps))
  check(`${width}: the note says the first 1,000 need no card, and when a card is needed`, /You don’t need a card to start/.test(paymentNote) && /first 1,000/.test(paymentNote) && /without a card/.test(paymentNote) && /messages your business starts/.test(paymentNote) && (await p.locator('[data-testid=payment-link]').getAttribute('href'))?.includes(accP.wabaId) === true, paymentNote.slice(0, 160))
  accP.funding = metaId()
  await p.getByRole('button', { name: 'Check again' }).click()
  await p.waitForFunction(() => /Meta has a card for this account/.test(document.querySelector('[data-testid=payment-note]')?.textContent ?? ''), null, { timeout: 15_000 })
  check(`${width}: once Meta shows a card, “Check again” says so`, (await p.locator('[data-testid=payment-link]').count()) === 0)

  // --- the message template (T-177: set up by connecting; the page shows its status and has no button for it)
  const templates = p.locator('[data-testid=message-templates]')
  await p.locator('[data-testid=template-status]').waitFor({ timeout: 15_000 })
  const cardBefore = await flat('[data-testid=template-card]')
  check(`${width}: “Message templates” shows the wording, with the business’s name, in review with Meta, and no button`, /Message templates/.test(await templates.innerText()) && cardBefore.includes(`Your estimate from ${P.name} is ready`) && (await flat('[data-testid=template-status]')) === 'In review with Meta' && accP.templates.length === 1 && (await p.locator('[data-testid=message-templates] button').count()) === 0, cardBefore.slice(0, 120))
  await p.screenshot({ path: path.join(outDir, `whatsapp-template-in-review-${width}.png`), fullPage: true })
  const reopen = async () => {
    await p.reload({ waitUntil: 'networkidle' })
    await p.locator('[data-testid=template-status]').waitFor({ timeout: 15_000 })
  }
  accP.templates[0]!.status = 'APPROVED'
  await reopen()
  await p.waitForFunction(() => document.querySelector('[data-testid=template-status]')?.textContent === 'Approved', null, { timeout: 15_000 })
  const approvedText = await flat('[data-testid=template-explain]')
  check(`${width}: opening the page again shows Meta’s approval, and says when it is used and that Meta charges for it`, /more than 24 hours after the customer last wrote/.test(approvedText) && /Meta charges/.test(approvedText), approvedText)
  accP.templates[0]!.status = 'REJECTED'
  accP.templates[0]!.rejected_reason = 'INVALID_FORMAT'
  await reopen()
  await p.locator('[data-testid=template-reason]').waitFor({ timeout: 15_000 })
  check(`${width}: a rejection shows Meta’s reason`, (await flat('[data-testid=template-status]')) === 'Rejected by Meta' && /laid out/.test(await flat('[data-testid=template-reason]')))
  accP.templates[0]!.status = 'APPROVED'
  accP.templates[0]!.rejected_reason = 'NONE'
  await reopen()
  await p.waitForFunction(() => document.querySelector('[data-testid=template-status]')?.textContent === 'Approved', null, { timeout: 15_000 })
  check(`${width}: none of that created a second template`, accP.templates.length === 1)

  // --- the test message (to the stand-in: nobody is messaged)
  const testsBefore = sent.length
  await p.getByLabel('Your own mobile number, with country code').fill('+1 555 555 0199')
  await p.locator('[data-testid=send-test]').click()
  await p.locator('[data-testid=test-note]').waitFor({ timeout: 15_000 })
  const testNote = await flat('[data-testid=test-note]')
  check(`${width}: the button is free again as soon as the send has answered`, (await flat('[data-testid=send-test]')) === 'Send a test message' && !(await p.locator('[data-testid=send-test]').isDisabled()))
  check(`${width}: a test message goes out from the business’s own number, and the page says “Sent.” (what to do first is said before the button)`, sent.length === testsBefore + 1 && sent.at(-1)!.to === '15555550199' && /^Sent\./.test(testNote.trim()) && /Send “Hi” to your business number from your phone first/.test(await flat('[data-testid=test-message-line]')), testNote.slice(0, 120))
  if (!metaNumber) {
    await reports(accP, sent.at(-1)!.id, '15555550199', 'delivered')
    await p.waitForFunction(() => /^Delivered\./.test(document.querySelector('[data-testid=test-note]')?.textContent ?? ''), null, { timeout: 30_000 }).catch(() => undefined)
    check(`${width}: when Meta reports the message delivered, the page says “Delivered”`, /^Delivered\./.test(await flat('[data-testid=test-note]')), await flat('[data-testid=test-note]'))
  }

  const html = await p.content()
  check(`${width}: no token is anywhere in the page, nothing is yellow in it, and it does not scroll sideways`, !html.includes(accP.token) && (await p.evaluate((yellow) => [...document.querySelectorAll('[data-testid=whatsapp-connected] *')].every((el) => getComputedStyle(el).backgroundColor !== yellow), YELLOW)) && (await sideways()) <= 0)
  check(`${width}: the page raised no error`, pageErrors.length === 0, pageErrors)
  await p.screenshot({ path: path.join(outDir, `whatsapp-connected-${width}.png`), fullPage: true })
  await ctx.close()
}
await browser.close()
finish()
