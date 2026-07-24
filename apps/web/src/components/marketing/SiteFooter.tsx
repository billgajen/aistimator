import Link from 'next/link'

/**
 * Marketing site footer — shared across all public pages.
 */
export function SiteFooter() {
  return (
    <footer className="mt-4">
      <div className="mx-auto max-w-6xl px-6">
        <div className="tape-rule" />
        <div className="grid gap-10 py-12 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <p className="font-display text-lg font-extrabold tracking-tight text-text-primary">
              Aistimator
            </p>
            <p className="mt-2 max-w-xs text-sm text-text-secondary">
              Instant, professional quotes for service businesses — measured by AI, priced by you.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Product</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/features" className="text-text-secondary transition-colors hover:text-text-primary">Features</Link></li>
              <li><Link href="/pricing" className="text-text-secondary transition-colors hover:text-text-primary">Pricing</Link></li>
              <li><Link href="/painting" className="text-text-secondary transition-colors hover:text-text-primary">For painters</Link></li>
              <li><Link href="/demo" className="text-text-secondary transition-colors hover:text-text-primary">Widget demo</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Company</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/login" className="text-text-secondary transition-colors hover:text-text-primary">Log in</Link></li>
              <li><Link href="/signup" className="text-text-secondary transition-colors hover:text-text-primary">Start free</Link></li>
              <li><Link href="/terms" className="text-text-secondary transition-colors hover:text-text-primary">Terms of service</Link></li>
              <li><Link href="/privacy" className="text-text-secondary transition-colors hover:text-text-primary">Privacy policy</Link></li>
            </ul>
          </div>
        </div>
        <p className="pb-8 text-xs text-text-muted">
          © {new Date().getFullYear()} Aistimator. The AI measures. You set the price.
        </p>
      </div>
    </footer>
  )
}
