import Link from 'next/link'
import { MetaPixel } from './MetaPixel'
import { MobileMenu } from './MobileMenu'
import { NAV_LINKS, HEADER_SHORT_CTA } from '@/lib/marketing/nav'
import { freeOfferLabel, PRODUCT_NAME } from '@estimator/shared'

/**
 * Marketing site navigation — shared across all public pages.
 * T-154: a working menu on small screens (MobileMenu).
 */
export function SiteNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background" aria-label="Site">
      {/* T-144: marketing pages only (SiteNav is never rendered in the app or on quote pages) */}
      <MetaPixel />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="inline-flex min-h-[44px] items-center font-display text-lg font-extrabold tracking-tight text-text-primary">
          {PRODUCT_NAME}
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.filter((l) => l.href !== '/login').map((l) => (
            <Link key={l.href} href={l.href} className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden whitespace-nowrap px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary md:inline"
          >
            Log in
          </Link>
          {/* T-155: below md the header says only "Try it free", on one line */}
          <Link
            href="/signup"
            className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            data-testid="nav-signup"
          >
            <span className="md:hidden">{HEADER_SHORT_CTA}</span>
            <span className="hidden md:inline">{freeOfferLabel()}</span>
          </Link>
          <MobileMenu />
        </div>
      </div>
    </nav>
  )
}
