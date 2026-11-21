import { NextResponse } from 'next/server'
import { getRegion, resolveRegionContext, type AppBootstrapResponse } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { planHasRoomScan } from '@/lib/room-scan-intake'
import { loadWonLines, rememberTimeZone } from '@/lib/won'
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
 */
export async function GET(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const [{ data: tenant }, { data: site }, roomScan] = await Promise.all([
    supabase.from('tenants').select('name, currency, region, unit_system, time_zone').eq('id', tenantId).single(),
    supabase
      .from('tenant_sites')
      .select('tenant_key')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    // T-194: room scan is part of Pro and Business
    planHasRoomScan(createAdminClient(), tenantId),
  ])
  if (!tenant) {
    return NextResponse.json({ error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } }, { status: 404 })
  }
  if (!site?.tenant_key) {
    return NextResponse.json(
      { error: { code: 'NO_SITE', message: 'Set up your website widget first (Dashboard → Embed) — the app uses the same form.' } },
      { status: 409 }
    )
  }
  const region = getRegion(tenant.region as string | null)
  const zone = (tenant as { time_zone?: string | null }).time_zone ?? null
  const reported = new URL(request.url).searchParams.get('tz')
  const kept = await rememberTimeZone(tenantId, zone, reported)
  const won = await loadWonLines(supabase, tenantId, { time_zone: kept ? reported : zone, region: tenant.region as string | null, currency: tenant.currency as string | null })
  const body: AppBootstrapResponse = {
    tenantName: tenant.name as string,
    tenantKey: site.tenant_key as string,
    currency: (tenant.currency as string) || 'USD',
    region: {
      code: region.code,
      locale: region.locale,
      postalCodeLabel: region.copy.postalCodeLabel,
      // T-193: the units a room scan is shown in
      unitSystem: resolveRegionContext({ region: tenant.region as string | null, unit_system: (tenant as { unit_system?: string | null }).unit_system }).unitSystem,
    },
    roomScan,
    won: won ? { headline: won.lines.headline, onSite: won.lines.onSite } : null,
  }
  return NextResponse.json(body)
}
