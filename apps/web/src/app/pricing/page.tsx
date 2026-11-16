import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { MAIN_CTA } from '@/lib/marketing/cta'
import { PRICING_AI_FAQ, PRICING_DEMO_LINKS } from '@/lib/marketing/site-copy'
import { COMING_LATER, PRICING_DESCRIPTION, PRICING_LEAD, PRICING_TAGLINES, planLines, sitePlans } from '@/lib/marketing/plan-claims'
import { formatMoney, freeOfferLabel, FREE_ALLOWANCE, PRODUCT_NAME } from '@qolumns/shared'

export const metadata: Metadata = {
  title: `Pricing — ${PRODUCT_NAME}`,
  description: PRICING_DESCRIPTION,
}

// T-134: every number on this page comes from the plan definitions
// (packages/shared/src/plans.ts) — nothing is duplicated here.
// T-170 (owner's decision): the page shows a plan only once one of its own lines is live, so Business is left
// off for now (lib/marketing/plan-claims.ts, `sitePlans`). The plans themselves are unchanged.
const OFFERED = sitePlans()
/** Two plans sit as a centred pair; three fill the row */
const GRID = OFFERED.length === 2 ? 'mx-auto max-w-4xl lg:grid-cols-2' : 'lg:grid-cols-3'
// T-152: the free allowance for new businesses — counted in total, never resets
const FREE_QUOTES = FREE_ALLOWANCE.US!.quotes

// T-170: which of a plan's lines a business can use today is in
// lib/marketing/plan-claims.ts. A line that is not live yet is shown after the
// live ones, marked "Coming later"; nothing is shown as live that is not.

const dollars = (cents: number) => formatMoney(cents / 100, 'USD', 'en-US', { decimals: cents % 100 === 0 ? 0 : 2 })

const FAQS = [
  {
    q: 'Can I try it for free?',
    a: `Yes. Every new business gets ${FREE_QUOTES} priced quotes free, with no card. They don’t reset each month: it’s ${FREE_QUOTES} in total, so you can try it properly with real customers. Test quotes from setup and requests a customer didn’t finish don’t count. After that, new requests are still saved as leads until you pick a plan.`,
  },
  {
    q: 'What counts as an estimate?',
    a: 'One customer enquiry that produces a quote — however many photos, questions or revisions it takes. Failed or spam submissions don’t count.',
  },
  {
    q: 'What happens when I hit my monthly limit?',
    a: 'You never lose a customer. New requests are saved as leads and the customer is told you’ll send their estimate shortly; you can upgrade and price them with one click. There are no surprise per-estimate charges. You’ll see a warning in your dashboard at 80%.',
  },
  PRICING_AI_FAQ,
  {
    q: 'When do I start paying?',
    a: `When you pick a plan. Your ${FREE_QUOTES} free quotes need no card. Your setup and quote history carry straight over.`,
  },
  {
    q: 'Is there annual billing?',
    a: 'Yes — pay yearly and get two months free.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Plans are monthly with no contract. If you cancel, you keep access until the end of the billing period.',
  },
]

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />

      <section className="mx-auto max-w-6xl px-6 pb-4 pt-16 text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">
          One missed job pays for the year.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">{PRICING_LEAD}</p>
        <p className="mt-5">
          {/* T-165: the one yellow call to action of this screen */}
          <Link href="/signup" className={MAIN_CTA} data-cta="main">
            {freeOfferLabel()}
          </Link>
        </p>
        <p className="mt-3 text-sm text-text-muted">
          {FREE_QUOTES} priced quotes in total, then pick a plan. Pay yearly, get two months free.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className={`grid gap-6 ${GRID}`} data-testid="plans">
          {OFFERED.map((def) => {
            const plan = {
              name: def.name,
              tagline: PRICING_TAGLINES[def.id] ?? def.tagline,
              price: dollars(def.monthlyPrice.USD ?? 0),
              estimates: def.quoteLimit.toLocaleString('en-US'),
              lines: planLines(def),
              highlight: Boolean(def.recommended),
              cta: `Choose ${def.name}`,
              annual: def.annualPrice?.USD ? dollars(def.annualPrice.USD) : null,
            }
            return (
            <div
              key={def.id}
              className={`relative flex flex-col rounded-3xl p-8 ${
                plan.highlight
                  ? 'bg-primary text-white shadow-warm-lg'
                  : 'border border-border bg-white shadow-warm'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-tape px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink" data-testid="plan-recommended">
                  {/* T-170: "Most popular" was a claim about customers we cannot back; this is our own recommendation */}
                  Recommended
                </span>
              )}
              <p className={`text-sm font-semibold ${plan.highlight ? 'text-white/80' : 'text-text-secondary'}`}>
                {plan.name}
              </p>
              <p className={`mt-1 text-xs ${plan.highlight ? 'text-white/60' : 'text-text-muted'}`}>
                {plan.tagline}
              </p>
              <p className="figure mt-5 text-5xl font-medium">
                {plan.price}
                <span className={`ml-1 text-sm ${plan.highlight ? 'text-white/60' : 'text-text-muted'}`}>
                  /month
                </span>
              </p>
              <div className={plan.highlight ? 'tape-rule-light mt-6' : 'tape-rule mt-6'} />
              <p className={`mt-5 text-sm ${plan.highlight ? 'text-white/90' : 'text-text-primary'}`}>
                <span className="figure font-medium">{plan.estimates}</span> estimates a month
              </p>
              {plan.annual && (
                <p className={`mt-1 text-xs ${plan.highlight ? 'text-white/60' : 'text-text-muted'}`}>
                  or <span className="figure">{plan.annual}</span> a year (two months free)
                </p>
              )}
              <ul className={`mt-5 flex-1 space-y-2.5 text-sm ${plan.highlight ? 'text-white/85' : 'text-text-secondary'}`} data-testid="plan-lines">
                {plan.lines.map((line) =>
                  line.live ? (
                    <li key={line.label} className="flex gap-2" data-testid="plan-line" data-live="true">
                      <span aria-hidden="true" className={plan.highlight ? 'text-white/60' : 'text-secondary'}>✓</span>
                      {/* T-167: these two are shown, not only told: they open the live demo */}
                      {line.label === PRICING_DEMO_LINKS.hostedPages || line.label === PRICING_DEMO_LINKS.branding ? (
                        <Link href={PRICING_DEMO_LINKS.href} className="underline underline-offset-2" data-testid="plan-demo-link">
                          {line.label}
                        </Link>
                      ) : (
                        line.label
                      )}
                    </li>
                  ) : (
                    // not live yet: no tick, and the words say so (a mark that is a shape, and words, never colour alone)
                    <li key={line.label} className="flex gap-2" data-testid="plan-line" data-live="false">
                      <span aria-hidden="true" className={plan.highlight ? 'text-white/60' : 'text-text-muted'}>○</span>
                      <span>
                        {line.label}{' '}
                        <span className={`ml-1 inline-block whitespace-nowrap rounded-full border px-2 text-xs font-semibold ${plan.highlight ? 'border-white/60 text-white' : 'border-field text-text-secondary'}`} data-testid="coming-later">
                          {COMING_LATER}
                        </span>
                      </span>
                    </li>
                  )
                )}
              </ul>
              <Link
                href={`/signup?plan=${def.id}`}
                className={`mt-8 rounded-lg py-3 text-center text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? 'bg-white text-primary hover:bg-mint'
                    : 'bg-primary text-white hover:bg-primary-hover'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
            )
          })}
        </div>
        <p className="mt-8 text-center text-xs text-text-muted">
          Prices in USD, excluding sales tax. Change or cancel your plan anytime from billing.
        </p>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary">
          Questions, answered plainly.
        </h2>
        <div className="mt-10 space-y-8">
          {FAQS.map((faq) => (
            <div key={faq.q}>
              <h3 className="font-display text-base font-bold text-text-primary">{faq.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 pb-20 text-center">
        <div className="tape-rule mb-10" />
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-text-primary">
          Try it on your own pricing.
        </h2>
        <p className="mt-3 text-text-secondary">
          Describe your rates in plain English and send yourself a test quote — it takes about 5 minutes.
        </p>
        <Link href="/signup" className={`${MAIN_CTA} mt-6`} data-cta="main">
          {freeOfferLabel()}
        </Link>
      </section>

      <SiteFooter />
    </main>
  )
}
