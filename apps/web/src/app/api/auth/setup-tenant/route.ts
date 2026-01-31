import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface SetupTenantRequest {
  businessName: string
}

/**
 * POST /api/auth/setup-tenant
 * Creates a new tenant and links the current user to it.
 * Called after signup to complete account setup.
 */
export async function POST(request: Request) {
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

    // Check if user already has a tenant
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (existingProfile) {
      return NextResponse.json(
        { error: { code: 'ALREADY_EXISTS', message: 'User already has a tenant' } },
        { status: 409 }
      )
    }

    // Parse request body
    const body: SetupTenantRequest = await request.json()
    const { businessName } = body

    if (!businessName || businessName.trim().length === 0) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Business name is required' } },
        { status: 400 }
      )
    }

    // Use admin client to create tenant and profile (bypasses RLS)
    const adminClient = createAdminClient()

    // Create tenant
    const { data: tenant, error: tenantError } = await adminClient
      .from('tenants')
      .insert({
        name: businessName.trim(),
      })
      .select()
      .single()

    if (tenantError) {
      console.error('Failed to create tenant:', tenantError)
      return NextResponse.json(
        { error: { code: 'CREATE_FAILED', message: 'Failed to create tenant' } },
        { status: 500 }
      )
    }

    // Create user profile linking to tenant
    const { error: profileError } = await adminClient.from('user_profiles').insert({
      id: user.id,
      tenant_id: tenant.id,
      role: 'admin',
      display_name: user.email?.split('@')[0] || 'Admin',
    })

    if (profileError) {
      console.error('Failed to create user profile:', profileError)
      // Clean up tenant if profile creation fails
      await adminClient.from('tenants').delete().eq('id', tenant.id)
      return NextResponse.json(
        { error: { code: 'CREATE_FAILED', message: 'Failed to create user profile' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
    })
  } catch (error) {
    console.error('Setup tenant error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
