/**
 * T-168: the hero photograph, the three-frame demo, the three-column figures.
 *
 * Four photographs were compared on a preview behind a switch. The owner
 * chose option b; the switch and the other three are gone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { HERO } from '@/lib/marketing/home-copy'
import { HERO_PHOTO, heroPhotoSrc } from '@/lib/marketing/hero-photo'
import { marketingExample } from '@/lib/marketing/examples'
import { DEMO_TIMELINE } from '@/components/marketing/home/HeroDemo'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = join(ROOT, 'apps/web')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

describe('T-168: the line under the headline', () => {
  it('is the owner’s wording', () => {
    expect(HERO.subline).toBe('The AI reads what your customer tells you and the photos they send, and works out the job. The price comes from your own price list, and you confirm it.')
  })
})

describe('T-168: the hero photograph (option b, the owner\'s choice)', () => {
  const component = code('apps/web/src/components/marketing/home/HeroPhoto.tsx')
  const css = read('apps/web/src/app/globals.css')

  it('one photograph in two sizes, each under 300 KB, with real alt text and no caption', () => {
    const sizes = JSON.parse(read('apps/web/public/photos/hero-sizes.json')) as Array<{ name: string; width: number; height: number; kb: number }>
    for (const width of [2400, 1200] as const) {
      const file = join(WEB, 'public', heroPhotoSrc(width))
      expect(existsSync(file), file).toBe(true)
      expect(statSync(file).size, file).toBeLessThan(300 * 1024)
      // a WebP file: "RIFF" … "WEBP"
      const head = readFileSync(file).subarray(0, 12).toString('latin1')
      expect(head.startsWith('RIFF') && head.endsWith('WEBP'), file).toBe(true)
    }
    const recorded = sizes.find((x) => x.name === 'hero-b-2400.webp')!
    expect([recorded.width, recorded.height]).toEqual([HERO_PHOTO.width, HERO_PHOTO.height])
    expect(HERO_PHOTO.width).toBe(2400)
    // a sentence that says what the picture shows; never a name, a customer or a claim
    expect(HERO_PHOTO.alt.length).toBeGreaterThan(40)
    expect(HERO_PHOTO.alt).not.toMatch(/customer of|our customer|review|testimonial|\b[A-Z][a-z]+ [A-Z]\.|AI[- ]generated|stock/)
    // only the chosen hero is in the repo: no other option, no candidate, no rejected image
    // (T-170 added other photographs beside it; marketing-t170.test.ts holds that list)
    expect(readdirSync(join(WEB, 'public/photos')).filter((f) => f.startsWith('hero-')).sort()).toEqual(['hero-b-1200.webp', 'hero-b-2400.webp', 'hero-sizes.json'])
    expect(component).not.toMatch(/caption/i)
    expect(component).toContain('alt={HERO_PHOTO.alt}')
    // and it is recorded: the model, the prompt, what was changed, what was rejected
    const record = read('Docs/design/photos.md')
    for (const part of ['gemini-3-pro-image', 'A house painter in paint-flecked white overalls', 'What was rejected, and why', 'the right-hand 7.7%']) expect(record, part).toContain(part)
  })

  it('the image keeps its place while it loads, and loads with priority', () => {
    expect(component).toContain('width={HERO_PHOTO.width}')
    expect(component).toContain('height={HERO_PHOTO.height}')
    expect(component).toContain('loading="eager"')
    expect(component).toContain('fetchPriority="high"')
    expect(component).toContain('srcSet={`${heroPhotoSrc(1200)} 1200w, ${heroPhotoSrc(2400)} 2400w`}')
    // its box is sized by CSS before the picture arrives (T-170: a set height at the top of the band on a phone, the band's own height from 768 px)
    expect(css).toContain('.hero-photo { position: absolute; top: 0; left: 0; right: 0; height: var(--photo-top); overflow: hidden; background: rgb(var(--ground)); }')
  })

  it('T-170: behind the words from 768 px, with the line under the headline on solid paper; never a block of its own above the headline', () => {
    const block = css.slice(css.indexOf('Scene photographs behind words'), css.indexOf('"Add it anywhere" on Home'))
    const from768 = block.slice(block.indexOf('@media (min-width: 768px) {'))
    // the fade is into the band's ground (paper), and it stays solid until after the line under the headline ends
    expect(from768).toContain('linear-gradient(90deg, rgb(var(--ground)) 0, rgb(var(--ground)) calc(var(--hero-edge) + 1.5rem), rgb(var(--ground) / 0) calc(var(--hero-edge) + var(--hero-fade)))')
    expect(from768).toContain('.hero-band h1 + p { max-width: var(--hero-text); }')
    expect(block).toContain('.hero-band { position: relative; --ground: 250 249 246;')
    // the line is 36rem wide from 1280 px, as T-168 set it, and narrower below (so the fade behind it is stronger)
    expect(block).toMatch(/@media \(min-width: 1280px\) \{\s*\.hero-band \{ --hero-text: 36rem;/)
    expect(block).toMatch(/@media \(min-width: 768px\) \{\s*\.hero-band \{\s*--hero-text: 24rem;/)
    // the photograph is never a block in the page's flow: it is always placed behind the band's own content
    expect(block).not.toMatch(/\.hero-photo(?: img)? \{[^}]*position: (static|relative)/)
    expect(block).not.toContain('aspect-ratio')
    // under 768 px it fades downwards into the ground, and Home's words start over the faded part
    expect(block).toContain('linear-gradient(180deg, rgb(var(--ground) / 0) 0')
    expect(block).toMatch(/@media \(max-width: 767px\) \{[^}]*\.home-hero > \.hero-inner \{ padding-top: 13\.5rem; \}/)
    // every gradient in that block is a photograph's fade into the ground: nothing else
    for (const g of block.match(/linear-gradient\([^;]+;/g) ?? []) expect(g, g).toMatch(/^linear-gradient\((90|180)deg, rgb\(var\(--ground\)/)
  })

  it('the generator: the key by name only, the model from an env var with a documented default, three attempts a scene', () => {
    const script = read('scripts/design/generate-hero-photos.mjs')
    expect(script).toContain("process.env.HERO_IMAGE_MODEL || 'gemini-3-pro-image'")
    expect(script).toContain('const MAX_PER_SCENE = 3')
    // T-170: the limit is per scene (each ticket keeps its own ledger); every call still checks it first
    expect(script).toContain('if (made(id) >= MAX_PER_SCENE) throw new Error')
    expect(script).toContain("'x-goog-api-key': key")
    // the key is never printed: nothing logs it, and no key value is written in the file
    expect(script).not.toMatch(/console\.(log|error|info)\([^)]*\bkey\b/)
    expect(script).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
    // candidates are written outside the repo
    expect(script).toContain("path.join(os.tmpdir(), 'qolumns-hero-photos')")
    for (const rule of ['no letters', 'No logos and no brand names', 'its screen is not visible', 'No recognisable real person', 'At most one small yellow object', 'not looking at the camera', 'The left 55 percent of the frame is calm']) expect(script, rule).toContain(rule)
  })
})

describe('T-168: the preview switch is gone', () => {
  it('no option switch, no script and no flag anywhere in the app', () => {
    const page = code('apps/web/src/app/page.tsx')
    expect(page).toMatch(/<section className="hero-band home-hero" data-testid="hero">\s*<HeroPhoto \/>\s*<div className=\{`\$\{WRAP\} hero-inner pb-16 pt-8 sm:pt-14`\}>\{heroBody\}<\/div>\s*<\/section>/)
    for (const f of ['apps/web/src/app/page.tsx', 'apps/web/src/components/marketing/home/HeroPhoto.tsx', 'apps/web/src/lib/marketing/hero-photo.ts', 'apps/web/src/app/globals.css']) {
      expect(read(f), f).not.toMatch(/HERO_PREVIEW|hero-switch|HeroSwitch|data-hero|currentScript|dangerouslySetInnerHTML|suppressHydrationWarning|\?hero=/)
    }
    expect(existsSync(join(WEB, 'src/components/marketing/home/HeroPhotos.tsx'))).toBe(false)
    expect(existsSync(join(WEB, 'src/lib/marketing/hero-photos.ts'))).toBe(false)
    // Home's photograph is on Home only (T-170 gave each trade page a photograph of its own, through ScenePhoto)
    for (const other of ['apps/web/src/app/features/page.tsx', 'apps/web/src/components/marketing/TradeLanding.tsx', 'apps/web/src/app/pricing/page.tsx']) expect(code(other)).not.toMatch(/HeroPhoto|hero-b-|HERO_PHOTO/)
    for (const none of ['apps/web/src/app/features/page.tsx', 'apps/web/src/app/pricing/page.tsx']) expect(code(none)).not.toMatch(/ScenePhoto|hero-photo/)
  })
})

describe('T-168: the hero demo is three frames of one height', () => {
  const demo = code('apps/web/src/components/marketing/home/HeroDemo.tsx')

  it('one idea each: a question and its button; a short estimate and the locked Accept; one lead and "Approve & send"', () => {
    expect(demo).toContain('Get my estimate')
    expect(demo).toContain('data-testid="demo-accept">Accept<')
    expect(demo).toMatch(/data-testid="demo-approve">\s*Approve &amp; send/)
    expect(demo).toContain('QUOTE_TURN_COPY.home.title')
    // no photo field, no label-reading step, no long breakdown
    expect(demo).not.toMatch(/photo|QuestionScreen|EstimateSheet|demo-confirmed/)
    // T-187 (the owner's review): "Approve & send" is pressed and the lead changes to its sent state: the
    // chip, the line and the button's place, each in the dashboard's own words, never typed here
    expect(demo).toContain('data-testid="demo-sent"')
    expect(demo).toContain('data-testid="demo-chip-after"')
    expect(demo).toContain("quoteTurn({ status: 'sent'")
    expect(demo).toContain('{sent.detail}')
    expect(demo).toContain('{content.sentNote}')
    expect(demo).not.toMatch(/Waiting for customer|not opened yet|Sent to the customer/)
    expect(Object.keys(DEMO_TIMELINE)).not.toContain('read')
    // a short estimate: the example the hero uses has one or two lines
    const example = marketingExample()
    expect(example.lines.length).toBeGreaterThanOrEqual(1)
    expect(example.lines.length).toBeLessThanOrEqual(2)
    expect(example.photo).toBeNull()
  })

  it('the frames are the same height at every width, and stack on a phone', () => {
    // one grid: equal rows when stacked (auto-rows-fr), one row of three from md up; each card fills its frame
    expect(demo).toContain('className="demo-frames grid auto-rows-fr gap-6 md:grid-cols-3 md:gap-5"')
    expect(demo).toContain('className="flex min-w-0 flex-col" data-testid="demo-frame"')
    expect(demo).toMatch(/className="flex flex-1 flex-col rounded-3xl[^"]*" data-testid="demo-card"/)
    expect(demo).not.toMatch(/overflow-x-auto|snap-x/)
    // one play, and "Play again"
    expect(demo).toContain('<ol key={run}')
    expect(demo).toContain('data-testid="demo-replay"')
  })
})

describe('T-168: "What homeowners want" is three columns again, and still second', () => {
  it('the figure, the short line under it, then its source; one column on a phone', () => {
    const page = code('apps/web/src/app/page.tsx')
    expect(page).toContain('className="mt-10 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-border-strong" data-testid="statistics"')
    const figure = page.slice(page.indexOf('data-testid="statistics"'), page.indexOf('</figure>', page.indexOf('data-testid="statistics"')))
    expect(figure.indexOf('{s.figure}')).toBeLessThan(figure.indexOf('{s.text}'))
    expect(figure.indexOf('{s.text}')).toBeLessThan(figure.indexOf('{s.source}'))
    expect(page.indexOf('data-testid="hero"')).toBeLessThan(page.indexOf('data-testid="homeowners"'))
    expect(page.indexOf('data-testid="homeowners"')).toBeLessThan(page.indexOf('data-testid="notices"'))
  })
})
