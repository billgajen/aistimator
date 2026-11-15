'use client'

import { useState, type CSSProperties } from 'react'
import { QUOTE_TURN_COPY, formatMoney } from '@qolumns/shared'
import { EstimateSheet, type EstimateSheetData } from '@/components/quote/EstimateSheet'
import { TurnBadge } from '@/components/quotes/TurnBadge'
import { Button } from '@/components/ui/Button'
import { RequestFormScreen } from './RequestFormScreen'

/**
 * T-165: the hero's product demo (system.md, Motion: "the hero demo").
 *
 * Three screens at true size, built from the product's own parts: the request
 * form in the business's colour, the estimate document (EstimateSheet, the
 * quote page's own parts) and the owner's "Waiting for you" row (TurnBadge,
 * Button). It plays once on load: the customer answers and adds a photo, the
 * tape rule is drawn out and the price lands, then Approve & send is pressed
 * and turns to Sent. Then it stands still on that last state.
 *
 * The motion is CSS only (globals.css, demo-*): each element waits for its
 * turn in `--at`. "Play again" mounts the screens afresh, which starts the
 * CSS again. Under reduced motion the global rule ends every animation at
 * once, so the three finished screens show with no movement.
 */

/** When each thing happens, in ms from the start. The whole run is about 5.5 s. */
export const DEMO_TIMELINE = {
  answer: 500,
  photo: 1200,
  ask: 1900,
  tape: 2300,
  lines: 2600,
  total: 3100,
  lead: 3700,
  approve: 4700,
  sent: 4900,
  confirmed: 5100,
} as const
/** The last thing to finish: the confirmed line, plus its entrance */
export const DEMO_LENGTH_MS = DEMO_TIMELINE.confirmed + 300

const at = (ms: number): CSSProperties => ({ '--at': `${ms}ms` } as CSSProperties)

export interface HeroDemoContent {
  serviceName: string
  question: string
  answer: string
  photo: { src: string; alt: string; label: string }
  customerName: string
  sheet: EstimateSheetData
  frames: readonly [string, string, string]
  playAgain: string
  sent: string
  /** what a screen reader hears for each of the three screens */
  screens: readonly [string, string, string]
}

export function HeroDemo({ content }: { content: HeroDemoContent }) {
  const [run, setRun] = useState(0)
  const T = DEMO_TIMELINE
  const { sheet } = content
  const total = formatMoney(sheet.total, sheet.currency, sheet.locale)

  return (
    <div data-testid="hero-demo-stage" data-run={run}>
      {/* Each screen is a picture of the product (role="img"): a screen reader hears its description, not the parts */}
      <ol key={run} className="grid gap-8 lg:grid-cols-3 lg:gap-6" data-testid="hero-demo-frames">
        <Frame step={1} title={content.frames[0]} label={content.screens[0]}>
          <RequestFormScreen
            businessName={sheet.businessName}
            logoUrl={sheet.logoUrl}
            primaryColor={sheet.primaryColor}
            serviceName={content.serviceName}
            question={content.question}
            answer={content.answer}
            photo={content.photo}
            answerClassName="demo-in"
            answerStyle={at(T.answer)}
            photoClassName="demo-pop"
            photoStyle={at(T.photo)}
            buttonClassName="demo-press"
            buttonStyle={at(T.ask)}
          />
        </Frame>

        <Frame step={2} title={content.frames[1]} label={content.screens[1]}>
          <EstimateSheet
            data={sheet}
            totalClassName="demo-in"
            totalStyle={at(T.total)}
            lineClassName={() => 'demo-in'}
            lineStyle={(i) => at(T.lines + i * 150)}
            tapeCover={<span className="demo-tape-cover" style={at(T.tape)} data-testid="demo-tape-cover" />}
            label={
              // T-158's wording: an estimate until the business confirms it, then "Your quote"
              <span className="grid">
                <span className="demo-out col-start-1 row-start-1" style={at(T.confirmed)}>Your estimate</span>
                <span className="demo-in col-start-1 row-start-1" style={at(T.confirmed)}>Your quote</span>
              </span>
            }
            note={
              <span className="mt-4 grid max-w-sm text-[13px] leading-snug text-on-primary/75">
                <span className="demo-out col-start-1 row-start-1" style={at(T.confirmed)}>
                  This is an estimate based on your photos and details. {sheet.businessName} will review and confirm it.
                </span>
                <span className="demo-in col-start-1 row-start-1" style={at(T.confirmed)} data-testid="demo-confirmed">
                  Reviewed and confirmed by {sheet.businessName}.
                </span>
              </span>
            }
          />
        </Frame>

        <Frame step={3} title={content.frames[2]} label={content.screens[2]}>
          <div className="rounded-3xl bg-white p-6 text-left shadow-warm-lg" data-testid="demo-owner">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-lg font-bold text-text-primary">{QUOTE_TURN_COPY.home.title}</p>
            </div>
            <div className="demo-in mt-4 rounded-2xl border border-border p-4" style={at(T.lead)} data-testid="demo-lead">
              <p className="font-medium text-text-primary">{content.customerName}</p>
              <p className="text-sm text-text-secondary">{content.serviceName} · just now</p>
              <div className="mt-3 grid">
                <span className="demo-out col-start-1 row-start-1" style={at(T.sent)}>
                  <TurnBadge turn={{ label: QUOTE_TURN_COPY.labels.needsApproval, detail: '', tone: 'attention' }} showDetail={false} />
                </span>
                <span className="demo-in col-start-1 row-start-1" style={at(T.sent)}>
                  <TurnBadge turn={{ label: QUOTE_TURN_COPY.labels.waiting, detail: '', tone: 'waiting' }} showDetail={false} />
                </span>
              </div>
              <p className="figure mt-3 text-2xl font-medium text-text-primary">{total}</p>
              <div className="mt-4 grid">
                <span className="demo-out col-start-1 row-start-1" style={at(T.sent)}>
                  <Button tabIndex={-1} className="demo-press w-full" style={at(T.approve)}>
                    Approve &amp; send
                  </Button>
                </span>
                <span className="demo-in col-start-1 row-start-1 inline-flex min-h-[40px] items-center justify-center rounded-lg bg-secondary-light text-sm font-semibold text-secondary" style={at(T.sent)} data-testid="demo-sent">
                  <span aria-hidden="true" className="mr-1.5">✓</span>
                  {content.sent}
                </span>
              </div>
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
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <span className="figure inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-white">{step}</span>
        {title}
      </p>
      {/* a picture: nothing in it can be focused or pressed */}
      <div role="img" aria-label={label} {...({ inert: '' } as object)}>
        {children}
      </div>
    </li>
  )
}
