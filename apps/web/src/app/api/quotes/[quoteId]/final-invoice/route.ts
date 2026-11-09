import { NextResponse } from 'next/server'
import { parseMoneyInput } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'

/**
 * PUT /api/quotes/:quoteId/final-invoice (T-143) — the business records what
 * it finally invoiced. Body: { amount: number | string, note?: string | null }.
 * `amount: null` clears it. Tenant-scoped; works from the dashboard (cookie)
 * and the business app (bearer).
 */
export async function PUT(request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response

  let body: { amount?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }

  const clearing = body.amount === null
  const amount = clearing ? null : parseMoneyInput(body.amount)
  if (!clearing && amount === null) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'amount must be a positive money amount' } }, { status: 400 })
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

  const { data, error } = await auth.supabase
    .from('quotes')
    .update({
      final_invoice_amount: amount,
      final_invoice_note: clearing ? null : note,
      final_invoice_recorded_at: clearing ? null : new Date().toISOString(),
    })
    .eq('id', params.quoteId)
    .eq('tenant_id', auth.tenantId)
    .select('id, final_invoice_amount, final_invoice_recorded_at, final_invoice_note')
    .maybeSingle()

  if (error) {
    console.error('[FinalInvoice] Update failed:', error.message)
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Could not save the invoice' } }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  }
  return NextResponse.json({
    quoteId: data.id,
    finalInvoiceAmount: data.final_invoice_amount === null ? null : Number(data.final_invoice_amount),
    finalInvoiceRecordedAt: data.final_invoice_recorded_at,
    finalInvoiceNote: data.final_invoice_note,
  })
}
