import Link from 'next/link'
import { formatMoney } from '@qolumns/shared'
import { PLUS_TAX, planCards } from '@/lib/marketing/plan-claims'
import { PRICING_DEMO_LINKS } from '@/lib/marketing/site-copy'
import { Soon } from './Soon'

const dollars = (cents: number) => formatMoney(cents / 100, 'USD', 'en-US', { decimals: cents % 100 === 0 ? 0 : 2 })

/**
 * T-187: the plan cards, the same on Home and on Pricing.
 *
 * Two cards, centred (three fill the row when the site shows a third plan).
 * Each says, in plain lines, what you get: the price a month and that tax comes on top (PLUS_TAX),
 * the price a year, how many quotes, then the plan's lines from
 * lib/marketing/plan-claims.ts: the ones a business can use today first, the
 * ones still to come marked "Coming soon". A plan above another says
 * "Everything in <that plan>, plus" and lists only what it adds. One button a
 * card. Nothing is typed here: a number comes from the plan definitions
 * (packages/shared/src/plans.ts) and a line from plan-claims.
 */
export function PlanCards({ className = '' }: { className?: string }) {
  const cards = planCards()
  return (
    <div className={`mx-auto grid gap-6 ${cards.length === 2 ? 'max-w-4xl md:grid-cols-2' : 'lg:grid-cols-3'} ${className}`} data-testid="plan-cards">
      {cards.map((card) => {
        const dark = card.recommended
        const quiet = dark ? 'text-on-primary' : 'text-text-secondary'
        return (
          <div
            key={card.id}
            className={`relative flex flex-col rounded-3xl p-6 text-left sm:p-8 ${dark ? 'bg-primary text-on-primary shadow-warm-lg' : 'border border-border bg-white shadow-warm'}`}
            data-testid="plan-card"
            data-plan={card.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-xl font-bold">{card.name}</h3>
              {card.recommended ? (
                // T-170: our own advice, not a claim about customers ("Most popular" was one)
                <span className="rounded-full border border-on-primary px-2.5 py-0.5 text-xs font-semibold" data-testid="plan-recommended">
                  Recommended
                </span>
              ) : null}
            </div>

            <p className="mt-4 flex flex-wrap items-baseline gap-x-2" data-testid="plan-price">
              <span className="figure text-5xl font-medium">{dollars(card.monthly)}</span>
              <span className={`text-sm ${quiet}`}>a month, {PLUS_TAX}</span>
            </p>
            {card.yearly !== null ? (
              <p className={`mt-1 text-sm ${quiet}`} data-testid="plan-yearly">
                or <span className="figure">{dollars(card.yearly)}</span> a year, {PLUS_TAX} (two months free)
              </p>
            ) : null}

            <div className={dark ? 'tape-rule-light mt-6' : 'tape-rule mt-6'} aria-hidden="true" />

            {card.buildsOn ? (
              <p className="mt-5 text-sm font-semibold" data-testid="plan-builds-on">
                {card.buildsOn}
              </p>
            ) : null}
            <ul className={`flex-1 space-y-2.5 text-sm ${card.buildsOn ? 'mt-3' : 'mt-5'}`} data-testid="plan-lines">
              <Line dark={dark} live>
                <span className="figure">{card.quotes.split(' ')[0]}</span> {card.quotes.split(' ').slice(1).join(' ')}
              </Line>
              {card.lines.map((line) => (
                <Line key={line.label} dark={dark} live={line.live}>
                  {/* T-167: these two are shown, not only told: they open the live demo */}
                  {line.live && (line.label === PRICING_DEMO_LINKS.hostedPages || line.label === PRICING_DEMO_LINKS.branding) ? (
                    // a link in a list is a tap target on a phone: 44 px tall (system.md, Layout)
                    <Link href={PRICING_DEMO_LINKS.href} className="-my-1.5 inline-block py-1.5 underline underline-offset-2 max-sm:min-h-[44px]" data-testid="plan-demo-link">
                      {line.label}
                    </Link>
                  ) : (
                    line.label
                  )}
                  <Soon line={line} onDark={dark} className="ml-2" />
                </Line>
              ))}
            </ul>

            <Link
              href={`/signup?plan=${card.id}`}
              className={`motion-press mt-8 inline-flex min-h-[48px] items-center justify-center rounded-lg px-6 text-sm font-semibold ${
                dark ? 'bg-white text-primary hover:bg-mint' : 'bg-primary text-white hover:bg-primary-hover'
              }`}
              data-testid="plan-button"
            >
              Choose {card.name}
            </Link>
          </div>
        )
      })}
    </div>
  )
}

/** One line of a card: a tick when a business can use it today, a ring when it is still to come (a shape and words, never colour alone) */
function Line({ dark, live, children }: { dark: boolean; live: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5" data-testid="plan-line" data-live={live ? 'true' : 'false'}>
      <span aria-hidden="true" className={`mt-px shrink-0 ${dark ? 'text-on-primary' : live ? 'text-secondary' : 'text-text-muted'}`}>
        {live ? '✓' : '○'}
      </span>
      <span className={dark ? 'text-on-primary' : live ? 'text-text-primary' : 'text-text-secondary'}>{children}</span>
    </li>
  )
}
