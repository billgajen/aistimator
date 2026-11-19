import Link from 'next/link'
import { formatMoney } from '@qolumns/shared'
import { Button } from '@/components/ui/Button'
import { LinkScreen } from '@/components/marketing/screens/ProductScreens'
import { Soon } from '@/components/marketing/Soon'
import { UPCOMING, isLive } from '@/lib/marketing/plan-claims'

/**
 * T-165: "Set up in minutes" — three steps, each beside the screen it happens
 * on, drawn at true size from the product's own parts (the trade templates,
 * the template's own prices, the real QR encoder). The rows alternate sides,
 * so no two neighbours share a layout.
 *
 * T-167: the links to the trade pages live here, under step 1 ("Choose your
 * trade"), as pills on a line that wraps; the last pill is "Other trades".
 * (They were a row of their own under the hero.)
 *
 * T-187: step 3 keeps the link and QR box and says where else the same form
 * works: on a website (live), in a WhatsApp chat and on site with the app.
 * The last two are not live: their words and their "Coming soon" mark come
 * from lib/marketing/plan-claims.ts. A link leads down to "Add it anywhere".
 */
export function SetupSteps({
  steps,
  screenLabels,
  trades,
  chosenTrade,
  serviceName,
  prices,
  quoteLink,
  tradeLinks,
  elsewhere,
}: {
  steps: ReadonlyArray<{ title: string; text: string }>
  /** each screen is a picture of the product: what a screen reader hears for it */
  screenLabels: readonly string[]
  trades: string[]
  chosenTrade: string
  serviceName: string
  prices: Array<{ label: string; amount: number }>
  quoteLink: string
  /** T-167: the trade pages, linked from step 1; the last one is "Other trades" */
  tradeLinks: ReadonlyArray<{ label: string; href: string; other?: boolean }>
  /** T-187: under step 3: the live place by name, and the link down to "Add it anywhere" */
  elsewhere: { website: string; link: { label: string; href: string } }
}) {
  const screens = [
    <TradeScreen key="trade" trades={trades} chosen={chosenTrade} />,
    <PricesScreen key="prices" serviceName={serviceName} prices={prices} />,
    <LinkScreen key="link" quoteLink={quoteLink} />,
  ]
  return (
    <ol className="mt-10 space-y-12 lg:space-y-16" data-testid="setup-steps">
      {steps.map((step, i) => (
        <li key={step.title} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-16" data-testid="setup-step">
          <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
            <p className="figure text-sm font-medium text-text-muted">0{i + 1}</p>
            <h3 className="mt-1 font-display text-2xl font-bold text-text-primary sm:text-3xl">{step.title}</h3>
            <p className="mt-3 max-w-md text-text-secondary">{step.text}</p>
            {i === 0 ? (
              <ul className="mt-5 flex max-w-xl flex-wrap gap-2" data-testid="trades-row">
                {tradeLinks.map((t) => (
                  <li key={t.href + t.label}>
                    <Link
                      href={t.href}
                      className={`motion-press inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm ${t.other ? 'border-dashed border-field font-medium text-text-secondary' : 'border-field bg-white font-semibold text-text-primary'} hover:border-primary`}
                    >
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {i === 2 ? (
              <>
                <ul className="mt-4 space-y-2 text-text-primary" data-testid="setup-elsewhere">
                  <li className="flex items-center gap-2.5">
                    <Tick />
                    {elsewhere.website}
                  </li>
                  <li className="flex flex-wrap items-center gap-2.5">
                    <Tick soon={!isLive('whatsapp')} />
                    {UPCOMING.whatsapp.where}
                    <Soon of="whatsapp" />
                  </li>
                  <li className="flex flex-wrap items-center gap-2.5">
                    <Tick soon={!isLive('app')} />
                    {UPCOMING.app.where}
                    <Soon of="app" />
                  </li>
                </ul>
                <p className="mt-3">
                  <Link href={elsewhere.link.href} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover" data-testid="setup-elsewhere-link">
                    {elsewhere.link.label}
                  </Link>
                </p>
              </>
            ) : null}
          </div>
          <div role="img" aria-label={screenLabels[i]} {...({ inert: '' } as object)} className={i % 2 === 1 ? 'lg:order-1' : ''}>
            {screens[i]}
          </div>
        </li>
      ))}
    </ol>
  )
}

const CARD = 'rounded-3xl bg-white p-6 text-left shadow-warm-lg'

function TradeScreen({ trades, chosen }: { trades: string[]; chosen: string }) {
  return (
    <div className={CARD} data-testid="setup-screen-trade">
      <p className="font-display text-lg font-bold text-text-primary">What kind of work do you do?</p>
      <ul className="mt-4 grid grid-cols-2 gap-3">
        {[...trades, 'Something else'].map((trade) => {
          const on = trade === chosen
          return (
            <li
              key={trade}
              className={`flex min-h-[52px] items-center justify-between gap-2 rounded-xl border px-4 text-sm font-semibold ${on ? 'border-primary bg-mint text-primary' : 'border-field bg-background text-text-primary'}`}
            >
              {trade}
              {on ? <span aria-hidden="true">✓</span> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PricesScreen({ serviceName, prices }: { serviceName: string; prices: Array<{ label: string; amount: number }> }) {
  return (
    <div className={CARD} data-testid="setup-screen-prices">
      <p className="font-display text-lg font-bold text-text-primary">Check your prices</p>
      <p className="mt-1 text-sm text-text-secondary">{serviceName}</p>
      <ul className="mt-4 space-y-3">
        {prices.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm text-text-primary">{p.label}</span>
            <span className="figure inline-flex min-h-[44px] w-28 shrink-0 items-center justify-end rounded-lg border border-field bg-background px-3 text-sm text-text-primary">
              {formatMoney(p.amount, 'USD', 'en-US')}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm text-text-secondary">These are typical starting prices. Change them to yours.</p>
      <Button className="mt-4 w-full" tabIndex={-1}>These are my prices</Button>
    </div>
  )
}

/** A tick for a place that works today, a ring for one still to come (a shape, with the words beside it) */
function Tick({ soon = false }: { soon?: boolean }) {
  return (
    <span aria-hidden="true" className={soon ? 'text-text-muted' : 'text-secondary'}>
      {soon ? '○' : '✓'}
    </span>
  )
}
