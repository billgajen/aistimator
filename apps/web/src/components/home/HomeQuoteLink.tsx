'use client'

import Link from 'next/link'
import { QUOTE_TURN_COPY } from '@estimator/shared'
import { useCopy } from '@/components/share/useCopy'

/**
 * T-160: "Your quote link" on Home — the link with Copy and Open, and a way
 * to the Quote link page for the QR code and the website form. Copy is the
 * same action as on that page (it also ticks "Share your quote link").
 */
export function HomeQuoteLink({ link }: { link: string }) {
  const Q = QUOTE_TURN_COPY.home.quoteLink
  const { copy, copiedId } = useCopy()
  return (
    <section className="min-w-0 rounded-warm-xl bg-white p-6 shadow-warm-md" data-testid="home-quote-link">
      <h2 className="mb-3 font-display text-lg font-bold text-text-primary">{Q.title}</h2>
      <code className="block truncate rounded-warm-lg border border-border bg-background px-3.5 py-2.5 text-sm text-text-primary" data-testid="home-quote-link-url">
        {link}
      </code>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => copy('home-link', link)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover"
        >
          {copiedId === 'home-link' ? Q.copied : Q.copy}
        </button>
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface"
        >
          {Q.open}
        </a>
      </div>
      <Link href="/app/quote-link" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
        {Q.more}
      </Link>
    </section>
  )
}
