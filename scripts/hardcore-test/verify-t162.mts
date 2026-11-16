// T-162 live check: the product is called Qolumns.
// Run (local stack up: supabase with migration 40, web, worker):
//   npx tsx scripts/hardcore-test/verify-t162.mts
// With the pages and the embed code in a real browser as well:
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t162.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. the name people read: page titles, the social image, the pages' own
//    HTML, the worker's answer, the email sender name, four rendered emails;
// 2. the embed code: the two loaders as served, and the snippet a business
//    copies;
// 3. the reserved quote-link names, and the link a business called "Qolumns"
//    gets;
// 4. (browser) home, login, the dashboard, the Quote link page, the public
//    request page, a customer quote page and the emails as a person sees
//    them; then the widget from the new snippet on another site's page:
//    inline, floating, iframe mode and the older iframe loader, with one real
//    request sent through it.
//
// "Qolumns" is what people read. Identifiers (ids, message types, the scope)
// are lower case. The earlier names must not show anywhere.
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp, OLD_PRODUCT_NAMES } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { PRODUCT_NAME, EMBED_NAMES } from '../../packages/shared/src/brand'
import { emailFromHeader } from '../../packages/shared/src/email-from'
import { customerQuoteEmail, reviewRequestEmail } from '../../apps/worker/src/email/templates'
import { generateQuoteAcceptedEmailHtml, generateRevisedQuoteEmailHtml } from '../../apps/web/src/lib/email-templates'
import { embedSnippet } from '../../apps/web/src/lib/embed-snippet'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t162-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const stalls: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)

const NAME = 'Qolumns'
const [SECOND_NAME, FIRST_NAME] = OLD_PRODUCT_NAMES as [string, string]
const origin = new URL(cfg.appUrl).origin
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The earlier names found in something a person reads (any letter case) */
const oldNamesInText = (text: string): string[] => [
  ...(new RegExp(SECOND_NAME, 'i').test(text) ? [SECOND_NAME] : []),
  ...(new RegExp(`\\b${FIRST_NAME}\\b`, 'i').test(text) ? [FIRST_NAME] : []),
]
/**
 * The earlier names found in a page's source. The folder this repo sits in
 * can carry the first name (dev pages print file paths), so that path is
 * taken out first; "estimate" and names like EstimateWidget are not the brand.
 */
const oldNamesInSource = (source: string): string[] => {
  const cleaned = source.replace(new RegExp(escapeRe(ROOT), 'g'), '')
  return [
    ...(new RegExp(SECOND_NAME, 'i').test(cleaned) ? [SECOND_NAME] : []),
    ...(new RegExp(`\\b${FIRST_NAME}\\b`).test(cleaned) ? [FIRST_NAME] : []),
    ...(new RegExp(`@${FIRST_NAME.toLowerCase()}/|${FIRST_NAME.toLowerCase()}-(widget|resize|submitted|floating)|${FIRST_NAME}(Widget|Iframe)`).test(cleaned) ? ['an old identifier'] : []),
  ]
}
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? ''
const visible = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const get = async (pathname: string) => {
  const res = await fetch(`${cfg.appUrl}${pathname}`, { redirect: 'manual' })
  return { status: res.status, html: await res.text() }
}

// ====================================================================
section('1. The name people read')
// ====================================================================
check('PRODUCT_NAME is "Qolumns"', PRODUCT_NAME === NAME, PRODUCT_NAME)

const TITLED: Array<[string, RegExp]> = [
  ['/', /— Qolumns$/],
  ['/pricing', /^Pricing — Qolumns$/],
  ['/privacy', /^Privacy Policy — Qolumns$/],
  ['/terms', /^Terms of Service — Qolumns$/],
  ['/trades', /\| Qolumns$/],
  ['/painting', /\| Qolumns$/],
  ['/trades/garage-doors', /\| Qolumns$/],
]
for (const [pathname, pattern] of TITLED) {
  const page = await get(pathname)
  check(`${pathname}: the title ends with the name`, page.status === 200 && pattern.test(titleOf(page.html)), titleOf(page.html))
}
const PUBLIC_PAGES = ['/', '/features', '/pricing', '/trades', '/trades/garage-doors', '/trades/hvac', '/painting', '/privacy', '/terms', '/login', '/signup', '/demo']
for (const pathname of PUBLIC_PAGES) {
  const page = await get(pathname)
  const text = visible(page.html)
  check(`${pathname}: shows "Qolumns" and neither earlier name, in the text or the page source`,
    page.status === 200 && text.includes(NAME) && oldNamesInText(text).length === 0 && oldNamesInSource(page.html).length === 0,
    { status: page.status, text: oldNamesInText(text), source: oldNamesInSource(page.html) })
}
const privacy = visible((await get('/privacy')).html)
const terms = visible((await get('/terms')).html)
check('privacy: "businesses with a Qolumns account" (the article changed with the name)', privacy.includes('businesses with a Qolumns account'))
check('terms: "Qolumns provides software…" and "your use of Qolumns"', terms.includes('Qolumns provides software that lets your business') && (await get('/terms')).html.includes('The terms that govern your use of Qolumns.'))
const home = await get('/')
check('home: the footer says "© <year> Qolumns."', new RegExp(`© ${new Date().getFullYear()} Qolumns\\.`).test(visible(home.html)))
check('home: the social image text names Qolumns', /property="og:image:alt" content="Qolumns: /.test(home.html), /property="og:image:alt" content="([^"]*)"/.exec(home.html)?.[1])
const og = await fetch(`${cfg.appUrl}/opengraph-image`)
const ogBytes = og.ok ? Buffer.from(await og.arrayBuffer()) : Buffer.alloc(0)
writeFileSync(path.join(outDir, 'opengraph-image.png'), ogBytes)
check('the social image is drawn again from code (PNG, saved to the results folder)', og.ok && og.headers.get('content-type') === 'image/png' && ogBytes.length > 5000, ogBytes.length)

const workerUrl = process.env.WORKER_URL || 'http://localhost:8787'
const workerRoot = await fetch(`${workerUrl}/`).then(async (r) => ({ status: r.status, text: await r.text() })).catch((e: unknown) => ({ status: 0, text: String(e) }))
check('the worker answers "Qolumns worker"', workerRoot.status === 200 && workerRoot.text === 'Qolumns worker', workerRoot)

const ADDRESS = 'quotes@mail.example.com'
check('customer email sender: "Kent Painters via Qolumns"', emailFromHeader({ kind: 'customer', businessName: 'Kent Painters' }, ADDRESS) === `"Kent Painters via Qolumns" <${ADDRESS}>`, emailFromHeader({ kind: 'customer', businessName: 'Kent Painters' }, ADDRESS))
check('business email sender: "Qolumns"', emailFromHeader({ kind: 'business' }, ADDRESS) === `"Qolumns" <${ADDRESS}>`, emailFromHeader({ kind: 'business' }, ADDRESS))

const EMAILS: Record<string, string> = {
  'customer-estimate (worker)': customerQuoteEmail({
    customerName: 'Marlo Finch', businessName: 'Kent Painters', serviceName: 'Interior Painting',
    quoteViewUrl: `${cfg.appUrl}/q/qte_example?token=example`, total: '$825.00', currency: 'USD', awaitingConfirmation: true,
  }),
  'business-review-and-approve (worker)': reviewRequestEmail({
    businessName: 'Kent Painters', customerName: 'Marlo Finch', customerEmail: 'marlo.finch@example.com', serviceName: 'Interior Painting',
    quoteId: 'qte_example', total: '$825.00', approveUrl: `${cfg.appUrl}/approve/example`, dashboardUrl: `${cfg.appUrl}/app/quotes/qte_example`,
    holdLine: 'The customer can already see this as an estimate.',
  }),
  'customer-updated-quote (web)': generateRevisedQuoteEmailHtml({
    customerName: 'Marlo Finch', businessName: 'Kent Painters', serviceName: 'Interior Painting',
    quoteViewUrl: `${cfg.appUrl}/q/qte_example?token=example`, total: '$825.00',
  }),
  'business-quote-accepted (web)': generateQuoteAcceptedEmailHtml({
    businessName: 'Kent Painters', customerName: 'Marlo Finch', serviceName: 'Interior Painting',
    totalFormatted: '$825.00', dashboardUrl: `${cfg.appUrl}/app/quotes/qte_example`,
  }),
}
for (const [name, html] of Object.entries(EMAILS)) {
  writeFileSync(path.join(outDir, `email-${name.replace(/[^a-z]+/g, '-').replace(/-$/, '')}.html`), html)
  const text = visible(html)
  check(`email, ${name}: says "Powered by Qolumns" and neither earlier name`, text.includes('Powered by Qolumns') && oldNamesInText(text).length === 0 && oldNamesInSource(html).length === 0, { text: oldNamesInText(text), source: oldNamesInSource(html) })
}

// ====================================================================
section('2. The embed code')
// ====================================================================
const widgetJs = await (await fetch(`${cfg.appUrl}/widget.js`)).text()
const iframeJs = await (await fetch(`${cfg.appUrl}/iframe-loader.js`)).text()
check('widget.js is still served at /widget.js, with the new names',
  [`'#${EMBED_NAMES.containerId}'`, `window.${EMBED_NAMES.widgetGlobal} = {`, `'${EMBED_NAMES.resizeMessage}'`, `'${EMBED_NAMES.submittedMessage}'`, `'${EMBED_NAMES.submittedEvent}'`, `'${EMBED_NAMES.launcherId}'`, `'${EMBED_NAMES.overlayId}'`, `'${EMBED_NAMES.consolePrefix} `].every((s) => widgetJs.includes(s)))
check('iframe-loader.js is still served at /iframe-loader.js, with the new names',
  [`'#${EMBED_NAMES.containerId}'`, `window.${EMBED_NAMES.iframeGlobal} = {`, `'${EMBED_NAMES.resizeMessage}'`, `'${EMBED_NAMES.submittedMessage}'`, `'${EMBED_NAMES.submittedEvent}'`, `'${EMBED_NAMES.consolePrefix} `].every((s) => iframeJs.includes(s)))
check('neither loader carries an earlier name or identifier', oldNamesInSource(widgetJs).length === 0 && oldNamesInSource(iframeJs).length === 0, [oldNamesInSource(widgetJs), oldNamesInSource(iframeJs)])
const inlineSnippet = embedSnippet({ appOrigin: origin, tenantKey: 'tkey_example', placement: 'inline', experience: 'form' })
const floatingSnippet = embedSnippet({ appOrigin: origin, tenantKey: 'tkey_example', placement: 'floating', experience: 'form' })
check('the inline snippet: "<!-- Qolumns Widget (Inline) -->", id qolumns-widget, /widget.js',
  inlineSnippet.includes('<!-- Qolumns Widget (Inline) -->') && inlineSnippet.includes('<div id="qolumns-widget"></div>') && inlineSnippet.includes('data-container="#qolumns-widget"') && inlineSnippet.includes(`${origin}/widget.js`))
check('the floating snippet: "<!-- Qolumns Widget (Floating) -->"', floatingSnippet.includes('<!-- Qolumns Widget (Floating) -->') && floatingSnippet.includes('data-mode="floating"'))

// ====================================================================
section('3. Reserved quote-link names')
// ====================================================================
async function business(name: string) {
  const id = shortId()
  const email = `owner+t162-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, {
    headers: cookie,
    body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] },
  }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const slug = (await sb.select('tenants', `id=eq.${tenantId}&select=slug`))[0].slug as string
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, email, slug }
}
type Biz = Awaited<ReturnType<typeof business>>

const a = await business('Kent Painters')
const namesake = await business('Qolumns')
const reservedRows = (await sb.select('reserved_slugs', `slug=in.(qolumns,qolums,${SECOND_NAME.toLowerCase()},${FIRST_NAME.toLowerCase()})&select=slug`)) as Array<{ slug: string }>
check('the database reserves qolumns and qolums, and still both earlier names', reservedRows.length === 4, reservedRows.map((r) => r.slug).sort())
for (const word of ['qolumns', 'qolums', SECOND_NAME.toLowerCase()]) {
  const res = await http('GET', `${cfg.appUrl}/api/tenant/slug?check=${word}`, { headers: a.cookie })
  check(`a business cannot pick "${word.slice(0, 4)}…" as its quote link (reserved)`, res.ok && res.json.check?.available === false && res.json.check?.reason === 'reserved', res.json.check)
}
const taken = await http('PUT', `${cfg.appUrl}/api/tenant/slug`, { headers: a.cookie, body: { slug: 'qolumns' } })
check('…and the change itself is refused', !taken.ok && (await sb.select('tenants', `id=eq.${a.tenantId}&select=slug`))[0].slug === a.slug, { status: taken.status, code: taken.json?.error?.code })
check('a business called "Qolumns" gets a link of its own, not the reserved word', namesake.slug !== 'qolumns' && namesake.slug.startsWith('qolumns'), namesake.slug)
for (const word of ['qolumns', 'qolums']) {
  const page = await get(`/quote/${word}`)
  check(`/quote/${word} is nobody's page (404)`, page.status === 404, page.status)
}

// One service, and one request through the real pipeline, for the pages below
const door = garageDoorsPackUS.services[0]!
const created = expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: a.cookie,
  body: {
    name: door.name, description: door.description, documentTypeDefault: 'instant_estimate',
    scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
    workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
    draftConfig: door.draft,
  },
}))
const serviceId = created.service.id as string
const doorAnswers = [
  { fieldId: '_project_description', value: 'New garage door please, single steel one' },
  { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' },
  { fieldId: 'door_style', value: 'Steel, non-insulated' },
]
async function submit(biz: Biz, customer: { name: string; email: string }) {
  // Locally the request waits for the whole pipeline, and an AI call there can
  // stall. One retry, then carry on; a second stall fails the run.
  const post = () => http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: { tenantKey: biz.tenantKey, serviceId, customer, job: { postcodeOrZip: '63021', answers: doorAnswers }, source: { type: 'widget' } },
    timeoutMs: 150_000,
  })
  let posted
  try {
    posted = await post()
  } catch (error) {
    stalls.push(`${customer.name}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`⏳ the submission for ${customer.name} stalled; retrying once`)
    posted = await post()
  }
  const res = expectOk('submit', posted)
  const token = new URL(res.quoteViewUrl).searchParams.get('token')!
  await pollQuote(cfg, res.quoteId, token)
  return { id: res.quoteId as string, token, viewUrl: res.quoteViewUrl as string }
}
const quote = await submit(a, { name: 'Marlo Finch', email: 'marlo.finch@example.com' })
const publicQuote = await http('GET', `${cfg.appUrl}/api/public/quotes/${quote.id}?token=${quote.token}`)
check('a request priced after the rename (the pipeline runs under the new package names)', publicQuote.ok && Number(publicQuote.json.pricing?.total) > 0, publicQuote.json.pricing?.total)
check('the public quote carries no earlier name', oldNamesInText(JSON.stringify(publicQuote.json)).length === 0)

// ====================================================================
// 4. The pages and the embed code, in a browser (needs PLAYWRIGHT_DIR)
// ====================================================================
if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('The pages as a person sees them (home, login, dashboard, Quote link, the request page, a customer quote page, the emails) and the widget from the new snippet in inline, floating and iframe modes: set PLAYWRIGHT_DIR to run the browser pass. The served HTML, the loaders and the snippet are checked above.')
} else {
  section('4. The pages (browser)')
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const contextFor = async (biz: Biz | null, viewport = { width: 1440, height: 1000 }) => {
    const ctx = await browser.newContext({ viewport })
    if (biz) {
      await ctx.addCookies(biz.cookieHeader.split('; ').map((pair) => {
        const at = pair.indexOf('=')
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }
      }))
    }
    return ctx
  }
  type Ctx = Awaited<ReturnType<typeof contextFor>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
  const settle = async (p: Page) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(600) }
  /** What a person reads on the page: its text, its tab title and the words on its controls */
  const read = async (p: Page) => p.evaluate(() => [
    document.title,
    document.body.innerText,
    ...[...document.querySelectorAll('[aria-label],[title],[alt],[placeholder]')].map((el) => ['aria-label', 'title', 'alt', 'placeholder'].map((at) => el.getAttribute(at) ?? '').join(' ')),
  ].join('\n'))
  const pageCheck = async (p: Page, label: string, file: string, mustShow = NAME) => {
    await settle(p)
    const text = await read(p)
    await shot(p, file)
    check(`${label}: shows "${mustShow}" and neither earlier name`, text.includes(mustShow) && oldNamesInText(text).length === 0, { old: oldNamesInText(text) })
    return text
  }

  const anon = await contextFor(null)
  const signedIn = await contextFor(a)
  {
    const p = await anon.newPage()
    await p.goto(`${cfg.appUrl}/`)
    await pageCheck(p, 'home', 'home')
    check('home: the header and the footer both say Qolumns', (await p.locator('nav').first().innerText()).includes(NAME) && (await p.locator('footer').innerText()).includes(`© ${new Date().getFullYear()} Qolumns.`))
    await p.goto(`${cfg.appUrl}/login`)
    await pageCheck(p, 'login', 'login')
    await p.goto(`${cfg.appUrl}/quote/${a.slug}`)
    await pageCheck(p, 'the public request page (/quote/<slug>)', 'request-page', 'Powered by Qolumns')
    await p.goto(quote.viewUrl)
    await p.waitForFunction(() => /\$\d/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {})
    await pageCheck(p, 'a customer quote page', 'customer-quote-page', 'Prepared with Qolumns')
    await p.close()
  }
  {
    const p = await signedIn.newPage()
    await p.goto(`${cfg.appUrl}/app`)
    const homeText = await pageCheck(p, 'dashboard Home', 'dashboard-home')
    check('dashboard Home is the signed-in page (the business name shows)', homeText.includes('Kent Painters'))
    await p.goto(`${cfg.appUrl}/app/quotes/${quote.id}`)
    await pageCheck(p, 'a quote in the dashboard', 'dashboard-quote')
    await p.goto(`${cfg.appUrl}/app/quote-link`)
    const linkText = await pageCheck(p, 'the Quote link page', 'dashboard-quote-link')
    check('the Quote link page offers the new snippet', linkText.includes('<!-- Qolumns Widget (Inline) -->') && linkText.includes('<div id="qolumns-widget"></div>') && linkText.includes('data-container="#qolumns-widget"') && linkText.includes(`data-tenant-key="${a.tenantKey}"`))
    await p.getByRole('button', { name: 'Floating button' }).click()
    await p.waitForTimeout(300)
    check('…and the floating one', (await read(p)).includes('<!-- Qolumns Widget (Floating) -->'))
    await p.close()
  }
  for (const [name, html] of Object.entries(EMAILS)) {
    const p = await anon.newPage()
    await p.setContent(html)
    await pageCheck(p, `email as it renders, ${name}`, `email-${name.replace(/[^a-z]+/g, '-').replace(/-$/, '')}`, 'Powered by Qolumns')
    await p.close()
  }

  section('5. The widget from the new snippet, on another site (browser)')
  // A business's own website: a different address from ours (another host and
  // port), serving a page with the snippet exactly as the Quote link page
  // gives it. A small local server, because a browser will not let a made-up
  // public address load scripts from localhost.
  let hostBody = ''
  const hostPage = () => `<!doctype html><html><head><meta charset="utf-8"><title>Kent Painters</title></head><body><h1>Kent Painters</h1>
<script>
  window.__events = [];
  document.addEventListener(${JSON.stringify(EMBED_NAMES.submittedEvent)}, function (e) { window.__events.push({ name: 'new', detail: e.detail }); });
  document.addEventListener(${JSON.stringify(`${FIRST_NAME.toLowerCase()}:submitted`)}, function (e) { window.__events.push({ name: 'old', detail: e.detail }); });
</script>
${hostBody}</body></html>`
  const hostServer = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(hostPage()) })
  await new Promise<void>((resolve) => hostServer.listen(0, '127.0.0.1', resolve))
  const HOST = `http://127.0.0.1:${(hostServer.address() as AddressInfo).port}`
  check('the other site is a different origin from the app', new URL(HOST).origin !== origin, [HOST, origin])
  const openHost = async (ctx: Ctx, body: string) => {
    hostBody = body
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await p.goto(`${HOST}/`)
    return { p, errors }
  }
  const FIRST_STEP = 'Where should we send your estimate?'
  const oldGlobals = (p: Page) => p.evaluate(([w, i]) => [typeof (window as unknown as Record<string, unknown>)[w!], typeof (window as unknown as Record<string, unknown>)[i!]], [`${FIRST_NAME}Widget`, `${FIRST_NAME}Iframe`])

  // --- inline, and one real request through it
  {
    const snippet = embedSnippet({ appOrigin: origin, tenantKey: a.tenantKey, placement: 'inline', experience: 'form' })
    const { p } = await openHost(anon, snippet)
    const frameEl = p.locator('#qolumns-widget iframe')
    await frameEl.waitFor({ timeout: 20_000 })
    const frame = p.frameLocator('#qolumns-widget iframe')
    await frame.getByText(FIRST_STEP).waitFor({ timeout: 30_000 })
    check('inline: the form shows inside #qolumns-widget on the other site', (await frameEl.getAttribute('src')) === `${origin}/embed/${a.tenantKey}`, await frameEl.getAttribute('src'))
    await p.waitForFunction(() => parseInt((document.querySelector('#qolumns-widget iframe') as HTMLIFrameElement).style.height || '0', 10) > 250, null, { timeout: 15_000 }).catch(() => {})
    const height = await frameEl.evaluate((el) => (el as HTMLIFrameElement).style.height)
    check('inline: the frame takes the form’s height (the qolumns-resize message arrived)', parseInt(height || '0', 10) > 250, height)
    check('inline: window.QolumnsWidget is there and the earlier globals are not', (await p.evaluate(() => typeof (window as unknown as { QolumnsWidget?: { init?: unknown } }).QolumnsWidget?.init)) === 'function' && (await oldGlobals(p)).every((t) => t === 'undefined'), await oldGlobals(p))
    await shot(p, 'embed-inline')

    await frame.getByLabel('Your name').fill('Rowan Vale')
    await frame.getByLabel('Email').fill('rowan.vale@example.com')
    await frame.getByRole('button', { name: 'Continue' }).click()
    await frame.getByText('About the job').waitFor({ timeout: 15_000 })
    // T-171: a question with two to five choices is rows to tap; a longer list keeps its picker
    for (const group of await frame.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').first().click()
    for (const select of await frame.locator('select').all()) await select.selectOption({ index: 1 })
    await frame.getByRole('button', { name: 'Continue' }).click()
    await frame.getByText('Photos & Documents').waitFor({ timeout: 15_000 })
    await frame.getByRole('button', { name: 'Continue' }).click()
    await frame.getByLabel('ZIP code').fill('63021')
    await frame.getByRole('button', { name: 'Get my estimate' }).click()
    const arrived = await p.waitForFunction(() => (window as unknown as { __events: unknown[] }).__events.length > 0, null, { timeout: 240_000 }).then(() => true).catch(() => false)
    const events = await p.evaluate(() => (window as unknown as { __events: Array<{ name: string; detail: { quoteId?: string; quoteViewUrl?: string; tenantKey?: string } }> }).__events)
    check('inline: a request sent through it reaches the site as the "qolumns:submitted" event, with the quote', arrived && events.length === 1 && events[0]!.name === 'new' && events[0]!.detail.tenantKey === a.tenantKey && /^qte_/.test(events[0]!.detail.quoteId ?? '') && (events[0]!.detail.quoteViewUrl ?? '').includes('/q/'), events.map((e) => [e.name, e.detail.quoteId]))
    check('inline: the earlier event name is not sent', !events.some((e) => e.name === 'old'))
    await shot(p, 'embed-inline-submitted')
    await p.close()
  }

  // --- floating
  {
    const snippet = embedSnippet({ appOrigin: origin, tenantKey: a.tenantKey, placement: 'floating', experience: 'form' })
    const { p, errors } = await openHost(anon, snippet)
    const launcher = p.locator('#qolumns-floating-launcher')
    await launcher.waitFor({ timeout: 20_000 })
    check('floating: the button shows, with the id qolumns-floating-launcher', (await launcher.innerText()) === 'Get an instant quote' && (await p.locator('#qolumns-floating-overlay').evaluate((el) => getComputedStyle(el).display)) === 'none')
    await launcher.click()
    const frame = p.frameLocator('#qolumns-floating-overlay iframe')
    await frame.getByText(FIRST_STEP).waitFor({ timeout: 30_000 })
    check('floating: pressing it opens the form in #qolumns-floating-overlay', (await p.locator('#qolumns-floating-overlay').evaluate((el) => getComputedStyle(el).display)) === 'block')
    await shot(p, 'embed-floating-open')
    await p.evaluate(() => (window as unknown as { QolumnsWidget: { close: () => void } }).QolumnsWidget.close())
    check('floating: QolumnsWidget.close() closes it and the button comes back', (await p.locator('#qolumns-floating-overlay').evaluate((el) => getComputedStyle(el).display)) === 'none' && (await launcher.isVisible()))
    await p.evaluate(() => (window as unknown as { QolumnsWidget: { open: () => void } }).QolumnsWidget.open())
    check('floating: QolumnsWidget.open() opens it again', (await p.locator('#qolumns-floating-overlay').evaluate((el) => getComputedStyle(el).display)) === 'block')
    await p.evaluate(() => (window as unknown as { QolumnsWidget: { init: (c: object) => void } }).QolumnsWidget.init({}))
    await p.waitForTimeout(200)
    check('the loader’s console messages start with [qolumns]', errors.some((e) => e.startsWith('[qolumns] tenantKey is required')), errors)
    check('floating: the earlier globals and ids are gone', (await oldGlobals(p)).every((t) => t === 'undefined') && (await p.locator(`#${FIRST_NAME.toLowerCase()}-floating-launcher`).count()) === 0)
    await p.close()
  }

  // --- iframe mode of widget.js, in a container the site names itself
  {
    const { p } = await openHost(anon, `<div id="my-quote-form"></div>
<script src="${origin}/widget.js" data-tenant-key="${a.tenantKey}" data-mode="iframe" data-container="#my-quote-form" async></script>`)
    const frame = p.frameLocator('#my-quote-form iframe')
    await frame.getByText(FIRST_STEP).waitFor({ timeout: 30_000 })
    await p.waitForFunction(() => parseInt((document.querySelector('#my-quote-form iframe') as HTMLIFrameElement).style.height || '0', 10) > 250, null, { timeout: 15_000 }).catch(() => {})
    const height = await p.locator('#my-quote-form iframe').evaluate((el) => (el as HTMLIFrameElement).style.height)
    check('iframe mode (widget.js): the form shows in the site’s own container and takes its height', parseInt(height || '0', 10) > 250, height)
    await shot(p, 'embed-iframe-mode')
    await p.close()
  }

  // --- the older iframe-loader.js
  {
    const { p } = await openHost(anon, `<div id="qolumns-widget"></div>
<script src="${origin}/iframe-loader.js" data-tenant-key="${a.tenantKey}" async></script>`)
    const frame = p.frameLocator('#qolumns-widget iframe')
    await frame.getByText(FIRST_STEP).waitFor({ timeout: 30_000 })
    await p.waitForFunction(() => parseInt((document.querySelector('#qolumns-widget iframe') as HTMLIFrameElement).style.height || '0', 10) > 250, null, { timeout: 15_000 }).catch(() => {})
    const height = await p.locator('#qolumns-widget iframe').evaluate((el) => (el as HTMLIFrameElement).style.height)
    const api = await p.evaluate((key) => {
      const g = (window as unknown as { QolumnsIframe?: { init?: unknown; iframes?: Record<string, unknown> } }).QolumnsIframe
      return { init: typeof g?.init, has: Boolean(g?.iframes?.[key]) }
    }, a.tenantKey)
    check('iframe-loader.js: mounts into #qolumns-widget by default, takes its height, and exposes window.QolumnsIframe', parseInt(height || '0', 10) > 250 && api.init === 'function' && api.has && (await oldGlobals(p)).every((t) => t === 'undefined'), { height, api })
    await shot(p, 'embed-iframe-loader')
    await p.close()
  }

  // --- a page still carrying the earlier container id gets nothing (clean rename, no alias)
  {
    const { p, errors } = await openHost(anon, `<div id="${FIRST_NAME.toLowerCase()}-widget"></div>
<script src="${origin}/widget.js" data-tenant-key="${a.tenantKey}" data-mode="inline" async></script>`)
    await p.waitForTimeout(1500)
    check('the earlier container id is not served: no form, and the loader says which container it wanted', (await p.locator('iframe').count()) === 0 && errors.some((e) => e.startsWith('[qolumns] Container not found: #qolumns-widget')), errors)
    await p.close()
  }

  await browser.close()
  hostServer.close()
}

// ====================================================================
const failed = checks.filter((c) => !c.pass)
saveJson(outDir, 'checks.json', { checks, notChecked, stalls })
if (stalls.length) console.log(`\nStalled and retried:\n${stalls.map((s) => `  • ${s}`).join('\n')}`)
if (notChecked.length) console.log(`\nNot checked here:\n${notChecked.map((s) => `  • ${s}`).join('\n')}`)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
