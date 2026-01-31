import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /api/me
 * Returns the current user's context including userId, tenantId, and role.
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

    // Get user profile with tenant info
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('tenant_id, role, display_name')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      // User exists but doesn't have a profile yet
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    return NextResponse.json({
      userId: user.id,
      tenantId: profile.tenant_id,
      role: profile.role,
      email: user.email,
      displayName: profile.display_name,
    })
  } catch (error) {
    console.error('Get me error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
