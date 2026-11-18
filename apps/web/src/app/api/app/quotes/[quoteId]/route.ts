import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { appQuoteView, appViewWantsPhotos, type AppQuoteRow } from '@/lib/app-quote-view'
import { assetIdsOf, DASHBOARD_PHOTO_URL_SECONDS } from '@/lib/quote-photos'
import { fieldLabels, requestDetails, type FieldRow } from '@/lib/request-details'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { photoKeyToServe } from '@/lib/small-photo-server'

export const dynamic = 'force-dynamic'

/** The app shows a strip of small pictures; a request can carry up to ten */
const MAX_PHOTOS = 10

/**
 * GET /api/app/quotes/:quoteId (T-137, T-182) — the view the business app
 * shows: whose turn it is, the price (range while provisional) and its lines,
 * the minimum-charge note, added services as sections, open confirmation
 * questions, and what was sent with the request (its answers and photos), so
 * a request that could not be priced can still be quoted by hand.
 *
 * Tenant-scoped by RLS and an explicit filter on every read. A photo is
 * answered as a signed address that lasts a few minutes, only for an asset
 * that belongs to this quote's request and to this tenant; neither the key
 * nor the address is logged. (The dashboard's photo route answers with a
 * redirect; a phone does not carry the sign-in across one.)
 */
export async function GET(_request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, status, created_at, customer_json, pricing_json, content_json, clarification_questions_json, service_id, sent_at, viewed_at, accepted_at, paid_at, declined_at, token_expires_at, request:quote_requests!quote_request_id (asset_ids, job_answers, job_postcode, job_address, job_quantity)'
    )
    .eq('id', params.quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (!quote) {
    return NextResponse.json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  }
  const [{ data: service }, { data: tenant }, { data: fieldRows }] = await Promise.all([
    supabase.from('services').select('name').eq('id', quote.service_id).single(),
    supabase.from('tenants').select('name').eq('id', tenantId).single(),
    supabase.from('widget_configs').select('service_id, config_json').eq('tenant_id', tenantId),
  ])

  const requestRow = ((r: unknown) => (Array.isArray(r) ? r[0] : r))((quote as { request?: unknown }).request) as
    | { asset_ids?: unknown; job_answers?: unknown; job_postcode?: string | null; job_address?: string | null; job_quantity?: number | null }
    | null
    | undefined

  const body = appQuoteView({
    quote: quote as unknown as AppQuoteRow,
    serviceName: (service?.name as string) || '',
    businessName: (tenant?.name as string) || '',
    request: requestDetails(requestRow, fieldLabels(fieldRows as FieldRow[] | null, quote.service_id as string | null)),
    photos: appViewWantsPhotos(quote.status as string) ? await signedPhotos(supabase, tenantId, assetIdsOf(requestRow)) : [],
  })
  return NextResponse.json(body)
}

type Supabase = Extract<Awaited<ReturnType<typeof requireTenant>>, { ok: true }>['supabase']

/** This tenant's photos among the request's assets, in the order they were sent, each as a short-lived signed address */
async function signedPhotos(supabase: Supabase, tenantId: string, assetIds: string[]): Promise<Array<{ id: string; url: string }>> {
  if (assetIds.length === 0 || !isR2Configured()) return []
  const { data } = await supabase.from('assets').select('id, r2_key').eq('tenant_id', tenantId).eq('type', 'image').in('id', assetIds)
  const keyOf = new Map(((data ?? []) as Array<{ id: string; r2_key: string | null }>).map((asset) => [asset.id, asset.r2_key]))
  const out: Array<{ id: string; url: string }> = []
  for (const id of assetIds.slice(0, MAX_PHOTOS)) {
    const key = keyOf.get(id)
    if (!key) continue
    try {
      out.push({ id, url: await generateDownloadUrl(await photoKeyToServe(key, 'small'), DASHBOARD_PHOTO_URL_SECONDS) })
    } catch (error) {
      // The error's name only: a message could carry a key or an address
      console.error('[AppQuote] photo could not be signed:', error instanceof Error ? error.name : 'unknown')
    }
  }
  return out
}
