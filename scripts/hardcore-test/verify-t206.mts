// T-206 check, against the real servers (local stack). No model is asked (the worker runs with its
// AI stand-in), no email is sent, and nothing here touches production.
//
// What it proves
//   Item 3  the app never hears "Set up your website widget first": a business with no site row
//           gets one the first time the app starts (GET /api/app/bootstrap), signed in as the app
//           signs in (a bearer) and as the dashboard does (a cookie); the key it is given reads
//           the business's form, and a quote can be started in the app with it
//   Item 2  scripts/create-review-account.mts makes the review business's site row, and a second
//           run repairs an account that has none or whose row is off, without touching its
//           password. Run here on the LOCAL database only (the script refuses anything else
//           without --prod, and this check never passes --prod).
//
// Not here: the room scanner in the store build (item 1: unit tests, the build hook and the Xcode
// step, and a Release build from a clean copy; see the CHANGELOG) and "On this iPad" (unit tests).
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t206.mts
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off. The harness is T-201's.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { h, finish, type Row } from './t201/harness.mts'
import { APP_DOMAIN } from '../../packages/shared/src/brand'
import { REVIEW_ACCOUNT } from '../../packages/shared/src/review-account'

const { app, cfg, sb, http, check, section, rows, shortId } = h
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OLD_WORDS = /widget first|NO_SITE/i
const sitesOf = (tenantId: string) => rows('tenant_sites', `tenant_id=eq.${tenantId}&select=id,tenant_key,is_active,domain&order=created_at.asc`)
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
type Boot = { tenantName?: string; tenantKey?: string; error?: { code?: string; message?: string } }

// ---------------------------------------------------------------------------
section('1. The app starts for a business with no site row (item 3)')
const biz = await h.business('nosite')
const serviceId = await h.paintService(biz)
check('a business fresh from sign-up, with a service, has no site row yet', (await sitesOf(biz.tenantId)).length === 0)

const session = (await sb.signIn(biz.email, biz.password)) as { access_token: string }
const first = await http('GET', `${app}/api/app/bootstrap`, { headers: bearer(session.access_token) })
const boot = (first.json ?? {}) as Boot
check('the app’s first call is answered (200), not refused', first.status === 200 && boot.tenantName === biz.name, { status: first.status, body: first.json })
check('…with a form key', /^tkey_[0-9a-f]{24}$/.test(boot.tenantKey ?? ''), boot.tenantKey)
check('…and nothing about setting up a website widget', !OLD_WORDS.test(first.text ?? JSON.stringify(first.json)))
const made = await sitesOf(biz.tenantId)
check('the site row was made on that call: one row, on, holding that key', made.length === 1 && made[0]?.is_active === true && made[0]?.tenant_key === boot.tenantKey, made)

const again = await http('GET', `${app}/api/app/bootstrap`, { headers: bearer(session.access_token) })
const viaCookie = await http('GET', `${app}/api/app/bootstrap`, { headers: biz.cookie })
check(
  'asked again (as the app, and as the dashboard signs in) the same key comes back and no second row is made',
  (again.json as Boot | null)?.tenantKey === boot.tenantKey && (viaCookie.json as Boot | null)?.tenantKey === boot.tenantKey && (await sitesOf(biz.tenantId)).length === 1
)

const form = await http('GET', `${app}/api/public/widget/config?tenantKey=${boot.tenantKey}`)
const services = ((form.json as { services?: Array<{ id: string }> } | null)?.services ?? []).map((s) => s.id)
check('the key reads the business’s form: New quote has its service to pick', form.status === 200 && services.includes(serviceId), { status: form.status, services })

const quote = await http('POST', `${app}/api/app/quotes`, {
  headers: bearer(session.access_token),
  body: {
    serviceId,
    customer: { name: 'Marta Callahan' },
    job: { answers: [{ fieldId: '_project_description', value: 'The side wall and its trim' }, { fieldId: 'wall_area', value: 40 }, { fieldId: 'trim_length', value: 20 }] },
    assetIds: [],
  },
  timeoutMs: 150_000,
})
const quoteId = (quote.json as { quoteId?: string } | null)?.quoteId
check('…and a quote is started in the app for that business', quote.ok && Boolean(quoteId), { status: quote.status, body: quote.json })
if (quoteId) {
  const priced = await h.waitForQuote(quoteId, (row: Row) => ((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0)
  check('…and priced from the service’s own prices (40 × 18 + 20 × 7.35 = 867)', (priced.pricing_json as { total?: number } | null)?.total === 867, priced.pricing_json)
}

// A business the dashboard already made a row for keeps its own key
const old = await h.business('hassite')
const oldKey = await h.siteKey(old)
const oldSession = (await sb.signIn(old.email, old.password)) as { access_token: string }
const oldBoot = await http('GET', `${app}/api/app/bootstrap`, { headers: bearer(oldSession.access_token) })
check('a business that has a site row keeps its key: nothing is made', (oldBoot.json as Boot | null)?.tenantKey === oldKey && (await sitesOf(old.tenantId)).length === 1)
check('signed out, the route still refuses (401): no row is made for nobody', (await http('GET', `${app}/api/app/bootstrap`)).status === 401)

// ---------------------------------------------------------------------------
section('2. The review account script makes the site row, and repairs it (item 2)')
// A sign-in name of its own, so the real review account's name is never used here
const name = `t206-${shortId()}`.toLowerCase()
const email = `${name}@${APP_DOMAIN}`
/** Runs the script on the local database (it has no --prod here). What it prints is read, never printed on. */
const run = (...extra: string[]) => {
  const done = spawnSync('npx', ['tsx', 'scripts/create-review-account.mts', `--email-name=${name}`, '--one-service', ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 })
  return { status: done.status, out: `${done.stdout}\n${done.stderr}` }
}
const said = (out: string, pattern: RegExp) => pattern.test(out)

const created = run()
// the line the script prints once: "    password  <it>"
const PASSWORD_LINE = /^\s+password\s+(\S+)\s*$/m
const password = PASSWORD_LINE.exec(created.out)?.[1] ?? ''
check('the script runs on the local database and makes the account', created.status === 0 && said(created.out, /on local \(/) && password.length > 0, { status: created.status, tail: created.out.replace(password || 'x', '…').slice(-300) })
check('it says it made the site row', said(created.out, /site row made/))
const profile = (await rows('user_profiles', `select=tenant_id,id&id=in.(${(await userIdOf(email)) ?? 'none'})`))[0]
const reviewTenant = String(profile?.tenant_id ?? '')
const reviewSites = await sitesOf(reviewTenant)
check('the review business has one site row, on', reviewSites.length === 1 && reviewSites[0]?.is_active === true && /^tkey_[0-9a-f]{24}$/.test(String(reviewSites[0]?.tenant_key)), reviewSites)

const reviewer = (await sb.signIn(email, password)) as { access_token: string }
const reviewBoot = await http('GET', `${app}/api/app/bootstrap`, { headers: bearer(reviewer.access_token) })
const reviewForm = await http('GET', `${app}/api/public/widget/config?tenantKey=${(reviewBoot.json as Boot | null)?.tenantKey}`)
check(
  'the reviewer signs into the app: its business, that row’s key, and a service to start a quote with',
  reviewBoot.status === 200 &&
    (reviewBoot.json as Boot).tenantName === REVIEW_ACCOUNT.businessName &&
    (reviewBoot.json as Boot).tenantKey === reviewSites[0]?.tenant_key &&
    ((reviewForm.json as { services?: unknown[] } | null)?.services ?? []).length === 1,
  { boot: reviewBoot.status, form: reviewForm.status }
)

// An account made by the script as it was before T-206: no site row at all
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
await http('DELETE', `${cfg.supabaseUrl}/rest/v1/tenant_sites?tenant_id=eq.${reviewTenant}`, { headers: admin })
check('(the row is taken away, as an account made before T-206 has none)', (await sitesOf(reviewTenant)).length === 0)
const repaired = run()
const afterRepair = await sitesOf(reviewTenant)
check('run again, the script makes the missing row and says so', repaired.status === 0 && said(repaired.out, /exists already/) && said(repaired.out, /site row: made/) && afterRepair.length === 1 && afterRepair[0]?.is_active === true, { status: repaired.status, sites: afterRepair })
check('…and prints no password: the account’s password is left as it was', !PASSWORD_LINE.test(repaired.out) && Boolean(((await sb.signIn(email, password)) as { access_token?: string }).access_token))

// A row that is there but off
await h.patch('tenant_sites', `tenant_id=eq.${reviewTenant}`, { is_active: false })
const turnedOn = run()
const afterOn = await sitesOf(reviewTenant)
check('a row that is off is turned back on, not doubled', turnedOn.status === 0 && said(turnedOn.out, /site row: turned back on/) && afterOn.length === 1 && afterOn[0]?.is_active === true && afterOn[0]?.tenant_key === afterRepair[0]?.tenant_key, afterOn)

// Nothing to repair
const quiet = run()
check('with the row in place a run changes nothing', quiet.status === 0 && said(quiet.out, /site row: already there/) && JSON.stringify(await sitesOf(reviewTenant)) === JSON.stringify(afterOn))
check('no run printed the service key', ![created, repaired, turnedOn, quiet].some((r) => r.out.includes(cfg.serviceKey)))

async function userIdOf(address: string): Promise<string | null> {
  const res = await http('GET', `${cfg.supabaseUrl}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` } })
  const users = (res.json as { users?: Array<{ id: string; email?: string }> } | null)?.users ?? []
  return users.find((u) => u.email?.toLowerCase() === address)?.id ?? null
}

process.exit(finish())
