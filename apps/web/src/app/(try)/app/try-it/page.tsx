import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentTenant } from '@/lib/current-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { getOrCreateTenantKey } from '@/lib/tenant-site'
import { readTryItState } from '@/lib/try-it'
import { TRY_IT_COPY, TRY_IT_PATH } from '@/lib/try-it-copy'
import { EstimateWidget } from '@/components/embed/EstimateWidget'
import { LimitLine } from '@/components/try-it/LimitLine'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: TRY_IT_COPY.title, robots: { index: false, follow: false } }

/**
 * T-202: "Try it yourself". The signed-in business sees its own request form
 * exactly as a customer does (the same widget as its quote link, full screen),
 * in test mode.
 *
 * It lives under /app, so only a signed-in user reaches it (the middleware
 * sends anyone else to the log-in page), and it shows the form of the business
 * that user belongs to, never one named in the address: the address carries
 * nothing. The form says "this is my own test" when it sends the request, and
 * the server takes that only together with this same session
 * (lib/test-estimates.ts). So no customer can make a test request.
 *
 * It is outside the dashboard's frame on purpose (its own route group): the
 * page is what the customer sees, with one line above it saying so.
 */
export default async function TryItPage() {
  const auth = await currentTenant()
  if (!auth.ok) redirect(`/login?next=${encodeURIComponent(TRY_IT_PATH)}`)

  const state = await readTryItState(auth.tenantId)
  if (!state.canStart) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-warm-md" data-testid="try-it-stop" data-reason={state.reason ?? ''}>
          <h1 className="font-display text-2xl font-bold text-text-primary">{TRY_IT_COPY.title}</h1>
          {state.reason === 'limit' ? (
            <LimitLine availableAt={state.availableAt} className="mt-2 text-sm text-text-secondary" />
          ) : (
            <p className="mt-2 text-sm text-text-secondary">{TRY_IT_COPY.noService}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {state.reason === 'no_service' && (
              <Link href="/app/services" className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
                {TRY_IT_COPY.noServiceLink}
              </Link>
            )}
            <Link href="/app" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline underline-offset-2">
              {TRY_IT_COPY.back}
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // the business's own active form key (the one its quote link uses); a business with none yet gets one
  const { data: sites } = await createAdminClient()
    .from('tenant_sites')
    .select('tenant_key')
    .eq('tenant_id', auth.tenantId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  const tenantKey = (sites?.[0] as { tenant_key?: string } | undefined)?.tenant_key ?? (await getOrCreateTenantKey(auth.supabase, auth.tenantId))

  return <EstimateWidget tenantKey={tenantKey} hosted ownTest />
}
