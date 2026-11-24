import { NextResponse } from 'next/server'
import { headers as requestHeaders } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/** How long the answer may be reused; well inside the hour the picture's own address lasts */
const REUSE_SECONDS = 600
const PICTURE_SECONDS = 3600

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not a logo' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

/**
 * GET /api/public/logo/:assetId  (T-201)
 * A business's logo, for its emails to its customers. An email is opened days
 * or weeks after it is sent, so it cannot carry the picture's own address
 * (signed, and good for an hour): it carries this one, which sends the reader
 * on to the picture.
 *
 * Public, read-only, no cookie. It serves a picture ONLY when it is the logo
 * some business has set today (`tenants.branding_json.logoAssetId`): a
 * customer's photo, a document, or a logo the business has since replaced or
 * removed is 404, whatever id is asked for. A logo is public by its nature:
 * it is on the business's request form and on every estimate it sends.
 */
export async function GET(_request: Request, { params }: { params: { assetId: string } }) {
  // Reading the request's headers makes every call look the row up afresh (as /api/public/address does)
  requestHeaders()
  const assetId = (params.assetId || '').trim()
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(assetId) || !isR2Configured()) return notFound()

  try {
    const admin = createAdminClient()
    const { data: asset } = await admin.from('assets').select('id, tenant_id, type, r2_key').eq('id', assetId).maybeSingle()
    const row = asset as { id: string; tenant_id: string; type: string; r2_key: string | null } | null
    if (!row || row.type !== 'image' || !row.r2_key) return notFound()

    const { data: tenant } = await admin.from('tenants').select('branding_json').eq('id', row.tenant_id).maybeSingle()
    const current = (tenant as { branding_json?: { logoAssetId?: unknown } | null } | null)?.branding_json?.logoAssetId
    if (current !== row.id) return notFound()

    const url = await generateDownloadUrl(row.r2_key, PICTURE_SECONDS)
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': `public, max-age=${REUSE_SECONDS}` } })
  } catch (error) {
    console.error('[Logo] Could not serve a logo:', error instanceof Error ? error.message : 'unknown')
    return notFound()
  }
}
