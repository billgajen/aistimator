/**
 * T-164 (AD-046): the design foundations. Docs/design/system.md decides; this
 * file holds the code to it.
 *
 * 1. Contrast, worked out from the values in globals.css: muted text, every
 *    status pill, the amber pill, field edges, every accent candidate's
 *    on-colour and tint, and the focus ring. A value that drops below its
 *    ratio fails here.
 * 2. The motion tokens and the one reduced-motion rule.
 * 3. Source rules: no raw Tailwind palette colour in a component, one radius
 *    scale, no butter on "needs you", every colour token able to take an
 *    opacity modifier (T-172) with the rules that follow from that, and the
 *    /design page unlinked and not indexed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QuoteTurnTone } from '@qolumns/shared'
import config from '../../tailwind.config'
import { NEEDS_YOU_MARK, STATUS_TONE, STATUS_TONE_TOKENS } from '@/lib/status-tone'
import { brandStyleVars, rgbTriple } from '@/lib/color'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = join(ROOT, 'apps/web/src')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const CSS = read('apps/web/src/app/globals.css')

// ---------------------------------------------------------------- tokens

/** The custom properties of one block: `:root` or `[data-accent='x']` */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block in globals.css`)
  const body = CSS.slice(start, CSS.indexOf('\n  }', start))
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
}
const ROOT_TOKENS = block(':root')

const WHITE = '#FFFFFF'
const hex = (tokens: Record<string, string>, name: string): string => {
  const value = tokens[name]
  if (!value) throw new Error(`no token ${name}`)
  const inner = /^var\((--[a-z0-9-]+)\)$/.exec(value)
  if (inner) return hex(tokens, inner[1]!)
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`${name} is not a six-digit hex: ${value}`)
  return value
}
function luminance(colour: string): number {
  const channel = (i: number) => {
    const c = parseInt(colour.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
const ratio = (tokens: Record<string, string>, text: string, ground: string) =>
  contrast(hex(tokens, text), ground.startsWith('#') ? ground : hex(tokens, ground))

const TEXT = 4.5 // WCAG AA, normal text
const EDGE = 3 // WCAG AA, the boundary of a control and a focus indicator

describe('T-164: contrast, from the values in globals.css', () => {
  it('muted text reads at 4.5:1 on paper, grey cards and white (and on mint and mist)', () => {
    for (const ground of ['--color-background', '--color-surface', WHITE, '--color-mint', '--color-mist']) {
      expect(ratio(ROOT_TOKENS, '--color-text-muted', ground), ground).toBeGreaterThanOrEqual(TEXT)
    }
  })

  it('secondary text reads at 4.5:1 on every light ground', () => {
    for (const ground of ['--color-background', '--color-surface', WHITE, '--color-mint', '--color-mist']) {
      expect(ratio(ROOT_TOKENS, '--color-text-secondary', ground), ground).toBeGreaterThanOrEqual(TEXT)
    }
  })

  it('every status pill reads at 4.5:1', () => {
    for (const [tone, [text, ground]] of Object.entries(STATUS_TONE_TOKENS)) {
      expect(ratio(ROOT_TOKENS, text, ground), tone).toBeGreaterThanOrEqual(TEXT)
    }
  })

  it('the amber pill reads at 4.5:1 (it was 3.44:1), and green and red text read on paper too', () => {
    expect(ratio(ROOT_TOKENS, '--color-tertiary', '--color-tertiary-light')).toBeGreaterThanOrEqual(TEXT)
    expect(ratio(ROOT_TOKENS, '--color-tertiary', '--color-butter')).toBeGreaterThanOrEqual(TEXT)
    for (const text of ['--color-tertiary', '--color-secondary', '--color-danger']) {
      for (const ground of ['--color-background', '--color-surface', WHITE]) expect(ratio(ROOT_TOKENS, text, ground), `${text} on ${ground}`).toBeGreaterThanOrEqual(TEXT)
    }
  })

  it('the edge of a field or an outlined control reads at 3:1 on paper, grey cards and white', () => {
    for (const ground of ['--color-background', '--color-surface', WHITE]) {
      expect(ratio(ROOT_TOKENS, '--color-field', ground), ground).toBeGreaterThanOrEqual(EDGE)
    }
    // the decorative border is not a control edge, and must not be mistaken for one
    expect(ratio(ROOT_TOKENS, '--color-border', '--color-background')).toBeLessThan(EDGE)
  })

  it('the rule that lifts legacy field borders is in place and cannot outrank focus or error borders', () => {
    const rule = /:where\(input:not\(\[type='checkbox'\][^)]*\), select, textarea, button, \[role='button'\], a:where\(\.inline-flex\)\):where\(:not\(\[class\*='border-danger'\]\)\)\.border-border,/
    expect(CSS).toMatch(rule)
    expect(CSS).toMatch(/\.border-border-strong \{\s*border-color: var\(--color-field\);/)
    // one class of specificity: every other part of the selector is inside :where()
    const selector = rule.exec(CSS)![0]
    expect(selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')).toBe('.border-border,')
  })

  it('the accent is yellow (T-165, the owner’s choice), with dark text on it and no pale tint', () => {
    expect(hex(ROOT_TOKENS, '--color-accent').toUpperCase()).toBe('#FFC53D')
    expect(hex(ROOT_TOKENS, '--color-on-accent').toUpperCase()).toBe('#1B2823')
    expect(ratio(ROOT_TOKENS, '--color-on-accent', '--color-accent')).toBeGreaterThanOrEqual(TEXT)
    // the other candidates and the tint are gone: a pale yellow would read as butter
    expect(CSS).not.toMatch(/data-accent/)
    for (const gone of ['--color-accent-tint', '--color-accent-line', '--color-accent-ink']) expect(CSS).not.toContain(gone)
    expect(sources().filter(([, src]) => /accent-(tint|line|ink)\b|data-accent/.test(src)).map(([f]) => f)).toEqual([])
  })

  it('white never passes as button text on the accent, and the accent never passes as text on paper', () => {
    expect(contrast(WHITE, hex(ROOT_TOKENS, '--color-accent'))).toBeLessThan(TEXT)
    expect(ratio(ROOT_TOKENS, '--color-accent', '--color-background')).toBeLessThan(EDGE)
    expect(sources().filter(([, src]) => /(?<![\w-])text-accent(?![\w-])/.test(src)).map(([f]) => f)).toEqual([])
  })

  it('the yellow button has dark text and a thin dark edge, on marketing pages and in the Button component', () => {
    const cta = readFileSync(join(WEB, 'lib/marketing/cta.ts'), 'utf8')
    expect(cta).toMatch(/MAIN_CTA = `\$\{BASE\} border border-on-accent bg-accent text-on-accent`/)
    expect(readFileSync(join(WEB, 'components/ui/Button.tsx'), 'utf8')).toContain("'border border-on-accent bg-accent text-on-accent hover:opacity-90'")
    // the dashboard does not use the yellow button
    expect(sources().filter(([f, src]) => f.startsWith('app/(dashboard)') && /variant="accent"|MAIN_CTA/.test(src)).map(([f]) => f)).toEqual([])
  })

  it('the focus ring: ink on light grounds, light on juniper and ink, 3:1 or more', () => {
    expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--color-focus\);\s*outline-offset: 2px;/)
    expect(ROOT_TOKENS['--color-focus']).toBe('var(--color-ink)')
    for (const ground of ['--color-background', '--color-surface', WHITE, '--color-mint', '--color-mist', '--color-butter', '--color-accent', '--color-primary-light']) {
      expect(ratio(ROOT_TOKENS, '--color-focus', ground), ground).toBeGreaterThanOrEqual(EDGE)
    }
    // inside a juniper or brand-coloured surface the ring takes the colour that reads on it
    // T-171: Home's closing band is juniper by its own class since T-170, so it is in the list too
    expect(CSS).toMatch(/\.bg-primary \*,\s*\.bg-primary-hover \*,\s*(?:\/\*[\s\S]*?\*\/\s*)?\.closing-band \* \{\s*--color-focus: rgb\(var\(--color-on-primary-rgb, 255 255 255\)\);/)
    expect(contrast(WHITE, hex(ROOT_TOKENS, '--color-primary'))).toBeGreaterThanOrEqual(EDGE)
    expect(CSS).toMatch(/\.bg-ink \*,\s*\.bg-ink-deep \* \{\s*--color-focus: var\(--color-background\);/)
    expect(ratio(ROOT_TOKENS, '--color-background', '--color-ink')).toBeGreaterThanOrEqual(EDGE)
    // controls that draw their own focus with Tailwind's ring get the same colour, not Tailwind's translucent blue
    // only while focused: a ring used as decoration keeps its look
    expect(CSS).toMatch(/\n:focus \{\s*--tw-ring-color: var\(--color-focus\);\s*\}/)
    expect(CSS.indexOf('--tw-ring-color: var(--color-focus)')).toBeGreaterThan(CSS.indexOf('@tailwind utilities'))
    // the old ring (the brand colour on itself) is gone
    expect(CSS).not.toMatch(/outline: 2px solid var\(--color-primary\)/)
  })
})

describe('T-164: status colours by whose turn it is', () => {
  it('needs you is the strong yellow, waiting neutral, accepted green, closed grey, failed red', () => {
    expect(STATUS_TONE).toEqual({
      attention: 'bg-accent text-on-accent',
      waiting: 'bg-mist text-text-secondary',
      working: 'bg-mist text-text-secondary',
      good: 'bg-secondary-light text-secondary',
      closed: 'border border-border bg-surface text-text-muted',
      danger: 'bg-danger-light text-danger',
    } satisfies Record<QuoteTurnTone, string>)
  })

  it('"needs you" is the strong yellow with the small marker, never butter, tape, amber or a tint, wherever it is marked', () => {
    expect(NEEDS_YOU_MARK).toBe('bg-accent text-on-accent')
    for (const f of ['components/quotes/TurnBadge.tsx', 'components/home/QuoteStand.tsx', 'components/quotes/NeedsYouDot.tsx']) {
      expect(readFileSync(join(WEB, f), 'utf8'), f).not.toMatch(/bg-butter|bg-tape|tertiary/)
    }
    // the marker goes with the yellow: the pill, the "Started, didn't finish" tag, Home's tile and Home's banner
    expect(readFileSync(join(WEB, 'components/quotes/TurnBadge.tsx'), 'utf8')).toContain("turn.tone === 'attention' && <NeedsYouDot")
    expect(readFileSync(join(WEB, 'components/quotes/UnfinishedLeads.tsx'), 'utf8')).toMatch(/\$\{NEEDS_YOU_MARK\}`\}>\s*<NeedsYouDot/)
    expect(readFileSync(join(WEB, 'components/home/QuoteStand.tsx'), 'utf8')).toMatch(/tile\.needsYou && <NeedsYouDot/)
    const home = readFileSync(join(WEB, 'app/(dashboard)/app/page.tsx'), 'utf8')
    expect(home).toMatch(/\$\{NEEDS_YOU_MARK\}`\} data-testid="unfinished-count-figure">\s*<NeedsYouDot/)
    expect(home).not.toContain('bg-butter px-5')
    expect(readFileSync(join(WEB, 'app/(dashboard)/layout.tsx'), 'utf8')).toMatch(/px-2 py-0\.5 text-xs font-semibold \$\{NEEDS_YOU_MARK\}/)
  })

  it('the class of every tone matches the token pair the contrast test measures', () => {
    const tw = (name: string) => name.replace('--color-', '')
    for (const [tone, [text, ground]] of Object.entries(STATUS_TONE_TOKENS) as Array<[QuoteTurnTone, readonly [string, string]]>) {
      expect(STATUS_TONE[tone], tone).toContain(`text-${tw(text)}`)
      expect(STATUS_TONE[tone], tone).toContain(`bg-${tw(ground)}`)
    }
  })

  it('the customer quote page does not use our accent: the business keeps its own colour', () => {
    for (const f of ['app/q/[quoteId]/page.tsx', 'app/q/[quoteId]/clarify/page.tsx', 'components/embed/EstimateWidget.tsx', 'app/quote/[slug]/page.tsx']) {
      expect(readFileSync(join(WEB, f), 'utf8'), f).not.toMatch(/\b(bg|text|border|ring)-(accent|on-accent)\b/)
    }
  })
})

describe('T-164: motion', () => {
  const ms = (name: string) => Number(/^(\d+)ms$/.exec(ROOT_TOKENS[name] ?? '')?.[1])

  it('the tokens: hover in 150, out 120, press 90, menu 200, enter 200 to 300', () => {
    expect(ms('--motion-hover-in')).toBe(150)
    expect(ms('--motion-hover-out')).toBe(120)
    expect(ms('--motion-press')).toBe(90)
    expect(ms('--motion-menu')).toBe(200)
    expect(ms('--motion-enter')).toBeGreaterThanOrEqual(200)
    expect(ms('--motion-enter')).toBeLessThanOrEqual(300)
  })

  it('one curve for moves and one for entrances, neither passing its mark (no bounce)', () => {
    for (const name of ['--ease-move', '--ease-enter']) {
      const points = /^cubic-bezier\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)$/.exec(ROOT_TOKENS[name] ?? '')
      expect(points, name).not.toBeNull()
      // a control point above 1 or below 0 on the value axis overshoots
      for (const y of [Number(points![2]), Number(points![4])]) {
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
    }
    expect(ROOT_TOKENS['--ease-move']).not.toBe(ROOT_TOKENS['--ease-enter'])
  })

  it('our own motion moves transform and opacity only: no blur, no size, no position', () => {
    const ours = CSS.slice(CSS.indexOf('Motion (system.md, Motion). Feedback'), CSS.indexOf('/* Entrance: opacity'))
    // after the utilities, so they win over Tailwind's transition-colors on the same element
    expect(CSS.indexOf('.motion-press {')).toBeGreaterThan(CSS.indexOf('@tailwind utilities'))
    expect(CSS.slice(0, CSS.indexOf('.motion-press {')).lastIndexOf('@layer')).toBeLessThan(CSS.indexOf('/* Keyboard focus on a dark ground'))
    expect(ours).toContain('.motion-press')
    expect(ours).toContain('.motion-menu')
    const moved = [...ours.matchAll(/^\s+(transform|opacity|visibility|background-color|width|height|top|left|margin|padding|filter)\b[^,;]*var\(--(?:motion|ease)/gm)].map((m) => m[1])
    // visibility is a switch (0s), so a closed menu leaves the tab order; it is not animated
    expect(new Set(moved)).toEqual(new Set(['transform', 'opacity', 'background-color', 'visibility']))
    expect(ours).toMatch(/visibility 0s linear var\(--motion-hover-out\)/)
    expect(CSS).not.toMatch(/filter:\s*blur|backdrop-filter/)
    const keyframes = CSS.slice(CSS.indexOf('@keyframes fade-in-up'), CSS.indexOf('.animate-fade-in-up'))
    expect(keyframes).toMatch(/opacity: 0;\s*transform: translateY\(6px\);/)
    expect(CSS).toMatch(/\.animate-fade-in-up \{\s*animation: fade-in-up var\(--motion-enter\) var\(--ease-enter\);/)
  })

  it('reduced motion is one global rule that stills every transition and animation', () => {
    const rule = CSS.slice(CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(rule).toMatch(/\*,\s*\*::before,\s*\*::after \{/)
    for (const line of ['animation-duration: 0.01ms !important', 'animation-iteration-count: 1 !important', 'transition-duration: 0.01ms !important', 'animation-delay: 0s !important', 'transition-delay: 0s !important']) {
      expect(rule).toContain(line)
    }
    // one rule, not a list of our own classes
    expect(CSS.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1)
    expect(rule).not.toMatch(/\.tape-measuring|\.animate-fade-in-up/)
  })

  it('the dashboard has no entrance animation; the customer page waits with the tape, not a pulse', () => {
    expect(readFileSync(join(WEB, 'app/(dashboard)/layout.tsx'), 'utf8')).not.toContain('animate-fade-in-up')
    expect(readFileSync(join(WEB, 'app/admin/layout.tsx'), 'utf8')).not.toContain('animate-fade-in-up')
    const quotePage = readFileSync(join(WEB, 'app/q/[quoteId]/page.tsx'), 'utf8')
    expect(quotePage).toContain('<div className="tape-rule tape-measuring w-40 mx-auto" aria-hidden="true" />')
    expect(sources().filter(([, src]) => src.includes('animate-pulse')).map(([f]) => f)).toEqual([])
  })

  it('no motion library was added', () => {
    const deps = { ...JSON.parse(read('apps/web/package.json')).dependencies, ...JSON.parse(read('apps/web/package.json')).devDependencies }
    for (const name of ['framer-motion', 'motion', 'gsap', '@react-spring/web', 'lottie-react', 'animejs', 'aos']) expect(deps[name], name).toBeUndefined()
  })
})

// ---------------------------------------------------------------- source rules

/** Every source file of the web app that is not a test: [path from apps/web/src, contents] */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full)
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push([full.slice(WEB.length + 1), readFileSync(full, 'utf8')])
      }
    }
  }
  walk(WEB)
  return out
}

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOUR_UTILITY = 'bg|text|border|ring|ring-offset|divide|outline|from|via|to|fill|stroke|decoration|placeholder|caret|accent|shadow'
const RAW_COLOUR = new RegExp(`(?<![\\w-])(?:${COLOUR_UTILITY})-(?:${PALETTE})-(?:50|[1-9]00|950)(?![\\w-])`, 'g')

describe('T-164: colours come from our tokens', () => {
  it('no raw Tailwind palette colour in any component, page or helper', () => {
    const found = sources().flatMap(([file, src]) => [...src.matchAll(RAW_COLOUR)].map((m) => `${file}: ${m[0]}`))
    expect(found).toEqual([])
  })

  it('the check catches what it should', () => {
    for (const cls of ['text-red-500', 'bg-zinc-50', 'hover:border-blue-600', 'focus:ring-amber-300', 'from-emerald-100', 'bg-slate-950']) {
      expect(cls.match(RAW_COLOUR), cls).not.toBeNull()
    }
    for (const cls of ['bg-white', 'text-on-primary/60', 'border-field', 'bg-accent-tint', 'text-danger', 'bg-mint', 'text-text-muted']) {
      expect(cls.match(RAW_COLOUR), cls).toBeNull()
    }
  })

  it('the Tailwind config names every token the system uses', () => {
    const colors = config.theme!.extend!.colors as Record<string, unknown>
    // T-172: each is its RGB triple with a slot for the alpha a class may ask for
    expect(colors.accent).toBe('rgb(var(--color-accent-rgb) / <alpha-value>)')
    expect(colors['on-accent']).toBe('rgb(var(--color-on-accent-rgb) / <alpha-value>)')
    expect(colors.field).toBe('rgb(var(--color-field-rgb) / <alpha-value>)')
    // the focus colour changes with the ground it is on (globals.css), so it stays a plain variable
    expect(colors.focus).toBe('var(--color-focus)')
    // `field` is generated before `danger`, so an error border still wins when both are on one element
    const order = Object.keys(colors)
    expect(order.indexOf('field')).toBeLessThan(order.indexOf('danger'))
  })

  /**
   * T-172. An opacity modifier on one of our colour tokens (border-danger/30)
   * used to write NO CSS: the tokens were plain var() strings and Tailwind
   * cannot put an alpha on one. 228 such classes sat in the code doing
   * nothing. The tokens are now RGB triples with an alpha slot, defined once
   * (tailwind.config.ts and globals.css), so every such class writes CSS.
   */
  const TOKENS = 'background|surface|text-primary|text-secondary|text-muted|primary|primary-hover|primary-light|secondary|secondary-light|secondary-line|tertiary|tertiary-light|tertiary-line|border|border-strong|field|danger|danger-light|danger-line|ink|ink-deep|mist|mint|butter|tape|accent|on-accent|on-primary'
  const WITH_ALPHA = new RegExp(`(?<![\\w/-])((?:[a-z-]+:)*)(${COLOUR_UTILITY})-(${TOKENS})/[0-9]+`, 'g')
  const uses = () => sources().flatMap(([file, src]) => [...src.matchAll(WITH_ALPHA)].map((m) => ({ file, cls: m[0], variants: m[1]!, utility: m[2]!, token: m[3]! })))

  it('every colour token can take an opacity modifier: an RGB triple with an alpha slot', () => {
    const flat: Array<[string, unknown]> = Object.entries(config.theme!.extend!.colors as Record<string, unknown>).flatMap(([name, value]) =>
      typeof value === 'string' ? [[name, value] as [string, unknown]] : Object.entries(value as Record<string, unknown>).map(([step, v]) => [step === 'DEFAULT' ? name : `${name}-${step}`, v] as [string, unknown])
    )
    expect(flat.length).toBeGreaterThanOrEqual(29)
    for (const [name, value] of flat) {
      if (name === 'focus') continue
      if (name === 'on-primary') expect(value).toBe('rgb(var(--color-on-primary-rgb, 255 255 255) / <alpha-value>)')
      else expect(value, name).toBe(`rgb(var(--color-${name}-rgb) / <alpha-value>)`)
    }
  })

  it('each RGB triple in globals.css is the hex beside it', () => {
    const triples = Object.entries(ROOT_TOKENS).filter(([name]) => name.startsWith('--color-') && name.endsWith('-rgb'))
    expect(triples.length).toBe(28)
    for (const [name, triple] of triples) {
      expect(triple, name).toBe(rgbTriple(hex(ROOT_TOKENS, name.replace(/-rgb$/, ''))))
    }
    expect(rgbTriple('#205E56')).toBe('32 94 86')
    expect(rgbTriple('not a colour')).toBe('0 0 0')
  })

  it('a business’s own colour is set as a hex and as a triple, so the classes follow it', () => {
    const vars = brandStyleVars('#B4532A') as Record<string, string>
    expect(vars['--color-primary']).toBe('#B4532A')
    expect(vars['--color-primary-rgb']).toBe('180 83 42')
    expect(vars['--color-primary-hover-rgb']).toBe(rgbTriple(vars['--color-primary-hover']!))
    // nothing else of ours is overridden: no accent, no other token
    expect(Object.keys(vars).sort()).toEqual(['--color-on-primary', '--color-on-primary-rgb', '--color-primary', '--color-primary-hover', '--color-primary-hover-rgb', '--color-primary-rgb'])
    expect(brandStyleVars(null)).toEqual({})
  })

  it('no focus ring carries an opacity modifier: it would be a faint ring (1.4:1 to 1.6:1) in place of the ink one', () => {
    // T-172 removed 129 of them. `:focus { --tw-ring-color: var(--color-focus) }` gives a ring its colour;
    // a class such as focus:ring-primary/30 now writes CSS and would beat that rule.
    expect(uses().filter((u) => u.utility === 'ring' && /focus/.test(u.variants)).map((u) => `${u.file} ${u.cls}`)).toEqual([])
  })

  it('butter and tape take a modifier only in the measurement block and the range bar of the customer quote page', () => {
    const found = uses().filter((u) => u.token === 'butter' || u.token === 'tape')
    expect(found.map((u) => u.file).filter((f) => f !== 'app/q/[quoteId]/page.tsx')).toEqual([])
    expect(found.map((u) => u.cls).sort()).toEqual(['bg-butter/40', 'bg-butter/80', 'border-tape/40'])
  })

  it('the accent takes no modifier (there is no pale yellow), and no text is thinned with one', () => {
    expect(uses().filter((u) => u.token === 'accent' || u.token === 'on-accent').map((u) => `${u.file} ${u.cls}`)).toEqual([])
    // text at part strength: only the admin bar's light text on ink (9:1 at 80%)
    expect(uses().filter((u) => u.utility === 'text' && u.token !== 'on-primary').map((u) => `${u.file} ${u.cls}`).filter((x) => !x.startsWith('app/admin/layout.tsx text-surface/80'))).toEqual([])
  })

  it('the owner\'s three follow-ups: a juniper step ring, a readable admin label, no amber switched on in the service window', () => {
    const services = read('apps/web/src/app/(dashboard)/app/services/page.tsx')
    expect(services).toContain("'bg-primary text-white ring-2 ring-primary ring-offset-1'")
    // "Support Tools": secondary text on mist, 4.5:1 or more (it was amber on ink, 2.4:1)
    expect(read('apps/web/src/app/admin/layout.tsx')).toContain('rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-text-secondary')
    expect(ratio(ROOT_TOKENS, '--color-text-secondary', '--color-mist')).toBeGreaterThanOrEqual(4.5)
    // the AI boxes of the service window carry no amber at part strength (it reads as butter and tape)
    const panel = read('apps/web/src/components/services/AIDraftRefinementPanel.tsx')
    for (const src of [services, panel]) expect(src).not.toMatch(/(border|bg)-tertiary(-light)?\/[0-9]+/)
  })

  it('the edge of a control is never thinned: an error field and the sample-photo button keep the full colour', () => {
    expect(read('apps/web/src/components/embed/steps/QuestionsStep.tsx')).toContain("const inputErrorClass = 'border-danger bg-danger-light/30 focus:border-danger'")
    expect(read('apps/web/src/components/embed/steps/JobDetailsStep.tsx')).toContain("? 'border-danger' : ''")
    expect(read('apps/web/src/components/embed/EstimateWidget.tsx')).toMatch(/border-2 border-dashed border-primary bg-mint/)
  })
})


describe('T-164: one radius scale', () => {
  it('the scale replaces Tailwind’s own, so no other step exists', () => {
    expect(config.theme!.borderRadius).toEqual({ none: '0', xs: '2px', sm: '4px', md: '6px', lg: '8px', xl: '12px', '2xl': '16px', '3xl': '20px', full: '9999px' })
    expect((config.theme!.extend as Record<string, unknown>).borderRadius).toBeUndefined()
  })

  it('no class outside the scale: no rounded-warm-*, no bare `rounded`, and two known arbitrary values', () => {
    const SIDE = '(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?'
    const any = new RegExp(`(?<![\\w-])rounded${SIDE}(?:-[\\w.\\[\\]]+)?(?![\\w-])`, 'g')
    const onScale = new RegExp(`^rounded${SIDE}-(?:none|xs|sm|md|lg|xl|2xl|3xl|full)$`)
    const off: string[] = []
    for (const [file, src] of sources()) {
      for (const line of src.split('\n')) {
        // a class list, not a sentence about rounding
        if (!/className|class=|['"`][^'"`]*\b(?:bg-|px-|border|text-)/.test(line)) continue
        for (const m of line.matchAll(any)) if (!onScale.test(m[0])) off.push(`${file}: ${m[0]}`)
      }
    }
    // The product frames on the marketing pages keep their own corners until
    // the marketing ticket redraws them (changing them here would be visible).
    expect(off.sort()).toEqual(['components/marketing/ProductStrip.tsx: rounded-[1.2rem]', 'components/marketing/ProductStrip.tsx: rounded-[1.6rem]'])
  })
})

describe('T-164: the preview page and the design file', () => {
  it('/design is not indexed and nothing links to it', () => {
    const page = readFileSync(join(WEB, 'app/design/page.tsx'), 'utf8')
    expect(page).toMatch(/robots: \{ index: false, follow: false/)
    const linking = sources().filter(([file, src]) => file !== 'app/design/page.tsx' && /['"`]\/design(?:['"`/?#])/.test(src)).map(([file]) => file)
    expect(linking).toEqual([])
    expect(existsSync(join(WEB, 'app/sitemap.ts'))).toBe(false)
  })

  it('/design is built from the real components and tokens', () => {
    const preview = readFileSync(join(WEB, 'components/design/DesignPreview.tsx'), 'utf8')
    for (const from of ['@/components/ui/Button', '@/components/ui/Badge', '@/components/ui/Card', '@/components/ui/Input', '@/components/ui/Select', '@/components/quotes/TurnBadge', '@/components/brand/Wordmark']) {
      expect(preview).toContain(`from '${from}'`)
    }
    expect(readFileSync(join(WEB, 'app/design/page.tsx'), 'utf8')).toContain("from '@/components/marketing/ProductStrip'")
    // no colour written by hand: every colour is a token
    expect(preview).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    // T-165: the owner chose; there is no accent switch and one wordmark
    expect(preview).not.toMatch(/accent-switch|ACCENTS|form=/)
  })

  it('Docs/design/system.md exists, says it decides, and CLAUDE.md points to it', () => {
    const system = read('Docs/design/system.md')
    expect(system).toMatch(/This file decides\. The skills advise\./)
    for (const heading of ['## Colour', '## Type', '## Shape', '## Imagery', '## Layout', '## Motion', '## Status colours', '## Which skill leads where', '## Where the skills disagree: our rulings']) {
      expect(system, heading).toContain(heading)
    }
    expect(read('CLAUDE.md')).toMatch(/Read `Docs\/design\/system\.md` before any UI work/)
  })
})
