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
 * GET /api/services/[id]
 * Get a single service by ID
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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

    // Fetch service with pricing rules
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select(`
        *,
        service_pricing_rules (
          rules_json
        )
      `)
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (serviceError || !service) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Service not found' } },
        { status: 404 }
      )
    }

    // Transform to include pricing_rules at top level for frontend compatibility
    const pricingRule = Array.isArray(service.service_pricing_rules)
      ? service.service_pricing_rules[0]
      : service.service_pricing_rules
    const serviceWithPricing = {
      ...service,
      pricing_rules: pricingRule?.rules_json || null,
      service_pricing_rules: undefined,
    }

    return NextResponse.json({ service: serviceWithPricing })
  } catch (error) {
    console.error('Service GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/services/[id]
 * Update a service
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
      active,
      documentTypeDefault,
      scopeIncludes,
      scopeExcludes,
      defaultAssumptions,
      mediaConfig,
      workSteps,
      expectedSignals,
      draftConfig,
      pricingRules,  // BUG-003 FIX: Extract pricingRules from request body
    } = body as {
      name?: string
      description?: string | null
      active?: boolean
      documentTypeDefault?: DocumentType
      scopeIncludes?: string[]
      scopeExcludes?: string[]
      defaultAssumptions?: string[]
      mediaConfig?: ServiceMediaConfig
      workSteps?: WorkStepConfig[]
      expectedSignals?: ExpectedSignalConfig[]
      draftConfig?: ServiceDraftConfig | null
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

    // Build update object
    const updates: Record<string, unknown> = {}
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: { code: 'INVALID_INPUT', message: 'Service name cannot be empty' } },
          { status: 400 }
        )
      }
      updates.name = name.trim()
    }
    if (description !== undefined) {
      updates.description = description
    }
    if (active !== undefined) {
      updates.active = Boolean(active)
    }
    if (documentTypeDefault !== undefined) {
      updates.document_type_default = documentTypeDefault
    }
    if (scopeIncludes !== undefined) {
      updates.scope_includes = scopeIncludes
    }
    if (scopeExcludes !== undefined) {
      updates.scope_excludes = scopeExcludes
    }
    if (defaultAssumptions !== undefined) {
      updates.default_assumptions = defaultAssumptions
    }
    // Note: detection_keywords and prompt_context are auto-generated by the worker, not updated from UI
    if (mediaConfig !== undefined) {
      updates.media_config = mediaConfig
    }
    if (workSteps !== undefined) {
      updates.work_steps = workSteps
    }
    if (expectedSignals !== undefined) {
      updates.expected_signals = expectedSignals
    }
    if (draftConfig !== undefined) {
      updates.draft_config = draftConfig
      if (draftConfig) {
        updates.draft_config_generated_at = new Date().toISOString()
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'No valid fields to update' } },
        { status: 400 }
      )
    }

    // Update service
    const { data: service, error: updateError } = await supabase
      .from('services')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating service:', updateError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to update service' } },
        { status: 500 }
      )
    }

    if (!service) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Service not found' } },
        { status: 404 }
      )
    }

    // BUG-003 FIX: Update pricing rules if provided
    if (pricingRules) {
      const { error: pricingError } = await supabase
        .from('service_pricing_rules')
        .upsert({
          tenant_id: profile.tenant_id,
          service_id: id,
          rules_json: {
            baseFee: pricingRules.baseFee ?? 0,
            minimumCharge: pricingRules.minimumCharge ?? 0,
            addons: pricingRules.addons || [],
            multipliers: pricingRules.multipliers || [],
            workSteps: pricingRules.workSteps || workSteps || [],
          },
        }, { onConflict: 'service_id' })

      if (pricingError) {
        console.error('[API] Failed to update pricing rules:', pricingError)
        // Don't fail the request - service was updated successfully
      }
    }

    // Sync widget_configs when draftConfig has suggestedFields
    if (draftConfig?.suggestedFields && draftConfig.suggestedFields.length > 0) {
      const widgetFields = draftConfig.suggestedFields.map((f) => ({
        fieldId: f.fieldId,
        label: f.label,
        type: f.type === 'dropdown' ? 'select' : f.type === 'boolean' ? 'boolean' : f.type,
        required: f.required || f.criticalForPricing || false,
        placeholder: f.helpText || undefined,
        helpText: f.helpText || undefined,
        criticalForPricing: f.criticalForPricing || false,
        mapsToSignal: f.mapsToSignal || undefined,
        ...(f.options && f.options.length > 0 && {
          options: f.options.map((opt: string) => ({ value: opt.toLowerCase().replace(/\s+/g, '_'), label: opt })),
        }),
      }))

      // Check if widget config already exists for this service
      const { data: existingConfig } = await supabase
        .from('widget_configs')
        .select('id, config_json')
        .eq('service_id', id)
        .eq('tenant_id', profile.tenant_id)
        .single()

      if (existingConfig) {
        // Update existing config, preserving files settings
        const existingJson = existingConfig.config_json as Record<string, unknown> | null
        const { error: widgetError } = await supabase
          .from('widget_configs')
          .update({
            config_json: {
              fields: widgetFields,
              files: (existingJson as { files?: unknown })?.files || { minPhotos: 1, maxPhotos: 8, maxDocs: 3 },
            },
          })
          .eq('id', existingConfig.id)

        if (widgetError) {
          console.error('[API] Failed to update widget config:', widgetError)
        }
      } else {
        // Insert new widget config
        const { error: widgetError } = await supabase.from('widget_configs').insert({
          tenant_id: profile.tenant_id,
          service_id: id,
          config_json: {
            fields: widgetFields,
            files: mediaConfig || { minPhotos: 1, maxPhotos: 8, maxDocs: 3 },
          },
        })

        if (widgetError) {
          console.error('[API] Failed to create widget config:', widgetError)
        }
      }
    }

    // Return service with pricing rules included
    const serviceWithPricing = {
      ...service,
      pricing_rules: pricingRules || null,
    }

    return NextResponse.json({ service: serviceWithPricing })
  } catch (error) {
    console.error('Service PATCH error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/services/[id]
 * Delete a service
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    // Check if service has quotes
    const { count: quoteCount } = await supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', id)

    if (quoteCount && quoteCount > 0) {
      return NextResponse.json(
        {
          error: {
            code: 'HAS_QUOTES',
            message: 'Cannot delete service with existing quotes. Disable it instead.',
          },
        },
        { status: 400 }
      )
    }

    // Delete service (pricing rules will cascade)
    const { error: deleteError } = await supabase
      .from('services')
      .delete()
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)

    if (deleteError) {
      console.error('Error deleting service:', deleteError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to delete service' } },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Service DELETE error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
