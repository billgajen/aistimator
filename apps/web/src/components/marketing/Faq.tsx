import Link from 'next/link'

export interface FaqItem {
  q: string
  a: string
  link?: { href: string; label: string }
}

/**
 * T-187: the questions of a marketing page, one component for Home and
 * Pricing. A centred column: the heading in the middle, each question a row
 * that opens (the browser's own disclosure, so it works with no script and
 * from the keyboard). A row is 52 px tall: a tap target on a phone.
 */
export function Faq({ heading, items, testId = 'faq' }: { heading: string; items: readonly FaqItem[]; testId?: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{heading}</h2>
      <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-white text-left" data-testid={testId}>
        {items.map((item) => (
          <details key={item.q} className="group px-5">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-text-primary">
              {item.q}
              <span className="text-text-muted transition-transform group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="pb-4 text-sm text-text-secondary">
              {item.a}
              {item.link ? (
                <>
                  {' '}
                  <Link href={item.link.href} className="font-semibold text-primary underline underline-offset-2">
                    {item.link.label}
                  </Link>
                </>
              ) : null}
            </p>
          </details>
        ))}
      </div>
    </div>
  )
}
