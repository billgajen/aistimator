import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { splitMinimum } from '@qolumns/shared'

/**
 * GET /api/onboarding/test-quote?since=<ISO time>
 * T-150: the owner's latest test request made since the test link was issued
 * (own tenant only, RLS + explicit tenant filter). `quote` is null until the
 * request arrives.
 */
export async function GET(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const since = new URL(request.url).searchParams.get('since')
  if (!since || Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: { code: 'INVALID_SINCE', message: 'since must be an ISO time' } }, { status: 400 })
  }
  const { data } = await auth.supabase
    .from('quotes')
    .select('id, status, pricing_json, content_json, customer_json, created_at, services!service_id ( name )')
    .eq('tenant_id', auth.tenantId)
    .eq('is_test', true)
    .gte('created_at', new Date(Date.parse(since) - 5000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
  const quote = data?.[0]
  if (!quote) return NextResponse.json({ quote: null })
  const pricing = (quote.pricing_json ?? {}) as { currency?: string; subtotal?: number; taxAmount?: number; taxLabel?: string; total?: number; breakdown?: Array<{ label?: string; description?: string; amount: number; kind?: string; minimumCharge?: number }> }
  const { lines, minimum } = splitMinimum(
    (pricing.breakdown ?? []).map((l) => ({ ...l, label: l.label ?? l.description ?? '', amount: Number(l.amount) || 0 }))
  )
  return NextResponse.json({
    quote: {
      id: quote.id,
      status: quote.status,
      serviceName: (quote.services as unknown as { name?: string } | null)?.name ?? null,
      currency: pricing.currency ?? null,
      subtotal: pricing.subtotal ?? 0,
      taxAmount: pricing.taxAmount ?? 0,
      taxLabel: pricing.taxLabel ?? null,
      total: pricing.total ?? 0,
      lines: lines.map((l) => ({ label: l.label, amount: l.amount })),
      // The minimum charge is a floor, not an item: sent apart from the lines, shown as a note
      minimumCharge: minimum?.minimumCharge ?? null,
      scopeSummary: (quote.content_json as { scopeSummary?: string } | null)?.scopeSummary ?? null,
    },
  })
}
