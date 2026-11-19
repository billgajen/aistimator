import { QUOTE_TURN_COPY, formatMoney } from '@qolumns/shared'
import { brandStyleVars } from '@/lib/color'
import { QrSvg } from '@/components/marketing/QrSvg'
import { TurnBadge } from '@/components/quotes/TurnBadge'
import { Money, SectionLabel } from '@/components/quote/document-parts'
import { Button } from '@/components/ui/Button'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'

/**
 * T-167: product screens for the marketing pages (system.md, Imagery: "real
 * product screens at true size"). Each is the markup of the real screen it
 * shows, with the real screen's own words (lib/marketing/screen-words.ts),
 * given data and no behaviour: it fetches nothing and its buttons do nothing.
 *
 *   QuestionScreen   the customer's question screen (app/q/[quoteId]/clarify)
 *   TakeoffScreen    the estimate's "Measurement & takeoff" block
 *   LedgerScreen     the estimate's price breakdown, with a line the product added
 *   RangeScreen      the estimate while a detail is unconfirmed: a range
 *   PriceCheckScreen setup's "Check your prices"
 *   NumbersScreen    Home's numbers for the last 30 days
 *   SectionsScreen   the price breakdown of a quote that carries two services (T-187)
 *   ApproveScreen    the dashboard's "Waiting for you": a request to approve (T-187)
 *   LinkScreen       the Quote link screen: the link, Copy, the QR code
 *   UnderstoodScreen a customer's message beside what the product made of it (T-173).
 *                    Not one screen of the product: a summary of three results that
 *                    each appear on a real one (the form's service suggestion, the
 *                    question screen, the price breakdown).
 *
 * A screen is a picture: wrap it in <Picture> so a screen reader hears one
 * sentence and the keyboard skips it. The customer's screens take the
 * business's colour, never ours.
 */

const W = SCREEN_WORDS

/** A product screen shown as a picture: one sentence for a screen reader, nothing to tab into */
export function Picture({ label, className = '', children, testId }: { label: string; className?: string; children: React.ReactNode; testId?: string }) {
  return (
    <div role="img" aria-label={label} {...({ inert: '' } as object)} className={className} data-testid={testId} data-product-screen="">
      {children}
    </div>
  )
}

/** A phone around a screen (the frame "Add it anywhere" uses on Home) */
export function PhoneFrame({ address, children, className = '' }: { address: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`mx-auto max-w-[22rem] rounded-3xl border border-field bg-surface p-2.5 shadow-warm-lg ${className}`}>
      <div className="overflow-hidden rounded-2xl bg-background px-3 pb-6 pt-4">
        <p className="figure mb-3 truncate text-center text-[11px] text-text-muted">{address}</p>
        {children}
      </div>
    </div>
  )
}

/**
 * The customer's question screen: what the product read, and two answers.
 * `answered` shows "Yes" chosen (the real screen's chosen style). The home
 * demo passes classes and styles to bring the question in and press "Yes".
 */
export function QuestionScreen({
  value,
  readFrom,
  primaryColor,
  answered = true,
  stacked = false,
  className = '',
  style,
  yesClassName = '',
  yesStyle,
  chosenClassName = '',
  chosenStyle,
}: {
  value: string
  readFrom: string
  primaryColor: string
  answered?: boolean
  /** one answer under the other, for a narrow column (the real screen puts them side by side when there is room) */
  stacked?: boolean
  className?: string
  style?: React.CSSProperties
  /** the home demo: the unchosen "Yes" being pressed */
  yesClassName?: string
  yesStyle?: React.CSSProperties
  /** the home demo: the chosen "Yes" arriving over it */
  chosenClassName?: string
  chosenStyle?: React.CSSProperties
}) {
  const answer = 'flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-4 py-3 text-center text-sm font-semibold'
  const chosen = `${answer} border-secondary bg-secondary-light text-secondary`
  const open = `${answer} border-field text-text-primary`
  const animated = Boolean(yesClassName || chosenClassName)
  return (
    <div className={`rounded-3xl border border-border bg-white p-6 text-left shadow-warm-lg ${className}`} style={{ ...brandStyleVars(primaryColor), ...style }} data-testid="question-screen">
      <p className="text-sm font-semibold text-text-primary" data-testid="question-text">{W.question.ask(value, readFrom)}</p>
      <div className={`mt-3 flex flex-col gap-2 ${stacked ? '' : 'sm:flex-row'}`}>
        {animated ? (
          <span className="grid flex-1">
            <span className={`col-start-1 row-start-1 ${open} ${yesClassName}`} style={yesStyle}>{W.question.yes(value)}</span>
            <span className={`col-start-1 row-start-1 ${chosen} ${chosenClassName}`} style={chosenStyle} data-testid="question-yes">{W.question.yes(value)}</span>
          </span>
        ) : (
          <span className={answered ? chosen : open} data-testid="question-yes">{W.question.yes(value)}</span>
        )}
        <span className={open}>{W.question.no}</span>
      </div>
    </div>
  )
}

/** The estimate's "Measurement & takeoff" block: how a quantity was established */
export function TakeoffScreen({
  rows,
  locale = 'en-US',
  primaryColor,
  className = '',
}: {
  /** T-171: what was measured, as the real page shows it: one sentence a row, no amount and no rate */
  rows: Array<{ item: string; quantity: number; unit: string }>
  locale?: string
  primaryColor: string
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-background text-left ${className}`} style={brandStyleVars(primaryColor)} data-testid="takeoff-screen">
      <div className="px-5 pb-3 pt-4">
        <SectionLabel tone="tape" as="p">{W.estimate.takeoffTitle}</SectionLabel>
        <p className="-mt-1 text-xs text-text-muted">{W.estimate.takeoffLead}</p>
      </div>
      <div className="tape-rule mx-5" aria-hidden="true" />
      <ul className="space-y-2 px-5 py-4">
        {rows.map((row) => {
          const line = W.estimate.measuredLine(row, locale)
          // the line begins with where the quantity came from: "From your photos"
          const rest = line.startsWith(W.estimate.fromPhotos) ? line.slice(W.estimate.fromPhotos.length) : ''
          return (
            <li key={row.item} className="text-sm text-text-primary" data-testid="read-line">
              {rest ? (
                <>
                  <span data-testid="takeoff-method">{W.estimate.fromPhotos}</span>
                  {rest}
                </>
              ) : (
                line
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The estimate's price breakdown. A line with `added` carries the product's "Added for you" note. */
export function LedgerScreen({
  lines,
  total,
  currency = 'USD',
  locale = 'en-US',
  primaryColor,
  className = '',
}: {
  lines: Array<{ label: string; amount: number; added?: boolean }>
  total: number
  currency?: string
  locale?: string
  primaryColor: string
  className?: string
}) {
  const money = (n: number) => formatMoney(n, currency, locale)
  return (
    <div className={`rounded-3xl bg-background px-6 py-6 text-left shadow-document ${className}`} style={brandStyleVars(primaryColor)} data-testid="ledger-screen">
      <SectionLabel as="p">{W.estimate.breakdown}</SectionLabel>
      <div className="mb-4 space-y-2.5">
        {lines.map((line) => (
          <div key={line.label}>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="text-text-primary">{line.label}</span>
              <span className="flex-1 translate-y-[-3px] border-b border-dotted border-border-strong" />
              <span className="figure whitespace-nowrap text-text-primary">{money(line.amount)}</span>
            </div>
            {line.added ? (
              <p className="mt-0.5 text-xs text-primary" data-testid="ledger-added">{W.estimate.added}</p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-sm font-semibold text-text-primary">{W.estimate.total}</span>
        <span className="figure text-lg font-medium text-text-primary">{money(total)}</span>
      </div>
    </div>
  )
}

/** The estimate while a detail is unconfirmed: a range, and the way to the question */
export function RangeScreen({
  businessName,
  customerName,
  low,
  high,
  currency = 'USD',
  locale = 'en-US',
  primaryColor,
  className = '',
}: {
  businessName: string
  customerName: string
  low: number
  high: number
  currency?: string
  locale?: string
  primaryColor: string
  className?: string
}) {
  return (
    <div className={`overflow-hidden rounded-3xl bg-background text-left shadow-document ${className}`} style={brandStyleVars(primaryColor)} data-testid="range-screen">
      <div className="px-6 pb-5 pt-6">
        <p className="truncate font-display text-xl font-bold tracking-tight text-text-primary">{businessName}</p>
      </div>
      <div className="bg-primary px-6 py-8 text-on-primary">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-on-primary/60">{W.estimate.rangeFor(customerName)}</p>
        <p className="figure text-4xl font-medium tracking-tight" data-testid="range-figures">
          <Money amount={low} currency={currency} locale={locale} />
          <span className="mx-2 font-light text-on-primary/40">—</span>
          <Money amount={high} currency={currency} locale={locale} />
        </p>
        <div className="tape-rule-light mt-7" aria-hidden="true" />
        <p className="mt-5 max-w-md text-sm text-on-primary/80">{W.estimate.rangeLead}</p>
        <span className="mt-4 inline-block rounded-xl bg-butter px-6 py-3.5 font-semibold text-ink">{W.estimate.rangeButton}</span>
      </div>
    </div>
  )
}

/** Setup's "Check your prices": the price list a business checks and makes its own */
export function PriceCheckScreen({
  serviceName,
  prices,
  sentence,
  className = '',
}: {
  serviceName: string
  prices: Array<{ label: string; amount: number | string }>
  /** the business's own words, when the list came from a price sentence */
  sentence?: string
  className?: string
}) {
  return (
    <div className={`rounded-3xl bg-white p-6 text-left shadow-warm-lg ${className}`} data-testid="price-check-screen">
      <p className="font-display text-lg font-bold text-text-primary">{W.prices.title}</p>
      <p className="mt-1 text-sm text-text-secondary">{serviceName}</p>
      {sentence ? (
        <p className="mt-4 rounded-xl border border-field bg-background px-4 py-3 text-[15px] text-text-primary" data-testid="price-check-sentence">{sentence}</p>
      ) : null}
      <ul className="mt-4 space-y-3">
        {prices.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm text-text-primary">{p.label}</span>
            <span className="figure inline-flex min-h-[44px] w-28 shrink-0 items-center justify-end rounded-lg border border-field bg-background px-3 text-sm text-text-primary">
              {typeof p.amount === 'number' ? formatMoney(p.amount, 'USD', 'en-US') : p.amount}
            </span>
          </li>
        ))}
      </ul>
      {sentence ? null : <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm text-text-secondary">{W.prices.hint}</p>}
      <Button className="mt-4 w-full" tabIndex={-1}>{W.prices.confirm}</Button>
    </div>
  )
}

/** Home's numbers for the last 30 days (the dashboard's own cards) */
export function NumbersScreen({
  title,
  note,
  numbers,
  className = '',
}: {
  title: string
  note: string
  numbers: Array<{ title: string; value: string; change: string }>
  className?: string
}) {
  return (
    <div className={`rounded-3xl bg-background p-5 text-left shadow-warm-lg sm:p-6 ${className}`} data-testid="numbers-screen">
      <p className="font-display text-lg font-bold text-text-primary">{title}</p>
      <p className="text-xs text-text-muted">{note}</p>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {numbers.map((n) => (
          <div key={n.title} className="rounded-2xl bg-white p-5 shadow-warm-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{n.title}</p>
            <p className="figure mt-3 text-2xl font-medium tracking-tight text-text-primary sm:text-4xl">{n.value}</p>
            <p className="mt-1 text-xs text-text-muted">{n.change}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * T-173: a customer's message on one side, what the product made of it on the
 * other. Each row is a result the product really produces for these words
 * (Docs/design/ai-capabilities.md: service-match, words-against-answers,
 * extras-from-description); the rows are gathered here for the home page and
 * do not sit together on one product screen.
 */
export function UnderstoodScreen({
  wroteTitle,
  message,
  understoodTitle,
  rows,
  primaryColor,
  className = '',
}: {
  wroteTitle: string
  message: string
  understoodTitle: string
  rows: Array<{ id: string; label: string; value: string; text: string }>
  primaryColor: string
  className?: string
}) {
  return (
    <div
      className={`grid gap-6 rounded-3xl border border-border bg-white p-6 text-left shadow-warm-lg sm:grid-cols-2 sm:gap-8 ${className}`}
      style={brandStyleVars(primaryColor)}
      data-testid="understood-screen"
    >
      <div>
        <SectionLabel as="p">{wroteTitle}</SectionLabel>
        <p className="rounded-2xl bg-surface p-4 text-sm leading-relaxed text-text-primary" data-testid="understood-message">
          {message}
        </p>
      </div>
      <div>
        <SectionLabel as="p">{understoodTitle}</SectionLabel>
        <dl className="space-y-4" data-testid="understood-rows">
          {rows.map((row) => (
            <div key={row.id} data-understood={row.id}>
              <dt className="text-xs font-medium text-text-muted">{row.label}</dt>
              <dd className="mt-0.5 text-sm text-text-secondary">
                <span className="font-semibold text-text-primary">{row.value}</span>
                <span className="block">{row.text}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/**
 * T-187: the price breakdown of a quote that carries two of a business's
 * services (AD-061): each service's own lines and subtotal, and one total.
 */
export function SectionsScreen({
  parts,
  total,
  currency = 'USD',
  locale = 'en-US',
  primaryColor,
  className = '',
}: {
  parts: Array<{ serviceName: string; lines: Array<{ label: string; amount: number }>; subtotal: number }>
  total: number
  currency?: string
  locale?: string
  primaryColor: string
  className?: string
}) {
  const money = (n: number) => formatMoney(n, currency, locale)
  return (
    <div className={`rounded-3xl bg-background px-6 py-6 text-left shadow-document ${className}`} style={brandStyleVars(primaryColor)} data-testid="sections-screen">
      <SectionLabel as="p">{W.estimate.breakdown}</SectionLabel>
      <div className="mb-5 space-y-6">
        {parts.map((part) => (
          <div key={part.serviceName} data-testid="sections-part">
            <p className="mb-2.5 text-sm font-semibold text-text-primary">{part.serviceName}</p>
            <div className="space-y-2.5">
              {part.lines.map((line) => (
                <div key={line.label} className="flex items-baseline gap-2 text-sm">
                  <span className="text-text-primary">{line.label}</span>
                  <span className="flex-1 translate-y-[-3px] border-b border-dotted border-border-strong" />
                  <span className="figure whitespace-nowrap text-text-primary">{money(line.amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex justify-between gap-4 border-t border-border pt-2 text-sm">
              <span className="text-text-secondary">{W.sections.subtotal(part.serviceName)}</span>
              <span className="figure text-text-primary">{money(part.subtotal)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between border-t border-border-strong pt-3">
        <span className="font-display font-bold text-text-primary">{W.sections.total}</span>
        <span className="figure text-lg font-medium text-text-primary">{money(total)}</span>
      </div>
    </div>
  )
}

/** T-187: the dashboard's "Waiting for you" with one request to approve (the hero demo's third frame, still) */
export function ApproveScreen({
  customerName,
  serviceName,
  total,
  currency = 'USD',
  locale = 'en-US',
  className = '',
}: {
  customerName: string
  serviceName: string
  total: number
  currency?: string
  locale?: string
  className?: string
}) {
  return (
    <div className={`rounded-3xl bg-white p-6 text-left shadow-warm-lg ${className}`} data-testid="approve-screen">
      <p className="font-display text-lg font-bold text-text-primary">{QUOTE_TURN_COPY.home.title}</p>
      <div className="mt-4 rounded-xl border border-border bg-background p-4">
        <p className="text-sm font-semibold text-text-primary">{customerName}</p>
        <p className="text-xs text-text-secondary">{serviceName} · just now</p>
        <div className="mt-2">
          <TurnBadge turn={{ label: QUOTE_TURN_COPY.labels.needsApproval, detail: '', tone: 'attention' }} showDetail={false} />
        </div>
        <p className="figure mt-2 text-2xl font-medium text-text-primary">{formatMoney(total, currency, locale)}</p>
      </div>
      <Button className="mt-4 w-full" tabIndex={-1}>
        {QUOTE_TURN_COPY.pageButtons.approve}
      </Button>
    </div>
  )
}

/** The Quote link screen: the business's own link with Copy, and its QR code (a real code: it opens the link) */
export function LinkScreen({ quoteLink, className = '' }: { quoteLink: string; className?: string }) {
  return (
    <div className={`rounded-3xl bg-white p-6 text-left shadow-warm-lg ${className}`} data-testid="setup-screen-link">
      <p className="font-display text-lg font-bold text-text-primary">Your quote link</p>
      <div className="mt-4 flex items-center gap-2">
        <span className="figure flex min-h-[44px] min-w-0 flex-1 items-center truncate rounded-lg border border-field bg-background px-3 text-sm text-text-primary">{quoteLink.replace(/^https?:\/\//, '')}</span>
        <Button size="sm" tabIndex={-1}>
          Copy
        </Button>
      </div>
      <div className="mt-5 flex items-center gap-4">
        <QrSvg value={quoteLink} className="h-24 w-24 shrink-0 rounded-lg border border-border text-ink" />
        <p className="text-sm text-text-secondary">Put it on your van, flyers, business cards or invoices.</p>
      </div>
    </div>
  )
}
