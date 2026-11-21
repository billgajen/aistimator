import Link from 'next/link'
import type { Metadata } from 'next'
import { freeOfferLabel } from '@qolumns/shared'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { MAIN_CTA } from '@/lib/marketing/cta'
import { TRADES, tradeHref } from '@/lib/marketing/trades'
import { TEMPLATE_CARDS, cardServiceLine, WHO_CLOSING, WHO_FITS, WHO_HERO, WHO_META, WHO_OTHER, WHO_TEMPLATES } from '@/lib/marketing/who-its-for'
import { getPack } from '@/lib/vertical-packs'

/**
 * T-195: "Who it's for" (the URL stays /trades). Any business that prices jobs, with the templates as a
 * head start. Every word is data in lib/marketing/who-its-for.ts; a template's services are read from its
 * pack, and its card links to its trade page when it has one, otherwise to sign-up.
 */
export const metadata: Metadata = { title: WHO_META.title, description: WHO_META.description }

const WRAP = 'mx-auto max-w-container px-4 sm:px-6'
const CARD_LINK =
  'mt-4 inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2'

export default function WhoItsFor() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />

      <section className={`${WRAP} pb-14 pt-16 sm:pt-20`} data-testid="who-hero">
        <h1 className="max-w-3xl font-display text-4xl font-extrabold tracking-tight text-text-primary sm:text-5xl">{WHO_HERO.heading}</h1>
        <p className="mt-5 max-w-2xl text-lg text-text-secondary">{WHO_HERO.lede}</p>
      </section>

      <section className="border-t border-border bg-surface py-16" data-testid="who-fits">
        <div className={WRAP}>
          <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">{WHO_FITS.heading}</h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-3">
            {WHO_FITS.points.map((p) => (
              <li key={p.title} className="rounded-xl bg-white p-5 shadow-warm">
                <h3 className="font-semibold text-text-primary">{p.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{p.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-2xl text-sm text-text-muted">{WHO_FITS.quiet}</p>
        </div>
      </section>

      <section className="py-16" data-testid="who-templates">
        <div className={WRAP}>
          <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">{WHO_TEMPLATES.heading}</h2>
          <p className="mt-3 max-w-2xl text-text-secondary">{WHO_TEMPLATES.lede}</p>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_CARDS.map((card) => {
              const pack = getPack(card.packId)
              const page = TRADES.find((t) => t.packId === card.packId)
              // T-196: no line when it would only repeat the title; "·" never starts a line
              const services = cardServiceLine(card.label, (pack?.services ?? []).map((s) => s.name))
              return (
                <li key={card.packId} className="flex flex-col rounded-xl border border-border bg-white p-6" data-testid="template-card">
                  <h3 className="text-lg font-semibold text-text-primary">{card.label}</h3>
                  {services && (
                    <p className="mt-1 text-sm text-text-muted" data-testid="template-services">
                      {services}
                    </p>
                  )}
                  <p className="mt-3 text-sm text-text-secondary">{card.customer}</p>
                  <div className="mt-auto">
                    {page ? (
                      <Link href={tradeHref(page)} className={CARD_LINK}>
                        {WHO_TEMPLATES.seeHow}
                        <span className="sr-only">: {card.label}</span>
                      </Link>
                    ) : (
                      <Link href="/signup" className={CARD_LINK}>
                        {WHO_TEMPLATES.start}
                        <span className="sr-only">: {card.label}</span>
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section id={WHO_OTHER.id} className="scroll-mt-20 border-t border-border bg-mint py-16" data-testid="who-other">
        <div className={WRAP}>
          <h2 className="max-w-3xl font-display text-3xl font-bold tracking-tight text-text-primary">{WHO_OTHER.heading}</h2>
          <p className="mt-3 max-w-2xl text-text-secondary">{WHO_OTHER.text}</p>
          <ul className="mt-8 grid gap-6 sm:grid-cols-3">
            {WHO_OTHER.ways.map((w) => (
              <li key={w.title} className="rounded-xl bg-white p-5 shadow-warm" data-testid="add-way">
                <h3 className="font-semibold text-text-primary">{w.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{w.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm font-semibold text-text-primary">{WHO_OTHER.likeLabel}</p>
          <ul className="mt-3 flex max-w-3xl flex-wrap gap-2" data-testid="business-pills">
            {WHO_OTHER.like.map((b) => (
              <li key={b} className="inline-flex min-h-[36px] items-center rounded-full border border-field bg-white px-4 text-sm text-text-primary">
                {b}
              </li>
            ))}
          </ul>
          <Link href="/signup" className={`${MAIN_CTA} mt-8`} data-cta="main">
            {freeOfferLabel()}
          </Link>
        </div>
      </section>

      <section className="bg-primary py-16 text-white" data-testid="closing">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">{WHO_CLOSING.heading}</h2>
          <Link href="/signup" className={`${MAIN_CTA} mt-8`} data-cta="main">
            {freeOfferLabel()}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
