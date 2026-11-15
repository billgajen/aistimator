import { formatMoney } from '@qolumns/shared'
import { Button } from '@/components/ui/Button'
import { QrSvg } from '@/components/marketing/QrSvg'

/**
 * T-165: "Set up in minutes" — three steps, each beside the screen it happens
 * on, drawn at true size from the product's own parts (the trade templates,
 * the template's own prices, the real QR encoder). The rows alternate sides,
 * so no two neighbours share a layout.
 */
export function SetupSteps({
  steps,
  screenLabels,
  trades,
  chosenTrade,
  serviceName,
  prices,
  quoteLink,
}: {
  steps: ReadonlyArray<{ title: string; text: string }>
  /** each screen is a picture of the product: what a screen reader hears for it */
  screenLabels: readonly string[]
  trades: string[]
  chosenTrade: string
  serviceName: string
  prices: Array<{ label: string; amount: number }>
  quoteLink: string
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

function LinkScreen({ quoteLink }: { quoteLink: string }) {
  return (
    <div className={CARD} data-testid="setup-screen-link">
      <p className="font-display text-lg font-bold text-text-primary">Your quote link</p>
      <div className="mt-4 flex items-center gap-2">
        <span className="figure flex min-h-[44px] min-w-0 flex-1 items-center truncate rounded-lg border border-field bg-background px-3 text-sm text-text-primary">{quoteLink.replace(/^https?:\/\//, '')}</span>
        <Button size="sm" tabIndex={-1}>Copy</Button>
      </div>
      <div className="mt-5 flex items-center gap-4">
        <QrSvg value={quoteLink} className="h-24 w-24 shrink-0 rounded-lg border border-border text-ink" />
        <p className="text-sm text-text-secondary">Put it on your van, flyers, business cards or invoices.</p>
      </div>
    </div>
  )
}
