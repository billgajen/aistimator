import type { Metadata } from 'next'
import { PRODUCT_NAME } from '@estimator/shared'
import { HERO } from '@/lib/marketing/home-copy'

// Force dynamic rendering for auth pages
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - Auth`,
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">{PRODUCT_NAME}</h2>
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
