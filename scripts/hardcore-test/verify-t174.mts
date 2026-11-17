// T-174 check: cleaner quote links, the Home copy and sample name, and the move to qolumns.com.
//
// Local stack (web on :3000, worker on :8787, local Supabase):
//   PLAYWRIGHT_DIR=<folder> npx tsx scripts/hardcore-test/verify-t174.mts
// Without PLAYWRIGHT_DIR the browser section is skipped and says so.
//
// Production, read-only, once the DNS records are in and the web app is deployed:
//   PLAYWRIGHT_DIR=<folder> POSTMARK_DKIM_HOST=<selector>._domainkey npx tsx scripts/hardcore-test/verify-t174.mts --live
// The live run submits nothing: it only reads pages, DNS and settings. In the
// browser every request that is not a GET is answered inside the browser.
//
// What the local run covers:
//   1. A2: clean options built from a business's own details and checked free;
//      a free replacement that leaves the one change; the old link redirecting;
//      the one later change; the rules (format, reserved words, never reuse).
//   2. A1 and A3: the Home examples in their new order, the estimate line, the
//      sample customer's name.
//   3. The four addresses: three redirect permanently with the path kept, the
//      main one serves; the previous address still serves quote links and the
//      embed (requests carry the Host a visitor's browser would send).
//   4. Emails are built with the new address (what is handed to Postmark).
//   5. Auth redirects allow both addresses (what the deploy script sends).
//   6. In a browser: the offer on the Quote link page and at the end of setup,
//      Home, and the embed code loaded from the previous address.
import http from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http as call, expectOk, shortId, runStamp } from './lib.mjs'
import { slugify, slugProblem } from '../../apps/web/src/lib/tenant-slug'
import { NOTICES } from '../../apps/web/src/lib/marketing/home-copy'
import { embedSnippet } from '../../apps/web/src/lib/embed-snippet'
import { emailFromHeader } from '../../packages/shared/src/email-from'
import domains from '../../packages/shared/src/domains.json'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'

type Row = Record<string, unknown>
const LIVE = process.argv.includes('--live')
const MAIN = domains.main
const NEW = `https://${MAIN}`
const OLD_HOST = domains.previous[0]!
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t174${LIVE ? '-live' : ''}-${shortId()}`)
mkdirSync(outDir, { recursive: true })

const checks: Array<{ name: string; pass: boolean }> = []
const notChecked: string[] = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const section = (title: string) => console.log(`\n== ${title}`)
function finish(): never {
  const failed = checks.filter((c) => !c.pass)
  if (notChecked.length) console.log(`\nNot checked:\n${notChecked.map((n) => `  - ${n}`).join('\n')}`)
  console.log(`\n${checks.length - failed.length}/${checks.length} pass   (results: ${outDir})`)
  process.exit(failed.length ? 1 : 0)
}

/** GET with the Host a visitor's browser would send; never follows a redirect */
function getAs(host: string, pathname: string, base = 'http://localhost:3000'): Promise<{ status: number; location: string | null; body: string; type: string }> {
  const target = new URL(pathname, base)
  return new Promise((resolve, reject) => {
    const req = http.request({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: 'GET', headers: { Host: host } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string | undefined) ?? null, body: Buffer.concat(chunks).toString('utf8'), type: String(res.headers['content-type'] ?? '') }))
    })
    req.on('error', reject)
    req.end()
  })
}

if (LIVE) await live()
else await local()
finish()

// =====================================================================================
async function local() {
  const cfg = loadEnv()
  const sb = makeSupabase(cfg)
  const app = cfg.appUrl
  const tenantRow = async (id: string) => (await sb.select('tenants', `id=eq.${id}&select=id,name,slug,slug_changed_at`))[0] as { id: string; name: string; slug: string; slug_changed_at: string | null }
  const history = async (tenantId: string) => ((await sb.select('tenant_slug_history', `tenant_id=eq.${tenantId}&select=old_slug`)) as Array<{ old_slug: string }>).map((r) => r.old_slug)
  const page = async (pathname: string) => {
    const res = await fetch(`${app}${pathname}`, { redirect: 'manual' })
    return { status: res.status, location: res.headers.get('location'), html: res.status === 200 ? await res.text() : '' }
  }

  async function business(name: string, details: Row = {}) {
    const id = shortId()
    const email = `owner+t174-${id}@hardcore.test`
    const password = `Hardcore-${id}-Aa1!`
    const user = await sb.createUser(email, password, name)
    const session = await sb.signIn(email, password)
    const cookieHeader = sessionCookieHeader(cfg, session)
    const cookie = { Cookie: cookieHeader }
    const setup = await call('POST', `${app}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
    const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
    expectOk('tenant', await call('PUT', `${app}/api/tenant`, {
      headers: cookie,
      body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [], ...details },
    }))
    return { cookie, cookieHeader, tenantId, name, slug: (await tenantRow(tenantId)).slug }
  }
  type Biz = Awaited<ReturnType<typeof business>>
  const slugGet = async (biz: Biz, query = '') => expectOk('slug GET', await call('GET', `${app}/api/tenant/slug${query}`, { headers: biz.cookie }))
  const slugPut = (biz: Biz, body: Row) => call('PUT', `${app}/api/tenant/slug`, { headers: biz.cookie, body })

  // ------------------------------------------------------------------------------------
  section('1. Cleaner quote links (A2)')
  const stem = `CL ${shortId()}`
  const base = slugify(stem)
  const details = { trade: 'other', tradeOther: 'Chimney sweeping', serviceAreaMode: 'county_state', serviceAreaValues: ['Austin'] }

  const first = await business(stem)
  check('the first business with a name gets the plain link, and is offered nothing', first.slug === base && (await slugGet(first)).random === false && (await slugGet(first)).options === undefined, first.slug)

  const twin = await business(stem, details)
  check('a second business with the same name gets random characters on its link', new RegExp(`^${base}-[0-9a-f]{4}$`).test(twin.slug), twin.slug)

  // another business already uses the link that would be the first option
  const taker = await business(`Taker ${shortId()}`)
  const takenOption = `${base}-austin`
  check('(setting up) another business takes the link that would be offered first', (await slugPut(taker, { slug: takenOption })).ok)

  const offer = await slugGet(twin)
  const expected = [`${base}-chimney-sweeping`, `${base}-chimney-sweeping-austin`, `${base}-us`]
  check('it is offered three clean links built from its own trade, service area and region', offer.random === true && JSON.stringify(offer.options) === JSON.stringify(expected), offer.options)
  check('the link another business uses is not among them', !(offer.options as string[]).includes(takenOption))
  check('no option ends in generated characters, and each is well formed', (offer.options as string[]).every((o) => slugProblem(o) === null && !/-[0-9a-f]{4}$/.test(o.replace(base, ''))))
  const liveChecks = await Promise.all((offer.options as string[]).map((o) => slugGet(twin, `?check=${o}`)))
  check('each option is free at the live check', liveChecks.every((c) => c.check?.available === true), liveChecks.map((c) => c.check))
  check('the one change is still there while the link is random', offer.changeable === true)

  const plainHex = await business(`Vale Works ${shortId()} ${shortId().slice(0, 4)}`)
  check('a business whose own name ends in four such characters has the plain link, not a random one', plainHex.slug === slugify(plainHex.name) && (await slugGet(plainHex)).random === false, plainHex.slug)

  // the rules hold for a free replacement
  check('rules: a reserved word is refused (400)', (await slugPut(twin, { slug: 'quote' })).status === 400)
  check('rules: a malformed link is refused (400)', (await slugPut(twin, { slug: 'a' })).status === 400)
  check('rules: another business’s link is refused (409)', (await slugPut(twin, { slug: first.slug })).status === 409)
  check('rules: nothing changed while those were refused', (await tenantRow(twin.tenantId)).slug === twin.slug && (await history(twin.tenantId)).length === 0)

  // the free replacement
  const chosen = expected[0]!
  const replaced = await slugPut(twin, { slug: chosen })
  const afterFree = await tenantRow(twin.tenantId)
  check('replacing the random link with a clean one works', replaced.ok && replaced.json.slug === chosen && afterFree.slug === chosen, replaced.json)
  check('it is free: the one change is not used up', replaced.json.free === true && replaced.json.changeable === true && afterFree.slug_changed_at === null, { free: replaced.json.free, slug_changed_at: afterFree.slug_changed_at })
  check('the random link is in the history table', JSON.stringify(await history(twin.tenantId)) === JSON.stringify([twin.slug]))
  const oldLink = await page(`/quote/${twin.slug}`)
  check('the random link redirects permanently to the clean one', oldLink.status === 308 && (oldLink.location ?? '').endsWith(`/quote/${chosen}`), { status: oldLink.status, location: oldLink.location })
  const afterOffer = await slugGet(twin)
  check('the business is not offered a second free replacement, and can still change the link once', afterOffer.random === false && afterOffer.options === undefined && afterOffer.changeable === true, afterOffer)

  // never reuse
  const twin2 = await business(stem)
  check('never reuse: another business cannot take the random link that was given up (409)', (await slugPut(twin2, { slug: twin.slug })).status === 409)
  check('never reuse: the live check says so', (await slugGet(twin2, `?check=${twin.slug}`)).check?.available === false)

  // the one later change
  const later = `${base}-later`
  const changed = await slugPut(twin, { slug: later })
  const afterChange = await tenantRow(twin.tenantId)
  check('one later change is still allowed, and it is the one change', changed.ok && changed.json.changeable === false && changed.json.free === false && afterChange.slug === later && afterChange.slug_changed_at !== null, changed.json)
  const [fromRandom, fromClean] = [await page(`/quote/${twin.slug}`), await page(`/quote/${chosen}`)]
  check('both earlier links redirect to the current one', [fromRandom, fromClean].every((r) => r.status === 308 && (r.location ?? '').endsWith(`/quote/${later}`)), [fromRandom.location, fromClean.location])
  check('a further change is refused (409)', (await slugPut(twin, { slug: `${base}-again` })).status === 409)

  // typing its own, and "free" is the server's decision
  const typed = `typed-${shortId()}-${shortId().slice(0, 4)}`
  const own = await slugPut(twin2, { slug: typed })
  check('a business with a random link can type its own, and that is free too', own.ok && own.json.free === true && (await tenantRow(twin2.tenantId)).slug_changed_at === null, own.json)
  check('free happens once: a typed link that looks random is not random again', (await slugGet(twin2)).random === false)
  const paid = await slugPut(first, { slug: `${base}-mine`, free: true, random: true })
  check('a business with a plain link cannot ask for a free change: it uses its one change', paid.ok && paid.json.free === false && paid.json.changeable === false && (await tenantRow(first.tenantId)).slug_changed_at !== null, paid.json)
  check('signed out: no link is read or changed (401)', (await call('GET', `${app}/api/tenant/slug`)).status === 401 && (await call('PUT', `${app}/api/tenant/slug`, { body: { slug: `${base}-x` } })).status === 401)
  check('no other business’s link moved', (await tenantRow(taker.tenantId)).slug === takenOption && (await tenantRow(plainHex.tenantId)).slug === plainHex.slug)

  // ------------------------------------------------------------------------------------
  section('2. Home copy and the sample name (A1, A3)')
  const home = (await page('/')).html.replace(/<!-- -->/g, '')
  // T-173 changed the order again (the owner's): the message, the photos (the walls and the label are its two examples), extras, the question
  const titles = ['What your customer wrote', 'What the photos show', 'Walls, measured from photos', 'Model and size, read from a photo', 'Something extra they mention', 'When it can’t tell, it asks']
  const positions = titles.map((t) => home.indexOf(`>${t}<`))
  check('Home, "What it notices": what the customer wrote, what the photos show (the walls, then the label), extras, then the question', positions.every((p) => p > 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]!), positions)
  check('the label example is "Model and size, read from a photo"; the old title is gone', !home.includes('A label, read'))
  const note = 'It’s an estimate. Your customer checks it and you confirm the price.'
  const wallsAt = positions[2]!
  check('under "Walls, measured from photos": the estimate line', home.indexOf(note) > wallsAt && home.indexOf(note) < positions[3]!, NOTICES.examples[1].parts[0])
  check('no accuracy figure in the section', !/accura|\d\s?% (of the time|accurate)|never wrong/i.test(home.slice(positions[0]!, positions[5]! + 600)))
  for (const [name, pathname] of [['Home', '/'], ['Features', '/features'], ['the login page', '/login'], ['the demo', '/demo'], ['the water heater page', '/trades/water-heaters']] as const) {
    const html = (await page(pathname)).html
    check(`${name}: no "Priya" on the page`, html.length > 1000 && !/priya/i.test(html))
  }
  check('Home and the login page show "Megan G."', home.includes('Megan G.') && (await page('/login')).html.includes('Megan G.'))

  // ------------------------------------------------------------------------------------
  section('3. The four addresses, and the previous one (requests carry the visitor’s Host)')
  const site = await sb.insert('tenant_sites', { tenant_id: twin.tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const tenantKey = site.tenant_key as string
  const paths = ['/', '/pricing?plan=pro&x=1', `/quote/${later}`, '/widget.js', `/q/qte_example?token=example`, '/api/public/quotes/qte_example?token=example']
  for (const host of domains.redirects) {
    const results = await Promise.all(paths.map((p) => getAs(host, p)))
    check(`${host}: a permanent redirect to ${MAIN}, path and query kept`, results.every((r, i) => r.status === 308 && r.location !== null && new URL(r.location).href === new URL(`${NEW}${paths[i]}`).href), results.map((r) => `${r.status} ${r.location}`).slice(0, 2))
  }
  const mainHome = await getAs(MAIN, '/')
  const mainQuote = await getAs(MAIN, `/quote/${later}`)
  check(`${MAIN}: serves, with no redirect`, mainHome.status === 200 && mainQuote.status === 200 && mainQuote.body.includes(tenantKey), [mainHome.status, mainQuote.status])
  const oldQuote = await getAs(OLD_HOST, `/quote/${later}`)
  check('the previous address still serves a business’s quote link (no redirect to the new address)', oldQuote.status === 200 && oldQuote.location === null && oldQuote.body.includes(tenantKey), oldQuote.status)
  const oldFormer = await getAs(OLD_HOST, `/quote/${twin.slug}`)
  check('on the previous address an earlier link still redirects to the current one', oldFormer.status === 308 && (oldFormer.location ?? '').endsWith(`/quote/${later}`) && !(oldFormer.location ?? '').includes(MAIN), oldFormer.location)
  const oldLoader = await getAs(OLD_HOST, '/widget.js')
  const oldEmbed = await getAs(OLD_HOST, `/embed/${tenantKey}`)
  check('the previous address still serves the embed script and the form it loads', oldLoader.status === 200 && /javascript/.test(oldLoader.type) && oldLoader.body.includes('QolumnsWidget') && oldEmbed.status === 200, [oldLoader.status, oldEmbed.status])
  const oldCustomerApi = await getAs(OLD_HOST, '/api/public/quotes/qte_madeup000000?token=madeup-token-000000000000000000000000')
  const oldCustomerPage = await getAs(OLD_HOST, '/q/qte_madeup000000?token=madeup')
  check('the previous address still answers a customer’s quote link itself (the page loads; a made-up token is a 404 from the API, not a redirect)', oldCustomerPage.status === 200 && oldCustomerApi.status === 404, [oldCustomerPage.status, oldCustomerApi.status])

  // ------------------------------------------------------------------------------------
  section('4. Emails are built with the new address')
  const SENDER = `quotes@${MAIN}`
  check('the sender to a customer: "<business> via Qolumns" at the new address', emailFromHeader({ kind: 'customer', businessName: 'Kent Painters' }, SENDER) === `"Kent Painters via Qolumns" <${SENDER}>`)
  check('the sender to the business: "Qolumns" at the new address', emailFromHeader({ kind: 'business' }, SENDER) === `"Qolumns" <${SENDER}>`)
  {
    // What each app hands to Postmark, with production's two settings. Nothing is sent: fetch is replaced.
    const sent: Row[] = []
    const realFetch = globalThis.fetch
    const saved = { url: process.env.NEXT_PUBLIC_APP_URL, token: process.env.POSTMARK_API_TOKEN, from: process.env.POSTMARK_FROM_EMAIL }
    Object.assign(process.env, { NEXT_PUBLIC_APP_URL: NEW, POSTMARK_API_TOKEN: 'not-a-token', POSTMARK_FROM_EMAIL: SENDER })
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Row)
      return new Response(JSON.stringify({ MessageID: 'local', ErrorCode: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    try {
      const web = await import('../../apps/web/src/lib/postmark')
      const webTemplates = await import('../../apps/web/src/lib/email-templates')
      const worker = await import('../../apps/worker/src/email/postmark')
      const workerTemplates = await import('../../apps/worker/src/email/templates')
      const { appOriginFrom } = await import('../../apps/web/src/lib/tenant-site')
      const appUrl = process.env.NEXT_PUBLIC_APP_URL!
      await web.sendEmail({
        from: { kind: 'customer', businessName: 'Kent Painters' }, to: 'megan.grant@example.com', subject: 'Your updated quote',
        htmlBody: webTemplates.generateRevisedQuoteEmailHtml({ customerName: 'Megan Grant', businessName: 'Kent Painters', serviceName: 'Interior Painting', quoteViewUrl: `${appUrl}/q/qte_example?token=example`, total: '$825.00' }),
        replyTo: 'office@kentpainters.example',
      })
      await worker.sendEmail({ apiToken: 'not-a-token', fromEmail: SENDER }, {
        from: { kind: 'business' }, to: 'office@kentpainters.example', subject: 'Review and approve',
        htmlBody: workerTemplates.reviewRequestEmail({
          businessName: 'Kent Painters', customerName: 'Megan Grant', customerEmail: 'megan.grant@example.com', serviceName: 'Interior Painting',
          quoteId: 'qte_example', total: '$825.00', approveUrl: `${NEW}/approve/example`, dashboardUrl: `${NEW}/app/quotes/qte_example`, holdLine: 'The customer can already see this as an estimate.',
        }),
      })
      const [toCustomer, toBusiness] = sent
      const links = (html: unknown) => [...String(html).matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]!)
      check('web app → Postmark: From is the new address with the business’s name, and reply-to is still the business', toCustomer?.From === `"Kent Painters via Qolumns" <${SENDER}>` && toCustomer?.ReplyTo === 'office@kentpainters.example', { From: toCustomer?.From, ReplyTo: toCustomer?.ReplyTo })
      check('worker → Postmark: From is the new address under the product’s name', toBusiness?.From === `"Qolumns" <${SENDER}>`, toBusiness?.From)
      const allLinks = [...links(toCustomer?.HtmlBody), ...links(toBusiness?.HtmlBody)]
      check('every link in both emails is on the new address', allLinks.length >= 3 && allLinks.every((l) => l.startsWith(`${NEW}/`)), allLinks)
      check('with the setting on the new address, links are built on it whatever address served the page', appOriginFrom(OLD_HOST) === NEW && appOriginFrom('localhost:3000') === NEW)
      check('the old sending domain is in neither email', !JSON.stringify(sent).includes('thegreatbilliom') && !JSON.stringify(sent).includes('vercel.app'))
    } finally {
      globalThis.fetch = realFetch
      for (const [key, value] of [['NEXT_PUBLIC_APP_URL', saved.url], ['POSTMARK_API_TOKEN', saved.token], ['POSTMARK_FROM_EMAIL', saved.from]] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  // ------------------------------------------------------------------------------------
  section('5. Auth redirects allow both addresses (what the deploy script sends)')
  const dry = (...steps: string[]) => execFileSync('bash', [path.join(ROOT, 'scripts/deploy-t174-settings.sh'), '--dry-run', ...steps], { encoding: 'utf8' })
  const auth = JSON.parse(dry('auth').replace(/^[^{]*/, '').replace(/[^}]*$/, '')) as { site_url: string; uri_allow_list: string }
  check('Site URL is the new address', auth.site_url === NEW, auth.site_url)
  check('the allowed redirect URLs are the new and the previous address', JSON.stringify(auth.uri_allow_list.split(',')) === JSON.stringify([`${NEW}/**`, `https://${OLD_HOST}/**`]), auth.uri_allow_list)
  // T-173: sign-up goes through the server, which builds the link in the confirmation email. In production it uses
  // the configured main address, never the address in the request (that could be pointed at someone else's site),
  // so a sign-up started on the previous address is confirmed on the new one.
  const flow = readFileSync(path.join(ROOT, 'apps/web/src/lib/auth-flow.ts'), 'utf8')
  check('the confirmation link is built from the configured main address in production', flow.includes("if (process.env.NODE_ENV === 'production') return configured || 'http://localhost:3000'") && flow.includes('return `${origin}/auth/confirm?type=${type}&token_hash=${encodeURIComponent(tokenHash)}`'))
  const cors = JSON.parse(dry('cors').replace(/^[^{]*/, '').replace(/[^}]*$/, '')) as { rules: Array<{ allowed: { origins: string[] } }> }
  check('photo uploads are accepted from both addresses (bucket CORS)', [NEW, `https://${OLD_HOST}`].every((o) => cors.rules[0]!.allowed.origins.includes(o)), cors.rules[0]!.allowed.origins)

  // ------------------------------------------------------------------------------------
  section('6. In a browser')
  if (!process.env.PLAYWRIGHT_DIR) {
    notChecked.push('The browser section (the offer on the Quote link page and in setup, Home, the embed from the previous address): PLAYWRIGHT_DIR is not set.')
    return
  }
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  // The browser asks for the previous address by its real https name (every .app name is https-only in a
  // browser). Each such request is answered by the local server, which is sent the same Host header.
  const oldOrigin = `https://${OLD_HOST}`
  type RouteLike = { request(): { url(): string; headers(): Record<string, string> }; fetch(options: object): Promise<unknown>; fulfill(options: object): Promise<void> }
  const servePreviousAddressLocally = (ctx: { route: (url: string, handler: (route: RouteLike) => Promise<void>) => Promise<unknown> }) =>
    ctx.route(`${oldOrigin}/**`, async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const response = await route.fetch({ url: `${app}${url.pathname}${url.search}`, headers: { ...req.headers(), host: OLD_HOST }, maxRedirects: 0 })
      await route.fulfill({ response })
    })
  const signedIn = async (biz: Biz, width: number) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await ctx.addInitScript('globalThis.__name = (f) => f')
    await ctx.addCookies(biz.cookieHeader.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: app })))
    return ctx
  }
  const JUNIPER = 'rgb(32, 94, 86)'

  // --- the Quote link page, at a phone and a desktop width
  for (const width of [390, 1440]) {
    const biz = await business(stem, details)
    const ctx = await signedIn(biz, width)
    const p = await ctx.newPage()
    await p.goto(`${app}/app/quote-link`, { waitUntil: 'networkidle' })
    const offerBox = p.locator('[data-testid=clean-link-offer]')
    await offerBox.waitFor({ timeout: 30_000 })
    const options = await offerBox.locator('[data-testid=clean-link-option]').allInnerTexts()
    check(`${width}: the Quote link page offers clean links for a random link, in place of the one-time change`, options.length >= 2 && options.every((o) => o.includes(`/quote/${base}-`)) && (await p.getByText('Change the end of the link').count()) === 0, options)
    const text = (await offerBox.innerText()).replace(/\s+/g, ' ')
    check(`${width}: it says it is free, does not use the one change, and the current link keeps working`, /free/.test(text) && /doesn’t use up your one change|doesn't use up your one change/.test(text) && /current link keeps working/.test(text), text.slice(0, 200))
    const button = offerBox.getByRole('button', { name: 'Use this link' })
    const look = await button.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, h: Math.round(el.getBoundingClientRect().height) }))
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${width}: the button is juniper (no yellow), at least 44 high, and nothing scrolls sideways`, look.bg === JUNIPER && look.h >= 44 && sideways <= 0, { ...look, sideways })
    await p.screenshot({ path: path.join(outDir, `quote-link-offer-${width}.png`), fullPage: true })
    // pick the second option
    await offerBox.locator('[data-testid=clean-link-option]').nth(1).click()
    const wanted = (options[1] ?? '').replace(/\s+/g, '').split('/quote/')[1]!
    await button.click()
    await p.locator('[data-testid=clean-link-done]').waitFor({ timeout: 15_000 })
    const shown = await p.locator('[data-testid=quote-link]').innerText()
    const row = await tenantRow(biz.tenantId)
    check(`${width}: choosing one replaces the link on the page and in the database, free`, shown.endsWith(`/quote/${wanted}`) && row.slug === wanted && row.slug_changed_at === null, { shown, slug: row.slug })
    await p.screenshot({ path: path.join(outDir, `quote-link-replaced-${width}.png`), fullPage: true })
    await p.reload({ waitUntil: 'networkidle' })
    check(`${width}: afterwards the offer is gone and the one-time change is offered`, (await p.locator('[data-testid=clean-link-offer]').count()) === 0 && (await p.getByText('Change the end of the link').count()) === 1)
    await ctx.close()
  }

  // --- typing its own, with the live check
  {
    // a business with only a region to build from, and that one link already taken: nothing can be offered
    await slugPut(await business(`Taker ${shortId()}`), { slug: `${base}-us` })
    const biz = await business(stem)
    check('(setting up) this business has no details a free link can be built from', JSON.stringify((await slugGet(biz)).options) === '[]')
    const ctx = await signedIn(biz, 390)
    const p = await ctx.newPage()
    await p.goto(`${app}/app/quote-link`, { waitUntil: 'networkidle' })
    const offerBox = p.locator('[data-testid=clean-link-offer]')
    await offerBox.waitFor({ timeout: 30_000 })
    const input = offerBox.getByLabel('New ending')
    check('with no details to use, the business is asked to type its own ending', (await offerBox.locator('[data-testid=clean-link-option]').count()) === 0 && (await input.isVisible()) && (await offerBox.innerText()).includes('Type a cleaner ending.'))
    await input.fill('quote')
    await offerBox.getByText('That word is reserved').waitFor({ timeout: 10_000 })
    const blocked = await offerBox.getByRole('button', { name: 'Use this link' }).isDisabled()
    const mine = `my own ${shortId()}`
    await input.fill(mine)
    await offerBox.getByText('Available').waitFor({ timeout: 10_000 })
    check('typing its own: a reserved word is refused by the live check and cannot be saved; a free one says "Available"', blocked && !(await offerBox.getByRole('button', { name: 'Use this link' }).isDisabled()))
    await offerBox.getByRole('button', { name: 'Use this link' }).click()
    await p.locator('[data-testid=clean-link-done]').waitFor({ timeout: 15_000 })
    const row = await tenantRow(biz.tenantId)
    check('the typed link is saved in link form, free', row.slug === slugify(mine) && row.slug_changed_at === null, row.slug)
    await ctx.close()
  }

  // --- the end of setup
  {
    const biz = await business(stem)
    const ctx = await signedIn(biz, 1440)
    const p = await ctx.newPage()
    try {
      await p.goto(`${app}/app/onboarding`, { waitUntil: 'networkidle' })
      await p.getByRole('radio', { name: /Garage doors/ }).click()
      await p.getByRole('button', { name: 'Continue' }).click()
      await p.getByRole('button', { name: 'Looks right — continue' }).click({ timeout: 30_000 })
      await p.getByRole('button', { name: 'These are my prices' }).click({ timeout: 30_000 })
      await p.getByPlaceholder(/comma-separated/).fill('78701')
      await p.getByRole('button', { name: /Create \d+ services? & finish/ }).click({ timeout: 30_000 })
      await p.locator('[data-testid=setup-quote-link]').waitFor({ timeout: 120_000 })
      const offerBox = p.locator('[data-testid=clean-link-offer]')
      await offerBox.waitFor({ timeout: 30_000 })
      const options = (await offerBox.locator('[data-testid=clean-link-option]').allInnerTexts()).map((o) => o.replace(/\s+/g, '').split('/quote/')[1])
      check('setup’s last step offers clean links built from the trade and service area just entered', options.includes(`${base}-garage-doors`) && options.includes(`${base}-78701`), options)
      await p.screenshot({ path: path.join(outDir, 'setup-offer-1440.png'), fullPage: true })
      await offerBox.getByRole('button', { name: 'Use this link' }).click()
      await p.locator('[data-testid=clean-link-done]').waitFor({ timeout: 15_000 })
      const shown = await p.locator('[data-testid=setup-quote-link]').innerText()
      const row = await tenantRow(biz.tenantId)
      check('choosing one there changes the link shown in setup, free', shown.endsWith(`/quote/${row.slug}`) && row.slug === options[0] && row.slug_changed_at === null, { shown, slug: row.slug })
    } catch (error) {
      await p.screenshot({ path: path.join(outDir, 'setup-offer-failed.png'), fullPage: true }).catch(() => {})
      check('setup’s last step offers clean links (walked in a browser)', false, String(error).slice(0, 300))
    }
    await ctx.close()
  }

  // --- Home
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await ctx.addInitScript('globalThis.__name = (f) => f')
    const p = await ctx.newPage()
    await p.goto(`${app}/`, { waitUntil: 'networkidle' })
    const notices = await p.locator('[data-testid=notices] [data-testid=notice]').evaluateAll((els) => els.map((el) => ({
      id: el.getAttribute('data-notice'),
      title: el.querySelector('h3')?.textContent ?? '',
      note: (el.querySelector('[data-testid=notice-note]') as HTMLElement | null)?.innerText ?? null,
      screens: el.querySelectorAll('[data-product-screen]').length,
    })))
    const partTitles = await p.locator('[data-testid=notice-part] h4').allInnerTexts()
    check(`${width}: Home shows the four examples in the new order (T-173), each with its screen`, JSON.stringify(notices.map((n) => n.id)) === JSON.stringify(['words', 'photos', 'extra', 'range']) && notices.every((n) => n.screens === (n.id === 'photos' ? 2 : 1)) && partTitles[1] === 'Model and size, read from a photo', notices.map((n) => n.title))
    check(`${width}: only the walls example carries the estimate line`, notices[1]!.note === note && notices.filter((n) => n.note).length === 1, notices[1]!.note)
    const sideways = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${width}: Home does not scroll sideways`, sideways <= 0, sideways)
    await p.locator('[data-testid=notices]').screenshot({ path: path.join(outDir, `home-notices-${width}.png`) })
    await ctx.close()
  }

  // --- the embed code a business already has, loaded from the previous address
  {
    // a service, so the form has something to ask about
    const svc = garageDoorsPackUS.services[0]!
    expectOk('service', await call('POST', `${app}/api/services`, {
      headers: twin.cookie,
      body: {
        name: svc.name, description: svc.description, documentTypeDefault: 'instant_estimate',
        scopeIncludes: svc.draft.scope.included, scopeExcludes: svc.draft.scope.excluded, defaultAssumptions: svc.draft.scope.assumptions,
        mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: svc.draft.media.photoGuidance, requiredAngles: [] },
        workSteps: svc.draft.pricing.workSteps, expectedSignals: svc.draft.expectedSignals,
        pricingRules: { baseFee: 0, minimumCharge: 0, addons: svc.addons, multipliers: svc.multipliers, workSteps: svc.draft.pricing.workSteps },
        draftConfig: svc.draft, autoSend: true,
      },
    }))
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' })
    await servePreviousAddressLocally(ctx)
    const snippet = embedSnippet({ appOrigin: oldOrigin, tenantKey, placement: 'inline', experience: 'form' })
    await ctx.route('http://business.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body><h1>Kent Painters</h1>${snippet}</body></html>` }))
    const redirected: string[] = []
    const p = await ctx.newPage()
    p.on('response', (res) => { if (res.status() >= 300 && res.status() < 400 && res.url().includes(OLD_HOST)) redirected.push(`${res.status()} ${res.url()}`) })
    await p.goto('http://business.example/')
    const frameEl = p.locator('#qolumns-widget iframe')
    await frameEl.waitFor({ timeout: 30_000 })
    const frame = p.frameLocator('#qolumns-widget iframe')
    await frame.locator('[data-testid=request-form]').waitFor({ timeout: 60_000 })
    const src = await frameEl.getAttribute('src')
    check('the embed code with the previous address still shows the form on a business’s website', src === `${oldOrigin}/embed/${tenantKey}`, src)
    await p.waitForFunction(() => parseInt((document.querySelector('#qolumns-widget iframe') as HTMLIFrameElement).style.height || '0', 10) > 250, null, { timeout: 20_000 }).catch(() => {})
    const height = await frameEl.evaluate((el) => (el as HTMLIFrameElement).style.height)
    check('the frame takes the form’s height: its message is accepted, which a redirect to another address would break', parseInt(height || '0', 10) > 250, height)
    check('nothing asked of the previous address was redirected', redirected.length === 0, redirected)
    await p.screenshot({ path: path.join(outDir, 'embed-from-previous-address.png') })
    // and a business's quote link opened on the previous address, as a customer would
    const q = await ctx.newPage()
    await q.goto(`${oldOrigin}/quote/${later}`, { waitUntil: 'networkidle' })
    await q.locator('[data-testid=request-form]').waitFor({ timeout: 60_000 })
    check('a quote link on the previous address opens the form, on that address', new URL(q.url()).host === OLD_HOST, q.url())
    await ctx.close()
  }
  await browser.close()
}

// =====================================================================================
/** Production, read-only. Nothing is submitted. */
async function live() {
  const dig = (type: string, name: string) => execFileSync('dig', ['+short', type, name, '@1.1.1.1'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const head = async (url: string) => {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 qolumns-live-check' } })
    return { status: res.status, location: res.headers.get('location'), server: res.headers.get('server'), text: res.status === 200 ? await res.text() : '' }
  }
  const CLOUDFLARE_PROXY = /^(104\.(1[6-9]|2[0-9]|3[01])\.|172\.(6[4-9]|7[01])\.)/

  section('L1. DNS')
  for (const name of [MAIN, ...domains.redirects]) {
    const a = dig('A', name)
    check(`${name} resolves, and not to Cloudflare’s proxy (the record is "DNS only")`, a.length > 0 && a.every((ip) => !CLOUDFLARE_PROXY.test(ip)), a)
  }
  const mx = dig('MX', MAIN)
  check(`${MAIN}: mail is received by Cloudflare Email Routing, and Namecheap’s forwarding records are gone`, mx.length > 0 && mx.every((r) => /route\d\.mx\.cloudflare\.net\.$/.test(r)), mx)
  const txt = dig('TXT', MAIN)
  const spf = txt.filter((t) => t.includes('v=spf1'))
  check(`${MAIN}: one SPF record, for Cloudflare Email Routing`, spf.length === 1 && spf[0]!.includes('include:_spf.mx.cloudflare.net') && !spf[0]!.includes('registrar-servers'), spf)
  check(`pm-bounces.${MAIN} points at Postmark (Return-Path)`, dig('CNAME', `pm-bounces.${MAIN}`).some((r) => r === 'pm.mtasv.net.'), dig('CNAME', `pm-bounces.${MAIN}`))
  const dkimHost = process.env.POSTMARK_DKIM_HOST
  if (dkimHost) {
    const dkim = dig('TXT', `${dkimHost}.${MAIN}`).join('')
    check(`the Postmark DKIM record resolves (${dkimHost}.${MAIN})`, /k=rsa/.test(dkim) && /p=/.test(dkim), dkim.slice(0, 40))
  } else notChecked.push('The Postmark DKIM record: set POSTMARK_DKIM_HOST to the name Postmark gave (for example 20261116123456pm._domainkey).')
  const dmarc = dig('TXT', `_dmarc.${MAIN}`)
  check(`_dmarc.${MAIN} has a DMARC policy`, dmarc.some((t) => t.includes('v=DMARC1')), dmarc)
  const otherMx = dig('MX', 'qolums.com')
  check('qolums.com: Namecheap’s parking mail records are gone', otherMx.every((r) => !r.includes('registrar-servers')), otherMx)

  section('L2. The four addresses')
  const mainPage = await head(`${NEW}/`)
  check(`${NEW}/ serves the app from Vercel`, mainPage.status === 200 && /vercel/i.test(mainPage.server ?? '') && mainPage.text.includes('Qolumns'), { status: mainPage.status, server: mainPage.server })
  for (const p of ['/login', '/demo', '/pricing']) check(`${NEW}${p} returns 200`, (await head(`${NEW}${p}`)).status === 200)
  for (const host of domains.redirects) {
    const r = await head(`https://${host}/pricing?plan=pro`)
    check(`https://${host} redirects permanently to ${MAIN}, path and query kept`, r.status === 308 && r.location === `${NEW}/pricing?plan=pro`, { status: r.status, location: r.location })
  }
  for (const host of [MAIN, ...domains.redirects]) {
    const r = await head(`http://${host}/pricing`)
    check(`http://${host} goes to https`, r.status >= 301 && r.status <= 308 && (r.location ?? '').startsWith('https://'), { status: r.status, location: r.location })
  }
  check('the home page builds its links on the new address', mainPage.text.includes(`${MAIN}/quote/`) && !mainPage.text.includes(`${OLD_HOST}/quote/`))

  section('L3. The previous address still works')
  const token = execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], { encoding: 'utf8' }).trim()
  const query = async (sql: string) => {
    const res = await fetch('https://api.supabase.com/v1/projects/ygsuzeveesgrafgpkrev/database/query', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })
    return (await res.json()) as Row[]
  }
  // a real quote link and its widget key (both public: they are on the business's link and in its embed code)
  const [real] = await query("SELECT t.slug, s.tenant_key FROM tenants t JOIN tenant_sites s ON s.tenant_id = t.id WHERE s.is_active ORDER BY t.created_at LIMIT 1")
  const OLD = `https://${OLD_HOST}`
  if (real) {
    const [oldQuote, newQuote] = [await head(`${OLD}/quote/${real.slug}`), await head(`${NEW}/quote/${real.slug}`)]
    check('a real quote link opens on the previous address (200, no redirect) and on the new one', oldQuote.status === 200 && oldQuote.location === null && newQuote.status === 200, [oldQuote.status, newQuote.status])
    check('the form the embed loads is served on the previous address', (await head(`${OLD}/embed/${real.tenant_key}`)).status === 200)
  } else notChecked.push('A real quote link: production has no business with an active site.')
  const loader = await head(`${OLD}/widget.js`)
  check('the embed script is served on the previous address (200, no redirect)', loader.status === 200 && loader.text.includes('QolumnsWidget'), loader.status)
  check('the public quote API on the previous address answers a made-up token itself (404)', (await head(`${OLD}/api/public/quotes/qte_madeup000000?token=madeup-token-000000000000000000000000`)).status === 404)

  section('L4. Settings')
  const authRes = await fetch('https://api.supabase.com/v1/projects/ygsuzeveesgrafgpkrev/config/auth', { headers: { Authorization: `Bearer ${token}` } })
  const auth = (await authRes.json()) as { site_url?: string; uri_allow_list?: string }
  const allowed = (auth.uri_allow_list ?? '').split(',').map((s) => s.trim())
  check('Supabase auth: Site URL is the new address', auth.site_url === NEW, auth.site_url)
  check('Supabase auth: the new and the previous address are both allowed redirect URLs', allowed.includes(`${NEW}/**`) && allowed.includes(`${OLD}/**`), allowed)
  // the production bucket, as the worker binds it
  const wrangler = readFileSync(path.join(ROOT, 'apps/worker/wrangler.toml'), 'utf8')
  const bucket = /\[\[env\.production\.r2_buckets\]\][^[]*?bucket_name = "([^"]+)"/.exec(wrangler)?.[1] ?? ''
  const cors = execFileSync('npx', ['wrangler', 'r2', 'bucket', 'cors', 'list', bucket], { cwd: path.join(ROOT, 'apps/worker'), encoding: 'utf8' })
  const origins = (/allowed_origins:\s*(.*)/.exec(cors)?.[1] ?? '').split(',').map((s) => s.trim())
  check('the storage bucket accepts uploads from both addresses', origins.includes(NEW) && origins.includes(OLD), origins)
  const workerHealth = await head('https://estimator-worker-production.billgajen.workers.dev/health')
  check('the worker responds on its health check', workerHealth.status === 200)

  section('L5. In a browser (GET only)')
  if (!process.env.PLAYWRIGHT_DIR) {
    notChecked.push('The browser section: PLAYWRIGHT_DIR is not set.')
    return
  }
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const held: string[] = []
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await ctx.addInitScript('globalThis.__name = (f) => f')
  await ctx.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.href.startsWith('http://business.example/')) return route.fallback()
    if (![NEW, OLD].includes(url.origin)) return route.abort()
    if (req.method() !== 'GET') {
      held.push(`${req.method()} ${url.pathname}`)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ skipped: true }) })
    }
    return route.continue()
  })
  const p = await ctx.newPage()
  await p.goto(`${NEW}/demo`, { waitUntil: 'networkidle' })
  await p.locator('[data-testid=step-bar]').waitFor({ timeout: 30_000 })
  check(`the demo form on ${MAIN} reads "Step 1 of 5" at 390`, (await p.locator('[data-testid=step-count]').first().innerText()).trim() === 'Step 1 of 5')
  await p.goto(`${NEW}/`, { waitUntil: 'networkidle' })
  const titles = await p.locator('[data-testid=notices] [data-testid=notice] h3').allInnerTexts()
  check('Home on the new address: the examples are in the new order', JSON.stringify(titles.slice(0, 2).concat(titles.slice(-2))) === JSON.stringify(['What your customer wrote', 'What the photos show', 'Something extra they mention', 'When it can’t tell, it asks']), titles)
  check('Home on the new address: "Megan G.", and the estimate line under the walls example', /megan g\./i.test(await p.locator('main').innerText()) && (await p.locator('[data-testid=notice-note]').innerText()).startsWith('It’s an estimate.'))
  if (real) {
    const snippet = embedSnippet({ appOrigin: OLD, tenantKey: String(real.tenant_key), placement: 'inline', experience: 'form' })
    await ctx.route('http://business.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${snippet}</body></html>` }))
    const site = await ctx.newPage()
    await site.goto('http://business.example/')
    const frameEl = site.locator('#qolumns-widget iframe')
    await frameEl.waitFor({ timeout: 30_000 })
    await site.frameLocator('#qolumns-widget iframe').locator('[data-testid=request-form]').waitFor({ timeout: 60_000 })
    await site.waitForFunction(() => parseInt((document.querySelector('#qolumns-widget iframe') as HTMLIFrameElement).style.height || '0', 10) > 250, null, { timeout: 20_000 }).catch(() => {})
    const height = await frameEl.evaluate((el) => (el as HTMLIFrameElement).style.height)
    check('embed code with the previous address still shows a real business’s form, at the form’s height', (await frameEl.getAttribute('src'))?.startsWith(`${OLD}/embed/`) === true && parseInt(height || '0', 10) > 250, height)
    await site.screenshot({ path: path.join(outDir, 'live-embed-previous-address.png') })
  }
  console.log(`Requests the pages tried to send that were not GET (answered in the browser, never sent): ${held.length ? held.join(', ') : 'none'}`)
  await browser.close()
}
