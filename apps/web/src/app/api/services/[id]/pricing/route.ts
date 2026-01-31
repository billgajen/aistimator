import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import type { PricingRules } from '@estimator/shared'

/**
 * GET /api/services/[id]/pricing
 * Get pricing rules for a service
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

    // Verify service belongs to tenant
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (serviceError || !service) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Service not found' } },
        { status: 404 }
      )
    }

    // Fetch pricing rules
    const { data: pricingRule, error: pricingError } = await supabase
      .from('service_pricing_rules')
      .select('*')
      .eq('service_id', id)
      .single()

    if (pricingError && pricingError.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      console.error('Error fetching pricing rules:', pricingError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to fetch pricing rules' } },
        { status: 500 }
      )
    }

    // Return default rules if none exist
    const rules: PricingRules = pricingRule?.rules_json || {
      baseFee: 0,
      minimumCharge: 0,
      addons: [],
      multipliers: [],
    }

    return NextResponse.json({ rules, id: pricingRule?.id })
  } catch (error) {
    console.error('Pricing GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/services/[id]/pricing
 * Update pricing rules for a service
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Verify service belongs to tenant
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (serviceError || !service) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Service not found' } },
        { status: 404 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const rules = body.rules as PricingRules

    if (!rules || typeof rules !== 'object') {
      return NextResponse.json(
        { error: { code: 'INVALID_INPUT', message: 'Invalid pricing rules' } },
        { status: 400 }
      )
    }

    // Validate rules structure
    const validationErrors: string[] = []

    if (typeof rules.baseFee !== 'number' || rules.baseFee < 0) {
      validationErrors.push('baseFee must be a non-negative number')
    }
    if (typeof rules.minimumCharge !== 'number' || rules.minimumCharge < 0) {
      validationErrors.push('minimumCharge must be a non-negative number')
    }
    if (!Array.isArray(rules.addons)) {
      validationErrors.push('addons must be an array')
    } else {
      rules.addons.forEach((addon, i) => {
        if (!addon.id || !addon.label || typeof addon.price !== 'number') {
          validationErrors.push(`addon[${i}] must have id, label, and price`)
        }
      })
    }
    if (!Array.isArray(rules.multipliers)) {
      validationErrors.push('multipliers must be an array')
    } else {
      rules.multipliers.forEach((mult, i) => {
        if (!mult.when || typeof mult.multiplier !== 'number') {
          validationErrors.push(`multiplier[${i}] must have when condition and multiplier value`)
        }
      })
    }

    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: validationErrors.join('; ') } },
        { status: 400 }
      )
    }

    // Upsert pricing rules
    const { data: pricingRule, error: upsertError } = await supabase
      .from('service_pricing_rules')
      .upsert(
        {
          tenant_id: profile.tenant_id,
          service_id: id,
          rules_json: rules,
        },
        {
          onConflict: 'service_id',
        }
      )
      .select()
      .single()

    if (upsertError) {
      console.error('Error upserting pricing rules:', upsertError)
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to save pricing rules' } },
        { status: 500 }
      )
    }

    return NextResponse.json({ rules: pricingRule.rules_json, id: pricingRule.id })
  } catch (error) {
    console.error('Pricing PUT error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
