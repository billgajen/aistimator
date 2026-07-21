import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/whatsapp'
import { type NextRequest, NextResponse } from 'next/server'

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0' // matches lib/whatsapp.ts

/**
 * POST /api/whatsapp/verify (T-112)
 *
 * Validates WhatsApp Business API credentials against the Graph API BEFORE
 * they're saved (guided setup), or re-tests the stored connection
 * ({ useStored: true }). Read-only Graph call — nothing is persisted here.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

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

    const body = (await request.json()) as {
      phoneNumberId?: string
      accessToken?: string
      useStored?: boolean
    }

    let phoneNumberId = body.phoneNumberId?.trim()
    let accessToken = body.accessToken?.trim()

    // Test the stored connection instead of new credentials
    if (body.useStored) {
      const admin = createAdminClient()
      const { data: config } = await admin
        .from('whatsapp_configs')
        .select('phone_number_id, access_token_encrypted')
        .eq('tenant_id', profile.tenant_id)
        .single()

      if (!config) {
        return NextResponse.json(
          { error: { code: 'NOT_CONFIGURED', message: 'WhatsApp is not connected yet' } },
          { status: 404 }
        )
      }
      phoneNumberId = config.phone_number_id
      try {
        accessToken = decryptToken(config.access_token_encrypted)
      } catch {
        return NextResponse.json(
          { error: { code: 'TOKEN_ERROR', message: 'Stored access token could not be read — please reconnect' } },
          { status: 500 }
        )
      }
    }

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'phoneNumberId and accessToken are required' } },
        { status: 400 }
      )
    }

    // Read-only Graph call: proves the token is valid AND belongs to this phone number
    const response = await fetch(
      `${GRAPH_API_URL}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    const data = (await response.json()) as {
      display_phone_number?: string
      verified_name?: string
      quality_rating?: string
      error?: { message?: string; code?: number }
    }

    if (!response.ok || data.error) {
      // Translate the most common Meta errors into plain language
      const metaMessage = data.error?.message || `HTTP ${response.status}`
      let friendly = `Meta rejected the credentials: ${metaMessage}`
      if (data.error?.code === 190) {
        friendly = 'The access token is invalid or expired. Generate a permanent token in Meta Business Settings → System Users.'
      } else if (data.error?.code === 100) {
        friendly = "The Phone Number ID wasn't found for this token. Double-check you copied the Phone Number ID (not the phone number itself) from the WhatsApp API Setup page."
      }
      return NextResponse.json(
        { error: { code: 'VERIFICATION_FAILED', message: friendly } },
        { status: 422 }
      )
    }

    return NextResponse.json({
      verified: true,
      displayPhoneNumber: data.display_phone_number || null,
      verifiedName: data.verified_name || null,
      qualityRating: data.quality_rating || null,
    })
  } catch (error) {
    console.error('WhatsApp verify error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Could not reach the WhatsApp API — try again' } },
      { status: 500 }
    )
  }
}
