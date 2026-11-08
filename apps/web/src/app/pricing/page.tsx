import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { offeredPlans, formatMoney, type PlanDefinition, type PlanChannel } from '@estimator/shared'

export const metadata: Metadata = {
  title: 'Pricing — Aistimator',
  description:
    'Simple monthly plans for service businesses. Instant estimates on your website, by text and on site — in your own prices.',
}

// T-134: every number on this page comes from the plan definitions
// (packages/shared/src/plans.ts) — nothing is duplicated here.
const OFFERED = offeredPlans()
const TRIAL_PLAN = OFFERED.find((p) => p.trialDays)

const CHANNEL_LABEL: Record<PlanChannel, string> = {
  widget: 'Website widget & AI chat',
  sms: 'Quoting by text (SMS)',
  whatsapp: 'WhatsApp quoting',
  mobile_app: 'On-site app for your phone',
}

function planBullets(plan: PlanDefinition): string[] {
  const bullets = [...plan.channels.map((c) => CHANNEL_LABEL[c]), 'Hosted estimate pages & PDFs']
  if (plan.features.custom_branding) bullets.push('Your branding on every estimate')
  if (plan.features.calibration_insights) bullets.push('Accuracy insights from finished jobs')
  if (plan.features.lidar_scanning) bullets.push('LiDAR room scanning for exact prices')
  if (plan.features.multiple_users) bullets.push('Multiple team members')
  if (plan.features.priority_support) bullets.push('Priority support')
  return bullets
}

const dollars = (cents: number) => formatMoney(cents / 100, 'USD', 'en-US', { decimals: cents % 100 === 0 ? 0 : 2 })

const FAQS = [
  {
    q: 'What counts as an estimate?',
    a: 'One customer enquiry that produces a quote — however many photos, questions or revisions it takes. Failed or spam submissions don’t count.',
  },
  {
    q: 'What happens when I hit my monthly limit?',
    a: 'You never lose a customer. New requests are saved as leads and the customer is told you’ll send their estimate shortly; you can upgrade and price them with one click. There are no surprise per-estimate charges. You’ll see a warning in your dashboard at 80%.',
  },
  {
    q: 'Does the AI decide my prices?',
    a: 'No — this is the one rule we never break. The AI measures the job; the price is calculated from rates you configure. You can review every quote before it sends if you want to.',
  },
  {
    q: 'How does the free trial work?',
    a: TRIAL_PLAN
      ? `${TRIAL_PLAN.name} comes with a ${TRIAL_PLAN.trialDays}-day free trial. A card is required to start; you won’t be charged until the trial ends, and you can cancel before then.`
      : 'Pick a plan when you’re ready — your setup and quote history carry straight over.',
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
        <p className="mx-auto mt-4 max-w-xl text-lg text-text-secondary">
          Instant estimates in your own prices — on your website, by text, and on site. Subscription only:
          no commission, no per-lead fees.
        </p>
        {TRIAL_PLAN && (
          <p className="mt-3 text-sm text-text-muted">
            {TRIAL_PLAN.trialDays}-day free trial on {TRIAL_PLAN.name}. Pay yearly, get two months free.
          </p>
        )}
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-6 lg:grid-cols-3">
          {OFFERED.map((def) => {
            const plan = {
              name: def.name,
              tagline: def.tagline,
              price: dollars(def.monthlyPrice.USD ?? 0),
              estimates: def.quoteLimit.toLocaleString('en-US'),
              features: planBullets(def),
              highlight: Boolean(def.recommended),
              cta: def.trialDays ? `Start ${def.trialDays}-day trial` : `Choose ${def.name}`,
              annual: def.annualPrice?.USD ? dollars(def.annualPrice.USD) : null,
            }
            return (
            <div
              key={def.id}
              className={`relative flex flex-col rounded-warm-2xl p-8 ${
                plan.highlight
                  ? 'bg-primary text-white shadow-warm-lg'
                  : 'border border-border bg-white shadow-warm'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-tape px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink">
                  Most popular
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
              <ul className={`mt-5 flex-1 space-y-2.5 text-sm ${plan.highlight ? 'text-white/85' : 'text-text-secondary'}`}>
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className={plan.highlight ? 'text-white/60' : 'text-secondary'}>✓</span>
                    {feature}
                  </li>
                ))}
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
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          {TRIAL_PLAN ? `Start your ${TRIAL_PLAN.trialDays}-day trial` : 'Get started'}
        </Link>
      </section>

      <SiteFooter />
    </main>
  )
}
