import Link from 'next/link'
import { PRODUCT_NAME, SUPPORT_EMAIL, freeOfferLabel, operatorLine } from '@qolumns/shared'
import { Wordmark } from '@/components/brand/Wordmark'
import { DATA_DELETION, FOOTER } from '@/lib/marketing/site-copy'
import { TRADES, tradeHref } from '@/lib/marketing/trades'

/**
 * Marketing site footer, shared across all public pages.
 *
 * T-187 (the owner's review): the wordmark and one short line that says what
 * the product is; four columns of links (Product, Trades, Company, Legal);
 * the support address; and who runs it (the company, its number from
 * NEXT_PUBLIC_COMPANY_NUMBER, where it is registered: the sentence the Terms
 * and the Privacy Policy carry). The message line is no longer repeated here.
 *
 * T-165: on a phone each link is 44 px tall (a tap target); from `sm` up the
 * lists keep their tighter rhythm.
 */
const FOOT_LINK = 'inline-flex min-h-[44px] items-center text-text-secondary transition-colors hover:text-text-primary sm:min-h-[24px]'
const COLUMN_TITLE = 'text-xs font-semibold uppercase tracking-widest text-text-muted'

export function SiteFooter() {
  const L = FOOTER.links
  return (
    <footer className="mt-4" data-testid="site-footer">
      <div className="mx-auto max-w-container px-4 sm:px-6">
        <div className="tape-rule" />
        <div className="grid gap-10 py-12 lg:grid-cols-[minmax(0,18rem)_1fr] lg:gap-16">
          <div>
            <p>
              <Wordmark className="text-xl" />
            </p>
            <p className="mt-2 max-w-xs text-sm text-text-secondary" data-testid="footer-line">
              {FOOTER.line}
            </p>
            <p className="mt-4 text-sm text-text-secondary">
              {FOOTER.support}{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-flex min-h-[44px] items-center font-semibold text-primary underline underline-offset-2 sm:min-h-[24px]" data-testid="footer-support">
                {SUPPORT_EMAIL}
              </a>
            </p>
          </div>

          <nav className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4" aria-label="Footer" data-testid="footer-columns">
            <div>
              <p className={COLUMN_TITLE}>{FOOTER.columns.product}</p>
              <ul className="mt-3 text-sm sm:space-y-2">
                <li><Link href="/features" className={FOOT_LINK}>{L.features}</Link></li>
                <li><Link href="/pricing" className={FOOT_LINK}>{L.pricing}</Link></li>
                <li><Link href="/demo" className={FOOT_LINK}>{L.demo}</Link></li>
                <li><Link href="/signup" className={FOOT_LINK}>{freeOfferLabel()}</Link></li>
              </ul>
            </div>
            <div>
              <p className={COLUMN_TITLE}>{FOOTER.columns.trades}</p>
              <ul className="mt-3 text-sm sm:space-y-2">
                {TRADES.map((trade) => (
                  <li key={trade.slug}><Link href={tradeHref(trade)} className={FOOT_LINK}>{trade.label}</Link></li>
                ))}
                <li><Link href="/trades" className={FOOT_LINK}>{L.allTrades}</Link></li>
              </ul>
            </div>
            <div>
              <p className={COLUMN_TITLE}>{FOOTER.columns.company}</p>
              <ul className="mt-3 text-sm sm:space-y-2">
                <li><Link href="/login" className={FOOT_LINK}>{L.logIn}</Link></li>
                <li><a href={`mailto:${SUPPORT_EMAIL}`} className={FOOT_LINK}>{L.contact}</a></li>
              </ul>
            </div>
            <div>
              <p className={COLUMN_TITLE}>{FOOTER.columns.legal}</p>
              <ul className="mt-3 text-sm sm:space-y-2">
                <li><Link href="/terms" className={FOOT_LINK}>{L.terms}</Link></li>
                <li><Link href="/privacy" className={FOOT_LINK}>{L.privacy}</Link></li>
                <li><Link href={DATA_DELETION.href} className={FOOT_LINK}>{DATA_DELETION.label}</Link></li>
              </ul>
            </div>
          </nav>
        </div>
        <p className="border-t border-border py-6 text-xs text-text-muted" data-testid="footer-company">
          © {new Date().getFullYear()} {PRODUCT_NAME}. {operatorLine(process.env.NEXT_PUBLIC_COMPANY_NUMBER)}
        </p>
      </div>
    </footer>
  )
}
