import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { freeOfferLabel, PRODUCT_NAME } from '@estimator/shared'

export const metadata: Metadata = {
  title: `Features — ${PRODUCT_NAME}`,
  description:
    'How customers get an estimate from your prices at once: your quote link, guided questions and photos, your own price list, and an estimate page you confirm before they accept.',
}

/**
 * The page follows the product's actual steps, from a customer's request to an
 * accepted quote. T-154: plain words only; every claim matches the live
 * product (no grades, no engine words, no "exact").
 */
const STAGES = [
  {
    number: '01',
    name: 'Ask',
    headline: 'Meet the customer where they already are.',
    body: 'Share your own quote link and QR code, send it in WhatsApp, or add it to your website as a step-by-step form or a chat. Each service asks only the questions that set its price, and asks for the photos it needs, with checks that catch blurry or dark shots before they waste anyone’s time.',
    details: [
      'Your quote link and QR code, no website needed',
      'On your website: a step-by-step form or a chat',
      'Questions and photo checklists per service',
      'Contact details first, so a half-finished request is still your lead',
    ],
  },
  {
    number: '02',
    name: 'Read the job',
    headline: 'It reads the details that set your price.',
    body: 'The AI reads what matters from the answers and photos: how many rooms, the size on a rating plate, the capacity on a tank label, the wall area of a house. When something isn’t clear, it doesn’t guess: the customer sees a range and is asked one quick question.',
    details: [
      'Sizes read from labels and rating plates',
      'Rooms, fixtures and quantities from the customer’s answers',
      'A range and one question when something is unclear',
      'You see how every quantity was worked out',
    ],
  },
  {
    number: '03',
    name: 'Price',
    headline: 'Plain English in. Your prices out.',
    body: 'You describe your pricing the way you’d tell a new hire: “$375 per room, heavy prep adds $250, minimum job $400.” It becomes your price list, shown back to you in plain English. The AI reads the job; the price only ever comes from the prices you set. Change a price by typing a sentence; the next estimate uses it.',
    details: [
      'Plain-English price setup, no formulas to learn',
      'Extras, adjustments, minimums and service areas',
      'Ready-made templates for common trades',
      'Every estimate’s working visible in your dashboard',
    ],
  },
  {
    number: '04',
    name: 'Confirm',
    headline: 'An estimate page, and you have the last word.',
    body: 'Your customer gets a page in your branding with the estimate for their job, straight away. By default they can accept once you’ve confirmed it: one tap on Approve & send. You choose per service: show the estimate and confirm, hold it until you approve, or send automatically. They can accept, ask a question or decline, and it shows in your dashboard straight away.',
    details: [
      'Estimate page in your branding, with a PDF',
      'Three ways to send, chosen per service',
      'Accept, ask a question or decline, shown in your dashboard',
      'Expiry and one polite reminder, automatically',
    ],
  },
  {
    number: '05',
    name: 'Learn',
    headline: 'Your corrections improve the next estimate.',
    body: 'When you correct an estimate or a customer confirms a measurement, that service’s future estimates use it. Your dashboard shows which services win work and where requests stall, and, if you opt in, how your prices compare with similar businesses.',
    details: [
      'Learns from your own corrections, per service',
      'Requests, estimates sent, accepted and value',
      'Opt-in, anonymised price comparisons',
      'Unfinished requests listed with call and email buttons',
    ],
  },
]

export default function FeaturesPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      <section className="mx-auto max-w-4xl px-4 pb-8 pt-12 text-center sm:px-6 sm:pt-16">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">
          From a customer’s question to a yes.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
          Five steps between a request and an accepted quote. {PRODUCT_NAME} runs them, in your prices, and you
          confirm before your customer accepts.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="space-y-20">
          {STAGES.map((stage) => (
            <div key={stage.number}>
              <div className="tape-rule" />
              <div className="mt-8 grid items-start gap-8 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <p className="figure text-sm text-tape">{stage.number}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-text-muted">
                    {stage.name}
                  </p>
                  <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-text-primary sm:text-3xl">
                    {stage.headline}
                  </h2>
                </div>
                <div className="lg:col-span-3">
                  <p className="leading-relaxed text-text-secondary">{stage.body}</p>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {stage.details.map((detail) => (
                      <li
                        key={detail}
                        className="rounded-warm-lg border border-border bg-white px-4 py-3 text-sm text-text-primary"
                      >
                        {detail}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary py-16 text-white">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">
            See it price one of your jobs.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">
            The fastest way to judge it: set up your prices and send yourself a test quote.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/signup"
              className="rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-mint"
            >
              {freeOfferLabel()}
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-white/30 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
