/**
 * GET/PUT /api/sms/config — the tenant's Twilio number + A2P 10DLC checklist (T-136).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { getRegion } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { isSmsTestMode, normalizePhone } from '@/lib/sms'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const { data: config } = await supabase
    .from('sms_configs')
    .select('phone_number, messaging_service_sid, is_active, a2p_brand_registered, a2p_campaign_registered, updated_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  // Segment usage this calendar month (cost visibility, no billing change)
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const { data: rows } = await supabase
    .from('sms_messages')
    .select('segments, direction')
    .eq('tenant_id', tenantId)
    .gte('created_at', monthStart.toISOString())
  const outboundSegments = (rows || [])
    .filter((r) => r.direction === 'outbound')
    .reduce((s, r) => s + (Number(r.segments) || 0), 0)

  const appUrl = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return NextResponse.json({
    configured: Boolean(config),
    config: config
      ? {
          phoneNumber: config.phone_number,
          messagingServiceSid: config.messaging_service_sid,
          isActive: config.is_active,
          a2pBrandRegistered: config.a2p_brand_registered,
          a2pCampaignRegistered: config.a2p_campaign_registered,
        }
      : null,
    setup: {
      webhookUrl: `${appUrl.replace(/\/$/, '')}/api/sms/webhook`,
      testMode: isSmsTestMode(),
    },
    usage: { outboundSegmentsThisMonth: outboundSegments },
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const body = (await request.json().catch(() => ({}))) as {
    phoneNumber?: string
    messagingServiceSid?: string | null
    isActive?: boolean
    a2pBrandRegistered?: boolean
    a2pCampaignRegistered?: boolean
  }
  if (!body.phoneNumber?.trim()) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'Phone number is required' } }, { status: 400 })
  }
  const { data: tenant } = await supabase.from('tenants').select('region').eq('id', tenantId).single()
  const phone = normalizePhone(body.phoneNumber, getRegion((tenant as { region?: string } | null)?.region).callingCode)
  if (!/^\+\d{8,15}$/.test(phone)) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'Enter a full phone number, e.g. +15125550100' } }, { status: 400 })
  }
  const sid = body.messagingServiceSid?.trim() || null
  if (sid && !/^MG[0-9a-f]{32}$/i.test(sid)) {
    return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'Messaging Service SID starts with MG' } }, { status: 400 })
  }

  const { error } = await supabase.from('sms_configs').upsert(
    {
      tenant_id: tenantId,
      phone_number: phone,
      messaging_service_sid: sid,
      is_active: body.isActive ?? true,
      a2p_brand_registered: Boolean(body.a2pBrandRegistered),
      a2p_campaign_registered: Boolean(body.a2pCampaignRegistered),
    },
    { onConflict: 'tenant_id' }
  )
  if (error) {
    const taken = error.code === '23505'
    return NextResponse.json(
      { error: { code: taken ? 'NUMBER_IN_USE' : 'DB_ERROR', message: taken ? 'That number is connected to another business' : 'Failed to save' } },
      { status: taken ? 409 : 500 }
    )
  }
  return NextResponse.json({ saved: true, phoneNumber: phone })
}
