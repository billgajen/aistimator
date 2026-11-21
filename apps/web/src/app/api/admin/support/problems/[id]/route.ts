import { NextResponse } from 'next/server'
import { SUPPORT_STATUSES, type SupportStatus } from '@qolumns/shared'
import { verifyAdmin } from '@/lib/admin'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { fixedPreview, markFixed, mergeProblem, problemDetail, replyToReport, setApproved, setOwnerNote, setProblemStatus, sortAgain, unmergeProblem } from '@/lib/support-admin'
import { supportMailer } from '@/lib/support-mailer'

export const dynamic = 'force-dynamic'

const forbidden = () => NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, { status: 403 })
const fail = (status: number, message: string) => NextResponse.json({ error: { code: 'FAILED', message } }, { status })
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

/** GET /api/admin/support/problems/:id — one problem, with the AI's sorting and the thread. Platform admin only. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin())) return forbidden()
  if (!isId(params.id)) return fail(404, 'That problem could not be found.')
  const detail = await problemDetail(createAdminClient(), params.id)
  return detail ? NextResponse.json({ problem: detail }) : fail(404, 'That problem could not be found.')
}

/**
 * POST /api/admin/support/problems/:id  { action, … }  (T-197, platform admin only)
 *   reply    { body }               to the business's Help panel and by email to the user who reported
 *   status   { status }             any status but "fixed"
 *   fixed    { message?, confirm }  confirm false: what will be sent and to how many businesses; true: send it
 *   merge    { into }  /  unmerge
 *   approve  { approved }           "Approved for fixing", with the date
 *   note     { note }               the owner's private note
 *   sort                            ask the AI to sort it again (one more try)
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(await verifyAdmin())) return forbidden()
  if (!isId(params.id)) return fail(404, 'That problem could not be found.')
  const body = await readJson(request)
  const supabase = createAdminClient()
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  switch (body?.action) {
    case 'reply': {
      const result = await replyToReport(supabase, params.id, text(body.body), supportMailer())
      return result.ok ? NextResponse.json(result) : fail(400, 'The reply could not be sent. Write something first.')
    }
    case 'status': {
      const status = body.status as SupportStatus
      if (!SUPPORT_STATUSES.includes(status) || status === 'fixed') return fail(400, 'Choose a status. "Fixed" is confirmed before it is sent.')
      return (await setProblemStatus(supabase, params.id, status)) ? NextResponse.json({ ok: true }) : fail(500, 'The status could not be saved.')
    }
    case 'fixed': {
      const mailer = supportMailer()
      if (body.confirm !== true) {
        const preview = await fixedPreview(supabase, params.id, text(body.message), mailer.appUrl)
        return preview ? NextResponse.json({ preview: { businesses: preview.businesses, subject: preview.email.subject, html: preview.email.html } }) : fail(404, 'That problem could not be found.')
      }
      const result = await markFixed(supabase, params.id, text(body.message), mailer)
      return result.ok ? NextResponse.json(result) : fail(404, 'That problem could not be found.')
    }
    case 'merge': {
      if (!isId(body.into)) return fail(400, 'Choose the problem to merge into.')
      const result = await mergeProblem(supabase, params.id, body.into)
      return result.ok ? NextResponse.json({ ok: true }) : fail(400, result.message ?? 'The merge could not be saved.')
    }
    case 'unmerge':
      return (await unmergeProblem(supabase, params.id)) ? NextResponse.json({ ok: true }) : fail(500, 'The merge could not be undone.')
    case 'approve':
      return (await setApproved(supabase, params.id, body.approved === true)) ? NextResponse.json({ ok: true }) : fail(500, 'That could not be saved.')
    case 'note':
      return (await setOwnerNote(supabase, params.id, text(body.note))) ? NextResponse.json({ ok: true }) : fail(500, 'The note could not be saved.')
    case 'sort':
      return NextResponse.json({ ok: true, asked: await sortAgain(supabase, params.id) })
    default:
      return fail(400, 'Unknown action.')
  }
}
