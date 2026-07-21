import Link from 'next/link'
import type { Metadata } from 'next'

/**
 * Painting & Decorating landing page (T-114).
 *
 * Vertical-specific marketing built on the verified speed-to-lead numbers
 * (see Docs/06-v2-strategy.md §1 — only stats that survived verification).
 */

export const metadata: Metadata = {
  title: 'Instant Painting & Decorating Quotes — Estimator',
  description:
    'Give customers an instant painting quote from photos — priced by your rates, never AI guesses. On your website and WhatsApp. Set up in 5 minutes.',
}

const STEPS = [
  {
    number: '1',
    title: 'Customer sends photos',
    text: 'Guided capture asks for exactly the shots you need — every room from the doorway, every elevation ground-to-roof.',
  },
  {
    number: '2',
    title: 'AI counts and measures',
    text: 'Rooms counted, wall areas estimated, prep work spotted from cracks and flaking — and the customer confirms the numbers in one tap.',
  },
  {
    number: '3',
    title: 'Your rates set the price',
    text: 'Your per-room and per-square-metre rates price the job deterministically. The AI never invents a number.',
  },
  {
    number: '4',
    title: 'Quote delivered in 60 seconds',
    text: 'A professional quote page with your branding, scope and terms — ready to accept while your competitors are still checking voicemail.',
  },
]

const FEATURES = [
  {
    title: 'Per-room interior pricing',
    text: 'Walls & ceilings priced per room, heavy prep added automatically when photos show poor surfaces.',
  },
  {
    title: 'Wall-area estimation for exteriors',
    text: 'Send elevation photos, get square-metre pricing — no site visit for the estimate.',
  },
  {
    title: 'Upsells built in',
    text: 'Woodwork, feature walls, gutters & fascias offered automatically when customers mention them.',
  },
  {
    title: 'WhatsApp quoting',
    text: 'Customers message your WhatsApp number, answer a few questions, send photos — quote link lands in the chat.',
  },
  {
    title: 'You stay in control',
    text: 'Set review thresholds, edit any quote before it sends, and watch amendment patterns tune your rates over time.',
  },
  {
    title: '5-minute setup',
    text: 'Start from the decorator template — interior, exterior and wallpapering pre-configured with typical rates you adjust to yours.',
  },
]

export default function PaintingLandingPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-display text-lg font-extrabold tracking-tight text-text-primary">
            Estimator
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-3 py-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              Start free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-secondary">
          For painters &amp; decorators
        </p>
        <h1 className="font-display text-5xl font-extrabold leading-tight tracking-tight text-text-primary sm:text-6xl">
          Quote every job
          <br />
          in 60 seconds.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
          Customers send photos from your website or WhatsApp. AI counts the rooms and measures the
          walls. <span className="font-semibold text-text-primary">Your rates set the price — never the AI.</span>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Start free — 5 minute setup
          </Link>
          <Link
            href="/demo"
            className="rounded-lg border border-border bg-surface px-8 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-border-strong"
          >
            Try the live demo
          </Link>
        </div>
      </section>

      {/* Speed-to-lead stats (verified sources only) */}
      <section className="border-y border-border bg-primary py-14 text-white">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-display text-2xl font-bold">
            The first quote usually wins the job.
          </h2>
          <div className="mt-10 grid gap-8 text-center sm:grid-cols-3">
            <div>
              <p className="font-display text-5xl font-extrabold">40%</p>
              <p className="mt-2 text-sm text-white/70">
                of home-service businesses never respond to a lead at all
              </p>
            </div>
            <div>
              <p className="font-display text-5xl font-extrabold">95%</p>
              <p className="mt-2 text-sm text-white/70">
                miss the 5-minute window that customers judge you by
              </p>
            </div>
            <div>
              <p className="font-display text-5xl font-extrabold">21×</p>
              <p className="mt-2 text-sm text-white/70">
                more likely to win the conversation when you respond in 5 minutes instead of 30
              </p>
            </div>
          </div>
          <p className="mt-8 text-center text-xs text-white/50">
            Sources: Valve+Meter home-services audit (2024, n=466) · Lead Response Management Study
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary">
          How it works
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {STEPS.map((step) => (
            <div key={step.number} className="rounded-xl border border-border bg-surface p-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-white">
                {step.number}
              </span>
              <h3 className="mt-3 font-semibold text-text-primary">{step.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust: deterministic pricing */}
      <section className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">
            Your price. Never the AI&apos;s.
          </h2>
          <p className="mt-4 text-text-secondary">
            AI measures and describes — it never sets a price. Every quote is calculated from the
            rates you configure, shown to you in plain English, and adjustable any time by just
            telling the system: <span className="font-medium text-text-primary">&quot;raise my room rate to £220&quot;</span>.
            When the AI isn&apos;t sure, customers confirm the numbers before pricing — or the quote
            waits for your approval. Your call, always.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary">
          Built for decorating businesses
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-border p-5">
              <h3 className="font-semibold text-text-primary">{feature.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">
            Be the decorator who quotes first.
          </h2>
          <p className="mt-3 text-text-secondary">
            Free to start. The decorator template sets you up in about 5 minutes — interior,
            exterior and wallpapering, with typical rates you make your own.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            Start quoting today
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 text-center text-xs text-text-muted">
        Powered by Estimator — instant quotes for service businesses
      </footer>
    </main>
  )
}
