import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PlanCards } from '@/components/marketing/PlanCards'
import { Faq } from '@/components/marketing/Faq'
import { MAIN_CTA } from '@/lib/marketing/cta'
import { PRICING_DEMO_LINKS } from '@/lib/marketing/site-copy'
import { COMING_SOON, PRICING_DESCRIPTION, PRICING_LEAD, sitePlans } from '@/lib/marketing/plan-claims'
import { BILLING_NOTES, COMPARE, PRICING_CLOSING, PRICING_FAQ, PRICING_FAQ_HEADING, PRICING_HERO, compareGroups, type CompareCell } from '@/lib/marketing/pricing-copy'
import { freeOfferLabel, FREE_ALLOWANCE, PRODUCT_NAME } from '@qolumns/shared'

export const metadata: Metadata = {
  title: `Pricing — ${PRODUCT_NAME}`,
  description: PRICING_DESCRIPTION,
}

const WRAP = 'mx-auto max-w-container px-4 sm:px-6'
const H2 = 'font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl'
// T-152: the free allowance for new businesses, counted in total; it never resets
const FREE_QUOTES = FREE_ALLOWANCE.US!.quotes

/**
 * T-187 (the owner's review): the Pricing page, in this order:
 *   1 the headline, the free offer and the page's one yellow button
 *   2 the two plan cards: the same component as Home's (components/marketing/PlanCards)
 *   3 the compare table, in plain rows, grouped: Quotes, Where customers reach
 *     you, What the AI does, Your brand, Coming soon
 *   4 the billing notes: billed in advance, plus tax, cancel any time, a
 *     smaller plan from the end of the period, what happens over the limit
 *   5 the pricing questions
 *   6 the closing words and button
 *
 * Nothing on the page is typed that the plans decide. T-134: every number
 * comes from the plan definitions (packages/shared/src/plans.ts). T-170: the
 * page shows a plan only once one of its own lines is live (`sitePlans`), and
 * a line a business cannot use yet is never shown as included: it sits in the
 * table's last group, marked from its one flag (lib/marketing/plan-claims.ts).
 * The table itself is built by lib/marketing/pricing-copy.ts.
 */
export default function PricingPage() {
  const plans = sitePlans()
  const groups = compareGroups(plans)
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />

      {/* 1. The headline and the one yellow call to action of this screen (T-165) */}
      <section className={`${WRAP} pb-4 pt-12 text-center sm:pt-16`} data-testid="hero">
        <h1 className="mx-auto max-w-3xl font-display text-4xl font-extrabold tracking-tight text-text-primary sm:text-display-sm">{PRICING_HERO.headline}</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">{PRICING_LEAD}</p>
        <p className="mt-6">
          <Link href="/signup" className={MAIN_CTA} data-cta="main">
            {freeOfferLabel()}
          </Link>
        </p>
        <p className="mt-3 text-sm text-text-muted" data-testid="pricing-free">
          <span className="figure">{FREE_QUOTES}</span> {PRICING_HERO.free}
        </p>
      </section>

      {/* 2. The plan cards */}
      <section className={`${WRAP} py-12`} data-testid="plans">
        <PlanCards />
      </section>

      {/* 3. The compare table */}
      <section className="border-y border-border bg-surface py-16 sm:py-20" data-testid="compare">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className={`${H2} text-center`}>{COMPARE.heading}</h2>
          <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-white">
            <table className="w-full table-fixed border-collapse text-left text-sm" data-testid="compare-table">
              <colgroup>
                <col />
                {plans.map((plan) => (
                  <col key={plan.id} className="w-[22%] sm:w-[20%]" />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-border-strong">
                  <th scope="col" className="px-4 py-4 font-normal sm:px-6">
                    <span className="sr-only">{COMPARE.whatYouGet}</span>
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.id} scope="col" className="px-2 py-4 text-center font-display text-base font-bold text-text-primary">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.id} data-testid="compare-group" data-group={group.id}>
                  <tr className="bg-mint">
                    <th scope="colgroup" colSpan={plans.length + 1} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-text-primary sm:px-6">
                      {group.title}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label} className="border-t border-border" data-testid="compare-row">
                      <th scope="row" className="px-4 py-3.5 font-normal text-text-primary sm:px-6">
                        {/* T-167: these two are shown, not only told: they open the live demo */}
                        {row.label === PRICING_DEMO_LINKS.hostedPages || row.label === PRICING_DEMO_LINKS.branding ? (
                          <Link href={PRICING_DEMO_LINKS.href} className="-my-1.5 inline-block py-1.5 underline underline-offset-2 max-sm:min-h-[44px]" data-testid="plan-demo-link">
                            {row.label}
                          </Link>
                        ) : (
                          row.label
                        )}
                      </th>
                      {row.cells.map((cell, i) => (
                        <td key={plans[i]!.id} className="px-2 py-3.5 text-center align-middle" data-testid="compare-cell">
                          <Cell cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      {/* 4. How the money works */}
      <section className={`${WRAP} py-16 sm:py-20`} data-testid="billing-notes">
        <dl className="mx-auto grid max-w-4xl gap-x-12 gap-y-8 sm:grid-cols-2">
          {BILLING_NOTES.map((note) => (
            <div key={note.title} data-testid="billing-note">
              <dt className="font-display text-lg font-bold text-text-primary">{note.title}</dt>
              <dd className="mt-1.5 text-text-secondary">{note.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 5. The pricing questions */}
      <section className="border-t border-border bg-surface py-16 sm:py-20" data-testid="questions">
        <Faq heading={PRICING_FAQ_HEADING} items={PRICING_FAQ} />
      </section>

      {/* 6. The closing words, with this screen's one yellow button */}
      <section className={`${WRAP} py-16 text-center sm:py-20`} data-testid="closing">
        <h2 className={H2}>{PRICING_CLOSING.heading}</h2>
        <p className="mx-auto mt-3 max-w-xl text-text-secondary">{PRICING_CLOSING.lead}</p>
        <Link href="/signup" className={`${MAIN_CTA} mt-6`} data-cta="main">
          {freeOfferLabel()}
        </Link>
      </section>

      <SiteFooter />
    </main>
  )
}

/** A cell of the table: a tick with the word for a screen reader, a dash for "not included", a number, or the mark for what is still to come */
function Cell({ cell }: { cell: CompareCell }) {
  if (cell === true) {
    return (
      <>
        <span aria-hidden="true" className="text-base font-semibold text-secondary">
          ✓
        </span>
        <span className="sr-only">{COMPARE.included}</span>
      </>
    )
  }
  if (cell === false) {
    return (
      <>
        <span aria-hidden="true" className="text-text-muted">
          –
        </span>
        <span className="sr-only">{COMPARE.notIncluded}</span>
      </>
    )
  }
  if (cell === COMING_SOON) return <span className="text-xs font-semibold text-text-secondary" data-testid="coming-soon">{cell}</span>
  return <span className="figure font-medium text-text-primary">{cell}</span>
}
