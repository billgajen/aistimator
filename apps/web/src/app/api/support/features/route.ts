import { NextResponse } from 'next/server'
import { FEATURE_OPEN_STATUSES, SUPPORT_COPY, checkFeatureText, titleFromWords, underDailyLimit } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { matchFeatureRequests, requestSupportJob, sentToday } from '@/lib/support'

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

/**
 * POST /api/support/features
 *   { text }                       look for the same request first; saved as new when there is none
 *   { text, voteFor: requestId }   "Yes, add my vote"
 *   { text, different: true }      "No, mine is different"
 *
 * T-197. The business decides: the AI only offers up to three requests that
 * may mean the same, with their title and one line. It is never told who
 * asked or how many. If the match step fails or takes over five seconds the
 * request is saved as new. One vote per business per request (the table's
 * own rule); voting again answers "You've already asked for this."
 *
 * Requests and votes are written by the server, for the signed-in user's own
 * business only (a business has no write access to either table).
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = await readJson(request)
  const checked = checkFeatureText(body?.text)
  if (!checked.ok) return fail(400, checked.code, checked.message)
  const text = checked.value

  if (!underDailyLimit(await sentToday(auth.supabase, 'feature_votes', auth.tenantId))) return fail(429, 'DAILY_LIMIT', SUPPORT_COPY.limit)
  const admin = createAdminClient()

  if (body?.voteFor !== undefined) {
    if (!isId(body.voteFor)) return fail(404, 'NOT_FOUND', 'That request could not be found.')
    // Only a request that may be offered to a business: open, not merged away, and not still in someone's own words
    const { data: target } = await admin
      .from('feature_requests')
      .select('id')
      .eq('id', body.voteFor)
      .in('status', [...FEATURE_OPEN_STATUSES])
      .in('title_source', ['ai', 'owner'])
      .is('merged_into', null)
      .maybeSingle()
    if (!target) return fail(404, 'NOT_FOUND', 'That request could not be found.')
    const { error } = await admin.from('feature_votes').insert({ request_id: body.voteFor, tenant_id: auth.tenantId, user_id: auth.userId, body: text })
    if (error?.code === '23505') return fail(409, 'ALREADY_VOTED', SUPPORT_COPY.feature.already)
    if (error) return fail(500, 'NOT_SAVED', SUPPORT_COPY.failed)
    return NextResponse.json({ step: 'saved', voted: true, message: SUPPORT_COPY.feature.voted })
  }

  if (body?.different !== true) {
    // Before saving: is this one of the requests already made? Empty on any failure, and after five seconds.
    const matches = await matchFeatureRequests(text)
    if (matches.length > 0) return NextResponse.json({ step: 'match', matches })
  }

  const { data: created, error: createError } = await admin
    .from('feature_requests')
    .insert({ title: titleFromWords(text), title_source: 'words' })
    .select('id')
    .single()
  if (createError || !created) return fail(500, 'NOT_SAVED', SUPPORT_COPY.failed)
  const requestId = (created as { id: string }).id
  const { error: voteError } = await admin.from('feature_votes').insert({ request_id: requestId, tenant_id: auth.tenantId, user_id: auth.userId, body: text })
  if (voteError) {
    // a request with nobody asking for it is not kept
    await admin.from('feature_requests').delete().eq('id', requestId)
    return fail(500, 'NOT_SAVED', SUPPORT_COPY.failed)
  }
  // Saved. A plain title for it is the worker's job; without one the owner still sees the business's words.
  try {
    await requestSupportJob('feature_title', requestId)
  } catch {
    // nothing is lost
  }
  return NextResponse.json({ step: 'saved', voted: false, message: SUPPORT_COPY.feature.thanks })
}
