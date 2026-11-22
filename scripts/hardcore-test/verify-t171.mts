// T-171 live check: the customer's pages (the request form, the question,
// the quote page, accept), the billing page and three small leftovers.
// Run with the local stack, the web app and the worker up:
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t171.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// It makes one business with three of the templates' services, built the way
// setup builds them, and walks a customer through the real form in a browser
// at 360, 390 and 1440:
//   A (390)   a water heater request on the quote link page: the form's steps,
//             the photo list, the label read by the real pipeline, the one
//             plain question, the quote page, the business's approval, Accept
//             and "What happens next";
//   B (360, 1440)  an interior painting request: the form again at the
//             narrowest width and on a computer, and Accept under reduced
//             motion;
//   C         the three embed modes on another site (inline, floating,
//             iframe): the form works, shows the estimate itself when it is
//             ready, and opens nothing in a new tab;
// then the price panel in a dark, a light and a mid-tone business colour,
// a hand-set quote with a quantity measured from photos, the billing page
// against the public Pricing page, and the login, sign-up, header and footer.
//
// Test data uses made-up names.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { waterHeaterPackUS } from '../../apps/web/src/lib/vertical-packs/water-heater-us'
import { paintingPackUS } from '../../apps/web/src/lib/vertical-packs/painting-us'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { servicePayload } from '../../apps/web/src/lib/onboarding-service'
import { embedSnippet } from '../../apps/web/src/lib/embed-snippet'
import { findConfidenceLanguage } from '../../packages/shared/src/customer-language'
import { COMING_SOON, planCards, planLines, sitePlans } from '../../apps/web/src/lib/marketing/plan-claims'
import { offeredPlans } from '../../packages/shared/src/plans'
import { readableTextOn, contrastRatio } from '../../apps/web/src/lib/color'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t171-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)
const origin = new URL(cfg.appUrl).origin
const admin = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` }
const patch = (table: string, query: string, body: Record<string, unknown>) =>
  http('PATCH', `${cfg.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { ...admin, Prefer: 'return=representation' }, body })
const sha = (token: string) => createHash('sha256').update(token).digest('hex')
const ACCENT = [255, 197, 61] // our yellow: never on a customer's page
/** Words that are the engine's or the database's, never the customer's */
const ENGINE_WORDS = /Fixed quantity|Fixed price|Quantity provided|Under review|Ready to review|Awaiting info|Feedback received|\bViewed\b|passes|spread ±|→/

async function business(name: string) {
  const id = shortId()
  const email = `owner+t171-${id}@hardcore.test`
  const user = await sb.createUser(email, `Hardcore-${id}-Aa1!`, name)
  const session = await sb.signIn(email, `Hardcore-${id}-Aa1!`)
  const cookieHeader = sessionCookieHeader(cfg, session)
  const cookie = { Cookie: cookieHeader }
  const setup = await http('POST', `${cfg.appUrl}/api/auth/setup-tenant`, { headers: cookie, body: { businessName: name } })
  const tenantId = (setup.ok ? setup.json.tenantId : (await sb.select('user_profiles', `id=eq.${user.id}&select=tenant_id`))[0].tenant_id) as string
  expectOk('tenant', await http('PUT', `${cfg.appUrl}/api/tenant`, { headers: cookie, body: { region: 'US', currency: 'USD', taxEnabled: false, taxRate: 0, serviceAreaMode: 'none', serviceAreaValues: [] } }))
  const site = await sb.insert('tenant_sites', { tenant_id: tenantId, domain: 'localhost', tenant_key: `tkey_${shortId()}${shortId()}${shortId()}`, is_active: true })
  const slug = (await sb.select('tenants', `id=eq.${tenantId}&select=slug`))[0].slug as string
  return { cookie, cookieHeader, tenantId, tenantKey: site.tenant_key as string, name, slug }
}
type Biz = Awaited<ReturnType<typeof business>>
const serviceLike = (pack: { services: Array<{ name: string }> }, name: string) => pack.services.find((s) => s.name === name)! as unknown as Parameters<typeof servicePayload>[0]
/** A service made the way setup makes it, so the form asks the template's own questions and photos */
async function addService(biz: Biz, svc: Parameters<typeof servicePayload>[0]) {
  const created = expectOk(`service ${svc.name}`, await http('POST', `${cfg.appUrl}/api/services`, { headers: biz.cookie, body: servicePayload({ ...svc, addons: svc.addons ?? [], multipliers: svc.multipliers ?? [] }) }))
  return created.service.id as string
}
const setColour = async (biz: Biz, primaryColor: string) => {
  const current = ((await sb.select('tenants', `id=eq.${biz.tenantId}&select=branding_json`))[0].branding_json ?? {}) as Record<string, unknown>
  expectOk('colour', await patch('tenants', `id=eq.${biz.tenantId}`, { branding_json: { ...current, primaryColor } }))
}
type Row = Record<string, unknown>
const quoteRow = async (id: string) => (await sb.select('quotes', `id=eq.${id}&select=*`))[0] as Row & { status: string; pricing_json: { total: number; breakdown: Array<{ label: string; amount: number }> }; content_json: Row; signals_json: Row }
const approve = (biz: Biz, id: string) => http('POST', `${cfg.appUrl}/api/quotes/${id}/approve`, { headers: biz.cookie })

// ====================================================================
section('Setup: one business with three of the templates’ services')
// ====================================================================
const a = await business('Ridgeway Home Services')
await setColour(a, '#1D3557')
const heaterId = await addService(a, serviceLike(waterHeaterPackUS, 'Water Heater Replacement'))
const paintId = await addService(a, serviceLike(paintingPackUS, 'Interior Painting'))
await addService(a, serviceLike(garageDoorsPackUS, 'Garage Door Replacement'))
const config = expectOk('widget config', await http('GET', `${cfg.appUrl}/api/public/widget/config?tenantKey=${a.tenantKey}`))
const fieldsOf = (id: string) => [...(config.globalFields ?? []), ...((config.serviceFields ?? {})[id] ?? [])] as Array<{ fieldId: string; type: string; label: string; required: boolean; options?: unknown[] }>
check('(the form has three services, each with its own questions)', config.services.length === 3 && fieldsOf(heaterId).length > 0 && fieldsOf(paintId).length > 0, config.services.map((s: { name: string }) => s.name))
// T-172: every one of the three has questions, so the form knows its number of steps before a service is chosen
const everyServiceAsks = (config.services as Array<{ id: string }>).every((s) => fieldsOf(s.id).length > 0)
check('(every service has questions of its own, so the first step can say how many steps there are)', everyServiceAsks, (config.services as Array<{ id: string; name: string }>).map((s) => `${s.name}: ${fieldsOf(s.id).length}`))
const heaterAngles = (config.services.find((s: { id: string }) => s.id === heaterId).mediaConfig.requiredAngles ?? []) as Array<{ id: string; label: string }>
check('(the water heater service lists the photos that help: the rating label and the whole heater)', heaterAngles.length === 2, heaterAngles.map((x) => x.label))
const LABEL = path.join(ROOT, 'apps/web/public/demo/sample-water-heater-label.png')
const ROOM = path.join(ROOT, 'apps/web/public/demo/sample-room-to-paint.webp')

if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Everything: this script is a browser pass. Set PLAYWRIGHT_DIR to run it.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium, PNG } = browserDeps()
  const browser = await chromium.launch()
  type Ctx = Awaited<ReturnType<typeof browser.newContext>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  const contextFor = async (width: number, opts: { reduced?: boolean; cookie?: string } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 780 : 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' })
    await ctx.addInitScript('globalThis.__name = (f) => f')
    if (opts.cookie) {
      await ctx.addCookies(opts.cookie.split('; ').map((pair) => { const i = pair.indexOf('='); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: origin } }))
    }
    return ctx
  }
  const shot = (p: Page, name: string, fullPage = true) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage })
  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  /** The page as painted with its words taken out, to read what each word sits on */
  const painted = async (p: Page) => {
    const tag = await p.addStyleTag({ content: '* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important }' })
    const png = PNG.sync.read(await p.screenshot({ fullPage: true })) as { width: number; height: number; data: Buffer }
    await tag.evaluate((el) => el.remove())
    return png
  }
  /** The lowest contrast between an element's text colour and any pixel under its lines of text */
  const worst = async (p: Page, png: { width: number; height: number; data: Buffer }, selector: string, nth = 0) => {
    const lines = await p.evaluate(([sel, n]) => {
      const el = document.querySelectorAll(sel as string)[n as number] as HTMLElement | undefined
      if (!el) return null
      const range = document.createRange()
      range.selectNodeContents(el)
      const m = (getComputedStyle(el).color.match(/[\d.]+/g) ?? []).map(Number)
      return { rects: [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2).map((r) => ({ x: Math.floor(r.left), y: Math.floor(r.top + scrollY), w: Math.ceil(r.width), h: Math.ceil(r.height) })), colour: [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0], size: parseFloat(getComputedStyle(el).fontSize), text: el.innerText.slice(0, 40) }
    }, [selector, nth] as const)
    if (!lines || lines.rects.length === 0) return null
    const text = lum(lines.colour[0]!, lines.colour[1]!, lines.colour[2]!)
    let low = Infinity
    for (const r of lines.rects) for (let y = Math.max(0, r.y); y < Math.min(png.height, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(png.width, r.x + r.w); x++) {
      const i = (y * png.width + x) * 4
      const c = ratio(text, lum(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!))
      if (c < low) low = c
    }
    return { ratio: Math.round(low * 100) / 100, size: lines.size, text: lines.text }
  }
  /** Anything on the page painted in our accent yellow */
  const accentOn = (p: Page) => p.evaluate((accent) => [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el)
    return [cs.backgroundColor, cs.color, cs.borderTopColor].some((c) => { const m = (c.match(/[\d.]+/g) ?? []).map(Number); return m.length >= 3 && m[0] === accent[0] && m[1] === accent[1] && m[2] === accent[2] && (m[3] === undefined || m[3] > 0) })
  }).length, ACCENT)
  const pageWords = async (p: Page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ')
  const sideways = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  /** Choose a file through the picker that a click opens */
  const pick = async (p: Page, click: () => Promise<void>, file: string | null) => {
    const chooser = p.waitForEvent('filechooser', { timeout: 10_000 })
    await click()
    const fc = await chooser
    if (file) await fc.setFiles(file)
  }
  /** What the form looks like at this step */
  const formState = (p: Page) => p.evaluate(() => {
    const q = (sel: string) => document.querySelector(sel) as HTMLElement | null
    const card = q('[data-testid=form-card]')!.getBoundingClientRect()
    const compact = q('[data-testid=step-bar-compact]')
    const full = q('[data-testid=step-bar-full]')
    const shown = (el: HTMLElement | null) => !!el && el.getBoundingClientRect().height > 0
    const fullLabels = full ? [...full.querySelectorAll('[data-testid=step-label]')].map((s) => { const r = s.getBoundingClientRect(); const box = full.getBoundingClientRect(); return { text: (s as HTMLElement).innerText, inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5, cut: (s as HTMLElement).scrollWidth > (s as HTMLElement).clientWidth + 1 } }) : []
    return {
      heading: q('[data-testid=form-heading]')?.tagName ?? null,
      headingText: q('[data-testid=form-heading]')?.innerText.replace(/\s+/g, ' ') ?? '',
      h1s: document.querySelectorAll('h1').length,
      title: q('[data-testid=step-title]')?.innerText ?? '',
      titleTag: q('[data-testid=step-title]')?.tagName ?? '',
      card: { left: Math.round(card.left), right: Math.round(card.right), radius: getComputedStyle(q('[data-testid=form-card]')!).borderTopLeftRadius, border: getComputedStyle(q('[data-testid=form-card]')!).borderTopWidth, shadow: getComputedStyle(q('[data-testid=form-card]')!).boxShadow },
      compact: shown(compact) ? { count: q('[data-testid=step-count]')!.innerText, name: q('[data-testid=step-name]')!.innerText, fits: compact!.scrollWidth <= compact!.clientWidth + 1 } : null,
      full: shown(full) ? fullLabels : null,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  // ====================================================================
  section('A. A water heater request on the quote link page, at 390')
  // ====================================================================
  let heaterQuote: { id: string; token: string } | null = null
  {
    const width = 390
    const ctx = await contextFor(width)
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
    const popups: string[] = []
    ctx.on('page', (np) => { if (np !== p) popups.push(np.url()) })
    // T-199: a business on the free start works like Pro, which has no "Powered by" line on its form and no
    // "Prepared with" line on its quote. Both are checked here for a business on a plan that keeps them
    // (Starter); the row is taken away again after the quote page's check.
    await sb.insert('subscriptions', { tenant_id: a.tenantId, plan_id: 'plan_us_starter', status: 'active' })
    await p.goto(`${cfg.appUrl}/quote/${a.slug}`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'Water Heater Replacement', exact: true }).waitFor({ timeout: 30_000 })
    let f = await formState(p)
    check(`${width} form: the quote link page has a real h1, the business's name`, f.heading === 'H1' && f.h1s === 1 && f.headingText.includes(a.name), { tag: f.heading, text: f.headingText })
    check(`${width} form: it runs edge to edge: no floating card (no side margin, corner, edge or shadow) and nothing scrolls sideways`, f.card.left === 0 && f.card.right === width && f.card.radius === '0px' && f.card.border === '0px' && f.card.shadow === 'none' && f.sideways <= 0, f.card)
    const below = await p.evaluate(() => { const b = getComputedStyle(document.querySelector('[data-testid=request-form]')!).backgroundColor; return b })
    check(`${width} form: the page under it is the form's own white, not a strip of empty paper`, below === 'rgb(255, 255, 255)', below)
    await shot(p, `form-1-service-${width}`)
    // T-172: the first step counts the Questions step too, because every service has one (it read "Step 1 of 4")
    check(`${width} form: the first step reads "Step 1 of 5", the total the next step shows`, !!f.compact && f.compact.count === 'Step 1 of 5' && f.compact.name === 'Service' && f.compact.fits && f.full === null, f.compact)
    await p.getByRole('button', { name: 'Water Heater Replacement', exact: true }).click()

    // contact
    await p.getByText('Where should we send your estimate?').waitFor({ timeout: 15_000 })
    f = await formState(p)
    check(`${width} form: the step bar is one line that fits, "Step 2 of 5" with the step's name, and no label is cut`, !!f.compact && f.compact.count === 'Step 2 of 5' && f.compact.name === 'Contact' && f.compact.fits && f.full === null, f.compact)
    check(`${width} form: a step's title is an h2 under the page's h1`, f.titleTag === 'H2' && f.title === 'Where should we send your estimate?', f.titleTag)
    const marks = await p.locator('[data-testid=required-mark]').allInnerTexts()
    const asterisks = await p.locator('label, p').evaluateAll((els) => els.filter((el) => /\*\s*$/.test((el as HTMLElement).innerText)).length)
    check(`${width} form: a required field says "(required)" in words; none is marked with an asterisk alone`, marks.length >= 2 && marks.every((m) => m.trim() === '(required)') && asterisks === 0, { marks: marks.length, asterisks })
    const pb = await worst(p, await painted(p), '[data-testid=powered-by] span')
    check(`${width} form: "Powered by Qolumns" is readable: ${pb?.size} px at ${pb?.ratio}:1`, !!pb && pb.size >= 12 && pb.ratio >= 4.5 && pb.text.includes('Powered by Qolumns'), pb)
    await p.getByLabel('Your name').fill('Marta Okafor')
    await p.getByLabel('Email').fill('marta.okafor@example.com')
    await p.getByLabel('Phone').fill('(555) 201-1212')
    await shot(p, `form-2-contact-${width}`)
    await p.getByRole('button', { name: 'Continue' }).click()

    // questions
    await p.getByText('About the job').waitFor({ timeout: 15_000 })
    const qs = await p.locator('[data-testid=question]').evaluateAll((els) => els.map((el) => ({ kind: el.getAttribute('data-kind'), rows: [...el.querySelectorAll('[data-testid=tap-row]')].map((r) => Math.round(r.getBoundingClientRect().height)), selectOptions: el.querySelector('select') ? el.querySelectorAll('select option').length - 1 : 0 })))
    check(`${width} form: a question with two to five choices is large rows to tap (44 px or taller), not a native picker`, qs.length >= 1 && qs.some((q) => q.kind === 'rows') && qs.filter((q) => q.kind === 'rows').every((q) => q.rows.length >= 2 && q.rows.length <= 5 && q.rows.every((h) => h >= 44)) && qs.every((q) => q.selectOptions === 0 || q.selectOptions > 5), qs)
    for (const group of await p.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').first().click()
    for (const input of await p.locator('main input[type=number]:visible, [data-testid=request-form] input[type=number]:visible').all()) if (!(await input.inputValue())) await input.fill('2')
    for (const select of await p.locator('[data-testid=request-form] select:visible').all()) if (!(await select.inputValue())) await select.selectOption({ index: 1 })
    await shot(p, `form-3-questions-${width}`)
    await p.getByRole('button', { name: 'Continue' }).click()

    // photos
    await p.getByText('Photos & Documents').waitFor({ timeout: 15_000 })
    const lead = (await p.locator('[data-testid=photo-list-lead]').innerText()).replace(/\s+/g, ' ')
    const photoWords = await pageWords(p)
    check(`${width} photos: the list says what helps, and nothing implies we checked what a photo shows`, /^Photos that help\. Tap one to add it \(0 of 2 added\):$/.test(lead) && !/accurate|verified|we checked|we need these|confirmed|looks good|✓/i.test(photoWords), lead)
    const items = () => p.locator('[data-testid=photo-item]').evaluateAll((els) => els.map((el) => ({ label: (el as HTMLElement).innerText.replace(/\s+/g, ' ').slice(0, 60), filled: el.getAttribute('data-filled') === 'true' })))
    const previews = () => p.locator('[data-testid=request-form] img[src^="blob:"]').count()
    // 1. tap an item, then leave the picker without choosing
    await pick(p, () => p.locator('[data-testid=photo-item]').nth(1).click(), null)
    // 2. add a photo with the general Add: it counts toward the total, and marks no item
    await pick(p, () => p.locator('[data-testid=add-photo]').click(), ROOM)
    await p.waitForFunction(() => document.querySelectorAll('[data-testid=request-form] img[src^="blob:"]').length >= 1, undefined, { timeout: 20_000 })
    await p.waitForTimeout(2500)
    const afterGeneral = await items()
    const totalText = (await pageWords(p)).match(/(\d+) of \d+ photos/)?.[1]
    check(`${width} photos: a photo added without picking an item counts toward the total and ticks no item (even after an item's picker was opened and left)`, afterGeneral.every((i) => !i.filled) && totalText === '1' && /\(0 of 2 added\)/.test((await p.locator('[data-testid=photo-list-lead]').innerText())), { items: afterGeneral, total: totalText })
    // 3. tap the label's item and add the label: that item, and only that one, is ticked
    await pick(p, () => p.locator('[data-testid=photo-item]').nth(0).click(), LABEL)
    await p.waitForFunction(() => document.querySelector('[data-testid=photo-item]')?.getAttribute('data-filled') === 'true', undefined, { timeout: 20_000 })
    await p.waitForTimeout(2500)
    const afterItem = await items()
    check(`${width} photos: an item is ticked when the customer taps it and adds a photo for it, and only that item`, afterItem[0]!.filled && /Photo added/.test(afterItem[0]!.label) && !afterItem[1]!.filled && (await previews()) >= 2 && /\(1 of 2 added\)/.test(await p.locator('[data-testid=photo-list-lead]').innerText()), afterItem)
    await shot(p, `form-4-photos-${width}`)
    await p.getByRole('button', { name: 'Continue' }).click()

    // last step, and send
    await p.getByText('Last step').waitFor({ timeout: 15_000 })
    f = await formState(p)
    check(`${width} form: the last step reads "Step 5 of 5"`, f.compact?.count === 'Step 5 of 5' && f.compact.fits, f.compact)
    await p.getByLabel('ZIP code').fill('63021')
    await shot(p, `form-5-last-${width}`)
    await p.getByRole('button', { name: 'Get my estimate' }).click()

    // the finished screen moves straight on, in this tab: the question when there is one
    await p.waitForURL(/\/q\/qte_[^/]+(\/clarify)?\?token=/, { timeout: 300_000 })
    const landed = new URL(p.url())
    const quoteId = landed.pathname.split('/')[2]!
    heaterQuote = { id: quoteId, token: landed.searchParams.get('token')! }
    check(`${width} finished: the customer is moved straight into it, in the same tab (no new tab was opened)`, popups.length === 0 && ctx.pages().length === 1 && landed.origin === origin, { popups, at: landed.pathname })

    if (landed.pathname.endsWith('/clarify')) {
      await p.locator('[data-testid=question-text]').first().waitFor({ timeout: 30_000 })
      const question = (await p.locator('[data-testid=question-text]').first().innerText()).replace(/\s+/g, ' ')
      const words = await pageWords(p)
      check(`${width} question: one plain sentence: "${question}"`, /^We read .+ from your .+\. Is that right\?$/.test(question), question)
      check(`${width} question: no "What we saw", no words read off the label, no arrow, nothing of how it was read`, !/What we saw|Read from|CAPACITY|MODEL NO|→|photo \d|printed on the label/i.test(words), words.slice(0, 160))
      check(`${width} question: it is about an estimate, not a quote, and carries none of the words a customer never sees`, /about your estimate/.test(words) && !/your quote/i.test(words) && findConfidenceLanguage(words).length === 0, findConfidenceLanguage(words))
      const yes = await p.locator('[data-testid=answer-yes]').first().evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), text: (el as HTMLElement).innerText }))
      check(`${width} question: the answers are 44 px or taller, and nothing scrolls sideways`, yes.h >= 44 && (await sideways(p)) <= 0, yes)
      await shot(p, `question-${width}`)
      await p.locator('[data-testid=answer-yes]').first().click()
      await p.getByRole('button', { name: /send my answer/i }).click()
      await p.waitForURL(/\/q\/qte_[^/]+\?token=/, { timeout: 60_000 })
    } else {
      check(`${width} question: the pipeline asked the customer to confirm the label reading`, false, 'no question was asked on this run')
    }
    await pollQuote(cfg, heaterQuote.id, heaterQuote.token)
    const row = await quoteRow(heaterQuote.id)
    check('(real pipeline) the water heater request was priced from the business’s prices', row.pricing_json.total > 0 && ['pending_review', 'sent', 'viewed'].includes(row.status), { status: row.status, total: row.pricing_json.total })

    // the quote page, before the business confirms
    await p.goto(`${cfg.appUrl}/q/${heaterQuote.id}?token=${heaterQuote.token}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=what-was-read]').waitFor({ timeout: 60_000 }).catch(() => undefined)
    const quotePage = async () => p.evaluate(() => {
      const text = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ') ?? ''
      return {
        all: document.body.innerText.replace(/\s+/g, ' '),
        read: [...document.querySelectorAll('[data-testid=read-line]')].map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ')),
        readBlock: text('[data-testid=what-was-read]'),
        pills: [...document.querySelectorAll('span')].filter((s) => /^(Viewed|Under review|Ready to review|Preparing|Awaiting info|Updated|Feedback received|Received)$/.test((s as HTMLElement).innerText.trim())).length,
        prepared: text('[data-testid=prepared-with]'),
      }
    })
    let q = await quotePage()
    check(`${width} quote: no status pill ("Viewed", "Under review"); the line under the price says where it stands`, q.pills === 0 && /will review and confirm it|Reviewed and confirmed by/.test(q.all), q.pills)
    check(`${width} quote: what was read is in the customer's terms, and only that: ${JSON.stringify(q.read)}`, q.read.length >= 1 && q.read.some((l) => /^From your tank's rating label: 50 gal/.test(l)) && q.read.every((l) => !/[$£€]\s?\d/.test(l) && !ENGINE_WORDS.test(l) && findConfidenceLanguage(l).length === 0), q.read)
    check(`${width} quote: "Measurement & takeoff" carries no amount, no rate and no engine word`, /Measurement & takeoff/i.test(q.readBlock) && !/[$£€]\s?\d|×|\/gal|Fixed quantity|Selected for/.test(q.readBlock), q.readBlock.slice(0, 200))
    const lineLabels = row.pricing_json.breakdown.map((l) => l.label.split(/[:(]/)[0]!.trim()).filter((l) => l.length > 3 && !/minimum/i.test(l))
    const repeats = lineLabels.map((label) => ({ label, times: q.all.split(label).length - 1 }))
    check(`${width} quote: each price line appears once on the page (the breakdown is not repeated)`, repeats.length > 0 && repeats.every((r) => r.times === 1), repeats)
    check(`${width} quote: nothing of the engine's or the database's, none of the words a customer never sees, none of our yellow, nothing sideways`, !ENGINE_WORDS.test(q.all) && findConfidenceLanguage(q.all).length === 0 && (await accentOn(p)) === 0 && (await sideways(p)) <= 0, { engine: q.all.match(ENGINE_WORDS)?.[0], language: findConfidenceLanguage(q.all), accent: await accentOn(p) })
    const prepared = await worst(p, await painted(p), '[data-testid=prepared-with]')
    check(`${width} quote: "Prepared with Qolumns" is readable: ${prepared?.size} px at ${prepared?.ratio}:1`, !!prepared && prepared.size >= 12 && prepared.ratio >= 4.5, prepared)
    await fetch(`${cfg.supabaseUrl}/rest/v1/subscriptions?tenant_id=eq.${a.tenantId}`, { method: 'DELETE', headers: admin })
    await shot(p, `quote-estimate-${width}`)

    // the business confirms it; the customer accepts
    if (row.status === 'pending_review') expectOk('approve', await approve(a, heaterQuote.id))
    await p.goto(`${cfg.appUrl}/q/${heaterQuote.id}?token=${heaterQuote.token}`, { waitUntil: 'networkidle' })
    const acceptButton = p.getByRole('button', { name: /^Accept this quote/ })
    await acceptButton.waitFor({ timeout: 30_000 })
    q = await quotePage()
    check(`${width} quote: once the business has confirmed it, it reads as a quote (T-146), still with no status pill`, /Your quote/i.test(q.all) && /Reviewed and confirmed by Ridgeway Home Services/.test(q.all) && q.pills === 0, q.all.slice(0, 120))
    await shot(p, `quote-confirmed-${width}`)
    await p.evaluate(() => window.scrollTo(0, 0))
    await acceptButton.scrollIntoViewIfNeeded()
    await acceptButton.click()
    await p.locator('[data-testid=accept-details]').waitFor({ timeout: 10_000 })
    await p.waitForTimeout(900)
    const form = await p.evaluate(() => {
      const el = document.querySelector('[data-testid=accept-details]')!
      const r = el.getBoundingClientRect()
      const first = el.querySelector('input')
      const edge = (input: Element) => { const m = (getComputedStyle(input).borderTopColor.match(/[\d.]+/g) ?? []).map(Number); return m.slice(0, 3) }
      return { top: Math.round(r.top), inView: r.top >= 0 && r.top < innerHeight * 0.5, focused: document.activeElement === first, firstType: first?.getAttribute('type'), edges: [...el.querySelectorAll('input[type=text], input[type=tel]')].map(edge), heights: [...el.querySelectorAll('input[type=text], input[type=tel], label:has(input[type=radio]), button')].map((x) => Math.round(x.getBoundingClientRect().height)) }
    })
    check(`${width} accept: the form scrolls into view and its first field has the focus`, form.inView && form.focused, { top: form.top, focused: form.focused })
    const edgeRatios = form.edges.map((c) => Math.round(ratio(lum(c[0]!, c[1]!, c[2]!), lum(255, 255, 255)) * 100) / 100)
    check(`${width} accept: its fields have an edge that can be seen (3:1 or better) and everything in it is 44 px or taller`, edgeRatios.length === 3 && edgeRatios.every((r) => r >= 3) && form.heights.every((h) => h >= 44), { edgeRatios, heights: form.heights })
    await shot(p, `accept-form-${width}`, false)
    await p.locator('[data-testid=accept-details] label:has(input[type=radio])').nth(1).click()
    await p.getByLabel('Address of the job').fill('14 Larch Lane, Ballwin, MO 63021')
    await p.getByLabel('Best phone number').fill('(555) 201-1212')
    await p.getByRole('button', { name: 'Confirm and accept' }).click()
    await p.locator('[data-testid=accepted]').waitFor({ timeout: 30_000 })
    const moving = await p.evaluate(() => {
      const el = document.querySelector('[data-testid=accepted]')!
      const cs = getComputedStyle(el)
      return { just: el.getAttribute('data-just-accepted'), name: cs.animationName, ms: Math.round(parseFloat(cs.animationDuration) * 1000), count: cs.animationIterationCount }
    })
    check(`${width} accept: accepting gets one short confirmation: one entrance of ${moving.ms} ms (200 to 300), played once`, moving.just === 'true' && moving.name !== 'none' && moving.ms >= 200 && moving.ms <= 300 && moving.count === '1', moving)
    await p.waitForTimeout(500)
    const next = await p.locator('[data-testid=next-step]').allInnerTexts()
    const nextWords = next.join(' | ').replace(/\s+/g, ' ')
    check(`${width} accept: "What happens next" in three steps: they get in touch, a time for the visit or booking, the job`, next.length === 3 && /Ridgeway Home Services gets in touch/.test(next[0]!) && /\(555\) 201-1212/.test(next[0]!) && /agree a time/.test(next[1]!) && /visit or to book the job/.test(next[1]!) && /within the next two weeks/.test(next[1]!) && /^3?\s*The job/m.test(next[2]!.trim()) && findConfidenceLanguage(nextWords).length === 0, next)
    check(`${width} accept: it says "Quote accepted", with none of our yellow`, /Quote accepted/.test(await pageWords(p)) && (await accentOn(p)) === 0)
    await shot(p, `quote-accepted-${width}`)
    const stored = await quoteRow(heaterQuote.id)
    check('AD-001: accepting changed no price; the quote is accepted', stored.status === 'accepted' && stored.pricing_json.total === row.pricing_json.total, { status: stored.status, total: stored.pricing_json.total })
    check(`${width}: no error on the customer's pages`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ====================================================================
  section('B. An interior painting request, at 360 and at 1440')
  // ====================================================================
  let paintQuote: { id: string; token: string } | null = null
  for (const width of [360, 1440]) {
    const ctx = await contextFor(width, { reduced: width === 360 })
    const p = await ctx.newPage()
    const popups: string[] = []
    ctx.on('page', (np) => { if (np !== p) popups.push(np.url()) })
    await p.goto(`${cfg.appUrl}/quote/${a.slug}`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'Interior Painting', exact: true }).waitFor({ timeout: 30_000 })
    let f = await formState(p)
    if (width < 640) check(`${width} form: edge to edge, with a real h1 and nothing sideways`, f.heading === 'H1' && f.card.left === 0 && f.card.right === width && f.card.radius === '0px' && f.sideways <= 0, f.card)
    else check(`${width} form: on a computer it is the card on paper it was, with a real h1`, f.heading === 'H1' && f.card.left > 0 && f.card.radius !== '0px' && f.card.shadow !== 'none' && f.sideways <= 0, f.card)
    // T-172: step 1 shows the same number of steps as step 2 will
    const firstStep = f
    if (width < 640) check(`${width} form: the first step reads "Step 1 of 5"`, f.compact?.count === 'Step 1 of 5' && f.compact.name === 'Service' && f.compact.fits, f.compact)
    else check(`${width} form: the first step's bar already shows all five steps, Questions among them`, !!f.full && f.full.map((l) => l.text.toLowerCase()).join(',') === 'service,contact,questions,photos,details' && f.full.every((l) => l.inside && !l.cut), f.full?.map((l) => l.text))
    await p.getByRole('button', { name: 'Interior Painting', exact: true }).click()
    await p.getByText('Where should we send your estimate?').waitFor({ timeout: 15_000 })
    f = await formState(p)
    if (width < 640) check(`${width} form: the step bar fits at ${width}: "${f.compact?.count}", "${f.compact?.name}"`, !!f.compact && /^Step 2 of \d$/.test(f.compact.count) && f.compact.fits && f.sideways <= 0, f.compact)
    else check(`${width} form: the step bar shows every step's label, whole and inside the form`, !!f.full && f.full.length >= 4 && f.full.every((l) => l.inside && !l.cut) && f.compact === null, f.full?.map((l) => l.text))
    check(`${width} form: the number of steps did not change between the first step and the second`, width < 640 ? firstStep.compact?.count.replace('Step 1', 'Step 2') === f.compact?.count : firstStep.full?.length === f.full?.length, width < 640 ? [firstStep.compact?.count, f.compact?.count] : [firstStep.full?.length, f.full?.length])
    await p.getByLabel('Your name').fill('Dev Raman')
    await p.getByLabel('Email').fill('dev.raman@example.com')
    await p.getByLabel('Phone').fill('(555) 201-3434')
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('About the job').waitFor({ timeout: 15_000 })
    const qs = await p.locator('[data-testid=question]').evaluateAll((els) => els.map((el) => ({ kind: el.getAttribute('data-kind'), label: (el.querySelector('p') as HTMLElement).innerText.replace(/\s+/g, ' '), rows: [...el.querySelectorAll('[data-testid=tap-row]')].map((r) => Math.round(r.getBoundingClientRect().height)) })))
    check(`${width} form: the ceiling height question (two choices) is rows to tap, each 44 px or taller, and required questions say so in words`, qs.some((q) => q.kind === 'rows' && q.rows.length >= 2 && q.rows.length <= 5 && q.rows.every((h) => h >= 44)) && qs.some((q) => /\(required\)$/.test(q.label)) && (await p.locator('[data-testid=request-form] select').count()) === 0, qs)
    for (const input of await p.locator('[data-testid=request-form] input[type=number]:visible').all()) if (!(await input.inputValue())) await input.fill('2')
    for (const group of await p.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').first().click()
    if (width === 1440) await shot(p, `form-3-questions-${width}`)
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('Photos & Documents').waitFor({ timeout: 15_000 })
    // this template asks for one photo: the customer taps the first item and adds a room
    check(`${width} photos: Continue waits for the photo the business asks for`, await p.getByRole('button', { name: 'Continue' }).isDisabled())
    await pick(p, () => p.locator('[data-testid=photo-item]').first().click(), ROOM)
    await p.waitForFunction(() => document.querySelector('[data-testid=photo-item]')?.getAttribute('data-filled') === 'true', undefined, { timeout: 20_000 })
    await p.getByRole('button', { name: 'Continue' }).waitFor({ state: 'visible' })
    await p.waitForFunction(() => !([...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Continue') as HTMLButtonElement).disabled, undefined, { timeout: 30_000 })
    if (width === 1440) await shot(p, `form-4-photos-${width}`)
    await p.getByRole('button', { name: 'Continue' }).click()
    await p.getByText('Last step').waitFor({ timeout: 15_000 })
    await p.getByLabel('ZIP code').fill('63021')
    await p.getByRole('button', { name: 'Get my estimate' }).click()
    await p.waitForURL(/\/q\/qte_[^/]+(\/clarify)?\?token=/, { timeout: 300_000 })
    const landed = new URL(p.url())
    const id = landed.pathname.split('/')[2]!
    const token = landed.searchParams.get('token')!
    check(`${width} finished: moved straight into the estimate, in the same tab`, popups.length === 0 && ctx.pages().length === 1, landed.pathname)
    await pollQuote(cfg, id, token)
    const row = await quoteRow(id)
    check(`(real pipeline) ${width}: two rooms priced from the template's own rates ($75 + 2 × $375 = $825)`, row.pricing_json.total === 825, row.pricing_json.total)
    await p.goto(`${cfg.appUrl}/q/${id}?token=${token}`, { waitUntil: 'networkidle' })
    await p.getByText('Price breakdown').waitFor({ timeout: 60_000 })
    const words = await pageWords(p)
    check(`${width} quote: nothing was read from a photo for this request, so there is no "Measurement & takeoff" block at all, and no status pill`, (await p.locator('[data-testid=what-was-read]').count()) === 0 && !/Measurement & takeoff/i.test(words) && !ENGINE_WORDS.test(words) && findConfidenceLanguage(words).length === 0 && (await sideways(p)) <= 0, words.match(ENGINE_WORDS)?.[0])
    if (width === 1440) await shot(p, `quote-estimate-${width}`)
    if (width === 360) {
      // accept under reduced motion: nothing moves
      if (row.status === 'pending_review') expectOk('approve', await approve(a, id))
      await p.goto(`${cfg.appUrl}/q/${id}?token=${token}`, { waitUntil: 'networkidle' })
      await p.getByRole('button', { name: /^Accept this quote/ }).click()
      await p.locator('[data-testid=accept-details]').waitFor({ timeout: 10_000 })
      await p.waitForTimeout(400)
      const form = await p.evaluate(() => { const el = document.querySelector('[data-testid=accept-details]')!; const r = el.getBoundingClientRect(); return { inView: r.top >= 0 && r.top < innerHeight * 0.5, focused: document.activeElement === el.querySelector('input'), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth } })
      check(`${width} accept: at the narrowest width the form is in view, focused, and nothing scrolls sideways`, form.inView && form.focused && form.sideways <= 0, form)
      await p.locator('[data-testid=accept-details] label:has(input[type=radio])').first().click()
      await p.getByLabel('Address of the job').fill('9 Alder Court, Ballwin, MO 63021')
      await p.getByLabel('Best phone number').fill('(555) 201-3434')
      await p.getByRole('button', { name: 'Confirm and accept' }).click()
      await p.locator('[data-testid=accepted]').waitFor({ timeout: 30_000 })
      const moving = await p.evaluate(() => { const cs = getComputedStyle(document.querySelector('[data-testid=accepted]')!); return { ms: parseFloat(cs.animationDuration) * 1000, name: cs.animationName } })
      check(`${width} accept: under reduced motion the confirmation does not move`, moving.ms <= 1 || moving.name === 'none', moving)
      check(`${width} accept: the three steps are there all the same`, (await p.locator('[data-testid=next-step]').count()) === 3)
    } else {
      paintQuote = { id, token }
    }
    await ctx.close()
  }

  // ====================================================================
  section('C. The three embed modes, on another site')
  // ====================================================================
  {
    let hostBody = ''
    const hostServer = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Kestrel Painters</title></head><body><h1>Kestrel Painters</h1>${hostBody}</body></html>`) })
    await new Promise<void>((resolve) => hostServer.listen(0, '127.0.0.1', resolve))
    const HOST = `http://127.0.0.1:${(hostServer.address() as AddressInfo).port}`
    const modes: Array<{ mode: 'inline' | 'floating' | 'iframe'; width: number }> = [{ mode: 'inline', width: 1440 }, { mode: 'floating', width: 390 }, { mode: 'iframe', width: 390 }]
    for (const { mode, width } of modes) {
      const ctx = await contextFor(width)
      const p = await ctx.newPage()
      const popups: string[] = []
      ctx.on('page', (np) => { if (np !== p) popups.push(np.url()) })
      hostBody = mode === 'iframe'
        ? `<iframe id="plain" src="${origin}/embed/${a.tenantKey}" style="width:100%;height:1500px;border:0"></iframe>`
        : embedSnippet({ appOrigin: origin, tenantKey: a.tenantKey, placement: mode, experience: 'form' })
      await p.goto(`${HOST}/`)
      if (mode === 'floating') await p.locator('#qolumns-floating-launcher').click({ timeout: 20_000 })
      const frame = p.frameLocator(mode === 'iframe' ? '#plain' : mode === 'inline' ? '#qolumns-widget iframe' : '#qolumns-floating-overlay iframe')
      // the page may be shown before it answers a tap: tap again until the next step is there
      await frame.getByRole('button', { name: 'Interior Painting', exact: true }).waitFor({ timeout: 40_000 })
      for (let attempt = 0; attempt < 6 && (await frame.getByText('Where should we send your estimate?').count()) === 0; attempt++) {
        await frame.getByRole('button', { name: 'Interior Painting', exact: true }).click({ timeout: 5_000 }).catch(() => undefined)
        await p.waitForTimeout(1500)
      }
      await frame.getByText('Where should we send your estimate?').waitFor({ timeout: 20_000 })
      const head = await frame.locator('[data-testid=form-heading]').evaluate((el) => ({ tag: el.tagName, title: document.querySelector('[data-testid=step-title]')?.tagName }))
      check(`${mode}: inside another site's page the business's name is an h2 (the page has its own h1) and a step's title an h3`, head.tag === 'H2' && head.title === 'H3', head)
      await frame.getByLabel('Your name').fill('Wanda Pemberton')
      await frame.getByLabel('Email').fill('wanda.pemberton@example.com')
      await frame.getByLabel('Phone').fill('(555) 201-5656')
      await frame.getByRole('button', { name: 'Continue' }).click()
      await frame.getByText('About the job').waitFor({ timeout: 15_000 })
      await frame.locator('input[type=number]').first().fill('2')
      for (const group of await frame.locator('[data-testid=tap-rows]').all()) await group.locator('[data-testid=tap-row]').first().click()
      await frame.getByRole('button', { name: 'Continue' }).click()
      await frame.getByText('Photos & Documents').waitFor({ timeout: 15_000 })
      await frame.locator('[data-testid=photo-input]').setInputFiles(ROOM)
      await frame.getByRole('button', { name: 'Continue' }).click({ timeout: 60_000 })
      await frame.getByLabel('ZIP code').fill('63021')
      await frame.getByRole('button', { name: 'Get my estimate' }).click()
      await frame.locator('[data-testid=finished-ready]').waitFor({ timeout: 300_000 })
      const done = await frame.locator('[data-testid=finished-ready]').evaluate((el) => ({ total: (el.querySelector('[data-testid=finished-total]') as HTMLElement | null)?.innerText ?? '', lines: el.querySelectorAll('[data-testid=finished-estimate] li').length, link: { text: (el.querySelector('[data-testid=finished-link]') as HTMLElement).innerText.trim(), target: el.querySelector('[data-testid=finished-link]')!.getAttribute('target'), href: el.querySelector('[data-testid=finished-link]')!.getAttribute('href') ?? '' }, words: (el as HTMLElement).innerText.replace(/\s+/g, ' ') }))
      check(`${mode}: the request went through, and the finished screen shows the estimate itself: ${done.total} and its lines`, done.total === '$825.00' && done.lines >= 1 && findConfidenceLanguage(done.words).length === 0, { total: done.total, lines: done.lines })
      check(`${mode}: "${done.link.text}" opens in the same tab (it replaces the page the form is on; it never opens a new one)`, /^View your estimate$/.test(done.link.text) && done.link.target === '_top' && /\/q\/qte_.+token=/.test(done.link.href), done.link)
      await shot(p, `embed-${mode}-finished`, false)
      await frame.locator('[data-testid=finished-link]').click()
      await p.waitForURL(/\/q\/qte_[^/]+\?token=/, { timeout: 30_000 })
      check(`${mode}: following it lands on the estimate, in the tab the customer was in`, popups.length === 0 && ctx.pages().length === 1 && new URL(p.url()).origin === origin, { popups, at: new URL(p.url()).pathname })
      await ctx.close()
    }
    hostServer.close()
  }

  // ====================================================================
  section('D. The price panel in a dark, a light and a mid-tone business colour')
  // ====================================================================
  if (heaterQuote) {
    const colours = [{ name: 'dark navy', hex: '#1D3557' }, { name: 'light yellow', hex: '#F4D35E' }, { name: 'bright blue (neither white nor ink reaches 4.5:1 on it)', hex: '#3B82F6' }, { name: 'orange', hex: '#F97316' }]
    for (const c of colours) {
      await setColour(a, c.hex)
      const ctx = await contextFor(390)
      const p = await ctx.newPage()
      await p.goto(`${cfg.appUrl}/q/${heaterQuote.id}?token=${heaterQuote.token}`, { waitUntil: 'networkidle' })
      await p.getByText('Price breakdown').waitFor({ timeout: 30_000 })
      const panel = await p.evaluate(() => {
        const el = [...document.querySelectorAll('div')].find((d) => d.className.includes('bg-primary') && d.className.includes('text-on-primary'))!
        el.setAttribute('data-testid', 'price-panel')
        const rgb = (v: string) => (v.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3)
        return { bg: rgb(getComputedStyle(el).backgroundColor), texts: [...el.querySelectorAll('p')].length }
      })
      const png = await painted(p)
      const labels: Array<{ ratio: number; size: number; text: string }> = []
      for (let i = 0; i < panel.texts; i++) { const w = await worst(p, png, '[data-testid=price-panel] p', i); if (w) labels.push(w) }
      const hexOf = `#${panel.bg.map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
      const small = labels.filter((l) => l.size < 24)
      check(`${c.name} (${c.hex}): the panel keeps the business's own colour, and its small labels reach 4.5:1 (${small.map((l) => l.ratio).join(', ')})`, hexOf === c.hex.toUpperCase() && small.length >= 2 && small.every((l) => l.ratio >= 4.5) && labels.every((l) => l.ratio >= 4.5), { on: readableTextOn(c.hex), expected: Math.round(contrastRatio(c.hex, readableTextOn(c.hex)) * 100) / 100, labels })
      check(`${c.name}: none of our yellow on the page`, (await accentOn(p)) === 0)
      await shot(p, `quote-colour-${c.hex.slice(1)}`, false)
      await ctx.close()
    }
    await setColour(a, '#1D3557')
  }

  // ====================================================================
  section('E. A quantity measured from photos (a quote set by hand, so the case is exact)')
  // ====================================================================
  if (paintQuote) {
    const { id: _id, ...source } = await quoteRow(paintQuote.id)
    const token = randomBytes(32).toString('base64url')
    const content = { ...(source.content_json as Row), takeoff: [
      { item: 'Exterior walls', quantity: 919.1, unit: 'sqft', rate: 2.5, amount: 2297.75, method: 'From your photos', evidence: 'Measured across 2 independent passes (spread ±5%), anchored to entry door height' },
      { item: 'Ladders & staging', amount: 250, method: 'Fixed quantity' },
      { item: 'Front door repaint', quantity: 1, unit: 'item', rate: 120, amount: 120, method: 'Quantity provided by you' },
    ] }
    const created = await sb.insert('quotes', { ...source, customer_json: { ...(source.customer_json as Row), name: 'Megan Grant', email: 'megan.grant@example.com' }, content_json: content, quote_token_hash: sha(token), previous_token_hash: null, link_token_hashes: [], reminder_sent_at: null })
    const api = expectOk('public quote', await http('GET', `${cfg.appUrl}/api/public/quotes/${created.id}?token=${token}&poll=1`))
    check('the API gives the customer one sentence for what was measured, with no amount: "From your photos: about 919.1 sq ft (Exterior walls)"', JSON.stringify(api.read) === JSON.stringify(['From your photos: about 919.1 sq ft (Exterior walls)']), api.read)
    const ctx = await contextFor(390)
    const p = await ctx.newPage()
    await p.goto(`${cfg.appUrl}/q/${created.id}?token=${token}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=what-was-read]').waitFor({ timeout: 30_000 })
    const block = (await p.locator('[data-testid=what-was-read]').innerText()).replace(/\s+/g, ' ')
    const words = await pageWords(p)
    check('the page shows only what was measured: no "Fixed quantity", no "Quantity provided by you", no amount and no rate in the block, nothing of how it was measured', /From your photos: about 919\.1 sq ft \(Exterior walls\)/.test(block) && !/Fixed quantity|Quantity provided|Ladders|Front door|\$|×|passes|spread/.test(block) && !/Fixed quantity|passes \(spread/.test(words), block)
    await shot(p, 'quote-measured-390')
    await ctx.close()
  }

  // ====================================================================
  section('F. The billing page says what the public Pricing page says')
  // ====================================================================
  for (const width of [390, 1440]) {
    const ctx = await contextFor(width, { cookie: a.cookieHeader })
    const p = await ctx.newPage()
    await p.goto(`${cfg.appUrl}/app/settings/billing`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=plan-lines]').first().waitFor({ timeout: 60_000 })
    const cards = await p.locator('[data-testid=plan-lines]').evaluateAll((lists) => lists.map((ul) => ({ name: (ul.parentElement!.querySelector('h3') as HTMLElement).innerText.trim(), lines: [...ul.querySelectorAll('[data-testid=plan-line]')].map((li) => ({ text: (li as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), live: li.getAttribute('data-live') === 'true' })), button: (ul.parentElement!.querySelector('button') as HTMLButtonElement).innerText.trim(), disabled: (ul.parentElement!.querySelector('button') as HTMLButtonElement).disabled })))
    const wanted = offeredPlans().map((plan) => ({ name: plan.name, lines: planLines(plan).map((l) => ({ text: l.live ? l.label : `${l.label} ${COMING_SOON}`, live: l.live })) }))
    check(`${width} billing: every plan on offer is there, Business included, each one can be chosen`, cards.length === offeredPlans().length && cards.some((c) => c.name === 'Business') && cards.every((c) => !c.disabled && /Select Plan/.test(c.button)), cards.map((c) => [c.name, c.button]))
    check(`${width} billing: each plan's lines are the public Pricing page's own, with "${COMING_SOON}" on what is not live (the same list feeds both; the words were "Coming later" until T-187)`, JSON.stringify(cards.map((c) => ({ name: c.name, lines: c.lines }))) === JSON.stringify(wanted), cards.map((c) => c.lines.filter((l) => !l.live).length))
    // the public page, for the plans it shows
    const pub = await ctx.newPage()
    await pub.goto(`${cfg.appUrl}/pricing`, { waitUntil: 'networkidle' })
    const publicCards = await pub.locator('[data-testid=plan-card]').evaluateAll((els) => els.map((el) => [...el.querySelectorAll('[data-testid=plan-line]')].map((li) => ({ text: (li as HTMLElement).innerText.replace(/[✓○]/g, '').replace(/\s+/g, ' ').trim(), live: li.getAttribute('data-live') === 'true' }))))
    const shownNames = sitePlans().map((s) => s.name)
    // T-187: a public card lists the plan's quotes a month and then only what the plan adds to the one below
    // it ("Everything in Starter, plus"), so it is no longer the billing page's whole list. Both still come
    // from one list: every line on a public card is on the billing page's card for that plan, worded and
    // marked the same, and a plan's public lines are exactly `planCards()`.
    const wantedPublic = planCards().map((card) => [{ text: card.quotes, live: true }, ...card.lines.map((l) => ({ text: l.live ? l.label : `${l.label} ${COMING_SOON}`, live: l.live }))])
    check(`${width} billing: for ${shownNames.join(' and ')}, the public cards are the shared plan cards, and every line on one is on the billing page's card for that plan, worded and marked the same`,
      publicCards.length === shownNames.length && JSON.stringify(publicCards) === JSON.stringify(wantedPublic) &&
        shownNames.every((name, i) => publicCards[i]!.slice(1).every((line) => cards.find((c) => c.name === name)!.lines.some((l) => l.text === line.text && l.live === line.live))), publicCards.map((c) => c.length))
    check(`${width} billing: nothing scrolls sideways`, (await sideways(p)) <= 0)
    if (width === 1440) await shot(p, 'billing-1440')
    await ctx.close()
  }

  // ====================================================================
  section('G. Login, sign-up, and the marketing header and footer')
  // ====================================================================
  for (const width of [390, 1440]) {
    const ctx = await contextFor(width)
    const p = await ctx.newPage()
    for (const [pathname, link] of [['/login', 'signup-link'], ['/signup', 'login-link']] as const) {
      await p.goto(`${cfg.appUrl}${pathname}`, { waitUntil: 'networkidle' })
      const auth = await p.evaluate((testid) => {
        // T-173: sign-up has an off-screen honeypot field no person can see or reach (inside aria-hidden); it is not a field to tap
        const fields = [...document.querySelectorAll('form input')].filter((i) => !['hidden', 'checkbox'].includes(i.getAttribute('type') ?? '') && !i.closest('[aria-hidden=true]')).map((i) => Math.round(i.getBoundingClientRect().height))
        const a = document.querySelector(`[data-testid=${testid}]`) as HTMLElement
        const cs = getComputedStyle(a)
        return { fields, link: { h: Math.round(a.getBoundingClientRect().height), underline: cs.textDecorationLine, weight: Number(cs.fontWeight), text: a.innerText.trim() } }
      }, link)
      check(`${width} ${pathname}: every field is 44 px or taller (${auth.fields.join(', ')})`, auth.fields.length >= 2 && auth.fields.every((h) => h >= 44), auth.fields)
      check(`${width} ${pathname}: "${auth.link.text}" is a clear link (underlined, semibold), ${auth.link.h} px tall`, auth.link.h >= 24 && /underline/.test(auth.link.underline) && auth.link.weight >= 600, auth.link)
    }
    if (width >= 1024) {
      await p.goto(`${cfg.appUrl}/`, { waitUntil: 'networkidle' })
      const links = await p.evaluate(() => {
        const of = (root: Element | null) => (root ? [...root.querySelectorAll('a')].filter((el) => el.getBoundingClientRect().height > 0).map((el) => ({ text: (el as HTMLElement).innerText.trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height) })) : [])
        return { header: of(document.querySelector('nav[aria-label="Site"]')), footer: of(document.querySelector('footer')) }
      })
      check(`${width}: every link in the marketing header is 24 px or taller`, links.header.length >= 5 && links.header.every((l) => l.h >= 24), links.header.filter((l) => l.h < 24))
      check(`${width}: every link in the marketing footer is 24 px or taller`, links.footer.length >= 10 && links.footer.every((l) => l.h >= 24), links.footer.filter((l) => l.h < 24))
    }
    await ctx.close()
  }
  await browser.close()
}

saveJson(outDir, 'checks.json', checks)
if (notChecked.length) console.log(`\nNot checked:\n- ${notChecked.join('\n- ')}`)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
