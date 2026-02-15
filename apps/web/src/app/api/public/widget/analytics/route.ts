import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * POST /api/public/widget/analytics
 *
 * Records widget analytics events for A/B testing.
 * Events: widget_opened, widget_completed, widget_abandoned
 */

interface AnalyticsEvent {
  tenantKey: string
  event: 'widget_opened' | 'widget_completed' | 'widget_abandoned'
  mode: 'form' | 'conversational'
  metadata?: Record<string, string | number | boolean>
}

export async function POST(request: Request) {
  try {
    const body: AnalyticsEvent = await request.json()

    if (!body.tenantKey || !body.event || !body.mode) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'tenantKey, event, and mode are required' } },
        { status: 400 }
      )
    }

    const validEvents = ['widget_opened', 'widget_completed', 'widget_abandoned']
    if (!validEvents.includes(body.event)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid event type' } },
        { status: 400 }
      )
    }

    const validModes = ['form', 'conversational']
    if (!validModes.includes(body.mode)) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid widget mode' } },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Resolve tenant from tenantKey
    const { data: tenantSite, error: siteError } = await supabase
      .from('tenant_sites')
      .select('tenant_id')
      .eq('tenant_key', body.tenantKey)
      .single()

    if (siteError || !tenantSite) {
      return NextResponse.json(
        { error: { code: 'INVALID_TENANT_KEY', message: 'Invalid tenant key' } },
        { status: 400 }
      )
    }

    // Insert analytics event
    const { error: insertError } = await supabase
      .from('widget_analytics')
      .insert({
        tenant_id: tenantSite.tenant_id,
        event: body.event,
        widget_mode: body.mode,
        metadata_json: body.metadata || null,
        page_url: (body.metadata?.pageUrl as string) || null,
      })

    if (insertError) {
      console.error('[WidgetAnalytics] Failed to insert event:', insertError)
      // Don't fail the request for analytics — it's non-critical
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[WidgetAnalytics] Error:', error)
    // Analytics should never block the user experience
    return NextResponse.json({ ok: true })
  }
}
