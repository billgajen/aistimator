import { createClient } from '@/lib/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'
import { previewInput, previewPriceNow, type PreviewRequest } from '@/lib/pricing-preview'

/**
 * POST /api/services/preview-price (T-204)
 *
 * The test price on a service's "Test & Publish" step: the service as the
 * editor holds it, priced from sample answers by the worker's own pipeline.
 * Nothing is saved, no quote is made and nothing is counted.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, { status: 401 })

    const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
    if (!profile?.tenant_id) return NextResponse.json({ error: { code: 'NO_TENANT', message: 'User has no tenant' } }, { status: 404 })

    const body = (await request.json().catch(() => null)) as PreviewRequest | null
    if (!body?.service || typeof body.service.name !== 'string' || typeof body.values !== 'object' || body.values === null) {
      return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'service and values are required' } }, { status: 400 })
    }
    if (JSON.stringify(body).length > 200_000) {
      return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'The service is too large to test' } }, { status: 400 })
    }

    // A saved service's tax setting applies to its test price too. Only this business's own service is read.
    let taxExempt = false
    let serviceId: string | undefined
    if (typeof body.serviceId === 'string' && body.serviceId) {
      const { data: saved } = await supabase.from('services').select('id, tax_exempt').eq('id', body.serviceId).eq('tenant_id', profile.tenant_id).maybeSingle()
      if (saved) {
        serviceId = saved.id as string
        taxExempt = (saved as { tax_exempt?: boolean | null }).tax_exempt === true
      }
    }

    const { input, sampled } = previewInput(profile.tenant_id, { service: body.service, values: body.values, serviceId }, taxExempt)
    const priced = await previewPriceNow(input)
    if (!priced.success) {
      return NextResponse.json(
        { error: { code: 'PREVIEW_UNAVAILABLE', message: 'The test price is not available right now. Try again in a moment.' } },
        { status: priced.reason === 'unreachable' ? 503 : 502 }
      )
    }
    const price = { currency: priced.currency, lines: priced.lines, subtotal: priced.subtotal, taxLabel: priced.taxLabel, taxRate: priced.taxRate, taxAmount: priced.taxAmount, total: priced.total, notes: priced.notes, steps: priced.steps, unmeasured: priced.unmeasured }
    return NextResponse.json({ price, sampled })
  } catch (error) {
    console.error('Preview price error:', error instanceof Error ? error.name : 'unknown error')
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'The test price could not be worked out' } }, { status: 500 })
  }
}
