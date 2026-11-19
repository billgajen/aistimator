'use client'

import { useEffect, useRef, useState } from 'react'
import { QUOTE_TURN_COPY, formatMoney, freeOfferLabel, type QuoteTurnTone } from '@qolumns/shared'
import { Wordmark } from '@/components/brand/Wordmark'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TurnBadge } from '@/components/quotes/TurnBadge'

/**
 * T-164: the design system as it renders (Docs/design/system.md decides).
 * Everything here is a real token or a real component; nothing is styled
 * for this page alone. T-165: the owner chose yellow and the text wordmark,
 * so the accent switch and the second wordmark are gone.
 */

const PALETTE: Array<{ group: string; note: string; tokens: Array<[name: string, cssVar: string]> }> = [
  { group: 'Paper', note: 'The ground of every page.', tokens: [['background', '--color-background'], ['surface', '--color-surface'], ['mist', '--color-mist'], ['mint', '--color-mint']] },
  { group: 'Juniper', note: 'The main colour: the brand, links, the standard button.', tokens: [['primary', '--color-primary'], ['primary-hover', '--color-primary-hover'], ['primary-light', '--color-primary-light']] },
  { group: 'Accent', note: 'Yellow, about a tenth of a screen: the main button of a marketing screen, one highlighted word, "needs you". Always with dark text on it; there is no pale tint.', tokens: [['accent', '--color-accent'], ['on-accent', '--color-on-accent']] },
  { group: 'Ink', note: 'Text. Never pure black.', tokens: [['ink', '--color-ink'], ['text-secondary', '--color-text-secondary'], ['text-muted', '--color-text-muted']] },
  { group: 'Lines', note: 'border is decoration; field is the edge of a field or an outlined control.', tokens: [['border', '--color-border'], ['border-strong', '--color-border-strong'], ['field', '--color-field']] },
  { group: 'Meaning', note: 'Green for done, amber for a warning, red for a failure. Each with its tint and its line.', tokens: [['secondary', '--color-secondary'], ['secondary-light', '--color-secondary-light'], ['tertiary', '--color-tertiary'], ['tertiary-light', '--color-tertiary-light'], ['danger', '--color-danger'], ['danger-light', '--color-danger-light']] },
  { group: 'Measurement only', note: 'Butter and tape: the takeoff, grades and ranges. Nowhere else.', tokens: [['butter', '--color-butter'], ['tape', '--color-tape']] },
]

const STATUSES: Array<{ tone: QuoteTurnTone; group: string; label: string; detail: string }> = [
  { tone: 'attention', group: 'Needs you', label: QUOTE_TURN_COPY.labels.needsApproval, detail: 'Received today' },
  { tone: 'waiting', group: 'Waiting', label: QUOTE_TURN_COPY.labels.waiting, detail: 'Sent yesterday, not opened yet' },
  { tone: 'good', group: 'Accepted', label: QUOTE_TURN_COPY.labels.accepted, detail: 'Accepted on 12 Nov' },
  { tone: 'closed', group: 'Closed', label: QUOTE_TURN_COPY.labels.declined, detail: 'Declined on 12 Nov' },
  { tone: 'danger', group: 'Failed', label: QUOTE_TURN_COPY.labels.failed, detail: 'Received 2 days ago' },
]

const TYPE_SCALE: Array<[cls: string, name: string, use: string]> = [
  ['text-display-xl', 'display-xl', 'Marketing hero, wide screens'],
  ['text-display-lg', 'display-lg', 'Marketing hero'],
  ['text-display-md', 'display-md', 'Marketing section headline'],
  ['text-display-sm', 'display-sm', 'Marketing headline on a phone'],
  ['text-4xl', '4xl', 'Page title'],
  ['text-2xl', '2xl', 'Section title'],
  ['text-lg', 'lg', 'Card title'],
]

const RADII: Array<[cls: string, name: string, use: string]> = [
  ['rounded-sm', 'sm · 4', 'tags'],
  ['rounded-md', 'md · 6', 'small controls'],
  ['rounded-lg', 'lg · 8', 'buttons, fields'],
  ['rounded-xl', 'xl · 12', 'cards'],
  ['rounded-2xl', '2xl · 16', 'panels'],
  ['rounded-3xl', '3xl · 20', 'documents'],
  ['rounded-full', 'full', 'pills'],
]

const SHADOWS: Array<[cls: string, name: string, use: string]> = [
  ['shadow-warm', 'warm', 'a hairline'],
  ['shadow-warm-md', 'warm-md', 'a card'],
  ['shadow-warm-lg', 'warm-lg', 'a raised card'],
  ['shadow-warm-hover', 'warm-hover', 'a card under the pointer'],
  ['shadow-document', 'document', 'the estimate sheet'],
]

const MOTION: Array<[name: string, cssVar: string, use: string]> = [
  ['hover in', '--motion-hover-in', 'the pointer arrives'],
  ['hover out', '--motion-hover-out', 'the pointer leaves'],
  ['press', '--motion-press', 'a click or a tap'],
  ['menu', '--motion-menu', 'a menu opens'],
  ['enter', '--motion-enter', 'something arrives'],
  ['ease-move', '--ease-move', 'moves and changes'],
  ['ease-enter', '--ease-enter', 'entrances'],
]

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} data-testid={`section-${id}`} className="border-t border-border py-10 sm:py-14">
      <h2 className="font-display text-2xl font-bold text-text-primary">{title}</h2>
      {lead && <p className="mt-1 max-w-2xl text-sm text-text-secondary">{lead}</p>}
      <div className="mt-6">{children}</div>
    </section>
  )
}

export function DesignPreview({ productScreen }: { productScreen: React.ReactNode }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [entered, setEntered] = useState(0)
  const root = useRef<HTMLElement>(null)

  // The values shown are read from the page, so they are what the tokens are
  useEffect(() => {
    if (!root.current) return
    const style = getComputedStyle(root.current)
    const read: Record<string, string> = {}
    for (const { tokens } of PALETTE) for (const [, cssVar] of tokens) read[cssVar] = style.getPropertyValue(cssVar).trim()
    for (const [, cssVar] of MOTION) read[cssVar] = style.getPropertyValue(cssVar).trim()
    setValues(read)
  }, [])

  return (
    <main ref={root} data-testid="design-preview" className="min-h-screen bg-background text-text-primary">
      <div className="mx-auto max-w-container px-4 pb-20 sm:px-6">
        <header className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Design system preview</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-text-primary">Tokens and components, as they render</h1>
          <p className="mt-3 max-w-2xl text-text-secondary">
            Everything on this page is a real token or a real component. The accent is yellow and the wordmark is the owner’s drawing.
          </p>
        </header>

        <Section id="wordmark" title="Wordmark" lead="The owner’s drawing, inline: dark on light grounds, white on dark ones. The header, the footer, the sign-in pages and the dashboard all draw it with this one component.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="bg-white p-8">
              <Wordmark height={72} className="h-auto max-w-full" />
              <p className="mt-4 text-sm text-text-secondary">On paper</p>
            </Card>
            <div className="flex flex-col justify-between rounded-xl bg-primary p-8">
              <Wordmark height={72} tone="light" className="h-auto max-w-full" />
              <p className="mt-4 text-sm text-on-primary/80">On juniper</p>
            </div>
          </div>
        </Section>

        <Section id="palette" title="Colour" lead="Paper, juniper and the yellow accent. Butter and tape are for measurement only.">
          <div className="space-y-8">
            {PALETTE.map(({ group, note, tokens }) => (
              <div key={group}>
                <h3 className="text-sm font-semibold text-text-primary">{group}</h3>
                <p className="text-sm text-text-secondary">{note}</p>
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {tokens.map(([name, cssVar]) => (
                    <li key={name} data-testid={`swatch-${name}`}>
                      <div className="h-16 rounded-xl border border-border" style={{ backgroundColor: `var(${cssVar})` }} />
                      <p className="mt-1.5 text-sm font-medium text-text-primary">{name}</p>
                      <p className="figure text-xs text-text-muted">{values[cssVar] || ' '}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <Section id="type" title="Type" lead="Bricolage Grotesque for display, Instrument Sans for text, Spline Sans Mono for every figure.">
          <div className="space-y-5">
            {TYPE_SCALE.map(([cls, name, use]) => (
              <div key={name} className="min-w-0">
                <p className={`truncate font-display font-extrabold text-text-primary ${cls}`}>Your prices, instantly</p>
                <p className="mt-1 text-xs text-text-muted">
                  <span className="figure">{name}</span> · {use}
                </p>
              </div>
            ))}
            <div className="grid gap-6 border-t border-border pt-6 sm:grid-cols-2">
              <div>
                <p className="text-base text-text-primary">Body, 16 px. Customers answer a few questions and send photos. They see an estimate from your prices straight away.</p>
                <p className="mt-2 text-sm text-text-secondary">Secondary, 14 px. You get the lead, and you confirm it.</p>
                <p className="mt-2 text-xs text-text-muted">Muted, 12 px. Received today.</p>
              </div>
              <div>
                <p className="figure text-4xl font-medium text-text-primary">{formatMoney(1400, 'USD', 'en-US')}</p>
                <p className="mt-1 text-xs text-text-muted">Figures are always mono, with tabular numbers.</p>
              </div>
            </div>
          </div>
        </Section>

        <Section id="shape" title="Shape" lead="One radius scale, one shadow scale, one container width (72 rem).">
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            {RADII.map(([cls, name, use]) => (
              <li key={name}>
                <div className={`h-16 border border-field bg-white ${cls}`} />
                <p className="figure mt-1.5 text-xs text-text-primary">{name}</p>
                <p className="text-xs text-text-muted">{use}</p>
              </li>
            ))}
          </ul>
          <ul className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-5">
            {SHADOWS.map(([cls, name, use]) => (
              <li key={name}>
                <div className={`h-16 rounded-xl bg-white ${cls}`} />
                <p className="figure mt-2 text-xs text-text-primary">{name}</p>
                <p className="text-xs text-text-muted">{use}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="components" title="Components" lead="Buttons, the five status colours, a field and a card.">
          <div className="space-y-8">
            <div className="flex flex-wrap items-center gap-3" data-testid="buttons">
              <Button variant="accent" data-testid="button-accent">Try it free</Button>
              <Button variant="primary" data-testid="button-primary">Approve &amp; send</Button>
              <Button variant="outline" data-testid="button-outline">Open</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Delete</Button>
              <Button variant="primary" disabled>Disabled</Button>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="status-pills">
              {STATUSES.map((s) => (
                <li key={s.tone} data-testid={`status-${s.tone}`}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">{s.group}</p>
                  <TurnBadge turn={{ label: s.label, detail: s.detail, tone: s.tone }} />
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">Neutral</Badge>
              <Badge variant="success">Active</Badge>
              <Badge variant="ai">AI draft</Badge>
              <Badge variant="danger">Failed</Badge>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <Card className="bg-white p-6" data-testid="sample-card">
                <h3 className="font-display text-lg font-bold text-text-primary">A card</h3>
                <p className="mt-1 text-sm text-text-secondary">White on paper, a 12 px corner and the decorative border.</p>
                <div className="mt-4 space-y-4">
                  <Input label="Your name" placeholder="Marlo Finch" helpText="A field's edge reads at 3:1 on paper." data-testid="sample-input" />
                  <Select label="Door size" defaultValue="single" data-testid="sample-select">
                    <option value="single">Single (8 or 9 ft wide, 7 ft tall)</option>
                    <option value="double">Double (16 ft wide, 7 ft tall)</option>
                  </Select>
                  <Input label="Email" defaultValue="marlo.finch" error="Enter a full email address." />
                </div>
              </Card>
              <div className="rounded-xl bg-primary p-6" data-testid="on-juniper">
                <h3 className="font-display text-lg font-bold text-white">On juniper</h3>
                <p className="mt-1 text-sm text-on-primary/80">Press Tab: the focus ring turns light here, and stays ink on paper.</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a href="#components" className="inline-flex min-h-[44px] items-center rounded-lg bg-white px-5 text-sm font-semibold text-primary" data-testid="link-on-juniper">
                    A button on juniper
                  </a>
                  <a href="#components" className="inline-flex min-h-[44px] items-center rounded-lg border border-on-primary/40 px-5 text-sm font-semibold text-white">
                    Another
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="marketing-band" title="A marketing band" lead="A headline with one highlighted word, the one yellow button (dark text, a thin dark edge), and a real product screen.">
          <div className="rounded-2xl bg-white p-6 shadow-warm-md sm:p-10" data-testid="marketing-band">
            <h3 className="max-w-3xl font-display text-display-sm font-extrabold text-text-primary sm:text-display-md lg:text-display-lg">
              Instant quotes, in{' '}
              <mark className="rounded-md bg-accent px-2 text-on-accent" data-testid="highlight">your</mark>{' '}
              prices.
            </h3>
            <p className="mt-4 max-w-xl text-lg text-text-secondary">Customers answer a few questions and send photos. You get the lead, and you confirm it.</p>
            <div className="mt-6">
              <Button variant="accent" size="lg" className="motion-press">{freeOfferLabel()}</Button>
            </div>
            <div className="mt-10">{productScreen}</div>
          </div>
        </Section>

        <Section id="dashboard-row" title="A dashboard row" lead="Whose turn it is, the price as a figure, and one worded next step.">
          <div className="rounded-xl border border-border bg-white" data-testid="dashboard-row">
            <div className="flex flex-col gap-3 p-5 xl:grid xl:grid-cols-[1.4fr_1fr_auto_1.2fr_auto] xl:items-center xl:gap-6">
              <div className="min-w-0">
                <p className="font-medium text-text-primary">Marlo Finch</p>
                <p className="truncate text-sm text-text-secondary">marlo.finch@example.com</p>
              </div>
              <p className="text-sm text-text-primary">Garage Door Replacement</p>
              <p className="figure text-sm font-medium text-text-primary">{formatMoney(1400, 'USD', 'en-US')}</p>
              <TurnBadge turn={{ label: QUOTE_TURN_COPY.labels.needsApproval, detail: 'Received today', tone: 'attention' }} />
              <div className="flex gap-2">
                <Button size="sm" className="motion-press">{QUOTE_TURN_COPY.listButtons.approve}</Button>
                <Button size="sm" variant="outline">More</Button>
              </div>
            </div>
          </div>
        </Section>

        <Section id="motion" title="Motion" lead="Transform and opacity only. Feedback under 200 ms on the dashboard; one entrance and at most one moment on a marketing page. Everything rests under reduced motion.">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-7" data-testid="motion-tokens">
            {MOTION.map(([name, cssVar, use]) => (
              <div key={name}>
                <dt className="text-sm font-medium text-text-primary">{name}</dt>
                <dd className="figure text-xs text-text-secondary">{values[cssVar] || ' '}</dd>
                <dd className="text-xs text-text-muted">{use}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <Card className="bg-white p-6">
              <h3 className="text-sm font-semibold text-text-primary">A button</h3>
              <p className="mt-1 text-sm text-text-secondary">In 150 ms, out 120 ms, press 90 ms.</p>
              <Button className="motion-press mt-4" data-testid="motion-button">Hover and press</Button>
            </Card>

            <Card className="bg-white p-6">
              <h3 className="text-sm font-semibold text-text-primary">A menu</h3>
              <p className="mt-1 text-sm text-text-secondary">Opens in 200 ms from 6 px above; closes faster.</p>
              <div className="relative mt-4 inline-block">
                <Button variant="outline" aria-expanded={menuOpen} aria-controls="design-menu" onClick={() => setMenuOpen((open) => !open)} data-testid="motion-menu-button">
                  {menuOpen ? 'Close menu' : 'Open menu'}
                </Button>
                <div
                  id="design-menu"
                  data-open={menuOpen}
                  data-testid="motion-menu"
                  className="motion-menu absolute left-0 top-full z-10 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-white shadow-warm-lg"
                >
                  {['Open quote', 'Send again', 'Copy link'].map((item) => (
                    <button key={item} type="button" className="block w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-surface" onClick={() => setMenuOpen(false)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            <Card className="bg-white p-6">
              <h3 className="text-sm font-semibold text-text-primary">An entering card</h3>
              <p className="mt-1 text-sm text-text-secondary">Opacity and a 6 px rise, 250 ms, once. Marketing and customer pages only.</p>
              <Button variant="outline" className="mt-4" onClick={() => setEntered((n) => n + 1)} data-testid="motion-enter-button">
                Play it again
              </Button>
              <div key={entered} className="animate-fade-in-up mt-4 rounded-xl bg-mint p-4 text-sm text-text-primary" data-testid="motion-enter-card">
                A new request from Marlo Finch
              </div>
            </Card>
          </div>
        </Section>
      </div>
    </main>
  )
}
