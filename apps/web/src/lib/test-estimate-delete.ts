/**
 * T-202: a business deletes one of its own test estimates.
 *
 * Only a test (`quotes.is_test`), and only the business's own: a real quote
 * can never be deleted this way, whatever is asked. The delete itself repeats
 * both conditions, so a row that is not this business's test is not touched
 * even if the read before it was wrong.
 *
 * What goes: the stored files (photos, their small copies, the PDF), their
 * asset rows, the quote (its logs, amendments, approval links and push log
 * go with it; a report made on it keeps its text and loses the link), and the
 * request it came from. What stays: the day's count of test estimates
 * (tenants.test_estimate_times), so deleting a test does not hand one back.
 *
 * Order: files → quote → asset rows → request (a quote points at its request
 * with ON DELETE RESTRICT, so the request goes last). If the files cannot be
 * removed nothing else is, and the business can try again.
 */
import { smallPhotoKey } from '@/lib/small-photo'
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export type DeleteTestResult =
  | { kind: 'deleted'; assets: number }
  | { kind: 'not_found' }
  | { kind: 'not_a_test' }
  | { kind: 'failed'; step: 'files' | 'assets' | 'quote' }

/** Pure: may this quote be deleted as a test by this business? */
export function deletableAsTest(quote: { tenant_id?: string | null; is_test?: boolean | null; is_demo?: boolean | null } | null | undefined, tenantId: string): 'yes' | 'not_found' | 'not_a_test' {
  if (!quote || quote.tenant_id !== tenantId) return 'not_found'
  return quote.is_test === true && quote.is_demo !== true ? 'yes' : 'not_a_test'
}

export async function deleteTestEstimate(
  supabase: Admin,
  tenantId: string,
  quoteId: string,
  /** removes stored objects by key; null when storage is not set up (local development) */
  deleteObjects: ((keys: string[]) => Promise<number>) | null
): Promise<DeleteTestResult> {
  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, is_test, is_demo, quote_request_id, pdf_asset_id')
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const row = quote as { id: string; tenant_id: string; is_test?: boolean | null; is_demo?: boolean | null; quote_request_id?: string | null; pdf_asset_id?: string | null } | null
  const may = deletableAsTest(row, tenantId)
  if (may !== 'yes' || !row) return { kind: may === 'yes' ? 'not_found' : may }

  // the request's files: the ones it lists, the ones attached to it, and the quote's PDF
  const requestId = row.quote_request_id ?? null
  const { data: request } = requestId
    ? await supabase.from('quote_requests').select('id, asset_ids').eq('id', requestId).eq('tenant_id', tenantId).maybeSingle()
    : { data: null }
  const listed = Array.isArray((request as { asset_ids?: unknown } | null)?.asset_ids)
    ? ((request as { asset_ids: unknown[] }).asset_ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
    : []
  const wanted = [...new Set([...listed, ...(row.pdf_asset_id ? [row.pdf_asset_id] : [])])]
  const byId = wanted.length > 0 ? await supabase.from('assets').select('id, r2_key').eq('tenant_id', tenantId).in('id', wanted) : { data: [] }
  const byRequest = requestId ? await supabase.from('assets').select('id, r2_key').eq('tenant_id', tenantId).eq('quote_request_id', requestId) : { data: [] }
  const assets = new Map<string, string>()
  for (const asset of [...(byId.data ?? []), ...(byRequest.data ?? [])] as Array<{ id: string; r2_key: string }>) assets.set(asset.id, asset.r2_key)

  if (assets.size > 0 && deleteObjects) {
    try {
      const keys = [...assets.values()]
      await deleteObjects(keys)
      // a photo's small copy sits beside it under a derived key and has no row of its own (T-172)
      await deleteObjects(keys.map(smallPhotoKey))
    } catch (error) {
      // nothing is removed from the database, so the business can try again
      console.error('[TestEstimate] file delete failed:', error instanceof Error ? error.message : 'unknown')
      return { kind: 'failed', step: 'files' }
    }
  }

  // the quote first: it points at its PDF (SET NULL) and at its request (RESTRICT)
  const { data: gone, error: quoteError } = await supabase
    .from('quotes')
    .delete()
    .eq('id', quoteId)
    .eq('tenant_id', tenantId)
    .eq('is_test', true)
    .select('id')
  if (quoteError || (gone ?? []).length === 0) {
    console.error('[TestEstimate] quote delete failed:', quoteError?.code ?? 'no row')
    return { kind: 'failed', step: 'quote' }
  }

  if (assets.size > 0) {
    const { error } = await supabase.from('assets').delete().eq('tenant_id', tenantId).in('id', [...assets.keys()])
    if (error) console.error('[TestEstimate] asset rows not deleted:', error.code)
  }

  // the request, unless another quote still points at it
  if (requestId) {
    const { count } = await supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('quote_request_id', requestId)
    if ((count ?? 0) === 0) {
      const { error } = await supabase.from('quote_requests').delete().eq('id', requestId).eq('tenant_id', tenantId)
      if (error) console.error('[TestEstimate] request not deleted:', error.code)
    }
  }
  return { kind: 'deleted', assets: assets.size }
}
