// T-136 live verification — the SMS channel end to end in TEST MODE.
// Start the web app with: SMS_TEST_MODE=true TWILIO_AUTH_TOKEN=test_auth_token_local
// Run: node scripts/hardcore-test/verify-t136.mjs
//
// Proves: unsigned/invalid webhooks are rejected; a customer can text, send
// MMS photos and receive a priced quote link by SMS; STOP blocks every
// further send for that tenant; START re-enables.
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import {
  ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, pollQuote, shortId, saveJson, runStamp,
} from './lib.mjs'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test_auth_token_local'
const WEBHOOK = `${cfg.appUrl}/api/sms/webhook`
const runId = shortId()
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t136-${runId}`)
mkdirSync(outDir, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const sign = (params) =>
  crypto.createHmac('sha1', AUTH_TOKEN)
    .update(Object.keys(params).sort().reduce((a, k) => a + k + params[k], WEBHOOK))
    .digest('base64')

async function inbound(params, { signature } = {}) {
  const body = new URLSearchParams(params).toString()
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(signature === null ? {} : { 'X-Twilio-Signature': signature ?? sign(params) }),
    },
    body,
  })
  return res.status
}

// A tiny local server stands in for Twilio's MMS media host (test mode only)
const photo = readFileSync(path.join(ROOT, 'test-assets/hardcore/S01-painting/images.jpeg'))
const mediaServer = http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' })
  res.end(photo)
})
await new Promise((r) => mediaServer.listen(0, r))
const mediaUrl = `http://127.0.0.1:${mediaServer.address().port}/photo.jpg`

// Tenant + service + SMS number
const business = 'T136 Lone Star Plumbing'
const email = `owner+t136-${runId}@hardcore.test`
const password = `Hardcore-${runId}-Aa1!`
const user = await sb.createUser(email, password, business)
const session = await sb.signIn(email, password)
const authed = { Cookie: sessionCookieHeader(cfg, session) }
const setupRes = await call('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: authed, body: { businessName: business } })
const tenantId = setupRes.ok ? setupRes.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
const step = { id: 'flush', name: 'Water heater flush and inspection', description: 'Drain, flush, inspect anode', costType: 'fixed', defaultCost: 150, optional: false }
expectOk('create service', await call('POST', `${cfg.appUrl}/api/services`, {
  headers: authed,
  body: {
    name: 'Water Heater Flush',
    documentTypeDefault: 'instant_estimate',
    scopeIncludes: ['Drain and flush the tank'], scopeExcludes: [], defaultAssumptions: [],
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: null, requiredAngles: [] },
    workSteps: [step], expectedSignals: [],
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: [], multipliers: [], workSteps: [step] },
  },
}))
const BUSINESS_NUMBER = `+1512555${String(Math.floor(Math.random() * 9000) + 1000)}`
const CUSTOMER = `+1737555${String(Math.floor(Math.random() * 9000) + 1000)}`
expectOk('sms config', await call('PUT', `${cfg.appUrl}/api/sms/config`, {
  headers: authed, body: { phoneNumber: BUSINESS_NUMBER, isActive: true },
}))

const base = { To: BUSINESS_NUMBER, From: CUSTOMER, NumMedia: '0' }
let n = 0
const text = (Body) => inbound({ ...base, Body, MessageSid: `SMtest${runId}${n++}` })
const outbound = async () => sb.select('sms_messages', `tenant_id=eq.${tenantId}&direction=eq.outbound&order=created_at.desc&limit=1&select=content,status,segments`)
const lastReply = async () => (await outbound())[0]

// 1. Signature enforcement
check('unsigned webhook rejected (401)', (await inbound({ ...base, Body: 'hi' }, { signature: null })) === 401)
check('invalid signature rejected (401)', (await inbound({ ...base, Body: 'hi' }, { signature: 'bogus=' })) === 401)

// 2. Conversation
check('signed text accepted (200)', (await text('Hi, how much to flush my water heater?')) === 200)
let r = await lastReply()
check('first reply asks for the job description', /describe the job/i.test(r?.content || ''), (r?.content || '').slice(0, 80))
check('first reply carries the consent notice', /Reply STOP to opt out/.test(r?.content || ''))
check('SMS replies have no WhatsApp asterisks', !/\*Water Heater Flush\*/.test(r?.content || ''))
check('outbound logged in test mode with segments', r?.status === 'test' && r?.segments > 0, `status=${r?.status} segments=${r?.segments}`)
await text('50 gallon gas tank in the garage, about 8 years old, never flushed')
await text('Jamie Rivera')
await text('jamie.t136@example.com')
r = await lastReply()
check('phone step offers the mobile number (not WhatsApp)', /mobile number/.test(r?.content || ''), r?.content)
check('consent notice sent only once', !/Reply STOP to opt out/.test(r?.content || ''))
await text('skip')
await text('1200 Barton Springs Rd, Austin TX 78704')
// MMS: photo + caption in one message
await inbound({ ...base, NumMedia: '1', MediaUrl0: mediaUrl, MediaContentType0: 'image/jpeg', Body: '', MessageSid: `MMtest${runId}` })
r = await lastReply()
check('MMS photo received', /Photo 1 received/.test(r?.content || ''), r?.content)
await text('done')
r = await lastReply()
check('confirmation summary', /Does this look correct/.test(r?.content || ''))
await text('yes')
r = await lastReply()
const link = (r?.content || '').match(/https?:\/\/\S+\/q\/(\S+)\?token=(\S+)/)
check('quote link texted back', Boolean(link), (r?.content || '').slice(0, 120))
if (link) {
  const quote = await pollQuote(cfg, link[1], link[2])
  saveJson(outDir, 'quote.json', quote)
  // The test photo is a house front, not a water heater, so the quality gate may
  // legitimately hold the quote for review — either way the engine priced it.
  const internal = (await sb.select('quotes', `id=eq.${link[1]}&select=status,pricing_json`))[0]
  check(
    'quote priced from the SMS intake ($150, sent or held for review)',
    ['sent', 'pending_review'].includes(internal?.status) && internal?.pricing_json?.total === 150,
    `status=${internal?.status} total=${internal?.pricing_json?.total}`
  )
  // Simulate the business approving a held quote so it can be texted
  if (internal?.status !== 'sent') {
    await fetch(`${cfg.supabaseUrl}/rest/v1/quotes?id=eq.${link[1]}`, {
      method: 'PATCH',
      headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    })
  }
  const assets = await sb.select('assets', `tenant_id=eq.${tenantId}&select=r2_key`)
  check('MMS photo stored for the quote', assets.some((a) => a.r2_key.startsWith('sms/')), assets.map((a) => a.r2_key).join(','))

  // 3. STOP / START
  await text('STOP')
  r = await lastReply()
  check('STOP confirmed once', /unsubscribed/i.test(r?.content || ''))
  const blocked = await call('POST', `${cfg.appUrl}/api/sms/send-quote`, { headers: authed, body: { quoteId: link[1], phone: CUSTOMER } })
  check('dashboard send blocked after STOP (409)', blocked.status === 409 && blocked.json?.error?.code === 'OPTED_OUT', `HTTP ${blocked.status}`)
  const countOut = async () => (await sb.select('sms_messages', `tenant_id=eq.${tenantId}&direction=eq.outbound&select=id`)).length
  const before = await countOut()
  await text('hello again?')
  check('no reply to an opted-out number', (await countOut()) === before, `${before} → ${await countOut()}`)
  await text('START')
  const ok = await call('POST', `${cfg.appUrl}/api/sms/send-quote`, { headers: authed, body: { quoteId: link[1], phone: CUSTOMER } })
  check('START re-enables sends', ok.status === 200 && ok.json?.sent === true, `HTTP ${ok.status}`)
}

mediaServer.close()
saveJson(outDir, 'checks.json', results)
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed — artifacts in ${outDir}`)
process.exit(failed.length ? 1 : 0)
