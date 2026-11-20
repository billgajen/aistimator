import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { appQuoteView, appViewWantsPhotos, type AppQuoteRow } from '@/lib/app-quote-view'
import { assetIdsOf, DASHBOARD_PHOTO_URL_SECONDS } from '@/lib/quote-photos'
import { fieldLabels, formFields, requestDetails, type FieldRow } from '@/lib/request-details'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { photoKeyToServe } from '@/lib/small-photo-server'
import { signedRoomModelUrl } from '@/lib/room-models'
import { resolveRegionContext, roomScanOfAnswers, roomScanView, type AppQuoteView } from '@qolumns/shared'

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
      'id, status, created_at, customer_json, pricing_json, content_json, clarification_questions_json, service_id, sent_at, viewed_at, accepted_at, paid_at, declined_at, token_expires_at, approved_at, request:quote_requests!quote_request_id (asset_ids, job_answers, job_postcode, job_address, job_quantity, source_json)'
    )
    .eq('id', params.quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (!quote) {
    return NextResponse.json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  }
  const [{ data: service }, { data: tenant }, { data: fieldRows }] = await Promise.all([
    supabase.from('services').select('name').eq('id', quote.service_id).single(),
    supabase.from('tenants').select('name, region, unit_system').eq('id', tenantId).single(),
    supabase.from('widget_configs').select('service_id, config_json').eq('tenant_id', tenantId),
  ])

  const requestRow = ((r: unknown) => (Array.isArray(r) ? r[0] : r))((quote as { request?: unknown }).request) as
    | { asset_ids?: unknown; job_answers?: unknown; job_postcode?: string | null; job_address?: string | null; job_quantity?: number | null; source_json?: unknown }
    | null
    | undefined

  // T-184: the small copy for the strip and the photo itself for the full-screen view; and how many
  // the request carries, so the app can say when one could not be shown
  const wantsPhotos = appViewWantsPhotos(quote.status as string)
  const photos = await signedPhotos(supabase, tenantId, assetIdsOf(requestRow), wantsPhotos)
  const body = appQuoteView({
    quote: quote as unknown as AppQuoteRow,
    serviceName: (service?.name as string) || '',
    businessName: (tenant?.name as string) || '',
    request: requestDetails(
      requestRow,
      fieldLabels(fieldRows as FieldRow[] | null, quote.service_id as string | null),
      formFields(fieldRows as FieldRow[] | null, quote.service_id as string | null)
    ),
    photos: wantsPhotos ? photos.signed : [],
    photoCount: photos.count,
    requestSource: requestRow?.source_json,
  })
  // T-193: what the room scan measured, and each room's model at an address that lasts a few minutes
  const scan = roomScanOfAnswers(requestRow?.job_answers)
  if (scan) {
    const region = resolveRegionContext((tenant ?? {}) as { region?: string | null; unit_system?: string | null })
    const view: NonNullable<AppQuoteView['roomScan']> = roomScanView(scan, region.unitSystem, region.locale)
    const modelUrls: Record<string, string> = {}
    for (const room of scan.rooms) {
      if (!room.modelId) continue
      const url = await signedRoomModelUrl({ tenantId, jobAnswers: requestRow?.job_answers }, room.modelId)
      if (url) modelUrls[room.modelId] = url
    }
    body.roomScan = { ...view, ...(Object.keys(modelUrls).length > 0 && { modelUrls }) }
  }
  return NextResponse.json(body)
}

type Supabase = Extract<Awaited<ReturnType<typeof requireTenant>>, { ok: true }>['supabase']

/**
 * This tenant's photos among the request's assets, in the order they were sent. Each is a pair of
 * short-lived signed addresses: its small copy (the original when it has none) and the photo itself.
 * `count` is how many photos the request has, whether or not they are signed this time.
 */
async function signedPhotos(
  supabase: Supabase,
  tenantId: string,
  assetIds: string[],
  sign: boolean
): Promise<{ count: number; signed: Array<{ id: string; url: string; fullUrl: string }> }> {
  if (assetIds.length === 0) return { count: 0, signed: [] }
  const { data } = await supabase.from('assets').select('id, r2_key').eq('tenant_id', tenantId).eq('type', 'image').in('id', assetIds)
  const keyOf = new Map(((data ?? []) as Array<{ id: string; r2_key: string | null }>).map((asset) => [asset.id, asset.r2_key]))
  const ids = assetIds.filter((id) => keyOf.get(id))
  const signed: Array<{ id: string; url: string; fullUrl: string }> = []
  if (sign && isR2Configured()) {
    for (const id of ids.slice(0, MAX_PHOTOS)) {
      const key = keyOf.get(id)!
      try {
        const fullUrl = await generateDownloadUrl(key, DASHBOARD_PHOTO_URL_SECONDS)
        // the small copy is a convenience: if it cannot be found or signed, the photo itself is shown
        let url = fullUrl
        try {
          url = await generateDownloadUrl(await photoKeyToServe(key, 'small'), DASHBOARD_PHOTO_URL_SECONDS)
        } catch {
          url = fullUrl
        }
        signed.push({ id, url, fullUrl })
      } catch (error) {
        // The error's name only: a message could carry a key or an address
        console.error('[AppQuote] photo could not be signed:', error instanceof Error ? error.name : 'unknown')
      }
    }
  }
  return { count: ids.length, signed }
}
