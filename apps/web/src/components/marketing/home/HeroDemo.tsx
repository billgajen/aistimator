'use client'

import { useState, type CSSProperties } from 'react'
import { QUOTE_TURN_COPY, formatMoney } from '@qolumns/shared'
import { brandStyleVars } from '@/lib/color'
import { TurnBadge } from '@/components/quotes/TurnBadge'
import { Button } from '@/components/ui/Button'

/**
 * The hero's product demo (system.md, Motion: "the hero demo").
 *
 * T-168: three frames of the same height, side by side, one idea each (the
 * clean look the home page had before T-165, at the design system's type
 * sizes and with its motion):
 *   1 "Your customer asks"   one question with its answer, and "Get my estimate"
 *   2 "They see your price"  a short estimate: a line or two, the total, the locked Accept
 *   3 "You confirm it"       "Waiting for you": one lead, its price, "Approve & send"
 * (T-165 had three full-size screens of different heights, and T-167 added a
 * label-reading step to the first. The AI's reading is shown in "What it
 * notices" instead.)
 *
 * It plays once on load: the answer arrives and the button is pressed; the
 * tape rule is drawn out and the price lands; the lead arrives for the
 * business. Then it stands still on that last state, which is the three
 * frames as described above. "Play again" mounts the frames afresh, which
 * starts the CSS again. Under reduced motion the global rule ends every
 * animation at once, so the finished frames show with no movement.
 *
 * The frames are the same height at every width: side by side from `md` up,
 * one under another on a phone (never a sideways strip).
 */

/** When each thing happens, in ms from the start. The whole run is about 3.4 s (system.md: under six). */
export const DEMO_TIMELINE = {
  answer: 400,
  ask: 1100,
  tape: 1500,
  lines: 1700,
  total: 2200,
  lead: 2900,
} as const
/** The last thing to finish: the lead, plus its entrance */
export const DEMO_LENGTH_MS = DEMO_TIMELINE.lead + 300

const at = (ms: number): CSSProperties => ({ '--at': `${ms}ms` } as CSSProperties)

export interface HeroDemoContent {
  businessName: string
  logoUrl: string
  /** The example business's colour: a customer's screen is in the business's colour, never ours */
  primaryColor: string
  serviceName: string
  question: string
  answer: string
  customerName: string
  /** One or two lines: the hero shows a short estimate, not a long breakdown */
  lines: Array<{ label: string; amount: number }>
  total: number
  currency: string
  locale: string
  frames: readonly [string, string, string]
  playAgain: string
  /** Under the estimate: why Accept is locked */
  acceptNote: string
  /** what a screen reader hears for each of the three frames */
  screens: readonly [string, string, string]
}

export function HeroDemo({ content }: { content: HeroDemoContent }) {
  const [run, setRun] = useState(0)
  const T = DEMO_TIMELINE
  const money = (n: number) => formatMoney(n, content.currency, content.locale)
  const brand = brandStyleVars(content.primaryColor)

  return (
    <div data-testid="hero-demo-stage" data-run={run}>
      {/* Each frame is a picture of the product (role="img"): a screen reader hears its description, not the parts.
          auto-rows-fr keeps the three the same height when they stack, as the grid row does when they sit side by side. */}
      <ol key={run} className="demo-frames grid auto-rows-fr gap-6 md:grid-cols-3 md:gap-5" data-testid="hero-demo-frames">
        <Frame step={1} title={content.frames[0]} label={content.screens[0]}>
          <div className="flex flex-1 flex-col" style={brand}>
            <BusinessHeader name={content.businessName} logoUrl={content.logoUrl} />
            <div className="mt-4 rounded-xl border border-border bg-white p-4">
              <p className="text-xs font-semibold text-text-secondary">{content.serviceName}</p>
              <p className="mt-2 text-sm font-semibold text-text-primary">{content.question}</p>
              <div className="mt-2 flex min-h-[44px] items-center rounded-lg border border-field bg-background px-3 text-sm text-text-primary">
                <span className="demo-in" style={at(T.answer)} data-testid="demo-answer">{content.answer}</span>
              </div>
            </div>
            <div className="mt-auto pt-4">
              <div className="demo-press rounded-lg bg-primary py-3 text-center text-sm font-semibold text-on-primary" style={at(T.ask)}>
                Get my estimate
              </div>
            </div>
          </div>
        </Frame>

        <Frame step={2} title={content.frames[1]} label={content.screens[1]}>
          <div className="flex flex-1 flex-col" style={brand}>
            <BusinessHeader name={content.businessName} logoUrl={content.logoUrl} />
            <div className="mt-4 rounded-xl border border-border bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">Your estimate</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {content.lines.map((line, i) => (
                  <li key={line.label} className="demo-in flex justify-between gap-3" style={at(T.lines + i * 150)}>
                    <span className="min-w-0 text-text-secondary">{line.label}</span>
                    <span className="figure shrink-0 text-text-primary">{money(line.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="relative mt-3 overflow-hidden">
                <div className="tape-rule" aria-hidden="true" />
                <span className="demo-tape-cover" style={{ ...at(T.tape), background: '#fff' }} data-testid="demo-tape-cover" />
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-text-primary">Estimate</span>
                <span className="demo-in figure text-2xl font-medium text-text-primary" style={at(T.total)} data-testid="estimate-total">{money(content.total)}</span>
              </div>
            </div>
            <p className="mt-3 text-xs leading-snug text-text-muted">{content.acceptNote}</p>
            <div className="mt-auto pt-4">
              <div className="rounded-lg border border-border bg-surface py-3 text-center text-sm font-semibold text-text-muted" data-testid="demo-accept">Accept</div>
            </div>
          </div>
        </Frame>

        <Frame step={3} title={content.frames[2]} label={content.screens[2]}>
          <div className="flex flex-1 flex-col" data-testid="demo-owner">
            <p className="font-display text-base font-bold text-text-primary">{QUOTE_TURN_COPY.home.title}</p>
            <div className="demo-in mt-4 rounded-xl border border-border bg-white p-4" style={at(T.lead)} data-testid="demo-lead">
              <p className="truncate text-sm font-semibold text-text-primary">{content.customerName}</p>
              <p className="truncate text-xs text-text-secondary">{content.serviceName} · just now</p>
              <div className="mt-2">
                <TurnBadge turn={{ label: QUOTE_TURN_COPY.labels.needsApproval, detail: '', tone: 'attention' }} showDetail={false} />
              </div>
              <p className="figure mt-2 text-2xl font-medium text-text-primary">{money(content.total)}</p>
            </div>
            <div className="mt-auto pt-4">
              <Button tabIndex={-1} className="w-full" data-testid="demo-approve">
                Approve &amp; send
              </Button>
            </div>
          </div>
        </Frame>
      </ol>

      <p className="mt-5">
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          className="motion-press inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm font-semibold text-text-secondary hover:text-text-primary"
          data-testid="demo-replay"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M5.6 15a7 7 0 0011.9 2.5L20 14M4 10l2.5-3.5A7 7 0 0118.4 9" />
          </svg>
          {content.playAgain}
        </button>
      </p>
    </div>
  )
}

function Frame({ step, title, label, children }: { step: number; title: string; label: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col" data-testid="demo-frame">
      <p className="demo-caption mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <span className="figure inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-white">{step}</span>
        {title}
      </p>
      <div role="img" aria-label={label} {...({ inert: '' } as object)} className="flex flex-1 flex-col rounded-3xl border border-border bg-white p-2 text-left shadow-warm-lg" data-testid="demo-card">
        <div className="flex flex-1 flex-col rounded-2xl bg-background p-4">{children}</div>
      </div>
    </li>
  )
}

function BusinessHeader({ name, logoUrl }: { name: string; logoUrl: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">Instant estimate</p>
        <p className="truncate font-display text-base font-bold text-text-primary">{name}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small SVG shipped in public/ */}
      <img src={logoUrl} alt="" className="h-8 w-auto shrink-0" />
    </div>
  )
}
