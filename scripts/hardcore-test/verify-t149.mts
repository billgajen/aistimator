// T-149 live check: quote link + QR code as the main way to go live.
// Run: npx tsx scripts/hardcore-test/verify-t149.mts   (local stack up, migration 32 applied)
//
// API and page level. It writes browser-input.json (a signed-in tenant) to its
// results folder for a Playwright pass over the phone layout, the copy
// buttons, the QR download and the email draft (run outside the repo: it
// needs playwright, pngjs and jsqr, which the repo doesn't depend on).
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { slugify } from '../../apps/web/src/lib/tenant-slug'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t149-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const tenantRow = async (id: string) =>
  (await sb.select('tenants', `id=eq.${id}&select=id,name,slug,slug_changed_at,quote_link_copied_at,quote_link_first_visit_at`))[0]
/** GET a page without following redirects */
async function page(pathname: string) {
  const res = await fetch(`${cfg.appUrl}${pathname}`, { redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' }
}

async function business(name: string) {
  const id = shortId()
  const email = `owner+t149-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name) // fires the signup trigger
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookie = { Cookie: sessionCookieHeader(cfg, session) }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  return { cookie, bearer: session.access_token as string, tenantId: tenantId as string, email, password: `Hardcore-${id}-Aa1!` }
}
type Biz = Awaited<ReturnType<typeof business>>

const svc = garageDoorsPackUS.services[0]!
async function service(biz: Biz) {
  const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
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
  return created.service.id as string
}
async function submit(tenantKey: string, serviceId: string) {
  const res = expectOk('submit', await http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey, serviceId, customer: { name: 'Link Test', email: 'link@example.com' }, job: { postcodeOrZip: '63021', answers: [{ fieldId: '_project_description', value: 'New garage door please, single steel one' }, { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' }, { fieldId: 'door_style', value: 'Steel, non-insulated' }] }, source: { type: 'widget' } },
  }))
  return pollQuote(cfg, res.quoteId, new URL(res.quoteViewUrl).searchParams.get('token')!)
}

// ---------- 1. slugs at signup, clashes, backfill ----------
const name = `Sunbelt Painting ${shortId()}`
const a = await business(name)
const aRow = await tenantRow(a.tenantId)
check('a new signup gets a slug from its business name', aRow.slug === slugify(name), { name, slug: aRow.slug })
const twin = await business(name)
const twinRow = await tenantRow(twin.tenantId)
check('a second business with the same name gets a suffix', twinRow.slug !== aRow.slug && twinRow.slug.startsWith(`${aRow.slug}-`) && /^[a-z0-9-]+$/.test(twinRow.slug), twinRow.slug)
const reservedBiz = await business('Admin')
check('a reserved name gets a suffix', (await tenantRow(reservedBiz.tenantId)).slug.startsWith('admin-'))
const missing = await http('GET', `${cfg.supabaseUrl}/rest/v1/tenants?slug=is.null&select=id`, { headers: admin })
check('every existing tenant has a slug (backfilled)', missing.ok && missing.json.length === 0, missing.json?.length)

// The Share page creates the widget key on first visit (as the Widget page did)
const sharePage = await fetch(`${cfg.appUrl}/app/share`, { headers: a.cookie, redirect: 'manual' })
const shareHtml = await sharePage.text()
check('the Share page loads, with the link and without "Your Tenant Key"', sharePage.status === 200 && shareHtml.includes(`/quote/${aRow.slug}`) && !shareHtml.includes('Your Tenant Key'), sharePage.status)
const oldWidgetPage = await fetch(`${cfg.appUrl}/app/widget`, { headers: a.cookie, redirect: 'manual' })
check('the old /app/widget address sends you to /app/share', [307, 308].includes(oldWidgetPage.status) && (oldWidgetPage.headers.get('location') ?? '').endsWith('/app/share'), oldWidgetPage.status)
const site = (await sb.select('tenant_sites', `tenant_id=eq.${a.tenantId}&select=tenant_key,is_active`))[0]
const serviceId = await service(a)

// ---------- 2. the hosted page ----------
check('checklist starts unticked (no copy, no visit)', !aRow.quote_link_copied_at && !aRow.quote_link_first_visit_at)
const hosted = await page(`/quote/${aRow.slug}`)
check('/quote/{slug} loads', hosted.status === 200, hosted.status)
check('…with the business name in the title', hosted.html.includes(`<title>${aRow.name}: request an estimate</title>`))
check('…rendering this tenant’s own widget', hosted.html.includes(site.tenant_key))
check('the first visit is recorded', Boolean((await tenantRow(a.tenantId)).quote_link_first_visit_at))
const viaLink = await submit(site.tenant_key, serviceId)
check('a request from the quote page produces a quote, as the embed does', ['sent', 'viewed'].includes(viaLink.status) && viaLink.pricing?.total === 1400, { status: viaLink.status, total: viaLink.pricing?.total })

// Isolation: the twin business's page shows only the twin's widget
await fetch(`${cfg.appUrl}/app/share`, { headers: twin.cookie })
const twinSite = (await sb.select('tenant_sites', `tenant_id=eq.${twin.tenantId}&select=tenant_key`))[0]
const twinPage = await page(`/quote/${twinRow.slug}`)
check('another business’s slug shows only its own widget', twinPage.status === 200 && twinPage.html.includes(twinSite.tenant_key) && !twinPage.html.includes(site.tenant_key))

check('an unknown slug is a plain 404', (await page(`/quote/no-such-business-${shortId()}`)).status === 404)
check('a malformed slug is a 404', (await page('/quote/a')).status === 404)
await http('PATCH', `${cfg.supabaseUrl}/rest/v1/tenant_sites?tenant_id=eq.${twin.tenantId}`, { headers: admin, body: { is_active: false } })
check('an inactive business is a 404', (await page(`/quote/${twinRow.slug}`)).status === 404)

// ---------- 3. old embed links keep working ----------
const embed = await page(`/embed/${site.tenant_key}`)
check('the old /embed/{tenantKey} link still loads', embed.status === 200)
const config = await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${site.tenant_key}`)
check('the widget config API still answers for that key', config.ok && config.json.tenantName === aRow.name)
const loader = await fetch(`${cfg.appUrl}/widget.js`)
check('the widget.js loader is still served', loader.status === 200 && (await loader.text()).includes('/embed/'))

// ---------- 4. changing the slug ----------
const before = expectOk('slug GET', await http('GET', `${cfg.appUrl}/api/tenant/slug`, { headers: a.cookie }))
check('the slug can be changed (not yet changed)', before.slug === aRow.slug && before.changeable === true)
const reservedCheck = expectOk('check', await http('GET', `${cfg.appUrl}/api/tenant/slug?check=admin`, { headers: a.cookie }))
check('live check: a reserved word is not available', reservedCheck.check?.available === false && reservedCheck.check?.reason === 'reserved')
const takenCheck = expectOk('check', await http('GET', `${cfg.appUrl}/api/tenant/slug?check=${twinRow.slug}`, { headers: a.cookie }))
check('live check: another business’s slug is not available', takenCheck.check?.available === false && takenCheck.check?.reason === 'taken')
const newSlug = `sunbelt-${shortId()}`
const freeCheck = expectOk('check', await http('GET', `${cfg.appUrl}/api/tenant/slug?check=${newSlug}`, { headers: a.cookie }))
check('live check: a free slug is available', freeCheck.check?.available === true)
check('changing to a reserved word is refused (400)', (await http('PUT', `${cfg.appUrl}/api/tenant/slug`, { headers: a.cookie, body: { slug: 'quote' } })).status === 400)
check('changing to another business’s slug is refused (409)', (await http('PUT', `${cfg.appUrl}/api/tenant/slug`, { headers: a.cookie, body: { slug: twinRow.slug } })).status === 409)
const changed = await http('PUT', `${cfg.appUrl}/api/tenant/slug`, { headers: a.cookie, body: { slug: newSlug } })
check('the slug changes', changed.ok && changed.json.slug === newSlug && changed.json.changeable === false, changed.json)
const redirect = await page(`/quote/${aRow.slug}`)
check('the old slug redirects to the new one', redirect.status === 308 && (redirect.location ?? '').endsWith(`/quote/${newSlug}`), { status: redirect.status, location: redirect.location })
check('the new slug loads the same widget', (await page(`/quote/${newSlug}`)).html.includes(site.tenant_key))
check('a second change is refused (once only)', (await http('PUT', `${cfg.appUrl}/api/tenant/slug`, { headers: a.cookie, body: { slug: `again-${shortId()}` } })).status === 409)
const formerCheck = expectOk('check', await http('GET', `${cfg.appUrl}/api/tenant/slug?check=${aRow.slug}`, { headers: twin.cookie }))
check('nobody else can take the old slug', formerCheck.check?.available === false)
const direct = await http('PATCH', `${cfg.supabaseUrl}/rest/v1/tenants?id=eq.${twin.tenantId}`, {
  headers: { apikey: cfg.anonKey, Authorization: `Bearer ${twin.bearer}`, Prefer: 'return=representation' },
  body: { slug: `sneaky-${shortId()}` },
})
check('the slug can’t be changed by writing to the tenant row directly', !direct.ok && (await tenantRow(twin.tenantId)).slug === twinRow.slug, direct.status)

// ---------- 5. the checklist ----------
const copied = await http('POST', `${cfg.appUrl}/api/tenant/share-event`, { headers: twin.cookie, body: { event: 'copied' } })
check('copying the link records it', copied.ok && Boolean((await tenantRow(twin.tenantId)).quote_link_copied_at))
const home = await fetch(`${cfg.appUrl}/app`, { headers: twin.cookie })
const homeHtml = await home.text()
check('the home checklist says "Share your quote link" (not "Embed on website")', homeHtml.includes('Share your quote link') && !homeHtml.includes('Embed on website'))
check('a bad share event is refused', (await http('POST', `${cfg.appUrl}/api/tenant/share-event`, { headers: twin.cookie, body: { event: 'nope' } })).status === 400)
check('share events need a login', (await http('POST', `${cfg.appUrl}/api/tenant/share-event`, { body: { event: 'copied' } })).status === 401)

// Hand the browser check a tenant to drive
writeFileSync(path.join(outDir, 'browser-input.json'), JSON.stringify({ appUrl: cfg.appUrl, email: a.email, password: a.password, slug: newSlug, name: aRow.name, tenantKey: site.tenant_key, cookie: a.cookie.Cookie }))
console.log(`\nbrowser input: ${path.join(outDir, 'browser-input.json')}`)

saveJson(outDir, 't149.json', checks)
const passed = checks.filter((c) => c.pass).length
console.log(`\n${passed}/${checks.length} pass`)
if (passed !== checks.length) process.exitCode = 1
