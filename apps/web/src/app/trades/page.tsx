import Link from 'next/link'
import type { Metadata } from 'next'
import { TRADES } from '@/lib/marketing/trades'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

export const metadata: Metadata = {
  title: 'Instant Estimates by Trade | Aistimator',
  description: 'Instant, evidence-backed estimates for HVAC, water heaters, plumbing, electrical, garage doors and painting.',
}

export default function TradesIndex() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20">
        <h1 className="text-center font-display text-4xl font-extrabold tracking-tight text-text-primary">Built for your trade</h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-text-secondary">
          Each trade starts from a ready-made template, with typical rates you make your own.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TRADES.map((t) => (
            <Link key={t.slug} href={t.slug === 'painting' ? '/painting' : `/trades/${t.slug}`} className="rounded-xl border border-border bg-surface p-6 transition-colors hover:border-border-strong">
              <p className="text-xs font-semibold uppercase tracking-widest text-secondary">{t.label}</p>
              <p className="mt-2 font-semibold text-text-primary">{t.headline}</p>
            </Link>
          ))}
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
