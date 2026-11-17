import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { currentTenant } from '@/lib/current-tenant'
import { disconnect, embeddedSignupAvailable, loadConnection, manualNeedsSecret, saveManualConnection } from '@/lib/whatsapp-connect'
import { GRAPH_API_VERSION } from '@/lib/whatsapp-graph'
import { EMBEDDED_SIGNUP_VERSION } from '@/lib/whatsapp-signup'
import { accessRefusal, accessView, whatsappAccess } from '@/lib/whatsapp-access'

export const dynamic = 'force-dynamic'

/**
 * T-175: the WhatsApp settings of the signed-in business.
 *
 * The stored row is server-only since migration 42, so every read and write is
 * made here with the service role, for the caller's own tenant and no other.
 * No response carries a token or a secret: the view is built field by field
 * (lib/whatsapp-state.ts).
 */

/**
 * GET /api/whatsapp/config
 * The connection as the page shows it, what the page needs to open Meta's
 * Embedded Signup (two public ids), and the two values of the manual method's
 * webhook step. T-177: also `access`, whether the plan allows WhatsApp, with
 * the one line to show when it does not.
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const config = await loadConnection(admin, auth.tenantId)
  // T-177: may this business use WhatsApp (its plan includes it and its subscription is live)?
  const access = accessView(await whatsappAccess(admin, auth.tenantId))
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return NextResponse.json({
    configured: Boolean(config),
    config,
    access,
    connect: {
      available: embeddedSignupAvailable(),
      appId: process.env.NEXT_PUBLIC_WHATSAPP_APP_ID || null,
      configId: process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID || null,
      graphVersion: GRAPH_API_VERSION,
      signupVersion: EMBEDDED_SIGNUP_VERSION,
    },
    // T-112: what a business pastes into its OWN Meta app (manual method). The
    // verify token is a handshake string, not a credential.
    setup: {
      webhookUrl: `${appUrl}/api/whatsapp/webhook`,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || null,
    },
    manualNeedsSecret: config?.method === 'manual' ? await manualNeedsSecret(admin, auth.tenantId) : false,
  })
}

/**
 * PUT /api/whatsapp/config  { phoneNumberId, displayPhoneNumber?, accessToken?, appSecret?, isActive? }
 * The manual method: save (or update) a connection through the business's own
 * Meta app. The token is checked with Meta, on the server, before it is saved.
 */
export async function PUT(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  // T-177: the plan must include WhatsApp, with a live subscription
  const refusal = accessRefusal(await whatsappAccess(admin, auth.tenantId))
  if (refusal) return NextResponse.json({ error: { code: refusal.code, message: refusal.message } }, { status: refusal.status })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = await saveManualConnection(admin, auth.tenantId, body ?? {})
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status })
  return NextResponse.json({ ok: true, config: result.connection })
}

/**
 * DELETE /api/whatsapp/config
 * Disconnect: Meta is asked to stop sending us the account's messages, and the
 * stored token is removed with the row.
 */
export async function DELETE() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  try {
    const result = await disconnect(createAdminClient(), auth.tenantId)
    return NextResponse.json({ ok: true, ...result })
  } catch {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not disconnect. Try again.' } }, { status: 500 })
  }
}
