import type { Metadata } from 'next'
import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { DemoExperience } from '@/components/demo/DemoExperience'
import { DeveloperDemo } from '@/components/demo/DeveloperDemo'
import { demoTenantKey } from '@/lib/demo/demo-tenant'
import { DEMO_BUSINESS_NAME, PRODUCT_NAME, freeOfferLabel } from '@estimator/shared'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Try it as a customer — ${PRODUCT_NAME}`,
  description: 'Ask an example business for an estimate, the way your customers would, and see the price in about a minute. No signup.',
}

/**
 * T-153: /demo — try it as a customer, with an example business.
 * With ?tenantKey= (the dashboard's Share page links here) the developer view
 * opens instead, unchanged.
 */
export default async function DemoPage({ searchParams }: { searchParams: { tenantKey?: string } }) {
  if (searchParams.tenantKey) return <DeveloperDemo />

  const tenantKey = await demoTenantKey()
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />
      <section className="mx-auto max-w-xl px-4 pb-2 pt-10 text-center sm:pt-14">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">Try it as a customer</h1>
        <p className="mt-3 text-base text-text-secondary">
          Ask for an estimate the way your customers would. It takes about a minute, and the price appears right here.
        </p>
        <p className="mx-auto mt-4 max-w-md rounded-warm-lg border border-tape/50 bg-butter px-4 py-2.5 text-sm text-text-primary" role="note" data-testid="demo-example-note">
          {DEMO_BUSINESS_NAME} is an example business with example prices. Nothing you send here reaches a real business.
        </p>
      </section>
      <section className="pb-16 pt-4">
        {tenantKey ? (
          <DemoExperience tenantKey={tenantKey} />
        ) : (
          <div className="mx-auto max-w-xl px-4 text-center">
            <p className="text-text-secondary">The demo isn&apos;t available right now.</p>
            <Link href="/signup" className="mt-4 inline-flex rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white">
              {freeOfferLabel()}
            </Link>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  )
}
