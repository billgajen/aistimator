import type { Metadata } from 'next'
import { PRODUCT_NAME } from '@qolumns/shared'
import { HERO } from '@/lib/marketing/home-copy'
import { Wordmark } from '@/components/brand/Wordmark'

// Force dynamic rendering for auth pages
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - Auth`,
}

/**
 * The account pages (log-in, sign-up, forgot and new password): the form
 * alone, centred, at every width. T-200 (the owner's decision): the example
 * estimate that sat beside the log-in form at desktop width (T-165) is gone.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <p>
            <Wordmark height={44} className="mx-auto" />
          </p>
          {/* T-160: the home page's own headline, so signing in always matches it */}
          <p className="mt-2 text-sm font-medium text-text-secondary" data-testid="auth-line">{HERO.headline}</p>
        </div>
        {/* Auth card */}
        <div className="animate-fade-in-up rounded-2xl border border-border bg-background p-8 shadow-warm-md">
          {children}
        </div>
      </div>
    </div>
  )
}
