// T-170 live check: marketing photographs and fixes.
// Run (local web app up; the demo's sample photos are uploaded, so storage
// must be configured; no estimate is requested, so the worker is not needed):
//   PLAYWRIGHT_DIR=<folder with playwright> npx tsx scripts/hardcore-test/verify-t170.mts
// (playwright lives outside the repo: see scripts/hardcore-test/browser.mjs)
//
// 0. the files: every photograph the pages use is in the repo as WebP at the
//    sizes the ticket asks for, is recorded in Docs/design/photos.md, and
//    nothing else is in the photo folders;
// then, in a browser at 390, 768, 1024, 1280 and 1440:
// 1. Home's hero: the photograph is never a block above the headline; from
//    768 px it is the band's background with the painter on the right; under
//    768 px it fills the top and fades into paper with the headline over the
//    faded part, on the first screen at 390 x 844;
// 2. "Add it anywhere": three columns of one height with pictures of one
//    size (stacked on a phone), our real QR code on the van, the business's
//    name on one line in a phone-shaped frame, links short and never broken
//    inside a word;
// 3. the closing band: the evening photograph, light words on solid juniper;
// 4. the six trade pages: the same treatment, with the trade's own screen
//    still in the hero;
// 5. /demo: "Use a sample photo" adds the photo that matches the service;
// 6. Pricing: a line that is not live is marked "Coming later";
// and everywhere: contrast of the words over every photograph (measured from
// the painted pixels, at the worst point), fixed image dimensions, one
// priority image per page, no layout shift, no sideways scroll.
import path from 'node:path'
import { mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { ROOT, loadEnv, shortId, saveJson, runStamp } from './lib.mjs'
import { TRADES, tradeHref } from '../../apps/web/src/lib/marketing/trades'
import { TRADE_PHOTOS, CLOSING_PHOTO, VAN_PHOTO } from '../../apps/web/src/lib/marketing/photos'
import { HERO_PHOTO } from '../../apps/web/src/lib/marketing/hero-photo'
import { DEMO_SAMPLE_PHOTOS } from '../../apps/web/src/lib/demo/sample-photos'
import { DEMO_SERVICE_PICKS } from '../../apps/web/src/lib/demo/demo-services'
import { COMING_LATER, planLines, sitePlans } from '../../apps/web/src/lib/marketing/plan-claims'
import { offeredPlans } from '../../packages/shared/src/plans'
import { qrMatrix } from '../../apps/web/src/lib/qr'
import { DEMO_BUSINESS_NAME, DEMO_SLUG } from '../../packages/shared/src/demo'

const cfg = loadEnv()
const outDir = path.join(ROOT, 'scripts/hardcore-test/results', `${runStamp()}-t170-${shortId()}`)
mkdirSync(outDir, { recursive: true })
const checks: Array<{ name: string; pass: boolean; detail?: unknown }> = []
const check = (name: string, pass: boolean, detail?: unknown) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? '✅' : '❌'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`)
}
const notChecked: string[] = []
const section = (title: string) => console.log(`\n── ${title} ──`)
const WIDTHS = [390, 768, 1024, 1280, 1440]
const PUBLIC = path.join(ROOT, 'apps/web/public')
const TRADE_PAGES = TRADES.map((t) => ({ slug: t.slug, href: tradeHref(t), photo: TRADE_PHOTOS[t.slug]! }))
/** The contrast figures, for the report: page, width, what, worst ratio */
const contrast: Array<{ page: string; width: number; what: string; ratio: number }> = []

// ====================================================================
section('0. The photograph files')
// ====================================================================
const isWebp = (file: string) => {
  const head = readFileSync(file).subarray(0, 12).toString('latin1')
  return head.startsWith('RIFF') && head.endsWith('WEBP')
}
const kb = (file: string) => Math.round(statSync(file).size / 1024)
const record = readFileSync(path.join(ROOT, 'Docs/design/photos.md'), 'utf8')
const scenes = [...TRADE_PAGES.map((t) => ({ name: `trade page ${t.slug}`, photo: t.photo })), { name: 'the closing band', photo: CLOSING_PHOTO }]
check('each of the six trade pages has a photograph of its own', TRADE_PAGES.every((t) => Boolean(t.photo)) && new Set(TRADE_PAGES.map((t) => t.photo?.base)).size === 6, TRADE_PAGES.map((t) => t.photo?.base))
for (const s of scenes) {
  const big = path.join(PUBLIC, `${s.photo.base}-2400.webp`)
  const small = path.join(PUBLIC, `${s.photo.base}-1200.webp`)
  const ok = existsSync(big) && existsSync(small) && isWebp(big) && isWebp(small) && statSync(big).size < 300 * 1024 && statSync(small).size < statSync(big).size
  check(`${s.name}: WebP at 2400 px under 300 KB, and a 1200 px file; real alt text; recorded`, ok && s.photo.width === 2400 && s.photo.alt.length > 40 && record.includes(path.basename(big)), ok ? { kb2400: kb(big), kb1200: kb(small) } : 'missing')
}
const van = [path.join(PUBLIC, VAN_PHOTO.src), path.join(PUBLIC, VAN_PHOTO.srcSmall)]
check('the van: two WebP files under 300 KB (it is a column picture, so 1000 px is its largest), recorded', van.every((f) => existsSync(f) && isWebp(f) && statSync(f).size < 300 * 1024) && record.includes('van-1000.webp'), van.map((f) => (existsSync(f) ? kb(f) : 'missing')))
const samples = Object.entries(DEMO_SAMPLE_PHOTOS)
check('the demo: one sample photo for each demo service, each file in the repo and recorded', DEMO_SERVICE_PICKS.every((p) => Boolean(DEMO_SAMPLE_PHOTOS[p.name])) && samples.length === DEMO_SERVICE_PICKS.length && samples.every(([, src]) => existsSync(path.join(PUBLIC, src)) && record.includes(path.basename(src))), samples)
const newSamples = samples.map(([, src]) => src).filter((src) => src.endsWith('.webp'))
check('the two new demo samples are WebP, 1200 px only, under 300 KB', newSamples.length === 2 && newSamples.every((src) => isWebp(path.join(PUBLIC, src)) && statSync(path.join(PUBLIC, src)).size < 300 * 1024 && !existsSync(path.join(PUBLIC, src.replace('.webp', '-2400.webp')))), newSamples.map((src) => kb(path.join(PUBLIC, src))))
const expectedPhotos = ['hero-b-1200.webp', 'hero-b-2400.webp', 'hero-sizes.json', 'photo-sizes.json', 'van-1000.webp', 'van-500.webp', ...scenes.flatMap((s) => [`${path.basename(s.photo.base)}-1200.webp`, `${path.basename(s.photo.base)}-2400.webp`])].sort()
check('nothing else is in the photo folder: no candidate, no rejected image', JSON.stringify(readdirSync(path.join(PUBLIC, 'photos')).sort()) === JSON.stringify(expectedPhotos), readdirSync(path.join(PUBLIC, 'photos')).filter((f) => !expectedPhotos.includes(f)))
check('…and the demo folder holds the logo, the label and the two new samples only', JSON.stringify(readdirSync(path.join(PUBLIC, 'demo')).sort()) === JSON.stringify(['example-home-services-logo.svg', 'sample-garage-door-springs.webp', 'sample-room-to-paint.webp', 'sample-water-heater-label.png', 'sample-water-heater-label.svg']), readdirSync(path.join(PUBLIC, 'demo')))
check('every prompt is recorded with what was rejected', ['A plain white panel van', 'An electrician in their thirties', 'A homeowner in their forties in a plain cream sweater', 'looking up at the wall above a closed white sectional garage door', 'An ordinary bedroom in an American home', 'What was rejected, and why (T-170)'].every((part) => record.includes(part)))
for (const p of ['/', '/pricing', '/demo', ...TRADE_PAGES.map((t) => t.href)]) {
  const res = await fetch(`${cfg.appUrl}${p}`)
  if (res.status !== 200) check(`${p} loads`, false, res.status)
}

if (!process.env.PLAYWRIGHT_DIR) {
  notChecked.push('Everything a browser paints: the layouts at five widths, the contrast over each photograph, "Add it anywhere", the demo\'s sample photos. Set PLAYWRIGHT_DIR to run it.')
} else {
  const { browserDeps } = await import('./browser.mjs')
  const { chromium, PNG } = browserDeps()
  const browser = await chromium.launch()
  type Ctx = Awaited<ReturnType<typeof browser.newContext>>
  type Page = Awaited<ReturnType<Ctx['newPage']>>

  const lum = (r: number, g: number, b: number) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

  /** Every image on the page has arrived (the lazy ones too), then back to the top */
  const settle = async (p: Page) => {
    await p.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))))
      window.scrollTo(0, 0)
    })
    await p.waitForTimeout(200)
  }

  /**
   * The page as it is painted with its words taken out (and the sticky menu
   * hidden), so that what is left under each word is exactly what the word
   * sits on. One picture of the whole page; `worst` then reads the pixels
   * under an element's own lines of text.
   */
  const paintedWithoutWords = async (p: Page) => {
    const tag = await p.addStyleTag({ content: '* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important } nav[aria-label="Site"] { visibility: hidden !important }' })
    const png = PNG.sync.read(await p.screenshot({ fullPage: true }))
    await tag.evaluate((el) => el.remove())
    return png as { width: number; height: number; data: Buffer }
  }
  /** Where an element's lines of text are on the page, and its text colour */
  const linesOf = (p: Page, selector: string) =>
    p.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return null
      const range = document.createRange()
      range.selectNodeContents(el)
      const m = (getComputedStyle(el).color.match(/[\d.]+/g) ?? []).map(Number)
      return { rects: [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2).map((r) => ({ x: Math.floor(r.left), y: Math.floor(r.top + scrollY), w: Math.ceil(r.width), h: Math.ceil(r.height) })), colour: [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0] }
    }, selector)
  /** The lowest contrast between an element's text colour and any pixel under its lines */
  const worst = async (p: Page, png: { width: number; height: number; data: Buffer }, selector: string) => {
    const lines = await linesOf(p, selector)
    if (!lines || lines.rects.length === 0) return null
    const text = lum(lines.colour[0]!, lines.colour[1]!, lines.colour[2]!)
    let low = Infinity
    for (const r of lines.rects) {
      for (let y = Math.max(0, r.y); y < Math.min(png.height, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(png.width, r.x + r.w); x++) {
          const i = (y * png.width + x) * 4
          const c = ratio(text, lum(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!))
          if (c < low) low = c
        }
      }
    }
    return { ratio: Math.round(low * 100) / 100, dark: text < 0.18 }
  }
  const measure = async (p: Page, png: { width: number; height: number; data: Buffer }, page: string, width: number, what: string, selector: string) => {
    const w = await worst(p, png, selector)
    if (w) contrast.push({ page, width, what, ratio: w.ratio })
    return w
  }
  /** A photograph on the page: loaded, its attributes, where its box is */
  const photoOf = (p: Page, selector: string) =>
    p.evaluate(async (sel) => {
      const box = document.querySelector(sel) as HTMLElement | null
      const img = box?.querySelector('img') as HTMLImageElement | null
      if (!box || !img) return null
      if (!img.complete) await img.decode().catch(() => undefined)
      const r = box.getBoundingClientRect()
      return {
        loaded: img.complete && img.naturalWidth > 0, file: img.currentSrc.split('/').pop() ?? '', alt: img.alt, attrs: `${img.getAttribute('width')}x${img.getAttribute('height')}`,
        priority: img.getAttribute('fetchpriority'), loading: img.getAttribute('loading'), position: getComputedStyle(box).position,
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY),
        objectX: getComputedStyle(img).objectPosition.split(' ')[0] ?? '', captions: box.querySelectorAll('figcaption').length,
      }
    }, selector)
  const rectOf = (p: Page, selector: string) =>
    p.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), width: Math.round(r.width), height: Math.round(r.height) }
    }, selector)
  const sideways = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  /** The layout shift the page has had since it began to load */
  const shiftOf = (p: Page) =>
    p.evaluate(() => new Promise<number>((resolve) => {
      let total = 0
      new PerformanceObserver((list) => { for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) total += e.value }).observe({ type: 'layout-shift', buffered: true })
      setTimeout(() => resolve(Math.round(total * 1000) / 1000), 300)
    }))
  const priorityImages = (p: Page) => p.locator('img[fetchpriority=high]').evaluateAll((els) => els.map((el) => (el as HTMLImageElement).currentSrc.split('/').pop()))
  /** A photograph (ours, under /photos or a demo sample) without its width and height. The estimate sheet's logo is the customer page's own part and is not this ticket's. */
  const unsizedImages = (p: Page) => p.locator('main img').evaluateAll((els) => els.filter((el) => /\/photos\/|\/demo\/sample/.test((el as HTMLImageElement).src) && !(el.getAttribute('width') && el.getAttribute('height'))).map((el) => (el as HTMLImageElement).src.split('/').pop()))

  for (const width of WIDTHS) {
    const height = width < 600 ? 844 : 900
    const phone = width < 768
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await ctx.addInitScript('globalThis.__name = (f) => f')
    const p = await ctx.newPage()
    const errors: string[] = []
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))

    // ==================================================================
    section(`1. Home's hero at ${width}`)
    // ==================================================================
    await p.goto(`${cfg.appUrl}/`, { waitUntil: 'networkidle' })
    const homeShift = await shiftOf(p)
    await p.screenshot({ path: path.join(outDir, `home-top-${width}.png`) })
    await settle(p)
    const hero = await photoOf(p, '[data-testid=hero-photo]')
    const band = await rectOf(p, '[data-testid=hero]')
    const h1 = await rectOf(p, '[data-testid=hero] h1')
    const line = await rectOf(p, '[data-testid=hero] h1 + p')
    const card = await rectOf(p, '[data-testid=demo-card]')
    check(`${width} Home: the hero photograph has loaded, with alt text, fixed dimensions and high priority`, !!hero && hero.loaded && /^hero-b-(1200|2400)\.webp$/.test(hero.file) && hero.alt === HERO_PHOTO.alt && hero.attrs === '2400x1451' && hero.priority === 'high' && hero.loading === 'eager' && hero.captions === 0, hero)
    check(`${width} Home: the photograph is never a block of its own above the headline: it is behind the band, and the headline starts on it`, !!hero && !!h1 && !!band && hero.position === 'absolute' && hero.top === band.top && hero.left === 0 && hero.width === width && h1.top > hero.top && h1.top < hero.bottom, hero && h1 && { photo: [hero.top, hero.bottom], h1Top: h1.top })
    const homePng = await paintedWithoutWords(p)
    if (phone) {
      // the photograph fills the top and fades into paper; the headline starts over the faded part
      const bottomRow = (() => { const y = hero!.bottom - 1; const out: number[] = []; for (const x of [10, Math.floor(width / 2), width - 10]) { const i = (y * homePng.width + x) * 4; out.push(homePng.data[i]!, homePng.data[i + 1]!, homePng.data[i + 2]!) } return out })()
      const topRow = (() => { const y = hero!.top + 8; let off = 0; for (let x = 4; x < width; x += 8) { const i = (y * homePng.width + x) * 4; if (Math.abs(homePng.data[i]! - 250) + Math.abs(homePng.data[i + 1]! - 249) + Math.abs(homePng.data[i + 2]! - 246) > 24) off++ } return off })()
      check(`${width} Home: the photograph fills the top of the hero (it is the picture there, not paper) and has faded into paper by its bottom edge`, topRow > 20 && bottomRow.every((v, i) => Math.abs(v - [250, 249, 246][i % 3]!) <= 2), { pictureAtTop: topRow, bottomRow })
      const share = (h1!.top - hero!.top) / (hero!.bottom - hero!.top)
      check(`${width} Home: the headline starts over the faded part (the lower half of the photograph)`, share >= 0.5 && share <= 0.95, Math.round(share * 100) / 100)
      check(`${width} Home: the whole headline is on the first screen (${width} x ${height})`, h1!.bottom <= height, { h1Bottom: h1!.bottom })
    } else {
      check(`${width} Home: the photograph is the band's background, the same layout as on a computer: it runs behind the words and past them`, hero!.bottom > line!.bottom && hero!.right === width, { photoBottom: hero!.bottom, lineBottom: line!.bottom })
      // the painter: the picture is placed so that he is right of the words
      const x = hero!.objectX
      check(`${width} Home: the painter sits on the right (the picture is placed ${x} across)`, x === '100%' || parseFloat(x) >= 70, x)
      const onPhoto = Math.round(((hero!.bottom - card!.top) / card!.height) * 100) / 100
      check(`${width} Home: the three frames sit half on the photograph and half on the page`, onPhoto >= 0.4 && onPhoto <= 0.6, onPhoto)
      // the line under the headline is on solid paper: every pixel under it is the paper colour
      const under = await linesOf(p, '[data-testid=hero] h1 + p')
      let offPaper = 0
      for (const r of under!.rects) for (let y = r.y; y < r.y + r.h; y += 2) for (let x2 = r.x; x2 < r.x + r.w; x2 += 2) { const i = (y * homePng.width + x2) * 4; if (Math.abs(homePng.data[i]! - 250) + Math.abs(homePng.data[i + 1]! - 249) + Math.abs(homePng.data[i + 2]! - 246) > 6) offPaper++ }
      check(`${width} Home: the fade is strong enough that the line under the headline sits on solid paper`, offPaper === 0, offPaper)
    }
    const hBody = await measure(p, homePng, 'Home hero', width, 'line under the headline', '[data-testid=hero] h1 + p')
    const hHead = await measure(p, homePng, 'Home hero', width, 'headline', '[data-testid=hero] h1')
    const hSmall = await measure(p, homePng, 'Home hero', width, 'small line', '[data-testid=hero] .hero-small-line')
    check(`${width} Home: dark words on light; the line under the headline keeps 4.5:1 at its worst point (${hBody?.ratio}:1)`, !!hBody && hBody.dark && hBody.ratio >= 4.5, hBody)
    check(`${width} Home: the headline (${hHead?.ratio}:1) and the small line (${hSmall?.ratio}:1) keep 4.5:1 at their worst points too`, !!hHead && hHead.dark && hHead.ratio >= 4.5 && !!hSmall && hSmall.dark && hSmall.ratio >= 4.5, { hHead, hSmall })

    // ==================================================================
    section(`2. "Add it anywhere" at ${width}`)
    // ==================================================================
    const add = await p.evaluate(() => {
      const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom + scrollY) } }
      const items = [...document.querySelectorAll('[data-testid=add-it-item]')].map(box)
      const pictures = [...document.querySelectorAll('[data-testid=add-it] .add-it-picture')].map(box)
      const van = document.querySelector('[data-testid=add-it-van]')!
      const vanImg = van.querySelector('img') as HTMLImageElement
      const qr = van.querySelector('[data-testid=qr-svg]')!
      const sign = van.querySelector('[data-testid=van-sign]') as HTMLElement
      const frame = document.querySelector('[data-testid=add-it-phone] .phone-frame') as HTMLElement
      const name = document.querySelector('[data-testid=phone-business-name]') as HTMLElement
      const siteName = document.querySelector('[data-testid=site-business-name]') as HTMLElement
      const links = [...document.querySelectorAll('[data-testid=add-it] [data-testid=short-link]')].map((el) => {
        const holder = el.parentElement!.getBoundingClientRect()
        const parts = [...el.querySelectorAll(':scope > span')].map((s) => { const r = s.getBoundingClientRect(); return { text: s.textContent ?? '', lines: new Set([...s.getClientRects()].map((c) => Math.round(c.top))).size, inside: r.left >= holder.left - 0.5 && r.right <= holder.right + 0.5, nowrap: getComputedStyle(s).whiteSpace === 'nowrap' } })
        return { text: el.textContent ?? '', parts, breakAll: getComputedStyle(el).wordBreak === 'break-all' || getComputedStyle(el).overflowWrap === 'anywhere', cut: getComputedStyle(el.parentElement!).textOverflow === 'ellipsis' }
      })
      return {
        items, pictures, links,
        van: { loaded: vanImg.complete && vanImg.naturalWidth > 0, file: vanImg.currentSrc.split('/').pop() ?? '', attrs: `${vanImg.getAttribute('width')}x${vanImg.getAttribute('height')}`, loading: vanImg.getAttribute('loading'), alt: vanImg.alt },
        qr: { path: qr.querySelector('path')!.getAttribute('d') ?? '', label: qr.getAttribute('aria-label') ?? '', box: box(qr), inside: (() => { const q = qr.getBoundingClientRect(); const v = van.getBoundingClientRect(); return q.left >= v.left && q.right <= v.right && q.top >= v.top && q.bottom <= v.bottom })(), isSvg: qr.tagName.toLowerCase() === 'svg' },
        sign: { text: sign.innerText.replace(/\s+/g, ' ').trim(), inside: (() => { const s = sign.getBoundingClientRect(); const v = van.getBoundingClientRect(); return s.left >= v.left && s.right <= v.right })(), smallest: Math.min(...[...sign.querySelectorAll('span')].map((s) => parseFloat(getComputedStyle(s).fontSize))) },
        frame: { ...box(frame), radius: parseFloat(getComputedStyle(frame).borderTopLeftRadius), island: frame.querySelectorAll('.phone-frame-island').length },
        name: { text: name.innerText, lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)), fits: name.scrollWidth <= name.clientWidth + 1, insideFrame: name.getBoundingClientRect().right <= frame.getBoundingClientRect().right - 8, cut: getComputedStyle(name).textOverflow === 'ellipsis' },
        siteName: { fits: siteName.scrollWidth <= siteName.clientWidth + 1, text: siteName.innerText },
        forms: document.querySelectorAll('[data-testid=add-it] [data-testid=request-form-screen]').length,
        captions: document.querySelectorAll('[data-testid=add-it] figcaption').length,
      }
    })
    const same = (values: number[], tolerance = 1) => Math.max(...values) - Math.min(...values) <= tolerance
    if (width >= 1024) {
      check(`${width}: three columns of equal height, aligned at the top`, add.items.length === 3 && same(add.items.map((i) => i.top)) && same(add.items.map((i) => i.height)) && add.items[0]!.left < add.items[1]!.left && add.items[1]!.left < add.items[2]!.left && same(add.items.map((i) => i.width)), add.items)
      check(`${width}: each picture is the same size, and the three start on one line`, add.pictures.length === 3 && same(add.pictures.map((x) => x.width)) && same(add.pictures.map((x) => x.height)) && same(add.pictures.map((x) => x.top)), add.pictures)
    } else {
      check(`${width}: the three are stacked, one under another`, add.items.length === 3 && add.items[0]!.bottom <= add.items[1]!.top && add.items[1]!.bottom <= add.items[2]!.top, add.items.map((i) => [i.top, i.bottom]))
      check(`${width}: each picture is the same size`, add.pictures.length === 3 && same(add.pictures.map((x) => x.width)) && same(add.pictures.map((x) => x.height)), add.pictures)
    }
    const link = `${cfg.appUrl.replace(/\/$/, '')}/quote/${DEMO_SLUG}`
    const m = qrMatrix(link)
    const expectedPath = m.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + 2} ${y + 2}h1v1h-1z` : ''))).join('')
    check(`${width}: the QR code is on the van, in a photograph that has loaded with fixed dimensions (not with priority)`, add.van.loaded && /^van-(500|1000)\.webp$/.test(add.van.file) && add.van.attrs === '1000x1600' && add.van.loading === 'lazy' && add.van.alt.length > 30 && add.qr.inside && add.sign.inside, add.van)
    check(`${width}: it is our real QR code, drawn in code: it opens ${link.replace(/^https?:\/\//, '')}`, add.qr.isSvg && add.qr.path === expectedPath && add.qr.label.includes(`quote/${DEMO_SLUG}`), { modules: m.length, size: add.qr.box.width })
    check(`${width}: the sign on the van carries the business's name, in text of 12 px or more`, add.sign.text.includes(DEMO_BUSINESS_NAME) && add.sign.smallest >= 12, add.sign)
    check(`${width}: the quote page sits in a phone-shaped frame (taller than wide, a phone's corners, its camera cut-out)`, add.frame.height / add.frame.width >= 1.5 && add.frame.radius >= 32 && add.frame.island === 1 && add.forms === 2, add.frame)
    check(`${width}: the business's name fits on one line in the phone, uncut`, add.name.text === DEMO_BUSINESS_NAME && add.name.lines === 1 && add.name.fits && add.name.insideFrame && !add.name.cut, add.name)
    check(`${width}: the website picture does not cut the name either`, add.siteName.fits && add.siteName.text === DEMO_BUSINESS_NAME, add.siteName)
    check(`${width}: links are shown short: no "https://", and never broken inside a word (each part between slashes is whole and inside its box)`, add.links.length >= 1 && add.links.every((l) => !/^https?:|^www\./.test(l.text) && !l.breakAll && !l.cut && l.parts.every((part) => part.lines === 1 && part.inside && part.nowrap)), add.links.map((l) => l.parts.map((x) => x.text)))
    check(`${width}: no caption under a picture`, add.captions === 0)
    await p.locator('[data-testid=add-it]').scrollIntoViewIfNeeded()
    const addBox = await p.locator('[data-testid=add-it]').boundingBox()
    await p.evaluate((y) => window.scrollTo(0, y), Math.max(0, (addBox?.y ?? 0) + (await p.evaluate(() => scrollY)) - 150))
    await p.waitForTimeout(150)
    await p.screenshot({ path: path.join(outDir, `home-add-it-${width}.png`), fullPage: false, clip: undefined })
    if (width < 1024) await p.locator('[data-testid=add-it]').screenshot({ path: path.join(outDir, `home-add-it-whole-${width}.png`) })

    // ==================================================================
    section(`3. Home's closing band at ${width}`)
    // ==================================================================
    const closing = await photoOf(p, '[data-testid=closing-photo]')
    const cBand = await rectOf(p, '[data-testid=closing]')
    const cHead = await rectOf(p, '[data-testid=closing] h2')
    check(`${width} closing band: the evening photograph has loaded, with alt text and fixed dimensions, and without priority`, !!closing && closing.loaded && /^closing-(1200|2400)\.webp$/.test(closing.file) && closing.alt === CLOSING_PHOTO.alt && closing.attrs === '2400x1340' && closing.priority === null && closing.loading === 'lazy' && closing.captions === 0, closing)
    if (phone) check(`${width} closing band: the photograph fills the top of the band, full width, and the words start over its faded part`, !!closing && closing.top === cBand!.top && closing.width === width && cHead!.top > closing.top + (closing.bottom - closing.top) * 0.5 && cHead!.top < closing.bottom, closing && { photo: [closing.top, closing.bottom], h2Top: cHead!.top })
    else check(`${width} closing band: the photograph is the band's background on the right, and the words are on the calm side, left of it`, !!closing && closing.top === cBand!.top && closing.bottom === cBand!.bottom && closing.right === width && closing.left > 0 && cHead!.left < closing.left, closing && { photoLeft: closing.left, h2: [cHead!.left, cHead!.right] })
    const cH = await measure(p, homePng, 'Home closing band', width, 'heading', '[data-testid=closing] h2')
    const cL = await measure(p, homePng, 'Home closing band', width, 'quiet link', '[data-testid=closing-demo]')
    check(`${width} closing band: light words on a dark area, 4.5:1 or better at the worst point (heading ${cH?.ratio}:1, link ${cL?.ratio}:1)`, !!cH && !cH.dark && cH.ratio >= 4.5 && !!cL && !cL.dark && cL.ratio >= 4.5, { cH, cL })
    const closingLinks = await p.locator('[data-testid=closing] a').evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.trim(), boxed: getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' })))
    check(`${width} closing band: still one button and one quiet link`, closingLinks.length === 2 && closingLinks.filter((c) => c.boxed).length === 1, closingLinks)
    await p.locator('[data-testid=closing]').screenshot({ path: path.join(outDir, `home-closing-${width}.png`) })

    check(`${width} Home: one image loads with priority, the hero's; every photograph has its dimensions; nothing moved while it loaded (shift ${homeShift})`, JSON.stringify(await priorityImages(p)) === JSON.stringify([hero!.file]) && (await unsizedImages(p)).length === 0 && homeShift <= 0.02, { priority: await priorityImages(p), unsized: await unsizedImages(p), homeShift })
    const homePlans = await p.locator('[data-testid=plan-card]').evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ')))
    check(`${width} Home: the plan cards are the same plans Pricing shows (${sitePlans().map((s) => s.name).join(' and ')}), with nothing of a plan that is left off`, homePlans.length === sitePlans().length && sitePlans().every((s, i) => homePlans[i]!.includes(s.name) && homePlans[i]!.includes(`Choose ${s.name}`)) && !homePlans.some((card) => /Business/.test(card)), homePlans.map((card) => card.slice(0, 30)))
    check(`${width} Home: nothing scrolls sideways`, (await sideways(p)) <= 0, await sideways(p))

    // ==================================================================
    section(`4. The six trade pages at ${width}`)
    // ==================================================================
    for (const t of TRADE_PAGES) {
      await p.goto(`${cfg.appUrl}${t.href}`, { waitUntil: 'networkidle' })
      const shift = await shiftOf(p)
      if (['hvac', 'plumbing'].includes(t.slug)) await p.screenshot({ path: path.join(outDir, `trade-${t.slug}-${width}.png`) })
      await settle(p)
      const name = `${width} ${t.href}`
      const ph = await photoOf(p, '[data-testid=hero] [data-testid=hero-photo]')
      const tBand = await rectOf(p, '[data-testid=hero]')
      const tH1 = await rectOf(p, '[data-testid=hero] h1')
      const tLine = await rectOf(p, '[data-testid=hero] h1 + p')
      const screen = await rectOf(p, '[data-testid=trade-hero-screen]')
      const base = path.basename(t.photo.base)
      check(`${name}: its own photograph has loaded (${base}), with alt text, fixed dimensions and high priority`, !!ph && ph.loaded && new RegExp(`^${base}-(1200|2400)\\.webp$`).test(ph.file) && ph.alt === t.photo.alt && ph.attrs === `${t.photo.width}x${t.photo.height}` && ph.priority === 'high' && ph.captions === 0, ph)
      check(`${name}: the photograph is never a block of its own above the headline: it starts at the top of the hero, behind it, and the headline is on it or beside it`, !!ph && ph.position === 'absolute' && Math.abs(ph.top - tBand!.top) <= 1 && ph.right >= width - 1 && tH1!.top > ph.top && (phone ? tH1!.top < ph.bottom : true), ph && { photo: [ph.left, ph.top, ph.right, ph.bottom], h1Top: tH1!.top })
      const png = await paintedWithoutWords(p)
      if (phone) {
        const share = (tH1!.top - ph!.top) / (ph!.bottom - ph!.top)
        check(`${name}: the photograph fills the top, full width, and the headline starts over its faded part, on the first screen`, ph!.left <= 0 && ph!.width >= width && share >= 0.5 && share <= 0.95 && tH1!.top < height, { share: Math.round(share * 100) / 100, h1Top: tH1!.top })
      } else {
        check(`${name}: the photograph is the hero's background: it runs behind the words' side and to the right edge`, ph!.right >= width - 1 && ph!.bottom > tH1!.top && ph!.left < screen!.left, { photo: [ph!.left, ph!.right, ph!.bottom] })
        const under = await linesOf(p, '[data-testid=hero] h1 + p')
        let offPaper = 0
        for (const r of under!.rects) for (let y = r.y; y < r.y + r.h; y += 2) for (let x2 = r.x; x2 < r.x + r.w; x2 += 2) { const i = (y * png.width + x2) * 4; if (Math.abs(png.data[i]! - 250) + Math.abs(png.data[i + 1]! - 249) + Math.abs(png.data[i + 2]! - 246) > 6) offPaper++ }
        check(`${name}: the line under the headline sits on solid paper`, offPaper === 0, offPaper)
      }
      // the trade's real screen stays in the hero as T-167 left it: under the words, or beside the headline from 1024 px, and now partly on the photograph
      const beside = screen!.left >= tH1!.left + 200 && screen!.top < tH1!.bottom + 200
      const forms = await p.locator('[data-testid=trade-hero-screen] [data-testid=request-form-screen]').count()
      check(`${name}: the trade's own screen is still in the hero (${width >= 1024 ? 'beside the words' : 'under the words'}) and sits partly on the photograph`, forms === 1 && screen!.width >= 300 && (width >= 1024 ? beside : screen!.top >= tLine!.bottom) && (phone || (screen!.top < ph!.bottom && screen!.bottom > ph!.bottom)), { screen, photoBottom: ph!.bottom })
      const body = await measure(p, png, t.href, width, 'line under the headline', '[data-testid=hero] h1 + p')
      const head = await measure(p, png, t.href, width, 'headline', '[data-testid=hero] h1')
      const eyebrow = await measure(p, png, t.href, width, 'line above the headline', '[data-testid=hero] .trade-hero-words > p')
      const small = await measure(p, png, t.href, width, 'small line', '[data-testid=hero] .hero-small-line')
      check(`${name}: dark words on light; the line under the headline keeps 4.5:1 at its worst point (${body?.ratio}:1)`, !!body && body.dark && body.ratio >= 4.5, body)
      check(`${name}: the headline (${head?.ratio}:1), the line above it (${eyebrow?.ratio}:1) and the small line (${small?.ratio}:1) keep 4.5:1 too`, [head, eyebrow, small].every((x) => !!x && x.dark && x.ratio >= 4.5), { head, eyebrow, small })
      check(`${name}: one priority image, every photograph has its dimensions, nothing moved while it loaded (shift ${shift}), nothing scrolls sideways`, (await priorityImages(p)).length === 1 && (await unsizedImages(p)).length === 0 && shift <= 0.02 && (await sideways(p)) <= 0, { priority: await priorityImages(p), unsized: await unsizedImages(p), shift, sideways: await sideways(p) })
    }

    // ==================================================================
    section(`5. /demo's sample photos at ${width}`)
    // ==================================================================
    for (const pick of DEMO_SERVICE_PICKS) {
      const want = DEMO_SAMPLE_PHOTOS[pick.name]!
      const fileName = want.split('/').pop()!
      await p.goto(`${cfg.appUrl}/demo`, { waitUntil: 'networkidle' })
      await p.getByRole('button', { name: pick.name, exact: true }).click()
      const uploads: string[] = []
      p.on('request', (req) => { if (req.url().includes('/api/public/uploads/init') && req.method() === 'POST') uploads.push(req.postData() ?? '') })
      // contact details are filled in already; answer what each step asks until the photo step
      for (let step = 0; step < 6 && (await p.locator('[data-testid=use-sample-photo]').count()) === 0; step++) {
        for (const input of await p.locator('main input[type=number]:visible').all()) if (!(await input.inputValue())) await input.fill('2')
        for (const select of await p.locator('main select:visible').all()) if (!(await select.inputValue())) await select.selectOption({ index: 1 })
        for (const group of await p.locator('main [role=radiogroup]:visible').all()) if ((await group.locator('[aria-checked=true], input:checked').count()) === 0) await group.locator('[role=radio], input[type=radio], button').first().click()
        await p.getByRole('button', { name: /^continue$/i }).first().click()
        await p.waitForTimeout(500)
      }
      const button = p.locator('[data-testid=use-sample-photo]')
      const offered = (await button.count()) === 1 && (await button.isVisible())
      let added = { previews: 0, errors: '' }
      if (offered) {
        await button.click()
        await p.waitForFunction(() => document.querySelectorAll('main img[src^="blob:"]').length > 0, undefined, { timeout: 20000 }).catch(() => undefined)
        await p.waitForTimeout(1500)
        added = await p.evaluate(() => ({ previews: document.querySelectorAll('main img[src^="blob:"]').length, errors: [...document.querySelectorAll('main [role=alert], main .text-danger')].map((e) => (e as HTMLElement).innerText).join(' | ').slice(0, 160) }))
      }
      check(`${width} /demo, ${pick.name}: "Use a sample photo" is offered, and adds the photo that matches the service (${fileName})`, offered && added.previews >= 1 && added.errors === '' && uploads.length === 1 && uploads[0]!.includes(fileName) && uploads.every((body) => !Object.values(DEMO_SAMPLE_PHOTOS).filter((src) => src !== want).some((other) => body.includes(other.split('/').pop()!))), { offered, added, uploads: uploads.length })
      p.removeAllListeners('request')
    }

    // ==================================================================
    section(`6. Pricing at ${width}`)
    // ==================================================================
    await p.goto(`${cfg.appUrl}/pricing`, { waitUntil: 'networkidle' })
    const lines = await p.locator('[data-testid=plan-line]').evaluateAll((els) => els.map((el) => ({ text: (el as HTMLElement).innerText.replace(/[✓○]/g, '').replace(/\s+/g, ' ').trim(), live: el.getAttribute('data-live') === 'true', tick: el.querySelector('[aria-hidden=true]')?.textContent ?? '' })))
    // the owner's decision: the page shows the plans with a line of their own live today
    const shown = sitePlans()
    const hidden = offeredPlans().filter((plan) => !shown.some((s) => s.id === plan.id))
    const wanted = shown.flatMap((plan) => planLines(plan))
    const notLive = wanted.filter((l) => !l.live).map((l) => l.label)
    const live = wanted.filter((l) => l.live).map((l) => l.label)
    const cards = await p.locator('[data-testid=plans] > div').evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ')))
    check(`${width} Pricing: it shows ${shown.length} plans (${shown.map((s) => s.name).join(' and ')}), each with its price and its button; ${hidden.map((h) => h.name).join(', ') || 'none'} is left off until a line of its own is live`, shown.length === 2 && cards.length === shown.length && shown.every((s, i) => cards[i]!.includes(s.name) && cards[i]!.includes(`$${(s.monthlyPrice.USD ?? 0) / 100}`) && cards[i]!.includes(`Choose ${s.name}`)) && hidden.every((h) => !cards.some((card) => card.includes(`Choose ${h.name}`))), cards.map((card) => card.slice(0, 40)))
    check(`${width} Pricing: every line that is not live yet says "${COMING_LATER}" and has no tick; no live line is marked`, lines.length === wanted.length && notLive.length >= 3 && lines.every((l) => (notLive.some((label) => l.text.startsWith(label)) ? !l.live && l.text.endsWith(COMING_LATER) && l.tick !== '✓' : l.live && !l.text.includes(COMING_LATER) && l.tick === '✓')) && notLive.every((label) => lines.some((l) => l.text.startsWith(label))) && live.every((label) => lines.some((l) => l.text === label)), lines.filter((l) => !l.live).map((l) => l.text))
    // the page's words with the marked lines taken out: what is left must promise none of them
    const pricingText = await p.evaluate(() => {
      const main = document.querySelector('main')!.cloneNode(true) as HTMLElement
      main.querySelectorAll('[data-testid=plan-line][data-live=false]').forEach((el) => el.remove())
      return (main.textContent ?? '').replace(/\s+/g, ' ')
    })
    const promised = pricingText.match(/by text|\bSMS\b|WhatsApp|on[- ]site|LiDAR|team members|priority support|Most popular/gi)
    check(`${width} Pricing: outside those marked lines the page promises none of them (no text messages, WhatsApp, on-site app, LiDAR, team members, priority support or "Most popular")`, promised === null, promised)
    check(`${width} Pricing: nothing scrolls sideways`, (await sideways(p)) <= 0)
    if (width === 390 || width === 1440) await p.screenshot({ path: path.join(outDir, `pricing-${width}.png`), fullPage: true })

    check(`${width}: no error on any page`, errors.length === 0, errors.slice(0, 3))
    await ctx.close()
  }
  await browser.close()
}

saveJson(outDir, 'contrast.json', contrast)
saveJson(outDir, 'checks.json', checks)
if (contrast.length) {
  console.log('\n── Contrast at the worst point (lowest of each group across the five widths) ──')
  const groups = new Map<string, { ratio: number; width: number }>()
  for (const c of contrast) {
    const key = `${c.page}: ${c.what}`
    const had = groups.get(key)
    if (!had || c.ratio < had.ratio) groups.set(key, { ratio: c.ratio, width: c.width })
  }
  for (const [key, v] of groups) console.log(`${key}: ${v.ratio}:1 (at ${v.width})`)
}
if (notChecked.length) console.log(`\nNot checked:\n- ${notChecked.join('\n- ')}`)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${checks.length - failed.length}/${checks.length} pass — ${outDir}`)
process.exit(failed.length ? 1 : 0)
