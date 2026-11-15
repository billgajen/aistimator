// T-167 live check: the site says what the AI does, and shows it.
// Run (local web app up; no request is sent, so the worker is not needed):
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t167.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. every marketing page loads, and none shows a banned word (exact, firm,
//    guaranteed, grades, confidence words), a slogan or a promise of accuracy;
// 2. (browser, 390 and 1440) Home: the new line under the headline; the demo
//    plays once, with the reading and the customer's "Yes" before the price,
//    and stands still under reduced motion; the T-167 order; the figures
//    second; "What it notices" with the message line and four real screens;
//    the trade links inside step 1; neighbours share neither layout nor
//    background; nothing scrolls sideways; one yellow call to action per screen;
// 3. (browser) Features: the message line; five steps, each with its screen;
//    no two neighbouring steps laid out alike; the main button yellow;
// 4. (browser) each trade page: its own screen beside the headline; "How the
//    price is set" on three real screens; only what the AI does for that
//    trade; the main button yellow;
// 5. (browser) Pricing's two lines link to the live demo.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, shortId, saveJson, runStamp } from './lib.mjs'
import { findConfidenceLanguage } from '../../packages/shared/src/customer-language'
import { TRADES, tradeHref } from '../../apps/web/src/lib/marketing/trades'
import { marketingExample } from '../../apps/web/src/lib/marketing/examples'
import { HERO, MESSAGE_LINE, NOTICES } from '../../apps/web/src/lib/marketing/home-copy'
import { FEATURE_STEPS } from '../../apps/web/src/lib/marketing/features-copy'
import { SCREEN_WORDS } from '../../apps/web/src/lib/marketing/screen-words'

const cfg = loadEnv()
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t167-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)

const YELLOW = '#FFC53D'
const TRADE_PAGES = TRADES.map((t) => ({ trade: t, href: tradeHref(t), example: marketingExample(t.slug) }))
const MARKETING_PAGES = ['/', '/features', '/pricing', '/trades', ...TRADE_PAGES.map((t) => t.href), '/demo', '/login', '/signup']
const SLOGANS = /AI[- ]powered|powered by AI|\baccura\w+|never wrong|smart pricing|\bmagic\w*|cutting[- ]edge|revolution\w*/i
const visibleText = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

// ====================================================================
section('1. Every marketing page loads; no banned word, slogan or promise of accuracy')
// ====================================================================
const pageProblems: string[] = []
const aiSetsPrice: string[] = []
for (const pathname of MARKETING_PAGES) {
  const res = await fetch(`${cfg.appUrl}${pathname}`)
  const text = visibleText(await res.text())
  if (res.status !== 200) pageProblems.push(`${pathname}: ${res.status}`)
  for (const problem of findConfidenceLanguage(text)) pageProblems.push(`${pathname}: ${problem}`)
  const slogan = SLOGANS.exec(text)
  // Pricing's plan lines name a plan feature, "Accuracy insights from finished jobs" (not a promise; listed in OWNER-TODO)
  if (slogan && !(pathname === '/pricing' && /^accura/i.test(slogan[0]) && !SLOGANS.test(text.replace(/Accuracy insights from finished jobs/g, '')))) pageProblems.push(`${pathname}: "${slogan[0]}"`)
  const sets = /AI (sets|prices|quotes|calculates|decides the price)/i.exec(text)
  if (sets) aiSetsPrice.push(`${pathname}: ${sets[0]}`)
}
check(`all ${MARKETING_PAGES.length} marketing pages load, with no banned word, slogan or promise of accuracy`, pageProblems.length === 0, pageProblems)
check('no page says the AI sets, prices or calculates anything', aiSetsPrice.length === 0, aiSetsPrice)
const homeText = visibleText(await (await fetch(`${cfg.appUrl}/`)).text())
check('Home: the line under the headline says what the AI does, then where the price comes from', homeText.includes('The AI reads what your customer tells you and the photos they send, and works out the job. The price comes from your own price list, and you confirm it.') && HERO.subline.startsWith('The AI reads'))
check('Home, Features and a trade page each carry the message line', homeText.includes(MESSAGE_LINE) && visibleText(await (await fetch(`${cfg.appUrl}/features`)).text()).includes(MESSAGE_LINE) && visibleText(await (await fetch(`${cfg.appUrl}/trades/water-heaters`)).text()).includes(MESSAGE_LINE))
const demoHtml = await (await fetch(`${cfg.appUrl}/demo`)).text()
check('/demo no longer says "to firm this up"', !/firm this up/i.test(demoHtml))

if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Everything a browser paints: the demo and its new beat, reduced motion, the order of Home, the screens on Features and the trade pages, sideways scroll and the yellow buttons. Set PLAYWRIGHT_DIR to run it.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium } = browserDeps()
  const browser = await chromium.launch()
  const contextFor = (opts: { width: number; height: number; reducedMotion?: 'reduce' | 'no-preference' }) =>
    browser.newContext({ viewport: { width: opts.width, height: opts.height }, reducedMotion: opts.reducedMotion ?? 'no-preference' })
  type Ctx = Awaited<ReturnType<typeof contextFor>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>
  const shot = (p: Page, name: string, fullPage = true) => p.screenshot({ path: path.join(outDir, `${name}.png`), fullPage })
  const noSideways = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  /** How many yellow buttons are on screen at each screenful down the page (no named helper inside: the page cannot run tsx's wrapper) */
  const yellowPerScreen = (p: Page) =>
    p.evaluate(async (yellow) => {
      const counts: number[] = []
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
        window.scrollTo(0, y)
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        counts.push([...document.querySelectorAll('a, button')].filter((el) => {
          const r = el.getBoundingClientRect()
          return ('#' + (getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()) === yellow && r.height > 0 && r.bottom > 0 && r.top < innerHeight
        }).length)
      }
      window.scrollTo(0, 0)
      return counts
    }, YELLOW)
  const yellowButtons = (p: Page) =>
    p.locator('a, button').evaluateAll((els, yellow) => els.filter((el) => { const m = getComputedStyle(el).backgroundColor.match(/\d+/g) ?? []; return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() === yellow }).map((el) => ({ text: (el as HTMLElement).innerText.trim(), href: el.getAttribute('href'), id: el.getAttribute('data-testid') })), YELLOW)
  /** The demo right now: is each thing in, and is anything in it still moving? */
  const demoState = (p: Page) => p.evaluate(() => {
    // T-168: three frames of one height; the label-reading step left the hero
    const o = ['demo-answer', 'estimate-total', 'demo-lead'].map((id) => Number(getComputedStyle(document.querySelector(`[data-testid=hero-demo-stage] [data-testid=${id}]`)!).opacity))
    const stage = document.querySelector('[data-testid=hero-demo-stage]')!
    const moving = document.getAnimations().filter((an) => an.playState === 'running' && stage.contains((an.effect as KeyframeEffect | null)?.target ?? null)).length
    return { answer: o[0]!, total: o[1]!, lead: o[2]!, moving }
  })
  type Demo = Awaited<ReturnType<typeof demoState>>
  const finished = (s: Demo) => s.answer === 1 && s.total === 1 && s.lead === 1 && s.moving === 0
  const HOME = `${cfg.appUrl}/`
  /** Each section of a page: its background as painted, and the widest row's shape */
  const sectionsOf = (p: Page) =>
    p.locator('main > section').evaluateAll((els) =>
      els.filter((el) => el.getBoundingClientRect().height > 40).map((sec) => {
        let bg = getComputedStyle(sec).backgroundColor
        if (/rgba\(0, 0, 0, 0\)/.test(bg)) bg = getComputedStyle(document.querySelector('main')!).backgroundColor
        return { id: sec.getAttribute('data-testid') ?? sec.getAttribute('data-step') ?? sec.querySelector('h2')?.textContent ?? '', bg }
      })
    )

  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    // ====================================================================
    section(`2. Home at ${width}`)
    // ====================================================================
    const ctx = await contextFor({ width, height })
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('pageerror', (e) => errors.push(String(e)))
    await p.goto(HOME, { waitUntil: 'domcontentloaded' })
    await p.locator('[data-testid=hero-demo-stage] [data-testid=demo-lead]').waitFor({ state: 'attached', timeout: 30_000 })
    const early = await demoState(p)
    check(`${width}: at the start no price has landed and no lead has arrived`, early.total < 0.5 && early.lead < 0.5 && early.moving > 0, early)
    // sample the run: the customer's answer, then the price, then the lead for the business
    const samples: Demo[] = []
    for (let i = 0; i < 20; i++) {
      await p.waitForTimeout(200)
      samples.push(await demoState(p))
    }
    const firstAt = (pick: (s: Demo) => number) => samples.findIndex((s) => pick(s) > 0.5)
    const order = { answer: firstAt((s) => s.answer), total: firstAt((s) => s.total), lead: firstAt((s) => s.lead) }
    check(`${width}: the demo runs in order: the answer, then the price, then the lead`, order.answer >= 0 && order.answer < order.total && order.total < order.lead, order)
    await p.waitForTimeout(1200)
    const end = await demoState(p)
    check(`${width}: it ends on its last state, the three frames complete, with nothing moving`, finished(end), end)
    await p.waitForTimeout(2500)
    const later = await demoState(p)
    check(`${width}: it played once: later it is the same`, finished(later) && JSON.stringify(later) === JSON.stringify(end), later)
    // T-168: the reading left the hero; "What it notices" shows it
    const heroText = (await p.locator('[data-testid=hero]').innerText()).replace(/\s+/g, ' ')
    check(`${width}: the hero demo has no label-reading step, and no "What we saw" line`, !/We read|Is that right|What we saw/.test(heroText) && (await p.locator('[data-testid=hero] [data-testid=question-screen]').count()) === 0 && (await p.locator('[data-testid=hero] [data-testid=question-yes]').count()) === 0, heroText.slice(0, 200))
    const cards = await p.locator('[data-testid=hero] [data-testid=demo-card]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left), height: Math.round(r.height) } }))
    check(`${width}: the demo is three frames of the same height, ${width >= 768 ? 'side by side' : 'one under another'}`, cards.length === 3 && Math.max(...cards.map((c) => c.height)) - Math.min(...cards.map((c) => c.height)) <= 1 && (width >= 768 ? cards[0]!.top === cards[2]!.top && cards[0]!.left < cards[1]!.left && cards[1]!.left < cards[2]!.left : cards[0]!.top < cards[1]!.top && cards[1]!.top < cards[2]!.top), cards)
    const chosen = await p.locator('[data-testid=notices] [data-testid=question-yes]').evaluate((el) => getComputedStyle(el).backgroundColor)
    check(`${width}: in "What it notices", "Yes" is shown chosen (the product's green), not yellow`, /223, 237, 229|rgb\(2\d\d, 2\d\d, 2\d\d\)/.test(chosen) && !/255, 197, 61/.test(chosen), chosen)
    check(`${width}: no page error on Home`, errors.length === 0, errors)
    await shot(p, `home-${width}-demo-end`, false)

    const sections = await sectionsOf(p)
    check(`${width}: the sections are in the T-167 order`, JSON.stringify(sections.map((s) => s.id)) === JSON.stringify(['hero', 'homeowners', 'notices', 'control', 'setup', 'Add it anywhere', 'plans', 'Questions', 'closing']), sections.map((s) => s.id))
    const sameBackground = sections.filter((s, i) => i > 0 && s.bg === sections[i - 1]!.bg).map((s) => s.id)
    check(`${width}: no two neighbouring sections share a background`, sameBackground.length === 0, sections.map((s) => s.bg))
    // the figures are the second thing a visitor sees. T-168: back to three columns side by side (the large
    // figure, the short line under it, then its source); one column on a phone
    const stats = await p.locator('[data-testid=statistics] figure').evaluateAll((els) => els.map((el) => { const fig = el.querySelector('p')!.getBoundingClientRect(); const line = el.querySelector('blockquote')!.getBoundingClientRect(); const src = el.querySelector('figcaption')!.getBoundingClientRect(); return { size: parseFloat(getComputedStyle(el.querySelector('p')!).fontSize), lineWidth: Math.round(line.width), source: el.querySelector('a')?.getAttribute('href') ?? '', sourceSize: parseFloat(getComputedStyle(el.querySelector('figcaption')!).fontSize), top: Math.round(el.getBoundingClientRect().top), left: Math.round(el.getBoundingClientRect().left), stacked: fig.bottom <= line.top + 1 && line.bottom <= src.top + 1 } }))
    const sideBySide = stats.length === 3 && Math.abs(stats[0]!.top - stats[1]!.top) < 4 && Math.abs(stats[1]!.top - stats[2]!.top) < 4 && stats[0]!.left < stats[1]!.left && stats[1]!.left < stats[2]!.left
    const oneColumn = stats.length === 3 && stats[0]!.top < stats[1]!.top && stats[1]!.top < stats[2]!.top && stats.every((s) => s.left === stats[0]!.left)
    check(`${width}: three large figures${width >= 768 ? ' in three columns side by side' : ', one column on a phone'}: the figure, the short line under it, then its linked source`, stats.length === 3 && stats.every((s) => s.size >= 52 && s.stacked && s.lineWidth <= 680 && s.sourceSize >= 12 && s.source.startsWith('https://')) && (width >= 768 ? sideBySide : oneColumn), stats.map((s) => [s.size, s.lineWidth, s.sourceSize, s.left]))
    check(`${width}: there is no standalone trades row, and no heading beside the pills`, (await p.locator('[data-testid=trades-row]').count()) === 1 && (await p.locator('#trades-label').count()) === 0 && !(await p.locator('main').innerText()).includes('Ready-made templates for your trade'))
    const pills = await p.locator('[data-testid=setup-step]').first().locator('[data-testid=trades-row] a').evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.trim(), href: el.getAttribute('href'), h: Math.round(el.getBoundingClientRect().height), lines: new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size })))
    check(`${width}: the trade links are pills inside "Choose your trade", each linking to its page, the last one "Other trades"`, pills.length === 7 && pills.slice(0, 6).every((x) => x.href === '/painting' || (x.href ?? '').startsWith('/trades/')) && pills[6]!.text === 'Other trades: describe your prices in plain English' && pills[6]!.href === '/signup' && pills.every((x) => x.h >= 44), pills.map((x) => x.text))

    // "What it notices"
    const notices = p.locator('[data-testid=notices]')
    check(`${width}: "What it notices" carries the message line and comes before "Your prices"`, (await notices.locator('h2').innerText()).trim() === NOTICES.heading && (await notices.locator('[data-testid=message-line]').innerText()).trim() === MESSAGE_LINE)
    const noticeScreens = await notices.locator('[data-testid=notice]').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-notice'), title: el.querySelector('h3')?.textContent ?? '', picture: el.querySelectorAll('[data-product-screen][role=img]').length, described: (el.querySelector('[data-product-screen]')?.getAttribute('aria-label') ?? '').length > 20, screen: el.querySelector('[data-product-screen] [data-testid]')?.getAttribute('data-testid') ?? '', icons: el.querySelectorAll('svg').length, width: Math.round(el.querySelector('[data-product-screen]')!.getBoundingClientRect().width) })))
    check(`${width}: four examples, each with a real product screen at true size (no icon stands in for one)`, JSON.stringify(noticeScreens.map((n) => [n.id, n.screen])) === JSON.stringify([['label', 'question-screen'], ['walls', 'takeoff-screen'], ['extra', 'ledger-screen'], ['range', 'range-screen']]) && noticeScreens.every((n) => n.picture === 1 && n.described && n.icons === 0 && n.width >= 300), noticeScreens.map((n) => [n.id, n.screen, n.width]))
    const noticeText = (await notices.innerText()).replace(/\s+/g, ' ')
    check(`${width}: the screens show what the product shows: the reading and "Yes", "${SCREEN_WORDS.estimate.fromPhotos}", "Added for you", and the range the product gave`, noticeText.includes('We read 50 gal from the tank\'s rating label. Is that right?') && noticeText.includes(SCREEN_WORDS.estimate.fromPhotos) && noticeText.includes(SCREEN_WORDS.estimate.added) && noticeText.includes('$1,890') && noticeText.includes('$2,410'))
    const moved = await p.evaluate(() => document.getAnimations().filter((an) => an.playState === 'running' && document.querySelector('[data-testid=notices]')!.contains((an.effect as KeyframeEffect | null)?.target ?? null)).length)
    check(`${width}: nothing moves in "What it notices" (Home keeps one moment: the price sentence)`, moved === 0, moved)

    check(`${width}: Home does not scroll sideways`, await noSideways(p))
    const perScreen = await yellowPerScreen(p)
    const yellow = await yellowButtons(p)
    check(`${width}: one yellow call to action per screen, never two: the hero's and the closing band's`, Math.max(...perScreen) === 1 && perScreen[0] === 1 && yellow.length === 2 && yellow.every((y) => y.text === 'Try it free: 10 quotes, no card'), { screens: perScreen.length, max: Math.max(...perScreen), yellow: yellow.map((y) => y.id) })
    await shot(p, `home-${width}`)
    await ctx.close()

    // reduced motion: the finished frames at once, nothing moving
    const still = await contextFor({ width, height, reducedMotion: 'reduce' })
    const r = await still.newPage()
    await r.goto(HOME, { waitUntil: 'domcontentloaded' })
    await r.locator('[data-testid=hero-demo-stage] [data-testid=demo-lead]').waitFor({ state: 'attached', timeout: 30_000 })
    await r.waitForTimeout(400)
    const reduced = await demoState(r)
    check(`${width}, reduced motion: the demo shows its three finished frames at once, and nothing moves`, finished(reduced), reduced)
    await still.close()

    // ====================================================================
    section(`3. Features at ${width}`)
    // ====================================================================
    const fctx = await contextFor({ width, height })
    const f = await fctx.newPage()
    const fErrors: string[] = []
    f.on('pageerror', (e) => fErrors.push(String(e)))
    await f.goto(`${cfg.appUrl}/features`, { waitUntil: 'networkidle' })
    check(`${width}: Features leads with the message line`, (await f.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === MESSAGE_LINE)
    const steps = await f.locator('[data-testid=feature-step]').evaluateAll((els) =>
      els.map((el) => {
        const words = el.querySelector('h2')!.getBoundingClientRect()
        const screen = el.querySelector('[data-testid=feature-screen]')!.getBoundingClientRect()
        const side = screen.top >= words.bottom - 4 ? (Math.abs(screen.left + screen.width / 2 - (words.left + words.width / 2)) < 60 ? 'under, centred' : 'under') : screen.left > words.left ? 'right' : 'left'
        let bg = getComputedStyle(el).backgroundColor
        if (/rgba\(0, 0, 0, 0\)/.test(bg)) bg = 'paper'
        return { id: el.getAttribute('data-step'), headline: el.querySelector('h2')!.textContent ?? '', side: `${side} on ${bg}`, described: (el.querySelector('[data-testid=feature-screen]')!.getAttribute('aria-label') ?? '').length > 30, screenWidth: Math.round(screen.width), boxes: el.querySelectorAll('ul > li.rounded-xl').length }
      })
    )
    check(`${width}: five steps, each with its real screen and no row of text boxes`, JSON.stringify(steps.map((s) => s.id)) === JSON.stringify(FEATURE_STEPS.map((s) => s.id)) && steps.every((s) => s.described && s.screenWidth >= 280 && s.boxes === 0) && JSON.stringify(steps.map((s) => s.headline)) === JSON.stringify(FEATURE_STEPS.map((s) => s.headline)), steps.map((s) => [s.id, s.screenWidth]))
    const alike = steps.filter((s, i) => i > 0 && s.side === steps[i - 1]!.side).map((s) => s.id)
    check(`${width}: no two neighbouring steps share a layout`, alike.length === 0, steps.map((s) => s.side))
    const featureScreens = await f.locator('[data-testid=feature-screen]').evaluateAll((els) => els.map((el) => [...el.querySelectorAll('[data-testid]')].map((x) => x.getAttribute('data-testid')).filter((id) => /screen|sheet/.test(id ?? '')).join('+')))
    check(`${width}: the screens are the form on a phone, a photo with what was read, the price setup, the quote page and Home's numbers`, JSON.stringify(featureScreens) === JSON.stringify(['request-form-screen', 'question-screen', 'price-check-screen', 'estimate-sheet', 'numbers-screen']) && (await f.locator('[data-step=read] img').count()) === 1, featureScreens)
    const fText = (await f.locator('main').innerText()).replace(/\s+/g, ' ')
    check(`${width}: step 05 is "Track"; no "chat", no "minimum job", no "Learn" claim`, fText.includes('See what’s winning work.') && !/\bchat\b/i.test(fText) && !/minimum job/i.test(fText) && !/corrections improve|Learns from/i.test(fText) && fText.includes('“$375 per room, heavy prep adds $250.”'))
    const fYellow = await yellowButtons(f)
    const fPer = await yellowPerScreen(f)
    check(`${width}: the main button is yellow, one per screen: the hero's and the closing band's`, fYellow.length === 2 && fYellow.every((y) => y.href === '/signup' && y.text === 'Try it free: 10 quotes, no card') && Math.max(...fPer) === 1 && fPer[0] === 1, { ids: fYellow.map((y) => y.id), max: Math.max(...fPer) })
    check(`${width}: Features does not scroll sideways, and has no page error`, (await noSideways(f)) && fErrors.length === 0, fErrors)
    await shot(f, `features-${width}`)
    await fctx.close()

    // ====================================================================
    section(`4. The trade pages at ${width}`)
    // ====================================================================
    const tctx = await contextFor({ width, height })
    const t = await tctx.newPage()
    for (const { trade, href, example } of TRADE_PAGES) {
      await t.goto(`${cfg.appUrl}${href}`, { waitUntil: 'networkidle' })
      const name = `${width} ${href}`
      const hero = await t.locator('[data-testid=hero]').evaluate((el) => {
        const h1 = el.querySelector('h1')!.getBoundingClientRect()
        const screen = el.querySelector('[data-testid=trade-hero-screen]')!.getBoundingClientRect()
        return { beside: screen.left >= h1.right - 40 && screen.top < h1.bottom + 200, under: screen.top >= h1.bottom, screenWidth: Math.round(screen.width), label: (el.querySelector('[data-testid=trade-hero-screen]')!.getAttribute('aria-label') ?? '').length, form: el.querySelectorAll('[data-testid=trade-hero-screen] [data-testid=request-form-screen]').length }
      })
      check(`${name}: the hero shows this trade's own form, ${width >= 1000 ? 'beside the headline (the right half is no longer empty)' : 'under the words'}`, hero.form === 1 && hero.label > 30 && hero.screenWidth >= 300 && (width >= 1000 ? hero.beside : hero.under), hero)
      const heroText = (await t.locator('[data-testid=trade-hero-screen]').innerText()).replace(/\s+/g, ' ')
      check(`${name}: the form asks the template's own question (“${example.form.question}”)`, heroText.includes(example.form.question) && heroText.includes(example.form.answer))
      const questions = await t.locator('[data-testid=question-text]').allInnerTexts()
      const takeoffs = await t.locator('[data-testid=takeoff-method]').allInnerTexts()
      const pageText = (await t.locator('main').innerText()).replace(/\s+/g, ' ')
      if (example.reading) {
        const want = SCREEN_WORDS.question.ask(example.reading.value, example.reading.readFrom)
        check(`${name}: it shows what is read for this trade (“${want}”), confirmed by the customer`, questions.length >= 2 && questions.every((q) => q.trim() === want) && pageText.includes(SCREEN_WORDS.question.yes(example.reading.value)), questions.length)
      } else {
        check(`${name}: it claims no label reading (this trade's template reads none)`, questions.length === 0 && !/rating plate|tank label|panel label|reads? (the|it) (label|plate)/i.test(pageText), questions.length)
      }
      if (example.measured) check(`${name}: it shows the wall area worked out from photos, at the template's rate`, takeoffs.length >= 2 && takeoffs.every((m) => m.trim() === SCREEN_WORDS.estimate.fromPhotos) && pageText.includes('$2,300.00'), takeoffs.length)
      else check(`${name}: it claims no measuring from photos`, takeoffs.length === 0 && !/wall area|from (the|their) photos/i.test(pageText))
      const how = await t.locator('[data-testid=how-step]').evaluateAll((els) => els.map((el) => {
        const words = el.querySelector('h3')!.getBoundingClientRect()
        const screen = el.querySelector('[data-testid=how-screen]')!.getBoundingClientRect()
        return { side: screen.top >= words.bottom - 4 ? 'under' : screen.left > words.left ? 'right' : 'left', width: Math.round(screen.width), described: (el.querySelector('[data-testid=how-screen]')!.getAttribute('aria-label') ?? '').length > 20, greyCard: el.classList.contains('bg-surface') && el.classList.contains('rounded-xl') }
      }))
      check(`${name}: "How the price is set" is three steps, each on a real screen (they were three grey cards)`, how.length === 3 && how.every((h) => h.described && h.width >= 280 && !h.greyCard) && (width < 1000 || (how[0]!.side !== how[1]!.side && how[1]!.side !== how[2]!.side)), how.map((h) => [h.side, h.width]))
      check(`${name}: the three small frames are gone`, (await t.locator('[data-testid=product-frame]').count()) === 0)
      const tYellow = await yellowButtons(t)
      const tPer = await yellowPerScreen(t)
      check(`${name}: the main button is yellow, one per screen`, tYellow.length === 2 && tYellow.every((y) => y.href === '/signup') && Math.max(...tPer) === 1 && tPer[0] === 1, { ids: tYellow.map((y) => y.id), max: Math.max(...tPer) })
      const tSections = await sectionsOf(t)
      check(`${name}: no two neighbouring sections share a background; nothing scrolls sideways`, tSections.every((s, i) => i === 0 || s.bg !== tSections[i - 1]!.bg) && (await noSideways(t)), tSections.map((s) => s.bg))
      check(`${name}: the small line carries the message`, (await t.locator('[data-testid=hero]').innerText()).includes(`${MESSAGE_LINE} No website needed.`))
      if (trade.slug === 'water-heaters' || trade.slug === 'painting' || trade.slug === 'plumbing') await shot(t, `trade-${trade.slug}-${width}`)
    }
    await tctx.close()
  }

  // ====================================================================
  section('5. Pricing: the two lines link to the live demo')
  // ====================================================================
  const pctx = await contextFor({ width: 1440, height: 900 })
  const pr = await pctx.newPage()
  await pr.goto(`${cfg.appUrl}/pricing`, { waitUntil: 'networkidle' })
  const links = await pr.locator('[data-testid=plan-demo-link]').evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.trim(), href: el.getAttribute('href') })))
  check('"Hosted estimate pages" and "Your branding on every estimate" link to /demo on every plan that lists them', links.length >= 4 && links.every((l) => l.href === '/demo') && links.some((l) => l.text === 'Hosted estimate pages') && links.some((l) => l.text === 'Your branding on every estimate'), links.length)
  const pricingText = (await pr.locator('main').innerText()).replace(/\s+/g, ' ')
  check('Pricing no longer lists "AI chat", and its answer says the AI works out the job', !/AI chat/.test(pricingText) && pricingText.includes('The AI works out the job; the price is calculated from the prices you set.'))
  await pctx.close()
  await browser.close()
}

// ====================================================================
const failed = checks.filter((c) => !c.pass)
saveJson(outDir, 'checks.json', { checks, notChecked })
if (notChecked.length) console.log(`\nNot checked here:\n${notChecked.map((s) => `  • ${s}`).join('\n')}`)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
