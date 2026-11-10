import Link from 'next/link'
import { freeOfferLabel } from '@estimator/shared'

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
              <li><Link href="/trades/hvac" className="text-text-secondary transition-colors hover:text-text-primary">HVAC</Link></li>
              <li><Link href="/trades/water-heaters" className="text-text-secondary transition-colors hover:text-text-primary">Water heaters</Link></li>
              <li><Link href="/trades/plumbing" className="text-text-secondary transition-colors hover:text-text-primary">Plumbing</Link></li>
              <li><Link href="/trades/electrical" className="text-text-secondary transition-colors hover:text-text-primary">Electrical</Link></li>
              <li><Link href="/trades/garage-doors" className="text-text-secondary transition-colors hover:text-text-primary">Garage doors</Link></li>
              <li><Link href="/painting" className="text-text-secondary transition-colors hover:text-text-primary">Painting</Link></li>
              <li><Link href="/demo" className="text-text-secondary transition-colors hover:text-text-primary">Try it as a customer</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Company</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/login" className="text-text-secondary transition-colors hover:text-text-primary">Log in</Link></li>
              <li><Link href="/signup" className="text-text-secondary transition-colors hover:text-text-primary">{freeOfferLabel()}</Link></li>
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
