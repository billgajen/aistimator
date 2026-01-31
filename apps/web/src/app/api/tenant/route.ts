import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { ServiceAreaMode, TenantTemplate } from '@estimator/shared'

/**
 * GET /api/tenant
 * Get the current tenant's settings
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
      .select('tenant_id, display_name')
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
      .select('*')
      .eq('id', profile.tenant_id)
      .single()

    if (tenantError || !tenant) {
      console.error('Error fetching tenant:', tenantError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch tenant' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        currency: tenant.currency,
        taxEnabled: tenant.tax_enabled,
        taxLabel: tenant.tax_label,
        taxRate: tenant.tax_rate,
        serviceAreaMode: tenant.service_area_mode,
        serviceAreaValues: tenant.service_area_values || [],
        notificationEmail: tenant.notification_email,
        defaultTermsText: tenant.default_terms_text,
        templateJson: tenant.template_json || {
          showLineItems: true,
          includeAssumptions: true,
          includeExclusions: true,
          validityDays: 30,
        },
      },
      user: {
        email: user.email,
        displayName: profile.display_name,
      },
    })
  } catch (error) {
    console.error('Tenant GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/tenant
 * Update the current tenant's settings
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
    const {
      name,
      currency,
      taxEnabled,
      taxLabel,
      taxRate,
      serviceAreaMode,
      serviceAreaValues,
      notificationEmail,
      defaultTermsText,
      templateJson,
    } = body as {
      name?: string
      currency?: string
      taxEnabled?: boolean
      taxLabel?: string
      taxRate?: number
      serviceAreaMode?: ServiceAreaMode
      serviceAreaValues?: string[]
      notificationEmail?: string | null
      defaultTermsText?: string | null
      templateJson?: Partial<TenantTemplate>
    }

    // Build update object
    const updates: Record<string, unknown> = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: { code: 'INVALID_INPUT', message: 'Business name cannot be empty' } },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }

    if (currency !== undefined) {
      if (typeof currency !== 'string' || currency.length !== 3) {
        return NextResponse.json(
          { error: { code: 'INVALID_INPUT', message: 'Currency must be a 3-letter ISO code' } },
          { status: 400 }
        )
      }
      updates.currency = currency.toUpperCase()
    }

    if (taxEnabled !== undefined) {
      updates.tax_enabled = Boolean(taxEnabled)
    }

    if (taxLabel !== undefined) {
      updates.tax_label = taxLabel ? taxLabel.trim() : null
    }

    if (taxRate !== undefined) {
      const rate = Number(taxRate)
      if (isNaN(rate) || rate < 0 || rate > 1) {
        return NextResponse.json(
          { error: { code: 'INVALID_INPUT', message: 'Tax rate must be between 0 and 1' } },
          { status: 400 }
        )
      }
      updates.tax_rate = rate
    }

    if (serviceAreaMode !== undefined) {
      const validModes: ServiceAreaMode[] = ['none', 'postcode_allowlist', 'county_state']
      if (!validModes.includes(serviceAreaMode)) {
        return NextResponse.json(
          { error: { code: 'INVALID_INPUT', message: 'Invalid service area mode' } },
          { status: 400 }
        )
      }
      updates.service_area_mode = serviceAreaMode
    }

    if (serviceAreaValues !== undefined) {
      if (!Array.isArray(serviceAreaValues)) {
        return NextResponse.json(
          { error: { code: 'INVALID_INPUT', message: 'Service area values must be an array' } },
          { status: 400 }
        )
      }
      // Filter empty strings and trim values
      updates.service_area_values = serviceAreaValues
        .filter((v) => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim().toUpperCase())
    }

    if (notificationEmail !== undefined) {
      if (notificationEmail === null || notificationEmail === '') {
        updates.notification_email = null
      } else {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(notificationEmail)) {
          return NextResponse.json(
            { error: { code: 'INVALID_INPUT', message: 'Invalid notification email format' } },
            { status: 400 }
          )
        }
        updates.notification_email = notificationEmail.trim()
      }
    }

    if (defaultTermsText !== undefined) {
      updates.default_terms_text = defaultTermsText ? defaultTermsText.trim() : null
    }

    if (templateJson !== undefined) {
      // Fetch current template_json to merge with updates
      const { data: currentTenant } = await supabase
        .from('tenants')
        .select('template_json')
        .eq('id', profile.tenant_id)
        .single()

      const currentTemplate = (currentTenant?.template_json as TenantTemplate) || {
        showLineItems: true,
        includeAssumptions: true,
        includeExclusions: true,
        validityDays: 30,
      }

      // Merge and validate
      const mergedTemplate: TenantTemplate = {
        showLineItems:
          templateJson.showLineItems !== undefined
            ? Boolean(templateJson.showLineItems)
            : currentTemplate.showLineItems,
        includeAssumptions:
          templateJson.includeAssumptions !== undefined
            ? Boolean(templateJson.includeAssumptions)
            : currentTemplate.includeAssumptions,
        includeExclusions:
          templateJson.includeExclusions !== undefined
            ? Boolean(templateJson.includeExclusions)
            : currentTemplate.includeExclusions,
        validityDays:
          templateJson.validityDays !== undefined
            ? Math.max(1, Math.min(365, Number(templateJson.validityDays) || 30))
            : currentTemplate.validityDays,
      }

      updates.template_json = mergedTemplate
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
      .select()
      .single()

    if (updateError) {
      console.error('Error updating tenant:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update tenant' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        currency: tenant.currency,
        taxEnabled: tenant.tax_enabled,
        taxLabel: tenant.tax_label,
        taxRate: tenant.tax_rate,
        serviceAreaMode: tenant.service_area_mode,
        serviceAreaValues: tenant.service_area_values || [],
        notificationEmail: tenant.notification_email,
        defaultTermsText: tenant.default_terms_text,
        templateJson: tenant.template_json || {
          showLineItems: true,
          includeAssumptions: true,
          includeExclusions: true,
          validityDays: 30,
        },
      },
    })
  } catch (error) {
    console.error('Tenant PUT error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
