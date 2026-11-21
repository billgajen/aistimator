import { NextResponse } from 'next/server'
import { SUPPORT_BODY_MAX, SUPPORT_COPY, SUPPORT_DAILY_LIMIT, underDailyLimit } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })
const isId = (value: string) => /^[0-9a-f-]{36}$/i.test(value)
/** A thread may take this many of a business's messages in a day */
const MESSAGES_A_DAY = SUPPORT_DAILY_LIMIT * 5

/**
 * POST /api/support/reports/:reportId/messages  { body }
 * T-197: the business's reply on its own report. Written through its own
 * client: the database's rules refuse another business's report and anything
 * not written as the business. A reply on a report we had closed opens it
 * again for the owner.
 */
export async function POST(request: Request, { params }: { params: { reportId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  if (!isId(params.reportId)) return fail(404, 'NOT_FOUND', 'That report could not be found.')
  const body = await readJson(request)
  const text = typeof body?.body === 'string' ? body.body.trim().slice(0, SUPPORT_BODY_MAX) : ''
  if (!text) return fail(400, 'MISSING_TEXT', 'Write your reply first.')

  const { data: report } = await auth.supabase.from('support_reports').select('id, status').eq('id', params.reportId).eq('tenant_id', auth.tenantId).maybeSingle()
  if (!report) return fail(404, 'NOT_FOUND', 'That report could not be found.')

  let today: number | null = null
  try {
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { count, error } = await auth.supabase.from('support_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', auth.tenantId).eq('author', 'business').gt('created_at', since)
    today = error ? null : count
  } catch {
    today = null
  }
  if (!underDailyLimit(today, MESSAGES_A_DAY)) return fail(429, 'DAILY_LIMIT', SUPPORT_COPY.limit)

  const { data: saved, error } = await auth.supabase
    .from('support_messages')
    .insert({ report_id: params.reportId, tenant_id: auth.tenantId, author: 'business', user_id: auth.userId, body: text })
    .select('id, author, body, created_at')
    .single()
  if (error || !saved) return fail(500, 'NOT_SAVED', SUPPORT_COPY.failed)

  // A reply on a closed report needs the owner again
  const status = (report as { status: string }).status
  if (status !== 'new' && status !== 'looking') {
    try {
      await createAdminClient().from('support_reports').update({ status: 'new' }).eq('id', params.reportId).eq('tenant_id', auth.tenantId)
    } catch {
      // the reply is saved either way
    }
  }
  const message = saved as { id: string; author: 'business' | 'team'; body: string; created_at: string }
  return NextResponse.json({ message: { id: message.id, from: message.author, body: message.body, createdAt: message.created_at } })
}
