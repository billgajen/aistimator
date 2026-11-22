import { NextResponse } from 'next/server'
import { SUPPORT_COPY, checkEstimateInput, checkProblemInput, cleanQuestion, conversationReport, underDailyLimit, type AskTurn, type SupportContext } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { readJson } from '@/lib/auth-route'
import { createAdminClient } from '@/lib/supabase/server'
import { REPORT_COLUMNS, myReportOf, one, openInternal, planName, requestSupportJob, sentToday, serviceTemplateOf } from '@/lib/support'
import { conversationTurns, isConversationId } from '@/lib/help/ask'
import { helpExcerpt } from '@/lib/help/guide'
import { UPLOAD_IMAGE_TYPES, UPLOAD_MAX_IMAGE_BYTES } from '@/lib/upload-limits'

const fail = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/support/reports
 *   { kind: 'problem', body, screenshotAssetId?, context? }
 *   { kind: 'estimate', quoteId, choices[], body?, expectedTotal? }
 *   { kind: 'problem', fromAssistant: conversationId, turns?, context? }   T-198: "Send this to the Qolumns team"
 *
 * T-197. The report is saved first, through the business's own client (the
 * database's rules make it this business's and nobody else's). Only then is
 * the owner's row opened and the worker asked to sort it; if either of those
 * fails the report is still saved and the business is still thanked.
 *
 * `expectedTotal` is stored on the report and read by nothing that prices.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = await readJson(request)
  if (!body) return fail(400, 'INVALID_BODY', SUPPORT_COPY.failed)
  const kind = body.kind === 'estimate' ? 'estimate' : 'problem'

  // The limit is counted in the database; a count that cannot be read lets the report through
  if (!underDailyLimit(await sentToday(auth.supabase, 'support_reports', auth.tenantId))) return fail(429, 'DAILY_LIMIT', SUPPORT_COPY.limit)

  let row: Record<string, unknown>
  let serviceName: string | null = null
  let conversationId: string | null = null
  if (kind === 'estimate') {
    const checked = checkEstimateInput(body)
    if (!checked.ok) return fail(400, checked.code, checked.message)
    // The business's own client: an estimate of another business is simply not found
    const { data: quote } = await auth.supabase
      .from('quotes')
      .select('id, is_test, pricing_json, service:services!service_id (name)')
      .eq('id', checked.value.quoteId)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle()
    if (!quote) return fail(404, 'QUOTE_NOT_FOUND', 'That estimate could not be found.')
    const found = quote as unknown as { id: string; is_test?: boolean | null; pricing_json?: { currency?: string } | null; service: unknown }
    serviceName = one(found.service as { name?: string } | null)?.name ?? null
    row = {
      kind,
      quote_id: found.id,
      is_test: found.is_test === true,
      choices: checked.value.choices,
      body: checked.value.body,
      expected_total: checked.value.expectedTotal,
      currency: found.pricing_json?.currency ?? null,
      context_json: { page: `/app/quotes/${found.id}`, quoteId: found.id } satisfies SupportContext,
    }
  } else {
    // T-198: a conversation with the Help assistant, sent on. Its words are the ones we kept for this
    // business (another business's conversation id finds nothing); only when none were kept, the
    // browser's copy, with customer details taken out the same way.
    if (isConversationId(body.fromAssistant)) {
      conversationId = body.fromAssistant
      const kept: AskTurn[] = await conversationTurns(createAdminClient(), auth.tenantId, conversationId)
      const sent: AskTurn[] = (Array.isArray(body.turns) ? body.turns : [])
        .slice(-20)
        .map((turn) => (turn && typeof turn === 'object' ? (turn as Record<string, unknown>) : {}))
        .map((turn) => ({ question: cleanQuestion(typeof turn.question === 'string' ? turn.question : ''), answer: cleanQuestion(typeof turn.answer === 'string' ? turn.answer : '') }))
        .filter((turn) => turn.question)
      const turns = kept.length ? kept : sent
      if (turns.length === 0) return fail(400, 'MISSING_TEXT', SUPPORT_COPY.problem.required)
      body.body = conversationReport(turns)
    }
    const checked = checkProblemInput(body)
    if (!checked.ok) return fail(400, checked.code, checked.message)
    const context: SupportContext = { ...checked.value.context }
    let quoteId: string | null = null
    let isTest = false
    if (context.quoteId) {
      const { data: quote } = await auth.supabase.from('quotes').select('id, is_test, service:services!service_id (name)').eq('id', context.quoteId).eq('tenant_id', auth.tenantId).maybeSingle()
      const found = quote as unknown as { id: string; is_test?: boolean | null; service: unknown } | null
      if (found) {
        quoteId = found.id
        isTest = found.is_test === true
        serviceName = one(found.service as { name?: string } | null)?.name ?? null
      } else {
        delete context.quoteId
      }
    }
    // A screenshot is one of this business's own uploads, an image within the upload limit
    let screenshot: string | null = null
    if (checked.value.screenshotAssetId) {
      const { data: asset } = await auth.supabase.from('assets').select('id, content_type, size_bytes').eq('id', checked.value.screenshotAssetId).eq('tenant_id', auth.tenantId).maybeSingle()
      const found = asset as { id: string; content_type?: string; size_bytes?: number } | null
      if (!found || !UPLOAD_IMAGE_TYPES.includes(found.content_type ?? '') || (found.size_bytes ?? 0) > UPLOAD_MAX_IMAGE_BYTES) {
        return fail(400, 'INVALID_SCREENSHOT', 'The screenshot must be an image of up to 10 MB.')
      }
      screenshot = found.id
    }
    const plan = await planName(auth.supabase, auth.tenantId)
    if (plan) context.plan = plan
    row = { kind, body: checked.value.body, quote_id: quoteId, is_test: isTest, screenshot_asset_id: screenshot, context_json: context, ...(conversationId ? { from_assistant: true } : {}) }
  }

  const { data: saved, error } = await auth.supabase
    .from('support_reports')
    .insert({ ...row, tenant_id: auth.tenantId, user_id: auth.userId })
    .select(REPORT_COLUMNS)
    .single()
  if (error || !saved) {
    console.error(`[Support] a report could not be saved (${error?.code ?? 'no row'})`)
    return fail(500, 'NOT_SAVED', SUPPORT_COPY.failed)
  }
  const report = myReportOf(saved)

  // Saved. What follows is ours, and none of it may cost the business its report.
  try {
    const admin = createAdminClient()
    await openInternal(admin, report.id, serviceTemplateOf(serviceName))
    // T-198: the questions of that conversation now point at the report they became
    if (conversationId) await admin.from('help_questions').update({ report_id: report.id }).eq('tenant_id', auth.tenantId).eq('conversation_id', conversationId)
    // T-198: with what the help guide says near the business's words, for a draft reply
    await requestSupportJob('support_sort', report.id, helpExcerpt(report.body))
  } catch (afterError) {
    console.error(`[Support] report ${report.id} is saved; it could not be handed on (${afterError instanceof Error ? afterError.name : 'error'})`)
  }
  return NextResponse.json({ report, message: SUPPORT_COPY.problem.thanks })
}
