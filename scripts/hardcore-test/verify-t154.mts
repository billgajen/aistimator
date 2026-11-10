// T-154 live check: the home page rewrite and the marketing site, at 390 px and 1440 px.
// Run with the web app up (pnpm dev:web), then:
//   PLAYWRIGHT_DIR=~/estimator-browser npx tsx scripts/hardcore-test/verify-t154.mts
// (playwright and pngjs live outside the repo: see scripts/hardcore-test/browser.mjs)
//
// Screenshots go to the results folder for a human look; the checks are the
// test: the hero says what it is above the fold, nothing scrolls sideways,
// the phone menu and buttons work, the statistics link out, no grade or engine
// words, no founder section while it's empty, and the new metadata.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT, loadEnv, runStamp, shortId } from './lib.mjs'
import { browserDeps, checker, MARKETING_PAGES } from './browser.mjs'

const app = loadEnv().appUrl
const { chromium } = browserDeps()
const { check, finish } = checker()
const out = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t154-${shortId()}`)
mkdirSync(out, { recursive: true })
const BANNED = /\bgrades?\b|determinist|escalat|stronger model|against references|\bexact\b|60 seconds|deposit/i

const browser = await chromium.launch()
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } })
type Page = Awaited<ReturnType<typeof phone.newPage>>
const noSide = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const smallTargets = (p: Page) =>
  p.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('main a, main button, nav a, nav button')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.closest('[aria-hidden="true"]') === null
      })
      .filter((el) => el.getBoundingClientRect().height < 40 && !el.closest('footer, figcaption, blockquote, p'))
      .map((el) => `${(el.textContent ?? '').trim().slice(0, 30)} (${Math.round(el.getBoundingClientRect().height)}px)`)
  )

const p = await phone.newPage()
await p.goto(`${app}/`, { waitUntil: 'networkidle' })
const h1 = (await p.locator('h1').boundingBox())!
const sub = (await p.locator('[data-testid="hero"] p').first().boundingBox())!
const cta = (await p.getByTestId('hero-signup').boundingBox())!
check('390 px: headline, sub-line and the main button are above the fold', h1.y + h1.height < 844 && sub.y + sub.height < 844 && cta.y + cta.height < 844, { h1: Math.round(h1.y), sub: Math.round(sub.y + sub.height), cta: Math.round(cta.y + cta.height) })
check('390 px home: no sideways scroll', await noSide(p))
await p.screenshot({ path: `${out}/home-390.png`, fullPage: true })
await p.screenshot({ path: `${out}/home-390-fold.png` })
const small = await smallTargets(p)
check('390 px home: tap targets at least 40 px tall', small.length === 0, small.slice(0, 6))

await p.getByTestId('site-menu-button').click()
const items = (await p.getByTestId('site-menu').locator('li a').allInnerTexts()).map((s) => s.trim())
check('the phone menu opens with Features, Pricing, Trades, the demo and Log in', JSON.stringify(items) === JSON.stringify(['Features', 'Pricing', 'Trades', 'Try it as a customer', 'Log in']), items)
await p.screenshot({ path: `${out}/menu-390.png` })
await p.getByTestId('site-menu').getByRole('link', { name: 'Pricing', exact: true }).click()
await p.waitForURL(/\/pricing$/)
check('…and its links work (Pricing)', true)

await p.goto(`${app}/`, { waitUntil: 'networkidle' })
await p.getByTestId('hero-demo').click()
await p.waitForURL(/\/demo$/)
check('hero "Try it as a customer" opens /demo', true)
await p.goto(`${app}/`, { waitUntil: 'networkidle' })
await p.getByTestId('hero-signup').click()
await p.waitForURL(/\/signup/)
check('hero "Try it free" opens signup', true)

await p.goto(`${app}/`, { waitUntil: 'networkidle' })
const statLinks = await p.getByTestId('statistics').locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))
check('each statistic links to its source', statLinks.length === 3 && statLinks.every((h) => h.startsWith('https://')), statLinks)
check('no founder section while its file is empty', (await p.getByTestId('founder').count()) === 0)
check('no grades, seals or engine words on the home page', !BANNED.test(await p.locator('main').innerText()))

for (const route of MARKETING_PAGES.filter((r) => r !== '/')) {
  await p.goto(`${app}${route}`, { waitUntil: 'networkidle' })
  check(`390 px ${route}: no sideways scroll, no grades/engine words`, (await noSide(p)) && !BANNED.test(await p.locator('main').innerText()))
  if (route === '/trades/water-heaters' || route === '/features') await p.screenshot({ path: `${out}/${route.replace(/\//g, '_')}-390.png`, fullPage: true })
}

const d = await desk.newPage()
await d.goto(`${app}/`, { waitUntil: 'networkidle' })
check('1440 px home: no sideways scroll', await noSide(d))
check('1440 px: the menu button is hidden and the links show', !(await d.getByTestId('site-menu-button').isVisible()) && (await d.getByRole('link', { name: 'Features' }).first().isVisible()))
await d.screenshot({ path: `${out}/home-1440.png`, fullPage: true })
await d.screenshot({ path: `${out}/home-1440-fold.png` })
await d.goto(`${app}/trades/hvac`, { waitUntil: 'networkidle' })
await d.screenshot({ path: `${out}/trades-hvac-1440.png` })

const og = await fetch(`${app}/opengraph-image`)
const ogBytes = og.ok ? (await og.arrayBuffer()).byteLength : 0
check('the social preview image renders', og.ok && og.headers.get('content-type') === 'image/png' && ogBytes > 5000, ogBytes)
const head = await (await fetch(`${app}/`)).text()
check('home <title> and description carry the new message', head.includes('<title>Instant quotes on your website, in your prices — Aistimator</title>') && head.includes('og:image'))

await browser.close()
console.log(`\nScreenshots: ${out}`)
finish()
