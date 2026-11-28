/**
 * T-208: the home page's videos open in a window over the page; a transcript is no longer shown.
 *
 * What a browser does (the window opening on the right guide, Escape, the dark page and the ✕
 * closing it, the focus coming back, the page not scrolling behind it, the Services buttons on one
 * row) is proved in a real browser by scripts/hardcore-test/verify-t208.mts. Here: what is on the
 * page before anything is pressed, which video a screen gets, what counts as a press on the dark
 * page, and where the voiceover's words went.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { GUIDES, GUIDE_COPY, SETUP_GUIDES, UPRIGHT_QUERY, UPRIGHT_UNDER, guide, guideLength, sourceFor, type GuideId } from '@/lib/guides'
import { WATCH } from '@/lib/marketing/home-copy'
import { MAIN_CTA, QUIET_BUTTON, WATCH_BUTTON } from '@/lib/marketing/cta'
import { guideClosed, pressClosesWindow } from '@/components/guide/control'
import { GuideDialog } from '@/components/guide/GuideDialog'
import { GuideLink } from '@/components/guide/GuideLink'
import { WatchButton } from '@/components/guide/WatchButton'

const ROOT = join(__dirname, '../../../..')
const WEB = join(ROOT, 'apps/web')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const code = (path: string) => read(path).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const plain = (html: string) => html.replace(/<!-- -->/g, '')
const button = (id: GuideId, words: string) => plain(renderToStaticMarkup(createElement(WatchButton, { id, words })))
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('T-208 item 1: the hero is as it was before T-207', () => {
  const page = code('apps/web/src/app/page.tsx')

  it('the hero contains no video element, and the player that stood in it is gone', () => {
    expect(existsSync(join(WEB, 'src/components/guide/HeroVideo.tsx'))).toBe(false)
    expect(page).not.toMatch(/HeroVideo|<video|hero-video/)
    // nothing on the page itself is a video: one only exists inside the window, once a button is pressed
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx$/.test(name) && /<video[\s>]/.test(readFileSync(full, 'utf8'))) files.push(relative(WEB, full))
      }
    }
    walk(join(WEB, 'src/app'))
    walk(join(WEB, 'src/components/marketing'))
    walk(join(WEB, 'src/components/guide'))
    expect(files).toEqual(['src/components/guide/GuideDialog.tsx'])
  })

  it('headline, text, the buttons, the small line, then the three frames: nothing between them', () => {
    const order = ['{HERO.headline}</h1>', '{HERO.subline}</p>', 'data-testid="hero-signup"', 'data-testid="hero-demo"', '<WatchButton id="hero"', '{HERO.smallLine}</p>', '<HeroDemo'].map((mark) => page.indexOf(mark))
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(page).toMatch(/\{HERO\.smallLine\}<\/p>\s*<\/div>\s*<div className="mt-10 lg:mt-12">\s*<HeroDemo/)
  })
})

describe('T-208 items 2 to 4: three video buttons, one window', () => {
  const page = code('apps/web/src/app/page.tsx')

  it('the hero’s third action comes after "Try it as a customer", in the same row', () => {
    expect(page).toMatch(/Try it as a customer\s*<\/Link>\s*<WatchButton id="hero" words=\{WATCH\.hero\} className="sm:px-2" \/>\s*<\/div>/)
    // a column on a phone (so it sits under the two buttons), a row that can wrap from 640 px
    expect(page).toContain('<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-testid="hero-actions">')
  })

  it('"See how it works · 1 min" (T-209: it was "· 33 s"), "See setup · 32 s", "Watch it on site · 39 s": the lengths are the list’s', () => {
    expect(WATCH).toEqual({ hero: 'See how it works', setup: 'See setup', onSite: 'Watch it on site' })
    expect(text(button('hero', WATCH.hero))).toBe(`See how it works · ${guideLength(GUIDES.hero.seconds).text}`)
    expect(text(button('hero', WATCH.hero))).toBe('See how it works · 1 min')
    expect(text(button('add-service', WATCH.setup))).toBe(`See setup · ${guide('add-service').seconds} s`)
    expect(text(button('on-site', WATCH.onSite))).toBe(`Watch it on site · ${guide('on-site').seconds} s`)
    expect([GUIDES.hero.seconds, guide('add-service').seconds, guide('on-site').seconds]).toEqual([60, 32, 39])
    // no length is typed on the page or in the button
    for (const file of ['apps/web/src/app/page.tsx', 'apps/web/src/components/marketing/home/AppSection.tsx', 'apps/web/src/components/guide/WatchButton.tsx', 'apps/web/src/lib/marketing/home-copy.ts']) {
      expect(code(file), file).not.toMatch(/\b3[239] s\b|\b\d+ min\b/)
    }
    expect(code('apps/web/src/components/guide/WatchButton.tsx')).toContain('<span className="figure">{length.figure}</span> {length.unit}')
  })

  it('each is a button with a play mark, its words, and what a screen reader needs', () => {
    const html = button('hero', WATCH.hero)
    expect(html).toMatch(/^<button type="button" aria-label="See how it works \(video, 1 minute, with sound\)" aria-haspopup="dialog"/)
    expect(html).toContain('data-testid="watch-hero"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(GUIDE_COPY.buttonLabel(WATCH.onSite, guide('on-site'))).toBe('Watch it on site (video, 39 seconds, with sound)')
  })

  it('it is quieter than the two buttons beside it: no ground, no edge, and never yellow', () => {
    expect(WATCH_BUTTON).not.toMatch(/\bbg-|\bborder\b|border-/)
    expect(MAIN_CTA).toMatch(/\bbg-accent\b/)
    expect(QUIET_BUTTON).toMatch(/\bborder-field\b/)
    // the same height as its neighbours, so the row stays level
    for (const style of [MAIN_CTA, QUIET_BUTTON, WATCH_BUTTON]) expect(style).toContain('min-h-[48px]')
  })

  it('each opens the same window on its own guide, and until it is pressed nothing of a video is on the page', () => {
    for (const [id, words] of [['hero', WATCH.hero], ['add-service', WATCH.setup], ['on-site', WATCH.onSite]] as const) {
      const html = button(id, words)
      expect(html, id).toMatch(new RegExp(`</button><dialog[^>]*class="guide-dialog"[^>]*data-testid="guide-dialog" data-guide="${id}"></dialog>$`))
      expect(html, id).not.toMatch(/<video|\.mp4|\.jpg/)
    }
    // one window component: the dashboard's link and the page's button both get it from useGuide
    const users: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name) && !full.includes('__tests__') && /<dialog|<GuideDialog/.test(readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))) users.push(relative(WEB, full))
      }
    }
    walk(join(WEB, 'src/components/guide'))
    walk(join(WEB, 'src/components/marketing'))
    expect(users.sort()).toEqual(['src/components/guide/GuideDialog.tsx', 'src/components/guide/useGuide.tsx'])
    for (const file of ['GuideLink.tsx', 'WatchButton.tsx']) expect(code(`apps/web/src/components/guide/${file}`), file).toMatch(/const \{ guide, opener, show, dialog \} = useGuide\(id/)
  })

  it('4. "Set up in minutes" and the on-site app’s section each have theirs under the intro text', () => {
    expect(page).toMatch(/\{SETUP\.lead\}<\/p>\s*<div className="mt-1 flex justify-start">\s*<WatchButton id="add-service" words=\{WATCH\.setup\} \/>\s*<\/div>\s*<SetupSteps/)
    const app = code('apps/web/src/components/marketing/home/AppSection.tsx')
    expect(app).toMatch(/\{app\.lines\.map\([\s\S]*?<\/ul>\s*<div className="mt-3 flex justify-start">\s*<WatchButton id="on-site" words=\{WATCH\.onSite\} \/>\s*<\/div>\s*<p[^>]*data-testid="app-availability">/)
    expect(page.match(/<WatchButton /g)).toHaveLength(2)
    expect(app.match(/<WatchButton /g)).toHaveLength(1)
  })

  it('a visitor’s browser is left alone: the page’s button remembers nothing', () => {
    expect(code('apps/web/src/components/guide/WatchButton.tsx')).not.toMatch(/remember|localStorage|watched/i)
    // and closing a window that remembers nothing still stops the video and returns the focus
    const events: string[] = []
    guideClosed({ play: () => undefined, pause: () => events.push('pause') }, { focus: () => events.push('focus') })
    expect(events).toEqual(['pause', 'focus'])
  })
})

describe('T-208 item 3: the window', () => {
  it('the hero plays upright under 640 px and wide from 640 px; a guide with one video plays that', () => {
    const hero = GUIDES.hero
    expect(UPRIGHT_UNDER).toBe(640)
    expect(UPRIGHT_QUERY).toBe('(max-width: 639px)')
    expect(sourceFor(hero, true)).toBe(hero.tall)
    expect(sourceFor(hero, false)).toBe(hero)
    expect([sourceFor(hero, true).width, sourceFor(hero, true).height]).toEqual([1080, 1920])
    expect([sourceFor(hero, false).width, sourceFor(hero, false).height]).toEqual([1920, 1080])
    for (const id of SETUP_GUIDES) {
      expect(sourceFor(guide(id), true)).toBe(guide(id))
      expect(sourceFor(guide(id), false)).toBe(guide(id))
    }
  })

  const open = (id: GuideId, narrow = false) => {
    const g = guide(id)
    return plain(renderToStaticMarkup(createElement(GuideDialog, { guide: g, source: sourceFor(g, narrow), dialogRef: { current: null }, videoRef: { current: null }, onClosed: () => undefined })))
  }

  it('open, it holds the guide’s title, a ✕ and the video, sized to fit the screen at the video’s own shape', () => {
    const wide = open('hero')
    expect(wide).toContain('>How Qolumns works</h2>')
    expect(wide).toMatch(/<button type="button" aria-label="Close"[^>]*data-testid="guide-close"><svg/)
    expect(wide).toContain(`poster="${GUIDES.hero.poster}" src="${GUIDES.hero.src}" width="1920" height="1080"`)
    expect(wide).toContain('style="width:min(100%, calc((100dvh - var(--guide-chrome)) * 1920 / 1080), 1920px)"')
    expect(wide).toContain('style="aspect-ratio:1920 / 1080"')
    const upright = open('hero', true)
    expect(upright).toContain(`poster="${GUIDES.hero.tall!.poster}" src="${GUIDES.hero.tall!.src}" width="1080" height="1920"`)
    expect(upright).toContain('style="width:min(100%, calc((100dvh - var(--guide-chrome)) * 1080 / 1920), 1080px)"')
    expect(upright).not.toContain(GUIDES.hero.src)
    expect(wide).toMatch(/<video controls="" playsinline="" preload="none"/)
    expect(wide).not.toMatch(/autoplay/i)
  })

  it('the page behind is dark and does not scroll; the window is the whole screen', () => {
    const css = read('apps/web/src/app/globals.css')
    const rule = /dialog\.guide-dialog \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/position: fixed;\s*inset: 0;\s*width: 100vw;\s*height: 100dvh;/)
    expect(rule).toMatch(/background: transparent;/)
    expect(css).toMatch(/dialog\.guide-dialog::backdrop \{\s*background: rgb\(var\(--color-ink-rgb, 27 40 35\) \/ 0\.9\);\s*\}/)
    expect(css).toMatch(/html:has\(dialog\.guide-dialog\[open\]\) \{\s*overflow: hidden;\s*scrollbar-gutter: stable;\s*\}/)
  })

  it('a press closes it when it began and ended off the video; the ✕ and Escape close it too', () => {
    const el = (tagName: string) => ({ tagName })
    expect(pressClosesWindow(el('DIALOG'), el('DIALOG'))).toBe(true)
    expect(pressClosesWindow(el('DIV'), el('DIV'))).toBe(true)
    expect(pressClosesWindow(el('H2'), el('DIV'))).toBe(true)
    // on the video (its picture, its controls): never
    expect(pressClosesWindow(el('VIDEO'), el('VIDEO'))).toBe(false)
    // the video's slider dragged and let go under it, or a press that slid onto the video
    expect(pressClosesWindow(el('VIDEO'), el('DIV'))).toBe(false)
    expect(pressClosesWindow(el('DIV'), el('VIDEO'))).toBe(false)
    // a click with no press before it (the keyboard on the ✕) is the ✕'s own to close
    expect(pressClosesWindow(null, el('BUTTON'))).toBe(false)
    const dialog = code('apps/web/src/components/guide/GuideDialog.tsx')
    expect(dialog).toContain('if (pressClosesWindow(began.current as Element | null, e.target as Element)) e.currentTarget.close()')
    expect(dialog).toContain('onClick={() => dialogRef.current?.close()}')
    expect(dialog).toContain('onClose={onClosed}')
    // Escape is the browser's: nothing here stops the dialog's own "cancel"
    expect(dialog).not.toMatch(/onCancel|preventDefault|onKeyDown/)
  })
})

describe('T-208 item 5: the transcript is for a screen reader only', () => {
  it('nothing anywhere says "Read the transcript", and nothing draws a transcript', () => {
    expect(Object.keys(GUIDE_COPY)).not.toContain('transcript')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__') walk(full)
        } else if (/\.tsx?$/.test(name) && /Read the transcript|GuideTranscript|guide-transcript/.test(readFileSync(full, 'utf8'))) hits.push(relative(WEB, full))
      }
    }
    walk(join(WEB, 'src'))
    // the generated help pages are written from Docs/help, which no longer says it either
    expect(hits).toEqual([])
    expect(read('Docs/help/01-getting-started.md')).not.toMatch(/transcript/i)
    expect(GUIDE_COPY.videoGuidesLine).not.toMatch(/written out|transcript/i)
    // the only user of a guide's transcript is the window
    // (T-210: the private voice test keeps the transcript of a test call, which is another thing; its two folders are left out)
    const users: string[] = []
    const find = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__' && name !== 'voice' && name !== 'voice-test') find(full)
        } else if (/\.tsx?$/.test(name) && /\.transcript\b/.test(readFileSync(full, 'utf8'))) users.push(relative(WEB, full))
      }
    }
    find(join(WEB, 'src'))
    expect(users).toEqual(['src/components/guide/GuideDialog.tsx'])
  })

  it('the words are still in the list, and in the open window as text only a screen reader gets', () => {
    for (const g of Object.values(GUIDES)) {
      expect(g.transcript.length, g.id).toBeGreaterThan(3)
      const html = plain(renderToStaticMarkup(createElement(GuideDialog, { guide: g, source: g, dialogRef: { current: null }, videoRef: { current: null }, onClosed: () => undefined })))
      const described = /<dialog[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1]
      expect(described, g.id).toBeTruthy()
      const words = new RegExp(`<div id="${described}" class="sr-only"[^>]*>(.*?)</div>`).exec(html)?.[1] ?? ''
      expect([...words.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]!.replace(/&#x27;/g, "'")), g.id).toEqual([...g.transcript])
      // and nowhere else in the window
      expect(html.split(g.transcript[0]!.replace(/'/g, '&#x27;'))).toHaveLength(2)
      expect(html).not.toMatch(/<details|<summary/)
    }
  })

  it('a closed window holds none of it: a page with a guide link carries no transcript', () => {
    for (const html of [button('hero', WATCH.hero), plain(renderToStaticMarkup(createElement(GuideLink, { id: 'add-service' })))]) {
      expect(html).not.toContain('sr-only')
      expect(html).not.toContain('Start by adding the jobs you do.')
      expect(html).not.toContain('Start free')
    }
  })
})

describe('T-208 item 6: the Services header', () => {
  it('the guide link is under the page’s line, so the row of buttons is the three it had', () => {
    const services = code('apps/web/src/app/(dashboard)/app/services/page.tsx')
    const actions = /actions=\{([\s\S]*?)\}\s*\/>/.exec(services)?.[1] ?? ''
    expect(actions.match(/<button/g)).toHaveLength(3)
    expect(actions).not.toContain('GuideLink')
    expect(services).toContain('below={<GuideLink id="add-service" />}')
    // "below" is drawn under the description, inside the title's own block
    const header = code('apps/web/src/components/ui/PageHeader.tsx')
    expect(header.indexOf('{description}</p>')).toBeLessThan(header.indexOf('{below}'))
    expect(header.indexOf('{below}')).toBeLessThan(header.indexOf('{actions &&'))
  })
})
