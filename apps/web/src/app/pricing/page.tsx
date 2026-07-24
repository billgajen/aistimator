import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

export const metadata: Metadata = {
  title: 'Pricing — Aistimator',
  description:
    'Simple monthly plans for service businesses. Start free with 50 estimates — no card required. Every plan includes the widget, WhatsApp, hosted quote pages and PDFs.',
}

// Keep in sync with the seeded `plans` table (supabase/seed.sql).
const PLANS = [
  {
    name: 'Starter',
    price: '$29',
    estimates: '200',
    overage: '$0.50',
    tagline: 'For getting off voicemail',
    features: ['Website widget & AI chat', 'WhatsApp quoting', 'Hosted quote pages & PDFs', 'Email notifications'],
    highlight: false,
  },
  {
    name: 'Growth',
    price: '$79',
    estimates: '1,000',
    overage: '$0.40',
    tagline: 'For a steady pipeline',
    features: ['Everything in Starter', 'Your branding on every quote', 'Lower overage rate'],
    highlight: true,
  },
  {
    name: 'Pro',
    price: '$199',
    estimates: '3,000',
    overage: '$0.30',
    tagline: 'For serious volume',
    features: ['Everything in Growth', 'Priority support', 'API access', 'Lowest overage rate'],
    highlight: false,
  },
]

const FAQS = [
  {
    q: 'What counts as an estimate?',
    a: 'One customer enquiry that produces a quote — however many photos, questions or revisions it takes. Failed or spam submissions don’t count.',
  },
  {
    q: 'What happens when I hit my monthly limit?',
    a: 'On a paid plan, extra estimates simply continue at your plan’s per-estimate overage rate, metered on your monthly bill. You’ll see usage warnings in your dashboard well before that.',
  },
  {
    q: 'Does the AI decide my prices?',
    a: 'No — this is the one rule we never break. The AI measures the job; the price is calculated from rates you configure. You can review every quote before it sends if you want to.',
  },
  {
    q: 'How does the free start work?',
    a: 'Your first 50 estimates are free, no card required. Pick a plan whenever you’re ready — your setup and quote history carry straight over.',
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
          Every plan includes everything — the widget, WhatsApp, quote pages, PDFs. Plans differ
          only in how many estimates you send.
        </p>
        <p className="mt-3 text-sm text-text-muted">
          Start free with 50 estimates. No card required.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
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
              <p className={`mt-1 text-xs ${plan.highlight ? 'text-white/60' : 'text-text-muted'}`}>
                then <span className="figure">{plan.overage}</span> per extra estimate
              </p>
              <ul className={`mt-5 flex-1 space-y-2.5 text-sm ${plan.highlight ? 'text-white/85' : 'text-text-secondary'}`}>
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className={plan.highlight ? 'text-white/60' : 'text-secondary'}>✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-8 rounded-lg py-3 text-center text-sm font-semibold transition-colors ${
                  plan.highlight
                    ? 'bg-white text-primary hover:bg-mint'
                    : 'bg-primary text-white hover:bg-primary-hover'
                }`}
              >
                Start free
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-text-muted">
          Prices exclude tax. Overage is metered monthly on paid plans only.
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
          Start free
        </Link>
      </section>

      <SiteFooter />
    </main>
  )
}
