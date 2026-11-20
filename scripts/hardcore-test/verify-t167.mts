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
// T-170: each trade hero has its photograph; Pricing marks what is not live yet.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, shortId, saveJson, runStamp } from './lib.mjs'
import { findConfidenceLanguage } from '../../packages/shared/src/customer-language'
import { TRADES, tradeHref } from '../../apps/web/src/lib/marketing/trades'
import { marketingExample } from '../../apps/web/src/lib/marketing/examples'
import { HERO, MESSAGE_LINE, NOTICES } from '../../apps/web/src/lib/marketing/home-copy'
import { FEATURE_SECTIONS } from '../../apps/web/src/lib/marketing/features-copy'
import { SCREEN_WORDS } from '../../apps/web/src/lib/marketing/screen-words'
import { COMING_SOON, UPCOMING, planCards } from '../../apps/web/src/lib/marketing/plan-claims'
import { PRICING_DEMO_LINKS } from '../../apps/web/src/lib/marketing/site-copy'

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
  // (T-181: that plan line no longer has the word in it, so Pricing needs no exception)
  if (slogan) pageProblems.push(`${pathname}: "${slogan[0]}"`)
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
    // T-187: the on-site app has a section of its own after "Add it anywhere"
    check(`${width}: the sections are in order (T-167, with T-187's app section)`, JSON.stringify(sections.map((s) => s.id)) === JSON.stringify(['hero', 'homeowners', 'notices', 'control', 'setup', 'add-it-section', 'app', 'plans', 'questions', 'closing']), sections.map((s) => s.id))
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
    check(`${width}: the trade links are pills inside "Choose your trade", each linking to its page, the last one "Any other business" (T-195)`, pills.length === 7 && pills.slice(0, 6).every((x) => x.href === '/painting' || (x.href ?? '').startsWith('/trades/')) && pills[6]!.text === 'Any other business: add your own services and prices' && pills[6]!.href === '/signup' && pills.every((x) => x.h >= 44), pills.map((x) => x.text))

    // "What it notices"
    const notices = p.locator('[data-testid=notices]')
    check(`${width}: "What it notices" carries the message line and comes before "Your prices"`, (await notices.locator('h2').innerText()).trim() === NOTICES.heading && (await notices.locator('[data-testid=message-line]').innerText()).trim() === MESSAGE_LINE)
    const noticeScreens = await notices.locator('[data-testid=notice]').evaluateAll((els) => els.map((el) => ({ id: el.getAttribute('data-notice'), title: el.querySelector('h3')?.textContent ?? '', picture: el.querySelectorAll('[data-product-screen][role=img]').length, described: (el.querySelector('[data-product-screen]')?.getAttribute('aria-label') ?? '').length > 20, screen: el.querySelector('[data-product-screen] [data-testid]')?.getAttribute('data-testid') ?? '', icons: el.querySelectorAll('svg').length, width: Math.round(el.querySelector('[data-product-screen]')!.getBoundingClientRect().width) })))
    // T-173: the owner's new order. The message comes first; the walls and the label are the two examples under "What the photos show"
    const photoParts = await notices.locator('[data-testid=notice-part]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-notice-part'), el.querySelector('[data-product-screen] [data-testid]')?.getAttribute('data-testid') ?? '']))
    check(`${width}: four examples, each with a product screen at true size (no icon stands in for one)`, JSON.stringify(noticeScreens.map((n) => [n.id, n.screen])) === JSON.stringify([['words', 'understood-screen'], ['photos', 'takeoff-screen'], ['extra', 'ledger-screen'], ['range', 'range-screen']]) && JSON.stringify(photoParts) === JSON.stringify([['walls', 'takeoff-screen'], ['label', 'question-screen']]) && noticeScreens.every((n) => n.picture === (n.id === 'photos' ? 2 : 1) && n.described && n.icons === 0 && n.width >= 300), noticeScreens.map((n) => [n.id, n.screen, n.width]))
    const noticeText = (await notices.innerText()).replace(/\s+/g, ' ')
    check(`${width}: the screens show what the product shows: the reading and "Yes", "${SCREEN_WORDS.estimate.fromPhotos}", "Added for you", and the range the product gave`, noticeText.includes(SCREEN_WORDS.question.ask('50 gal', 'the tank\'s rating label')) && /from your tank's rating label/.test(noticeText) && noticeText.includes(SCREEN_WORDS.estimate.fromPhotos) && noticeText.includes(SCREEN_WORDS.estimate.added) && noticeText.includes('$1,890') && noticeText.includes('$2,410'))
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
    // T-187: one section per thing a business cares about (it was five numbered steps): seven that are live,
    // then three that are on the way, each marked
    const steps = await f.locator('[data-testid=feature-section]').evaluateAll((els) =>
      els.map((el) => {
        const words = el.querySelector('h2')!.getBoundingClientRect()
        const screen = el.querySelector('[data-testid=feature-screen]')!.getBoundingClientRect()
        const side = screen.top >= words.bottom - 4 ? (Math.abs(screen.left + screen.width / 2 - (words.left + words.width / 2)) < 60 ? 'under, centred' : 'under') : screen.left > words.left ? 'right' : 'left'
        let bg = getComputedStyle(el).backgroundColor
        if (/rgba\(0, 0, 0, 0\)/.test(bg)) bg = 'paper'
        return { id: el.getAttribute('data-feature'), upcoming: el.getAttribute('data-upcoming'), soon: (el.querySelector('[data-testid=coming-soon]') as HTMLElement | null)?.innerText.trim() ?? null, lines: el.querySelectorAll('[data-testid=feature-lines] > li').length, headline: el.querySelector('h2')!.textContent ?? '', side: `${side} on ${bg}`, described: (el.querySelector('[data-testid=feature-screen]')!.getAttribute('aria-label') ?? '').length > 30, screenWidth: Math.round(screen.width), boxes: el.querySelectorAll('ul > li.rounded-xl').length }
      })
    )
    const UPCOMING_KEYS = ['whatsapp', 'app', 'roomScan'] as const
    check(`${width}: seven sections that are live and three on the way, each with its real screen, two or three lines, and no row of text boxes`,
      JSON.stringify(steps.map((s) => s.id)) === JSON.stringify([...FEATURE_SECTIONS.map((s) => s.id), ...UPCOMING_KEYS]) && steps.every((s) => s.described && s.screenWidth >= 240 && s.boxes === 0 && s.lines >= 2 && s.lines <= 3) &&
        JSON.stringify(steps.map((s) => s.headline)) === JSON.stringify([...FEATURE_SECTIONS.map((s) => s.title), ...UPCOMING_KEYS.map((k) => UPCOMING[k].heading)]), steps.map((s) => [s.id, s.screenWidth, s.lines]))
    check(`${width}: what is not live is marked "${COMING_SOON}", and nothing that is live carries the mark`, steps.filter((s) => s.upcoming).length === 3 && steps.every((s) => (s.upcoming ? s.soon === COMING_SOON : s.soon === null)), steps.map((s) => [s.id, s.soon]))
    const alike = steps.filter((s, i) => i > 0 && s.side === steps[i - 1]!.side).map((s) => s.id)
    check(`${width}: no two neighbouring steps share a layout`, alike.length === 0, steps.map((s) => s.side))
    const featureScreens = await f.locator('[data-testid=feature-screen]').evaluateAll((els) => els.map((el) => [...el.querySelectorAll('[data-testid]')].map((x) => x.getAttribute('data-testid')).filter((id) => /screen|sheet/.test(id ?? '')).join('+')))
    check(`${width}: the screens are a photo with what was read, the price setup, two services in one breakdown, the request to approve, the quote page, the link and QR code, the message with what was made of it; then a chat, the app and the room scan card`,
      JSON.stringify(featureScreens) === JSON.stringify(['question-screen', 'price-check-screen', 'sections-screen', 'approve-screen', 'estimate-sheet', 'setup-screen-link', 'understood-screen', '', '', '']) && (await f.locator('[data-feature=photos] img').count()) === 1 &&
        (await f.locator('[data-feature=whatsapp] [data-testid=chat-reply]').count()) === 1 && (await f.locator('[data-feature=app] [data-testid=app-phone]').count()) === 1 && (await f.locator('[data-feature=roomScan] [data-testid=room-scan-card]').count()) === 1, featureScreens)
    const fText = (await f.locator('main').innerText()).replace(/\s+/g, ' ')
    check(`${width}: no chat form, no "minimum job", no "Learn" claim, no PDF; the price sentence is Home's`, !/chat form|form or a chat/i.test(fText) && !/minimum job/i.test(fText) && !/corrections improve|Learns from/i.test(fText) && !/\bPDFs?\b/.test(fText) && fText.includes('“$375 per room, heavy prep adds $250.”'))
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
      // T-171: the real page's "Measurement & takeoff" block says what was measured in one sentence, with no
      // amount (the price is in the breakdown, once), so the picture of it does too
      if (example.measured) {
        const blocks = (await t.locator('[data-testid=takeoff-screen]').allInnerTexts()).map((b) => b.replace(/\s+/g, ' '))
        const sentence = SCREEN_WORDS.estimate.measuredLine(example.measured)
        check(`${name}: it shows the wall area worked out from photos, as the real page says it ("${sentence}"), with no amount in that block`, takeoffs.length >= 2 && takeoffs.every((m) => m.trim() === SCREEN_WORDS.estimate.fromPhotos) && sentence.length > 20 && blocks.length >= 2 && blocks.every((b) => b.includes(sentence) && !/\$\s?\d/.test(b)), blocks.map((b) => b.slice(0, 120)))
      }
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
      // T-170: the hero has a photograph of the trade's work behind it; the trade's real screen is still the picture of the product
      const tPhoto = await t.locator('[data-testid=hero] [data-testid=hero-photo] img').evaluate((img) => ({ file: (img as HTMLImageElement).currentSrc.split('/').pop() ?? '', alt: (img as HTMLImageElement).alt.length, loaded: (img as HTMLImageElement).naturalWidth > 0 }))
      check(`${name}: the hero has this trade's own photograph behind it, with alt text and no caption (T-170)`, tPhoto.loaded && tPhoto.file.startsWith(`trade-${trade.slug}-`) && tPhoto.alt > 40 && (await t.locator('[data-testid=hero] figcaption').count()) === 0, tPhoto)
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
  // T-170: how many there are follows the plans the page shows (it was "four or more", when three plans were shown)
  // T-181: the two lines are worded as what the business gets; their words come from the copy file
  const DEMO_LINES: string[] = [PRICING_DEMO_LINKS.hostedPages, PRICING_DEMO_LINKS.branding]
  // T-187: a plan card lists only what the plan adds, so each of the two lines is on one card; the compare
  // table has a row for each, linked too
  const demoLinksWanted = planCards().flatMap((card) => card.lines).filter((l) => DEMO_LINES.includes(l.label)).length + DEMO_LINES.length
  check('the estimate-page line and the own-brand line link to /demo, on the plan card that lists each and in the compare table', links.length === demoLinksWanted && links.length >= 4 && links.every((l) => l.href === '/demo') && DEMO_LINES.every((label) => links.filter((l) => l.text === label).length === 2), links)
  const pricingText = (await pr.locator('main').innerText()).replace(/\s+/g, ' ')
  // T-170: a plan line that is not live yet says so
  const later = await pr.locator('[data-testid=plan-line][data-live=false]').evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
  // (the owner's decision: Business is left off the page until a line of its own is live, so these are Pro's)
  const laterWanted = planCards().flatMap((card) => card.lines.filter((l) => !l.live).map((l) => l.label))
  check(`Pricing marks every line that is not live yet "${COMING_SOON}" (T-170; the words are T-187's): ${[...new Set(laterWanted)].join(', ')}`, later.length === laterWanted.length && later.length >= 2 && later.every((l) => l.endsWith(COMING_SOON)) && laterWanted.every((label) => later.some((l) => l.includes(label))), later)
  // T-187: the questions are rows that open, so a closed answer is on the page but not in its visible text
  const pricingAll = ((await pr.locator('main').textContent()) ?? '').replace(/\s+/g, ' ')
  check('Pricing no longer lists "AI chat", and its answer says the AI works out the job', !/AI chat/.test(pricingAll) && pricingAll.includes('The AI works out the job; the price is calculated from the prices you set.'))
  await pctx.close()
  await browser.close()
}

// ====================================================================
const failed = checks.filter((c) => !c.pass)
saveJson(outDir, 'checks.json', { checks, notChecked })
if (notChecked.length) console.log(`\nNot checked here:\n${notChecked.map((s) => `  • ${s}`).join('\n')}`)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
