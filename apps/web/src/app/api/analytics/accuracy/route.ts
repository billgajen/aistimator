import { NextResponse } from 'next/server'
import { computeAccuracy, hasSections, type InvoicedQuote } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'

/**
 * GET /api/analytics/accuracy (T-143) — estimate accuracy against recorded
 * final invoices, per service and per estimate grade (computeAccuracy).
 * Quotes are compared on the total the customer was quoted (pricing_json.total).
 */
export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from('quotes')
    .select('pricing_json, final_invoice_amount, service:services(name)')
    .eq('tenant_id', auth.tenantId)
    // T-204: a setup test is in no Analytics figure
    .eq('is_test', false)
    .not('final_invoice_amount', 'is', null)
    .order('final_invoice_recorded_at', { ascending: false })
    .limit(2000)

  if (error) {
    console.error('[Accuracy] Query failed:', error.message)
    return NextResponse.json({ error: { code: 'QUERY_FAILED', message: 'Could not load accuracy' } }, { status: 500 })
  }

  const rows: InvoicedQuote[] = (data || []).map((row) => {
    const pricing = (row.pricing_json || {}) as { total?: number; estimate?: { grade?: 'A' | 'B' | 'C' } }
    const service = row.service as { name?: string } | { name?: string }[] | null
    const serviceName = Array.isArray(service) ? service[0]?.name : service?.name
    return {
      serviceName: serviceName || 'Unknown service',
      quoted: Number(pricing.total ?? 0),
      invoiced: Number(row.final_invoice_amount),
      grade: pricing.estimate?.grade ?? null,
      // T-179: one invoice for several services says nothing about any one of them
      ...(hasSections(pricing) && { combined: true }),
    }
  })
  return NextResponse.json(computeAccuracy(rows))
}
