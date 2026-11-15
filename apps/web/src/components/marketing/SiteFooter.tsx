import Link from 'next/link'
import { freeOfferLabel, PRODUCT_NAME } from '@qolumns/shared'
import { Wordmark } from '@/components/brand/Wordmark'
import { FOOTER } from '@/lib/marketing/site-copy'

/**
 * Marketing site footer — shared across all public pages.
 * T-165: on a phone each link is 44 px tall (a tap target); from `sm` up the
 * lists keep their tighter rhythm.
 */
const FOOT_LINK = 'inline-flex min-h-[44px] items-center text-text-secondary transition-colors hover:text-text-primary sm:min-h-0'
export function SiteFooter() {
  return (
    <footer className="mt-4">
      <div className="mx-auto max-w-6xl px-6">
        <div className="tape-rule" />
        <div className="grid gap-10 py-12 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <p>
              <Wordmark className="text-lg" />
            </p>
            <p className="mt-2 max-w-xs text-sm text-text-secondary">{FOOTER.tagline}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Product</p>
            <ul className="mt-3 text-sm sm:space-y-2">
              <li><Link href="/features" className={FOOT_LINK}>Features</Link></li>
              <li><Link href="/pricing" className={FOOT_LINK}>Pricing</Link></li>
              <li><Link href="/trades/hvac" className={FOOT_LINK}>HVAC</Link></li>
              <li><Link href="/trades/water-heaters" className={FOOT_LINK}>Water heaters</Link></li>
              <li><Link href="/trades/plumbing" className={FOOT_LINK}>Plumbing</Link></li>
              <li><Link href="/trades/electrical" className={FOOT_LINK}>Electrical</Link></li>
              <li><Link href="/trades/garage-doors" className={FOOT_LINK}>Garage doors</Link></li>
              <li><Link href="/painting" className={FOOT_LINK}>Painting</Link></li>
              <li><Link href="/demo" className={FOOT_LINK}>Try it as a customer</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Company</p>
            <ul className="mt-3 text-sm sm:space-y-2">
              <li><Link href="/login" className={FOOT_LINK}>Log in</Link></li>
              <li><Link href="/signup" className={FOOT_LINK}>{freeOfferLabel()}</Link></li>
              <li><Link href="/terms" className={FOOT_LINK}>Terms of service</Link></li>
              <li><Link href="/privacy" className={FOOT_LINK}>Privacy policy</Link></li>
            </ul>
          </div>
        </div>
        <p className="pb-8 text-xs text-text-muted">
          © {new Date().getFullYear()} {PRODUCT_NAME}. {FOOTER.closing}
        </p>
      </div>
    </footer>
  )
}
