import Link from 'next/link'
import { MetaPixel } from './MetaPixel'
import { FirstVisit } from './FirstVisit'
import { MobileMenu } from './MobileMenu'
import { NAV_LINKS, HEADER_SHORT_CTA } from '@/lib/marketing/nav'
import { Wordmark } from '@/components/brand/Wordmark'

/**
 * Marketing site navigation — shared across all public pages.
 * T-154: a working menu on small screens (MobileMenu).
 */
export function SiteNav() {
  return (
    <>
    {/* T-165: the first thing Tab reaches on every marketing page. It lands on
        the marker after the header, so it works without each page naming its
        content. */}
    <a
      href="#content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-text-primary focus:shadow-warm-lg"
      data-testid="skip-link"
    >
      Skip to content
    </a>
    <nav className="sticky top-0 z-40 border-b border-border bg-background" aria-label="Site">
      {/* T-144: marketing pages only (SiteNav is never rendered in the app or on quote pages) */}
      <MetaPixel />
      {/* T-189: notes this tab's first visit, for the sign-up form to send. No cookie. */}
      <FirstVisit />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="inline-flex min-h-[44px] items-center">
          <Wordmark height={28} />
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.filter((l) => l.href !== '/login').map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden min-h-[44px] items-center whitespace-nowrap px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary md:inline-flex"
          >
            Log in
          </Link>
          {/* T-165: the header button says only "Try it free" at every width, on one
              line. The full offer is the hero's (and each page's own) button. */}
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            data-testid="nav-signup"
          >
            {HEADER_SHORT_CTA}
          </Link>
          <MobileMenu />
        </div>
      </div>
    </nav>
    <span id="content" tabIndex={-1} className="block outline-none" />
    </>
  )
}
