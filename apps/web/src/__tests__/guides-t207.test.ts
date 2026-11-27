/**
 * T-207: the guide videos: the one list, the player, and where each guide is shown.
 *
 * T-208 changed three things held here, and this file says them as they now are: the window and its
 * opening moved into `useGuide` (shared with the marketing pages' buttons), the transcript is no longer
 * shown, and the Services link sits under the page's line. The hero's own player is gone: what replaced it
 * is in guides-t208.test.ts.
 *
 * What a browser does with them (the focus staying inside the window, Escape, the video
 * starting inside the press, only the visible hero loading) is proved in a real browser by
 * scripts/hardcore-test/verify-t207.mts. Here: the list against the files, the rule that only
 * the list names a file, what our own code does when the window opens and closes, and the
 * rules of Home's "Getting started" card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { APP_DOMAIN, PRODUCT_NAME } from '@qolumns/shared'
import {
  GETTING_STARTED_UNTIL,
  GUIDES,
  GUIDE_COPY,
  SETUP_GUIDES,
  gettingStartedHiddenKey,
  guide,
  showGettingStarted,
  watchedEnough,
  watchedKey,
  type GuideId,
  type GuideSource,
} from '@/lib/guides'
import { guideClosed, openGuide } from '@/components/guide/control'
import { GuideLink } from '@/components/guide/GuideLink'
import { GuideList } from '@/components/guide/GuideList'
import { GettingStarted } from '@/components/guide/GettingStarted'

const ROOT = join(__dirname, '../../../..')
const WEB = join(ROOT, 'apps/web')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
// the code without its comments (a JSX comment goes whole, braces and all)
const code = (path: string) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
// the folder's name is put together here, so this file does not spell the path it forbids
const FOLDER_NAME = ['gui', 'des'].join('')
const FOLDER = join(WEB, 'public', FOLDER_NAME)
const sources: GuideSource[] = [...Object.values(GUIDES), ...(GUIDES.hero.tall ? [GUIDES.hero.tall] : [])]

describe('T-207 part A: one list of guides', () => {
  it('has the hero and the six guides, each with a title, a length and a transcript', () => {
    expect(Object.keys(GUIDES)).toEqual(['hero', 'add-service', 'set-prices', 'test-pricing', 'quote-link', 'approve', 'on-site'])
    expect(SETUP_GUIDES).toEqual(['add-service', 'set-prices', 'test-pricing', 'quote-link', 'approve', 'on-site'])
    for (const [id, g] of Object.entries(GUIDES)) {
      expect(g.id, id).toBe(id)
      expect(g.title.length, id).toBeGreaterThan(0)
      expect(g.transcript.length, id).toBeGreaterThan(0)
      expect(guide(id as GuideId)).toBe(g)
    }
    expect(Object.fromEntries(Object.values(GUIDES).map((g) => [g.id, g.seconds]))).toEqual({ hero: 33, 'add-service': 32, 'set-prices': 25, 'test-pricing': 23, 'quote-link': 29, approve: 26, 'on-site': 39 })
    expect(SETUP_GUIDES.map((id) => guide(id).title)).toEqual(['Add a service', 'Set your prices', 'Test your pricing', 'Share your quote link', 'Check and approve', 'Quote on site'])
  })

  it('every video and every poster it names is in the folder', () => {
    expect(sources).toHaveLength(8)
    for (const source of sources) {
      expect(source.src).toMatch(new RegExp(`^/${FOLDER_NAME}/[a-z0-9-]+\\.mp4$`))
      expect(source.poster).toBe(source.src.replace(/\.mp4$/, '.jpg'))
      for (const file of [source.src, source.poster]) {
        const onDisk = join(WEB, 'public', file)
        expect(existsSync(onDisk), file).toBe(true)
        expect(statSync(onDisk).size, file).toBeGreaterThan(10_000)
      }
    }
  })

  it('and every file in the folder is named by it: none is left over, none is named twice', () => {
    const named = sources.flatMap((s) => [s.src, s.poster]).map((f) => f.split('/').pop()!)
    expect(new Set(named).size).toBe(named.length)
    expect(readdirSync(FOLDER).filter((f) => !f.startsWith('.')).sort()).toEqual([...named].sort())
  })

  it('the hero has two sources: wide for a desktop, upright for a phone', () => {
    const hero = GUIDES.hero
    expect([hero.width, hero.height]).toEqual([1920, 1080])
    expect(hero.tall && [hero.tall.width, hero.tall.height]).toEqual([1080, 1920])
    expect(hero.tall?.src).not.toBe(hero.src)
    // only the hero has an upright one
    expect(SETUP_GUIDES.every((id) => guide(id).tall === undefined)).toBe(true)
  })

  it('no file but the list spells the folder: every screen asks for a guide by its id', () => {
    const needle = `/${FOLDER_NAME}/`
    const list = join(WEB, 'src/lib/guides.ts')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (full !== list && readFileSync(full, 'utf8').includes(needle)) hits.push(relative(ROOT, full))
      }
    }
    walk(join(WEB, 'src'))
    expect(hits).toEqual([])
    // the list itself builds every path from one folder name
    expect(code('apps/web/src/lib/guides.ts').match(new RegExp(`['"\`]/${FOLDER_NAME}`, 'g'))).toHaveLength(1)
  })

  it('the transcripts are the voiceover, with the product named from the one constant', () => {
    expect(GUIDES.hero.transcript).toEqual([
      "Your customers want a price before they'll book a visit.",
      `With ${PRODUCT_NAME}, they snap a few photos and answer a few questions, right on your website.`,
      `${PRODUCT_NAME} reads the photos, and prices the job from your own price list.`,
      'You check it, and tap approve.',
      'Your customer gets a professional quote, every line explained, with a button to accept.',
      `${PRODUCT_NAME}. Photo estimates for trades. Start free at ${APP_DOMAIN}.`,
    ])
    expect(APP_DOMAIN).toBe('qolumns.com')
    expect(Object.fromEntries(Object.values(GUIDES).map((g) => [g.id, g.transcript.length]))).toEqual({ hero: 6, 'add-service': 5, 'set-prices': 4, 'test-pricing': 4, 'quote-link': 4, approve: 4, 'on-site': 6 })
    const first = Object.fromEntries(Object.values(GUIDES).map((g) => [g.id, g.transcript[0]]))
    const last = Object.fromEntries(Object.values(GUIDES).map((g) => [g.id, g.transcript.at(-1)]))
    expect(first).toMatchObject({
      'add-service': 'Start by adding the jobs you do.',
      'set-prices': 'Next, set your prices.',
      'test-pricing': 'Before you go live, test your pricing.',
      'quote-link': "Your quote link works even if you don't have a website.",
      approve: "When a quote needs you, it's at the top of your list.",
      'on-site': 'With the app, you can quote on site.',
    })
    expect(last).toMatchObject({
      'add-service': 'Then choose what to ask your customers. Their answers feed straight into the price.',
      'set-prices': 'Extras like high ceilings are added only when they apply. And you can change any number.',
      'test-pricing': 'When it looks right, switch the service on, and start quoting.',
      'quote-link': 'Have a website? Paste one piece of code, or send it to whoever looks after the site.',
      approve: 'The total updates as you go. Then save and send, and your customer gets the quote straight away.',
      'on-site': 'The price comes from your own price list, ready to approve and send before you leave.',
    })
    expect(guide('add-service').transcript[1]).toBe(`Pick a ready-made template, or describe your own service, and ${PRODUCT_NAME} drafts it for you.`)
    expect(guide('set-prices').transcript[2]).toBe(`${PRODUCT_NAME} turns it into clear rules. A call-out fee, a price per room, and a minimum job.`)
    // never typed
    expect(code('apps/web/src/lib/guides.ts')).not.toContain(PRODUCT_NAME)
  })
})

describe('T-207 part B: the player', () => {
  const link = (id: GuideId) => renderToStaticMarkup(createElement(GuideLink, { id })).replace(/<!-- -->/g, '')

  it('the link takes the guide’s id and nothing else, and says "Watch how · 32 s" from the list', () => {
    const html = link('add-service')
    expect(html).toContain('<span>Watch how</span>')
    expect(html).toContain('<span class="figure">32</span> s')
    expect(html).toContain('aria-label="Watch how: Add a service (32 seconds)"')
    expect(html).toContain('type="button"')
    expect(link('on-site')).toContain('<span class="figure">39</span> s')
    expect(code('apps/web/src/components/guide/GuideLink.tsx')).toContain('export function GuideLink({ id }: { id: GuideId })')
  })

  it('until it is pressed nothing of the video is on the page: no video, no poster, no tick', () => {
    const html = link('add-service')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('.jpg')
    expect(html).not.toContain('.mp4')
    expect(html).toContain('data-watched="false"')
    expect(html).not.toContain('data-testid="guide-watched"')
    // a closed dialog is there, empty
    expect(html).toMatch(/<dialog[^>]*data-testid="guide-dialog"[^>]*><\/dialog>/)
  })

  it('the window is the browser’s own modal dialog, with a video that has controls and loads nothing ahead', () => {
    const dialog = code('apps/web/src/components/guide/GuideDialog.tsx')
    expect(dialog).toMatch(/<dialog\s+ref=\{dialogRef\}/)
    expect(dialog).toMatch(/<video\s+ref=\{videoRef\}\s+controls\s+playsInline\s+preload="none"\s+poster=\{source\.poster\}\s+src=\{source\.src\}/)
    expect(dialog).toContain('onClose={onClosed}')
    // Escape is the browser's: nothing here stops the dialog's own "cancel"
    expect(dialog).not.toMatch(/onCancel|preventDefault|onKeyDown/)
    // opened with showModal (the focus stays inside it), never the non-modal show()
    expect(code('apps/web/src/components/guide/control.ts')).toContain('dialog.showModal()')
    expect(code('apps/web/src/components/guide/control.ts')).not.toMatch(/\.show\(\)/)
    // T-208: no transcript to open (guides-t208.test.ts holds where the words went)
    expect(dialog).not.toMatch(/<details/)
  })

  it('nothing plays by itself, anywhere: no autoplay attribute, and play() only inside a press', () => {
    for (const file of ['GuideLink.tsx', 'GuideDialog.tsx', 'WatchButton.tsx', 'useGuide.tsx', 'GuideList.tsx', 'GettingStarted.tsx', 'control.ts', 'memory.ts']) {
      expect(code(`apps/web/src/components/guide/${file}`), file).not.toMatch(/autoplay/i)
    }
    // the one caller of openGuide is `show`, and `show` is only ever a button's own onClick
    const opener = code('apps/web/src/components/guide/useGuide.tsx')
    expect(opener).toMatch(/const show = \(\) => \{\s*const playing = sourceFor\(guide, window\.matchMedia\(UPRIGHT_QUERY\)\.matches\)\s*flushSync\(\(\) => setSource\(playing\)\)\s*openGuide\(dialog\.current, video\.current\)\s*\}/)
    expect(opener.match(/openGuide\(/g)).toHaveLength(1)
    for (const file of ['GuideLink.tsx', 'WatchButton.tsx']) {
      const button = code(`apps/web/src/components/guide/${file}`)
      expect(button, file).toContain('onClick={show}')
      expect(button.match(/\bshow\b/g), file).toHaveLength(2)
      expect(button, file).not.toMatch(/useEffect|openGuide|\.play\(/)
    }
    expect(opener).not.toMatch(/useEffect/)
  })

  /** A stand-in for the browser's dialog: Escape cancels it, which closes it, which tells whoever listens */
  function standIns() {
    const events: string[] = []
    let onClose: () => void = () => undefined
    const dialog = {
      open: false,
      showModal() {
        this.open = true
        events.push('showModal')
      },
      close() {
        if (!this.open) return
        this.open = false
        events.push('close')
        onClose()
      },
      pressEscape() {
        this.close()
      },
    }
    const video = {
      playing: false,
      play() {
        this.playing = true
        events.push('play')
        return Promise.resolve()
      },
      pause() {
        this.playing = false
        events.push('pause')
      },
      focus() {
        events.push('focus video')
      },
    }
    const opener = { focus: () => events.push('focus link') }
    const remembered: string[] = []
    onClose = () => guideClosed(video, opener, () => remembered.push('add-service'))
    return { dialog, video, opener, events, remembered }
  }

  it('pressing the link opens the window and starts the video, in that order', () => {
    const { dialog, video, events } = standIns()
    openGuide(dialog, video)
    expect(dialog.open).toBe(true)
    expect(video.playing).toBe(true)
    expect(events).toEqual(['showModal', 'focus video', 'play'])
    // pressed again while open: it is not opened twice
    openGuide(dialog, video)
    expect(events.filter((e) => e === 'showModal')).toHaveLength(1)
  })

  it('Escape closes the window: the video stops, the guide is remembered, and the focus goes back to the link', () => {
    const { dialog, video, events, remembered } = standIns()
    openGuide(dialog, video)
    dialog.pressEscape()
    expect(dialog.open).toBe(false)
    expect(video.playing).toBe(false)
    expect(remembered).toEqual(['add-service'])
    expect(events.slice(-3)).toEqual(['close', 'pause', 'focus link'])
  })

  it('the Close button does the same', () => {
    const { dialog, video, events, remembered } = standIns()
    openGuide(dialog, video)
    dialog.close()
    expect(events.slice(-3)).toEqual(['close', 'pause', 'focus link'])
    expect(remembered).toEqual(['add-service'])
    // and the real one is wired that way: every way of closing ends in the dialog's one "close" event
    expect(code('apps/web/src/components/guide/useGuide.tsx')).toMatch(/onClosed=\{\(\) => \{\s*guideClosed\(video\.current, opener\.current, on\.closed\)\s*setSource\(null\)\s*\}\}/)
    expect(code('apps/web/src/components/guide/GuideLink.tsx')).toContain('closed: () => remember(key),')
    expect(code('apps/web/src/components/guide/GuideDialog.tsx')).toContain('onClick={() => dialogRef.current?.close()}')
  })

  it('a video that cannot start leaves the window open with its controls', async () => {
    const { dialog, video } = standIns()
    video.play = () => Promise.reject(new Error('NotAllowedError'))
    expect(() => openGuide(dialog, video)).not.toThrow()
    await Promise.resolve()
    expect(dialog.open).toBe(true)
    const throwing = { ...video, play: () => { throw new Error('no') } }
    expect(() => openGuide(dialog, throwing)).not.toThrow()
    // nothing to open: nothing happens
    expect(() => openGuide(null, null)).not.toThrow()
    expect(() => guideClosed(null, null, () => undefined)).not.toThrow()
  })

  it('"watched" is four fifths of the video, or its window closed', () => {
    expect(watchedEnough(7.9, 10)).toBe(false)
    expect(watchedEnough(8, 10)).toBe(true)
    expect(watchedEnough(32, 32)).toBe(true)
    // a video whose length is not known yet is not watched
    expect(watchedEnough(0, NaN)).toBe(false)
    expect(watchedEnough(5, 0)).toBe(false)
    expect(watchedEnough(5, Infinity)).toBe(false)
    expect(code('apps/web/src/components/guide/GuideLink.tsx')).toContain('if (watchedEnough(currentTime, duration)) remember(key)')
  })
})

describe('T-207: what the browser remembers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function browser(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void }) {
    const heard: string[] = []
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: (e: Event) => heard.push(e.type), addEventListener: () => undefined, removeEventListener: () => undefined })
    return heard
  }

  it('one key to a guide, one key to a business', () => {
    expect(watchedKey('add-service')).toBe('qolumns.guide.watched.add-service')
    expect(new Set(Object.keys(GUIDES).map((id) => watchedKey(id as GuideId))).size).toBe(7)
    expect(gettingStartedHiddenKey('tenant-a')).toBe('qolumns.guide.getting-started-hidden.tenant-a')
    expect(gettingStartedHiddenKey('tenant-a')).not.toBe(gettingStartedHiddenKey('tenant-b'))
  })

  it('a watched guide is written to localStorage and said to whoever is listening', async () => {
    const kept = new Map<string, string>()
    const heard = browser({ getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) })
    const { remember, remembered } = await import('@/components/guide/memory')
    expect(remembered(watchedKey('approve'))).toBe(false)
    remember(watchedKey('approve'))
    expect(kept.get('qolumns.guide.watched.approve')).toBe('1')
    expect(remembered(watchedKey('approve'))).toBe(true)
    expect(remembered(watchedKey('on-site'))).toBe(false)
    expect(heard).toHaveLength(1)
    // remembered already: nothing is written or said again
    remember(watchedKey('approve'))
    expect(heard).toHaveLength(1)
  })

  it('a browser that refuses storage does not break anything: it remembers for this page', async () => {
    const refuse = () => {
      throw new Error('SecurityError')
    }
    browser({ getItem: refuse, setItem: refuse })
    const { remember, remembered } = await import('@/components/guide/memory')
    expect(remembered(watchedKey('approve'))).toBe(false)
    expect(() => remember(watchedKey('approve'))).not.toThrow()
    expect(remembered(watchedKey('approve'))).toBe(true)
    // every read and write of storage is inside a try
    const memory = code('apps/web/src/components/guide/memory.ts')
    expect(memory.match(/localStorage/g)).toHaveLength(2)
    expect(memory).toMatch(/try \{\s*return window\.localStorage\.getItem\(key\) === '1'\s*\} catch/)
    expect(memory).toMatch(/try \{\s*window\.localStorage\.setItem\(key, '1'\)\s*\} catch/)
  })

  it('with no browser at all (the server), nothing is remembered and nothing throws', async () => {
    const { remembered } = await import('@/components/guide/memory')
    expect(remembered(watchedKey('approve'))).toBe(false)
  })
})

describe('T-207 part C: where the guides are shown', () => {
  const services = code('apps/web/src/app/(dashboard)/app/services/page.tsx')

  it('5. Services: in the page header (since T-208 under the page’s line, not in the row of buttons)', () => {
    expect(services).toMatch(/<PageHeader\s+title="Services"\s+description="Your services and what you charge for each"\s+below=\{<GuideLink id="add-service" \/>\}/)
    expect(services.match(/<GuideLink id="add-service" \/>/g)).toHaveLength(1)
    expect(services).toMatch(/Add Service\s*<\/button>\s*<\/div>\s*\}\s*\/>/)
  })

  it('6. the "Pricing Setup" step: beside the step’s heading', () => {
    expect(services).toMatch(/\{activeStep === 'pricing' && \([\s\S]*?<PricingComposer\s+aside=\{<GuideLink id="set-prices" \/>\}/)
    const composer = code('apps/web/src/components/services/PricingComposer.tsx')
    expect(composer).toMatch(/<h3[^>]*>\s*Describe your pricing\s*<\/h3>\s*\{aside\}/)
    // setup's own "check your prices" step uses the same composer and has no guide link
    expect(code('apps/web/src/components/onboarding/CheckPricesStep.tsx')).not.toContain('GuideLink')
  })

  it('7. the "Test & Publish" step: beside "Test Your Pricing"', () => {
    expect(code('apps/web/src/components/services/PricingTest.tsx')).toMatch(/<h3[^>]*>Test Your Pricing<\/h3>\s*<GuideLink id="test-pricing" \/>/)
    expect(services).toMatch(/\{activeStep === 'test' && \([\s\S]*?<PricingTest/)
  })

  it('8. Quote link: under the page title', () => {
    expect(code('apps/web/src/components/share/SharePageClient.tsx')).toContain('<PageHeader title="Quote link" description="Give customers this link, or put the form on your website." below={<GuideLink id="quote-link" />} />')
    const header = code('apps/web/src/components/ui/PageHeader.tsx')
    expect(header.indexOf('{title}</h1>')).toBeLessThan(header.indexOf('{below}'))
    expect(header.indexOf('{below}')).toBeLessThan(header.indexOf('tape-rule'))
  })

  it('9. the quote page’s "Next step" card: only while the quote waits for approval', () => {
    const box = code('apps/web/src/components/quotes/NextStepBox.tsx')
    expect(box).toMatch(/\{turn\.action === 'approve' && \(\s*<>\s*<button[^>]*>\s*\{approving \? B\.approving : B\.approve\}\s*<\/button>\s*<GuideLink id="approve" \/>\s*<\/>\s*\)\}/)
    expect(box.match(/<GuideLink/g)).toHaveLength(1)
  })

  it('10. Home: "Getting started", below "Waiting for you" and never above it', () => {
    const home = code('apps/web/src/app/(dashboard)/app/page.tsx')
    expect(home).toContain('<GettingStarted tenantId={profile.tenant_id} sentQuotes={sentResult.data?.length ?? 0} />')
    expect(home.indexOf('<WaitingForYou quotes={waiting} />')).toBeGreaterThan(0)
    expect(home.indexOf('<WaitingForYou quotes={waiting} />')).toBeLessThan(home.indexOf('<GettingStarted'))
    expect(home.match(/<GettingStarted/g)).toHaveLength(1)
    // sent quotes: this business's own, never a setup test, and no more rows than the rule needs
    expect(home).toMatch(/\.eq\('tenant_id', profile\.tenant_id\)\s*\.eq\('is_test', false\)\s*\.not\('sent_at', 'is', null\)\s*\.limit\(GETTING_STARTED_UNTIL\)/)
  })

  it('10. the card lists the six guides in order and hides at three sent quotes', () => {
    expect(GETTING_STARTED_UNTIL).toBe(3)
    expect([0, 1, 2, 3, 4, 50].map((sent) => showGettingStarted(sent, false))).toEqual([true, true, true, false, false, false])
    const card = (sentQuotes: number) => renderToStaticMarkup(createElement(GettingStarted, { tenantId: 'tenant-a', sentQuotes })).replace(/<!-- -->/g, '')
    expect(card(3)).toBe('')
    expect(card(7)).toBe('')
    const html = card(2)
    expect(html).toContain('>Getting started</h2>')
    expect([...html.matchAll(/<li[^>]*data-guide="([a-z-]+)"/g)].map((m) => m[1])).toEqual([...SETUP_GUIDES])
    expect([...html.matchAll(/<span class="figure[^"]*">(\d)<\/span><span class="font-medium">([^<]+)<\/span>/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      '1 Add a service',
      '2 Set your prices',
      '3 Test your pricing',
      '4 Share your quote link',
      '5 Check and approve',
      '6 Quote on site',
    ])
    expect(html.match(/data-testid="guide-link-/g)).toHaveLength(6)
    expect(html).not.toContain('<video')
  })

  it('10. "Hide" puts it away, remembered for this business in this browser', async () => {
    expect(showGettingStarted(0, true)).toBe(false)
    expect(showGettingStarted(2, true)).toBe(false)
    const card = code('apps/web/src/components/guide/GettingStarted.tsx')
    expect(card).toContain('const key = gettingStartedHiddenKey(tenantId)')
    expect(card).toContain('const hidden = useRemembered(key)')
    expect(card).toContain('if (!showGettingStarted(sentQuotes, hidden)) return null')
    expect(card).toMatch(/<button\s+type="button"\s+onClick=\{\(\) => remember\(key\)\}[\s\S]*?\{GUIDE_COPY\.hide\}\s*<\/button>/)
    expect(GUIDE_COPY.hide).toBe('Hide')
    // pressing it: the key is remembered, and the rule then says no
    const { remember, remembered } = await import('@/components/guide/memory')
    const key = gettingStartedHiddenKey('tenant-a')
    expect(showGettingStarted(0, remembered(key))).toBe(true)
    remember(key)
    expect(showGettingStarted(0, remembered(key))).toBe(false)
    // another business in the same browser still sees its own
    expect(showGettingStarted(0, remembered(gettingStartedHiddenKey('tenant-b')))).toBe(true)
    // a card hidden earlier is hidden before it is first painted, by the same key
    const html = renderToStaticMarkup(createElement(GettingStarted, { tenantId: 'tenant-a', sentQuotes: 0 }))
    expect(html).toContain(`<script>try{if(localStorage.getItem(&quot;${key}&quot;)===&#x27;1&#x27;)document.currentScript.parentElement.hidden=true}catch(e){}</script>`.replace(/&quot;/g, '"').replace(/&#x27;/g, "'"))
  })

  it('11. the support page: "Video guides", the same list and the same link', () => {
    const page = code('apps/web/src/app/support/page.tsx')
    expect(page).toMatch(/<h2[^>]*>\{GUIDE_COPY\.videoGuides\}<\/h2>[\s\S]*?<GuideList \/>/)
    expect(GUIDE_COPY.videoGuides).toBe('Video guides')
    const list = renderToStaticMarkup(createElement(GuideList)).replace(/<!-- -->/g, '')
    expect([...list.matchAll(/data-testid="guide-link-([a-z-]+)"/g)].map((m) => m[1])).toEqual([...SETUP_GUIDES])
    expect(code('apps/web/src/components/guide/GuideList.tsx')).toContain('<GuideLink id={id} />')
  })

  it('12. the marketing home page: no player in the hero any more (T-208 opens the video from a button)', () => {
    expect(existsSync(join(WEB, 'src/components/guide/HeroVideo.tsx'))).toBe(false)
    expect(code('apps/web/src/app/page.tsx')).not.toMatch(/HeroVideo|<video/)
  })
})

describe('T-207: the files are reached without a sign-in check', () => {
  it('nothing sets a content security policy that could block them', () => {
    for (const file of ['apps/web/next.config.js', 'apps/web/src/middleware.ts', 'apps/web/vercel.json', 'apps/web/src/app/layout.tsx']) {
      expect(read(file), file).not.toMatch(/Content-Security-Policy|media-src/i)
    }
  })

  it('the middleware leaves a video alone, as it does an image', () => {
    const matcher = /matcher: \[\s*'([^']+)'/.exec(code('apps/web/src/middleware.ts'))?.[1] ?? ''
    expect(matcher).toContain('|mp4)$')
    // the pattern as Next reads it (the string's doubled backslash is one)
    const pattern = new RegExp(`^${matcher.replace(/\\\\/g, '\\')}$`)
    for (const source of sources) {
      expect(pattern.test(source.src), source.src).toBe(false)
      expect(pattern.test(source.poster), source.poster).toBe(false)
    }
    // and the pages still go through it
    for (const page of ['/app', '/app/services', '/support', '/login', '/quote/harlow']) expect(pattern.test(page), page).toBe(true)
  })

  it('the deploy uploads them (nothing in .vercelignore leaves them out)', () => {
    const ignored = read('.vercelignore')
    expect(ignored).not.toMatch(/mp4|public/)
    expect(ignored).not.toContain(FOLDER_NAME)
  })
})
