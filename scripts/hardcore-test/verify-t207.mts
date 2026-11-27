// T-207 check, against the real servers (local stack). No model is asked (the worker runs with its
// AI stand-in), no email is sent, and nothing here touches production.
//
// What it proves, in a real browser
//   A  every file the guide list names is served, a video in pieces (a phone asks for it that way),
//      and never by way of the sign-in page
//   B  the player (on the support page, open to anyone): six guides in order; nothing loads and
//      nothing plays until a link is pressed; the press opens a window and starts the video inside
//      the press; the focus stays in the window; Escape, "Close" and a click outside close it; the
//      video is then gone and the focus is back on the link; the guide is remembered (a tick),
//      also once four fifths have played; the transcript is closed until asked for
//   C  the marketing home page: a poster with a play button under the headline; the wide video from
//      640 px and the upright one under it, and only the one on screen loads; it never plays by
//      itself; the transcript under it
//   D  the dashboard: where each guide sits (Services, the two editor steps, Quote link, the quote
//      page's "Next step" only while it waits for approval), and Home's "Getting started": below
//      "Waiting for you", hidden by "Hide" for this business in this browser (and not shown for a
//      moment on the next visit), gone at three sent quotes
//
// The checks' own browser cannot decode the videos (it has no H.264), so "it plays" is proved as
// "play() was called inside the press, with the sound on, and the file was asked for". The videos
// were played with sound in Chrome by hand (see the CHANGELOG).
//
// Run by hand:  npx tsx scripts/hardcore-test/verify-t207.mts
// Needs the web app on 3000 and the worker on 8787 with AI_STAND_IN=off. The harness is T-201's.
// SHOTS=/some/folder saves a picture of each screen.
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { h, finish, type Row } from './t201/harness.mts'
import { GETTING_STARTED_UNTIL, GUIDES, GUIDE_COPY, SETUP_GUIDES, gettingStartedHiddenKey, guide, watchedKey, type GuideId } from '../../apps/web/src/lib/guides'

const { app, check, section, expectOk } = h
const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })
const FOLDER = path.posix.dirname(GUIDES.hero.src)
const fileOf = (url: string) => (new URL(url).pathname.startsWith(`${FOLDER}/`) ? path.posix.basename(new URL(url).pathname) : null)

// ---------------------------------------------------------------------------
section('A. The files are served')
const sources = [...Object.values(GUIDES), ...(GUIDES.hero.tall ? [GUIDES.hero.tall] : [])]
check('the list has the hero (wide and upright) and six guides: eight videos', sources.length === 8 && SETUP_GUIDES.length === 6)
for (const source of sources) {
  const poster = await fetch(`${app}${source.poster}`, { redirect: 'manual' })
  const piece = await fetch(`${app}${source.src}`, { redirect: 'manual', headers: { Range: 'bytes=0-1023' } })
  const bytes = (await piece.arrayBuffer()).byteLength
  check(
    `${path.posix.basename(source.src)} and its poster are served (the video in pieces)`,
    poster.status === 200 && (poster.headers.get('content-type') ?? '').startsWith('image/jpeg') && piece.status === 206 && (piece.headers.get('content-type') ?? '').startsWith('video/mp4') && bytes === 1024,
    { poster: [poster.status, poster.headers.get('content-type')], video: [piece.status, piece.headers.get('content-type'), bytes] }
  )
}

// ---------------------------------------------------------------------------
const { browserDeps } = await import('./browser.mjs')
const browser = await browserDeps().chromium.launch()
const origin = new URL(app).origin
type Context = Awaited<ReturnType<typeof browser.newContext>>
type Page = Awaited<ReturnType<Context['newPage']>>
const pageErrors: string[] = []

/** A browser window that counts every play() and every guide file asked for */
async function open(width: number, cookie?: string) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  if (cookie) await ctx.addCookies(cookie.split('; ').map((pair) => ({ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: origin })))
  await ctx.addInitScript(() => {
    const w = window as unknown as { __plays: Array<{ inPress: boolean; muted: boolean }> }
    w.__plays = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      w.__plays.push({ inPress: navigator.userActivation?.isActive ?? false, muted: this.muted })
      return play.call(this)
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
const link = (p: Page, id: GuideId) => p.locator(`[data-testid=guide-link-${id}]`).first()
const openDialog = (p: Page) => p.locator('dialog[data-testid=guide-dialog][open]')
/** The window has closed and the page has heard of it (the browser tells the page a moment after it closes) */
const closed = async (p: Page) => {
  await openDialog(p).waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
  await p.locator('[data-testid=guide-video]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
}
const watched = (p: Page, id: GuideId) => link(p, id).getAttribute('data-watched')
const stored = (p: Page, key: string) => p.evaluate((k) => window.localStorage.getItem(k), key)
const sideways = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
const focusOn = (p: Page) => p.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? null)
const shot = async (p: Page, name: string) => {
  if (shots) await p.screenshot({ path: path.join(shots, `${name}.png`) })
}
const base = (file: string) => path.posix.basename(file)

try {
  // -------------------------------------------------------------------------
  section('B. The player, on the support page')
  for (const width of [390, 1280]) {
    const { ctx, p, asked } = await open(width)
    await p.goto(`${app}/support`, { waitUntil: 'networkidle' })
    const rows = p.locator('[data-testid=support-guides] [data-testid=guide-list] > li')
    const order = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-guide')))
    const texts = await rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
    check(`${width}: "Video guides" lists the six guides in order`, JSON.stringify(order) === JSON.stringify(SETUP_GUIDES), order)
    check(
      `${width}: each row is its number, its title and "Watch how · N s"`,
      SETUP_GUIDES.every((id, i) => texts[i] === `${i + 1} ${guide(id).title} ${GUIDE_COPY.watch} · ${guide(id).seconds} s`),
      texts
    )
    check(`${width}: before anything is pressed there is no video on the page, none was asked for, and nothing played`, (await p.locator('video').count()) === 0 && asked.length === 0 && (await plays(p)).length === 0, asked)
    check(`${width}: no guide is marked as watched yet`, (await watched(p, 'add-service')) === 'false' && (await p.locator('[data-testid=guide-watched]').count()) === 0)

    // press the first link
    await link(p, 'add-service').click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    const g = guide('add-service')
    const video = p.locator('[data-testid=guide-video]')
    const attrs = await video.evaluate((v: HTMLVideoElement) => ({ controls: v.controls, inline: v.playsInline, preload: v.getAttribute('preload'), poster: v.getAttribute('poster'), src: v.getAttribute('src'), autoplay: v.autoplay, muted: v.muted }))
    check(`${width}: pressing the link opens a window (a modal dialog) named after the guide`, (await openDialog(p).evaluate((d) => d.matches(':modal'))) && (await openDialog(p).locator('h2').innerText()) === g.title)
    check(
      `${width}: the video has its controls, plays in the page, loads nothing ahead, and shows its poster`,
      attrs.controls && attrs.inline && attrs.preload === 'none' && attrs.poster === g.poster && attrs.src === g.src && !attrs.autoplay,
      attrs
    )
    const started = await plays(p)
    check(`${width}: it was started once, inside the press, with the sound on`, started.length === 1 && started[0]!.inPress && !started[0]!.muted, started)
    await p.waitForTimeout(400)
    check(`${width}: only this guide's files were asked for`, asked.length > 0 && asked.every((f) => f === base(g.src) || f === base(g.poster)), asked)
    await shot(p, `support-${width}-open`)

    // the focus stays inside
    const inside: boolean[] = []
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press('Tab')
      inside.push(await p.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('dialog[open]')))
    }
    const reached = await p.evaluate(() => !!document.activeElement)
    check(`${width}: Tab, twelve times, never reaches the page behind the window`, reached && inside.every(Boolean), inside)

    // the transcript
    const transcript = openDialog(p).locator('[data-testid=guide-transcript]')
    check(`${width}: "${GUIDE_COPY.transcript}" is closed until asked for`, (await transcript.locator('summary').innerText()).trim() === GUIDE_COPY.transcript && !(await transcript.evaluate((d: HTMLDetailsElement) => d.open)))
    await transcript.locator('summary').click()
    const lines = await transcript.locator('p').allInnerTexts()
    check(`${width}: opened, it is the voiceover, line for line`, JSON.stringify(lines) === JSON.stringify(g.transcript), lines)
    check(`${width}: nothing scrolls sideways with the window open`, !(await sideways(p)))

    // Escape
    await p.keyboard.press('Escape')
    await closed(p)
    check(`${width}: Escape closes it, and the video is gone from the page (it has stopped)`, (await openDialog(p).count()) === 0 && (await p.locator('video').count()) === 0)
    check(`${width}: the focus is back on the link that opened it`, (await focusOn(p)) === 'guide-link-add-service', await focusOn(p))
    check(`${width}: the guide is remembered under its own key, and the link carries a tick`, (await stored(p, watchedKey('add-service'))) === '1' && (await watched(p, 'add-service')) === 'true' && (await link(p, 'add-service').locator('[data-testid=guide-watched]').count()) === 1)
    check(`${width}: the other guides carry none`, (await p.locator('[data-testid=guide-watched]').count()) === 1 && (await stored(p, watchedKey('set-prices'))) === null)
    await shot(p, `support-${width}-watched`)

    // "Close", and a click on the dimmed page
    await link(p, 'quote-link').click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    await p.locator('[data-testid=guide-close]').click()
    await closed(p)
    check(`${width}: "Close" closes it and gives the focus back`, (await openDialog(p).count()) === 0 && (await focusOn(p)) === 'guide-link-quote-link' && (await watched(p, 'quote-link')) === 'true')
    await link(p, 'approve').click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    await p.mouse.click(3, 3)
    await closed(p)
    check(`${width}: a click on the dimmed page closes it too`, (await openDialog(p).count()) === 0 && (await focusOn(p)) === 'guide-link-approve')

    // four fifths played, with the window still open
    await link(p, 'set-prices').click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    const at = (seconds: number) =>
      video.evaluate((v: HTMLVideoElement, t) => {
        Object.defineProperty(v, 'duration', { value: 10, configurable: true })
        Object.defineProperty(v, 'currentTime', { value: t, configurable: true })
        v.dispatchEvent(new Event('timeupdate'))
      }, seconds)
    await at(7.9)
    const before = await stored(p, watchedKey('set-prices'))
    await at(8)
    check(`${width}: a guide is remembered once four fifths of it have played, not before`, before === null && (await stored(p, watchedKey('set-prices'))) === '1')
    await p.keyboard.press('Escape')
    await closed(p)

    // remembered on the next visit
    await p.reload({ waitUntil: 'networkidle' })
    check(`${width}: on the next visit the ticks are still there, and nothing else has changed`, (await watched(p, 'add-service')) === 'true' && (await watched(p, 'set-prices')) === 'true' && (await watched(p, 'test-pricing')) === 'false' && (await p.locator('video').count()) === 0)
    check(`${width}: nothing scrolls sideways`, !(await sideways(p)))
    await ctx.close()
  }

  // -------------------------------------------------------------------------
  section('C. The marketing home page')
  const hero = GUIDES.hero
  for (const width of [390, 639, 640, 1280]) {
    const { ctx, p, asked } = await open(width)
    await p.goto(`${app}/`, { waitUntil: 'networkidle' })
    const wide = width >= 640
    const shown = p.locator(`[data-testid=hero-video-${wide ? 'wide' : 'tall'}]`)
    const other = p.locator(`[data-testid=hero-video-${wide ? 'tall' : 'wide'}]`)
    const want = wide ? hero : hero.tall!
    const not = wide ? hero.tall! : hero
    check(`${width}: the ${wide ? 'wide' : 'upright'} video is the one shown`, (await shown.isVisible()) && !(await other.isVisible()))
    const h1 = await p.locator('[data-testid=hero] h1').boundingBox()
    const box = await shown.boundingBox()
    const demo = await p.locator('[data-testid=hero] [data-testid=hero-demo-frames]').boundingBox()
    check(`${width}: it sits in the hero, under the headline and above the three frames`, !!h1 && !!box && !!demo && box.y >= h1.y + h1.height && box.y + box.height <= demo.y, { h1, box, demo })
    await shown.scrollIntoViewIfNeeded()
    await p.waitForLoadState('networkidle')
    await p.waitForTimeout(500)
    check(`${width}: the poster on screen is the only guide file asked for (no video, not the other poster)`, JSON.stringify([...new Set(asked)]) === JSON.stringify([base(want.poster)]), asked)
    check(`${width}: nothing has played, and there is no video on the page`, (await plays(p)).length === 0 && (await p.locator('video').count()) === 0)
    const button = shown.locator('[data-testid=hero-video-play]')
    const size = await button.locator('span span').first().boundingBox()
    check(`${width}: the play button is large (at least 64 px) and says what it plays`, !!size && size.width >= 64 && size.height >= 64 && (await button.getAttribute('aria-label')) === GUIDE_COPY.play(hero), size)
    await shot(p, `home-${width}`)

    await button.click()
    const video = shown.locator('video')
    await video.waitFor({ timeout: 10_000 })
    const attrs = await video.evaluate((v: HTMLVideoElement) => ({ controls: v.controls, inline: v.playsInline, preload: v.getAttribute('preload'), poster: v.getAttribute('poster'), src: v.getAttribute('src'), autoplay: v.autoplay }))
    const started = await plays(p)
    check(`${width}: pressed, it starts once, inside the press, with the sound on`, started.length === 1 && started[0]!.inPress && !started[0]!.muted, started)
    check(`${width}: it is the ${wide ? 'wide' : 'upright'} file, with controls, in the page, nothing loaded ahead`, attrs.controls && attrs.inline && attrs.preload === 'none' && attrs.src === want.src && attrs.poster === want.poster && !attrs.autoplay, attrs)
    await p.waitForTimeout(400)
    check(`${width}: the other video and its poster were never asked for`, !asked.includes(base(not.src)) && !asked.includes(base(not.poster)) && asked.includes(base(want.src)), asked)
    const transcript = p.locator('[data-testid=hero-video] [data-testid=guide-transcript]')
    const underVideo = await transcript.boundingBox()
    const videoBox = await shown.boundingBox()
    check(`${width}: "${GUIDE_COPY.transcript}" is under the video, closed`, !!underVideo && !!videoBox && underVideo.y >= videoBox.y + videoBox.height && !(await transcript.evaluate((d: HTMLDetailsElement) => d.open)))
    await transcript.locator('summary').click()
    check(`${width}: opened, it is the hero's voiceover`, JSON.stringify(await transcript.locator('p').allInnerTexts()) === JSON.stringify(hero.transcript))
    check(`${width}: nothing scrolls sideways`, !(await sideways(p)))
    await ctx.close()
  }

  // -------------------------------------------------------------------------
  section('D. The dashboard')
  const biz = await h.business('guides')
  const serviceId = await h.paintService(biz)
  const tenantKey = await h.siteKey(biz)
  // "show, then confirm": a request waits for the business's approval
  expectOk('the service waits for approval', await h.patch('services', `id=eq.${serviceId}`, { auto_send: false, hold_until_approved: false }))
  const priced = (row: Row) => ((row.pricing_json as { total?: number } | null)?.total ?? 0) > 0 && String(row.status) === 'pending_review'
  const requests = []
  for (const name of ['Dana Whitlock', 'Evan Marlow', 'Tessa Monroe']) requests.push(await h.submit(tenantKey, serviceId, name))
  for (const r of requests) await h.waitForQuote(r.id, priced)
  const send = async (id: string) => expectOk('marked as sent', await h.patch('quotes', `id=eq.${id}`, { status: 'sent', sent_at: new Date().toISOString() }))
  const cookie = biz.cookie.Cookie

  for (const width of [390, 1280]) {
    const { ctx, p, asked } = await open(width, cookie)

    // Home
    await p.goto(`${app}/app`, { waitUntil: 'networkidle' })
    const card = p.locator('[data-testid=getting-started]')
    if (width === 1280) {
      // the first pass (390) ended with three quotes sent: this pass looks at the card's absence, then at the screens
      check('1280: with three quotes sent, Home has no "Getting started" card', (await card.count()) === 0)
    } else {
      check(`${width}: Home shows "${GUIDE_COPY.gettingStarted}" for a business that has sent no quote`, (await card.isVisible()) && (await card.locator('h2').innerText()) === GUIDE_COPY.gettingStarted)
      const order = await card.locator('[data-testid=guide-list] > li').evaluateAll((els) => els.map((el) => el.getAttribute('data-guide')))
      check(`${width}: it lists the six guides in order, 1 to 6`, JSON.stringify(order) === JSON.stringify(SETUP_GUIDES), order)
      const waiting = await p.locator('[data-testid=waiting-for-you]').boundingBox()
      const cardBox = await card.boundingBox()
      check(`${width}: it sits below "Waiting for you"`, !!waiting && !!cardBox && cardBox.y >= waiting.y + waiting.height, { waiting, cardBox })
      check(`${width}: nothing on Home plays or loads a guide by itself`, (await plays(p)).length === 0 && asked.length === 0 && (await p.locator('video').count()) === 0, asked)
      await shot(p, `dash-home-${width}`)
      await link(p, 'add-service').click()
      await openDialog(p).waitFor({ timeout: 10_000 })
      await p.keyboard.press('Escape')
      await closed(p)
      check(`${width}: a guide watched from the card gets its tick there`, (await openDialog(p).count()) === 0 && (await watched(p, 'add-service')) === 'true' && (await focusOn(p)) === 'guide-link-add-service')

      // "Hide", for this business, in this browser
      const hiddenKey = gettingStartedHiddenKey(biz.tenantId)
      await card.locator('[data-testid=getting-started-hide]').click()
      check(`${width}: "${GUIDE_COPY.hide}" takes the card away and remembers it under this business's own key`, (await card.count()) === 0 && (await stored(p, hiddenKey)) === '1' && hiddenKey.includes(biz.tenantId))
      // on the next visit the card is never painted: as the page's HTML arrives it is already hidden
      await p.goto(`${app}/app`, { waitUntil: 'domcontentloaded' })
      const early = await p.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-testid=getting-started]')
        return el ? { there: true, hidden: el.hidden, height: el.getBoundingClientRect().height } : { there: false, hidden: true, height: 0 }
      })
      await p.waitForLoadState('networkidle')
      check(`${width}: on the next visit it is not shown, not even for a moment`, early.hidden && early.height === 0 && (await card.count()) === 0, early)
      await p.evaluate((k) => window.localStorage.removeItem(k), hiddenKey)
      await p.reload({ waitUntil: 'networkidle' })
      check(`${width}: (with that key forgotten, the card is back: it is this browser that remembers)`, await card.isVisible())

      // three sent quotes
      await send(requests[0]!.id)
      await send(requests[1]!.id)
      await p.reload({ waitUntil: 'networkidle' })
      check(`${width}: with ${GETTING_STARTED_UNTIL - 1} quotes sent it is still there`, await card.isVisible())
      // the third stays unsent for now: its page is looked at below, waiting for approval
    }
    check(`${width}: Home does not scroll sideways`, !(await sideways(p)))

    // Services: beside "Add Service"
    await p.goto(`${app}/app/services`, { waitUntil: 'networkidle' })
    const add = p.getByRole('button', { name: 'Add Service', exact: true })
    await add.waitFor({ timeout: 20_000 })
    const addBox = await add.boundingBox()
    const addLink = await link(p, 'add-service').boundingBox()
    const sameParent = await link(p, 'add-service').evaluate((el) => [...(el.parentElement?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.trim() === 'Add Service'))
    check(`${width}: Services has the "Add a service" guide in its header, beside "Add Service"`, sameParent && !!addBox && !!addLink && (await link(p, 'add-service').innerText()).replace(/\s+/g, ' ').trim() === `${GUIDE_COPY.watch} · ${guide('add-service').seconds} s`, { addBox, addLink })
    check(`${width}: Services does not scroll sideways`, !(await sideways(p)))
    await shot(p, `dash-services-${width}`)

    // the editor: step 4 and step 5
    await p.locator('[data-testid=service-edit]').first().click()
    await p.locator('[data-testid=service-form]').waitFor({ timeout: 20_000 })
    const next = () => p.getByRole('button', { name: 'Next', exact: true }).click()
    await next()
    await next()
    check(`${width}: the first three steps of the editor carry no guide`, (await p.locator('[data-testid=service-form] [data-testid^=guide-link-]').count()) === 0)
    await next()
    const heading = p.locator('[data-testid=service-form] h3', { hasText: 'Describe your pricing' })
    await heading.waitFor({ timeout: 20_000 })
    const headingBox = await heading.boundingBox()
    const pricesBox = await link(p, 'set-prices').boundingBox()
    check(
      `${width}: "Pricing Setup" has the "Set your prices" guide beside the step's heading`,
      !!headingBox && !!pricesBox && Math.abs(pricesBox.y + pricesBox.height / 2 - (headingBox.y + headingBox.height / 2)) <= (width < 640 ? 60 : 16) && (await heading.evaluate((el) => !!el.parentElement?.querySelector('[data-testid=guide-link-set-prices]'))),
      { headingBox, pricesBox }
    )
    await shot(p, `dash-pricing-step-${width}`)
    await link(p, 'set-prices').click()
    await openDialog(p).waitFor({ timeout: 10_000 })
    const over = await openDialog(p).evaluate((d) => {
      const r = d.getBoundingClientRect()
      return document.elementFromPoint(r.left + r.width / 2, r.top + 30)?.closest('dialog') === d
    })
    check(`${width}: its window opens over the editor`, over && (await openDialog(p).evaluate((d) => d.matches(':modal'))))
    await p.keyboard.press('Escape')
    await closed(p)
    check(`${width}: Escape closes the guide and leaves the editor open, where it was`, (await openDialog(p).count()) === 0 && (await heading.isVisible()) && (await focusOn(p)) === 'guide-link-set-prices')
    await next()
    const testHeading = p.locator('[data-testid=pricing-test] h3', { hasText: 'Test Your Pricing' })
    await testHeading.waitFor({ timeout: 20_000 })
    check(`${width}: "Test & Publish" has the "Test your pricing" guide beside "Test Your Pricing"`, await testHeading.evaluate((el) => !!el.parentElement?.querySelector('[data-testid=guide-link-test-pricing]')))
    check(`${width}: and the "Set your prices" guide is not on this step`, (await p.locator('[data-testid=service-form] [data-testid=guide-link-set-prices]').count()) === 0)
    await shot(p, `dash-test-step-${width}`)
    check(`${width}: the editor does not scroll sideways`, !(await sideways(p)))

    // Quote link: under the page title
    await p.goto(`${app}/app/quote-link`, { waitUntil: 'networkidle' })
    const title = await p.locator('h1', { hasText: 'Quote link' }).boundingBox()
    // the rule that ends the page's own header (the menu has one too)
    const rule = await p.locator('div:has(> div h1) > .tape-rule').boundingBox()
    const quoteLinkGuide = await link(p, 'quote-link').boundingBox()
    check(`${width}: Quote link has the "Share your quote link" guide under the page title`, !!title && !!rule && !!quoteLinkGuide && quoteLinkGuide.y >= title.y + title.height && quoteLinkGuide.y + quoteLinkGuide.height <= rule.y + 1, { title, quoteLinkGuide, rule })
    check(`${width}: Quote link does not scroll sideways`, !(await sideways(p)))
    await shot(p, `dash-quote-link-${width}`)

    // the quote page: only while it waits for approval
    const waitingQuote = requests[2]!.id
    if (width === 390) {
      await p.goto(`${app}/app/quotes/${waitingQuote}`, { waitUntil: 'networkidle' })
      const nextStep = p.locator('[data-testid=next-step]')
      await nextStep.waitFor({ timeout: 20_000 })
      check(`${width}: a quote waiting for approval has the "Check and approve" guide in its "Next step" card`, (await nextStep.getAttribute('data-action')) === 'approve' && (await nextStep.locator('[data-testid=guide-link-approve]').count()) === 1)
      check(`${width}: the quote page does not scroll sideways`, !(await sideways(p)))
      await shot(p, `dash-quote-${width}`)
      await send(waitingQuote)
    }
    await p.goto(`${app}/app/quotes/${requests[0]!.id}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=next-step]').waitFor({ timeout: 20_000 })
    check(`${width}: a quote that has been sent has no guide there`, (await p.locator('[data-testid=next-step]').getAttribute('data-action')) !== 'approve' && (await p.locator('[data-testid=guide-link-approve]').count()) === 0)

    check(`${width}: nothing in the dashboard played by itself (every play followed a press)`, (await plays(p)).every((x) => x.inPress), await plays(p))
    await ctx.close()
  }
  check('no page threw an error', pageErrors.length === 0, pageErrors)
} finally {
  await browser.close()
}

process.exit(finish())
