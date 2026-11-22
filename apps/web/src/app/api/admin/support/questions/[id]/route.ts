import { NextResponse } from 'next/server'
import { verifyAdmin } from '@/lib/admin'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { questionDetail, reviewQuestion } from '@/lib/help-admin'

export const dynamic = 'force-dynamic'

const forbidden = () => NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, { status: 403 })
const fail = (status: number, message: string) => NextResponse.json({ error: { code: 'FAILED', message } }, { status })
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

/** GET /api/admin/support/questions/:id — one question put to the Help assistant, its answer and what the answer used. Platform admin only. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin())) return forbidden()
  if (!isId(params.id)) return fail(404, 'That question could not be found.')
  const detail = await questionDetail(createAdminClient(), params.id)
  return detail ? NextResponse.json({ question: detail }) : fail(404, 'That question could not be found.')
}

/**
 * POST /api/admin/support/questions/:id  { review?, note? }  (T-198, platform admin only)
 *   review  'guide_updated' | 'nothing_to_do' | 'open'
 *   note    the owner's private note
 * Nothing here reaches the business.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin())) return forbidden()
  if (!isId(params.id)) return fail(404, 'That question could not be found.')
  const body = await readJson(request)
  const saved = await reviewQuestion(createAdminClient(), params.id, { review: body?.review, note: body?.note })
  return saved ? NextResponse.json({ ok: true }) : fail(400, 'That could not be saved.')
}
