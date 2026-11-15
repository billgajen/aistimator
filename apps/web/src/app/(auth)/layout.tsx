import type { Metadata } from 'next'
import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, PRODUCT_NAME } from '@qolumns/shared'
import { HERO, HERO_DEMO } from '@/lib/marketing/home-copy'
import { marketingExample } from '@/lib/marketing/examples'
import { Wordmark } from '@/components/brand/Wordmark'
import { EstimateSheet } from '@/components/quote/EstimateSheet'
import { LoginAside } from '@/components/auth/LoginAside'

// Force dynamic rendering for auth pages
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} - Auth`,
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const example = marketingExample(HERO_DEMO.trade)
  return (
    <div className="flex min-h-screen items-center justify-center gap-16 bg-background p-4 xl:gap-24">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="mb-8 text-center">
          <p>
            <Wordmark className="text-3xl" />
          </p>
          {/* T-160: the home page's own headline, so signing in always matches it */}
          <p className="mt-2 text-sm font-medium text-text-secondary" data-testid="auth-line">{HERO.headline}</p>
        </div>
        {/* Auth card */}
        <div className="animate-fade-in-up rounded-2xl border border-border bg-background p-8 shadow-warm-md">
          {children}
        </div>
      </div>
      {/* T-165: on /login at desktop width, the estimate document a customer gets */}
      <LoginAside>
        <EstimateSheet
          confirmed
          data={{
            businessName: DEMO_BUSINESS_NAME,
            logoUrl: DEMO_LOGO_PATH,
            customerName: example.customerName,
            reference: 'EST-2026-0142',
            lines: example.lines,
            total: example.total,
            currency: 'USD',
            locale: 'en-US',
            primaryColor: DEMO_PRIMARY_COLOR,
          }}
        />
      </LoginAside>
    </div>
  )
}
