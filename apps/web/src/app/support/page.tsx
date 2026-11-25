import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { DATA_DELETION_PATH, PRODUCT_NAME, SUPPORT_EMAIL } from '@qolumns/shared'

/**
 * T-205: how to get help, on a page of its own.
 *
 * Apple asks every app for a "Support URL": a page a person can open without
 * signing in, that says how to reach us. This is it, and the website's footer
 * and the app's Account screen link to it too. It promises nothing the Help
 * guide, the Privacy Policy and the Terms do not already say: it points to
 * them.
 */
export const metadata: Metadata = {
  title: `Support — ${PRODUCT_NAME}`,
  description: `How to get help with ${PRODUCT_NAME}: email us, ask in the Help panel, and where to find the Help guide, the Privacy Policy, the Terms and account deletion.`,
}

const LINK = 'font-semibold text-primary underline underline-offset-2 hover:text-primary-hover'

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-text-primary">Support</h1>
        <p className="mt-3 leading-relaxed text-text-secondary">
          Help with {PRODUCT_NAME}, on the web and in the phone app.
        </p>
        <div className="tape-rule mt-8" />

        <div className="mt-10 space-y-8">
          <section data-testid="support-email">
            <h2 className="font-display text-lg font-bold text-text-primary">Email us</h2>
            <p className="mt-2 leading-relaxed text-text-secondary">
              Write to{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={LINK}>
                {SUPPORT_EMAIL}
              </a>
              . Say what you were doing and what you saw. If it is about one estimate, tell us which customer it was for. A person reads
              every message.
            </p>
          </section>

          <section data-testid="support-ask">
            <h2 className="font-display text-lg font-bold text-text-primary">Ask in your dashboard</h2>
            <p className="mt-2 leading-relaxed text-text-secondary">
              Sign in on the web and press &quot;Help&quot; in the menu. &quot;Ask {PRODUCT_NAME}&quot; answers questions about using{' '}
              {PRODUCT_NAME} from the Help guide, and the same panel lets you report a problem or ask for a feature.
            </p>
            <p className="mt-3">
              <Link href="/app" className={LINK} data-testid="support-help-link">
                Open Help in your dashboard
              </Link>
            </p>
          </section>

          <section data-testid="support-app">
            <h2 className="font-display text-lg font-bold text-text-primary">The phone app</h2>
            <p className="mt-2 leading-relaxed text-text-secondary">
              In the app, open &quot;Account&quot;. &quot;Help&quot; writes to us, and &quot;Support page&quot; opens this page. You sign in to the
              app with the same email and password as on the web.
            </p>
          </section>

          <section data-testid="support-links">
            <h2 className="font-display text-lg font-bold text-text-primary">Policies and your account</h2>
            <ul className="mt-2 space-y-2 leading-relaxed text-text-secondary">
              <li>
                <Link href="/privacy" className={LINK}>
                  Privacy Policy
                </Link>
                : what we collect and why.
              </li>
              <li>
                <Link href="/terms" className={LINK}>
                  Terms of Service
                </Link>
                : the agreement for using {PRODUCT_NAME}.
              </li>
              <li>
                <Link href={DATA_DELETION_PATH} className={LINK}>
                  Delete your account
                </Link>
                : how to close an account or have your data deleted.
              </li>
            </ul>
          </section>
        </div>
      </section>
      <SiteFooter />
    </main>
  )
}
