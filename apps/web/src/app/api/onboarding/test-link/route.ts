import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { issueTestToken } from '@/lib/test-quote-token'
import { getOrCreateTenantKey, appOriginFrom } from '@/lib/tenant-site'
import { quoteLinkUrl } from '@/lib/quote-link-url'

/**
 * POST /api/onboarding/test-link
 * T-150: a test-mode address for the signed-in owner's own quote page.
 * Requests made through it are marked as tests and never counted.
 */
export async function POST() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const { data: tenant } = await auth.supabase.from('tenants').select('slug').eq('id', auth.tenantId).single()
  if (!tenant?.slug) return NextResponse.json({ error: { code: 'NO_LINK', message: 'Your quote link is not ready yet' } }, { status: 409 })
  // The quote page needs an active widget key for this tenant
  await getOrCreateTenantKey(auth.supabase, auth.tenantId)

  const issuedAt = new Date().toISOString()
  const { token, expiresAt } = issueTestToken(auth.tenantId)
  const url = `${quoteLinkUrl(appOriginFrom(headers().get('host')), tenant.slug)}?test=${encodeURIComponent(token)}`
  return NextResponse.json({ url, issuedAt, expiresAt })
}
