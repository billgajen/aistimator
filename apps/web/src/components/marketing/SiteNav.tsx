import Link from 'next/link'
import { MetaPixel } from './MetaPixel'

/**
 * Marketing site navigation — shared across all public pages.
 */
export function SiteNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background">
      {/* T-144: marketing pages only (SiteNav is never rendered in the app or on quote pages) */}
      <MetaPixel />
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
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
  )
}
