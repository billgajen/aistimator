import { NextResponse } from 'next/server'
import { getRegion, resolveRegionContext, type AppBootstrapResponse } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { planHasRoomScan } from '@/lib/room-scan-intake'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * GET /api/app/bootstrap (T-137) — what the business app needs to start:
 * the tenant's name, currency and region, and its widget key (the app uses
 * the widget's public form-config and photo-upload endpoints with it).
 * Auth: Supabase session cookie or `Authorization: Bearer <access token>`.
 */
export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const [{ data: tenant }, { data: site }, roomScan] = await Promise.all([
    supabase.from('tenants').select('name, currency, region, unit_system').eq('id', tenantId).single(),
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
  }
  return NextResponse.json(body)
}
