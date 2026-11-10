import Link from 'next/link'
import { MetaPixel } from './MetaPixel'
import { freeOfferLabel } from '@estimator/shared'

/**
 * Marketing site navigation — shared across all public pages.
 */
export function SiteNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background">
      {/* T-144: marketing pages only (SiteNav is never rendered in the app or on quote pages) */}
      <MetaPixel />
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-lg font-extrabold tracking-tight text-text-primary"
        >
          Aistimator
        </Link>

        <div className="hidden items-center gap-6 sm:flex">
          <Link href="/features" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
            Features
          </Link>
          <Link href="/pricing" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
            Pricing
          </Link>
          <Link href="/trades" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
            Trades
          </Link>
        </div>

        <div className="flex items-center gap-1 sm:gap-3">
          <Link
            href="/login"
            className="whitespace-nowrap px-2 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary sm:px-3"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="max-w-[9.5rem] rounded-lg bg-primary px-3 py-1.5 text-center text-[13px] font-semibold leading-tight text-white transition-colors hover:bg-primary-hover sm:max-w-none sm:px-4 sm:py-2 sm:text-sm"
          >
            {freeOfferLabel()}
          </Link>
        </div>
      </div>
    </nav>
  )
}
