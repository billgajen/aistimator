// T-164 live check: design foundations (Docs/design/system.md decides).
// Run (local stack up: supabase, web, worker):
//   npx tsx scripts/hardcore-test/verify-t164.mts
// With the browser pass, which is most of it:
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t164.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. /design: served, not indexed, linked from nowhere;
// 2. (browser) /design at 390 and 1440 with each accent: nothing scrolls
//    sideways, the accent recolours the page, button text and pill text read
//    at 4.5:1 as the browser paints them, both wordmarks, every section;
// 3. (browser) the focus ring, tabbing through real pages: 3:1 or more
//    against what is behind it, on paper and on juniper;
// 4. (browser) the token fixes on real pages: muted text, field edges, the
//    status colours, and no butter on "needs you";
// 5. (browser) motion: the dashboard has no entrance, and with reduced motion
//    the drawer, the progress bar and the tape animation are still (and
//    without it they move, so the check means something);
// 6. (browser) the customer's quote page keeps the business's colour.
//
// One request goes through the real pipeline, for the dashboard and the
// customer pages. Names are made up.
import path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { ROOT, loadEnv, makeSupabase, sessionCookieHeader, http, expectOk, pollQuote, shortId, saveJson, runStamp } from './lib.mjs'
import { garageDoorsPackUS } from '../../apps/web/src/lib/vertical-packs/garage-doors-us'
import { DEFAULT_PRIMARY_COLOR } from '../../packages/shared/src/brand'

const cfg = loadEnv()
const sb = makeSupabase(cfg)
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t164-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const stalls: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)
const origin = new URL(cfg.appUrl).origin

// The tokens as system.md states them
const ACCENTS = {
  tomato: { fill: '#E8412C', tint: '#FBE1DD' },
  orange: { fill: '#F26B2A', tint: '#FDE7DD' },
  yellow: { fill: '#FFC53D', tint: '#FFEFC2' },
} as const
const BUTTER = '#F7E9C6'
const JUNIPER = '#205E56'
const MUTED = '#626C66'
const FIELD = '#808781'

const rgbOf = (css: string): [number, number, number, number] => {
  const m = /rgba?\(([^)]+)\)/.exec(css)
  if (!m) return [0, 0, 0, 0]
  const parts = m[1]!.split(/[,\s/]+/).filter(Boolean).map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1]
}
const hexOf = (css: string) => '#' + rgbOf(css).slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase()
const luminance = (css: string) => {
  const [r, g, b] = rgbOf(css).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

// ====================================================================
section('1. /design: served, not indexed, linked from nowhere')
// ====================================================================
const designRes = await fetch(`${cfg.appUrl}/design`)
const designHtml = await designRes.text()
check('/design is served', designRes.status === 200 && designHtml.includes('data-testid="design-preview"'), designRes.status)
const robots = /<meta name="robots" content="([^"]*)"/.exec(designHtml)?.[1] ?? ''
check('/design is marked noindex, nofollow', /noindex/.test(robots) && /nofollow/.test(robots), robots)
const PUBLIC_PAGES = ['/', '/features', '/pricing', '/trades', '/trades/garage-doors', '/painting', '/privacy', '/terms', '/login', '/signup', '/demo']
const linking: string[] = []
for (const pathname of PUBLIC_PAGES) {
  const html = await (await fetch(`${cfg.appUrl}${pathname}`)).text()
  if (/href="\/design(?:["/?#])/.test(html)) linking.push(pathname)
}
check('no public page links to /design', linking.length === 0, linking)
for (const file of ['/sitemap.xml', '/robots.txt']) {
  const res = await fetch(`${cfg.appUrl}${file}`)
  const body = res.status === 200 ? await res.text() : ''
  check(`${file} does not list /design`, !body.includes('/design'), res.status)
}
check('taste’s gate is not armed in this repo (no .taste-skill folder)', !existsSync(path.join(ROOT, '.taste-skill')) && !existsSync(path.join(ROOT, 'apps/web/.taste-skill')))

// ---------- a business with one request waiting for it ----------
async function business(name: string) {
  const id = shortId()
  const email = `owner+t164-${id}@hardcore.test`
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

const a = await business('Alder Lane Doors')
const door = garageDoorsPackUS.services[0]!
const serviceId = (expectOk('service', await http('POST', `${cfg.appUrl}/api/services`, {
  headers: a.cookie,
  body: {
    name: door.name, description: door.description, documentTypeDefault: 'instant_estimate',
    scopeIncludes: door.draft.scope.included, scopeExcludes: door.draft.scope.excluded, defaultAssumptions: door.draft.scope.assumptions,
    mediaConfig: { minPhotos: 0, maxPhotos: 4, photoGuidance: door.draft.media.photoGuidance, requiredAngles: [] },
    workSteps: door.draft.pricing.workSteps, expectedSignals: door.draft.expectedSignals,
    pricingRules: { baseFee: 0, minimumCharge: 0, addons: door.addons, multipliers: door.multipliers, workSteps: door.draft.pricing.workSteps },
    draftConfig: door.draft,
  },
})).service.id) as string
async function submit(biz: Biz, customer: { name: string; email: string }) {
  // Locally the request waits for the whole pipeline, and an AI call there can
  // stall. One retry, then carry on; a second stall fails the run.
  const post = () => http('POST', `${cfg.appUrl}/api/public/quotes`, {
    body: {
      tenantKey: biz.tenantKey, serviceId, customer, source: { type: 'widget' },
      job: { postcodeOrZip: '63021', answers: [
        { fieldId: '_project_description', value: 'New garage door please, single steel one' },
        { fieldId: 'door_size', value: 'Single (8 or 9 ft wide, 7 ft tall)' },
        { fieldId: 'door_style', value: 'Steel, non-insulated' },
      ] },
    },
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
const setStatus = (status: string) => http('PATCH', `${cfg.supabaseUrl}/rest/v1/quotes?id=eq.${quote.id}`, {
  headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, Prefer: 'return=minimal' },
  body: { status },
})
const startStatus = (await sb.select('quotes', `id=eq.${quote.id}&select=status`))[0].status as string
check('a request is waiting for the business (priced, awaiting approval)', startStatus === 'pending_review', startStatus)

if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Everything a browser paints: /design at both widths with each accent, the focus ring, the token fixes on real pages, the status colours, motion with and without reduced motion, the customer page’s colour. Set PLAYWRIGHT_DIR to run the browser pass.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const contextFor = async (biz: Biz | null, opts: { width?: number; height?: number; reducedMotion?: 'reduce' | 'no-preference' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 }, reducedMotion: opts.reducedMotion ?? 'no-preference' })
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
  const settle = async (p: Page) => { await p.waitForLoadState('networkidle').catch(() => {}); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500) }
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true })
  const style = (p: Page, selector: string, prop: string) => p.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), prop)
  /** The first painted background behind an element (the element itself when `self`) */
  const groundOf = (p: Page, selector: string, self = false) => p.locator(selector).first().evaluate((el, own) => {
    let node: Element | null = own ? el : el.parentElement
    while (node) {
      const bg = getComputedStyle(node).backgroundColor
      const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(/[,\s/]+/).filter(Boolean)[3]
      if (bg && bg !== 'transparent' && (alpha === undefined || Number(alpha) > 0.5)) return bg
      node = node.parentElement
    }
    return 'rgb(255, 255, 255)'
  }, self)

  // ====================================================================
  section('2. /design at 390 and 1440, with each accent')
  // ====================================================================
  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    const ctx = await contextFor(null, { width, height })
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('pageerror', (e) => errors.push(String(e)))
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await p.goto(`${cfg.appUrl}/design`)
    await settle(p)
    check(`${width}: orange is the accent the page opens with`, (await p.getAttribute('[data-testid=design-preview]', 'data-accent')) === 'orange' && (await p.getAttribute('[data-testid=accent-orange]', 'aria-checked')) === 'true')
    const present = await p.evaluate(() => ['wordmark', 'palette', 'type', 'shape', 'components', 'marketing-band', 'dashboard-row', 'motion'].filter((id) => !document.querySelector(`[data-testid=section-${id}]`)))
    check(`${width}: every section is there (wordmark, palette, type, shape, components, marketing band, dashboard row, motion)`, present.length === 0, present)
    check(`${width}: both wordmarks are drawn, in the display font`,
      (await p.locator('[data-testid=wordmark-capital]').first().innerText()) === 'Qolumns' && (await p.locator('[data-testid=wordmark-lower]').first().innerText()) === 'qolumns' && /Bricolage/i.test(await style(p, '[data-testid=wordmark-capital]', 'font-family')),
      await style(p, '[data-testid=wordmark-capital]', 'font-family'))
    check(`${width}: the marketing band shows a real product screen (the three frames of the home page)`, (await p.locator('[data-testid=marketing-band] [data-testid=product-frame]').count()) === 3)
    check(`${width}: five status colours`, (await p.locator('[data-testid=status-pills] [data-testid=turn-label]').count()) === 5)

    for (const [name, want] of Object.entries(ACCENTS)) {
      await p.click(`[data-testid=accent-${name}]`)
      await p.waitForTimeout(250)
      const fill = await style(p, '[data-testid=button-accent]', 'background-color')
      const onFill = await style(p, '[data-testid=button-accent]', 'color')
      const mark = await style(p, '[data-testid=highlight]', 'background-color')
      const pillBg = await style(p, '[data-testid=status-attention] [data-testid=turn-label]', 'background-color')
      const pillText = await style(p, '[data-testid=status-attention] [data-testid=turn-label]', 'color')
      const rowPill = await style(p, '[data-testid=dashboard-row] [data-testid=turn-label]', 'background-color')
      const swatch = (await p.locator('[data-testid=swatch-accent] .figure').innerText()).toUpperCase()
      check(`${width}, ${name}: the switch recolours the page (button, highlighted word, "needs you", the swatch's value)`,
        hexOf(fill) === want.fill && hexOf(mark) === want.fill && hexOf(pillBg) === want.tint && hexOf(rowPill) === want.tint && swatch === want.fill,
        { fill: hexOf(fill), mark: hexOf(mark), pill: hexOf(pillBg), swatch })
      check(`${width}, ${name}: button text on the accent reads at 4.5:1 as painted`, contrast(onFill, fill) >= 4.5, contrast(onFill, fill))
      check(`${width}, ${name}: the highlighted word reads at 4.5:1`, contrast(await style(p, '[data-testid=highlight]', 'color'), mark) >= 4.5, contrast(await style(p, '[data-testid=highlight]', 'color'), mark))
      check(`${width}, ${name}: "needs you" text on its tint reads at 4.5:1, and the tint is not butter`, contrast(pillText, pillBg) >= 4.5 && hexOf(pillBg) !== BUTTER, contrast(pillText, pillBg))
      const sideways = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(`${width}, ${name}: nothing scrolls sideways`, sideways <= 1, sideways)
      await shot(p, `design-${width}-${name}`)
    }
    // the other four status colours, as painted
    for (const tone of ['waiting', 'good', 'closed', 'danger']) {
      const bg = await style(p, `[data-testid=status-${tone}] [data-testid=turn-label]`, 'background-color')
      const text = await style(p, `[data-testid=status-${tone}] [data-testid=turn-label]`, 'color')
      check(`${width}: the "${tone}" pill reads at 4.5:1 as painted`, contrast(text, bg) >= 4.5, { ratio: contrast(text, bg), bg: hexOf(bg), text: hexOf(text) })
    }
    const fieldEdge = await style(p, '[data-testid=sample-input]', 'border-top-color')
    check(`${width}: a field's edge reads at 3:1 against the card it sits on`, contrast(fieldEdge, await groundOf(p, '[data-testid=sample-input]')) >= 3 && hexOf(fieldEdge) === FIELD, { edge: hexOf(fieldEdge), ratio: contrast(fieldEdge, await groundOf(p, '[data-testid=sample-input]')) })
    const outline = await style(p, '[data-testid=button-outline]', 'border-top-color')
    check(`${width}: an outlined button's edge reads at 3:1 too`, contrast(outline, await groundOf(p, '[data-testid=button-outline]')) >= 3, hexOf(outline))
    const smallTaps = await p.evaluate(() => [...document.querySelectorAll('[data-testid=accent-switch] button')].filter((el) => el.getBoundingClientRect().height < 44).length)
    check(`${width}: the accent switch's buttons are 44 px tall`, smallTaps === 0)

    // the menu, on its tokens
    const closed = await p.locator('[data-testid=motion-menu]').evaluate((el) => ({ v: getComputedStyle(el).visibility, o: getComputedStyle(el).opacity }))
    await p.click('[data-testid=motion-menu-button]')
    await p.waitForTimeout(400)
    const open = await p.locator('[data-testid=motion-menu]').evaluate((el) => ({ v: getComputedStyle(el).visibility, o: getComputedStyle(el).opacity, d: getComputedStyle(el).transitionDuration, p: getComputedStyle(el).transitionProperty }))
    check(`${width}: the menu opens in 200 ms, moving opacity and transform only`, closed.v === 'hidden' && open.v === 'visible' && open.o === '1' && /^0\.2s, 0\.2s, 0s$/.test(open.d) && open.p === 'opacity, transform, visibility', open)
    await p.click('[data-testid=motion-menu-button]')
    const pressDurations = await p.locator('[data-testid=motion-button]').evaluate((el) => getComputedStyle(el).transitionDuration)
    await p.hover('[data-testid=motion-button]')
    const hoverDurations = await p.locator('[data-testid=motion-button]').evaluate((el) => getComputedStyle(el).transitionDuration)
    const moves = await p.locator('[data-testid=motion-button]').evaluate((el) => getComputedStyle(el).transitionProperty)
    check(`${width}: a button leaves in 120 ms and answers the pointer in 150 ms, moving transform, opacity and colour only`, /^0\.12s/.test(pressDurations) && /^0\.15s/.test(hoverDurations) && moves === 'transform, opacity, background-color', { rest: pressDurations, hover: hoverDurations, moves })
    const enter = await p.locator('[data-testid=motion-enter-card]').evaluate((el) => ({ name: getComputedStyle(el).animationName, d: getComputedStyle(el).animationDuration, f: getComputedStyle(el).filter }))
    check(`${width}: the entering card rises for 250 ms with no blur`, enter.name === 'fade-in-up' && enter.d === '0.25s' && enter.f === 'none', enter)
    check(`${width}: no error in the console`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }

  // ====================================================================
  section('3. The focus ring, tabbing through real pages')
  // ====================================================================
  /**
   * Tab through a page. For each control that takes the global focus ring
   * (an outline), compare the ring's colour with what is painted behind it.
   * Controls that draw their own focus (fields: a border change and a halo)
   * are counted apart.
   */
  async function ringSweep(p: Page, label: string, file: string, limit = 60) {
    await settle(p)
    await p.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0) })
    const seen: Array<{ what: string; ring: string; ground: string; ratio: number; onJuniper: boolean }> = []
    const noRing: string[] = []
    let own = 0
    for (let i = 0; i < limit; i++) {
      await p.keyboard.press('Tab')
      const info = await p.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        const cs = getComputedStyle(el)
        if (!el.matches(':focus-visible')) return { skip: true as const }
        // (no named helper in here: the page cannot run the wrapper tsx puts around one)
        let ring = cs.outlineColor
        if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0 || Number((/rgba?\(([^)]+)\)/.exec(cs.outlineColor)?.[1]?.split(/[,\s/]+/).filter(Boolean) ?? [])[3] ?? 1) === 0) {
          // the control hides the outline and draws a ring as a box-shadow: take the widest painted one
          const shadows = [...cs.boxShadow.matchAll(/(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(\s+inset)?/g)]
            .map((m) => ({ colour: m[1]!, blur: Number(m[4]), spread: Number(m[5]), inset: Boolean(m[6]) }))
            .filter((sh) => !sh.inset && sh.blur === 0 && sh.spread >= 2 && Number((/rgba?\(([^)]+)\)/.exec(sh.colour)?.[1]?.split(/[,\s/]+/).filter(Boolean) ?? [])[3] ?? 1) > 0)
            .sort((x, y) => y.spread - x.spread)
          if (!shadows[0]) return { own: true as const, what: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 32) }
          ring = shadows[0].colour
          if (Number((/rgba?\(([^)]+)\)/.exec(ring)?.[1]?.split(/[,\s/]+/).filter(Boolean) ?? [])[3] ?? 1) < 1) return { what: (el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 32), ring, ground: 'translucent', translucent: true as const }
        }
        let node: Element | null = el.parentElement
        let ground = 'rgb(255, 255, 255)'
        while (node) {
          const bg = getComputedStyle(node).backgroundColor
          const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1]?.split(/[,\s/]+/).filter(Boolean)[3]
          if (bg && bg !== 'transparent' && (alpha === undefined || Number(alpha) > 0.5)) { ground = bg; break }
          node = node.parentElement
        }
        return { what: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 32), ring, ground }
      })
      if (!info) break
      if ('skip' in info) continue
      if ('own' in info) { own++; noRing.push(info.what ?? '?'); continue }
      // a translucent ring cannot be judged against one ground: count it as too faint
      const ratio = 'translucent' in info ? 0 : contrast(info.ring, info.ground)
      seen.push({ ...info, ratio, onJuniper: hexOf(info.ground) === JUNIPER })
    }
    const weak = seen.filter((s) => s.ratio < 3)
    check(`${label}: every control's focus ring, outline or Tailwind ring, reads at 3:1 or more against what is behind it (${seen.length} controls)`, seen.length > 0 && weak.length === 0, weak.slice(0, 4))
    check(`${label}: no control is left without a ring`, noRing.length === 0, noRing.slice(0, 6))
    await shot(p, file)
    return { seen, own }
  }
  const desktop = await contextFor(null)
  {
    const p = await desktop.newPage()
    await p.goto(`${cfg.appUrl}/design`)
    await settle(p)
    await p.locator('[data-testid=sample-select]').focus()
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab')
    // straight to the button that sits on juniper
    await p.locator('[data-testid=link-on-juniper]').focus()
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab')
    const onJuniper = await p.locator('[data-testid=link-on-juniper]').evaluate((el) => ({ focused: document.activeElement === el && el.matches(':focus-visible'), ring: getComputedStyle(el).outlineColor, width: getComputedStyle(el).outlineWidth, offset: getComputedStyle(el).outlineOffset }))
    const ground = await groundOf(p, '[data-testid=link-on-juniper]')
    check('/design: a button on juniper has a light ring, 3:1 or more against juniper (it was juniper on juniper, 1:1)', onJuniper.focused && hexOf(ground) === JUNIPER && contrast(onJuniper.ring, ground) >= 3 && onJuniper.width === '2px', { ...onJuniper, ground: hexOf(ground), ratio: contrast(onJuniper.ring, ground) })
    await p.locator('[data-testid=link-on-juniper]').screenshot({ path: path.join(outDir, 'focus-on-juniper.png') }).catch(() => {})
    await p.locator('[data-testid=button-outline]').focus()
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab')
    const onPaper = await p.evaluate(() => { const el = document.activeElement as HTMLElement; return { testid: el.getAttribute('data-testid'), shadow: getComputedStyle(el).boxShadow } })
    check('/design: on paper a button that draws its own ring gets an ink ring, not Tailwind’s translucent blue', onPaper.testid === 'button-outline' && /rgb\(27, 40, 35\) 0px 0px 0px 3px/.test(onPaper.shadow) && !/rgba\(/.test(onPaper.shadow.replace(/rgba\(0, 0, 0, 0\)/g, '')), onPaper)
    await p.close()
  }
  const juniperHits: string[] = []
  for (const [pathname, file] of [['/', 'focus-home'], ['/pricing', 'focus-pricing'], ['/features', 'focus-features'], ['/login', 'focus-login']] as const) {
    const p = await desktop.newPage()
    await p.goto(`${cfg.appUrl}${pathname}`)
    const { seen } = await ringSweep(p, pathname, file, 70)
    for (const s of seen.filter((x) => x.onJuniper)) juniperHits.push(`${pathname}: ${s.what} ${s.ratio}`)
    await p.close()
  }
  check('real pages: the buttons on the juniper band and on the Pro plan card were reached, each with a ring of 3:1 or more', juniperHits.length >= 3, juniperHits)
  {
    const signed = await contextFor(a)
    const p = await signed.newPage()
    await p.goto(`${cfg.appUrl}/app`)
    await ringSweep(p, 'dashboard Home', 'focus-dashboard-home', 40)
    await p.close()
    await signed.close()
  }
  {
    const p = await desktop.newPage()
    await p.goto(quote.viewUrl)
    await p.waitForFunction(() => /\$\d/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {})
    await ringSweep(p, 'a customer quote page (the business’s own colour)', 'focus-customer-quote', 20)
    await p.close()
  }
  await desktop.close()

  // ====================================================================
  section('4. The token fixes on real pages')
  // ====================================================================
  const signedIn = await contextFor(a)
  {
    const p = await signedIn.newPage()
    await p.goto(`${cfg.appUrl}/app/quotes?tab=needs_you`)
    await settle(p)
    await p.locator('[data-testid=turn-label]').first().waitFor({ timeout: 20_000 })
    const pill = { bg: await style(p, '[data-testid=turn-label]', 'background-color'), text: await style(p, '[data-testid=turn-label]', 'color'), tone: await p.getAttribute('[data-testid=turn-label]', 'data-tone') }
    check('quotes list: "Needs your approval" is the accent tint (orange), not butter, and reads at 4.5:1', pill.tone === 'attention' && hexOf(pill.bg) === ACCENTS.orange.tint && hexOf(pill.bg) !== BUTTER && contrast(pill.text, pill.bg) >= 4.5, { bg: hexOf(pill.bg), ratio: contrast(pill.text, pill.bg) })
    const detail = await style(p, '[data-testid=turn-detail]', 'color')
    check('quotes list: the muted detail line ("Received today") reads at 4.5:1', hexOf(detail) === MUTED && contrast(detail, await groundOf(p, '[data-testid=turn-detail]')) >= 4.5, { colour: hexOf(detail), ratio: contrast(detail, await groundOf(p, '[data-testid=turn-detail]')) })
    const search = p.locator('input[type=search], input[placeholder*="Search"]').first()
    const searchEdge = await search.evaluate((el) => getComputedStyle(el).borderTopColor)
    check('quotes list: the search field’s edge reads at 3:1', hexOf(searchEdge) === FIELD, hexOf(searchEdge))
    await shot(p, 'quotes-needs-you')

    await p.goto(`${cfg.appUrl}/app`)
    await settle(p)
    const tile = await style(p, '[data-testid=stand-tile][data-group=needs_you]', 'background-color')
    check('Home: the "Needs you" tile is the accent tint, not butter', hexOf(tile) === ACCENTS.orange.tint, hexOf(tile))
    const homePill = await style(p, '[data-testid=turn-label]', 'background-color')
    check('Home: the "Waiting for you" row’s pill is the accent tint too', hexOf(homePill) === ACCENTS.orange.tint, hexOf(homePill))
    const butterLeft = await p.evaluate((butter) => [...document.querySelectorAll('[data-testid=turn-label], [data-testid=stand-tile], [data-testid=nav-badge]')].filter((el) => {
      const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number)
      return '#' + [r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('').toUpperCase() === butter
    }).length, BUTTER)
    check('Home: no "needs you" marker is butter', butterLeft === 0, butterLeft)
    const main = await p.locator('main').first().evaluate((el) => getComputedStyle(el).animationName)
    check('dashboard: the page does not fade in (no entrance animation)', main === 'none', main)
    await shot(p, 'dashboard-home')
    await p.close()
  }
  {
    const anon = await contextFor(null, { width: 390, height: 844 })
    const p = await anon.newPage()
    await p.goto(`${cfg.appUrl}/login`)
    await settle(p)
    const edge = await style(p, 'input[type=email]', 'border-top-color')
    check('login: the email field’s edge reads at 3:1 against the card', contrast(edge, await groundOf(p, 'input[type=email]')) >= 3, { edge: hexOf(edge), ratio: contrast(edge, await groundOf(p, 'input[type=email]')) })
    await p.goto(`${cfg.appUrl}/quote/${a.slug}`)
    await settle(p)
    const widgetField = p.getByLabel('Your name')
    await widgetField.waitFor({ timeout: 20_000 })
    const widgetEdge = await widgetField.evaluate((el) => getComputedStyle(el).borderTopColor)
    check('the request form: a field’s edge reads at 3:1', hexOf(widgetEdge) === FIELD, hexOf(widgetEdge))
    await shot(p, 'request-form-390')
    await anon.close()
  }

  // ====================================================================
  section('5. Motion: reduced motion stills the drawer, the progress bar and the tape')
  // ====================================================================
  const seconds = (css: string) => Math.max(...css.split(',').map((part) => (part.trim().endsWith('ms') ? parseFloat(part) / 1000 : parseFloat(part))))
  await setStatus('generating') // the customer's page then waits, with the tape being drawn
  const motion: Record<string, { drawer: number; bar: number; tapeDuration: number; tapeCount: string; tapeName: string }> = {}
  for (const mode of ['no-preference', 'reduce'] as const) {
    const ctx = await contextFor(a, { width: 390, height: 844, reducedMotion: mode })
    const p = await ctx.newPage()
    await p.goto(`${cfg.appUrl}/app`)
    await settle(p)
    const drawer = seconds(await p.locator('aside').first().evaluate((el) => getComputedStyle(el).transitionDuration))
    const bar = seconds(await p.locator('.transition-all').first().evaluate((el) => getComputedStyle(el).transitionDuration))
    const q = await ctx.newPage()
    await q.goto(quote.viewUrl)
    await q.locator('.tape-measuring').first().waitFor({ timeout: 20_000 })
    const tape = await q.locator('.tape-measuring').first().evaluate((el) => ({ d: getComputedStyle(el).animationDuration, n: getComputedStyle(el).animationIterationCount, name: getComputedStyle(el).animationName }))
    motion[mode] = { drawer, bar, tapeDuration: seconds(tape.d), tapeCount: tape.n, tapeName: tape.name }
    if (mode === 'reduce') await q.screenshot({ path: path.join(outDir, 'customer-waiting-reduced-motion.png') })
    await ctx.close()
  }
  await setStatus(startStatus)
  const moving = motion['no-preference']!
  const still = motion.reduce!
  check('without the setting they move: the phone drawer slides, the setup bar grows, the tape is drawn in a loop', moving.drawer >= 0.15 && moving.bar >= 0.1 && moving.tapeDuration >= 1 && moving.tapeCount === 'infinite' && moving.tapeName === 'tape-measuring', moving)
  check('with reduced motion the drawer does not slide', still.drawer <= 0.001, still.drawer)
  check('with reduced motion the progress bar does not animate', still.bar <= 0.001, still.bar)
  check('with reduced motion the tape rule is still (it ends at once and does not loop)', still.tapeDuration <= 0.001 && still.tapeCount === '1', still)
  check('the quote is back as it was', (await sb.select('quotes', `id=eq.${quote.id}&select=status`))[0].status === startStatus)

  // ====================================================================
  section('6. The customer’s page keeps the business’s colour')
  // ====================================================================
  {
    const ctx = await contextFor(null, { width: 390, height: 844 })
    const p = await ctx.newPage()
    await p.goto(quote.viewUrl)
    await p.waitForFunction(() => /\$\d/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {})
    await settle(p)
    const colours = await p.evaluate(() => [...document.querySelectorAll('*')].map((el) => getComputedStyle(el).backgroundColor))
    const hexes = new Set(colours.map((c) => hexOf(c)))
    const brand = DEFAULT_PRIMARY_COLOR.toUpperCase()
    check('the quote page’s price panel is the business’s brand colour', hexes.has(brand), brand)
    check('…and none of our accent colours is painted on it', !Object.values(ACCENTS).some((accent) => hexes.has(accent.fill) || hexes.has(accent.tint)))
    await shot(p, 'customer-quote-390')
    await ctx.close()
  }
  await signedIn.close()
  await browser.close()
}

// ====================================================================
const failed = checks.filter((c) => !c.pass)
saveJson(outDir, 'checks.json', { checks, notChecked, stalls })
if (stalls.length) console.log(`\nStalled and retried:\n${stalls.map((s) => `  • ${s}`).join('\n')}`)
if (notChecked.length) console.log(`\nNot checked here:\n${notChecked.map((s) => `  • ${s}`).join('\n')}`)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
