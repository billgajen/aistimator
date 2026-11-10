import { createClient } from '@/lib/supabase/server'
import { serviceInsertRow, pricingRulesRow, widgetConfigRow, type ServiceCreateBody } from '@/lib/service-rows'
import { type NextRequest, NextResponse } from 'next/server'

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
    const body = (await request.json()) as ServiceCreateBody
    const { name, pricingRules, workSteps } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Service name is required' } },
        { status: 400 }
      )
    }

    // Create service (rows built by lib/service-rows, shared with the demo seed)
    const { data: service, error: createError } = await supabase
      .from('services')
      .insert(serviceInsertRow(profile.tenant_id, body))
      .select()
      .single()

    if (createError) {
      console.error('Error creating service:', createError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to create service' } },
        { status: 500 }
      )
    }

    const { error: pricingError } = await supabase
      .from('service_pricing_rules')
      .insert(pricingRulesRow(profile.tenant_id, service.id, body))

    if (pricingError) {
      console.error('Error creating pricing rules:', pricingError)
      // Don't fail the request, but log it
    }

    // Create widget config with suggested fields if provided
    const widgetRow = widgetConfigRow(profile.tenant_id, service.id, body)
    if (widgetRow) {
      const { error: widgetError } = await supabase.from('widget_configs').insert(widgetRow)

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
