import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type {
  DocumentType,
  ServiceMediaConfig,
  WorkStepConfig,
  ExpectedSignalConfig,
  ServiceDraftConfig,
} from '@estimator/shared'

/**
 * GET /api/services
 * List all services for the current tenant
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

    // Fetch services with pricing rules
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select(`
        *,
        service_pricing_rules (
          rules_json
        )
      `)
      .eq('tenant_id', profile.tenant_id)
      .order('created_at', { ascending: false })

    if (servicesError) {
      console.error('Error fetching services:', servicesError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch services' } },
        { status: 500 }
      )
    }

    // Transform to include pricing_rules at top level for frontend compatibility
    const servicesWithPricing = (services || []).map((service) => {
      const pricingRule = Array.isArray(service.service_pricing_rules)
        ? service.service_pricing_rules[0]
        : service.service_pricing_rules
      return {
        ...service,
        pricing_rules: pricingRule?.rules_json || null,
        service_pricing_rules: undefined, // Remove nested object
      }
    })

    return NextResponse.json({ services: servicesWithPricing })
  } catch (error) {
    console.error('Services GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * POST /api/services
 * Create a new service
 */
export async function POST(request: NextRequest) {
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
    // Note: detectionKeywords and promptContext are auto-generated, not accepted from frontend
    const body = await request.json()
    const {
      name,
      description,
      documentTypeDefault,
      scopeIncludes,
      scopeExcludes,
      defaultAssumptions,
      mediaConfig,
      workSteps,
      expectedSignals,
      draftConfig,
      suggestedFields,
      pricingRules,  // BUG-003 FIX: Extract pricingRules from request body
    } = body as {
      name: string
      description?: string | null
      documentTypeDefault?: DocumentType
      scopeIncludes?: string[]
      scopeExcludes?: string[]
      defaultAssumptions?: string[]
      mediaConfig?: ServiceMediaConfig
      workSteps?: WorkStepConfig[]
      expectedSignals?: ExpectedSignalConfig[]
      draftConfig?: ServiceDraftConfig | null
      suggestedFields?: Array<{
        fieldId: string
        label: string
        type: string
        required: boolean
        options?: string[]
        helpText?: string
        criticalForPricing?: boolean
      }>
      // BUG-003 FIX: Type for pricingRules
      pricingRules?: {
        baseFee?: number
        minimumCharge?: number
        addons?: Array<{
          id: string
          label: string
          price: number
          description?: string
        }>
        multipliers?: Array<{
          id: string
          label: string
          conditions: Array<{ signalKey: string; operator: string; value: string | number | boolean }>
          multiplier: number
        }>
        workSteps?: WorkStepConfig[]
      }
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Service name is required' } },
        { status: 400 }
      )
    }

    // Create service
    // Note: detection_keywords and prompt_context are auto-generated by the worker, not set from UI
    const { data: service, error: createError } = await supabase
      .from('services')
      .insert({
        tenant_id: profile.tenant_id,
        name: name.trim(),
        description: description || null,
        active: true,
        document_type_default: documentTypeDefault || 'instant_estimate',
        scope_includes: scopeIncludes || [],
        scope_excludes: scopeExcludes || [],
        default_assumptions: defaultAssumptions || [],
        media_config: mediaConfig || { minPhotos: 1, maxPhotos: 8, photoGuidance: null },
        work_steps: workSteps || [],
        expected_signals: expectedSignals || [],
        draft_config: draftConfig || null,
        draft_config_version: draftConfig ? 1 : 0,
        draft_config_generated_at: draftConfig ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating service:', createError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to create service' } },
        { status: 500 }
      )
    }

    // BUG-003 FIX: Create pricing rules with actual values from request (not hardcoded zeros)
    const { error: pricingError } = await supabase.from('service_pricing_rules').insert({
      tenant_id: profile.tenant_id,
      service_id: service.id,
      rules_json: {
        baseFee: pricingRules?.baseFee || 0,
        minimumCharge: pricingRules?.minimumCharge || 0,
        addons: pricingRules?.addons || [],
        multipliers: pricingRules?.multipliers || [],
        workSteps: pricingRules?.workSteps || workSteps || [],
      },
    })

    if (pricingError) {
      console.error('Error creating pricing rules:', pricingError)
      // Don't fail the request, but log it
    }

    // Create widget config with suggested fields if provided
    // Fields can be in suggestedFields directly or inside draftConfig
    const fieldsToSave = suggestedFields || draftConfig?.suggestedFields
    if (fieldsToSave && fieldsToSave.length > 0) {
      // Convert suggestedFields to widget field format
      const widgetFields = fieldsToSave.map((f) => ({
        fieldId: f.fieldId,
        label: f.label,
        type: f.type === 'dropdown' ? 'select' : f.type === 'boolean' ? 'boolean' : f.type,
        required: f.required || f.criticalForPricing || false,
        placeholder: f.helpText || undefined,
        helpText: f.helpText || undefined,
        criticalForPricing: f.criticalForPricing || false,
        // Convert string[] options to {value, label} format
        ...(f.options && f.options.length > 0 && {
          options: f.options.map((opt) => ({ value: opt.toLowerCase().replace(/\s+/g, '_'), label: opt })),
        }),
      }))

      const { error: widgetError } = await supabase.from('widget_configs').insert({
        tenant_id: profile.tenant_id,
        service_id: service.id,
        config_json: {
          fields: widgetFields,
          files: mediaConfig || { minPhotos: 1, maxPhotos: 8, maxDocs: 3 },
        },
      })

      if (widgetError) {
        console.error('Error creating widget config:', widgetError)
        // Don't fail the request, but log it
      }
    }

    // Return service with pricing rules included
    const serviceWithPricing = {
      ...service,
      pricing_rules: pricingRules || {
        baseFee: 0,
        minimumCharge: 0,
        addons: [],
        multipliers: [],
        workSteps: workSteps || [],
      },
    }

    return NextResponse.json({ service: serviceWithPricing }, { status: 201 })
  } catch (error) {
    console.error('Services POST error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
