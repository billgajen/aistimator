import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { rateQuestion } from '@/lib/help/ask'

/**
 * POST /api/support/ask/[id]  { rating: 'yes' | 'no' }
 *
 * T-198: "Did this answer it?" under an answer. A business rates its own
 * questions only: the row is found by its id AND the signed-in user's
 * business, so another business's question answers 404.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = await readJson(request)
  const rating = body?.rating === 'yes' || body?.rating === 'no' ? body.rating : null
  if (!rating || !/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: { code: 'INVALID_BODY', message: 'Choose Yes or No.' } }, { status: 400 })
  const kept = await rateQuestion(createAdminClient(), auth.tenantId, params.id, rating)
  if (!kept) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'That question could not be found.' } }, { status: 404 })
  return NextResponse.json({ success: true })
}
