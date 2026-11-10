import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, formatMoney } from '@estimator/shared'
import type { MarketingExample } from '@/lib/marketing/examples'

const money = (n: number) => formatMoney(n, 'USD', 'en-US')

/**
 * T-154: the product in use, in three frames drawn from our own screens (no
 * stock photos): the customer asks on the quote page, sees the estimate with
 * the business's logo, and the owner confirms it from "Waiting for you".
 * Branded as the demo business. On a phone the frames swipe sideways inside
 * their own row, so the page itself never scrolls sideways.
 */
export function ProductStrip({ example, captions }: { example: MarketingExample; captions: readonly [string, string, string] }) {
  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0 md:grid md:grid-cols-3 md:overflow-visible md:pb-0"
      aria-label="How it looks: the customer asks, sees your price, and you confirm it"
      data-testid="product-strip"
    >
      <Frame step={1} caption={captions[0]}>
        <CustomerAsks example={example} />
      </Frame>
      <Frame step={2} caption={captions[1]}>
        <TheyGetAnEstimate example={example} />
      </Frame>
      <Frame step={3} caption={captions[2]}>
        <YouConfirm example={example} />
      </Frame>
    </div>
  )
}

function Frame({ step, caption, children }: { step: number; caption: string; children: React.ReactNode }) {
  return (
    <figure className="w-[78%] shrink-0 snap-center sm:w-[46%] md:w-auto">
      <figcaption className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <span className="figure inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-white">{step}</span>
        {caption}
      </figcaption>
      <div className="h-full rounded-[1.6rem] border border-border bg-white p-2 shadow-warm-lg" aria-hidden="true">
        <div className="h-full rounded-[1.2rem] bg-background p-3">{children}</div>
      </div>
    </figure>
  )
}

function BusinessHeader() {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-tertiary">Instant estimate</p>
        <p className="truncate font-display text-sm font-bold text-text-primary">{DEMO_BUSINESS_NAME}</p>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small SVG shipped in public/ */}
      <img src={DEMO_LOGO_PATH} alt="" className="h-7 w-auto shrink-0" />
    </div>
  )
}

function CustomerAsks({ example }: { example: MarketingExample }) {
  return (
    <div className="flex h-full flex-col">
      <BusinessHeader />
      <div className="mt-3 rounded-xl border border-border bg-white p-3">
        <p className="text-[11px] font-semibold text-text-secondary">{example.serviceName}</p>
        <p className="mt-2 text-sm font-semibold text-text-primary">{example.question}</p>
        {example.photo ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-mint px-2 py-2">
            <span className="h-8 w-10 rounded bg-gradient-to-br from-[#9aa3a8] to-[#d9dee1]" />
            <span className="text-xs font-medium text-primary">{example.photo} ✓</span>
          </div>
        ) : null}
        <div className="mt-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold" style={{ borderColor: DEMO_PRIMARY_COLOR, color: DEMO_PRIMARY_COLOR }}>
          {example.answer}
        </div>
      </div>
      <div className="mt-auto pt-3">
        <div className="rounded-lg py-2.5 text-center text-sm font-bold text-white" style={{ backgroundColor: DEMO_PRIMARY_COLOR }}>
          Get my estimate
        </div>
      </div>
    </div>
  )
}

function TheyGetAnEstimate({ example }: { example: MarketingExample }) {
  return (
    <div className="flex h-full flex-col">
      <BusinessHeader />
      <div className="mt-3 rounded-xl border border-border bg-white p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">Your estimate</p>
        <p className="mt-0.5 text-[11px] text-text-secondary">{example.serviceName}</p>
        <ul className="mt-2 space-y-1 text-[11px]">
          {example.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-2">
              <span className="text-text-secondary">{l.label}</span>
              <span className="figure text-text-primary">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-xs font-semibold text-text-primary">Estimate</span>
          <span className="figure text-xl text-text-primary">{money(example.total)}</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-text-muted">{DEMO_BUSINESS_NAME} confirms it, then you can accept.</p>
      <div className="mt-auto pt-3">
        <div className="rounded-lg border border-border bg-surface py-2.5 text-center text-sm font-semibold text-text-muted">Accept</div>
      </div>
    </div>
  )
}

function YouConfirm({ example }: { example: MarketingExample }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm font-bold text-text-primary">Waiting for you</p>
        <p className="text-[11px] text-text-secondary">
          <span className="figure">1</span> to approve
        </p>
      </div>
      <div className="mt-3 rounded-xl border border-border bg-white p-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-tertiary">New lead</p>
        <p className="mt-1 truncate text-sm font-semibold text-text-primary">{example.customerName}</p>
        <p className="truncate text-[11px] text-text-secondary">{example.serviceName} · just now</p>
        <p className="figure mt-2 text-xl text-text-primary">{money(example.total)}</p>
      </div>
      <div className="mt-auto pt-3">
        <div className="rounded-lg bg-primary py-2.5 text-center text-sm font-bold text-white">Approve &amp; send</div>
      </div>
    </div>
  )
}
