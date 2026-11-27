// T-208 check, against the real servers (local stack). No model is asked, no email is sent, and
// nothing here touches production.
//
// What it proves, in a real browser
//   A  the marketing home page: the hero has no video of its own (headline, text, the buttons, the
//      small line, then the three frames); a third, quieter action "See how it works · 33 s" after
//      "Try it as a customer", in the row on a desktop and under the buttons on a phone
//   B  the window it opens: the page goes dark, the video is in the middle and as large as fits
//      (wide from 640 px, upright under it, near the whole screen on a phone); it starts inside the
//      press with its sound on; the page behind does not scroll; the ✕, Escape and a press on the
//      dark page each close it, stop the video and give the focus back to the button; dragging the
//      video's own slider off the video does not close it
//   C  the two other buttons, under their sections' intro text, each on its own guide
//   D  no transcript is shown anywhere (home, the support page, the dashboard): the voiceover's
//      words are in the open window for a screen reader only
//   E  the dashboard's Services header: the three buttons on one row, on the title's row, at
//      1,024 px (and at 768 and 1,280), with the guide link under the page's line
//
// The checks' own browser cannot decode the videos (it has no H.264), so "it plays" is proved as
// "play() was called inside the press, with the sound on, and the right file was asked for".
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t208.mts
// Needs the web app on 3000. The harness is T-201's. SHOTS=/some/folder saves pictures.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { h, finish } from './t201/harness.mts'
import { GUIDES, GUIDE_COPY, guide, sourceFor, watchedKey, type GuideId } from '../../apps/web/src/lib/guides'
import { WATCH } from '../../apps/web/src/lib/marketing/home-copy'

const { app, check, section } = h
const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })
const FOLDER = path.posix.dirname(GUIDES.hero.src)
const fileOf = (url: string) => (new URL(url).pathname.startsWith(`${FOLDER}/`) ? path.posix.basename(new URL(url).pathname) : null)
const base = (file: string) => path.posix.basename(file)

const { browserDeps } = await import('./browser.mjs')
const browser = await browserDeps().chromium.launch()
const origin = new URL(app).origin
type Context = Awaited<ReturnType<typeof browser.newContext>>
type Page = Awaited<ReturnType<Context['newPage']>>
const pageErrors: string[] = []

async function open(width: number, height: number, cookie?: string) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
  if (cookie) await ctx.addCookies(cookie.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
  await ctx.addInitScript(() => {
    const w = window as unknown as { __plays: Array<{ inPress: boolean; muted: boolean }>; __pauses: number }
    w.__plays = []
    w.__pauses = 0
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push({ inPress: navigator.userActivation?.isActive ?? false, muted: this.muted })
      return play.call(this)
    }
    const pause = HTMLMediaElement.prototype.pause
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      w.__pauses += 1
      return pause.call(this)
    }
  })
  const p = await ctx.newPage()
  const asked: string[] = []
  p.on('request', (r) => {
    const file = fileOf(r.url())
    if (file) asked.push(file)
  })
  p.on('pageerror', (e) => pageErrors.push(e.message))
  return { ctx, p, asked }
}
const plays = (p: Page) => p.evaluate(() => (window as unknown as { __plays: Array<{ inPress: boolean; muted: boolean }> }).__plays)
const pauses = (p: Page) => p.evaluate(() => (window as unknown as { __pauses: number }).__pauses)
const openDialog = (p: Page) => p.locator('dialog[data-testid=guide-dialog][open]')
const closed = async (p: Page) => {
  await openDialog(p).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
  await p.locator('[data-testid=guide-video]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
}
const isClosed = async (p: Page) => (await openDialog(p).count()) === 0 && (await p.locator('video').count()) === 0
const focusOn = (p: Page) => p.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null)
const sideways = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
const words = (s: string) => s.replace(/\s+/g, ' ').trim()
const shot = async (p: Page, name: string) => {
  if (shots) await p.screenshot({ path: path.join(shots, `${name}.png`) })
}
const midY = (b: { y: number; height: number }) => b.y + b.height / 2
/** Nothing on the page offers a transcript to read, and nothing visible is one */
const noTranscript = (p: Page) =>
  p.evaluate(() => {
    const said = /read the transcript/i.test(document.body.innerText)
    const drawn = [...document.querySelectorAll<HTMLElement>('[data-testid=guide-transcript], [data-testid=guide-words], details summary')].filter((el) => {
      const r = el.getBoundingClientRect()
      return /transcript/i.test(el.innerText) || (el.matches('[data-testid=guide-words]') && (r.width > 1 || r.height > 1))
    })
    return !said && drawn.length === 0
  })

try {
  // -------------------------------------------------------------------------
  const SIZES = [
    [1440, 900],
    [1024, 768],
    [640, 900],
    [639, 900],
    [390, 844],
  ] as const
  for (const [width, height] of SIZES) {
    section(`A. The home page's hero, ${width} px`)
    const { ctx, p, asked } = await open(width, height)
    await p.goto(`${app}/`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(400)
    const hero = p.locator('[data-testid=hero]')
    check(`${width}: the hero contains no video element, no poster and no play button of its own`, (await hero.locator('video, img[src*=".jpg"][src*="hero-"], [data-testid=hero-video], [data-testid=hero-video-play]').count()) === 0 && (await p.locator('video').count()) === 0)
    check(`${width}: nothing of a guide was asked for as the page loaded, and nothing played`, asked.length === 0 && (await plays(p)).length === 0, asked)

    const h1 = (await hero.locator('h1').boundingBox())!
    const sub = (await hero.locator('h1 + p').boundingBox())!
    const signup = (await hero.locator('[data-testid=hero-signup]').boundingBox())!
    const demo = (await hero.locator('[data-testid=hero-demo]').boundingBox())!
    const watch = p.locator('[data-testid=watch-hero]')
    const watchBox = (await watch.boundingBox())!
    const small = (await hero.locator('.hero-small-line').boundingBox())!
    const frames = (await hero.locator('[data-testid=hero-demo-frames]').boundingBox())!
    const down = [h1, sub, signup, small, frames]
    check(`${width}: headline, text, the buttons, the small line, then the three frames, in that order`, down.every((b, i) => i === 0 || b.y >= down[i - 1]!.y + down[i - 1]!.height - 1), down)
    const actions = (await hero.locator('[data-testid=hero-actions]').boundingBox())!
    check(`${width}: the small line follows the buttons directly, and the frames follow it (nothing else in between)`, small.y - (actions.y + actions.height) <= 16 && frames.y - (small.y + small.height) <= 120, { actions, small, frames })
    check(`${width}: the third action reads "${WATCH.hero} · ${GUIDES.hero.seconds} s"`, words(await watch.innerText()) === `${WATCH.hero} · ${GUIDES.hero.seconds} s`, await watch.innerText())
    if (width >= 1024) {
      check(`${width}: it is in the buttons' row, after "Try it as a customer"`, Math.abs(midY(watchBox) - midY(demo)) <= 2 && Math.abs(midY(signup) - midY(demo)) <= 2 && watchBox.x >= demo.x + demo.width && demo.x >= signup.x + signup.width, { signup, demo, watchBox })
    } else if (width < 640) {
      check(`${width}: on a phone it sits under the two buttons`, demo.y >= signup.y + signup.height && watchBox.y >= demo.y + demo.height && watchBox.y + watchBox.height <= small.y + 1, { signup, demo, watchBox, small })
    } else {
      check(`${width}: it is after "Try it as a customer", in its row or wrapped under it`, watchBox.y >= demo.y - 2 && watchBox.y + watchBox.height <= small.y + 1, { demo, watchBox, small })
    }
    const look = await watch.evaluate((el) => {
      const s = getComputedStyle(el)
      return { ground: s.backgroundColor, edge: s.borderTopWidth, shadow: s.boxShadow, height: el.getBoundingClientRect().height }
    })
    const neighbours = await hero.locator('[data-testid=hero-signup], [data-testid=hero-demo]').evaluateAll((els) => els.map((el) => ({ ground: getComputedStyle(el).backgroundColor, edge: getComputedStyle(el).borderTopWidth })))
    check(
      `${width}: it is quieter than the two buttons: no ground and no edge of its own (they each have both), and still 44 px to press`,
      look.ground === 'rgba(0, 0, 0, 0)' && look.edge === '0px' && look.shadow === 'none' && look.height >= 44 && neighbours.every((n) => n.ground !== 'rgba(0, 0, 0, 0)' && n.edge !== '0px'),
      { look, neighbours }
    )
    check(`${width}: the page has one yellow button in the hero, as before`, (await hero.locator('[data-cta=main]').count()) === 1)
    check(`${width}: nothing scrolls sideways`, !(await sideways(p)))
    await shot(p, `hero-${width}`)

    // -----------------------------------------------------------------------
    section(`B. The window, ${width} px`)
    const upright = width < 640
    const source = sourceFor(GUIDES.hero, upright)
    const other = upright ? GUIDES.hero : GUIDES.hero.tall!
    await p.evaluate(() => window.scrollTo(0, 120))
    const scrollBefore = await p.evaluate(() => window.scrollY)
    await watch.click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    const video = p.locator('[data-testid=guide-video]')
    const started = await plays(p)
    check(`${width}: pressing it opens the window (a modal dialog) on the hero's guide`, (await openDialog(p).evaluate((d) => d.matches(':modal'))) && (await openDialog(p).getAttribute('data-guide')) === 'hero' && (await p.locator('dialog[open]').count()) === 1)
    check(`${width}: the video started once, inside the press, with the sound on`, started.length === 1 && started[0]!.inPress && !started[0]!.muted, started)
    const attrs = await video.evaluate((v: HTMLVideoElement) => ({ controls: v.controls, inline: v.playsInline, preload: v.getAttribute('preload'), poster: v.getAttribute('poster'), src: v.getAttribute('src'), autoplay: v.autoplay }))
    check(`${width}: it is the ${upright ? 'upright (9:16)' : 'wide (16:9)'} video, with its controls, played in the page`, attrs.src === source.src && attrs.poster === source.poster && attrs.controls && attrs.inline && attrs.preload === 'none' && !attrs.autoplay, attrs)
    await p.waitForTimeout(400)
    check(`${width}: only that video and its poster were asked for, never the other shape`, asked.length > 0 && asked.every((f) => f === base(source.src) || f === base(source.poster)) && !asked.includes(base(other.src)), asked)

    const box = (await video.boundingBox())!
    const dark = await openDialog(p).evaluate((d) => getComputedStyle(d, '::backdrop').backgroundColor)
    const alpha = Number(/rgba?\([^)]*?,\s*([\d.]+)\)$/.exec(dark)?.[1] ?? (dark.startsWith('rgb(') ? 1 : 0))
    check(`${width}: the page behind is dark (ink, at least four fifths solid)`, /^rgba?\(27, 40, 35/.test(dark) && alpha >= 0.8, dark)
    const ratio = box.width / box.height
    check(`${width}: the video keeps its shape (${source.width} by ${source.height})`, Math.abs(ratio - source.width / source.height) < 0.01, { ratio, box })
    check(`${width}: it is in the middle of the screen, side to side`, Math.abs(box.x + box.width / 2 - width / 2) <= 1, box)
    const frame = (await p.locator('[data-testid=guide-frame]').boundingBox())!
    check(`${width}: with its title and ✕ it is in the middle top to bottom, and wholly on the screen`, Math.abs(frame.y + frame.height / 2 - height / 2) <= 1 && frame.y >= 0 && frame.y + frame.height <= height && frame.x >= 0 && frame.x + frame.width <= width, frame)
    const gapX = width - box.width
    const gapY = height - frame.height
    check(`${width}: it is as large as fits: it reaches the screen's edge one way or the other (a margin of at most 24 px a side)`, gapX <= 48 + 1 || gapY <= 48 + 1, { gapX, gapY })
    if (width <= 480) check(`${width}: on a phone it is near the whole screen (over three quarters of its height, over nine tenths of its width)`, box.height >= height * 0.75 && box.width >= width * 0.9, box)
    const close = p.locator('[data-testid=guide-close]')
    const closeBox = (await close.boundingBox())!
    check(`${width}: the ✕ is over the video's top right corner, 44 px, and says "${GUIDE_COPY.close}" to a screen reader`, closeBox.width >= 44 && closeBox.height >= 44 && closeBox.y + closeBox.height <= box.y && Math.abs(closeBox.x + closeBox.width - (box.x + box.width)) <= 1 && (await close.getAttribute('aria-label')) === GUIDE_COPY.close, closeBox)
    await shot(p, `dialog-${width}`)

    // the page behind does not scroll
    const overflow = await p.evaluate(() => getComputedStyle(document.documentElement).overflowY)
    await p.mouse.move(4, height - 4)
    await p.mouse.wheel(0, 600)
    await p.waitForTimeout(200)
    await p.keyboard.press('PageDown')
    await p.waitForTimeout(200)
    check(`${width}: with the window open the page behind does not scroll (wheel, Page Down)`, overflow === 'hidden' && (await p.evaluate(() => window.scrollY)) === scrollBefore && scrollBefore === 120, { overflow, scrollBefore, now: await p.evaluate(() => window.scrollY) })
    check(`${width}: nothing scrolls sideways with it open`, !(await sideways(p)))

    // the focus stays inside
    const inside: boolean[] = []
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press('Tab')
      inside.push(await p.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog[open]')))
    }
    check(`${width}: Tab, eight times, never reaches the page behind`, inside.every(Boolean), inside)

    // dragging the video's own slider off the video does not close it
    await p.mouse.move(box.x + box.width / 2, box.y + box.height - 12)
    await p.mouse.down()
    await p.mouse.move(box.x + box.width / 2 + 20, Math.min(height - 2, box.y + box.height + 6), { steps: 4 })
    await p.mouse.up()
    await p.waitForTimeout(200)
    check(`${width}: a drag that begins on the video and ends off it leaves the window open`, (await openDialog(p).count()) === 1)

    // Escape
    const pausedBefore = await pauses(p)
    await p.keyboard.press('Escape')
    await closed(p)
    check(`${width}: Escape closes it: the video was stopped and is gone from the page`, (await isClosed(p)) && (await pauses(p)) === pausedBefore + 1)
    check(`${width}: the focus is back on the button`, (await focusOn(p)) === 'watch-hero', await focusOn(p))
    check(`${width}: the page scrolls again, and is where it was`, (await p.evaluate(() => getComputedStyle(document.documentElement).overflowY)) !== 'hidden' && (await p.evaluate(() => window.scrollY)) === scrollBefore)
    check(`${width}: a visitor's browser was not written to (no guide is "watched" here)`, (await p.evaluate((k) => window.localStorage.getItem(k), watchedKey('hero'))) === null && (await p.evaluate(() => window.localStorage.length)) === 0)

    // the ✕
    await watch.click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    await close.click()
    await closed(p)
    check(`${width}: the ✕ closes it and gives the focus back`, (await isClosed(p)) && (await focusOn(p)) === 'watch-hero')
    // the ✕ from the keyboard
    await watch.focus()
    await p.keyboard.press('Enter')
    await openDialog(p).waitFor({ timeout: 10_000 })
    check(`${width}: opened from the keyboard, it starts inside that press too`, (await plays(p)).at(-1)?.inPress === true && (await plays(p)).length === 3)
    await close.focus()
    await p.keyboard.press('Enter')
    await closed(p)
    check(`${width}: the ✕ pressed from the keyboard closes it and gives the focus back`, (await isClosed(p)) && (await focusOn(p)) === 'watch-hero')

    // a press on the dark page: each side that has room, and the corner
    await watch.click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    await p.mouse.click(3, 3)
    await closed(p)
    check(`${width}: a press on the dark page (a corner) closes it and gives the focus back`, (await isClosed(p)) && (await focusOn(p)) === 'watch-hero')
    await watch.click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    const again = (await video.boundingBox())!
    await p.mouse.click(again.x + again.width / 2, again.y + again.height / 2)
    await p.waitForTimeout(200)
    check(`${width}: a press on the video itself does not close it`, (await openDialog(p).count()) === 1)
    await p.mouse.click(Math.max(2, again.x - 3), height - 3)
    await closed(p)
    check(`${width}: a press under the video closes it`, (await isClosed(p)) && (await focusOn(p)) === 'watch-hero')
    check(`${width}: every play followed a press`, (await plays(p)).every((x) => x.inPress && !x.muted), await plays(p))

    // -----------------------------------------------------------------------
    if (width === 1440 || width === 390) {
      section(`C. The two section buttons, ${width} px`)
      const places: Array<{ id: GuideId; says: string; after: string; before: string; where: string }> = [
        { id: 'add-service', says: WATCH.setup, after: '[data-testid=setup] > h2 + p', before: '[data-testid=setup-steps]', where: '"Set up in minutes"' },
        { id: 'on-site', says: WATCH.onSite, after: '[data-testid=app-lines]', before: '[data-testid=app-availability]', where: 'the on-site app\'s section' },
      ]
      for (const place of places) {
        const g = guide(place.id)
        const b = p.locator(`[data-testid=watch-${place.id}]`)
        await b.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        const bBox = (await b.boundingBox())!
        const above = (await p.locator(place.after).first().boundingBox())!
        const below = (await p.locator(place.before).first().boundingBox())!
        check(`${width}: ${place.where} has "${place.says} · ${g.seconds} s" under its intro text`, words(await b.innerText()) === `${place.says} · ${g.seconds} s` && bBox.y >= above.y + above.height - 1 && bBox.y - (above.y + above.height) <= 24 && bBox.y + bBox.height <= below.y + 1 && Math.abs(bBox.x - above.x) <= 2, { above, bBox, below })
        const quiet = await b.evaluate((el) => ({ ground: getComputedStyle(el).backgroundColor, edge: getComputedStyle(el).borderTopWidth }))
        check(`${width}: it is the same quiet style as the hero's`, quiet.ground === 'rgba(0, 0, 0, 0)' && quiet.edge === '0px' && (await b.getAttribute('class')) === (await watch.getAttribute('class'))?.replace(' sm:px-2', ' '), quiet)
        asked.length = 0
        const before = (await plays(p)).length
        await b.click()
        await openDialog(p).waitFor({ timeout: 10_000 })
        const src = await video.getAttribute('src')
        await p.waitForTimeout(300)
        check(`${width}: it opens the same window on the "${g.title}" guide, started inside the press with sound`, (await openDialog(p).getAttribute('data-guide')) === place.id && src === g.src && (await p.locator('dialog[open]').count()) === 1 && (await plays(p)).length === before + 1 && (await plays(p)).at(-1)!.inPress && !(await plays(p)).at(-1)!.muted && asked.every((f) => f === base(g.src) || f === base(g.poster)), { src, asked })
        const vb = (await video.boundingBox())!
        check(`${width}: the video is wide (16:9), in the middle, as large as fits`, Math.abs(vb.width / vb.height - 16 / 9) < 0.01 && Math.abs(vb.x + vb.width / 2 - width / 2) <= 1 && (width - vb.width <= 49 || height - vb.height <= 110), vb)
        await shot(p, `dialog-${place.id}-${width}`)
        await p.keyboard.press('Escape')
        await closed(p)
        check(`${width}: Escape closes it and the focus is back on that button`, (await isClosed(p)) && (await focusOn(p)) === `watch-${place.id}`)
      }
      check(`${width}: the home page has three video buttons and no video until one is pressed`, (await p.locator('[data-testid^=watch-]').count()) === 3 && (await p.locator('video').count()) === 0)

      section(`D. No transcript is shown, ${width} px`)
      check(`${width}: the home page offers no transcript and draws none`, await noTranscript(p))
      await p.evaluate(() => window.scrollTo(0, 0))
      await watch.click()
      await openDialog(p).waitFor({ timeout: 10_000 })
      const said = p.locator('[data-testid=guide-words]')
      const saidBox = (await said.boundingBox())!
      const clip = await said.evaluate((el) => ({ position: getComputedStyle(el).position, overflow: getComputedStyle(el).overflow, clip: getComputedStyle(el).clip }))
      check(`${width}: in the open window the voiceover is text for a screen reader only: one pixel, clipped`, saidBox.width <= 1 && saidBox.height <= 1 && clip.position === 'absolute' && clip.overflow === 'hidden', { saidBox, clip })
      check(`${width}: it is the hero's voiceover, line for line, and the window is described by it`, JSON.stringify(await said.locator('p').allTextContents()) === JSON.stringify(GUIDES.hero.transcript) && (await openDialog(p).getAttribute('aria-describedby')) === (await said.getAttribute('id')))
      check(`${width}: with the window open nothing offers a transcript either`, (await noTranscript(p)) && (await openDialog(p).locator('details, summary').count()) === 0)
      await p.keyboard.press('Escape')
      await closed(p)

      await p.goto(`${app}/support`, { waitUntil: 'networkidle' })
      check(`${width}: the support page offers no transcript`, (await noTranscript(p)) && !/written out/i.test(await p.locator('[data-testid=support-guides]').innerText()))
      await p.locator('[data-testid=guide-link-add-service]').first().click()
      await openDialog(p).waitFor({ timeout: 10_000 })
      const supportVideo = (await video.boundingBox())!
      check(`${width}: its guides open in the same window: dark page, the video in the middle, nothing to read under it`, (await noTranscript(p)) && Math.abs(supportVideo.x + supportVideo.width / 2 - width / 2) <= 1 && (await p.locator('[data-testid=guide-words]').count()) === 1 && /^rgba?\(27, 40, 35/.test(await openDialog(p).evaluate((d) => getComputedStyle(d, '::backdrop').backgroundColor)))
      await shot(p, `support-dialog-${width}`)
      await p.keyboard.press('Escape')
      await closed(p)
      check(`${width}: the support page's link still remembers a watched guide (a tick)`, (await p.locator('[data-testid=guide-link-add-service]').first().getAttribute('data-watched')) === 'true')
    }
    await ctx.close()
  }

  // -------------------------------------------------------------------------
  const biz = await h.business('popup')
  await h.paintService(biz)
  const cookie = biz.cookie.Cookie
  for (const [width, height] of [
    [1024, 768],
    [768, 1024],
    [1280, 800],
    [390, 844],
  ] as const) {
    section(`E. The dashboard's Services header, ${width} px`)
    const { ctx, p } = await open(width, height, cookie)
    await p.goto(`${app}/app/services`, { waitUntil: 'networkidle' })
    const add = p.getByRole('button', { name: 'Add Service', exact: true })
    await add.waitFor({ timeout: 20_000 })
    const header = p.locator('div:has(> div > div > h1)').last()
    const title = (await p.locator('h1', { hasText: 'Services' }).boundingBox())!
    const line = (await p.locator('h1 + p').boundingBox())!
    const rule = (await p.locator('div:has(> div h1) > .tape-rule').boundingBox())!
    const three = await Promise.all(['Upload Services', 'Add from a template', 'Add Service'].map(async (name) => (await p.getByRole('button', { name, exact: true }).boundingBox())!))
    const guideLink = p.locator('[data-testid=guide-link-add-service]')
    const linkBox = (await guideLink.boundingBox())!
    if (width >= 768) {
      check(`${width}: the three buttons are on one row`, three.every((b) => Math.abs(midY(b) - midY(three[0]!)) <= 1) && three[0]!.x + three[0]!.width <= three[1]!.x && three[1]!.x + three[1]!.width <= three[2]!.x, three)
      check(`${width}: and that row is the title's: beside "Services", to its right, not under the page's line`, three[0]!.y < title.y + title.height && three[0]!.x >= title.x + title.width && three[0]!.y + three[0]!.height <= linkBox.y + linkBox.height, { title, three })
    }
    check(`${width}: "${GUIDE_COPY.watch} · ${guide('add-service').seconds} s" is under the page's line, above the rule, at the title's left edge`, words(await guideLink.innerText()) === `${GUIDE_COPY.watch} · ${guide('add-service').seconds} s` && linkBox.y >= line.y + line.height - 1 && linkBox.y + linkBox.height <= rule.y + 1 && Math.abs(linkBox.x - title.x) <= 2, { line, linkBox, rule })
    check(`${width}: it is not in the row of buttons`, (await add.evaluate((el) => !!el.parentElement?.querySelector('[data-testid^=guide-link-]'))) === false && (await header.count()) > 0)
    check(`${width}: Services does not scroll sideways`, !(await sideways(p)))
    await shot(p, `services-${width}`)

    await guideLink.click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    const video = (await p.locator('[data-testid=guide-video]').boundingBox())!
    check(`${width}: the dashboard's guide opens in the same window, with nothing to read under the video`, (await noTranscript(p)) && (await openDialog(p).getAttribute('data-guide')) === 'add-service' && Math.abs(video.x + video.width / 2 - width / 2) <= 1 && (await openDialog(p).locator('h2').innerText()) === guide('add-service').title)
    await shot(p, `services-dialog-${width}`)
    await p.keyboard.press('Escape')
    await closed(p)
    check(`${width}: Escape closes it, the focus is back on the link, and it has its tick`, (await isClosed(p)) && (await focusOn(p)) === 'guide-link-add-service' && (await guideLink.getAttribute('data-watched')) === 'true')
    check(`${width}: no page of the dashboard offers a transcript (Services, Home, Quote link)`, (await noTranscript(p)) && (await (async () => {
      for (const at of ['/app', '/app/quote-link']) {
        await p.goto(`${app}${at}`, { waitUntil: 'networkidle' })
        if (!(await noTranscript(p))) return false
      }
      return true
    })()))
    await ctx.close()
  }
  check('no page threw an error', pageErrors.length === 0, pageErrors)
} finally {
  await browser.close()
}

process.exit(finish())
