import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/public/widget/config
 * Returns widget configuration for a tenant.
 * Used by the embeddable widget to load services and form fields.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const tenantKey = url.searchParams.get('tenantKey')

    if (!tenantKey) {
      return NextResponse.json(
        { error: { code: 'MISSING_TENANT_KEY', message: 'tenantKey is required' } },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Validate tenantKey and get tenant
    const { data: tenantSite, error: siteError } = await supabase
      .from('tenant_sites')
      .select('tenant_id, is_active')
      .eq('tenant_key', tenantKey)
      .single()

    if (siteError || !tenantSite) {
      return NextResponse.json(
        { error: { code: 'INVALID_TENANT_KEY', message: 'Invalid or unknown tenant key' } },
        { status: 400 }
      )
    }

    if (!tenantSite.is_active) {
      return NextResponse.json(
        { error: { code: 'TENANT_INACTIVE', message: 'This tenant is not active' } },
        { status: 403 }
      )
    }

    const tenantId = tenantSite.tenant_id

    // Fetch tenant info
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      return NextResponse.json(
        { error: { code: 'TENANT_NOT_FOUND', message: 'Tenant not found' } },
        { status: 404 }
      )
    }

    // Fetch active services with their media config and expected signals
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select('id, name, media_config, expected_signals')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name')

    if (servicesError) {
      console.error('Failed to fetch services:', servicesError)
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Failed to load services' } },
        { status: 500 }
      )
    }

    // Fetch pricing rules for all active services to get measurementModel
    const serviceIds = (services || []).map((s) => s.id)
    const { data: pricingRules } = await supabase
      .from('service_pricing_rules')
      .select('service_id, rules_json')
      .in('service_id', serviceIds.length > 0 ? serviceIds : ['__none__'])

    // Map pricing rules by service_id
    const pricingByService: Record<string, { measurementModel?: unknown }> = {}
    for (const rule of pricingRules || []) {
      const rulesJson = rule.rules_json as { measurementModel?: unknown } | null
      if (rulesJson?.measurementModel) {
        pricingByService[rule.service_id] = {
          measurementModel: rulesJson.measurementModel,
        }
      }
    }

    // Fetch ALL widget configs (global + per-service)
    const { data: widgetConfigs } = await supabase
      .from('widget_configs')
      .select('service_id, config_json')
      .eq('tenant_id', tenantId)

    // Separate global config from service-specific configs
    type FieldConfig = { fieldId: string; serviceId?: string | null; [key: string]: unknown }
    type ConfigJson = { fields?: FieldConfig[]; files?: unknown }
    let globalConfig: ConfigJson = {
      fields: [],
      files: {
        minPhotos: 0,
        maxPhotos: 8,
        maxDocs: 3,
      },
    }
    const serviceFieldsMap: Record<string, FieldConfig[]> = {}

    for (const cfg of widgetConfigs || []) {
      const configJson = cfg.config_json as ConfigJson | null
      if (!configJson) continue

      if (cfg.service_id === null) {
        // Global config - but fields may have individual serviceId properties
        globalConfig = configJson
      } else {
        // Service-specific config - extract fields
        if (configJson.fields && Array.isArray(configJson.fields)) {
          serviceFieldsMap[cfg.service_id] = configJson.fields
        }
      }
    }

    // Process global config fields - filter by serviceId property
    const allFields = globalConfig.fields || []
    const globalFields: FieldConfig[] = []

    for (const field of allFields) {
      if (!field.serviceId) {
        // Field has no serviceId - it's truly global
        globalFields.push(field)
      } else {
        // Field is scoped to a specific service
        const serviceId = field.serviceId
        if (!serviceFieldsMap[serviceId]) {
          serviceFieldsMap[serviceId] = []
        }
        serviceFieldsMap[serviceId].push(field)
      }
    }

    // Enhance services with pricing info and photo requirements
    interface MediaConfig {
      minPhotos?: number
      maxPhotos?: number
      photoGuidance?: string | null
      requiredAngles?: Array<{ id: string; label: string; guidance?: string }>
    }
    const enhancedServices = (services || []).map((service) => {
      const mediaConfig = (service.media_config as MediaConfig) || {}
      return {
        id: service.id,
        name: service.name,
        mediaConfig: {
          minPhotos: mediaConfig.minPhotos ?? 1,
          maxPhotos: mediaConfig.maxPhotos ?? 8,
          photoGuidance: mediaConfig.photoGuidance || null,
          requiredAngles: mediaConfig.requiredAngles || [],
        },
        measurementModel: pricingByService[service.id]?.measurementModel || null,
        expectedSignals: service.expected_signals || [],
      }
    })

    return NextResponse.json({
      tenantName: tenant.name,
      services: enhancedServices,
      // Keep 'fields' for backwards compatibility (contains global fields only)
      fields: globalFields,
      // New structured response
      globalFields: globalFields,
      serviceFields: serviceFieldsMap,
      files: globalConfig.files || {
        minPhotos: 0,
        maxPhotos: 8,
        maxDocs: 3,
      },
    })
  } catch (error) {
    console.error('Widget config error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
