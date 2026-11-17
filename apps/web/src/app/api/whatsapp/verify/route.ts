import { type NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { decryptToken } from '@/lib/whatsapp'
import { GraphError, META_ERROR, numberDetails } from '@/lib/whatsapp-graph'

/**
 * POST /api/whatsapp/verify (T-112)
 *
 * Checks WhatsApp credentials against Meta before they are saved (the manual
 * method), or re-tests the stored connection ({ useStored: true }). A
 * read-only call to Meta; nothing is stored here. T-175: the stored row is
 * read with the service role, for the caller's own tenant.
 */
export async function POST(request: NextRequest) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  try {
    const body = (await request.json().catch(() => null)) as { phoneNumberId?: string; accessToken?: string; useStored?: boolean } | null
    let phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : ''
    let accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''

    if (body?.useStored) {
      const { data: config } = await createAdminClient()
        .from('whatsapp_configs')
        .select('phone_number_id, access_token_encrypted')
        .eq('tenant_id', auth.tenantId)
        .maybeSingle()
      if (!config) {
        return NextResponse.json({ error: { code: 'NOT_CONFIGURED', message: 'WhatsApp is not connected yet' } }, { status: 404 })
      }
      phoneNumberId = config.phone_number_id as string
      try {
        accessToken = decryptToken(config.access_token_encrypted as string)
      } catch {
        return NextResponse.json({ error: { code: 'TOKEN_ERROR', message: 'The stored connection could not be read. Please reconnect.' } }, { status: 500 })
      }
    }

    if (!/^\d{5,32}$/.test(phoneNumberId) || !accessToken) {
      return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'phoneNumberId and accessToken are required' } }, { status: 400 })
    }

    // Read-only: proves the token is valid AND belongs to this phone number
    const number = await numberDetails(accessToken, phoneNumberId)
    return NextResponse.json({
      verified: true,
      displayPhoneNumber: number.displayPhoneNumber || null,
      verifiedName: number.verifiedName,
      qualityRating: number.qualityRating,
    })
  } catch (error) {
    if (error instanceof GraphError && error.status !== 0) {
      const message =
        error.code === META_ERROR.TOKEN
          ? 'The access token is invalid or expired. Reconnect, or for a manual connection generate a permanent token in Meta Business Settings → System Users.'
          : error.code === 100
            ? "The Phone Number ID wasn't found for this token. Copy the Phone Number ID (not the phone number itself) from the WhatsApp API Setup page."
            : 'Meta did not accept these details. Check them and try again.'
      return NextResponse.json({ error: { code: 'VERIFICATION_FAILED', message } }, { status: 422 })
    }
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Could not reach the WhatsApp API. Try again.' } }, { status: 500 })
  }
}
