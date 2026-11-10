/**
 * T-153: visitors' demo requests are deleted after 24 hours, with their
 * uploads, by the daily lifecycle cron (pass 3). Only rows of a tenant whose
 * `is_demo` is true are ever touched.
 *
 * Order: R2 objects → asset rows → quotes (their logs and amendments cascade)
 * → quote requests (quotes reference them with ON DELETE RESTRICT).
 */
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

export interface DemoCleanupResult {
  quotes: number
  requests: number
  assets: number
  objects: number
}

/** Pure: the cut-off for "older than the retention period" */
export function demoCutoff(now: Date, retentionHours: number): string {
  return new Date(now.getTime() - retentionHours * 3600 * 1000).toISOString()
}

export async function cleanUpDemoRequests(
  supabase: Admin,
  opts: { now?: Date; retentionHours: number; deleteObjects: ((keys: string[]) => Promise<number>) | null; batch?: number }
): Promise<DemoCleanupResult> {
  const cutoff = demoCutoff(opts.now ?? new Date(), opts.retentionHours)
  const batch = opts.batch ?? 500
  const out: DemoCleanupResult = { quotes: 0, requests: 0, assets: 0, objects: 0 }

  const { data: demoTenants } = await supabase.from('tenants').select('id').eq('is_demo', true)
  const tenantIds = (demoTenants ?? []).map((t) => t.id as string)
  if (tenantIds.length === 0) return out

  // Uploads and PDFs (attached or abandoned) older than the cut-off
  const { data: assets } = await supabase
    .from('assets')
    .select('id, r2_key')
    .in('tenant_id', tenantIds)
    .lt('created_at', cutoff)
    .limit(batch)
  const assetRows = assets ?? []
  if (assetRows.length > 0) {
    if (opts.deleteObjects) {
      try {
        out.objects = await opts.deleteObjects(assetRows.map((a) => a.r2_key as string))
      } catch (error) {
        // Keep the rows so the next run retries the objects
        console.error('[DemoCleanup] R2 delete failed; will retry tomorrow:', error)
        return out
      }
    }
    const { error } = await supabase.from('assets').delete().in('id', assetRows.map((a) => a.id as string))
    if (error) console.error('[DemoCleanup] Asset delete failed:', error)
    else out.assets = assetRows.length
  }

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, quote_request_id')
    .eq('is_demo', true)
    .in('tenant_id', tenantIds)
    .lt('created_at', cutoff)
    .limit(batch)
  const quoteRows = quotes ?? []
  if (quoteRows.length > 0) {
    const { error } = await supabase.from('quotes').delete().in('id', quoteRows.map((q) => q.id as string))
    if (error) {
      console.error('[DemoCleanup] Quote delete failed:', error)
      return out
    }
    out.quotes = quoteRows.length
  }

  // Requests older than the cut-off with no quote left
  const { data: requests } = await supabase
    .from('quote_requests')
    .select('id, quotes ( id )')
    .in('tenant_id', tenantIds)
    .lt('created_at', cutoff)
    .limit(batch)
  const orphanIds = (requests ?? [])
    .filter((r) => !((r as { quotes?: unknown[] }).quotes ?? []).length)
    .map((r) => r.id as string)
  if (orphanIds.length > 0) {
    const { error } = await supabase.from('quote_requests').delete().in('id', orphanIds)
    if (error) console.error('[DemoCleanup] Request delete failed:', error)
    else out.requests = orphanIds.length
  }
  return out
}
