import { NextResponse } from 'next/server'
import { ID_PREFIXES, canUse, getRegion, onsiteNotInPlan, resolveRegionContext, type AppBootstrapResponse } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { loadAccess } from '@/lib/access'
import { loadWonLines, rememberTimeZone } from '@/lib/won'
import { getOrCreateTenantKey } from '@/lib/tenant-site'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/app/bootstrap (T-137) — what the business app needs to start:
 * the tenant's name, currency and region, and its widget key (the app uses
 * the widget's public form-config and photo-upload endpoints with it).
 * Auth: Supabase session cookie or `Authorization: Bearer <access token>`.
 *
 * T-196: also `won`, the home tab's "Won this month" lines (null before the
 * first accepted estimate). `?tz=` is the phone's time zone: kept the first
 * time, when the business has none.
 *
 * T-199: any business can use the app, on any plan or none. `onsiteQuotes`
 * says whether it can start a quote in it; the route that makes the quote
 * decides again (POST /api/app/quotes).
 *
 * T-206: a business with no site row gets one here, on first need, as the
 * dashboard's own pages make it (getOrCreateTenantKey). It used to be
 * answered 409 NO_SITE, "Set up your website widget first": a business made
 * outside sign-up's pages (the store reviewer's account) could not start a
 * quote in the app, and nothing in the app could put that right.
 */
export async function GET(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const [{ data: tenant }, { data: site }, access] = await Promise.all([
    supabase.from('tenants').select('name, currency, region, unit_system, time_zone').eq('id', tenantId).single(),
    supabase
      .from('tenant_sites')
      .select('tenant_key')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // T-199: what this business can use, by the one rule (room scan and on-site quotes)
    loadAccess(createAdminClient(), tenantId),
  ])
  if (!tenant) {
    return NextResponse.json({ error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } }, { status: 404 })
  }
  const tenantKey = (site?.tenant_key as string | undefined) ?? (await getOrCreateTenantKey(supabase, tenantId))
  if (!tenantKey.startsWith(ID_PREFIXES.tenantKey)) {
    // The helper answers a word that is not a key when the row could not be made (the database did not answer)
    return NextResponse.json({ error: { code: 'TRY_AGAIN', message: 'Your account could not be loaded. Try again in a moment.' } }, { status: 503 })
  }
  const region = getRegion(tenant.region as string | null)
  const zone = (tenant as { time_zone?: string | null }).time_zone ?? null
  const reported = new URL(request.url).searchParams.get('tz')
  const kept = await rememberTimeZone(tenantId, zone, reported)
  const won = await loadWonLines(supabase, tenantId, { time_zone: kept ? reported : zone, region: tenant.region as string | null, currency: tenant.currency as string | null })
  const body: AppBootstrapResponse = {
    tenantName: tenant.name as string,
    tenantKey,
    currency: (tenant.currency as string) || 'USD',
    region: {
      code: region.code,
      locale: region.locale,
      postalCodeLabel: region.copy.postalCodeLabel,
      // T-193: the units a room scan is shown in
      unitSystem: resolveRegionContext({ region: tenant.region as string | null, unit_system: (tenant as { unit_system?: string | null }).unit_system }).unitSystem,
    },
    roomScan: canUse(access, 'room_scan'),
    onsiteQuotes: canUse(access, 'onsite_quotes'),
    onsiteNotInPlan: (({ heading, text, button }) => ({ heading, text, button }))(onsiteNotInPlan()),
    won: won ? { headline: won.lines.headline, onSite: won.lines.onSite } : null,
  }
  return NextResponse.json(body)
}
