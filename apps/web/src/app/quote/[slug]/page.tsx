import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveQuoteLink, supabaseQuoteLinkStore, markFirstVisit, countsAsFirstVisit, OWN_VISIT_PARAM } from '@/lib/quote-link'
import { currentTenant } from '@/lib/current-tenant'
import { EstimateWidget } from '@/components/embed/EstimateWidget'
import { OwnVisitMark } from '@/components/share/OwnVisitMark'
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
  searchParams?: { test?: string; own?: string }
}

/** The business the visitor is signed in to, or null (most visitors are customers, signed in to nothing) */
async function signedInBusiness(): Promise<string | null> {
  try {
    const auth = await currentTenant()
    return auth.ok ? auth.tenantId : null
  } catch {
    return null
  }
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

  // T-150: the owner's test from setup. The token is checked here (to show
  // the test banner) and again on submission; a bad one is simply ignored.
  const testToken =
    searchParams?.test && verifyTestToken(searchParams.test, result.tenant.id).ok ? searchParams.test : undefined

  // Home checklist: "Share your quote link" is ticked by the first real visit.
  // The owner's own test doesn't count, and (T-201) neither does the business
  // opening its own link: from the dashboard's "Open" button, or signed in.
  // Who is signed in is only looked up while the step is still unticked.
  const ownMark = searchParams?.[OWN_VISIT_PARAM] === '1'
  const unticked = !testToken && !ownMark && !result.tenant.quoteLinkFirstVisitAt
  const signedInTenantId = unticked ? await signedInBusiness() : null
  if (
    countsAsFirstVisit({
      alreadyVisited: Boolean(result.tenant.quoteLinkFirstVisitAt),
      isSetupTest: Boolean(testToken),
      ownMark,
      signedInTenantId,
      tenantId: result.tenant.id,
    })
  ) {
    await markFirstVisit(createAdminClient(), result.tenant.id).catch((error: unknown) => {
      console.error('[QuoteLink] first-visit flag failed:', error instanceof Error ? error.message : error)
    })
  }

  return (
    <>
      {ownMark && <OwnVisitMark />}
      <EstimateWidget tenantKey={result.tenantKey} hosted testToken={testToken} />
    </>
  )
}
