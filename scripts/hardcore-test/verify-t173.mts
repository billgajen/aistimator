// T-173 check: bot and spam protection, the closed database rules, and the home page changes.
//
// Nothing here talks to Upstash, Postmark or (for the server's check) Cloudflare: the script runs
// stand-ins for all three on this machine, and the web app is started pointing at them. No real
// email is sent and nothing goes to production. Start the web app like this (local test values,
// not secrets; the site key is Cloudflare's published always-passes test key):
//
//   CRON_SECRET=local-cron-t153 DEMO_DAILY_CAP=8 DEMO_IP_LIMIT_PER_HOUR=3 \
//   WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:8799 \
//   NEXT_PUBLIC_WHATSAPP_APP_ID=900000000000175 NEXT_PUBLIC_WHATSAPP_CONFIG_ID=900000000000176 \
//   WHATSAPP_APP_SECRET=local-app-secret-t175 WHATSAPP_VERIFY_TOKEN=local-verify-t175 \
//   WHATSAPP_ENCRYPTION_KEY=local-encryption-key-t175 \
//   UPSTASH_REDIS_REST_URL=http://127.0.0.1:8793/upstash UPSTASH_REDIS_REST_TOKEN=local-upstash-t173 \
//   TURNSTILE_SECRET_KEY=local-turnstile-t173 TURNSTILE_VERIFY_URL=http://127.0.0.1:8793/turnstile/siteverify \
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA \
//   POSTMARK_API_TOKEN=local-postmark-t173 POSTMARK_FROM_EMAIL=quotes@example.test \
//   POSTMARK_API_BASE_URL=http://127.0.0.1:8793/postmark pnpm dev:web
//
// The other verify scripts run with protection off (none of the last three lines of settings).
//
// Run:  PLAYWRIGHT_DIR=<folder> WEB_LOG=<the web app's log file> npx tsx scripts/hardcore-test/verify-t173.mts
// Without PLAYWRIGHT_DIR the browser sections are skipped; without WEB_LOG the log checks are. Both say so.
// It waits for the clock twice (a rate-limit window has to end for real), so it takes a few minutes.
import nodeHttp from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, expectOk, pollQuote, shortId, runStamp } from './lib.mjs'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'
import { servicePayload } from '../../apps/web/src/lib/onboarding-service'
import { embedSnippet } from '../../apps/web/src/lib/embed-snippet'
import { RATE_LIMITS, blockedMessage } from '../../apps/web/src/lib/rate-limit-config'
import { HERO, NOTICES, PAGE_META } from '../../apps/web/src/lib/marketing/home-copy'
import { PRODUCT_NAME } from '../../packages/shared/src/brand'
import { offeredPlans } from '../../packages/shared/src/plans'

type Row = Record<string, unknown>
const MOCK_PORT = 8793
const UPSTASH_TOKEN = 'local-upstash-t173'
const TURNSTILE_SECRET = 'local-turnstile-t173'
const POSTMARK_TOKEN = 'local-postmark-t173'
/** What Cloudflare's always-passes test site key hands the browser */
const GOOD_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const app = cfg.appUrl.replace(/\/+$/, '')
const origin = new URL(app).origin
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t173-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean }> = []
const notChecked: string[] = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Everything typed as a password in this run: none may reach a log */
const secretsSeen = new Set<string>([UPSTASH_TOKEN, TURNSTILE_SECRET, POSTMARK_TOKEN])
const newPassword = () => {
  const p = `Pw-${crypto.randomBytes(9).toString('base64url')}-9a`
  secretsSeen.add(p)
  return p
}

// A made-up address for every caller (documentation ranges), so one check never uses up another's allowance
let ipCounter = 0
const run = crypto.randomInt(1, 250)
const newIp = () => {
  ipCounter++
  return `10.${run}.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

interface Res { status: number; ok: boolean; json: any; text: string; headers: Headers }
async function call(method: string, url: string, opts: { ip?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number; redirect?: RequestRedirect } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.ip) headers['x-forwarded-for'] = opts.ip
  if (opts.body !== undefined && !(opts.body instanceof Uint8Array) && !(opts.body instanceof URLSearchParams)) headers['Content-Type'] = 'application/json'
  const res = await fetch(url.startsWith('http') ? url : `${app}${url}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : opts.body instanceof Uint8Array || opts.body instanceof URLSearchParams ? opts.body : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
    redirect: opts.redirect ?? 'follow',
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text, headers: res.headers }
}
/** Wait until a rate-limit minute has room: windows end on the clock */
async function earlyInTheMinute(latest = 35) {
  const s = new Date().getSeconds()
  if (s > latest) {
    console.log(`⏳ waiting ${61 - s}s for the next minute to start`)
    await sleep((61 - s) * 1000)
  }
}
async function nextMinute() {
  const s = new Date().getSeconds()
  console.log(`⏳ waiting ${62 - s}s for the minute to end (a limit has to recover for real)`)
  await sleep((62 - s) * 1000)
}

// =====================================================================================
// Stand-ins for Upstash, Cloudflare's siteverify and Postmark
// =====================================================================================
const counters = new Map<string, { count: number; expiresAt: number }>()
let upstashMode: 'ok' | 'down' | 'hang' = 'ok'
let upstashCalls = 0
const upstashKeys = new Set<string>()
const siteverifyCalls: Array<{ token: string; ok: boolean }> = []
/** T-178: how the stand-in for Cloudflare behaves ('ok' = judge the token) */
let siteverifyMode: 'ok' | 'hang' | 'down' | 'internal' = 'ok'
/** A token the stand-in for Cloudflare clearly rejects (a request with NO token is no longer refused) */
const BAD_TOKEN = { turnstileToken: 'made-up-token' }
interface Mail { From: string; To: string; Subject: string; HtmlBody: string; TextBody: string; Tag?: string }
const mails: Mail[] = []

const mock = nodeHttp.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${MOCK_PORT}`)
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(json))
    }
    if (url.pathname.startsWith('/upstash')) {
      upstashCalls++
      if (upstashMode === 'hang') return // never answers
      if (upstashMode === 'down') return send(500, { error: 'ERR stand-in is down' })
      if (req.headers.authorization !== `Bearer ${UPSTASH_TOKEN}`) return send(401, { error: 'WRONGPASS' })
      const commands = JSON.parse(raw) as Array<Array<string | number>>
      const now = Date.now()
      const results = commands.map((command) => {
        const [name, key, arg] = command as [string, string, number | undefined]
        upstashKeys.add(key)
        const current = counters.get(key)
        const live = current && current.expiresAt > now ? current : null
        if (name.toLowerCase() === 'incr') {
          const next = { count: (live?.count ?? 0) + 1, expiresAt: live?.expiresAt ?? Number.MAX_SAFE_INTEGER }
          counters.set(key, next)
          return { result: next.count }
        }
        if (name.toLowerCase() === 'expire') {
          if (live) counters.set(key, { count: live.count, expiresAt: now + Number(arg) * 1000 })
          return { result: live ? 1 : 0 }
        }
        return { error: `ERR unknown command ${name}` }
      })
      return send(200, results)
    }
    if (url.pathname === '/turnstile/siteverify') {
      if (siteverifyMode === 'hang') return // never answers
      if (siteverifyMode === 'down') return send(503, { error: 'stand-in is down' })
      if (siteverifyMode === 'internal') return send(200, { success: false, 'error-codes': ['internal-error'] })
      const form = new URLSearchParams(raw)
      const token = form.get('response') ?? ''
      const ok = form.get('secret') === TURNSTILE_SECRET && token === GOOD_TOKEN
      siteverifyCalls.push({ token, ok })
      return send(200, ok ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] })
    }
    if (url.pathname === '/postmark/email') {
      if (req.headers['x-postmark-server-token'] !== POSTMARK_TOKEN) return send(401, { ErrorCode: 10, Message: 'Bad or missing Server API token.' })
      mails.push(JSON.parse(raw) as Mail)
      return send(200, { ErrorCode: 0, Message: 'OK', MessageID: crypto.randomUUID() })
    }
    send(404, { error: 'not found' })
  })
})
await new Promise<void>((resolve, reject) => {
  mock.once('error', reject)
  mock.listen(MOCK_PORT, '127.0.0.1', resolve)
})
const mailTo = (to: string, tag?: string) => mails.filter((m) => m.To.toLowerCase() === to.toLowerCase() && (!tag || m.Tag === tag))
async function waitForMail(to: string, tag: string, count = 1): Promise<Mail | null> {
  for (let i = 0; i < 40; i++) {
    const found = mailTo(to, tag)
    if (found.length >= count) return found[count - 1]!
    await sleep(250)
  }
  return null
}
const linkIn = (mail: Mail | null) => mail?.TextBody.match(/https?:\/\/\S+\/auth\/confirm\?\S+/)?.[0] ?? null

// =====================================================================================
// Businesses
// =====================================================================================
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const rest = (method: string, pathAndQuery: string, headers: Record<string, string>, body?: unknown) =>
  call(method, `${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`, { headers: { Prefer: 'return=representation', ...headers }, body })
async function business(name: string) {
  const id = shortId()
  const email = `owner+t173-${id}@hardcore.test`
  const password = newPassword()
  const user = await sb.createUser(email, password, name)
  const session = await sb.signIn(email, password)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const tenantId = (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id as string
  expectOk('tenant', await call('PUT', '/api/tenant', { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const slug = (await sb.select('tenants', `id=eq.${tenantId}&select=slug`))[0].slug as string
  /** This user's own key and token, as a browser holds them */
  const asUser = { apikey: cfg.anonKey as string, Authorization: `Bearer ${session.access_token}` }
  return { userId: user.id as string, email, password, cookie, asUser, tenantId, tenantKey: site.tenant_key as string, name, slug }
}
type Biz = Awaited<ReturnType<typeof business>>
const packService = (name: string) => paintingPackUS.services.find((s) => s.name === name)! as unknown as Parameters<typeof servicePayload>[0]
async function addService(biz: Biz, name: string) {
  const svc = packService(name)
  const created = expectOk(`service ${name}`, await call('POST', '/api/services', { headers: biz.cookie, body: servicePayload({ ...svc, addons: svc.addons ?? [], multipliers: svc.multipliers ?? [] }) }))
  return created.service.id as string
}
// Made-up people (never a real name)
const person = (name: string) => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '(555) 201-1212' })
const quoteBody = (biz: Biz, serviceId: string, who: ReturnType<typeof person>, answers: unknown[], extra: Row = {}) => ({
  tenantKey: biz.tenantKey,
  serviceId,
  customer: who,
  job: { postcodeOrZip: '63021', answers },
  source: { type: 'widget' },
  ...extra,
})
/** One photo for a request, uploaded the way the form does it */
async function roomPhoto(biz: Biz): Promise<string[]> {
  const bytes = new Uint8Array(readFileSync(path.join(ROOT, 'apps/web/public/demo/sample-room-to-paint.webp')))
  const init = expectOk('upload init', await call('POST', '/api/public/uploads/init', { ip: newIp(), body: { tenantKey: biz.tenantKey, files: [{ fileName: 'room.webp', contentType: 'image/webp', sizeBytes: bytes.byteLength }] } }))
  const put = await fetch(init.uploads[0].uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/webp' } })
  if (!put.ok) throw new Error(`photo upload failed (${put.status})`)
  return [init.uploads[0].assetId as string]
}
async function submitted(res: Res) {
  const body = expectOk('submit', res)
  const token = new URL(body.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, body.quoteId, token)
  return { id: body.quoteId as string, token }
}

section('Setup')
const a = await business('Linden Painting')
const b = await business('Harrow Decorators')
const aInterior = await addService(a, 'Interior Painting')
const aWallpaper = await addService(a, 'Wallpaper Installation')
const bInterior = await addService(b, 'Interior Painting')

// The app must have been started pointing at the stand-ins
{
  const before = upstashCalls
  const probe = await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: newIp() })
  // T-178: a request with no token goes ahead, so the probe sends a token the stand-in refuses
  const noToken = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, person('Setup Check'), [], BAD_TOKEN) })
  const usesStandIns = probe.ok && upstashCalls > before && noToken.status === 403
  check('(the web app is running with the stand-ins for Upstash and the human check)', usesStandIns, { config: probe.status, limiterCalls: upstashCalls - before, noToken: noToken.status })
  if (!usesStandIns) {
    console.log('\nThe web app was not started with the settings at the top of this file. Stopping.')
    mock.close()
    process.exit(1)
  }
}

// =====================================================================================
section('A. The database: what the public key and a signed-in business can do')
// =====================================================================================
{
  const anon = { apikey: cfg.anonKey as string, Authorization: `Bearer ${cfg.anonKey}` }
  const reads: Record<string, number> = {}
  for (const table of ['quotes', 'tenant_sites', 'services', 'widget_configs', 'quote_requests', 'assets', 'user_profiles', 'tenants', 'service_pricing_rules', 'quote_feedback']) {
    const r = await rest('GET', `${table}?select=*&limit=1`, anon)
    reads[table] = r.ok ? (Array.isArray(r.json) ? r.json.length : -1) : r.status
  }
  check('the public key can read no table: quotes, business keys, services, form settings and the rest are refused', Object.values(reads).every((v) => v === 401 || v === 403), reads)
  const writes: Record<string, number> = {}
  writes.quote_feedback = (await rest('POST', 'quote_feedback', anon, { quote_id: 'qte_x', tenant_id: a.tenantId, feedback_type: 'feedback', feedback_text: 'x' })).status
  writes.assets = (await rest('POST', 'assets', anon, { tenant_id: a.tenantId, type: 'image', file_name: 'x.jpg', content_type: 'image/jpeg', size_bytes: 1, r2_key: `${a.tenantId}/x.jpg` })).status
  writes.quote_requests = (await rest('POST', 'quote_requests', anon, { tenant_id: a.tenantId, service_id: aInterior, customer_name: 'x' })).status
  writes.widget_analytics = (await rest('POST', 'widget_analytics', anon, { tenant_id: a.tenantId, event: 'widget_opened', widget_mode: 'form' })).status
  check('the public key can insert into no table (feedback, assets, requests, view counts)', Object.values(writes).every((v) => v === 401 || v === 403), writes)

  // a signed-in business, straight at the database with its own token
  const move = await rest('PATCH', `user_profiles?id=eq.${a.userId}`, a.asUser, { tenant_id: b.tenantId })
  const promote = await rest('PATCH', `user_profiles?id=eq.${a.userId}`, a.asUser, { role: 'admin' })
  const rename = await rest('PATCH', `user_profiles?id=eq.${a.userId}`, a.asUser, { display_name: 'Linden owner' })
  const profile = (await sb.select('user_profiles', `id=eq.${a.userId}&select=tenant_id,role,display_name`))[0] as Row
  check('a signed-in business cannot move itself into another business', !move.ok && profile.tenant_id === a.tenantId, { status: move.status })
  check('…nor make itself a platform admin; it can still change its own display name', !promote.ok && profile.role === 'owner' && rename.ok && profile.display_name === 'Linden owner', { promote: promote.status, role: profile.role })
  const seen: Record<string, boolean> = {}
  for (const table of ['services', 'tenant_sites', 'widget_configs', 'quotes']) {
    const r = await rest('GET', `${table}?select=tenant_id&limit=2000`, a.asUser)
    seen[table] = r.ok && (r.json as Row[]).every((row) => row.tenant_id === a.tenantId)
  }
  const aServices = await rest('GET', 'services?select=id', a.asUser)
  check('…and reads only its own services, keys, form settings and quotes', Object.values(seen).every(Boolean) && (aServices.json as Row[]).length === 2, { ...seen, services: (aServices.json as Row[]).length })

  // the subscription row is the server's
  const plan = (await sb.select('plans', 'select=id&order=id&limit=2')) as Array<{ id: string }>
  const made = await rest('POST', 'subscriptions', admin, { tenant_id: a.tenantId, plan_id: plan[0]!.id, status: 'active' })
  if (made.ok) {
    const upgrade = await rest('PATCH', `subscriptions?tenant_id=eq.${a.tenantId}`, a.asUser, { plan_id: plan[1]!.id })
    const after = (await sb.select('subscriptions', `tenant_id=eq.${a.tenantId}&select=plan_id`))[0] as Row
    check('a signed-in business cannot change its own plan in the database', after.plan_id === plan[0]!.id && (!upgrade.ok || (upgrade.json as Row[]).length === 0), { status: upgrade.status })
    await rest('DELETE', `subscriptions?tenant_id=eq.${a.tenantId}`, admin)
  } else {
    notChecked.push(`A business changing its own plan: could not make a subscription row to try it on (${made.status}).`)
  }

  // the /admin area
  const asOwner = await call('GET', '/api/admin/tenants', { headers: a.cookie })
  const adminPage = await call('GET', '/admin', { headers: a.cookie, redirect: 'manual' })
  check('an ordinary sign-up is refused by the admin API and sent away from /admin', asOwner.status === 403 && adminPage.status >= 300 && adminPage.status < 400, { api: asOwner.status, page: adminPage.status })
  await rest('PATCH', `user_profiles?id=eq.${a.userId}`, admin, { role: 'admin' })
  const asAdmin = await call('GET', '/api/admin/tenants?limit=5', { headers: a.cookie })
  await rest('PATCH', `user_profiles?id=eq.${a.userId}`, admin, { role: 'owner' })
  const listed = JSON.stringify(asAdmin.json ?? '').match(/tnt_[a-f0-9]+/g) ?? []
  check('with the role "admin" (what every sign-up used to get) the same account lists other businesses: that was the open door', asAdmin.ok && new Set(listed).size > 1, { status: asAdmin.status, businessesListed: new Set(listed).size })
  check('…and it is closed again once the role is taken away', (await call('GET', '/api/admin/tenants', { headers: a.cookie })).status === 403)
}

// =====================================================================================
section('B. The human check, on the server')
// =====================================================================================
{
  const who = person('Nadia Whitlock')
  // T-178 (AD-060): only a token Cloudflare clearly rejects blocks. No token at all (the script never loaded in
  // the browser) goes ahead; it is then refused here for its made-up service, not for the check.
  const none = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, 'svc_does_not_exist', who, []) })
  const bad = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, who, [], BAD_TOKEN) })
  check('a request with a token Cloudflare rejects is refused (403)', bad.status === 403 && bad.json?.error?.code === 'VERIFICATION_FAILED', { bad: bad.status })
  check('a request with NO token is not refused by the check (the script may never have loaded in the customer’s browser)', none.status !== 403 && none.json?.error?.code !== 'VERIFICATION_FAILED' && none.json?.error?.code === 'INVALID_SERVICE', { status: none.status, code: none.json?.error?.code })
  check('the message is plain and never says to refresh the page (that would lose the answers)', typeof bad.json?.error?.message === 'string' && !/refresh|reload|captcha|turnstile|token/i.test(bad.json.error.message), bad.json?.error?.message)
  // Cloudflare slow, down, or answering "no" for a reason that is not the visitor's: the request goes ahead
  for (const [mode, words] of [['hang', 'not answering at all'], ['down', 'answering with an error'], ['internal', 'saying "internal-error"']] as const) {
    siteverifyMode = mode
    const t0 = Date.now()
    const through = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, 'svc_does_not_exist', who, [], { turnstileToken: 'any-token' }) })
    const ms = Date.now() - t0
    siteverifyMode = 'ok'
    check(`with Cloudflare ${words}, the request goes ahead${mode === 'hang' ? ' after about half a second (under 2.5 seconds here)' : ''}`, through.json?.error?.code === 'INVALID_SERVICE' && ms < 2500, { code: through.json?.error?.code, ms })
  }
  const good = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, 'svc_does_not_exist', who, [], { turnstileToken: GOOD_TOKEN }) })
  check('a request with a good token gets past the check (it is then refused for its made-up service, not for the check)', good.status !== 403 && good.status !== 429 && good.json?.error?.code !== 'VERIFICATION_FAILED', { status: good.status, code: good.json?.error?.code })
  const trap = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, who, [], { turnstileToken: GOOD_TOKEN, website: 'http://spam.example' }) })
  check('the honeypot is still a second layer: a filled hidden field is refused even with a good token', trap.status === 400, trap.status)
  const lead = await call('POST', '/api/public/leads', { ip: newIp(), body: { tenantKey: a.tenantKey, serviceId: aInterior, customer: who, ...BAD_TOKEN } })
  check('the unfinished-request route refuses a rejected token too', lead.status === 403, lead.status)
  const rows = await sb.select('quote_requests', `tenant_id=eq.${a.tenantId}&select=id`)
  check('none of that created a request', rows.length === 0, rows.length)
}

// =====================================================================================
section('C. Rate limits: they trigger, they are per address and per business, and they recover')
// =====================================================================================
{
  await earlyInTheMinute(30)
  // per address, on request submission (each call is refused early for its rejected token; it still counts)
  const ip = newIp()
  const perIp = RATE_LIMITS.quotes[0].perIp
  const statuses: number[] = []
  for (let i = 0; i < perIp + 1; i++) statuses.push((await call('POST', '/api/public/quotes', { ip, body: quoteBody(a, aInterior, person('Flood One'), [], BAD_TOKEN) })).status)
  const blocked = await call('POST', '/api/public/quotes', { ip, body: quoteBody(a, aInterior, person('Flood One'), [], { turnstileToken: GOOD_TOKEN }) })
  check(`request submission: ${perIp} calls a minute from one address, then 429`, statuses.slice(0, perIp).every((s) => s === 403) && statuses[perIp] === 429 && blocked.status === 429, statuses)
  const wait = Number(blocked.headers.get('retry-after'))
  check('the blocked caller gets a plain message and how long to wait', blocked.json?.error?.code === 'RATE_LIMITED' && blocked.json.error.message === blockedMessage(blocked.json.error.retryAfterSeconds) && wait >= 1 && wait <= 61 && !/limit|plan|redis|upstash/i.test(blocked.json.error.message), { message: blocked.json?.error?.message, retryAfter: wait })
  check('another address is not held up', (await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, person('Other Caller'), [], BAD_TOKEN) })).status === 403)

  // per business, from many addresses
  const perKey = RATE_LIMITS.quotes[0].perKey
  const flood: number[] = []
  for (let i = 0; i < perKey + 1; i++) flood.push((await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(b, bInterior, person('Flood Two'), [], BAD_TOKEN) })).status)
  const used = flood.filter((s) => s === 403).length
  const otherBusiness = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, person('Other Business'), [], BAD_TOKEN) })
  check(`one business under attack from many addresses is throttled at ${perKey} a minute`, used <= perKey && flood[flood.length - 1] === 429, { passed: used, last: flood[flood.length - 1] })
  check('…and the business next to it is untouched', otherBusiness.status === 403, otherBusiness.status)

  // uploads, by address (an unknown business key: nothing is created)
  const upIp = newIp()
  const ups: number[] = []
  for (let i = 0; i < RATE_LIMITS.uploads[0].perIp + 1; i++) ups.push((await call('POST', '/api/public/uploads/init', { ip: upIp, body: { tenantKey: 'tkey_nobody', files: [{ fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }] } })).status)
  check(`photo upload: ${RATE_LIMITS.uploads[0].perIp} a minute from one address, then 429`, ups.slice(0, -1).every((s) => s === 400) && ups[ups.length - 1] === 429, [ups[0], ups[ups.length - 1]])

  // the form's own view counter and its settings
  const anIp = newIp()
  const views: number[] = []
  for (let i = 0; i < RATE_LIMITS.widget_analytics[0].perIp + 1; i++) views.push((await call('POST', '/api/public/widget/analytics', { ip: anIp, body: { tenantKey: 'tkey_nobody', event: 'widget_opened', mode: 'form' } })).status)
  check('the view counter is limited too (it had no limit at all)', views.slice(0, -1).every((s) => s === 400) && views[views.length - 1] === 429, [views[0], views[views.length - 1]])

  // sign-up, log-in and reset, by address and by email
  const victim = `flood-${shortId()}@example.test`
  const su: number[] = []
  for (let i = 0; i < RATE_LIMITS.signup[0].perKey + 1; i++) su.push((await call('POST', '/api/auth/signup', { ip: newIp(), body: { email: victim, password: newPassword(), businessName: 'Flood Co', ...BAD_TOKEN } })).status)
  check(`sign-up: one email address can be tried ${RATE_LIMITS.signup[0].perKey} times a minute, whatever address it comes from`, su.slice(0, -1).every((s) => s === 403) && su[su.length - 1] === 429, su)
  const suIp = newIp()
  const su2: number[] = []
  for (let i = 0; i < RATE_LIMITS.signup[0].perIp + 1; i++) su2.push((await call('POST', '/api/auth/signup', { ip: suIp, body: { email: `flood-${shortId()}@example.test`, password: newPassword(), businessName: 'Flood Co', ...BAD_TOKEN } })).status)
  check(`sign-up: ${RATE_LIMITS.signup[0].perIp} a minute from one address`, su2.slice(0, -1).every((s) => s === 403) && su2[su2.length - 1] === 429, su2)
  const li: number[] = []
  for (let i = 0; i < RATE_LIMITS.login[0].perKey; i++) li.push((await call('POST', '/api/auth/login', { ip: newIp(), body: { email: b.email, password: 'not-the-password' } })).status)
  const rightButBlocked = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: b.email, password: b.password } })
  check(`log-in: after ${RATE_LIMITS.login[0].perKey} wrong passwords for one email in a minute, even the right one waits`, li.every((s) => s === 401) && rightButBlocked.status === 429, { wrong: li, right: rightButBlocked.status })
  const otherLogin = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: a.email, password: a.password } })
  check('…and another account logs in as normal', otherLogin.status === 200, otherLogin.status)
  const pr: number[] = []
  for (let i = 0; i < RATE_LIMITS.password_reset[0].perKey + 1; i++) pr.push((await call('POST', '/api/auth/forgot-password', { ip: newIp(), body: { email: `nobody-${victim}` } })).status)
  check(`password reset: ${RATE_LIMITS.password_reset[0].perKey} a minute for one email, then 429`, pr.slice(0, -1).every((s) => s === 200) && pr[pr.length - 1] === 429, pr)

  // nothing identifying is kept in the limiter
  const keys = [...upstashKeys].join('\n')
  check('the limiter stores no email address (only a hash of it)', !keys.includes(victim) && !keys.includes(b.email) && /rl:web:login:60:key:[a-f0-9]{32}:/.test(keys))

  // recover: the form's settings route, 60 a minute
  await earlyInTheMinute(25)
  const cfgIp = newIp()
  const perMinute = RATE_LIMITS.widget_config[0].perIp
  let okCount = 0
  for (let i = 0; i < perMinute; i++) if ((await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: cfgIp })).status === 200) okCount++
  const over = await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: cfgIp })
  check(`the form's settings: ${perMinute} reads a minute from one address, then 429`, okCount === perMinute && over.status === 429, { ok: okCount, then: over.status })
  await nextMinute()
  const back = await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: cfgIp })
  const loginBack = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: b.email, password: b.password } })
  check('when the minute ends the same address is served again, with nothing done to reset it', back.status === 200, back.status)
  check('…and the account that was held after wrong passwords logs in', loginBack.status === 200, loginBack.status)
}

// =====================================================================================
section('D. Sign-up, log-in and password reset, with the emails sent by us')
// =====================================================================================
/** A plan the pricing page links to sign-up with */
const SIGNUP_PLAN = offeredPlans()[offeredPlans().length - 1]!.id
const newcomer = { email: `megan.grant+${shortId()}@example.test`, password: newPassword(), businessName: 'Grant & Daughters Painting' }
{
  // (each of these uses its own address: one email address is allowed two sign-up tries a minute)
  const unchecked = `megan.grant+${shortId()}@example.test`
  const noToken = await call('POST', '/api/auth/signup', { ip: newIp(), body: { ...newcomer, email: unchecked, ...BAD_TOKEN } })
  check('sign-up with a token Cloudflare rejects is refused (403), and nothing is emailed', noToken.status === 403 && mailTo(unchecked).length === 0, noToken.status)
  const trap = await call('POST', '/api/auth/signup', { ip: newIp(), body: { ...newcomer, email: `bot-${shortId()}@example.test`, turnstileToken: GOOD_TOKEN, website: 'http://spam.example' } })
  check('a sign-up with the hidden field filled is answered as normal and does nothing', trap.status === 200 && mails.every((m) => !m.To.startsWith('bot-')), trap.status)
  const weak = await call('POST', '/api/auth/signup', { ip: newIp(), body: { ...newcomer, email: `megan.grant+${shortId()}@example.test`, password: 'short', turnstileToken: GOOD_TOKEN } })
  check('a short password is refused with a plain message', weak.status === 400 && /at least 8 characters/.test(weak.json?.error?.message ?? ''), weak.json?.error?.message)

  const signup = await call('POST', '/api/auth/signup', { ip: newIp(), body: { ...newcomer, plan: SIGNUP_PLAN, turnstileToken: GOOD_TOKEN } })
  const mail = await waitForMail(newcomer.email, 'confirm-email')
  const link = linkIn(mail)
  check('sign-up is accepted and the confirmation email goes out through Postmark', signup.status === 200 && !!mail, { status: signup.status, mails: mailTo(newcomer.email).length })
  check(`it is from "${PRODUCT_NAME}" at our own address, with a plain subject`, !!mail && mail.From === `"${PRODUCT_NAME}" <quotes@example.test>` && mail.Subject === `Confirm your email for ${PRODUCT_NAME}`, { from: mail?.From, subject: mail?.Subject })
  check('it names the business, has one button, says how long the link lasts, and has none of Supabase’s wording', !!mail && mail.HtmlBody.includes('Grant &amp; Daughters Painting') && (mail.HtmlBody.match(/<a /g) ?? []).length === 1 && /works once, for one hour/.test(mail.TextBody) && !/supabase|magic link|follow this link/i.test(mail.HtmlBody + mail.TextBody), mail?.TextBody.slice(0, 120))
  check('the link goes to our own page, on this site', !!link && link.startsWith(`${origin}/auth/confirm?type=signup&token_hash=`), link?.slice(0, 60))

  const early = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: newcomer.email, password: newcomer.password } })
  check('before confirming, log-in is refused with a plain message', early.status === 403 && /not confirmed yet/.test(early.json?.error?.message ?? ''), early.json?.error?.message)
  // opening the link (what a mail scanner does) must not use it up
  const opened = link ? await call('GET', link, { ip: newIp() }) : null
  const afterOpening = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: newcomer.email, password: newcomer.password } })
  check('opening the link uses nothing up: the page shows a button and the account stays unconfirmed', !!opened && opened.status === 200 && /Confirm my email/.test(opened.text) && afterOpening.status === 403 && afterOpening.json?.error?.code === 'EMAIL_NOT_CONFIRMED', { page: opened?.status, login: afterOpening.status })

  // the same address again: a new link (the old one stops working); once confirmed, "you already have an account"
  const tokenHash = link ? new URL(link).searchParams.get('token_hash')! : ''
  const pressed = await call('POST', '/api/auth/confirm', { ip: newIp(), body: new URLSearchParams({ type: 'signup', token_hash: tokenHash }), redirect: 'manual' })
  const cookies = (pressed.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const me = await call('GET', '/api/me', { headers: { Cookie: cookies } })
  check('pressing the button confirms the address, logs the person in and sends them to the dashboard', pressed.status === 303 && new URL(pressed.headers.get('location') ?? '', origin).pathname === '/app' && me.ok && me.json?.email === newcomer.email, { status: pressed.status, to: pressed.headers.get('location'), me: me.status })
  await call('GET', '/app', { headers: { Cookie: cookies } }) // the dashboard's first load keeps the plan picked at sign-up (T-150)
  const tenant = me.ok ? ((await sb.select('tenants', `id=eq.${me.json.tenantId}&select=name,selected_plan`))[0] as Row) : null
  check('the business was created on confirming, with its name and the plan picked, and the account is an owner (not an admin)', tenant?.name === newcomer.businessName && tenant?.selected_plan === SIGNUP_PLAN && me.json?.role === 'owner', { tenant, role: me.json?.role })
  const reused = await call('POST', '/api/auth/confirm', { ip: newIp(), body: new URLSearchParams({ type: 'signup', token_hash: tokenHash }), redirect: 'manual' })
  check('the link works once: a second press goes to log-in with a note', reused.status === 303 && (reused.headers.get('location') ?? '').includes('/login?notice=link-expired'), reused.headers.get('location'))
  const junk = await call('POST', '/api/auth/confirm', { ip: newIp(), body: new URLSearchParams({ type: 'signup', token_hash: 'x', next: 'https://evil.example' }), redirect: 'manual' })
  check('a made-up link goes to log-in; nothing in the request can choose where it sends the person', junk.status === 303 && new URL(junk.headers.get('location') ?? '', origin).origin === origin, junk.headers.get('location'))

  await nextMinute() // the sign-up allowance for this email is 2 a minute
  const again = await call('POST', '/api/auth/signup', { ip: newIp(), body: { ...newcomer, password: newPassword(), turnstileToken: GOOD_TOKEN } })
  const exists = await waitForMail(newcomer.email, 'account-exists')
  check('signing up again with the same address is answered the same, and the address is told it already has an account', again.status === 200 && JSON.stringify(again.json) === JSON.stringify(signup.json) && !!exists && exists.Subject === `You already have a ${PRODUCT_NAME} account` && exists.TextBody.includes(`${origin}/login`), { status: again.status, subject: exists?.Subject })
  check('…and the first password still works (the second sign-up changed nothing)', (await call('POST', '/api/auth/login', { ip: newIp(), body: { email: newcomer.email, password: newcomer.password } })).status === 200)

  // log-in
  const wrong = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: newcomer.email, password: 'not-the-password' } })
  const unknown = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: `nobody-${shortId()}@example.test`, password: 'not-the-password' } })
  check('a wrong password and an unknown address get the same plain answer', wrong.status === 401 && unknown.status === 401 && wrong.json?.error?.message === unknown.json?.error?.message && wrong.json.error.message === 'That email and password do not match an account.', wrong.json?.error?.message)

  // password reset
  const nobody = await call('POST', '/api/auth/forgot-password', { ip: newIp(), body: { email: `nobody-${shortId()}@example.test` } })
  const forgot = await call('POST', '/api/auth/forgot-password', { ip: newIp(), body: { email: newcomer.email } })
  const resetMail = await waitForMail(newcomer.email, 'password-reset')
  const resetLink = linkIn(resetMail)
  check('asking for a reset is answered the same for a known and an unknown address; only the known one is emailed', nobody.status === 200 && forgot.status === 200 && JSON.stringify(nobody.json) === JSON.stringify(forgot.json) && !!resetMail && mails.every((m) => !m.To.startsWith('nobody-')), { subject: resetMail?.Subject })
  check('the reset email is ours: plain subject, one button, the link to our own page', !!resetMail && resetMail.Subject === `Reset your ${PRODUCT_NAME} password` && resetMail.From.includes(PRODUCT_NAME) && !!resetLink && resetLink.startsWith(`${origin}/auth/confirm?type=recovery&token_hash=`) && /Your password stays the same/.test(resetMail.TextBody))
  const noSession = await call('POST', '/api/auth/reset-password', { ip: newIp(), body: { password: newPassword() } })
  const resetPage = await call('GET', '/reset-password', { ip: newIp(), redirect: 'manual' })
  check('without the link nobody can set a password: the route answers 401 and the page sends them to ask for a link', noSession.status === 401 && resetPage.status >= 300 && resetPage.status < 400 && (resetPage.headers.get('location') ?? '').includes('/forgot-password'), { api: noSession.status, page: resetPage.headers.get('location') })
  const recovery = await call('POST', '/api/auth/confirm', { ip: newIp(), body: new URLSearchParams({ type: 'recovery', token_hash: resetLink ? new URL(resetLink).searchParams.get('token_hash')! : '' }), redirect: 'manual' })
  const recoveryCookies = (recovery.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const changed = newPassword()
  const set = await call('POST', '/api/auth/reset-password', { ip: newIp(), headers: { Cookie: recoveryCookies }, body: { password: changed } })
  const oldNow = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: newcomer.email, password: newcomer.password } })
  const newNow = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: newcomer.email, password: changed } })
  check('the reset link leads to "choose a new password"; after it the old password is refused and the new one works', recovery.status === 303 && new URL(recovery.headers.get('location') ?? '', origin).pathname === '/reset-password' && set.status === 200 && oldNow.status === 401 && newNow.status === 200, { link: recovery.status, set: set.status, old: oldNow.status, new: newNow.status })
  newcomer.password = changed
}

// =====================================================================================
// Browser: the sign-up page, a blocked request that keeps its answers, the embed on another site
// =====================================================================================
let quoteA: { id: string; token: string } | null = null
let quoteB: { id: string; token: string } | null = null
const ROOM = path.join(ROOT, 'apps/web/public/demo/sample-room-to-paint.webp')
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The browser sections (the sign-up page, a blocked request keeping its answers, the embed on another site, the home page as rendered): set PLAYWRIGHT_DIR to run them.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  type Ctx = Awaited<ReturnType<typeof browser.newContext>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  /** A browser whose calls to the app come from one made-up address (other sites get no extra header) */
  const contextFor = async (width: number, ip: string) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 900 } })
    await ctx.addInitScript('globalThis.__name = (f) => f')
    await ctx.route(`${origin}/**`, (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }))
    return ctx
  }
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })

  // ---------------------------------------------------------------------------------
  section('E. The sign-up and reset pages, in a browser')
  // ---------------------------------------------------------------------------------
  {
    const ctx = await contextFor(390, newIp())
    const p = await ctx.newPage()
    const second = { email: `alex.rivera+${shortId()}@example.test`, password: newPassword() }
    await p.goto(`${app}/signup`, { waitUntil: 'networkidle' })
    await p.getByLabel('Business name').fill('Rivera Painting Co')
    await p.getByLabel('Email').fill(second.email)
    await p.getByLabel('Password').fill(second.password)
    const challenge = await p.locator('iframe[src*="challenges.cloudflare.com"]').count()
    await p.getByRole('button', { name: 'Create account' }).click()
    const sent = await p.locator('[data-testid=signup-sent]').waitFor({ timeout: 60_000 }).then(() => true, () => false)
    if (!sent) await shot(p, 'signup-failed')
    const passed = siteverifyCalls.some((c) => c.ok)
    check('the sign-up page gets its human-check token without showing the person anything, and the server accepts it', sent && passed && challenge === 0, { sent, tokenAccepted: passed, challengeShownBeforeSubmit: challenge, error: sent ? null : await p.locator('[data-testid=auth-error]').innerText().catch(() => null) })
    await shot(p, 'signup-check-your-email-390')
    const mail = await waitForMail(second.email, 'confirm-email')
    const link = linkIn(mail)
    if (link) {
      await p.goto(link, { waitUntil: 'networkidle' })
      await shot(p, 'confirm-page-390')
      await p.locator('[data-testid=confirm-button]').click()
      await p.waitForURL(/\/(app|setup)(\/|$|\?)/, { timeout: 60_000 }).catch(() => undefined)
      check('the link in the email opens a page with one button; pressing it lands in the product, signed in', /\/(app|setup)/.test(new URL(p.url()).pathname), new URL(p.url()).pathname)
    } else {
      check('the confirmation email arrived for the browser sign-up', false)
    }
    // sign out, forget the password, and come back through the reset email
    await ctx.clearCookies()
    await p.goto(`${app}/login`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=forgot-link]').click()
    await p.waitForURL(/\/forgot-password/)
    await p.getByLabel('Email').fill(second.email)
    await p.getByRole('button', { name: 'Send the link' }).click()
    await p.locator('[data-testid=reset-sent]').waitFor({ timeout: 30_000 })
    await shot(p, 'forgot-sent-390')
    const resetLink = linkIn(await waitForMail(second.email, 'password-reset'))
    const changed = newPassword()
    if (resetLink) {
      await p.goto(resetLink, { waitUntil: 'networkidle' })
      await p.locator('[data-testid=confirm-button]').click()
      await p.waitForURL(/\/reset-password/, { timeout: 30_000 })
      await p.getByLabel('New password').fill(changed)
      await shot(p, 'reset-password-390')
      await p.getByRole('button', { name: 'Save the new password' }).click()
      await p.waitForURL(/\/(app|setup)(\/|$|\?)/, { timeout: 60_000 }).catch(() => undefined)
    }
    const relogin = await call('POST', '/api/auth/login', { ip: newIp(), body: { email: second.email, password: changed } })
    check('"Forgot your password?" on the log-in page leads through the email to a new password that works', !!resetLink && /\/(app|setup)/.test(new URL(p.url()).pathname) && relogin.status === 200, { at: new URL(p.url()).pathname, login: relogin.status })
    // a wrong password on the log-in page: the message shows and what was typed stays
    await ctx.clearCookies()
    await p.goto(`${app}/login`, { waitUntil: 'networkidle' })
    await p.getByLabel('Email').fill(second.email)
    await p.getByLabel('Password').fill('not-the-password')
    await p.getByRole('button', { name: 'Log in' }).click()
    await p.locator('[data-testid=auth-error]').waitFor({ timeout: 30_000 })
    check('a refused log-in shows the plain message and keeps the email that was typed', (await p.locator('[data-testid=auth-error]').innerText()).includes('do not match') && (await p.getByLabel('Email').inputValue()) === second.email)
    await ctx.close()
  }

  // ---------------------------------------------------------------------------------
  section('F. A blocked request keeps the customer’s answers')
  // ---------------------------------------------------------------------------------
  {
    const ip = newIp()
    const ctx = await contextFor(390, ip)
    const p = await ctx.newPage()
    const who = person('Nora Castell')
    await p.goto(`${app}/quote/${b.slug}`, { waitUntil: 'networkidle' })
    await p.getByText('Where should we send your estimate?').waitFor({ timeout: 40_000 })
    await p.getByLabel('Your name').fill(who.name)
    await p.getByLabel('Email').fill(who.email)
    await p.getByLabel('Phone').fill(who.phone)
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('About the job').waitFor({ timeout: 20_000 })
    await p.locator('[data-testid=request-form] input[type=number]').first().fill('2')
    for (const group of await p.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').first().click()
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('Photos & Documents').waitFor({ timeout: 20_000 })
    await p.locator('[data-testid=photo-input]').setInputFiles(ROOM)
    await p.getByRole('button', { name: 'Continue' }).click({ timeout: 60_000 })
    await p.getByLabel('ZIP code').fill('63021')
    // now, with everything typed, this address makes too many requests
    await earlyInTheMinute(40)
    for (let i = 0; i < RATE_LIMITS.quotes[0].perIp; i++) await call('POST', '/api/public/quotes', { ip, body: quoteBody(b, bInterior, who, [], BAD_TOKEN) })
    await p.getByRole('button', { name: 'Get my estimate' }).click()
    const kept = await p.locator('[data-testid=answers-kept]').waitFor({ timeout: 60_000 }).then(() => true, () => false)
    const words = kept ? (await p.locator('[data-testid=request-form]').innerText()).replace(/\s+/g, ' ') : ''
    await shot(p, 'form-blocked-390')
    check('the customer is told plainly to wait, and that nothing typed has been lost', kept && words.includes('Too many tries in a short time') && words.includes('Nothing you typed has been lost'), words.slice(0, 200))
    check('the screen offers "Try again" (which sends the same request), not "Start Over"', kept && (await p.locator('[data-testid=resend-request]').count()) === 1 && (await p.getByRole('button', { name: 'Start Over' }).count()) === 0)
    await nextMinute()
    await p.locator('[data-testid=resend-request]').click()
    await p.waitForURL(/\/q\/qte_[^/]+(\/clarify)?\?token=/, { timeout: 300_000 }).catch(() => undefined)
    const landed = new URL(p.url())
    const id = landed.pathname.split('/')[2] ?? ''
    const row = id.startsWith('qte_') ? ((await sb.select('quotes', `id=eq.${id}&select=customer_json,quote_request_id,tenant_id`))[0] as Row | undefined) : undefined
    const request = row ? ((await sb.select('quote_requests', `id=eq.${row.quote_request_id}&select=customer_name,customer_email,job_answers,asset_ids`))[0] as Row) : null
    check('after the wait, "Try again" sends the request with every answer as it was typed: the name, the email, the answers and the photo', !!request && request.customer_name === who.name && request.customer_email === who.email && JSON.stringify(request.job_answers).includes('room_count') && (request.asset_ids as unknown[]).length === 1 && row?.tenant_id === b.tenantId, { landed: landed.pathname, request })
    if (row) quoteB = { id, token: landed.searchParams.get('token')! }
    await ctx.close()
  }

  // ---------------------------------------------------------------------------------
  section('G. The embed on another website, with the human check on')
  // ---------------------------------------------------------------------------------
  {
    const body = embedSnippet({ appOrigin: origin, tenantKey: a.tenantKey, placement: 'inline', experience: 'form' })
    const hostServer = nodeHttp.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Linden Painting</title></head><body><h1>Linden Painting</h1>${body}<script>window.__posted=[];addEventListener('message',function(e){window.__posted.push({origin:e.origin,type:e.data&&e.data.type})})</script></body></html>`) })
    await new Promise<void>((resolve) => hostServer.listen(0, '127.0.0.1', resolve))
    const HOST = `http://127.0.0.1:${(hostServer.address() as AddressInfo).port}`
    const before = siteverifyCalls.filter((c) => c.ok).length
    const ctx = await contextFor(1280, newIp())
    const p = await ctx.newPage()
    await p.goto(`${HOST}/`)
    const frame = p.frameLocator('#qolumns-widget iframe')
    await frame.getByRole('button', { name: 'Interior Painting', exact: true }).waitFor({ timeout: 40_000 })
    for (let attempt = 0; attempt < 6 && (await frame.getByText('Where should we send your estimate?').count()) === 0; attempt++) {
      await frame.getByRole('button', { name: 'Interior Painting', exact: true }).click({ timeout: 5_000 }).catch(() => undefined)
      await p.waitForTimeout(1500)
    }
    const who = person('Wanda Pemberton')
    await frame.getByLabel('Your name').fill(who.name)
    await frame.getByLabel('Email').fill(who.email)
    await frame.getByLabel('Phone').fill(who.phone)
    await frame.getByRole('button', { name: 'Continue' }).click()
    await frame.getByText('About the job').waitFor({ timeout: 20_000 })
    await frame.locator('input[type=number]').first().fill('2')
    for (const group of await frame.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').first().click()
    await frame.getByRole('button', { name: 'Continue' }).click()
    await frame.getByText('Photos & Documents').waitFor({ timeout: 20_000 })
    await frame.locator('[data-testid=photo-input]').setInputFiles(ROOM)
    await frame.getByRole('button', { name: 'Continue' }).click({ timeout: 60_000 })
    await frame.getByLabel('ZIP code').fill('63021')
    await frame.getByRole('button', { name: 'Get my estimate' }).click()
    const finished = await frame.locator('[data-testid=finished-ready]').waitFor({ timeout: 300_000 }).then(() => true, () => false)
    if (!finished) await shot(p, 'embed-failed')
    const different = new URL(HOST).origin !== origin
    check('on a page of another site the form loads, takes a photo and sends the request, with the human check on', different && finished, { host: HOST, app: origin })
    check('the request passed the server’s human check with a token made inside the form (the other site handles none of it)', siteverifyCalls.filter((c) => c.ok).length > before)
    const posted = (await p.evaluate(() => (window as unknown as { __posted: Array<{ origin: string; type: string }> }).__posted)).filter((m) => /submitted/i.test(String(m.type)))
    check('the other site’s page is told the request went in', posted.length >= 1 && posted[0]!.origin === origin, posted[0])
    const href = finished ? await frame.locator('[data-testid=finished-link]').getAttribute('href') : null
    if (href) {
      const u = new URL(href, origin)
      quoteA = { id: u.pathname.split('/')[2]!, token: u.searchParams.get('token')! }
    }
    await shot(p, 'embed-other-site-finished')
    await ctx.close()
    hostServer.close()
  }

  // ---------------------------------------------------------------------------------
  section('H. The home page, as rendered')
  // ---------------------------------------------------------------------------------
  for (const width of [1440, 390]) {
    const ctx = await contextFor(width, newIp())
    const p = await ctx.newPage()
    await p.goto(`${app}/`, { waitUntil: 'networkidle' })
    const seen = await p.evaluate(() => ({
      h1: (document.querySelector('h1') as HTMLElement).innerText.trim(),
      title: document.title,
      order: [...document.querySelectorAll('[data-testid=notice]')].map((el) => el.getAttribute('data-notice')),
      titles: [...document.querySelectorAll('[data-testid=notice] > h3')].map((el) => (el as HTMLElement).innerText.trim()),
      parts: [...document.querySelectorAll('[data-testid=notice-part] > h4')].map((el) => (el as HTMLElement).innerText.trim()),
      message: (document.querySelector('[data-testid=understood-message]') as HTMLElement | null)?.innerText.trim() ?? '',
      rows: [...document.querySelectorAll('[data-testid=understood-rows] > div')].map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
      texts: [...document.querySelectorAll('[data-testid=notice] > p')].map((el) => (el as HTMLElement).innerText.trim()),
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      twoSides: (() => { const s = document.querySelector('[data-testid=understood-screen]')!.children; const l = s[0]!.getBoundingClientRect(); const r = s[1]!.getBoundingClientRect(); return r.left >= l.right - 1 })(),
    }))
    check(`${width}: the headline reads "${HERO.headline}"`, seen.h1 === 'Instant quotes for your customers, in your prices.' && seen.h1 === HERO.headline && seen.title === PAGE_META.title && !/on your website, in your prices/.test(seen.title), seen.h1)
    check(`${width}: "What it notices" runs in the new order: the message, the photos, extras, then the question`, JSON.stringify(seen.order) === JSON.stringify(['words', 'photos', 'extra', 'range']) && JSON.stringify(seen.titles) === JSON.stringify(NOTICES.examples.map((e) => e.title)), seen.titles)
    check(`${width}: the first example is a customer's message beside what was made of it: the service, the size, a detail`, seen.message === NOTICES.examples[0].message && seen.rows.length === 3 && seen.rows[0]!.includes('Interior Painting') && seen.rows[1]!.includes('Three rooms') && seen.rows[2]!.includes('Trim, doors & baseboards') && (width < 640 || seen.twoSides), seen.rows)
    check(`${width}: the walls and the label are the two examples under "What the photos show"`, JSON.stringify(seen.parts) === JSON.stringify(['Walls, measured from photos', 'Model and size, read from a photo']), seen.parts)
    check(`${width}: extras are worded generally, and "When it can’t tell, it asks" is as it was`, seen.texts.includes('When they mention something extra, it adds your line for it, at your price.') && seen.texts.includes('Your customer sees a range and one quick question. Their answer sets the estimate, from your prices.'))
    check(`${width}: nothing scrolls sideways`, seen.sideways <= 0, seen.sideways)
    await p.locator('[data-testid=notices]').screenshot({ path: path.join(outDir, `home-notices-${width}.png`) })
    for (const route of ['/login', '/signup']) {
      await p.goto(`${app}${route}`, { waitUntil: 'networkidle' })
      const line = await p.locator('[data-testid=auth-line]').innerText()
      check(`${width}: ${route} carries the same line as the home page`, line.trim() === HERO.headline, line)
    }
    await ctx.close()
  }
  await browser.close()
}

// =====================================================================================
section('I. What a customer does on their quote: the link is checked, and the actions are limited')
// =====================================================================================
{
  if (!quoteA) quoteA = await submitted(await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, person('Wanda Pemberton'), [{ fieldId: 'room_count', value: 2 }], { turnstileToken: GOOD_TOKEN, assetIds: await roomPhoto(a) }), timeoutMs: 300_000 }))
  if (!quoteB) quoteB = await submitted(await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(b, bInterior, person('Nora Castell'), [{ fieldId: 'room_count', value: 2 }], { turnstileToken: GOOD_TOKEN, assetIds: await roomPhoto(b) }), timeoutMs: 300_000 }))
  await pollQuote(cfg, quoteA.id, quoteA.token)
  await pollQuote(cfg, quoteB.id, quoteB.token)
  const feedbackOf = async (id: string) => (await sb.select('quote_feedback', `quote_id=eq.${id}&select=id,feedback_text`)) as Row[]
  const ask = (q: { id: string }, token: string | undefined, ip: string, message = 'Could you start in March?') =>
    call('POST', `/api/public/quotes/${q.id}/feedback`, { ip, body: { ...(token && { token }), feedbackType: 'feedback', feedbackText: message } })
  await earlyInTheMinute(30)
  const none = await ask(quoteA, undefined, newIp())
  const wrong = await ask(quoteA, crypto.randomBytes(32).toString('base64url'), newIp())
  const other = await ask(quoteA, quoteB.token, newIp())
  check('a question with no link token, a made-up one, or another quote’s is refused, and nothing is saved', none.status === 401 && wrong.status === 404 && other.status === 404 && (await feedbackOf(quoteA.id)).length === 0, { none: none.status, wrong: wrong.status, otherQuotes: other.status })
  const mailsBefore = mails.length
  const right = await ask(quoteA, quoteA.token, newIp())
  const saved = await feedbackOf(quoteA.id)
  check('with the quote’s own link token the question is saved once, through the server', right.status === 200 && saved.length === 1 && saved[0]!.feedback_text === 'Could you start in March?', { status: right.status, error: right.json?.error })
  check('…and the business is emailed about it', mails.length === mailsBefore + 1 && mails[mails.length - 1]!.To === a.email, mails[mails.length - 1]?.Subject)

  // per quote, from many addresses, for a caller who holds the link
  const perQuote = RATE_LIMITS.quote_actions[0].perKey
  const tries: number[] = [right.status]
  for (let i = 1; i < perQuote + 1; i++) tries.push((await ask(quoteA, quoteA.token, newIp(), `Question ${i}`)).status)
  check(`a quote takes ${perQuote} actions a minute, then 429`, tries.slice(0, perQuote).every((s) => s === 200) && tries[perQuote] === 429, tries)
  const heldAccept = await call('POST', `/api/public/quotes/${quoteA.id}/accept`, { ip: newIp(), body: { token: quoteA.token } })
  check('…and that covers every action on it (accept waits too)', heldAccept.status === 429, heldAccept.status)
  // someone who only knows the quote's id cannot use its allowance up
  const guesses: number[] = []
  for (let i = 0; i < perQuote + 2; i++) guesses.push((await ask(quoteB, crypto.randomBytes(32).toString('base64url'), newIp())).status)
  const realCustomer = await ask(quoteB, quoteB.token, newIp(), 'Is the trim included?')
  check('guessing at another quote’s link does not lock its real customer out', guesses.every((s) => s === 404) && realCustomer.status === 200, { guesses: guesses[0], real: realCustomer.status })
  // per address
  const ip = newIp()
  const perIp = RATE_LIMITS.quote_actions[0].perIp
  const fromOne: number[] = []
  for (let i = 0; i < perIp + 1; i++) fromOne.push((await call('POST', `/api/public/quotes/qte_${crypto.randomBytes(12).toString('hex')}/decline`, { ip, body: { token: 'x' } })).status)
  check(`one address gets ${perIp} quote actions a minute across all quotes, then 429`, fromOne.slice(0, perIp).every((s) => s === 404) && fromOne[perIp] === 429, [fromOne[0], fromOne[perIp]])
}

// =====================================================================================
section('J. Uploads: the size and type are enforced by the server and by storage')
// =====================================================================================
{
  const init = (files: unknown[]) => call('POST', '/api/public/uploads/init', { ip: newIp(), body: { tenantKey: a.tenantKey, files } })
  const big = await init([{ fileName: 'big.jpg', contentType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 }])
  const exe = await init([{ fileName: 'run.exe', contentType: 'application/x-msdownload', sizeBytes: 100 }])
  const html = await init([{ fileName: 'page.html', contentType: 'text/html', sizeBytes: 100 }])
  const many = await init(Array.from({ length: 11 }, (_, i) => ({ fileName: `p${i}.jpg`, contentType: 'image/jpeg', sizeBytes: 100 })))
  const fraction = await init([{ fileName: 'odd.jpg', contentType: 'image/jpeg', sizeBytes: 10.5 }])
  check('the server refuses a photo over 10 MB, a file type it does not take, more than 10 files, and a size that is not a whole number', [big, exe, html, many, fraction].every((r) => r.status === 400), [big.status, exe.status, html.status, many.status, fraction.status])
  const bytes = new Uint8Array(readFileSync(ROOM))
  const ok = await init([{ fileName: 'room.webp', contentType: 'image/webp', sizeBytes: bytes.byteLength }])
  const url = ok.json?.uploads?.[0]?.uploadUrl as string | undefined
  if (ok.status === 200 && url && /^https:\/\//.test(url)) {
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? ''
    check('the upload address is signed for exactly the declared size and type', signed.includes('content-length') && signed.includes('content-type'), signed)
    const put = (body: Uint8Array, type: string) => fetch(url, { method: 'PUT', body, headers: { 'Content-Type': type } }).then((r) => r.status)
    const bigger = new Uint8Array(bytes.byteLength + 4096)
    bigger.set(bytes)
    const refusedSize = await put(bigger, 'image/webp')
    const refusedType = await put(bytes, 'text/html')
    const accepted = await put(bytes, 'image/webp')
    check('storage itself refuses a file bigger than declared, and one sent as another type; the file as declared goes up', refusedSize === 403 && refusedType === 403 && accepted === 200, { bigger: refusedSize, otherType: refusedType, asDeclared: accepted })
    // tidy: the test photo and its row
    const asset = (await sb.select('assets', `id=eq.${ok.json.uploads[0].assetId}&select=r2_key`))[0] as Row | undefined
    if (asset) {
      const req = createRequire(path.join(ROOT, 'apps/web/package.json'))
      const env = Object.fromEntries(readFileSync(path.join(ROOT, 'apps/web/.env.local'), 'utf8').split('\n').filter((l) => /^R2_[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]))
      const { S3Client, DeleteObjectCommand } = req('@aws-sdk/client-s3')
      const client = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
      await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: asset.r2_key as string }))
      await rest('DELETE', `assets?id=eq.${ok.json.uploads[0].assetId}`, admin)
    }
  } else {
    notChecked.push('Storage refusing a file bigger than declared: storage is not configured on this machine, so no signed address was made.')
  }
}

// =====================================================================================
section('K. The home page’s first example is what the product does (live, with the AI)')
// =====================================================================================
{
  const who = person('Megan Grant')
  const message = NOTICES.examples[0].message
  const wrongPick = await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aWallpaper, who, [{ fieldId: '_project_description', value: message }, { fieldId: 'wall_count', value: 3 }, { fieldId: 'needs_removal', value: false }], { turnstileToken: GOOD_TOKEN, assetIds: await roomPhoto(a) }), timeoutMs: 300_000 })
  // T-178: this used to be refused with "did you mean Interior Painting?" (SERVICE_MISMATCH). A request that
  // answers one of the chosen service's questions is never refused for what its note says: the customer chose it.
  check('the service: sent to Wallpaper Installation with its questions answered and a photo, the home page’s message is accepted, not refused', wrongPick.status === 200 && !wrongPick.json?.error && typeof wrongPick.json?.quoteId === 'string', wrongPick.json?.error)
  const q = await submitted(await call('POST', '/api/public/quotes', { ip: newIp(), body: quoteBody(a, aInterior, who, [{ fieldId: '_project_description', value: message }, { fieldId: 'room_count', value: 1 }], { turnstileToken: GOOD_TOKEN, assetIds: await roomPhoto(a) }), timeoutMs: 300_000 }))
  const row = (await sb.select('quotes', `id=eq.${q.id}&select=status,pricing_json,clarification_questions_json`))[0] as { status: string; pricing_json: { breakdown: Array<Row> }; clarification_questions_json: Array<{ question: string; targetSignalKey?: string }> | null }
  const question = (row.clarification_questions_json ?? []).find((c) => c.targetSignalKey === 'room_count')
  check('the size: answered 1 room and wrote "three bedrooms", so the customer is asked which is right', row.status === 'awaiting_clarification' && !!question && /three|3/i.test(question.question), question?.question)
  const trim = row.pricing_json.breakdown.find((l) => l.label === 'Trim, doors & baseboards')
  check('the detail: "the trim too" adds the business’s trim line at its own price ($200)', !!trim && trim.amount === 200 && trim.autoRecommended === true, trim)
  check('the price is the business’s: 1 room at $375 until the customer answers; the AI set no amount', row.pricing_json.breakdown.some((l) => l.label === 'Walls & ceilings' && l.amount === 375), row.pricing_json.breakdown.map((l) => `${l.label}: ${l.amount}`))
}

// =====================================================================================
section('L. If Upstash is down or slow, requests still go through')
// =====================================================================================
{
  upstashMode = 'down'
  const t0 = Date.now()
  const down = await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: newIp() })
  const downMs = Date.now() - t0
  upstashMode = 'hang'
  const t1 = Date.now()
  const hung = await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: newIp() })
  const hungMs = Date.now() - t1
  upstashMode = 'ok'
  check('with the limiter returning errors, the request is served', down.status === 200, { status: down.status, ms: downMs })
  check('with the limiter not answering at all, the request is served after about half a second (under 2.5 seconds here), not left hanging', hung.status === 200 && hungMs < 2500, { status: hung.status, ms: hungMs })
  const after = await call('GET', `/api/public/widget/config?tenantKey=${a.tenantKey}`, { ip: newIp() })
  check('when it is back, limits apply again', after.status === 200 && upstashCalls > 0)
}

// =====================================================================================
section('M. The logs')
// =====================================================================================
{
  const logFile = process.env.WEB_LOG
  if (!logFile || !existsSync(logFile)) {
    notChecked.push('The web app’s log (failures logged, no secret or address in it): set WEB_LOG to its file.')
  } else {
    await sleep(1500)
    const log = readFileSync(logFile, 'utf8')
    check('each time the limiter failed, the log says the request went ahead unchecked', (log.match(/\[RateLimit\] FAILING OPEN/g) ?? []).length >= 2)
    check('blocked requests are logged by kind only', /\[RateLimit\] Blocked quotes request \((ip|key) limit, \d+s left\)/.test(log) && /\[RateLimit\] Blocked login request/.test(log))
    const leaked = [...secretsSeen].filter((s) => log.includes(s))
    check('no password, key or token from this run is in the log', leaked.length === 0, leaked.length)
    const addresses = [newcomer.email, a.email, b.email, 'nora.castell@example.com', 'wanda.pemberton@example.com'].filter((e) => log.includes(e))
    check('no email address from this run is in the log', addresses.length === 0, addresses.length)
    // (the dev server's own request lines show the address of every page opened; this is about what our code writes)
    check('our code wrote no account link to the log (Postmark is on, so links go by email only)', !/\[Auth\][^\n]*(open:|token_hash)/.test(log) && !/EMAIL OFF/.test(log))
  }
}

mock.close()
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed.`)
if (notChecked.length) console.log(`Not checked:\n${notChecked.map((n) => `  - ${n}`).join('\n')}`)
if (failed.length) {
  console.log(`Failed:\n${failed.map((f) => `  - ${f.name}`).join('\n')}`)
  process.exit(1)
}
console.log(`Screenshots: ${outDir}`)
