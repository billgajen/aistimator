/**
 * T-178: the web app's side of "a failed quote is never silent".
 *
 * The worker marks a quote failed when pricing fails (apps/worker/src/
 * failed-quote.ts). The web app can fail one too: when the request is saved
 * but the job cannot be handed to the worker. Until T-178 that case wrote a
 * column that does not exist (`error_message`), so the update was refused,
 * the quote stayed "queued" for ever and nobody was told.
 *
 * This marks the quote failed (the reason goes in content_json, where the
 * worker puts its own) and emails the business once, with the same email the
 * worker sends. Never throws.
 */
import { failedRequestEmail } from '@qolumns/shared'
import type { createAdminClient } from '@/lib/supabase/server'
import { isPostmarkConfigured, sendEmail } from '@/lib/postmark'
import { resolveBusinessEmail } from '@/lib/business-email'
import { sendOpsAlert } from '@/lib/ops-alert'
import { notifyPhones } from '@/lib/push'

type Admin = ReturnType<typeof createAdminClient>

interface FailedRow {
  tenant_id: string
  customer_json: { name?: string; email?: string; phone?: string } | null
  content_json: Record<string, unknown> | null
  is_test?: boolean | null
  service: { name?: string } | null
}

export async function markQuoteFailed(supabase: Admin, quoteId: string, reason: string): Promise<{ marked: boolean; emailed: boolean }> {
  let emailed = false
  try {
    const { data } = await supabase
      .from('quotes')
      .select('tenant_id, customer_json, content_json, is_test, service:services(name)')
      .eq('id', quoteId)
      .single()
    const quote = data as unknown as FailedRow | null
    const content = quote?.content_json ?? {}

    // One email per request, whoever marks it failed (the worker reads the same stamp)
    if (quote && typeof content.failedNotifiedAt !== 'string' && isPostmarkConfigured()) {
      try {
        // null for the demo business, which emails no one
        const to = await resolveBusinessEmail(supabase, quote.tenant_id)
        if (to) {
          const { subject, html } = failedRequestEmail({
            customerName: quote.customer_json?.name ?? '',
            customerEmail: quote.customer_json?.email,
            customerPhone: quote.customer_json?.phone,
            serviceName: quote.service?.name ?? 'your service',
            quoteUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/app/quotes/${quoteId}`,
            isTest: quote.is_test === true,
          })
          const result = await sendEmail({ from: { kind: 'business' }, to, subject, htmlBody: html, tag: 'quote-failed' })
          emailed = result.success
        }
      } catch (emailError) {
        console.error(`[FailedQuote] email error for ${quoteId}: ${emailError instanceof Error ? emailError.name : 'unknown error'}`)
      }
    }

    // T-196: a request that could not be priced is still a new request: the business's phones hear of it
    // once (never twice: the event is claimed), whether or not an email could be sent. Never throws.
    if (quote) await notifyPhones('new_request', quoteId, null, supabase)

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('quotes')
      .update({ status: 'failed', content_json: { ...content, error: reason, failedAt: now, ...(emailed && { failedNotifiedAt: now }) } })
      .eq('id', quoteId)
    // T-189: the owner is told the worker could not be reached (ids only; one email an hour for this kind)
    await sendOpsAlert(supabase, {
      kind: 'worker_error',
      details: { Where: 'the web app could not hand a request to the worker', Quote: quoteId, ...(quote?.tenant_id && { Business: quote.tenant_id }) },
    })
    if (error) {
      console.error(`[FailedQuote] could not mark ${quoteId} failed: ${error.message}`)
      return { marked: false, emailed }
    }
    return { marked: true, emailed }
  } catch (unexpected) {
    console.error(`[FailedQuote] error for ${quoteId}: ${unexpected instanceof Error ? unexpected.name : 'unknown error'}`)
    return { marked: false, emailed }
  }
}
