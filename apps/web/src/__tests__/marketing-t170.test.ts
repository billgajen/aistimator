/**
 * T-170: marketing photographs and fixes. Home's hero at every width, "Add it
 * anywhere", the closing band and the trade pages' photographs, the demo's
 * sample photos, and an honest Pricing page.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { offeredPlans, DEMO_SAMPLE_PHOTO_PATH } from '@qolumns/shared'
import { TRADES } from '@/lib/marketing/trades'
import { TRADE_PHOTOS, CLOSING_PHOTO, VAN_PHOTO, scenePhotoSrc, type ScenePhoto } from '@/lib/marketing/photos'
import { HERO_PHOTO } from '@/lib/marketing/hero-photo'
import { shortLink } from '@/components/marketing/ShortLink'
import { DEMO_SAMPLE_PHOTOS } from '@/lib/demo/sample-photos'
import { DEMO_SERVICE_PICKS } from '@/lib/demo/demo-services'
import { COMING_LATER, PLAN_CHANNEL_LINES, PLAN_FEATURE_LINES, PLAN_HOSTED_PAGES, PRICING_DESCRIPTION, PRICING_LEAD, PRICING_TAGLINES, planLines, sitePlans } from '@/lib/marketing/plan-claims'
import { ADD_IT } from '@/lib/marketing/home-copy'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = join(ROOT, 'apps/web')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const isWebp = (file: string) => {
  const head = readFileSync(file).subarray(0, 12).toString('latin1')
  return head.startsWith('RIFF') && head.endsWith('WEBP')
}
const css = read('apps/web/src/app/globals.css')
const record = read('Docs/design/photos.md')
const SCENES: Array<[string, ScenePhoto]> = [...TRADES.map((t): [string, ScenePhoto] => [t.slug, TRADE_PHOTOS[t.slug]!]), ['closing', CLOSING_PHOTO]]

describe('T-170: the photographs', () => {
  it('each of the six trade pages has a photograph of its own, and Home’s closing band has one', () => {
    expect(TRADES).toHaveLength(6)
    for (const t of TRADES) expect(TRADE_PHOTOS[t.slug], t.slug).toBeTruthy()
    expect(Object.keys(TRADE_PHOTOS).sort()).toEqual(TRADES.map((t) => t.slug).sort())
    expect(new Set([...Object.values(TRADE_PHOTOS).map((p) => p.base), CLOSING_PHOTO.base, HERO_PHOTO.base]).size).toBe(8)
  })

  it('each is WebP at 2400 px under 300 KB with a 1200 px file, at the size the page is told', () => {
    const sizes = JSON.parse(read('apps/web/public/photos/photo-sizes.json')) as Array<{ name: string; width: number; height: number; kb: number }>
    for (const [name, photo] of SCENES) {
      for (const width of [2400, 1200] as const) {
        const file = join(WEB, 'public', scenePhotoSrc(photo, width))
        expect(existsSync(file), file).toBe(true)
        expect(isWebp(file), file).toBe(true)
        expect(statSync(file).size, file).toBeLessThan(300 * 1024)
      }
      const recorded = sizes.find((s) => s.name === `${photo.base.split('/').pop()}-2400.webp`)
      expect(recorded, name).toBeTruthy()
      expect([photo.width, photo.height], name).toEqual([recorded!.width, recorded!.height])
    }
  })

  it('each has real alt text that says what the picture shows, never a customer or a claim', () => {
    for (const [name, photo] of [...SCENES, ['van', VAN_PHOTO] as const]) {
      expect(photo.alt.length, name).toBeGreaterThan(40)
      expect(photo.alt, name).not.toMatch(/customer of|our customer|one of our|review|testimonial|\b[A-Z][a-z]+ [A-Z]\.|AI[- ]generated|stock|Qolumns/)
    }
  })

  it('only the chosen photographs are in the repo: no candidate and no rejected image', () => {
    const expected = ['hero-b-1200.webp', 'hero-b-2400.webp', 'hero-sizes.json', 'photo-sizes.json', 'van-1000.webp', 'van-500.webp', ...SCENES.flatMap(([, p]) => [`${p.base.split('/').pop()}-1200.webp`, `${p.base.split('/').pop()}-2400.webp`])].sort()
    expect(readdirSync(join(WEB, 'public/photos')).sort()).toEqual(expected)
    expect(readdirSync(join(WEB, 'public/demo')).sort()).toEqual(['example-home-services-logo.svg', 'sample-garage-door-springs.webp', 'sample-room-to-paint.webp', 'sample-water-heater-label.png', 'sample-water-heater-label.svg'])
  })

  it('every one is recorded: the file, the prompt, what was changed and what was rejected', () => {
    for (const [, photo] of SCENES) expect(record).toContain(`${photo.base.split('/').pop()}-2400.webp`)
    for (const part of ['van-1000.webp', 'sample-garage-door-springs.webp', 'sample-room-to-paint.webp', 'What was rejected, and why (T-170)', 'Calls used: 14', 'A plain white panel van', 'An electrician in their thirties', 'A homeowner in their forties in a plain cream sweater', 'An ordinary bedroom in an American home', 'The QR code and the words on the van are ours']) expect(record, part).toContain(part)
    // every patch and crop the converter makes is written down
    const converter = read('scripts/design/photos-to-webp.mjs')
    expect((converter.match(/\b(clone|blur): \[/g) ?? []).length).toBe(4)
    for (const said of ['`trade-painting`, a patch', '`trade-plumbing`, a patch', '`trade-electrical`, a cut', '`van`, a cut', '`demo-springs`, a patch']) expect(record, said).toContain(said)
  })

  it('the generator: every new scene carries the "never" list; nobody in the object scenes or the samples; evening only for the closing band', () => {
    const script = read('scripts/design/generate-hero-photos.mjs')
    for (const id of ['trade-painting', 'trade-hvac', 'trade-water-heaters', 'trade-plumbing', 'trade-electrical', 'trade-garage-doors', 'closing', 'van', 'demo-springs', 'demo-room']) expect(script, id).toMatch(new RegExp(`(?:'${id}'|\\b${id}): \\{`))
    expect(script).toContain('return [s.scene, s.composition ?? COMPOSITION.replace(\'PLACEHOLDER\', s.calm), s.art ?? ART_DIRECTION, NEVER].join')
    expect(script).toContain("nobody: 'There are no people in the picture, and no part of a person.'")
    for (const id of ['demo-springs', 'demo-room']) {
      const block = script.slice(script.indexOf(`'${id}': {`), script.indexOf('},', script.indexOf(`'${id}': {`)))
      expect(block, id).toContain('ART.nobody')
      expect(block, id).toContain("size: '1K'")
    }
    expect((script.match(/art: ART_DIRECTION_EVENING/g) ?? []).length).toBe(1)
    expect(script).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/)
  })
})

describe('T-170: the photograph behind the words, at every width', () => {
  const block = css.slice(css.indexOf('Scene photographs behind words'), css.indexOf('"Add it anywhere" on Home'))

  it('only a hero’s picture loads with priority; every picture has its width and height', () => {
    const scene = code('apps/web/src/components/marketing/ScenePhoto.tsx')
    expect(scene).toContain('width={photo.width}')
    expect(scene).toContain('height={photo.height}')
    expect(scene).toContain("loading={priority ? 'eager' : 'lazy'}")
    expect(scene).toContain("{...(priority ? { fetchPriority: 'high' as const } : {})}")
    // the trade hero asks for priority; the closing band does not
    expect(code('apps/web/src/components/marketing/TradeLanding.tsx')).toContain('<ScenePhoto photo={photo} priority testId="hero-photo" />')
    expect(code('apps/web/src/app/page.tsx')).toContain('<ScenePhoto photo={CLOSING_PHOTO} testId="closing-photo" />')
    const add = code('apps/web/src/components/marketing/home/AddItAnywhere.tsx')
    expect(add).toContain('width={VAN_PHOTO.width}')
    expect(add).toContain('loading="lazy"')
    expect(add).not.toContain('fetchPriority')
  })

  it('a trade hero: the photograph ends a fixed distance below the words, and the trade’s screen sits on it', () => {
    expect(block).toContain('.trade-hero .hero-photo { left: 50%; right: auto; width: 100vw; transform: translateX(-50%); top: calc(-1 * var(--hero-pt)); }')
    expect(block).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023px\) \{[^}]*\.trade-hero \.hero-photo \{ height: auto; bottom: -8rem; \}/)
    expect(block).toContain('.trade-hero-screen { margin-top: calc(var(--trade-photo) - var(--trade-on) - var(--hero-pt)); }')
    const trade = code('apps/web/src/components/marketing/TradeLanding.tsx')
    expect(trade).toContain('<section className="hero-band trade-hero" data-testid="hero">')
    // the trade's real screen is still the hero's picture of the product, as T-167 left it
    expect(trade).toMatch(/<Picture label=\{trade\.heroScreen\} className="trade-hero-screen[^"]*" testId="trade-hero-screen">\s*<Screen kind="form"/)
  })

  it('the closing band: the same treatment on juniper, with light words', () => {
    expect(block).toContain('.closing-band { --ground: 32 94 86; background: rgb(var(--ground));')
    const page = code('apps/web/src/app/page.tsx')
    expect(page).toContain('<section className="hero-band closing-band text-white" data-testid="closing">')
    // juniper is #205E56
    expect([0x20, 0x5e, 0x56]).toEqual([32, 94, 86])
    // one button and one quiet link, as before
    const closing = page.slice(page.indexOf('data-testid="closing"'), page.indexOf('<SiteFooter'))
    expect((closing.match(/<Link /g) ?? []).length).toBe(2)
  })

  it('CSS only: no new dependency, and nothing here animates', () => {
    const deps = JSON.parse(read('apps/web/package.json')) as { dependencies: Record<string, string> }
    for (const lib of ['framer-motion', 'motion', 'gsap', 'sharp', 'swiper', 'react-qr-code']) expect(deps.dependencies[lib], lib).toBeUndefined()
    expect(block).not.toMatch(/animation|transition/)
  })
})

describe('T-170: "Add it anywhere"', () => {
  const add = code('apps/web/src/components/marketing/home/AddItAnywhere.tsx')
  const layout = css.slice(css.indexOf('"Add it anywhere" on Home'), css.indexOf("T-169: the larger view of a customer's photo"))

  it('three columns of one height with pictures of one size; stacked on a phone', () => {
    expect((add.match(/data-testid="add-it-item"/g) ?? []).length).toBe(3)
    expect((add.match(/className="add-it-picture/g) ?? []).length).toBe(3)
    expect(layout).toContain('.add-it-picture { width: 100%; max-width: 20rem; aspect-ratio: 5 / 8; margin-inline: auto; }')
    expect(layout).toMatch(/@media \(min-width: 1024px\) \{\s*\.add-it \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); grid-template-rows: auto auto;/)
    expect(layout).toContain('.add-it-item { grid-row: span 2; grid-template-rows: subgrid;')
    // the van's picture is the same shape as its box, so the sign stays on the panel
    expect(VAN_PHOTO.width / VAN_PHOTO.height).toBeCloseTo(5 / 8, 5)
  })

  it('the QR code on the van is ours, placed in code on the van’s panel', () => {
    const van = add.slice(add.indexOf('data-testid="add-it-van"'), add.indexOf('2. The quote page on a phone'))
    expect(van).toContain('<QrSvg value={quoteLink}')
    expect(van).toContain('style={VAN_PHOTO.sign}')
    expect(van).toContain('{form.businessName}')
    for (const v of Object.values(VAN_PHOTO.sign)) expect(parseFloat(v)).toBeGreaterThan(0)
    expect(parseFloat(VAN_PHOTO.sign.left) + parseFloat(VAN_PHOTO.sign.width)).toBeLessThanOrEqual(100)
    expect(parseFloat(VAN_PHOTO.sign.top) + parseFloat(VAN_PHOTO.sign.height)).toBeLessThanOrEqual(100)
    expect(ADD_IT.screens.van).toBe('Scan for an estimate')
  })

  it('the quote page is in a phone-shaped frame, with the business’s name on one line', () => {
    expect(add).toContain('className="phone-frame mx-auto h-full shadow-warm-lg"')
    expect(add).toContain('<RequestFormScreen {...form} page className="mt-2" />')
    expect(layout).toContain('.phone-frame { position: relative; width: 100%; max-width: 19rem; border: 0.5rem solid var(--color-ink); border-radius: 2.5rem;')
    const form = code('apps/web/src/components/marketing/home/RequestFormScreen.tsx')
    expect(form).toContain('<p className="whitespace-nowrap font-display text-xl font-bold leading-tight text-text-primary" data-testid="phone-business-name">{businessName}</p>')
  })

  it('links are shown short and never break inside a word', () => {
    expect(shortLink('https://qolumns.com/quote/example-home-services')).toBe('qolumns.com/quote/example-home-services')
    expect(shortLink('https://www.example.com/quote/a-b/')).toBe('example.com/quote/a-b')
    expect(shortLink('http://localhost:3000/quote/x')).toBe('localhost:3000/quote/x')
    const link = code('apps/web/src/components/marketing/ShortLink.tsx')
    expect(link).toContain('<span className="whitespace-nowrap">')
    expect(link).toContain('<wbr />')
    expect(add).toContain('<ShortLink url={quoteLink} />')
    // nothing in the section breaks a word or cuts a name or a link with an ellipsis
    expect(add).not.toMatch(/break-all|break-words|truncate|text-\[1[01]px\]/)
  })
})

describe('T-170: the demo’s sample photos', () => {
  it('one per demo service that takes a photo, each a file in the repo', () => {
    expect(Object.keys(DEMO_SAMPLE_PHOTOS).sort()).toEqual(DEMO_SERVICE_PICKS.map((p) => p.name).sort())
    for (const [name, src] of Object.entries(DEMO_SAMPLE_PHOTOS)) expect(existsSync(join(WEB, 'public', src)), name).toBe(true)
    // the water heater keeps the label drawn for it: an image model must not draw a readable label
    expect(DEMO_SAMPLE_PHOTOS['Water Heater Replacement']).toBe(DEMO_SAMPLE_PHOTO_PATH)
    for (const src of ['/demo/sample-garage-door-springs.webp', '/demo/sample-room-to-paint.webp']) {
      expect(isWebp(join(WEB, 'public', src)), src).toBe(true)
      expect(statSync(join(WEB, 'public', src)).size, src).toBeLessThan(300 * 1024)
    }
  })

  it('each follows its service’s own first photo instruction', () => {
    const first = (name: string) => {
      const pick = DEMO_SERVICE_PICKS.find((p) => p.name === name)!
      return pick.pack.services.find((s) => s.name === name)!.draft.media.requiredAngles?.[0]
    }
    expect(first('Garage Door Spring Replacement')?.label).toBe('The springs above the door')
    expect(first('Interior Painting')?.guidance).toContain('Stand in the doorway and capture the whole room')
    expect(first('Water Heater Replacement')?.label).toBe('Tank rating label')
    expect(record).toContain('looking up at the wall above a closed white sectional garage door')
    expect(record).toContain('taken from the doorway at eye level so that the whole room is in the picture')
  })

  it('the button shows only for a service that has a sample; the real form is otherwise untouched', () => {
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toContain('samplePhotoUrl={demo && selectedServiceData ? demo.samplePhotos[selectedServiceData.name] : undefined}')
    expect(widget).toContain('{samplePhotoUrl && canAddPhotos && (')
    // a service that is not listed has none
    expect(DEMO_SAMPLE_PHOTOS['Exterior Painting']).toBeUndefined()
    expect(read('apps/web/src/components/demo/DemoExperience.tsx')).toContain('samplePhotos: DEMO_SAMPLE_PHOTOS,')
  })
})

describe('T-170: Pricing says only what a business can use today', () => {
  const page = code('apps/web/src/app/pricing/page.tsx')
  const NOT_LIVE = /text message|by text|\bSMS\b|WhatsApp|on[- ]site|LiDAR|team member|priority support/i

  it('a line that is not live is listed after the live ones and marked "Coming later"', () => {
    const [starter, pro, business] = offeredPlans()
    expect(planLines(starter!).map((l) => [l.label, l.live])).toEqual([['Website widget', true], ['Hosted estimate pages', true]])
    expect(planLines(pro!).filter((l) => !l.live).map((l) => l.label)).toEqual(['Quoting by text (SMS)', 'WhatsApp quoting', 'On-site app for your phone'])
    expect(planLines(business!).filter((l) => !l.live).map((l) => l.label)).toEqual(['Quoting by text (SMS)', 'WhatsApp quoting', 'On-site app for your phone', 'LiDAR room scanning on site', 'Multiple team members', 'Priority support'])
    for (const plan of offeredPlans()) {
      const lines = planLines(plan)
      const firstLater = lines.findIndex((l) => !l.live)
      if (firstLater >= 0) expect(lines.slice(firstLater).every((l) => !l.live), plan.id).toBe(true)
    }
    expect(COMING_LATER).toBe('Coming later')
    expect(page).toContain('{COMING_LATER}')
    expect(page).toContain('data-live="false"')
  })

  it('the owner’s decision: a plan is left off the public pages until a line of its own is live, so Business is off and Starter and Pro stay', () => {
    expect(sitePlans().map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    // nothing about the plans themselves changed: Business is still offered, at its price, with what it includes
    const business = offeredPlans().find((p) => p.id === 'plan_us_business')!
    expect([business.offered, business.monthlyPrice.USD, business.quoteLimit]).toEqual([true, 19900, 600])
    expect([business.features.lidar_scanning, business.features.multiple_users, business.features.priority_support]).toEqual([true, true, true])
    expect(offeredPlans().map((p) => [p.id, p.monthlyPrice.USD])).toEqual([['plan_us_starter', 4900], ['plan_us_pro', 9900], ['plan_us_business', 19900]])
    // the rule, not a list of names: a plan shows once it has one live line the plan below it lacks
    const [starter, pro] = offeredPlans()
    const nothingOfItsOwnLive = { ...business, id: 'x', channels: [...business.channels], features: { ...business.features } }
    expect(sitePlans([starter!, pro!, nothingOfItsOwnLive]).map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    const proWithoutItsOwn = { ...pro!, features: { ...pro!.features, custom_branding: false, calibration_insights: false } }
    expect(sitePlans([starter!, proWithoutItsOwn]).map((p) => p.id)).toEqual(['plan_us_starter'])
    // both public pages read it; the billing page and sign-up do not
    expect(page).toContain('const OFFERED = sitePlans()')
    expect(code('apps/web/src/app/page.tsx')).toContain('const plans = sitePlans()')
    expect(code('apps/web/src/app/page.tsx')).not.toContain('offeredPlans')
    expect(page).not.toContain('offeredPlans')
    expect(read('apps/web/src/app/api/billing/route.ts')).toContain('offeredPlans')
    expect(read('packages/shared/src/plans.ts')).not.toContain('sitePlans')
  })

  it('the two the ticket named: LiDAR is not live; accuracy insights is', () => {
    expect(PLAN_FEATURE_LINES.lidar_scanning!.live).toBe(false)
    expect(PLAN_FEATURE_LINES.calibration_insights!.live).toBe(true)
    // accuracy insights is live because the dashboard really has it
    expect(read('apps/web/src/app/(dashboard)/app/analytics/page.tsx')).toContain('<AccuracyPanel />')
    // nothing in the product checks the LiDAR, team or support flags: they gate nothing that exists
    for (const flag of ['lidar_scanning', 'multiple_users', 'priority_support']) expect(read('apps/web/src/lib/plan-features.ts')).not.toContain(flag)
  })

  it('every line says what was found, and no plan line is dropped', () => {
    for (const line of [...Object.values(PLAN_CHANNEL_LINES), ...Object.values(PLAN_FEATURE_LINES), PLAN_HOSTED_PAGES]) expect(line.found.length, line.label).toBeGreaterThan(30)
    // every channel and every feature a plan on offer includes has a line
    for (const plan of offeredPlans()) {
      for (const channel of plan.channels) expect(PLAN_CHANNEL_LINES[channel], channel).toBeTruthy()
      for (const key of ['custom_branding', 'calibration_insights', 'lidar_scanning', 'multiple_users', 'priority_support'] as const) if (plan.features[key]) expect(planLines(plan).some((l) => l.label === PLAN_FEATURE_LINES[key]!.label), `${plan.id} ${key}`).toBe(true)
    }
  })

  it('nothing else on the page promises what is not live: the taglines, the lead and the description', () => {
    for (const plan of offeredPlans()) expect(PRICING_TAGLINES[plan.id] ?? plan.tagline, plan.id).not.toMatch(NOT_LIVE)
    expect(PRICING_LEAD).not.toMatch(NOT_LIVE)
    expect(PRICING_DESCRIPTION).not.toMatch(NOT_LIVE)
    expect(page).not.toMatch(/Most popular|by text, and on site/)
    expect(page).toContain('tagline: PRICING_TAGLINES[def.id] ?? def.tagline,')
  })

  it('the list of what a plan line is today is written down beside the AI list', () => {
    const doc = read('Docs/design/ai-capabilities.md')
    expect(doc).toContain('## 7. Plan lines on Pricing')
    for (const line of [...Object.values(PLAN_CHANNEL_LINES), ...Object.values(PLAN_FEATURE_LINES)]) expect(doc, line.label).toContain(line.label)
  })
})
