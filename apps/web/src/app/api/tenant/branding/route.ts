import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import type { TenantBranding, TenantTemplate } from '@qolumns/shared'
import { DEFAULT_PRIMARY_COLOR, badgeLineFor, canUse, formatMoney, resolveRegionContext } from '@qolumns/shared'
import { loadAccess } from '@/lib/access'
import { brandingSample, type PreviewServiceRow, type PreviewTax } from '@/lib/branding-preview'

const DEFAULT_BRANDING: TenantBranding = {
  logoAssetId: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  footerNotes: null,
}

const DEFAULT_TEMPLATE: TenantTemplate = {
  showLineItems: true,
  includeAssumptions: true,
  includeExclusions: true,
  validityDays: 30,
  acceptQuoteEnabled: true,
}

/**
 * GET /api/tenant/branding
 * Get the current tenant's branding and template settings
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Fetch tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name, branding_json, template_json, region, currency, unit_system, tax_enabled, tax_label, tax_rate')
      .eq('id', profile.tenant_id)
      .single()

    if (tenantError || !tenant) {
      console.error('Error fetching tenant:', tenantError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch tenant' } },
        { status: 500 }
      )
    }

    // Merge with defaults to ensure all fields exist
    const branding: TenantBranding = {
      ...DEFAULT_BRANDING,
      ...(tenant.branding_json || {}),
    }

    const template: TenantTemplate = {
      ...DEFAULT_TEMPLATE,
      ...(tenant.template_json || {}),
    }

    // Resolve a short-lived viewable URL for the logo, if one is set
    let logoUrl: string | null = null
    if (branding.logoAssetId && isR2Configured()) {
      const { data: logoAsset } = await supabase
        .from('assets')
        .select('r2_key')
        .eq('id', branding.logoAssetId)
        .single()
      if (logoAsset) {
        logoUrl = await generateDownloadUrl(logoAsset.r2_key)
      }
    }

    // T-204: what the preview needs to show this business's own look: its currency, its tax (or
    // none), a sample from one of its own services, and whether its estimates carry the badge today.
    const row = tenant as { region?: string | null; currency?: string | null; unit_system?: string | null; tax_enabled?: boolean | null; tax_label?: string | null; tax_rate?: number | string | null }
    const regionContext = resolveRegionContext(row)
    const currency = row.currency || regionContext.currency
    const tax: PreviewTax = {
      enabled: row.tax_enabled === true && Number(row.tax_rate) > 0,
      label: regionContext.taxLabel,
      // stored as a fraction (0.0825); shown as a percentage
      ratePercent: Math.round(Number(row.tax_rate || 0) * 100 * 1000) / 1000,
    }
    const [{ data: serviceRows }, access] = await Promise.all([
      supabase
        .from('services')
        .select('name, description, active, scope_includes, scope_excludes, default_assumptions, work_steps, expected_signals, tax_exempt, service_pricing_rules ( rules_json )')
        .eq('tenant_id', tenant.id)
        .order('active', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(20),
      loadAccess(supabase, tenant.id),
    ])
    const services: PreviewServiceRow[] = ((serviceRows ?? []) as Array<PreviewServiceRow & { service_pricing_rules?: unknown }>).map((service) => {
      const rules = Array.isArray(service.service_pricing_rules) ? service.service_pricing_rules[0] : service.service_pricing_rules
      return { ...service, rules: (rules as { rules_json?: PreviewServiceRow['rules'] } | null | undefined)?.rules_json ?? null }
    })

    return NextResponse.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      // T-152: for region-aware placeholders
      region: (tenant as { region?: string | null }).region ?? null,
      branding,
      template,
      logoUrl,
      preview: {
        currency,
        tax,
        // the same rule the estimate page and the emails use (lib/access.ts)
        badgeShown: !canUse(access, 'no_badge'),
        badgeLine: badgeLineFor(access),
        sample: brandingSample(services, (amount) => formatMoney(amount, currency)),
      },
    })
  } catch (error) {
    console.error('Branding GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/tenant/branding
 * Update the current tenant's branding and template settings
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { branding, template } = body as {
      branding?: Partial<TenantBranding>
      template?: Partial<TenantTemplate>
    }

    // Get current values
    const { data: currentTenant } = await supabase
      .from('tenants')
      .select('branding_json, template_json')
      .eq('id', profile.tenant_id)
      .single()

    const updates: Record<string, unknown> = {}

    // Update branding if provided
    if (branding) {
      const currentBranding = currentTenant?.branding_json || DEFAULT_BRANDING

      // Validate primary color
      if (branding.primaryColor !== undefined) {
        if (!/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor)) {
          return NextResponse.json(
            { error: { code: 'INVALID_INPUT', message: 'Primary color must be a valid hex color (e.g., #2563eb)' } },
            { status: 400 }
          )
        }
      }

      updates.branding_json = {
        ...currentBranding,
        ...branding,
      }
    }

    // Update template if provided
    if (template) {
      const currentTemplate = currentTenant?.template_json || DEFAULT_TEMPLATE

      // Validate validity days
      if (template.validityDays !== undefined) {
        const days = Number(template.validityDays)
        if (isNaN(days) || days < 1 || days > 365) {
          return NextResponse.json(
            { error: { code: 'INVALID_INPUT', message: 'Validity days must be between 1 and 365' } },
            { status: 400 }
          )
        }
        template.validityDays = days
      }

      updates.template_json = {
        ...currentTemplate,
        ...template,
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'No valid fields to update' } },
        { status: 400 }
      )
    }

    // Update tenant
    const { data: tenant, error: updateError } = await supabase
      .from('tenants')
      .update(updates)
      .eq('id', profile.tenant_id)
      .select('id, name, branding_json, template_json')
      .single()

    if (updateError) {
      console.error('Error updating tenant:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update tenant' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      branding: tenant.branding_json,
      template: tenant.template_json,
    })
  } catch (error) {
    console.error('Branding PUT error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
