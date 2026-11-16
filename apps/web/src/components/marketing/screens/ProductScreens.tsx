import { formatMoney } from '@qolumns/shared'
import { brandStyleVars } from '@/lib/color'
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
