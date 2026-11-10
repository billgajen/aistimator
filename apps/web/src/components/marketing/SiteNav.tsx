import Link from 'next/link'
import { MetaPixel } from './MetaPixel'
import { MobileMenu } from './MobileMenu'
import { NAV_LINKS } from '@/lib/marketing/nav'
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
          <Link
            href="/signup"
            className="max-w-[9.5rem] rounded-lg bg-primary px-3 py-2 text-center text-[13px] font-semibold leading-tight text-white transition-colors hover:bg-primary-hover sm:max-w-none sm:px-4 sm:text-sm"
          >
            {freeOfferLabel()}
          </Link>
          <MobileMenu />
        </div>
      </div>
    </nav>
  )
}
