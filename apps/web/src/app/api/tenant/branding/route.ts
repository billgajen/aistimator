import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { TenantBranding, TenantTemplate } from '@estimator/shared'

const DEFAULT_BRANDING: TenantBranding = {
  logoAssetId: null,
  primaryColor: '#2563eb',
  footerNotes: null,
}

const DEFAULT_TEMPLATE: TenantTemplate = {
  showLineItems: true,
  includeAssumptions: true,
  includeExclusions: true,
  validityDays: 30,
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
      .select('id, name, branding_json, template_json')
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

    return NextResponse.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      branding,
      template,
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
