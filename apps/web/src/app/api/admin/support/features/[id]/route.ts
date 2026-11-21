import { NextResponse } from 'next/server'
import { FEATURE_STATUSES, type FeatureStatus } from '@qolumns/shared'
import { verifyAdmin } from '@/lib/admin'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { featureDetail, markShipped, mergeFeature, renameFeature, setFeatureStatus, shippedPreview, splitFeature } from '@/lib/support-admin'
import { supportMailer } from '@/lib/support-mailer'

export const dynamic = 'force-dynamic'

const forbidden = () => NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, { status: 403 })
const fail = (status: number, message: string) => NextResponse.json({ error: { code: 'FAILED', message } }, { status })
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

/** GET /api/admin/support/features/:id — one request, the businesses that asked and their own words. Platform admin only. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin())) return forbidden()
  if (!isId(params.id)) return fail(404, 'That request could not be found.')
  const detail = await featureDetail(createAdminClient(), params.id)
  return detail ? NextResponse.json({ feature: detail }) : fail(404, 'That request could not be found.')
}

/**
 * POST /api/admin/support/features/:id  { action, … }  (T-197, platform admin only)
 *   rename   { title?, summary? }
 *   status   { status }      any status but "shipped"
 *   shipped  { confirm }     confirm false: what will be sent and to how many businesses; true: set it and email them
 *   merge    { into }
 *   split    { voteId }      one business's ask becomes a request of its own
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin())) return forbidden()
  if (!isId(params.id)) return fail(404, 'That request could not be found.')
  const body = await readJson(request)
  const supabase = createAdminClient()
  switch (body?.action) {
    case 'rename': {
      const ok = await renameFeature(supabase, params.id, { title: typeof body.title === 'string' ? body.title : undefined, summary: typeof body.summary === 'string' ? body.summary : undefined })
      return ok ? NextResponse.json({ ok: true }) : fail(400, 'A request needs a title.')
    }
    case 'status': {
      const status = body.status as FeatureStatus
      if (!FEATURE_STATUSES.includes(status) || status === 'shipped') return fail(400, 'Choose a status. "Shipped" is confirmed before it is sent.')
      return (await setFeatureStatus(supabase, params.id, status)) ? NextResponse.json({ ok: true }) : fail(500, 'The status could not be saved.')
    }
    case 'shipped': {
      const mailer = supportMailer()
      if (body.confirm !== true) {
        const preview = await shippedPreview(supabase, params.id, mailer.appUrl)
        return preview ? NextResponse.json({ preview: { businesses: preview.businesses, subject: preview.email.subject, html: preview.email.html } }) : fail(404, 'That request could not be found.')
      }
      const result = await markShipped(supabase, params.id, mailer)
      return result.ok ? NextResponse.json(result) : fail(404, 'That request could not be found.')
    }
    case 'merge': {
      if (!isId(body.into)) return fail(400, 'Choose the request to merge into.')
      const result = await mergeFeature(supabase, params.id, body.into)
      return result.ok ? NextResponse.json({ ok: true }) : fail(400, result.message ?? 'The merge could not be saved.')
    }
    case 'split': {
      if (!isId(body.voteId)) return fail(400, 'Choose the business to split out.')
      const result = await splitFeature(supabase, params.id, body.voteId)
      return result.ok ? NextResponse.json({ ok: true, newId: result.newId }) : fail(400, result.message ?? 'The split could not be saved.')
    }
    default:
      return fail(400, 'Unknown action.')
  }
}
