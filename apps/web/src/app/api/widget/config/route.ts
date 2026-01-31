import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Widget Form Field type
 */
interface WidgetField {
  fieldId: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'boolean'
  label: string
  required: boolean
  placeholder?: string
  helpText?: string
  options?: Array<{ value: string; label: string }>
}

/**
 * Widget Config structure
 */
interface WidgetConfig {
  fields: WidgetField[]
  files: {
    minPhotos: number
    maxPhotos: number
    maxDocs: number
  }
}

/**
 * GET /api/widget/config
 * Get widget configuration for the current tenant
 *
 * Query params:
 * - serviceId: optional - get config for a specific service (or null for global)
 * - merged: optional - if true, merge global + service-specific fields for the given serviceId
 * - all: optional - if true, return all configs (global + per-service) for this tenant
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const serviceId = searchParams.get('serviceId')
    const merged = searchParams.get('merged') === 'true'
    const all = searchParams.get('all') === 'true'

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

    // If requesting all configs
    if (all) {
      const { data: allConfigs, error: allError } = await supabase
        .from('widget_configs')
        .select('id, service_id, config_json')
        .eq('tenant_id', profile.tenant_id)

      if (allError) {
        console.error('Error fetching all widget configs:', allError)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to fetch widget configs' } },
          { status: 500 }
        )
      }

      return NextResponse.json({
        configs: allConfigs || [],
      })
    }

    // If requesting merged config for a service
    if (merged && serviceId) {
      // Get both global and service-specific configs
      const { data: configs, error: configsError } = await supabase
        .from('widget_configs')
        .select('id, service_id, config_json')
        .eq('tenant_id', profile.tenant_id)
        .or(`service_id.is.null,service_id.eq.${serviceId}`)

      if (configsError) {
        console.error('Error fetching merged widget configs:', configsError)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to fetch widget configs' } },
          { status: 500 }
        )
      }

      const globalConfig = configs?.find((c) => c.service_id === null)?.config_json as WidgetConfig | undefined
      const serviceConfig = configs?.find((c) => c.service_id === serviceId)?.config_json as WidgetConfig | undefined

      // Merge fields: global fields first, then service-specific
      const mergedFields: WidgetField[] = [
        ...(globalConfig?.fields || []),
        ...(serviceConfig?.fields || []),
      ]

      // Use service-specific file config if available, otherwise global
      const mergedFiles = serviceConfig?.files || globalConfig?.files || {
        minPhotos: 0,
        maxPhotos: 8,
        maxDocs: 3,
      }

      return NextResponse.json({
        config: {
          fields: mergedFields,
          files: mergedFiles,
        },
        globalConfigId: configs?.find((c) => c.service_id === null)?.id || null,
        serviceConfigId: configs?.find((c) => c.service_id === serviceId)?.id || null,
      })
    }

    // Fetch specific widget config (global or service-specific)
    let query = supabase
      .from('widget_configs')
      .select('id, config_json')
      .eq('tenant_id', profile.tenant_id)

    if (serviceId) {
      query = query.eq('service_id', serviceId)
    } else {
      query = query.is('service_id', null)
    }

    const { data: widgetConfig, error: configError } = await query.single()

    if (configError && configError.code !== 'PGRST116') {
      // PGRST116 is "not found" which is ok
      console.error('Error fetching widget config:', configError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch widget config' } },
        { status: 500 }
      )
    }

    // Return config or defaults
    const defaultConfig: WidgetConfig = {
      fields: [],
      files: {
        minPhotos: 0,
        maxPhotos: 8,
        maxDocs: 3,
      },
    }

    return NextResponse.json({
      config: widgetConfig?.config_json || defaultConfig,
      configId: widgetConfig?.id || null,
    })
  } catch (error) {
    console.error('Widget config GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/widget/config
 * Update widget configuration for the current tenant
 *
 * Body params:
 * - config: the widget config to save
 * - serviceId: optional - if provided, saves as service-specific config
 */
export async function PUT(request: Request) {
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

    const body = await request.json()
    const { config, serviceId } = body as { config: WidgetConfig; serviceId?: string | null }

    // Validate config structure
    if (!config || !Array.isArray(config.fields)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid config structure' } },
        { status: 400 }
      )
    }

    // Validate each field
    for (const field of config.fields) {
      if (!field.fieldId || !field.type || !field.label) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Each field must have fieldId, type, and label' } },
          { status: 400 }
        )
      }

      // Validate fieldId format (alphanumeric and underscores only)
      if (!/^[a-z][a-z0-9_]*$/.test(field.fieldId)) {
        return NextResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: `Invalid fieldId format: ${field.fieldId}. Use lowercase letters, numbers, and underscores.` } },
          { status: 400 }
        )
      }

      // Validate that select/radio/checkbox have options
      if (['select', 'radio', 'checkbox'].includes(field.type)) {
        if (!field.options || field.options.length === 0) {
          return NextResponse.json(
            { error: { code: 'VALIDATION_ERROR', message: `Field "${field.label}" requires at least one option` } },
            { status: 400 }
          )
        }
      }
    }

    // If serviceId is provided, verify it belongs to this tenant
    if (serviceId) {
      const { data: service, error: serviceError } = await supabase
        .from('services')
        .select('id')
        .eq('id', serviceId)
        .eq('tenant_id', profile.tenant_id)
        .single()

      if (serviceError || !service) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Service not found' } },
          { status: 404 }
        )
      }
    }

    // Check if config already exists
    let existingQuery = supabase
      .from('widget_configs')
      .select('id')
      .eq('tenant_id', profile.tenant_id)

    if (serviceId) {
      existingQuery = existingQuery.eq('service_id', serviceId)
    } else {
      existingQuery = existingQuery.is('service_id', null)
    }

    const { data: existing } = await existingQuery.single()

    if (existing) {
      // Update existing
      const { error: updateError } = await supabase
        .from('widget_configs')
        .update({ config_json: config, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      if (updateError) {
        console.error('Error updating widget config:', updateError)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to update widget config' } },
          { status: 500 }
        )
      }
    } else {
      // Insert new
      const { error: insertError } = await supabase
        .from('widget_configs')
        .insert({
          tenant_id: profile.tenant_id,
          service_id: serviceId || null,
          config_json: config,
        })

      if (insertError) {
        console.error('Error inserting widget config:', insertError)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to save widget config' } },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true, config })
  } catch (error) {
    console.error('Widget config PUT error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
