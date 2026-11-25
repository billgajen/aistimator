import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveQuoteLink, supabaseQuoteLinkStore } from '@/lib/quote-link'
import { EstimateWidget } from '@/components/embed/EstimateWidget'

export const dynamic = 'force-dynamic'

/**
 * T-149: the business's own quote page, /quote/{slug}. The readable link and
 * QR code a business shares when it can't (or doesn't want to) add code to
 * a website. It renders the same widget as /embed (AD-024), full screen, so
 * branding, Turnstile, the honeypot and the public API rate limits all
 * apply exactly as they do there.
 *
 * T-202: nothing in this page's address changes what it does. A visit is
 * not recorded (opening the link no longer ticks "Share your quote link":
 * a visit cannot tell the owner from a customer), and there is no test
 * mode here (a test request is made from inside the dashboard, /app/try-it,
 * and marked from the business's own session). `?test=` and `?own=1` from
 * older links are simply ignored.
 */
interface QuotePageProps {
  params: { slug: string }
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

export default async function QuoteLinkPage({ params }: QuotePageProps) {
  // T-178: this page's rate limit (`quote_page`) is checked in the middleware,
  // where a blocked visitor can be answered with a real 429. A page that is
  // already rendering can only answer 200.
  //
  // Reading the request's headers is what makes every visit look the business
  // up afresh. Without it the lookups for a link are reused, and a link that
  // was changed or switched off keeps showing its old page (the limit check
  // that used to sit here read them; taking it away broke exactly that).
  headers()

  const result = await resolve(params.slug)
  if (result.kind === 'redirect') permanentRedirect(`/quote/${result.slug}`)
  if (result.kind === 'not_found') notFound()

  return <EstimateWidget tenantKey={result.tenantKey} hosted />
}
