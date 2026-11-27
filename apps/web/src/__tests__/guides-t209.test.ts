/**
 * T-209: the hero is a new, longer video, and a guide of a minute or more says its length in minutes.
 *
 * `guideLength` is the one place a length is turned into words: the marketing pages' video button, the
 * dashboard's "Watch how" link and what each tells a screen reader all go through it. What a browser
 * shows, and that each video file is as long as the list says, is scripts/hardcore-test/verify-t209.mts.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PRODUCT_NAME } from '@qolumns/shared'
import { GUIDES, GUIDE_COPY, MINUTE, SETUP_GUIDES, guide, guideLength, sourceFor, type GuideId } from '@/lib/guides'
import { WATCH } from '@/lib/marketing/home-copy'
import { GuideDialog } from '@/components/guide/GuideDialog'
import { GuideLink } from '@/components/guide/GuideLink'
import { WatchButton } from '@/components/guide/WatchButton'

const SRC = join(__dirname, '..')
const plain = (html: string) => html.replace(/<!-- -->/g, '')
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const button = (id: GuideId, words: string) => plain(renderToStaticMarkup(createElement(WatchButton, { id, words })))
/** A guide file's own name (only lib/guides.ts spells the folder) */
const file = (path: string | undefined) => path?.split('/').pop()
const link = (id: GuideId) => plain(renderToStaticMarkup(createElement(GuideLink, { id })))

describe('T-209 item 2: a guide’s length, as a screen says it', () => {
  it('under a minute it is seconds, as before', () => {
    expect(guideLength(33)).toEqual({ figure: '33', unit: 's', text: '33 s', spoken: '33 seconds' })
    expect(guideLength(23).text).toBe('23 s')
    expect(guideLength(59)).toEqual({ figure: '59', unit: 's', text: '59 s', spoken: '59 seconds' })
  })

  it('from 60 seconds it is minutes: "1 min"', () => {
    expect(MINUTE).toBe(60)
    expect(guideLength(60)).toEqual({ figure: '1', unit: 'min', text: '1 min', spoken: '1 minute' })
    expect(guideLength(61).text).toBe('1 min')
    expect(guideLength(89).text).toBe('1 min')
  })

  it('longer ones are whole minutes, to the nearest, and never "0 min" or "60 s"', () => {
    expect(guideLength(90)).toEqual({ figure: '2', unit: 'min', text: '2 min', spoken: '2 minutes' })
    expect(guideLength(120).text).toBe('2 min')
    expect(guideLength(200).text).toBe('3 min')
    for (let seconds = 1; seconds <= 600; seconds++) {
      const said = guideLength(seconds)
      expect(said.text, String(seconds)).toBe(`${said.figure} ${said.unit}`)
      expect(said.text, String(seconds)).toMatch(seconds < 60 ? /^[1-9]\d? s$/ : /^[1-9]\d* min$/)
      expect(said.spoken, String(seconds)).toMatch(seconds < 60 ? /^\d+ seconds$/ : /^(1 minute|[2-9]\d* minutes|1\d+ minutes)$/)
    }
  })

  it('the hero’s button reads "See how it works · 1 min", the figure in the figure face', () => {
    const html = button('hero', WATCH.hero)
    expect(text(html)).toBe('See how it works · 1 min')
    expect(html).toContain('<span><span class="figure">1</span> min</span>')
    expect(html).toContain('aria-label="See how it works (video, 1 minute, with sound)"')
  })

  it('a shorter guide keeps the "32 s" style, on a marketing page and in the dashboard', () => {
    expect(text(button('add-service', WATCH.setup))).toBe('See setup · 32 s')
    expect(text(button('on-site', WATCH.onSite))).toBe('Watch it on site · 39 s')
    expect(button('add-service', WATCH.setup)).toContain('aria-label="See setup (video, 32 seconds, with sound)"')
    for (const id of SETUP_GUIDES) {
      expect(text(link(id)), id).toBe(`Watch how · ${guide(id).seconds} s`)
      expect(link(id), id).toContain(`aria-label="Watch how: ${guide(id).title} (${guide(id).seconds} seconds)"`)
    }
  })

  it('the dashboard’s link says a minute the same way (no guide there is that long yet)', () => {
    expect(text(link('hero'))).toBe('Watch how · 1 min')
    expect(link('hero')).toContain(`aria-label="Watch how: How ${PRODUCT_NAME} works (1 minute)"`)
    expect(GUIDE_COPY.linkLabel(GUIDES.hero, true)).toBe(`Watch how: How ${PRODUCT_NAME} works (1 minute), watched`)
  })

  it('the six how-to guides are each under a minute, as the page says of them', () => {
    expect(GUIDE_COPY.gettingStartedLine).toContain('each under a minute')
    expect(GUIDE_COPY.videoGuidesLine).toContain('each under a minute')
    for (const id of SETUP_GUIDES) expect(guide(id).seconds, id).toBeLessThan(MINUTE)
  })

  it('one formatter, used everywhere the length shows: no other file writes a guide’s seconds out', () => {
    const users: string[] = []
    const writers: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (name === '__tests__') continue
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name)) {
          const src = readFileSync(full, 'utf8')
          if (/guideLength\(/.test(src)) users.push(relative(SRC, full))
          // a guide's seconds put on a screen or into a sentence by hand
          if (/\.seconds\}(<\/span>)? ?s\b|\.seconds\} seconds|\.seconds\} min/.test(src)) writers.push(relative(SRC, full))
        }
      }
    }
    walk(SRC)
    expect(users.sort()).toEqual(['components/guide/GuideLink.tsx', 'components/guide/WatchButton.tsx', 'lib/guides.ts'])
    expect(writers).toEqual([])
  })
})

describe('T-209 item 1: the hero is the new video', () => {
  it('is 60 seconds long and called "How Qolumns works"', () => {
    expect(GUIDES.hero.seconds).toBe(60)
    expect(PRODUCT_NAME).toBe('Qolumns')
    expect(GUIDES.hero.title).toBe(`How ${PRODUCT_NAME} works`)
    // the same two files, wide and upright: only what is in them changed
    expect([GUIDES.hero.src, GUIDES.hero.poster, GUIDES.hero.tall?.src, GUIDES.hero.tall?.poster].map(file)).toEqual(['hero-16x9.mp4', 'hero-16x9.jpg', 'hero-9x16.mp4', 'hero-9x16.jpg'])
  })

  it('its transcript is the new voiceover, line for line', () => {
    expect(GUIDES.hero.transcript).toEqual([
      'Most homeowners look for a price online before they call. Very few find one.',
      'And the first business to give them a price often wins the job.',
      `With ${PRODUCT_NAME}, they snap a few photos and answer a few questions, on your website, or from your quote link.`,
      'Usually within a minute, they see an estimate in your prices. Even at ten at night, when no one else is answering.',
      'You get a notification on your phone, and an email.',
      'The AI works out the job. Your prices work out the cost, line by line.',
      'Change anything you like, then approve and send.',
      'Your customer gets the quote by email, every line explained, and accepts with one tap.',
      'And you know the moment they say yes.',
      `Out on a job? Use the ${PRODUCT_NAME} app. Take the photos, scan the room, and give your customer a quote before you leave.`,
      `${PRODUCT_NAME}. Answer first, in your prices. Try it free: ten quotes, no card needed.`,
    ])
    // the voice is told "Kollums" so that it says the name like "columns"; a screen reader is given the name itself
    expect(GUIDES.hero.transcript.join(' ')).not.toMatch(/Kollums|Collums/i)
  })

  it('the open window carries the new title and the new words, for a screen reader only', () => {
    for (const narrow of [false, true]) {
      const html = plain(renderToStaticMarkup(createElement(GuideDialog, { guide: GUIDES.hero, source: sourceFor(GUIDES.hero, narrow), dialogRef: { current: null }, videoRef: { current: null }, onClosed: () => undefined })))
      expect(html).toContain(`>How ${PRODUCT_NAME} works</h2>`)
      const said = /<div id="([^"]+)" class="sr-only" data-testid="guide-words">([\s\S]*?)<\/div>/.exec(html)
      expect(said).not.toBeNull()
      expect(html).toContain(`aria-describedby="${said![1]}"`)
      expect(said![2]!.match(/<p>/g)).toHaveLength(11)
      expect(html).not.toContain('Photo in, quote out')
    }
  })
})

describe('T-209 item 3: guides 2 and 6 changed as files only', () => {
  it('their titles, lengths and words are as they were', () => {
    expect([guide('set-prices').title, guide('set-prices').seconds, file(guide('set-prices').src)]).toEqual(['Set your prices', 25, 'guide-2-set-your-prices.mp4'])
    expect([guide('on-site').title, guide('on-site').seconds, file(guide('on-site').src)]).toEqual(['Quote on site', 39, 'guide-6-quote-on-site.mp4'])
    expect(guide('set-prices').transcript).toHaveLength(4)
    expect(guide('on-site').transcript).toHaveLength(6)
  })
})
