import { NextResponse } from 'next/server'
import { businessAccess, businessLinks, canUse } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { appAccount } from '@/lib/app-account'
import { checkPlanLimit } from '@/lib/plan-limits'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { appUrlFrom, ownAddressHost } from '@/lib/own-address'

export const dynamic = 'force-dynamic'

/**
 * GET /api/app/account (T-184): the on-site app's Account tab. A small read
 * of what the dashboard already shows: the business's name and logo, its
 * plan's name, how many quotes it has used, and its own request page (to
 * show a customer on site, as a QR code).
 *
 * No price, no upgrade and no link to billing is answered here: the app must
 * not point at a purchase outside it. Auth: session cookie or
 * `Authorization: Bearer <access token>`; tenant-scoped by RLS and an
 * explicit filter. The logo is a signed address that lasts a few minutes.
 */
export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const [{ data: tenant }, { data: subscription }, limit] = await Promise.all([
    supabase.from('tenants').select('name, slug, own_address, region, branding_json').eq('id', tenantId).single(),
    supabase.from('subscriptions').select('status, plan_id').eq('tenant_id', tenantId).maybeSingle(),
    checkPlanLimit(supabase, tenantId),
  ])
  if (!tenant) return NextResponse.json({ error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } }, { status: 404 })

  let logoUrl: string | null = null
  const logoAssetId = (tenant.branding_json as { logoAssetId?: string | null } | null)?.logoAssetId
  if (logoAssetId && isR2Configured()) {
    try {
      const { data: asset } = await supabase.from('assets').select('r2_key').eq('id', logoAssetId).eq('tenant_id', tenantId).maybeSingle()
      if (asset?.r2_key) logoUrl = await generateDownloadUrl(asset.r2_key as string)
    } catch (error) {
      // the name is shown without it; the error's name only (a message could carry a key)
      console.error('[AppAccount] logo could not be signed:', error instanceof Error ? error.name : 'unknown')
    }
  }

  // T-199: the one rule says what the business holds. The plan's name is shown only for a plan it holds
  // (not for the free start, which lends another plan's features); `limit.used` is every month's count
  // exactly when the allowance is the one that never resets, which is when the free start can apply.
  const access = businessAccess({ subscription, region: tenant.region as string | null, quotesUsed: limit.per === 'total' ? limit.used : null })
  const slug = (tenant.slug as string | null) || null
  const body = appAccount({
    businessName: (tenant.name as string) || '',
    logoUrl,
    planName: access.basis === 'plan' ? (access.plan?.name ?? null) : null,
    limit,
    links: slug
      ? businessLinks({ appUrl: appUrlFrom(), slug, ownAddress: (tenant as { own_address?: string | null }).own_address ?? null, canUseAddress: canUse(access, 'own_address'), host: ownAddressHost() })
      : null,
  })
  return NextResponse.json(body)
}
