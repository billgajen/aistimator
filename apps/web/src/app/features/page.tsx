import Link from 'next/link'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

export const metadata: Metadata = {
  title: 'Features — Aistimator',
  description:
    'How Aistimator turns customer photos into professional quotes: guided capture, reference-anchored measurement, deterministic pricing from your rates, and quote pages that close.',
}

/**
 * The page follows the product's actual pipeline — each stage is a real
 * step in how an enquiry becomes an accepted quote, so the numbering
 * carries information, not decoration.
 */
const STAGES = [
  {
    number: '01',
    name: 'Capture',
    headline: 'Meet the customer where they already are.',
    body: 'Your website gets an embeddable widget — a guided step-by-step form or an AI chat that feels like texting, inline on the page or behind a floating button. WhatsApp customers just message your number. Either way, guided photo capture asks for exactly the shots the job needs — every room from the doorway, every elevation ground-to-roof — with quality checks that catch blurry or dark photos before they waste anyone’s time.',
    details: [
      'Step-by-step form or conversational AI chat',
      'Floating button or inline embed — one script tag',
      'WhatsApp intake with photos, in the chat',
      'Per-service photo checklists with quality checks',
    ],
  },
  {
    number: '02',
    name: 'Measure',
    headline: 'Measured against things with known sizes.',
    body: 'The AI doesn’t guess areas — it anchors measurements to references in the photo with known dimensions: doors, bricks, standard fittings. Each job is measured in multiple independent passes; when the passes agree, confidence is high, and when they don’t, the spread becomes an honest range. Big jobs are escalated to a stronger model automatically, and when a number genuinely matters to the price, the customer confirms it in one tap.',
    details: [
      'Reference-anchored measurement from photos',
      'Multiple passes — variance becomes the range',
      'Bigger jobs escalate to a senior model',
      'In-flow confirmation for numbers that matter',
    ],
  },
  {
    number: '03',
    name: 'Price',
    headline: 'Plain English in. Your rates out. Every time.',
    body: 'You describe your pricing the way you’d tell an apprentice: “£220 per room, heavy prep adds £80, minimum job £350.” That becomes your pricing engine — deterministic, auditable, yours. The AI extracts quantities and drafts wording, but the arithmetic is done by code from your configuration. Change a rate by typing a sentence; the next quote uses it.',
    details: [
      'Plain-language pricing setup — no formulas to learn',
      'Deterministic engine: same inputs, same price',
      'Addons, multipliers, minimums and service areas',
      'Every calculation traceable in your dashboard',
    ],
  },
  {
    number: '04',
    name: 'Deliver',
    headline: 'A commercial document, not a text with a number.',
    body: 'Customers receive a hosted quote page in your branding: scope of works, measured quantities with the method shown, a grade that says how sure the measurement is, and a range around the total. They can accept in one tap, ask a question, or decline with a reason — and you’re notified the moment any of it happens. A PDF version is generated for the paper trail, quotes expire on schedule, and one polite reminder goes out automatically.',
    details: [
      'Hosted quote page with your branding + PDF',
      'Measurement grades: Confirmed / Measured / Concept',
      'One-tap accept, decline, questions — you’re notified instantly',
      'Automatic expiry and a single follow-up reminder',
    ],
  },
  {
    number: '05',
    name: 'Learn',
    headline: 'Every job tunes the next one.',
    body: 'When you amend a quote or a measurement gets confirmed on site, that outcome feeds back into how your future jobs are measured. Your dashboard shows conversion by service, where quotes stall, and — if you opt in — how your rates compare to anonymised businesses like yours.',
    details: [
      'Per-service calibration from real outcomes',
      'Conversion analytics: sent → viewed → accepted',
      'Opt-in anonymised rate benchmarks',
      'Review thresholds you set and adjust anytime',
    ],
  },
]

export default function FeaturesPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />

      <section className="mx-auto max-w-4xl px-6 pb-8 pt-16 text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">
          From photos to a signed yes.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary">
          Five stages between an enquiry and an accepted quote. Aistimator runs all of them — you
          decide how much you want to watch.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-10">
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
            The fastest way to judge it: set up your rates and send yourself a quote.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/signup"
              className="rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-mint"
            >
              Start free
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
