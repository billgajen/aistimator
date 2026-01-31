import { createClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/whatsapp'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/whatsapp/config
 * Get WhatsApp configuration for current tenant
 */
export async function GET() {
  try {
    const supabase = await createClient()

    // Verify authentication
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

    // Get WhatsApp config
    const { data: config } = await supabase
      .from('whatsapp_configs')
      .select('id, phone_number_id, display_phone_number, is_active, created_at, updated_at')
      .eq('tenant_id', profile.tenant_id)
      .single()

    return NextResponse.json({
      configured: !!config,
      config: config
        ? {
            phoneNumberId: config.phone_number_id,
            displayPhoneNumber: config.display_phone_number,
            isActive: config.is_active,
            createdAt: config.created_at,
            updatedAt: config.updated_at,
          }
        : null,
    })
  } catch (error) {
    console.error('WhatsApp config GET error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

interface UpdateConfigRequest {
  phoneNumberId: string
  displayPhoneNumber: string
  accessToken: string
  isActive: boolean
}

/**
 * PUT /api/whatsapp/config
 * Update WhatsApp configuration for current tenant
 */
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()

    // Verify authentication
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

    const tenantId = profile.tenant_id
    const body: UpdateConfigRequest = await request.json()

    // Validate required fields
    if (!body.phoneNumberId || !body.displayPhoneNumber || !body.accessToken) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'phoneNumberId, displayPhoneNumber, and accessToken are required' } },
        { status: 400 }
      )
    }

    // Encrypt the access token
    const encryptedToken = encryptToken(body.accessToken)

    // Check if config exists
    const { data: existingConfig } = await supabase
      .from('whatsapp_configs')
      .select('id')
      .eq('tenant_id', tenantId)
      .single()

    if (existingConfig) {
      // Update existing config
      const { error } = await supabase
        .from('whatsapp_configs')
        .update({
          phone_number_id: body.phoneNumberId,
          display_phone_number: body.displayPhoneNumber,
          access_token_encrypted: encryptedToken,
          is_active: body.isActive,
        })
        .eq('tenant_id', tenantId)

      if (error) {
        console.error('WhatsApp config update error:', error)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to update configuration' } },
          { status: 500 }
        )
      }
    } else {
      // Create new config
      const { error } = await supabase.from('whatsapp_configs').insert({
        tenant_id: tenantId,
        phone_number_id: body.phoneNumberId,
        display_phone_number: body.displayPhoneNumber,
        access_token_encrypted: encryptedToken,
        is_active: body.isActive,
      })

      if (error) {
        console.error('WhatsApp config create error:', error)
        return NextResponse.json(
          { error: { code: 'DB_ERROR', message: 'Failed to create configuration' } },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('WhatsApp config PUT error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/whatsapp/config
 * Remove WhatsApp configuration for current tenant
 */
export async function DELETE() {
  try {
    const supabase = await createClient()

    // Verify authentication
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

    // Delete config
    await supabase
      .from('whatsapp_configs')
      .delete()
      .eq('tenant_id', profile.tenant_id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('WhatsApp config DELETE error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
