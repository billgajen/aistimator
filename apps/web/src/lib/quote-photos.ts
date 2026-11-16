/**
 * T-169: the customer's photos on the dashboard.
 *
 * A photo is never given to the page as a storage URL. The page gets a path
 * on our own site, /api/quotes/:quoteId/photos/:assetId, which checks the
 * business's sign-in and tenant and then redirects to a signed URL that
 * lasts a few minutes. Every lookup here is filtered by the tenant, and no
 * URL or key is logged.
 */
import type { QuotePhoto } from '@qolumns/shared'
import type { createClient } from '@/lib/supabase/server'
import { smallSizeUrl } from '@/lib/small-photo'

type Supabase = Awaited<ReturnType<typeof createClient>>

/** How long the signed URL behind a dashboard photo lasts */
export const DASHBOARD_PHOTO_URL_SECONDS = 300

export const quotePhotoUrl = (quoteId: string, assetId: string) => `/api/quotes/${quoteId}/photos/${assetId}`

/** A request row's asset ids, whatever shape the join came back in */
export function assetIdsOf(request: unknown): string[] {
  const row = Array.isArray(request) ? request[0] : request
  const ids = (row as { asset_ids?: unknown } | null | undefined)?.asset_ids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
}

/** Pure: the request's photos in the order the customer sent them (documents and unknown ids are left out) */
export function photosInOrder(quoteId: string, assetIds: string[], imageIds: ReadonlySet<string>): QuotePhoto[] {
  // T-172: smallUrl is the same photo at its small size (the original, if it has no small copy)
  return assetIds.filter((id) => imageIds.has(id)).map((id) => {
    const url = quotePhotoUrl(quoteId, id)
    return { id, url, smallUrl: smallSizeUrl(url) }
  })
}

/** Which of these asset ids are this tenant's photos (one query, however many quotes) */
async function imageIdsOf(supabase: Supabase, tenantId: string, assetIds: string[]): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set()
  const { data } = await supabase.from('assets').select('id').eq('tenant_id', tenantId).eq('type', 'image').in('id', assetIds)
  return new Set((data ?? []).map((a: { id: string }) => a.id))
}

/** Every photo of one quote */
export async function quotePhotos(supabase: Supabase, tenantId: string, quoteId: string, assetIds: string[]): Promise<QuotePhoto[]> {
  return photosInOrder(quoteId, assetIds, await imageIdsOf(supabase, tenantId, assetIds))
}

/** The first photo of each quote in a list, at its small size (a list row shows 48 px), by quote id (quotes with no photo are absent) */
export async function firstPhotoUrls(
  supabase: Supabase,
  tenantId: string,
  rows: Array<{ quoteId: string; assetIds: string[] }>
): Promise<Map<string, string>> {
  const images = await imageIdsOf(supabase, tenantId, rows.flatMap((r) => r.assetIds))
  const out = new Map<string, string>()
  for (const row of rows) {
    const first = photosInOrder(row.quoteId, row.assetIds, images)[0]
    if (first) out.set(row.quoteId, first.smallUrl ?? first.url)
  }
  return out
}
