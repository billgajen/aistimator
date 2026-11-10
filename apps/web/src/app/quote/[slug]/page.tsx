import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveQuoteLink, supabaseQuoteLinkStore, markFirstVisit } from '@/lib/quote-link'
import { checkPublicRateLimit, getClientIp } from '@/lib/rate-limit'
import { EstimateWidget } from '@/components/embed/EstimateWidget'
import { verifyTestToken } from '@/lib/test-quote-token'

export const dynamic = 'force-dynamic'

/**
 * T-149: the business's own quote page, /quote/{slug}. The readable link and
 * QR code a business shares when it can't (or doesn't want to) add code to
 * a website. It renders the same widget as /embed (AD-024), full screen, so
 * branding, Turnstile, the honeypot and the public API rate limits all
 * apply exactly as they do there.
 */
interface QuotePageProps {
  params: { slug: string }
  searchParams?: { test?: string }
}

async function resolve(slug: string) {
  return resolveQuoteLink(supabaseQuoteLinkStore(createAdminClient()), slug)
}

export async function generateMetadata({ params }: QuotePageProps): Promise<Metadata> {
  const found = await resolve(params.slug)
  if (found.kind !== 'found') return { title: 'Page not found' }
  const title = `${found.tenant.name}: request an estimate`
  const description = `Send ${found.tenant.name} a few details and photos of your job to get an estimate.`
  return { title, description, openGraph: { title, description, type: 'website' } }
}

export default async function QuoteLinkPage({ params, searchParams }: QuotePageProps) {
  const rate = await checkPublicRateLimit('quote_page', {
    ip: getClientIp({ headers: headers() }),
    tenantKey: `slug:${params.slug.toLowerCase().slice(0, 60)}`,
  })
  if (!rate.allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-text-secondary">Too many requests. Please wait a moment and try again.</p>
      </main>
    )
  }

  const result = await resolve(params.slug)
  if (result.kind === 'redirect') permanentRedirect(`/quote/${result.slug}`)
  if (result.kind === 'not_found') notFound()

  // T-150: the owner's test from setup. The token is checked here (to show
  // the test banner) and again on submission; a bad one is simply ignored.
  const testToken =
    searchParams?.test && verifyTestToken(searchParams.test, result.tenant.id).ok ? searchParams.test : undefined

  // Home checklist: "Share your quote link" is ticked by the first real visit
  // (the owner's own test doesn't count)
  if (!testToken && !result.tenant.quoteLinkFirstVisitAt) {
    await markFirstVisit(createAdminClient(), result.tenant.id).catch((error: unknown) => {
      console.error('[QuoteLink] first-visit flag failed:', error instanceof Error ? error.message : error)
    })
  }

  return <EstimateWidget tenantKey={result.tenantKey} hosted testToken={testToken} />
}
