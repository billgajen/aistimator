import Link from 'next/link'
import { offeredPlans, formatMoney } from '@estimator/shared'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { MiniEstimate } from '@/components/marketing/MiniEstimate'

export const metadata: Metadata = {
  title: 'Aistimator — instant quotes for service businesses',
  description:
    'Customers send photos from your website or WhatsApp. Aistimator measures the job and prices it from your rates — a professional quote in about 60 seconds.',
}

const STEPS = [
  {
    number: '01',
    title: 'Customer sends photos',
    text: 'From the widget on your website or over WhatsApp. Guided capture asks for exactly the shots the job needs.',
  },
  {
    number: '02',
    title: 'AI measures the job',
    text: 'It counts rooms, estimates wall areas against known references, and asks the customer to confirm when it isn’t sure.',
  },
  {
    number: '03',
    title: 'Your rates set the price',
    text: 'The price is calculated from the rates you configured — deterministically. The AI never invents a number.',
  },
  {
    number: '04',
    title: 'Quote lands in 60 seconds',
    text: 'A professional quote page with your branding, a measured range, and one-tap accept. PDF included.',
  },
]

const FEATURES = [
  {
    title: 'Website widget, two ways',
    text: 'A guided step-by-step form or an AI chat that feels like texting — inline on your page or behind a floating button.',
  },
  {
    title: 'WhatsApp quoting',
    text: 'Customers message your number, answer a few questions, send photos. The quote link lands right in the chat.',
  },
  {
    title: 'Guided photo capture',
    text: 'Per-service photo checklists with quality checks, so the AI measures from shots that actually show the job.',
  },
  {
    title: 'A quote page, not a number',
    text: 'Scope, terms, measured quantities and your branding on a hosted page customers can accept, decline or question.',
  },
  {
    title: 'You stay in control',
    text: 'Set review thresholds, edit any quote before it goes out, and update rates by typing plain English.',
  },
  {
    title: 'It learns your numbers',
    text: 'Every amendment and won job calibrates future measurements against how you actually price.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />

      {/* Hero — the artifact is the argument */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 lg:grid-cols-2 lg:pt-24">
        <div className="animate-fade-in-up">
          <p className="text-sm font-semibold uppercase tracking-widest text-secondary">
            Instant quotes for service businesses
          </p>
          <h1 className="mt-4 font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-text-primary sm:text-6xl">
            The first quote
            <br />
            usually wins.
            <br />
            <span className="text-primary">Be first.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-text-secondary">
            Customers send photos from your website or WhatsApp. Aistimator measures the job and
            prices it from your rates —{' '}
            <span className="font-semibold text-text-primary">
              a professional quote in about 60 seconds.
            </span>
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/signup"
              className="rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              Start free
            </Link>
            <Link
              href="/demo"
              className="rounded-lg border border-border bg-surface px-8 py-3.5 text-sm font-semibold text-text-primary transition-colors hover:border-border-strong"
            >
              Try the live demo
            </Link>
          </div>
          <p className="mt-4 text-xs text-text-muted">
            {(() => { const t = offeredPlans().find((p) => p.trialDays); return t ? `${t.trialDays}-day free trial on ${t.name}` : 'Subscription only — no commission' })()} · about 5 minutes to set up
          </p>
        </div>

        <div className="animate-fade-in-up animation-delay-200 pt-6 lg:pt-0">
          <MiniEstimate />
        </div>
      </section>

      {/* Speed-to-lead — the verified numbers */}
      <section className="bg-primary py-16 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
            Most of your competitors never reply at all.
          </h2>
          <div className="mt-12 grid gap-10 text-center sm:grid-cols-3">
            <div>
              <p className="figure text-5xl font-medium">40%</p>
              <div className="tape-rule-light mx-auto mt-3 w-16" />
              <p className="mx-auto mt-3 max-w-[220px] text-sm text-white/70">
                of home-service businesses never respond to a lead at all
              </p>
            </div>
            <div>
              <p className="figure text-5xl font-medium">95%</p>
              <div className="tape-rule-light mx-auto mt-3 w-16" />
              <p className="mx-auto mt-3 max-w-[220px] text-sm text-white/70">
                miss the 5-minute window customers judge you by
              </p>
            </div>
            <div>
              <p className="figure text-5xl font-medium">21×</p>
              <div className="tape-rule-light mx-auto mt-3 w-16" />
              <p className="mx-auto mt-3 max-w-[220px] text-sm text-white/70">
                more likely to win the conversation when you reply in 5 minutes, not 30
              </p>
            </div>
          </div>
          <p className="mt-10 text-center text-xs text-white/50">
            Sources: Valve+Meter home-services audit (2024, n=466) · Lead Response Management Study
          </p>
        </div>
      </section>

      {/* How it works — a real sequence, numbered along the tape */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
          Photos in. Quote out.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-text-secondary">
          Four steps, none of them yours. You only step in when you want to.
        </p>
        <div className="tape-rule mt-12" />
        <div className="mt-8 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.number}>
              <p className="figure text-sm text-tape">{step.number}</p>
              <h3 className="mt-2 font-display text-lg font-bold text-text-primary">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The line that matters */}
      <section className="bg-mint py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid items-start gap-12 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
                Your price.
                <br />
                Never the AI&apos;s.
              </h2>
              <p className="mt-5 max-w-md text-text-secondary">
                You describe your pricing in plain English —{' '}
                <span className="font-medium text-text-primary">
                  &quot;£220 per room, heavy prep adds £80&quot;
                </span>{' '}
                — and it becomes your pricing engine. Every quote is calculated from those rates,
                every time, with the working shown.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="rounded-warm-xl bg-white p-6 shadow-warm-md">
                <p className="text-xs font-semibold uppercase tracking-widest text-secondary">
                  The AI does
                </p>
                <ul className="mt-4 space-y-2.5 text-sm text-text-secondary">
                  <li>Reads the photos</li>
                  <li>Counts rooms, measures walls</li>
                  <li>Spots prep work and access issues</li>
                  <li>Asks the customer when unsure</li>
                  <li>Drafts the scope wording</li>
                </ul>
              </div>
              <div className="rounded-warm-xl bg-white p-6 shadow-warm-md">
                <p className="text-xs font-semibold uppercase tracking-widest text-danger">
                  The AI never
                </p>
                <ul className="mt-4 space-y-2.5 text-sm text-text-secondary">
                  <li>Sets a price</li>
                  <li>Invents a rate</li>
                  <li>Offers a discount</li>
                  <li>Sends without your rules</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Measurement grades — butter/tape territory, legitimately */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <div className="flex items-center justify-center gap-8">
              {[
                { grade: 'A', label: 'Confirmed', color: 'var(--color-secondary)' },
                { grade: 'B', label: 'Measured', color: 'var(--color-tertiary)' },
                { grade: 'C', label: 'Concept', color: 'var(--color-text-muted)' },
              ].map(({ grade, label, color }) => (
                <div key={grade} className="text-center">
                  <div className="grade-seal" style={{ color }}>
                    <span className="font-display text-2xl font-bold leading-none">{grade}</span>
                    <span className="mt-1 text-[7px] font-semibold uppercase tracking-[0.14em]">
                      {label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mx-auto mt-8 max-w-sm rounded-warm-xl bg-butter p-5">
              <div className="flex items-baseline justify-between text-xs text-text-secondary">
                <span>Measured range</span>
                <span className="figure text-text-primary">£1,180 – £1,340</span>
              </div>
              <div className="relative mt-3 h-1.5 rounded-full bg-white/60">
                <div className="absolute inset-y-0 left-[20%] right-[25%] rounded-full bg-tape" />
              </div>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
              Estimates that know how sure they are.
            </h2>
            <p className="mt-5 max-w-md text-text-secondary">
              Every quote carries a measurement grade — Confirmed, Measured or Concept — and a
              range, so customers see an honest number instead of false precision. Photos are
              measured against references with known sizes, cross-checked in multiple passes, and
              escalated to a stronger model when the job is big enough to warrant it.
            </p>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="bg-surface py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
            Everything between the lead and the yes.
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-warm-xl bg-white p-6 shadow-warm">
                <h3 className="font-display text-base font-bold text-text-primary">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{feature.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center">
            <Link href="/features" className="text-sm font-semibold text-primary hover:text-primary-hover">
              See all features →
            </Link>
          </p>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">
          Priced like a tool, not a tax.
        </h2>
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
          {offeredPlans().map((def) => ({
            name: def.name,
            price: formatMoney((def.monthlyPrice.USD ?? 0) / 100, 'USD', 'en-US', { decimals: 0 }),
            estimates: def.quoteLimit.toLocaleString('en-US'),
            highlight: Boolean(def.recommended),
          })).map((plan) => (
            <div
              key={plan.name}
              className={`rounded-warm-xl p-6 text-center ${
                plan.highlight
                  ? 'bg-primary text-white shadow-warm-lg'
                  : 'border border-border bg-white'
              }`}
            >
              <p className={`text-sm font-semibold ${plan.highlight ? 'text-white/80' : 'text-text-secondary'}`}>
                {plan.name}
              </p>
              <p className="figure mt-2 text-3xl font-medium">{plan.price}</p>
              <p className={`mt-1 text-xs ${plan.highlight ? 'text-white/70' : 'text-text-muted'}`}>
                per month · {plan.estimates} estimates
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center">
          <Link href="/pricing" className="text-sm font-semibold text-primary hover:text-primary-hover">
            Compare plans →
          </Link>
        </p>
      </section>

      {/* Final CTA */}
      <section className="bg-primary py-20 text-white">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Your next lead is comparing quotes tonight.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/80">
            Set up in about 5 minutes: describe your pricing in plain English, drop the widget on
            your site, and the next enquiry gets a proper quote before you&apos;ve seen it.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-mint"
          >
            {(() => { const t = offeredPlans().find((p) => p.trialDays); return t ? `Start your ${t.trialDays}-day trial` : 'Get started' })()}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
