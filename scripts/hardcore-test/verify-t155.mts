// T-155 live check: the home page polish after the T-154 review, at 390 px and 1440 px.
// Run with the web app up (pnpm dev:web), then:
//   PLAYWRIGHT_DIR=~/estimator-browser npx tsx scripts/hardcore-test/verify-t155.mts
// (playwright and pngjs live outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 1. the hero small line; 2. no "in a minute"; 3. the header button on one
// line ("Try it free" on a phone, the full offer on desktop); 4. the phone
// menu covers the screen, locks scroll, closes three ways and returns focus;
// 5. the product frames are equal and the button sits under the content;
// 6. no yellow rule in the social image; 7. the features promises reworded to
// what is live (no PDF, reminder, price-comparison claims). Plus: no sideways scroll anywhere,
// and the main hero button still above the fold on a phone.
import { loadEnv } from './lib.mjs'
import { browserDeps, checker, MARKETING_PAGES } from './browser.mjs'

const app = loadEnv().appUrl
const { chromium, PNG } = browserDeps()
const { check, finish } = checker()
const OFFER = 'Try it free: 10 quotes, no card'
/** Content-to-button spacing is 12 px; the frames' contents differ a little by trade */
const MAX_GAP = 64
const STRIP_PAGES = ['/', '/painting', '/trades/hvac', '/trades/water-heaters', '/trades/plumbing', '/trades/electrical', '/trades/garage-doors']

const browser = await chromium.launch()
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } })
type Page = Awaited<ReturnType<typeof phone.newPage>>
const noSide = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
/** Lines of text an element wraps to (rects of its text, grouped by top) */
const lines = (p: Page, testId: string) =>
  p.getByTestId(testId).evaluate((el) => {
    const visible = [...el.querySelectorAll('span')].find((s) => getComputedStyle(s).display !== 'none') ?? el
    const r = document.createRange()
    r.selectNodeContents(visible)
    return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size
  })
const frames = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll('[data-testid="product-frame"]')].map((f) => {
      const shell = f.querySelector('figcaption + div')!
      const content = shell.firstElementChild!.firstElementChild!
      const kids = [...content.children]
      const button = kids[kids.length - 1]!.firstElementChild!
      return {
        height: Math.round(f.getBoundingClientRect().height),
        gap: Math.round(button.getBoundingClientRect().top - kids[kids.length - 2]!.getBoundingClientRect().bottom),
        overflow: Math.round(shell.getBoundingClientRect().bottom - f.getBoundingClientRect().bottom),
      }
    })
  )

for (const [label, ctx] of [['390 px', phone], ['1440 px', desk]] as const) {
  const p = await ctx.newPage()
  await p.goto(`${app}/`, { waitUntil: 'networkidle' })
  const hero = await p.getByTestId('hero').innerText()

  // 1. the small line
  check(`${label} home: "No website? Use your quote link." under the buttons`, hero.includes('For contractors and home-service businesses. No website? Use your quote link.') && !hero.includes('No website needed'))
  // 2. no time claim
  const main = await p.locator('main').innerText()
  check(`${label} home: "Add it anywhere", no "in a minute"`, main.includes('Add it anywhere') && !/in a minute/i.test(main))

  // 3. the header button
  const header = (await p.getByTestId('nav-signup').innerText()).trim()
  const want = label === '390 px' ? 'Try it free' : OFFER
  check(`${label} header button reads "${want}", on one line`, header === want && (await lines(p, 'nav-signup')) === 1, { header, lines: await lines(p, 'nav-signup') })
  check(`${label} hero button keeps the full offer`, (await p.getByTestId('hero-signup').innerText()).trim() === OFFER)

  // the main hero button above the fold (phone)
  if (label === '390 px') {
    const cta = (await p.getByTestId('hero-signup').boundingBox())!
    check('390 px: the main hero button is still above the fold', cta.y + cta.height <= 844, Math.round(cta.y + cta.height))
  }

  // 5. the product frames, home and every trade page
  for (const route of STRIP_PAGES) {
    if (route !== '/') await p.goto(`${app}${route}`, { waitUntil: 'networkidle' })
    const f = await frames(p)
    const heights = new Set(f.map((x) => x.height))
    check(`${label} ${route}: three frames, the same height, button under the content`, f.length === 3 && Math.max(...f.map((x) => x.height)) - Math.min(...f.map((x) => x.height)) <= 1 && f.every((x) => x.gap <= MAX_GAP && x.overflow <= 0), { heights: [...heights], gaps: f.map((x) => x.gap) })
  }

  // 7. the features promises, reworded to what is live
  await p.goto(`${app}/features`, { waitUntil: 'networkidle' })
  const feat = await p.locator('main').innerText()
  const wantFeat = ['Estimate page in your branding', 'Estimates expire automatically', 'See the working behind every sent estimate', 'Your dashboard shows which services win work and where requests stall.']
  check(`${label} /features: the reworded lines`, wantFeat.every((s) => feat.includes(s)) && (feat.match(/See the working behind every sent estimate/g) ?? []).length === 2, wantFeat.filter((s) => !feat.includes(s)))
  const OLD_CLAIMS = /\bPDFs?\b|remind|price comparison|compare with similar|anonymi[sz]ed|every quantity was worked out|working visible/i
  const claimHits: string[] = []
  for (const route of ['/', '/features', '/pricing', '/trades', ...STRIP_PAGES.filter((r) => r !== '/')]) {
    await p.goto(`${app}${route}`, { waitUntil: 'networkidle' })
    const hit = OLD_CLAIMS.exec(await p.locator('main').innerText())
    if (hit) claimHits.push(`${route}: ${hit[0]}`)
  }
  check(`${label}: no PDF, reminder, price-comparison or every-quantity claim on home, features, pricing or trade pages`, claimHits.length === 0, claimHits)
  await p.goto(`${app}/painting`, { waitUntil: 'networkidle' })
  check(`${label} /painting: "See the working behind every sent estimate."`, (await p.locator('main').innerText()).includes('See the working behind every sent estimate.'))

  // trade pages keep their own small line
  await p.goto(`${app}/trades/hvac`, { waitUntil: 'networkidle' })
  check(`${label} trade page keeps "No website needed."`, (await p.getByTestId('hero').innerText()).includes('Your prices set the estimate, never the AI. No website needed.'))

  // no sideways scroll anywhere
  const sideways: string[] = []
  for (const route of MARKETING_PAGES) {
    await p.goto(`${app}${route}`, { waitUntil: 'networkidle' })
    if (!(await noSide(p))) sideways.push(route)
    if (/in a minute/i.test(await p.locator('main').innerText())) sideways.push(`${route} (in a minute)`)
  }
  check(`${label}: no sideways scroll and no "in a minute" on any marketing page`, sideways.length === 0, sideways)
  await p.close()
}

// 4. the phone menu
const p = await phone.newPage()
await p.goto(`${app}/`, { waitUntil: 'networkidle' })
await p.evaluate(() => window.scrollTo(0, 300))
await p.waitForTimeout(100)
const button = p.getByTestId('site-menu-button')
await button.click()
const menu = p.getByTestId('site-menu')
const box = (await menu.boundingBox())!
check('menu: covers the whole screen', Math.round(box.x) === 0 && Math.round(box.y) === 0 && Math.round(box.width) === 390 && Math.round(box.height) === 844, box)
const covered = await p.evaluate(() => {
  const panel = document.querySelector('[data-testid="site-menu"]')!
  const bg = getComputedStyle(panel).backgroundColor
  const pts: Array<[number, number]> = []
  for (let y = 5; y < 844; y += 40) for (let x = 5; x < 390; x += 60) pts.push([x, y])
  const leaks = pts.filter(([x, y]) => !panel.contains(document.elementFromPoint(x, y)))
  return { leaks: leaks.length, bg, opaque: /^rgb\(/.test(bg) || /, 1\)$/.test(bg) }
})
check('menu: nothing of the page shows at any point (hero buttons, frames, content)', covered.leaks === 0 && covered.opaque, covered)
check('menu: the hero buttons and product frames are under it', await p.evaluate(() => {
  const panel = document.querySelector('[data-testid="site-menu"]')!
  return ['hero-signup', 'hero-demo', 'product-strip'].every((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)!
    const r = el.getBoundingClientRect()
    const x = Math.min(Math.max(r.left + 10, 1), 389), y = Math.min(Math.max(r.top + 10, 1), 843)
    return r.bottom < 0 || r.top > 844 || panel.contains(document.elementFromPoint(x, y))
  })
}))
const links = (await menu.locator('li a').allInnerTexts()).map((s) => s.trim())
check('menu: the five links', JSON.stringify(links) === JSON.stringify(['Features', 'Pricing', 'Trades', 'Try it as a customer', 'Log in']), links)
const signup = menu.getByTestId('site-menu-signup')
const signupBox = (await signup.boundingBox())!
const lastLink = (await menu.locator('li a').last().boundingBox())!
check(`menu: one "${OFFER}" button under them`, (await menu.getByRole('link', { name: OFFER }).count()) === 1 && signupBox.y >= lastLink.y + lastLink.height && (await signup.getAttribute('href')) === '/signup')

// scroll lock
const before = await p.evaluate(() => window.scrollY)
const locked = await p.evaluate(() => [getComputedStyle(document.documentElement).overflow, getComputedStyle(document.body).overflow])
await p.mouse.wheel(0, 600).catch(() => undefined)
await p.touchscreen.tap(200, 700).catch(() => undefined)
await p.waitForTimeout(200)
const after = await p.evaluate(() => window.scrollY)
check('menu: the page behind can’t scroll', locked.every((o) => o === 'hidden') && after === before, { locked, before, after })

// close: the X
await menu.getByTestId('site-menu-close').click()
await p.waitForTimeout(100)
check('menu: the X closes it and focus returns to the menu button', (await menu.count()) === 0 && (await button.evaluate((el) => el === document.activeElement)), await p.evaluate(() => document.activeElement?.getAttribute('data-testid')))
check('…and the page scrolls again', await p.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden' && getComputedStyle(document.body).overflow !== 'hidden'))
// close: Escape
await button.click()
await p.keyboard.press('Escape')
await p.waitForTimeout(100)
check('menu: Escape closes it and focus returns to the menu button', (await menu.count()) === 0 && (await button.evaluate((el) => el === document.activeElement)))
// close: a link
await button.click()
await menu.getByRole('link', { name: 'Pricing', exact: true }).click()
await p.waitForURL(/\/pricing$/)
await p.waitForTimeout(150)
check('menu: a link closes it and opens the page; focus on the menu button', (await p.getByTestId('site-menu').count()) === 0 && (await p.getByTestId('site-menu-button').evaluate((el) => el === document.activeElement)))
check('…and the new page scrolls', await p.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'))
await p.close()

const d = await desk.newPage()
await d.goto(`${app}/`, { waitUntil: 'networkidle' })
check('1440 px: no menu button (desktop links instead)', !(await d.getByTestId('site-menu-button').isVisible()))
await d.close()

// 6. the social image: no tape-yellow (#DCAF3E) rule
const og = await fetch(`${app}/opengraph-image`)
const png = PNG.sync.read(Buffer.from(await og.arrayBuffer()))
let yellow = 0
for (let i = 0; i < png.data.length; i += 4) {
  const [r, g, b] = [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!]
  if (Math.abs(r - 0xdc) < 24 && Math.abs(g - 0xaf) < 24 && Math.abs(b - 0x3e) < 30) yellow++
}
check('social image: renders, with no yellow line', og.ok && png.width === 1200 && png.height === 630 && yellow === 0, { yellow })

await browser.close()
finish()
