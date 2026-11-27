// T-209 check, against the real servers (local stack). No model is asked, no email is sent, and
// nothing here touches production.
//
// What it proves
//   A  every guide's video file, as the web app serves it, is as long as the list says
//      (lib/guides.ts `seconds`, to the nearest second): the hero's two files are 60 s. Read from
//      the file's own header, so a file that was not replaced, or is another cut, fails here
//   B  in a real browser, the home page's hero button reads "See how it works · 1 min" and tells a
//      screen reader "1 minute"; the two shorter guides keep "· 32 s" and "· 39 s"
//   C  the window it opens is titled "How Qolumns works" and holds the new voiceover, for a screen
//      reader only: the wide file on a desktop, the upright one on a phone
//   D  the support page's six guides, each under a minute, still read "Watch how · N s"
//
// The checks' own browser cannot decode the videos (it has no H.264): what is in the picture and
// what the voice says is not something this script can know.
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t209.mts
// Needs the web app on 3000. The harness is T-201's.
import path from 'node:path'
import { PRODUCT_NAME } from '../../packages/shared/src/brand'
import { h, finish } from './t201/harness.mts'
import { mp4Seconds } from './t209/mp4-length.mts'
import { GUIDES, GUIDE_COPY, SETUP_GUIDES, guide, guideLength, sourceFor } from '../../apps/web/src/lib/guides'
import { WATCH } from '../../apps/web/src/lib/marketing/home-copy'

const { app, check, section } = h
const words = (s: string) => s.replace(/\s+/g, ' ').trim()
const base = (file: string) => path.posix.basename(file)

// ---------------------------------------------------------------------------
section('A. Each video file is as long as the list says')
const videos = [...Object.values(GUIDES).map((g) => ({ src: g.src, seconds: g.seconds })), ...(GUIDES.hero.tall ? [{ src: GUIDES.hero.tall.src, seconds: GUIDES.hero.seconds }] : [])]
check('the list has eight videos: the hero wide and upright, and six guides', videos.length === 8)
for (const v of videos) {
  const res = await fetch(`${app}${v.src}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const length = mp4Seconds(bytes)
  check(`${base(v.src)} is served as a video and is ${v.seconds} s long, to the nearest second`, res.status === 200 && /^video\/mp4/.test(res.headers.get('content-type') ?? '') && length !== null && Math.round(length) === v.seconds, { status: res.status, type: res.headers.get('content-type'), bytes: bytes.length, length })
}
check('the hero is 60 seconds, so its length is said in minutes: "1 min"', GUIDES.hero.seconds === 60 && guideLength(GUIDES.hero.seconds).text === '1 min')

// ---------------------------------------------------------------------------
const { browserDeps } = await import('./browser.mjs')
const browser = await browserDeps().chromium.launch()
const pageErrors: string[] = []
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    section(`B. The home page's video buttons, ${width} px`)
    const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => pageErrors.push(e.message))
    const asked: string[] = []
    p.on('request', (r) => {
      if (/\.(mp4|jpg)$/.test(new URL(r.url()).pathname) && new URL(r.url()).pathname.startsWith(path.posix.dirname(GUIDES.hero.src) + '/')) asked.push(base(new URL(r.url()).pathname))
    })
    await p.goto(`${app}/`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(400)
    const watch = p.locator('[data-testid=watch-hero]')
    check(`${width}: the hero's button reads "See how it works · 1 min"`, words(await watch.innerText()) === 'See how it works · 1 min' && words(await watch.innerText()) === `${WATCH.hero} · ${guideLength(GUIDES.hero.seconds).text}`, await watch.innerText())
    check(`${width}: a screen reader is told "1 minute"`, (await watch.getAttribute('aria-label')) === 'See how it works (video, 1 minute, with sound)', await watch.getAttribute('aria-label'))
    check(`${width}: the figure is in the figure face, as a guide's seconds are`, (await watch.locator('.figure').innerText()) === '1')
    const box = (await watch.boundingBox())!
    check(`${width}: the button is on one line and on the screen`, box.height <= 52 && box.x >= 0 && box.x + box.width <= width && !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), box)
    if (width >= 1024) {
      const signup = (await p.locator('[data-testid=hero-signup]').boundingBox())!
      check(`${width}: it is still in the row of the two buttons`, Math.abs(box.y + box.height / 2 - (signup.y + signup.height / 2)) <= 2 && box.x > signup.x + signup.width, { box, signup })
    }
    check(`${width}: the two shorter guides keep their seconds: "· 32 s" and "· 39 s"`, words(await p.locator('[data-testid=watch-add-service]').innerText()) === `${WATCH.setup} · 32 s` && words(await p.locator('[data-testid=watch-on-site]').innerText()) === `${WATCH.onSite} · 39 s`)
    check(`${width}: nowhere on the page is the old length or "60 s"`, !/· 33 s|\b60 s\b/.test(await p.locator('body').innerText()))

    section(`C. The window it opens, ${width} px`)
    asked.length = 0
    await watch.click()
    const dialog = p.locator('dialog[data-testid=guide-dialog][open]')
    await dialog.waitFor({ timeout: 10_000 })
    await p.waitForTimeout(300)
    const source = sourceFor(GUIDES.hero, width < 640)
    check(`${width}: it is titled "How ${PRODUCT_NAME} works"`, words(await dialog.locator('h2').innerText()) === `How ${PRODUCT_NAME} works` && GUIDES.hero.title === 'How Qolumns works', await dialog.locator('h2').innerText())
    check(`${width}: it plays the ${width < 640 ? 'upright' : 'wide'} file, and asks for no other`, (await p.locator('[data-testid=guide-video]').getAttribute('src')) === source.src && asked.length > 0 && asked.every((f) => f === base(source.src) || f === base(source.poster)), asked)
    const said = p.locator('[data-testid=guide-words]')
    const lines = await said.locator('p').allTextContents()
    const saidBox = (await said.boundingBox())!
    check(`${width}: the new voiceover is in it, eleven lines, word for word`, lines.length === 11 && JSON.stringify(lines) === JSON.stringify(GUIDES.hero.transcript) && lines[0] === 'Most homeowners look for a price online before they call. Very few find one.' && lines[10] === `${PRODUCT_NAME}. Answer first, in your prices. Try it free: ten quotes, no card needed.`, lines)
    check(`${width}: for a screen reader only: one clipped pixel, and the window is described by it`, saidBox.width <= 1 && saidBox.height <= 1 && (await dialog.getAttribute('aria-describedby')) === (await said.getAttribute('id')) && (await said.evaluate((el) => getComputedStyle(el).overflow)) === 'hidden', saidBox)
    await p.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
    check(`${width}: Escape closes it and the focus is back on the button`, (await p.locator('dialog[open]').count()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'watch-hero')

    section(`D. The support page's six guides, ${width} px`)
    await p.goto(`${app}/support`, { waitUntil: 'networkidle' })
    const texts = await Promise.all(SETUP_GUIDES.map(async (id) => words(await p.locator(`[data-testid=guide-link-${id}]`).innerText())))
    check(`${width}: each still reads "${GUIDE_COPY.watch} · N s", none in minutes`, SETUP_GUIDES.every((id, i) => texts[i] === `${GUIDE_COPY.watch} · ${guide(id).seconds} s` && guide(id).seconds < 60), texts)
    await ctx.close()
  }
  check('no page threw an error', pageErrors.length === 0, pageErrors)
} finally {
  await browser.close()
}

process.exit(finish())
